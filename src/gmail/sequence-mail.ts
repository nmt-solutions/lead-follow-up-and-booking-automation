import { z } from "zod";
import type { Clock } from "../models/business";
import type {
  SequenceEnvelope,
  SequenceMailProvider,
} from "../models/email-sequences";
import { gmailReadScope, gmailSendScope, GmailFailure } from "../models/gmail";
import { calendarCredentialVault } from "../appointments/credentials";
import type { GmailConfiguration } from "./configuration";
import { createGmailHttp, providerValue } from "./http";
import { gmailId } from "./messages";

export const gmailSequenceKey = "gmail-sequence-v1";
const tokens = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  expiresAt: z.number().finite(),
});
const encoded = (value: string) => {
  // RFC 2047 encoded words, each below 75 characters, without splitting UTF-8 code points.
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c).toString("base64")}?=`)
    .join("\r\n ");
};
function rawMessage(
  e: SequenceEnvelope,
  previous: { internetMessageId: string } | null,
) {
  for (const address of [e.fromAddress, e.recipient, e.replyTo])
    if (!z.email().safeParse(address).success || /[\r\n]/.test(address))
      throw new GmailFailure("invalid_response");
  if (
    [e.fromName, e.subject].some((v) => /[\u0000-\u001f\u007f]/.test(v)) ||
    !/^<[^<>\s@]+@[^<>\s@]+>$/.test(e.internetMessageId) ||
    (previous && !/^<[^<>\s@]+@[^<>\s@]+>$/.test(previous.internetMessageId))
  )
    throw new GmailFailure("invalid_response");
  const body = e.body.replace(/\r\n|\r|\n/g, "\r\n");
  return Buffer.from(
    [
      `From: ${encoded(e.fromName)} <${e.fromAddress}>`,
      `To: ${e.recipient}`,
      `Reply-To: ${e.replyTo}`,
      `Subject: ${encoded(e.subject)}`,
      `Message-ID: ${e.internetMessageId}`,
      `Date: ${new Date(e.reservedAt).toUTCString()}`,
      `X-Platform-Disclosure: ${encoded(e.platformDisclosure)}`,
      ...(previous
        ? [
            `In-Reply-To: ${previous.internetMessageId}`,
            `References: ${previous.internetMessageId}`,
          ]
        : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "",
      "",
    ].join("\r\n"),
  ).toString("base64url");
}

/** One native transport request. No retry, send-as alias, mailbox enumeration or history expansion. */
export function createGmailSequenceMail(d: {
  configuration: GmailConfiguration;
  fetch: typeof fetch;
  clock: Clock;
}): SequenceMailProvider {
  const http = createGmailHttp(d.configuration, d.fetch),
    vault = calendarCredentialVault(d.configuration);
  return {
    key: gmailSequenceKey,
    mode: "live",
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
        envelope.adapterKey !== gmailSequenceKey ||
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
      const previous = access?.previousReceipt ?? null;
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
            previous && access.previousSubject === envelope.subject
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
    async reconcile() {
      return { status: "unknown" };
    },
  };
}
