import { rawMessage } from "../mailboxes/outgoing-mime";
import { z } from "zod";
import type { Clock } from "../models/business";
import type { MailEnvelope, MailDispatchAccess } from "../models/mail-dispatch";
import { gmailReadScope, gmailSendScope, GmailFailure } from "../models/gmail";
import { calendarCredentialVault } from "../appointments/credentials";
import type { GmailConfiguration } from "./configuration";
import { createGmailHttp, providerValue } from "./http";
import { gmailId } from "./messages";

export const gmailTransportKey = "gmail-sequence-v1";
const tokens = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  expiresAt: z.number().finite(),
});
/** One native transport request. No retry, send-as alias, mailbox enumeration or history expansion. */
export function createGmailTransport(d: {
  configuration: GmailConfiguration;
  fetch: typeof fetch;
  clock: Clock;
}): {
  send(
    envelope: MailEnvelope,
    signal: AbortSignal,
    access?: MailDispatchAccess,
  ): Promise<unknown>;
} {
  const http = createGmailHttp(d.configuration, d.fetch),
    vault = calendarCredentialVault(d.configuration);
  return {
    async send(envelope, signal, access) {
      const store = access?.gmail,
        grant = store?.grant;
      const rejected = {
        status: "not_accepted",
        reason: "rejected",
        retryAt: null,
      };
      if (
        !store?.processingEnabled ||
        !store.policy.configuration.requestedSend ||
        !grant ||
        grant.status !== "connected" ||
        !grant.accountSubject ||
        !grant.scopes.includes(gmailSendScope) ||
        !grant.credentials ||
        envelope.adapterKey !== gmailTransportKey ||
        envelope.adapterMode !== "live"
      )
        return rejected;
      const aad = `gmail:${envelope.businessId}:${grant.id}`;
      let credential: z.infer<typeof tokens>;
      try {
        credential = tokens.parse(
          JSON.parse(vault.decrypt(grant.credentials, aad)),
        );
      } catch {
        return rejected;
      }
      async function fail(error: unknown) {
        if (
          error instanceof GmailFailure &&
          ["revoked", "insufficient"].includes(error.reason)
        ) {
          const scopes = grant!.scopes.filter((s) => s !== gmailSendScope);
          await store!.updateGrant({
            status:
              error.reason === "revoked"
                ? "reconnect_required"
                : scopes.includes(gmailReadScope)
                  ? "connected"
                  : "insufficient",
            reason: error.reason,
            ...(error.reason === "insufficient" ? { scopes } : {}),
          });
          await store!.invalidate();
        }
      }
      if (credential.expiresAt <= d.clock.now().getTime() + 60000) {
        try {
          const refreshed = await http.token(
            {
              grant_type: "refresh_token",
              refresh_token: credential.refreshToken,
            },
            signal,
          );
          const scopes =
            refreshed.scope?.split(/\s+/).filter(Boolean) ?? grant.scopes;
          credential = {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token ?? credential.refreshToken,
            expiresAt: d.clock.now().getTime() + refreshed.expires_in * 1000,
          };
          await store.updateGrant({
            credentials: vault.encrypt(JSON.stringify(credential), aad),
            scopes,
          });
          if (
            !scopes.includes(gmailSendScope) ||
            (store.policy.configuration.requestedRead &&
              !scopes.includes(gmailReadScope))
          ) {
            await store.updateGrant({
              reason: "insufficient",
              status: scopes.some(
                (s) => s === gmailReadScope || s === gmailSendScope,
              )
                ? "connected"
                : "insufficient",
            });
            await store.invalidate();
            return rejected;
          }
        } catch (error) {
          await fail(error);
          return {
            status: "not_accepted",
            reason:
              error instanceof GmailFailure && error.reason === "rate_limited"
                ? "rate_limited"
                : "unavailable",
            retryAt: null,
          };
        }
      }
      const previous = access?.replyParent ?? access?.previousReceipt ?? null;
      // A preflight failure is definitively before transport. A changed subject retains RFC references
      // without forcing Gmail to append to a thread that no longer meets its subject-matching requirement.
      let raw: string;
      try {
        raw = rawMessage(envelope, previous);
        if (!access || !(await access.confirm())) return rejected;
        signal.throwIfAborted();
      } catch {
        return rejected;
      }
      try {
        const result = providerValue(
          z.object({ id: gmailId, threadId: gmailId }),
          await http.send(
            raw,
            previous &&
              (access.replyParent?.subject ?? access.previousSubject) ===
                envelope.subject
              ? gmailId.parse(previous.threadRef)
              : undefined,
            credential.accessToken,
            signal,
          ),
        );
        return {
          status: "accepted",
          receipt: {
            actionId: envelope.actionId,
            attemptId: envelope.attemptId,
            businessId: envelope.businessId,
            connectionId: envelope.connectionId,
            recipient: envelope.recipient,
            messageRef: result.id,
            threadRef: result.threadId,
            internetMessageId: envelope.internetMessageId,
            acceptedAt: d.clock.now().toISOString(),
            evidence: "provider_response",
          },
        };
      } catch (error) {
        await fail(error);
        if (
          error instanceof GmailFailure &&
          [
            "revoked",
            "insufficient",
            "rate_limited",
            "invalid_page",
            "not_found",
          ].includes(error.reason)
        )
          return {
            status: "not_accepted",
            reason:
              error.reason === "rate_limited" ? "rate_limited" : "rejected",
            retryAt: null,
          };
        return { status: "unknown" };
      }
    },
  };
}
