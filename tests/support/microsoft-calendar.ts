import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { MicrosoftCalendarConfiguration } from "../../src/microsoft-calendar/configuration";
import {
  microsoftCalendarScopes,
  microsoftConsumerTenant,
} from "../../src/models/microsoft-calendar";

const signing = generateKeyPair("RS256");
import type { Clock } from "../../src/models/business";

export function microsoftFixture(clock: Clock) {
  const configuration: MicrosoftCalendarConfiguration = {
    clientId: "fixture-client",
    clientSecret: "fixture-client-secret",
    origin: "http://localhost:3000",
    activeKeyId: "fixture",
    keys: { fixture: "ab".repeat(32) },
  };
  const calls: {
    url: string;
    method: string;
    body: Record<string, unknown> | null;
    headers: Headers;
  }[] = [];
  const events = new Map<string, Record<string, unknown>>();
  const control = {
    nonce: "",
    tenant: microsoftConsumerTenant,
    subject: "microsoft-subject",
    email: "calendar@outlook.com",
    acct: 0,
    scopes: microsoftCalendarScopes.join(" "),
    canEdit: true,
    shared: false,
    tokenError: 0,
    apiError: 0,
    createError: 0,
    timeoutAfterCreate: false,
    malformed: false,
    conflict: false,
    refreshes: 0,
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    busy: [] as Record<string, unknown>[],
    secondPage: [] as Record<string, unknown>[],
    badNextLink: false,
    malformedCreate: false,
    badSignature: false,
    badIssuer: false,
    wrongNonce: false,
    expiredIdentity: false,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET";
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
      const { privateKey } = await signing;
      const issuer = `https://login.microsoftonline.com/${control.tenant}/v2.0`;
      const idToken = await new SignJWT({
        tid: control.tenant,
        nonce: control.wrongNonce ? "wrong" : control.nonce,
        acct: control.acct,
      })
        .setProtectedHeader({
          alg: "RS256",
          kid: control.badSignature ? "unknown" : "fixture",
        })
        .setIssuer(control.badIssuer ? "https://evil.example" : issuer)
        .setAudience(configuration.clientId)
        .setSubject(control.subject)
        .setIssuedAt(Math.floor(clock.now().getTime() / 1000))
        .setExpirationTime(
          Math.floor(clock.now().getTime() / 1000) +
            (control.expiredIdentity ? -1 : 3600),
        )
        .sign(privateKey);
      return response({
        access_token: "fixture-access",
        refresh_token: control.refreshes
          ? "fixture-refresh-rotated"
          : "fixture-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: control.scopes,
        id_token: idToken,
      });
    }
    if (url.endsWith("/keys"))
      return response({
        keys: [
          {
            ...(await exportJWK((await signing).publicKey)),
            kid: "fixture",
            issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
          },
        ],
      });
    if (control.apiError)
      return response(
        {
          error: {
            code: "ErrorAccessDenied",
            message: "secret provider details",
          },
        },
        control.apiError,
      );
    if (control.malformed) return response({ invalid: true });
    if (url.includes("/me?"))
      return response({
        id: "profile-id",
        mail: control.email,
        userPrincipalName: control.email,
      });
    const calendar = (id: string) => ({
      id,
      name: `Booking ${id}`,
      canEdit: control.canEdit,
      canShare: !control.shared,
      canViewPrivateItems: true,
      isSharedWithMe: control.shared,
      isDefaultCalendar: id === "primary",
      owner: {
        address: control.shared ? "someone@example.net" : control.email,
      },
    });
    if (url.endsWith("/me/calendar")) return response(calendar("primary"));
    if (url.includes("/me/calendars?"))
      return response({ value: [calendar("primary"), calendar("secondary")] });
    if (url.endsWith("/getSchedule"))
      return response({
        value: [
          {
            scheduleId: control.email,
            scheduleItems: control.busy.map((e) => ({
              status: e.showAs,
              start: e.start,
              end: e.end,
            })),
          },
        ],
      });
    const external = {
      id: "external",
      isCancelled: false,
      showAs: "busy",
      type: "singleInstance",
      start: { dateTime: "2026-11-05T14:10:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-05T14:40:00.0000000", timeZone: "UTC" },
    };
    if (url.includes("/calendarView?"))
      return response({
        value: [
          ...events.values(),
          ...control.busy,
          ...(control.conflict ? [external] : []),
        ],
        ...(control.badNextLink
          ? { "@odata.nextLink": "https://evil.example/steal" }
          : control.secondPage.length
            ? {
                "@odata.nextLink":
                  "https://graph.microsoft.com/v1.0/me/calendars/primary/calendarView/next",
              }
            : {}),
      });
    if (url.endsWith("/calendarView/next"))
      return response({ value: control.secondPage });
    if (method === "POST" && url.endsWith("/events")) {
      if (control.createError)
        return response(
          { error: { code: "ErrorConflict" } },
          control.createError,
        );
      const original = [...events.values()].find(
        (e) => e.transactionId === body.transactionId,
      );
      if (original) return response(original, 201);
      const id = `immutable-${events.size + 1}`;
      const event = {
        ...body,
        id,
        "@odata.etag": '"revision-1"',
        isCancelled: false,
        type: "singleInstance",
        ...(control.malformedCreate
          ? { singleValueExtendedProperties: [] }
          : {}),
      };
      events.set(id, event);
      if (control.timeoutAfterCreate)
        throw new Error("timeout after acceptance secret");
      return response(
        { ...event, singleValueExtendedProperties: undefined },
        201,
      );
    }
    const id = decodeURIComponent(new URL(url).pathname.split("/").at(-1)!);
    if (method === "DELETE") {
      if (!events.has(id)) return response({}, 404);
      events.delete(id);
      return response(null, 204);
    }
    if (url.includes("/events/"))
      return events.has(id) ? response(events.get(id)) : response({}, 404);
    if (url.includes("/events?"))
      return response({ value: [...events.values()] });
    throw new Error("Unexpected Microsoft fixture endpoint");
  };
  return { configuration, calls, events, control, fetch: fetcher };
}
