import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../models/application-error";
import {
  metaWebhookSchema,
  type MetaActivity,
} from "../models/whatsapp-intake";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const knownKeys = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export function verifyMetaSignature(
  raw: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature))
    throw new ApplicationError("UNAUTHENTICATED");
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex")))
    throw new ApplicationError("UNAUTHENTICATED");
}
/** Validate after authenticating the exact bytes. Never trust a payload Business ID or a contact name as identity. */
export function metaActivities(raw: Uint8Array, at: Date) {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ApplicationError("INVALID_INPUT");
  }
  const parsed = metaWebhookSchema.safeParse(json);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  const result: {
    wabaId: string;
    phoneNumberId: string;
    activity: MetaActivity;
  }[] = [];
  for (const entry of parsed.data.entry)
    for (const change of entry.changes) {
      const v = change.value;
      const add = (activity: MetaActivity) =>
        result.push({
          wabaId: entry.id,
          phoneNumberId: v.metadata.phone_number_id,
          activity,
        });
      const base = {
        messageRef: null,
        peer: null,
        from: null,
        name: null,
        text: null,
        replyTo: null,
        status: null,
      };
      let supported = false;
      for (const m of change.field === "messages"
        ? (v.messages ?? [])
        : change.field === "smb_message_echoes"
          ? (v.message_echoes ?? [])
          : []) {
        supported = true;
        const occurred = new Date(Number(m.timestamp) * 1000);
        if (!Number.isFinite(occurred.getTime()) || occurred > at)
          throw new ApplicationError("INVALID_INPUT");
        const echo = change.field === "smb_message_echoes";
        const knownOrigin =
          !echo ||
          (knownKeys(m, [
            "id",
            "from",
            "to",
            "timestamp",
            "type",
            "text",
            "context",
          ]) &&
            (!m.text || knownKeys(m.text, ["body"])) &&
            (!m.context || knownKeys(m.context, ["id"])) &&
            knownKeys(v, [
              "messaging_product",
              "metadata",
              "contacts",
              "message_echoes",
            ]) &&
            knownKeys(v.metadata, ["phone_number_id", "display_phone_number"]));
        add({
          ...base,
          kind:
            m.type === "text" && m.text && (!echo || m.to) && knownOrigin
              ? echo
                ? "app_echo"
                : "incoming"
              : "gap",
          key: `${change.field}:${createHash("sha256").update(m.id).digest("hex")}`,
          messageRef: m.id,
          peer: echo ? (m.to ?? null) : m.from,
          from: m.from,
          name:
            v.contacts?.find((c) => c.wa_id === m.from)?.profile.name ?? null,
          text: m.type === "text" ? (m.text?.body ?? null) : null,
          replyTo: m.context?.id ?? null,
          occurredAt: occurred.toISOString(),
          providerFingerprint: createHash("sha256")
            .update(
              JSON.stringify(
                canonical({
                  message: m,
                  metadata: v.metadata,
                  extra: Object.fromEntries(
                    Object.entries(v).filter(
                      ([key]) =>
                        ![
                          "messages",
                          "message_echoes",
                          "statuses",
                          "contacts",
                          "metadata",
                          "messaging_product",
                        ].includes(key),
                    ),
                  ),
                }),
              ),
            )
            .digest("hex"),
        });
      }
      for (const s of change.field === "messages" ? (v.statuses ?? []) : []) {
        supported = true;
        const occurred = new Date(Number(s.timestamp) * 1000);
        if (!Number.isFinite(occurred.getTime()) || occurred > at)
          throw new ApplicationError("INVALID_INPUT");
        add({
          ...base,
          kind: "status",
          key: `status:${createHash("sha256").update(`${s.id}:${s.status}:${s.timestamp}`).digest("hex")}`,
          messageRef: s.id,
          peer: s.recipient_id,
          occurredAt: occurred.toISOString(),
          status: s.status,
          statusEvidence: {
            callbackData: s.biz_opaque_callback_data ?? null,
            occurredAt: occurred.toISOString(),
            supported:
              knownKeys(s, [
                "id",
                "status",
                "timestamp",
                "recipient_id",
                "biz_opaque_callback_data",
                "pricing",
                "conversation",
                "errors",
              ]) && ["sent", "delivered", "read", "failed"].includes(s.status),
            pricing: s.pricing
              ? {
                  ...(s.pricing.billable !== undefined
                    ? { billable: s.pricing.billable }
                    : {}),
                  ...(s.pricing.pricing_model
                    ? { pricing_model: s.pricing.pricing_model }
                    : {}),
                  ...(s.pricing.category
                    ? { category: s.pricing.category }
                    : {}),
                  ...(s.pricing.type ? { type: s.pricing.type } : {}),
                }
              : null,
          },
          providerFingerprint: createHash("sha256")
            .update(JSON.stringify(canonical(s)))
            .digest("hex"),
        });
      }
      if (!supported)
        add({
          ...base,
          kind: "gap",
          key: `gap:${createHash("sha256").update(JSON.stringify(change)).digest("hex")}`,
          occurredAt: at.toISOString(),
          status: "unsupported_event",
        });
    }
  if (result.length > 500) throw new ApplicationError("INVALID_INPUT");
  return result;
}
