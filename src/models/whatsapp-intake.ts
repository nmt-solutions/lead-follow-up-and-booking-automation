import { z } from "zod";
const metaIdSchema = z.string().regex(/^\d{5,30}$/);

const ref = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const phone = z.string().regex(/^\d{6,20}$/);
export const metaActivitySchema = z.object({
  kind: z.enum(["incoming", "app_echo", "status", "gap"]),
  key: ref,
  messageRef: ref.nullable(),
  peer: phone.nullable(),
  from: z.string().max(80).nullable(),
  name: z.string().max(200).nullable(),
  text: z.string().max(20000).nullable(),
  replyTo: ref.nullable(),
  occurredAt: z.iso.datetime(),
  status: z.string().max(80).nullable(),
});
export type MetaActivity = z.infer<typeof metaActivitySchema>;
export const enableMetaIntakeSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  receiptRetentionSeconds: z.number().int().min(60).max(2147483647),
});
export const metaIntakeViewSchema = z.object({
  enabled: z.boolean(),
  inboundObserved: z.boolean(),
  manualObserved: z.boolean(),
  replyVisibility: z.enum(["unverified", "supported_app_events", "gap"]),
  gap: z.string().nullable(),
  pending: z.number(),
  inboxConnectionId: z.uuid().nullable(),
  receiptRetentionSeconds: z.number().nullable(),
  receipts: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      messageRef: z.string().nullable(),
      state: z.string(),
      at: z.iso.datetime(),
      status: z.string().nullable(),
    }),
  ),
});
export type MetaIntakeView = z.infer<typeof metaIntakeViewSchema>;

const message = z.object({
  id: ref,
  from: phone,
  to: phone.optional(),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(80),
  text: z.object({ body: z.string().min(1).max(20000) }).optional(),
  context: z.object({ id: ref }).optional(),
});
export const metaWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        id: metaIdSchema,
        changes: z
          .array(
            z.object({
              field: z.string().min(1).max(100),
              value: z
                .object({
                  messaging_product: z.literal("whatsapp"),
                  metadata: z.object({
                    phone_number_id: metaIdSchema,
                    display_phone_number: z.string().max(80).optional(),
                  }),
                  contacts: z
                    .array(
                      z.object({
                        wa_id: phone,
                        profile: z.object({ name: z.string().min(1).max(200) }),
                      }),
                    )
                    .max(100)
                    .optional(),
                  messages: z.array(message).max(100).optional(),
                  message_echoes: z.array(message).max(100).optional(),
                  statuses: z
                    .array(
                      z.object({
                        id: ref,
                        status: z.string().min(1).max(80),
                        timestamp: z.string().regex(/^\d{1,12}$/),
                        recipient_id: phone,
                      }),
                    )
                    .max(100)
                    .optional(),
                })
                .passthrough(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .min(1)
    .max(100),
});
