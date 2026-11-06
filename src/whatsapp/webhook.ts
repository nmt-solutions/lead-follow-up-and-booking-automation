import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../models/application-error";
import {
  metaWebhookSchema,
  type MetaActivity,
} from "../models/whatsapp-intake";

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
        add({
          ...base,
          kind:
            m.type === "text" && m.text && (!echo || m.to)
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
