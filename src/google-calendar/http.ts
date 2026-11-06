import { z } from "zod";
import type { GoogleCalendarConfiguration } from "./configuration";
import { googleCalendarChoiceSchema } from "../models/google-calendar";
import { CalendarProviderFailure } from "../appointments/provider";

export type GoogleFailureReason =
  | "rate_limited"
  | "revoked"
  | "insufficient"
  | "conflict"
  | "not_found"
  | "unavailable"
  | "invalid_response";
export class GoogleCalendarFailure extends CalendarProviderFailure {
  constructor(readonly reason: GoogleFailureReason) {
    super(reason);
  }
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86400),
  refresh_token: z.string().min(1).max(8192).optional(),
  scope: z.string().max(10000).optional(),
});
export type GoogleToken = z.infer<typeof tokenSchema>;
export function createGoogleHttp(
  configuration: GoogleCalendarConfiguration,
  fetcher: typeof fetch,
) {
  async function request(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: signal ?? AbortSignal.timeout(4000),
        cache: "no-store",
      });
    } catch {
      throw new GoogleCalendarFailure("unavailable");
    }
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new GoogleCalendarFailure("invalid_response");
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      throw new GoogleCalendarFailure("invalid_response");
    }
    if (!response.ok) {
      const error = z
        .object({
          error: z.union([
            z.string(),
            z.object({
              errors: z.array(z.object({ reason: z.string() })).optional(),
            }),
          ]),
        })
        .safeParse(raw);
      const reasons = error.success
        ? typeof error.data.error === "string"
          ? [error.data.error]
          : (error.data.error.errors?.map((e) => e.reason) ?? [])
        : [];
      throw new GoogleCalendarFailure(
        response.status === 429 ||
          reasons.some((r) =>
            [
              "rateLimitExceeded",
              "userRateLimitExceeded",
              "quotaExceeded",
            ].includes(r),
          )
          ? "rate_limited"
          : response.status === 401 ||
              reasons.includes("invalid_grant") ||
              reasons.includes("invalid_token")
            ? "revoked"
            : response.status === 403
              ? "insufficient"
              : response.status === 409 || response.status === 412
                ? "conflict"
                : response.status === 404 || response.status === 410
                  ? "not_found"
                  : "unavailable",
      );
    }
    return raw;
  }
  async function token(parameters: Record<string, string>) {
    const result = tokenSchema.safeParse(
      await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...parameters,
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
        }),
      }),
    );
    if (!result.success) throw new GoogleCalendarFailure("invalid_response");
    return result.data;
  }
  async function api(
    path: string,
    accessToken: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    return request(
      `https://www.googleapis.com/calendar/v3/${path}`,
      {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
      signal,
    );
  }
  return {
    token,
    api,
    async identity(accessToken: string) {
      const parsed = z
        .object({
          sub: z.string().min(1).max(256),
          email: z.email().max(254),
          email_verified: z.literal(true),
        })
        .safeParse(
          await request("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
        );
      if (!parsed.success) throw new GoogleCalendarFailure("invalid_response");
      return parsed.data;
    },
    async calendars(accessToken: string, signal?: AbortSignal) {
      const calendars = [];
      let page: string | undefined;
      for (let i = 0; i < 10; i++) {
        const query = new URLSearchParams({ maxResults: "100" });
        if (page) query.set("pageToken", page);
        const result = z
          .object({
            items: z
              .array(
                z.object({
                  id: z.string().min(1).max(256),
                  summary: z.string().min(1).max(200),
                  timeZone: z.string(),
                  accessRole: z.string(),
                  deleted: z.boolean().optional(),
                }),
              )
              .max(100),
            nextPageToken: z.string().max(4096).optional(),
          })
          .safeParse(
            await api(
              `users/me/calendarList?${query}`,
              accessToken,
              {},
              signal,
            ),
          );
        if (!result.success)
          throw new GoogleCalendarFailure("invalid_response");
        for (const c of result.data.items) {
          if (c.deleted || !["writer", "owner"].includes(c.accessRole))
            continue;
          const choice = googleCalendarChoiceSchema.safeParse({
            id: c.id,
            label: c.summary,
            timeZone: c.timeZone,
            accessRole: c.accessRole,
          });
          if (!choice.success)
            throw new GoogleCalendarFailure("invalid_response");
          calendars.push(choice.data);
        }
        page = result.data.nextPageToken;
        if (!page) return calendars;
      }
      throw new GoogleCalendarFailure("invalid_response");
    },
    async revoke(tokenValue: string) {
      try {
        await request("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: tokenValue }),
        });
      } catch (error) {
        if (!(
          error instanceof GoogleCalendarFailure && error.reason === "revoked"
        ))
          throw error;
      }
    },
  };
}
