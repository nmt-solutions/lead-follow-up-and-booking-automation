import { z } from "zod";

export const noticePurposeSchema = z.enum([
  "authentication",
  "invitation",
  "cost_alert",
  "sender_health",
  "handoff",
  "operations",
  "subscription",
]);
export type NoticePurpose = z.infer<typeof noticePurposeSchema>;
export const noticeStateSchema = z.enum([
  "pending",
  "sending",
  "accepted",
  "uncertain",
  "rate_limited",
  "rejected",
  "held",
  "expired",
]);
export type NoticeState = z.infer<typeof noticeStateSchema>;
export const deliveryStageSchema = z.enum([
  "sent",
  "delivery_delayed",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);
export type DeliveryStage = z.infer<typeof deliveryStageSchema>;
const quota = z.object({
  used: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  limit: z.number().int().positive().nullable(),
  resets_at: z.iso.datetime({ offset: true }),
});
export const resendUsageSchema = z.object({
  object: z.literal("usage"),
  emails: z.object({
    daily: quota,
    monthly: quota.extend({ limit: z.number().int().positive() }),
  }),
  rate_limit: z.object({
    limit: z.number().int().positive(),
    duration: z.string().regex(/^\d+(ms|s)$/),
  }),
});
export type ResendUsage = z.infer<typeof resendUsageSchema>;
export const notificationTermsSchema = z
  .strictObject({
    kind: z.enum(["free", "selected_paid"]),
    reference: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .regex(/^[^\u0000-\u001f<>]+$/),
    monthlyLimit: z.number().int().positive().max(1e9),
    dailyLimit: z.number().int().positive().max(1e9).nullable(),
    amount: z
      .strictObject({
        currency: z.enum(["INR", "USD"]),
        micros: z.string().regex(/^\d{1,24}$/),
      })
      .nullable(),
  })
  .refine((v) =>
    v.kind === "free"
      ? v.monthlyLimit <= 3000 &&
        v.dailyLimit !== null &&
        v.dailyLimit <= 100 &&
        v.amount === null
      : v.amount !== null,
  );
export type NotificationTerms = z.infer<typeof notificationTermsSchema>;
export type NotificationConfiguration = {
  account: string;
  mode: "production" | "test_recipient";
  from: string;
  domainId: string;
  apiKey: string;
  readApiKey?: string;
  webhookSecret?: string;
  previousWebhookSecret?: string;
  previousWebhookValidUntil?: string;
  webhookRotatedAt?: string;
  origin: string;
  costFrom?: string;
  costDomainId?: string;
  testRecipient?: string;
};
export const notificationSetupSchema = z.object({
  senders: z
    .array(
      z.object({
        from: z.email(),
        domainId: z.uuid().nullable(),
        domain: z.string(),
        domainStatus: z.string(),
        sendingReady: z.boolean(),
        receivingReady: z.boolean(),
      }),
    )
    .default([]),
  retryAfterSeconds: z.number().int().nonnegative().max(2147483000).default(0),
  sendingReady: z.boolean(),
  receivingReady: z.boolean(),
  domain: z.string(),
  domainStatus: z.string(),
  accountIdentity: z.literal("configured_credential_set"),
  readAccess: z.enum(["verified", "missing", "unavailable"]),
  sendingKey: z.literal("configured"),
  usage: resendUsageSchema.nullable(),
});
export type NotificationSetup = z.infer<typeof notificationSetupSchema>;
export const noticeViewSchema = z.object({
  id: z.uuid(),
  purpose: noticePurposeSchema,
  businessId: z.uuid().nullable(),
  sourceId: z.string(),
  sourceStage: z.string(),
  state: noticeStateSchema,
  stage: deliveryStageSchema.nullable(),
  providerId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  firstAttemptAt: z.string().nullable(),
  retryUntil: z.string().nullable(),
  nextAttemptAt: z.string().nullable(),
  authorityCurrent: z.boolean(),
  reason: z.string(),
  history: z.array(z.object({ kind: z.string(), at: z.string() })),
});
export type NoticeView = z.infer<typeof noticeViewSchema>;
export const notificationWorkspaceSchema = z.object({
  bootstrapAuthOnly: z.boolean(),
  allowedPreferences: z.array(z.enum(["operations", "subscription"])),
  deployment: z.object({
    account: z.boolean(),
    domain: z.boolean(),
    mode: z.boolean(),
    payloadKey: z.boolean(),
    readKey: z.boolean(),
    sendingKey: z.boolean(),
  }),
  account: z.string(),
  mode: z.enum(["production", "test_recipient"]),
  sender: z.string(),
  setup: notificationSetupSchema.nullable(),
  setupCheckedAt: z.string().nullable(),
  setupFresh: z.boolean(),
  terms: notificationTermsSchema.nullable(),
  notices: z.array(noticeViewSchema),
  pendingReservations: z.number(),
  webhookConfigured: z.boolean(),
  recoveryConfigured: z.boolean(),
});
export type NotificationWorkspace = z.infer<typeof notificationWorkspaceSchema>;
export const nativeMailSchema = z.strictObject({
  from: z.email(),
  to: z.tuple([z.email()]),
  subject: z.string().min(1).max(300),
  text: z.string().min(1).max(20000),
});
export type NativeNotificationMail = z.infer<typeof nativeMailSchema>;
export type NoticeDraft = {
  id: string;
  purpose: NoticePurpose;
  sourceId: string;
  businessId: string | null;
  actorId: string | null;
  authority: string;
  payloadHash: string;
  sealed: string;
  key: string;
  sourceStage: string;
};
export const notificationPreferenceSchema = z.strictObject({
  purpose: z.enum(["operations", "subscription"]),
  enabled: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});
export const notificationPreferenceViewSchema = z.object({
  purpose: z.enum(["operations", "subscription"]),
  enabled: z.boolean(),
  version: z.number().int().positive(),
});
export type NoticeWork = { id: string; capability: string };
export type NoticeClaim = NoticeWork & {
  lease: string;
  account: string;
  purpose: NoticePurpose;
  sourceId: string;
  sealed: string;
  now: Date;
  expiresAt: Date;
  key: string;
  keyRef: string;
};
export type NativeResult = { id: string; waitSeconds: number };
export type NotificationProvider = {
  inspect(): Promise<NotificationSetup>;
  send(mail: NativeNotificationMail, key: string): Promise<NativeResult>;
};
