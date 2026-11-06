import { z } from "zod";
import {
  createMicrosoftHttp,
  MicrosoftCalendarFailure,
  type MicrosoftToken,
} from "../microsoft-calendar/http";
import { MicrosoftMailFailure } from "../models/microsoft-mail";
import type { MicrosoftMailConfiguration } from "./configuration";

export function microsoftValue<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new MicrosoftMailFailure("invalid_response");
  return parsed.data;
}
export function graphMailUrl(path: string, expectedPath?: string): URL {
  const url = new URL(path, "https://graph.microsoft.com/v1.0/");
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !(url.pathname === "/v1.0/me" || url.pathname.startsWith("/v1.0/me/")) ||
    url.username ||
    url.password ||
    url.hash ||
    (expectedPath && url.pathname !== expectedPath)
  )
    throw new MicrosoftMailFailure("invalid_response");
  return url;
}
export function createMicrosoftMailHttp(
  configuration: MicrosoftMailConfiguration,
  fetcher: typeof fetch,
) {
  // Reuse #25's signed issuer/audience/nonce/expiry verification, with bounded transport for keys and profile too.
  const boundedFetch: typeof fetch = async (url, init) => {
    const response = await fetcher(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(5000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2_000_000)
            throw new MicrosoftMailFailure("invalid_response");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      throw new MicrosoftMailFailure("invalid_response");
    }
    return new Response(response.status === 204 ? null : text, {
      status: response.status,
      headers: response.headers,
    });
  };
  async function request(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await boundedFetch(url, { ...init, signal });
    } catch (error) {
      if (error instanceof MicrosoftMailFailure) throw error;
      throw new MicrosoftMailFailure("unavailable");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await response.text());
    } catch {
      if (response.ok) throw new MicrosoftMailFailure("invalid_response");
    }
    if (!response.ok) {
      const parsed = z
        .object({
          error: z.union([z.string(), z.object({ code: z.string() })]),
        })
        .safeParse(raw);
      const code = parsed.success
        ? typeof parsed.data.error === "string"
          ? parsed.data.error
          : parsed.data.error.code
        : "";
      const retry = Number(response.headers.get("Retry-After"));
      throw new MicrosoftMailFailure(
        response.status === 429
          ? "rate_limited"
          : response.status === 401 ||
              [
                "invalid_grant",
                "interaction_required",
                "login_required",
              ].includes(code)
            ? "revoked"
            : [
                  "MailboxNotEnabledForRESTAPI",
                  "ErrorMailboxNotEnabledForRESTAPI",
                ].includes(code)
              ? "license_required"
              : [
                    "consent_required",
                    "unauthorized_client",
                    "access_denied",
                  ].includes(code)
                ? "approval_required"
                : response.status === 403 || code === "invalid_scope"
                  ? "insufficient"
                  : response.status === 410 ||
                      [
                        "syncStateNotFound",
                        "SyncStateNotFound",
                        "InvalidDeltaToken",
                        "ErrorInvalidSyncStateData",
                      ].includes(code)
                    ? "delta_expired"
                    : response.status === 404
                      ? "not_found"
                      : "unavailable",
        Number.isInteger(retry) && retry > 0 ? Math.min(retry, 86400) : 60,
      );
    }
    return raw;
  }
  const identity = createMicrosoftHttp(configuration, boundedFetch);
  async function profile(token: string, signal?: AbortSignal) {
    return microsoftValue(
      z.object({
        id: z.string().min(1).max(256),
        mail: z.email().nullable(),
        userPrincipalName: z.string().optional(),
        userType: z.string().optional(),
      }),
      await request(
        "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,userType",
        { headers: { Authorization: `Bearer ${token}` } },
        signal,
      ),
    );
  }
  return {
    profile,
    async token(
      parameters: Record<string, string>,
      signal?: AbortSignal,
    ): Promise<MicrosoftToken> {
      return microsoftValue(
        z.object({
          access_token: z.string().min(1).max(32768),
          refresh_token: z.string().min(1).max(32768).optional(),
          id_token: z.string().min(1).max(32768).optional(),
          expires_in: z.number().int().positive().max(86400),
          token_type: z.literal("Bearer"),
          scope: z.string().max(8192),
        }),
        await request(
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              ...parameters,
              client_id: configuration.clientId,
              client_secret: configuration.clientSecret,
            }),
          },
          signal,
        ),
      );
    },
    async identity(token: MicrosoftToken, nonce: string, now: Date) {
      try {
        const account = await identity.identity(token, nonce, now);
        const owner = await profile(token.access_token);
        if (account.accountKind === "microsoft_work") {
          if (owner.userType !== "Member")
            throw new MicrosoftMailFailure("unsupported_account");
        }
        if (
          (owner.mail ?? owner.userPrincipalName)?.toLowerCase() !==
          account.email.toLowerCase()
        )
          throw new MicrosoftMailFailure("account_mismatch");
        return { ...account, ownerId: owner.id };
      } catch (error) {
        if (error instanceof MicrosoftMailFailure) throw error;
        // The shared verifier deliberately sanitizes Graph errors. Re-observe /me through the mail classifier so account/licence/consent failures keep their safe recovery reason.
        if (error instanceof MicrosoftCalendarFailure)
          await profile(token.access_token);
        throw new MicrosoftMailFailure(
          error instanceof MicrosoftCalendarFailure &&
            error.reason === "unavailable"
            ? "unavailable"
            : "unsupported_account",
        );
      }
    },
    api(
      path: string,
      token: string,
      signal: AbortSignal,
      expectedPath?: string,
    ) {
      return request(
        graphMailUrl(path, expectedPath).toString(),
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Prefer:
              'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=100',
          },
        },
        signal,
      );
    },
  };
}
