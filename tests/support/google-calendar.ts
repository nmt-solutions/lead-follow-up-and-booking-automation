import type { GoogleCalendarConfiguration } from "../../src/google-calendar/configuration";
import { googleCalendarScopes } from "../../src/models/google-calendar";

export function googleFixture() {
  const configuration: GoogleCalendarConfiguration = {
    clientId: "fixture-client",
    clientSecret: "fixture-client-secret",
    origin: "http://localhost:3000",
    activeKeyId: "fixture",
    keys: { fixture: "ab".repeat(32) },
  };
  const calls: {
    url: string;
    method: string;
    body: unknown;
    headers: Headers;
  }[] = [];
  const events = new Map<string, Record<string, unknown>>();
  const control = {
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    email: "calendar@example.com",
    scopes: googleCalendarScopes.join(" "),
    accessRole: "owner",
    timeZone: "America/New_York",
    subject: "google-subject",
    tokenError: 0,
    apiError: 0,
    revokeError: 0,
    createError: 0,
    timeoutAfterCreate: false,
    malformed: false,
    conflict: false,
    refreshes: 0,
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    freeBusyErrors: false,
    malformedBusy: false,
    malformedCreate: false,
    nativeOffset: false,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? JSON.parse(init.body)
        : init?.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : null;
    calls.push({ url, method, body, headers: new Headers(init?.headers) });
    const response = (data: unknown, status = 200) =>
      new Response(status === 204 ? null : JSON.stringify(data), { status });
    if (url.endsWith("/token")) {
      if (control.tokenError)
        return response({ error: "invalid_grant" }, control.tokenError);
      if (body?.grant_type === "refresh_token") {
        control.refreshes++;
        await control.beforeRefresh?.();
      }
      return response({
        access_token: control.accessToken,
        refresh_token: control.refreshes
          ? "fixture-refresh-rotated"
          : control.refreshToken,
        expires_in: 3600,
        token_type: "Bearer",
        scope: control.scopes,
      });
    }
    if (url.endsWith("/userinfo"))
      return response({
        sub: control.subject,
        email: control.email,
        email_verified: true,
      });
    if (url.endsWith("/revoke"))
      return control.revokeError
        ? response({ error: "temporarily_unavailable" }, control.revokeError)
        : new Response(null);
    if (control.apiError)
      return response(
        {
          error: {
            errors: [
              {
                reason:
                  control.apiError === 429 ? "rateLimitExceeded" : "forbidden",
              },
            ],
          },
        },
        control.apiError,
      );
    if (control.malformed) return response({ invalid: true });
    if (url.includes("calendarList"))
      return response({
        items: [
          {
            id: "dedicated@example.com",
            summary: "Dedicated booking calendar",
            timeZone: control.timeZone,
            accessRole: control.accessRole,
          },
          {
            id: "readonly@example.com",
            summary: "Read only",
            timeZone: "UTC",
            accessRole: "reader",
          },
        ],
      });
    if (url.endsWith("freeBusy"))
      return response({
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        calendars: {
          [body.items[0].id]: control.freeBusyErrors
            ? { errors: [{ reason: "forbidden" }] }
            : {
                busy: control.malformedBusy
                  ? [{ start: "invalid", end: "invalid" }]
                  : [],
              },
        },
      });
    if (method === "POST" && url.includes("/events?")) {
      if (control.createError)
        return response(
          { error: { errors: [{ reason: "duplicate" }] } },
          control.createError,
        );
      if (events.has(body.id))
        return response({ error: { errors: [{ reason: "duplicate" }] } }, 409);
      const event = {
        ...body,
        status: "confirmed",
        etag: '"revision-1"',
        ...(control.nativeOffset
          ? {
              start: { dateTime: "2026-11-05T09:10:00-05:00" },
              end: { dateTime: "2026-11-05T09:40:00-05:00" },
            }
          : {}),
      };
      events.set(body.id, event);
      if (control.timeoutAfterCreate)
        throw new Error(
          "fixture timeout after acceptance with sensitive payload",
        );
      if (control.malformedCreate)
        return response({
          ...event,
          extendedProperties: { private: { bookingIntent: "{}" } },
        });
      return response(event);
    }
    const eventId = decodeURIComponent(
      new URL(url).pathname.split("/").at(-1)!,
    );
    if (method === "DELETE") {
      const e = events.get(eventId);
      if (!e) return response({}, 404);
      events.set(eventId, { ...e, status: "cancelled", etag: '"revision-2"' });
      return response(null, 204);
    }
    if (url.includes("/events?"))
      return response({
        items: [...events.values()]
          .filter((e) => e.status !== "cancelled")
          .concat(
            control.conflict
              ? [
                  {
                    id: "external",
                    status: "confirmed",
                    start: { dateTime: "2026-11-05T14:10:00Z" },
                    end: { dateTime: "2026-11-05T14:40:00Z" },
                  },
                ]
              : [],
          ),
      });
    if (url.includes("/events/"))
      return events.has(eventId)
        ? response(events.get(eventId))
        : response({}, 404);
    throw new Error("Unexpected Google fixture endpoint");
  };
  return { configuration, calls, events, control, fetch: fetcher };
}
