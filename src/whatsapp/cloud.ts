import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../models/business";
import {
  metaIdSchema,
  type WhatsAppSetup,
  type MetaObservation,
} from "../models/whatsapp";
import type { MetaConfiguration } from "./configuration";
import { MetaFailure, type MetaProvider } from "./provider";

const account = z.object({
  id: metaIdSchema,
  business_verification_status: z.string().optional(),
  account_review_status: z.string().optional(),
});
const phone = z.object({
  id: metaIdSchema,
  display_phone_number: z.string().max(80),
  code_verification_status: z.string().optional(),
  status: z.string().optional(),
  account_mode: z.string().optional(),
  is_on_biz_app: z.boolean().optional(),
});
const debug = z.object({
  data: z.object({
    app_id: metaIdSchema,
    is_valid: z.boolean(),
    scopes: z.array(z.string()).optional(),
    expires_at: z.number().nonnegative().optional(),
    data_access_expires_at: z.number().nonnegative().optional(),
  }),
});
const permissions = [
  "business_management",
  "whatsapp_business_management",
  "whatsapp_business_messaging",
];
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MetaFailure("invalid_response");
  return parsed.data;
}
/** Direct Graph API only. No BSP, credit sharing, message send, automatic registration or webhook activation. */
export function createMetaCloudProvider(
  config: MetaConfiguration,
  setup: WhatsAppSetup,
  fetcher: typeof fetch,
  clock: Clock,
): MetaProvider {
  async function request(
    path: string,
    token: string,
    signal: AbortSignal,
    parameters: Record<string, string> = {},
    body?: unknown,
  ): Promise<unknown> {
    const url = new URL(
      `https://graph.facebook.com/${config.graphVersion}/${path}`,
    );
    for (const [k, v] of Object.entries(parameters)) url.searchParams.set(k, v);
    if (token)
      url.searchParams.set(
        "appsecret_proof",
        createHmac("sha256", config.appSecret).update(token).digest("hex"),
      );
    let response: Response;
    try {
      response = await fetcher(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        signal,
        redirect: "error",
      });
    } catch {
      throw new MetaFailure("provider_unavailable");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new MetaFailure("invalid_response");
    }
    const error = z
      .object({ error: z.object({ code: z.number() }) })
      .safeParse(value);
    if (!response.ok || error.success) {
      const code = error.success ? error.data.error.code : null;
      throw new MetaFailure(
        response.status === 401 || code === 190
          ? "revoked"
          : response.status === 403 || code === 10 || code === 200
            ? "insufficient_permissions"
            : "provider_unavailable",
      );
    }
    return value;
  }
  async function find<T extends { id: string }>(
    path: string,
    fields: string,
    id: string,
    schema: z.ZodType<T>,
    token: string,
    signal: AbortSignal,
  ) {
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = validate(
        z.object({
          data: z.array(schema).max(100),
          paging: z
            .object({
              cursors: z
                .object({ after: z.string().max(1024).optional() })
                .optional(),
              next: z.string().optional(),
            })
            .optional(),
        }),
        await request(path, token, signal, {
          fields,
          limit: "100",
          ...(after ? { after } : {}),
        }),
      );
      const match = response.data.find((row) => row.id === id);
      if (match) return match;
      if (!response.paging?.next) return null;
      const next = response.paging.cursors?.after;
      if (!next || next === after) throw new MetaFailure("invalid_response");
      after = next;
    }
    throw new MetaFailure("invalid_response");
  }
  return {
    key: `direct-meta:${config.appId}:${config.configId}:${config.graphVersion}`,
    setup,
    login: {
      appId: config.appId,
      configId: config.configId,
      graphVersion: config.graphVersion,
    },
    async subscribe(token, assets, signal) {
      validate(
        z.object({ success: z.literal(true) }),
        await request(
          `${assets.wabaId}/subscribed_apps`,
          token.accessToken,
          signal,
          {},
          {},
        ),
      );
    },
    async exchange(code, signal) {
      const value = validate(
        z.object({
          access_token: z.string().min(1).max(16384),
          expires_in: z.number().int().positive().optional(),
        }),
        await request(
          "oauth/access_token",
          `${config.appId}|${config.appSecret}`,
          signal,
          {
            client_id: config.appId,
            client_secret: config.appSecret,
            redirect_uri: "",
            code,
          },
        ),
      );
      return {
        accessToken: value.access_token,
        expiresAt: value.expires_in
          ? new Date(
              clock.now().getTime() + value.expires_in * 1000,
            ).toISOString()
          : null,
      };
    },
    async inspect(token, assets, configuration, coexistenceFinished, signal) {
      const proof = validate(
        debug,
        await request(
          "debug_token",
          `${config.appId}|${config.appSecret}`,
          signal,
          { input_token: token.accessToken },
        ),
      ).data;
      if (
        !proof.is_valid ||
        proof.app_id !== config.appId ||
        [proof.expires_at, proof.data_access_expires_at].some(
          (t) => t !== undefined && t > 0 && t * 1000 <= clock.now().getTime(),
        )
      )
        throw new MetaFailure("revoked");
      if (!permissions.every((p) => proof.scopes?.includes(p)))
        throw new MetaFailure("insufficient_permissions");
      // A browser completion is an asset hint, never evidence of ownership or number membership.
      const owned = await find(
        `${assets.portfolioId}/owned_whatsapp_business_accounts`,
        "id,business_verification_status,account_review_status",
        assets.wabaId,
        account,
        token.accessToken,
        signal,
      );
      if (!owned || assets.portfolioId !== configuration.portfolioId)
        throw new MetaFailure("insufficient_permissions");
      const number = await find(
        `${assets.wabaId}/phone_numbers`,
        "id,display_phone_number,code_verification_status,status,account_mode,is_on_biz_app",
        assets.phoneNumberId,
        phone,
        token.accessToken,
        signal,
      );
      if (
        !number ||
        number.display_phone_number.replace(/\D/g, "") !==
          configuration.requestedNumber.slice(1)
      )
        throw new MetaFailure("insufficient_permissions");
      const bizApp = configuration.numberSource === "business_app";
      const coexistence = bizApp
        ? setup.coexistence &&
          coexistenceFinished &&
          number.is_on_biz_app === true
          ? "confirmed"
          : "unsupported"
        : number.is_on_biz_app === false
          ? "confirmed"
          : "unknown";
      const checks: MetaObservation["checks"] = {
        customer_ownership: "confirmed",
        permissions: "confirmed",
        business_verification:
          owned.business_verification_status?.toUpperCase() === "VERIFIED"
            ? "confirmed"
            : owned.business_verification_status
              ? "missing"
              : "unknown",
        account_review:
          owned.account_review_status === "APPROVED"
            ? "confirmed"
            : owned.account_review_status
              ? "missing"
              : "unknown",
        number_verified:
          number.code_verification_status === "VERIFIED"
            ? "confirmed"
            : number.code_verification_status
              ? "missing"
              : "unknown",
        number_registered:
          number.status === "CONNECTED" && number.account_mode === "LIVE"
            ? "confirmed"
            : ["UNREGISTERED", "DISCONNECTED", "PENDING"].includes(
                  number.status ?? "",
                )
              ? "missing"
              : "unknown",
        // Neither a valid token, message health nor a customer declaration proves who Meta bills.
        // Keep the direct-payment prerequisite explicit until account-specific evidence is available.
        customer_payment_method: "unknown",
        coexistence,
      };
      const deadlines = [
        clock.now().getTime() + 5 * 60000,
        ...[proof.expires_at, proof.data_access_expires_at]
          .filter((t): t is number => Boolean(t))
          .map((t) => t * 1000),
        ...(token.expiresAt ? [new Date(token.expiresAt).getTime()] : []),
      ];
      return {
        ...assets,
        displayNumber: number.display_phone_number,
        checks,
        observedAt: clock.now().toISOString(),
        validUntil: new Date(Math.min(...deadlines)).toISOString(),
      };
    },
    async register(token, assets, pin, signal) {
      const value = await request(
        `${assets.phoneNumberId}/register`,
        token.accessToken,
        signal,
        {},
        { messaging_product: "whatsapp", pin },
      );
      validate(z.object({ success: z.literal(true) }), value);
    },
  };
}
