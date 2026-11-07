import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import {
  resendUsageSchema,
  type NotificationConfiguration,
  type NotificationProvider,
  type NoticeState,
} from "../models/notifications";

export class NotificationDeliveryError extends Error {
  constructor(
    readonly state: Extract<
      NoticeState,
      "uncertain" | "rejected" | "rate_limited" | "held"
    >,
    readonly waitSeconds = 60,
  ) {
    super(state);
  }
}
function waitSeconds(headers: Headers) {
  const retry = Number(headers.get("retry-after"));
  const reset = Number(headers.get("ratelimit-reset"));
  return Math.max(
    0,
    Number.isFinite(retry) ? retry : 0,
    headers.get("ratelimit-remaining") === "0" && Number.isFinite(reset)
      ? reset
      : 0,
  );
}
const domainSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.string(),
  capabilities: z.object({
    sending: z.enum(["enabled", "disabled"]),
    receiving: z.enum(["enabled", "disabled"]),
  }),
  records: z.array(
    z.object({ record: z.string(), type: z.string(), status: z.string() }),
  ),
});
export function createResendProvider(
  config: NotificationConfiguration,
  request: typeof fetch = fetch,
): NotificationProvider {
  async function read(path: string): Promise<unknown> {
    if (!config.readApiKey) throw new ApplicationError("SETUP_REQUIRED");
    const r = await request(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${config.readApiKey}` },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!r.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
    return r.json();
  }
  return {
    async inspect() {
      const base = {
        sendingReady: false,
        receivingReady: false,
        domain: config.from.split("@")[1],
        domainStatus: "unknown",
        accountIdentity: "configured_credential_set" as const,
        sendingKey: "configured" as const,
        usage: null,
      };
      if (!config.readApiKey) return { ...base, readAccess: "missing" };
      try {
        // Sequential calls share the team's native rate limit.
        const domain = domainSchema.parse(
          await read(`/domains/${encodeURIComponent(config.domainId)}`),
        );
        const usage = resendUsageSchema.parse(await read("/usage"));
        const sending = domain.records.filter(
          (r) => r.record === "SPF" || r.record === "DKIM",
        );
        const receiving = domain.records.filter(
          (r) => r.record === "Receiving",
        );
        return {
          ...base,
          domain: domain.name,
          domainStatus: domain.status,
          readAccess: "verified",
          usage,
          sendingReady:
            domain.id === config.domainId &&
            domain.name.toLowerCase() === base.domain.toLowerCase() &&
            domain.capabilities.sending === "enabled" &&
            ["verified", "partially_verified"].includes(domain.status) &&
            sending.some((r) => r.record === "SPF") &&
            sending.some((r) => r.record === "DKIM") &&
            sending.every((r) => r.status === "verified"),
          receivingReady:
            domain.capabilities.receiving === "enabled" &&
            receiving.length > 0 &&
            receiving.every((r) => r.status === "verified"),
        };
      } catch {
        return { ...base, readAccess: "unavailable" };
      }
    },
    async send(mail, key) {
      try {
        const r = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(mail),
          signal: AbortSignal.timeout(10000),
        });
        const wait = waitSeconds(r.headers);
        if (!r.ok) {
          const error = z
            .object({ name: z.string() })
            .safeParse(await r.json().catch(() => null));
          const name = error.success ? error.data.name : "unknown";
          if (r.status === 429)
            throw new NotificationDeliveryError(
              "rate_limited",
              Math.max(wait, 1),
            );
          if (r.status === 409 && name === "concurrent_idempotent_requests")
            throw new NotificationDeliveryError("uncertain", Math.max(wait, 5));
          if (r.status === 409) throw new NotificationDeliveryError("held");
          if (r.status >= 500)
            throw new NotificationDeliveryError(
              "uncertain",
              Math.max(wait, 60),
            );
          throw new NotificationDeliveryError("rejected", Math.max(wait, 60));
        }
        const parsed = z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,256}$/) })
          .safeParse(await r.json());
        if (!parsed.success) throw new NotificationDeliveryError("uncertain");
        return { id: parsed.data.id, waitSeconds: wait };
      } catch (error: unknown) {
        if (error instanceof NotificationDeliveryError) throw error;
        throw new NotificationDeliveryError("uncertain");
      }
    },
  };
}
