import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import {
  deliveryStageSchema,
  type NotificationConfiguration,
} from "../models/notifications";

const nativeEvent = z.object({
  type: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,256}$/),
    from: z.string().max(320),
    to: z.array(z.email()).length(1),
  }),
});
export type NotificationReceipt = {
  eventId: string;
  providerId: string;
  stage: z.infer<typeof deliveryStageSchema>;
  occurredAt: string;
  rawHash: string;
  recipientDigest: string;
  senderDigest: string;
};
export function verifyNotificationWebhook(
  raw: Buffer,
  headers: Headers,
  config: NotificationConfiguration,
  now: Date,
): NotificationReceipt | null {
  if (raw.byteLength > 65536 || !config.webhookSecret)
    throw new ApplicationError("FORBIDDEN");
  const eventId = headers.get("svix-id"),
    timestamp = headers.get("svix-timestamp"),
    signature = headers.get("svix-signature");
  if (
    !eventId ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(eventId) ||
    !timestamp ||
    !signature
  )
    throw new ApplicationError("FORBIDDEN");
  const secrets = [config.webhookSecret];
  if (
    config.previousWebhookSecret &&
    config.webhookRotatedAt &&
    config.previousWebhookValidUntil
  ) {
    const rotated = Date.parse(config.webhookRotatedAt),
      until = Date.parse(config.previousWebhookValidUntil);
    if (
      rotated <= now.getTime() &&
      until > now.getTime() &&
      until <= rotated + 86400000
    )
      secrets.push(config.previousWebhookSecret);
  }
  let valid = false;
  for (const secret of secrets) {
    try {
      new Webhook(secret).verify(raw, {
        "svix-id": eventId,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      });
      valid = true;
      break;
    } catch {
      /* Try only an explicitly bounded rotation key. */
    }
  }
  if (!valid) throw new ApplicationError("FORBIDDEN");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ApplicationError("INVALID_INPUT");
  }
  const type = z.object({ type: z.string() }).safeParse(value);
  if (!type.success) throw new ApplicationError("INVALID_INPUT");
  const stage = deliveryStageSchema.safeParse(
    type.data.type.replace(/^email\./, ""),
  );
  if (!type.data.type.startsWith("email.") || !stage.success) return null;
  const event = nativeEvent.safeParse(value);
  if (!event.success) throw new ApplicationError("INVALID_INPUT");
  return {
    eventId,
    providerId: event.data.data.email_id,
    stage: stage.data,
    occurredAt: event.data.created_at,
    rawHash: createHash("sha256").update(raw).digest("hex"),
    recipientDigest: createHash("md5")
      .update(event.data.data.to[0].toLowerCase())
      .digest("hex"),
    senderDigest: createHash("md5")
      .update(event.data.data.from.toLowerCase())
      .digest("hex"),
  };
}
