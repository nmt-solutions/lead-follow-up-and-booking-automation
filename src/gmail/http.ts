import { z } from "zod";
import type { GmailConfiguration } from "./configuration";
import { GmailFailure, gmailTokenSchema } from "../models/gmail";
export { GmailFailure } from "../models/gmail";
export function providerValue<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new GmailFailure("invalid_response");
  return result.data;
}
export const tokenSchema = gmailTokenSchema;
export function createGmailHttp(
  configuration: GmailConfiguration,
  fetcher: typeof fetch,
) {
  async function request(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bounded = AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(signal ? [signal] : []),
    ]);
    let response: Response;
    let text = "";
    try {
      response = await fetcher(url, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: bounded,
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > 2_000_000) throw new GmailFailure("invalid_response");
            chunks.push(result.value);
          }
        } finally {
          await reader.cancel();
        }
      }
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch (error) {
      if (error instanceof GmailFailure) throw error;
      throw new GmailFailure("unavailable");
    }
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      throw new GmailFailure("invalid_response");
    }
    if (!response.ok) {
      const parsed = z
        .object({
          error: z.union([
            z.string(),
            z.object({
              errors: z.array(z.object({ reason: z.string() })).optional(),
            }),
          ]),
        })
        .safeParse(raw);
      const reasons = parsed.success
        ? typeof parsed.data.error === "string"
          ? [parsed.data.error]
          : (parsed.data.error.errors?.map((v) => v.reason) ?? [])
        : [];
      throw new GmailFailure(
        response.status === 429 ||
          reasons.some((v) =>
            [
              "rateLimitExceeded",
              "userRateLimitExceeded",
              "quotaExceeded",
              "dailyLimitExceeded",
            ].includes(v),
          )
          ? "rate_limited"
          : response.status === 401 ||
              reasons.includes("invalid_grant") ||
              reasons.includes("invalid_token")
            ? "revoked"
            : response.status === 403
              ? "insufficient"
              : response.status === 404 || response.status === 410
                ? "not_found"
                : response.status === 400
                  ? "invalid_page"
                  : "unavailable",
      );
    }
    return raw;
  }
  return {
    async token(parameters: Record<string, string>, signal?: AbortSignal) {
      return providerValue(
        tokenSchema,
        await request(
          "https://oauth2.googleapis.com/token",
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
    async identity(accessToken: string) {
      return providerValue(
        z.object({
          sub: z.string().min(1).max(256),
          email: z.email().max(254),
          email_verified: z.literal(true),
        }),
        await request("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
    },
    api(path: string, accessToken: string, signal: AbortSignal) {
      return request(
        `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        signal,
      );
    },
    async revoke(token: string) {
      try {
        await request("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch (error) {
        if (!(error instanceof GmailFailure && error.reason === "revoked"))
          throw error;
      }
    },
  };
}
