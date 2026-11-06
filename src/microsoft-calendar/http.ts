import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { z } from "zod";
import type { MicrosoftCalendarConfiguration } from "./configuration";
import { CalendarProviderFailure } from "../appointments/provider";
import {
  microsoftConsumerTenant,
  microsoftCalendarChoiceSchema,
  type MicrosoftIdentity,
} from "../models/microsoft-calendar";

export class MicrosoftCalendarFailure extends CalendarProviderFailure {}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(32768),
  refresh_token: z.string().min(1).max(32768).optional(),
  id_token: z.string().min(1).max(32768).optional(),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.literal("Bearer"),
  scope: z.string().max(8192),
});
export type MicrosoftToken = z.infer<typeof tokenSchema>;
export function parseMicrosoft<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success) throw new MicrosoftCalendarFailure("invalid_response");
  return p.data;
}
export function createMicrosoftHttp(
  configuration: MicrosoftCalendarConfiguration,
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
        cache: "no-store",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(4500)])
          : AbortSignal.timeout(4500),
      });
    } catch {
      throw new MicrosoftCalendarFailure("unavailable");
    }
    let raw: unknown = null;
    try {
      if (response.status !== 204) raw = JSON.parse(await response.text());
    } catch {
      if (response.ok) throw new MicrosoftCalendarFailure("invalid_response");
    }
    if (!response.ok) {
      const e = z
        .object({
          error: z.union([z.string(), z.object({ code: z.string() })]),
        })
        .safeParse(raw);
      const code = e.success
        ? typeof e.data.error === "string"
          ? e.data.error
          : e.data.error.code
        : "";
      throw new MicrosoftCalendarFailure(
        response.status === 429
          ? "rate_limited"
          : response.status === 401 ||
              [
                "invalid_grant",
                "interaction_required",
                "login_required",
              ].includes(code)
            ? "revoked"
            : response.status === 403 ||
                ["consent_required", "invalid_scope"].includes(code)
              ? "insufficient"
              : [409, 412].includes(response.status)
                ? "conflict"
                : [404, 410].includes(response.status)
                  ? "not_found"
                  : "unavailable",
      );
    }
    return raw;
  }
  async function api(
    path: string,
    token: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ) {
    // Paths and continuation URLs are confined to the global Graph API. Never forward a bearer to arbitrary nextLink hosts.
    const url = new URL(path, "https://graph.microsoft.com/v1.0/");
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/") ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new MicrosoftCalendarFailure("invalid_response");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    headers.set("Prefer", 'IdType="ImmutableId", outlook.timezone="UTC"');
    return request(url.toString(), { ...init, headers }, signal);
  }
  async function collection<T>(
    path: string,
    token: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const values: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = path;
    for (let i = 0; next && i < 20; i++) {
      if (seen.has(next))
        throw new MicrosoftCalendarFailure("invalid_response");
      seen.add(next);
      const result: { value: T[]; "@odata.nextLink"?: string } = parseMicrosoft(
        z.object({
          value: z.array(schema).max(1000),
          "@odata.nextLink": z.string().max(8192).optional(),
        }),
        await api(next, token, {}, signal),
      );
      values.push(...result.value);
      next = result["@odata.nextLink"];
    }
    if (next) throw new MicrosoftCalendarFailure("invalid_response");
    return values;
  }
  return {
    api,
    collection,
    async token(parameters: Record<string, string>) {
      return parseMicrosoft(
        tokenSchema,
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
        ),
      );
    },
    async identity(
      token: MicrosoftToken,
      nonce: string,
      now: Date,
    ): Promise<MicrosoftIdentity> {
      try {
        if (!token.id_token) throw new Error();
        const tid = z.uuid().parse(decodeJwt(token.id_token).tid);
        const issuer = `https://login.microsoftonline.com/${tid}/v2.0`;
        const keys = parseMicrosoft(
          z.object({
            keys: z
              .array(
                z.object({
                  kty: z.literal("RSA"),
                  kid: z.string(),
                  n: z.string(),
                  e: z.string(),
                  issuer: z.string(),
                }),
              )
              .min(1)
              .max(100),
          }),
          await request(
            "https://login.microsoftonline.com/common/discovery/v2.0/keys",
            {},
          ),
        );
        const trusted = keys.keys.filter(
          (k) => k.issuer.replace("{tenantid}", tid) === issuer,
        );
        const verified = await jwtVerify(
          token.id_token,
          createLocalJWKSet({ keys: trusted }),
          {
            algorithms: ["RS256"],
            audience: configuration.clientId,
            issuer,
            currentDate: now,
            requiredClaims: ["exp", "iat", "sub", "nonce", "tid"],
          },
        );
        const claims = z
          .object({
            tid: z.literal(tid),
            sub: z.string().min(1).max(256),
            nonce: z.literal(nonce),
            acct: z.number().optional(),
            idp: z.string().optional(),
          })
          .parse(verified.payload);
        if (
          claims.acct === 1 ||
          (claims.idp &&
            ![issuer, `https://sts.windows.net/${tid}/`, "live.com"].includes(
              claims.idp,
            )) ||
          (tid !== microsoftConsumerTenant && claims.idp === "live.com")
        )
          throw new Error();
        const profile = parseMicrosoft(
          z.object({
            id: z.string().min(1),
            mail: z.email().nullable(),
            userPrincipalName: z.string().optional(),
          }),
          await api("me?$select=id,mail,userPrincipalName", token.access_token),
        );
        const email = z
          .email()
          .parse(profile.mail ?? profile.userPrincipalName);
        return {
          subject: claims.sub,
          tenantId: tid,
          email,
          accountKind:
            tid === microsoftConsumerTenant
              ? "microsoft_personal"
              : "microsoft_work",
        };
      } catch (error) {
        if (error instanceof MicrosoftCalendarFailure) throw error;
        throw new MicrosoftCalendarFailure("insufficient");
      }
    },
    async calendars(
      token: string,
      identity: MicrosoftIdentity,
      signal?: AbortSignal,
    ) {
      const native = z.object({
        id: z.string().min(1).max(256),
        name: z.string().min(1).max(200),
        canEdit: z.boolean(),
        canShare: z.boolean(),
        canViewPrivateItems: z.boolean(),
        isSharedWithMe: z.boolean(),
        isDefaultCalendar: z.boolean(),
        owner: z.object({ address: z.email() }),
      });
      const primary = parseMicrosoft(
        native,
        await api("me/calendar", token, {}, signal),
      );
      const all = await collection(
        "me/calendars?$top=100",
        token,
        native,
        signal,
      );
      return all
        .filter(
          (c) =>
            c.canEdit &&
            c.canShare &&
            c.canViewPrivateItems &&
            !c.isSharedWithMe &&
            c.owner.address.toLowerCase() === identity.email.toLowerCase() &&
            (identity.accountKind === "microsoft_personal" ||
              (c.id === primary.id && c.isDefaultCalendar)),
        )
        .map((c) =>
          parseMicrosoft(microsoftCalendarChoiceSchema, {
            id: c.id,
            label: c.name,
            accessRole: "owner",
            primary: c.id === primary.id,
          }),
        );
    },
  };
}
