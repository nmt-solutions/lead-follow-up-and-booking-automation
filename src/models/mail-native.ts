import { z } from "zod";
const headerRef = z
  .string()
  .min(3)
  .max(998)
  .regex(/^<[^<>\s\u0000-\u001f\u007f]+>$/);
export const mailNativeSchema = z.strictObject({
  direction: z.enum(["incoming", "manual_reply"]),
  internetMessageId: headerRef,
  inReplyTo: headerRef.nullable(),
  from: z.email().max(254),
  to: z.array(z.email().max(254)).min(1).max(50),
});
export type MailNative = z.infer<typeof mailNativeSchema>;
export const mailManualSchema = z.strictObject({
  kind: z.literal("manual_reply"),
  eventId: z.string().min(1).max(256),
  messageRef: z.string().min(1).max(256),
  conversationRef: z.string().min(1).max(256),
  subject: z.string().min(1).max(500),
  text: z
    .string()
    .min(1)
    .max(20000)
    .refine((v) => !v.includes("\0")),
  occurredAt: z.iso.datetime({ offset: true }),
  native: mailNativeSchema,
});
export type MailManual = z.infer<typeof mailManualSchema>;
/** Trusted transport receipt, never accepted from mailbox headers or a public event endpoint. */
export const mailAppMessageSchema = z.strictObject({
  mailboxId: z.uuid(),
  messageRef: z.string().min(1).max(256),
  internetMessageId: headerRef,
  replyToMessageId: z.uuid(),
});
