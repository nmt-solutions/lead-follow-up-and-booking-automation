import { z } from "zod";
import type { Clock } from "../models/business";
import type {
  MailEnvelope,
  MailDispatchAccess,
  MailResult,
} from "../models/mail-dispatch";
import {
  MicrosoftMailFailure,
  microsoftMailReadScope,
  microsoftMailSendScope,
} from "../models/microsoft-mail";
import { calendarCredentialVault } from "../appointments/credentials";
import { rawMessage } from "../mailboxes/outgoing-mime";
import type { MicrosoftMailConfiguration } from "./configuration";
import { createMicrosoftMailHttp, microsoftValue } from "./http";
import { graphMessageSchema, graphMetadataFields, graphId } from "./messages";

export const microsoftTransportKey = "microsoft-mail-send-v1";
const tokens = z.object({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresAt: z.number().finite(),
  ownerId: z.string().min(1).max(256),
});

/** Invocation-local credentials use the existing Business dispatch transaction. No nested grant-service transaction or transport retry. */
export function createMicrosoftTransport(d: {
  configuration: MicrosoftMailConfiguration;
  fetch: typeof fetch;
  clock: Clock;
}) {
  const http = createMicrosoftMailHttp(d.configuration, d.fetch),
    vault = calendarCredentialVault(d.configuration);
  return {
    async send(
      e: MailEnvelope,
      signal: AbortSignal,
      access?: MailDispatchAccess,
    ): Promise<MailResult> {
      const store = access?.microsoft,
        grant = store?.grant;
      const rejected: MailResult = {
        status: "not_accepted",
        reason: "rejected",
        retryAt: null,
      };
      if (
        !store?.processingEnabled ||
        !store.policy.configuration.requestedSend ||
        !grant?.credentials ||
        grant.status !== "connected" ||
        !grant.accountSubject ||
        !/^(microsoft_personal|microsoft_work):/.test(grant.accountSubject) ||
        !grant.scopes.includes(microsoftMailSendScope) ||
        e.adapterKey !== microsoftTransportKey ||
        e.adapterMode !== "live"
      )
        return rejected;
      const aad = `microsoft-mail:${e.businessId}:${grant.id}`;
      let credential: z.infer<typeof tokens>;
      try {
        credential = tokens.parse(
          JSON.parse(vault.decrypt(grant.credentials, aad)),
        );
      } catch {
        return rejected;
      }
      async function fail(error: unknown) {
        if (!(error instanceof MicrosoftMailFailure)) return;
        if (
          [
            "revoked",
            "insufficient",
            "approval_required",
            "license_required",
            "unsupported_account",
            "account_mismatch",
          ].includes(error.reason)
        ) {
          const scopes = grant!.scopes.filter(
            (s) => s !== microsoftMailSendScope,
          );
          await store!.updateGrant({
            reason: error.reason,
            status:
              error.reason === "revoked"
                ? "reconnect_required"
                : error.reason === "insufficient" &&
                    scopes.includes(microsoftMailReadScope)
                  ? "connected"
                  : "insufficient",
            ...(error.reason === "insufficient" ? { scopes } : {}),
          });
          await store!.invalidate();
        }
      }
      // All failures here precede the sole transport request and are definitively not accepted.
      try {
        if (credential.expiresAt <= d.clock.now().getTime() + 60000) {
          const refreshed = await http.token(
            {
              grant_type: "refresh_token",
              refresh_token: credential.refreshToken,
              scope: grant.scopes.join(" "),
            },
            signal,
          );
          const scopes = refreshed.scope
            .split(/\s+/)
            .filter(Boolean)
            .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//, ""));
          credential = {
            ...credential,
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? credential.refreshToken,
            expiresAt: d.clock.now().getTime() + refreshed.expires_in * 1000,
          };
          await store.updateGrant({
            credentials: vault.encrypt(JSON.stringify(credential), aad),
            scopes,
          });
          if (
            !scopes.includes(microsoftMailSendScope) ||
            (store.policy.configuration.requestedRead &&
              (!scopes.includes(microsoftMailReadScope) ||
                !scopes.includes("MailboxSettings.Read")))
          )
            throw new MicrosoftMailFailure("insufficient");
        }
        // Stable primary mailbox identity and account capabilities, including an unexpired credential.
        const owner = await http.profile(credential.accessToken, signal);
        if (
          owner.id !== credential.ownerId ||
          (owner.mail ?? owner.userPrincipalName)?.toLowerCase() !==
            e.fromAddress
        )
          throw new MicrosoftMailFailure("account_mismatch");
        if (
          grant.accountSubject.startsWith("microsoft_work:") &&
          owner.userType !== "Member"
        )
          throw new MicrosoftMailFailure("unsupported_account");
        const purpose = microsoftValue(
          z.object({ userPurpose: z.string() }),
          await http.api(
            "me/mailboxSettings?$select=userPurpose",
            credential.accessToken,
            signal,
          ),
        );
        if (purpose.userPurpose !== "user")
          throw new MicrosoftMailFailure("unsupported_account");
      } catch (error) {
        await fail(error);
        return {
          status: "not_accepted",
          reason:
            error instanceof MicrosoftMailFailure &&
            error.reason === "rate_limited"
              ? "rate_limited"
              : "unavailable",
          retryAt:
            error instanceof MicrosoftMailFailure &&
            error.reason === "rate_limited"
              ? new Date(
                  d.clock.now().getTime() +
                    (error.retryAfterSeconds ?? 60) * 1000,
                ).toISOString()
              : null,
        };
      }
      const previous = access?.replyParent ?? access?.previousReceipt ?? null;
      let parent: string | undefined, raw: string;
      try {
        // /reply MIME uses the original sender. Never let Graph choose additional/unapproved Reply-To recipients.
        // Follow-ups to our own Sent message use sendMail with exact RFC references, never reply-to-self.
        if (access?.replyParent) {
          parent = graphId.parse(access.replyParent.messageRef);
          const current = microsoftValue(
            graphMessageSchema.extend({
              body: z.object({
                contentType: z.literal("text"),
                content: z.string().min(1).max(20000),
              }),
            }),
            await http.api(
              `me/messages/${encodeURIComponent(parent)}?$select=${graphMetadataFields},body`,
              credential.accessToken,
              signal,
            ),
          );
          const from = current.from.emailAddress.address,
            replyTo = current.replyTo.map((r) => r.emailAddress.address);
          if (
            current.subject !== e.subject ||
            (access.replyParent.text !== undefined &&
              current.body.content.replace(/\r\n|\r/g, "\n") !==
                access.replyParent.text.replace(/\r\n|\r/g, "\n")) ||
            current.id !== parent ||
            current.isDraft ||
            current.conversationId !== previous?.threadRef ||
            current.internetMessageId !== previous?.internetMessageId ||
            from !== e.recipient ||
            current.sender.emailAddress.address !== from ||
            replyTo.length > 1 ||
            (replyTo.length === 1 && replyTo[0] !== e.recipient) ||
            !current.toRecipients.some(
              (r) => r.emailAddress.address === e.fromAddress,
            )
          )
            return rejected;
        }
        raw = Buffer.from(rawMessage(e, previous), "base64url").toString(
          "base64",
        );
        if (!access || !(await access.confirm())) return rejected;
        signal.throwIfAborted();
      } catch (error) {
        await fail(error);
        return rejected;
      }
      try {
        await http.send(raw, credential.accessToken, signal, parent);
        return {
          status: "accepted_pending_identity",
          acceptance: {
            provider: "microsoft",
            evidence: "provider_response",
            actionId: e.actionId,
            attemptId: e.attemptId,
            businessId: e.businessId,
            connectionId: e.connectionId,
            recipient: e.recipient,
            submittedInternetMessageId: e.internetMessageId,
            acceptedAt: d.clock.now().toISOString(),
          },
        };
      } catch (error) {
        await fail(error);
        if (
          error instanceof MicrosoftMailFailure &&
          [
            "revoked",
            "insufficient",
            "approval_required",
            "license_required",
            "not_found",
            "rate_limited",
          ].includes(error.reason)
        )
          return {
            status: "not_accepted",
            reason:
              error.reason === "rate_limited" ? "rate_limited" : "rejected",
            retryAt:
              error.reason === "rate_limited"
                ? new Date(
                    d.clock.now().getTime() +
                      (error.retryAfterSeconds ?? 60) * 1000,
                  ).toISOString()
                : null,
          };
        // Lost/malformed/5xx outcomes cannot authorize another send.
        return { status: "unknown" };
      }
    },
  };
}
