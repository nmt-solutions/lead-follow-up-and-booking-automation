import { z } from "zod";

export const metaIdSchema = z.string().regex(/^[0-9]{1,40}$/);
export const whatsAppConfigurationSchema = z.strictObject({
  portfolioId: metaIdSchema,
  numberSource: z.enum(["existing_cloud", "business_app", "assisted_new"]),
  requestedNumber: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  provisioningTerms: z.string().trim().min(30).max(2000),
  customerControlsAssets: z.literal(true),
  customerPaysMeta: z.literal(true),
  termsVersion: z.literal("direct_meta_v1"),
});
export type WhatsAppConfiguration = z.infer<typeof whatsAppConfigurationSchema>;
export const whatsAppStatusSchema = z.enum([
  "setup_required",
  "connecting",
  "verifying",
  "connected",
  "reconnect_required",
  "disconnected",
]);
export type WhatsAppStatus = z.infer<typeof whatsAppStatusSchema>;
export const metaAssetsSchema = z.strictObject({
  portfolioId: metaIdSchema,
  wabaId: metaIdSchema,
  phoneNumberId: metaIdSchema,
});
export type MetaAssets = z.infer<typeof metaAssetsSchema>;
export const metaTokenSchema = z.strictObject({
  accessToken: z.string().min(1).max(16384),
  expiresAt: z.iso.datetime().nullable(),
});
export type MetaToken = z.infer<typeof metaTokenSchema>;
export const metaCompletionSchema = z.strictObject({
  state: z.string().regex(/^[a-f0-9]{64}$/),
  event: z.enum([
    "FINISH",
    "FINISH_ONLY_WABA",
    "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    "CANCEL",
    "ERROR",
  ]),
  code: z.string().min(1).max(4096).optional(),
  assets: metaAssetsSchema.optional(),
});
export type MetaCompletion = z.infer<typeof metaCompletionSchema>;
export const metaCheckNames = [
  "customer_ownership",
  "business_verification",
  "account_review",
  "number_verified",
  "number_registered",
  "permissions",
  "customer_payment_method",
  "coexistence",
] as const;
export const metaCheckSchema = z.enum([
  "confirmed",
  "missing",
  "unknown",
  "unsupported",
]);
export const metaObservationSchema = z.strictObject({
  portfolioId: metaIdSchema,
  wabaId: metaIdSchema,
  phoneNumberId: metaIdSchema,
  displayNumber: z.string().max(80),
  checks: z.strictObject({
    customer_ownership: metaCheckSchema,
    business_verification: metaCheckSchema,
    account_review: metaCheckSchema,
    number_verified: metaCheckSchema,
    number_registered: metaCheckSchema,
    permissions: metaCheckSchema,
    customer_payment_method: metaCheckSchema,
    coexistence: metaCheckSchema,
  }),
  observedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type MetaObservation = z.infer<typeof metaObservationSchema>;
export const whatsAppReasonSchema = z.enum([
  "consent_cancelled",
  "consent_failed",
  "incomplete_setup",
  "provider_unavailable",
  "invalid_response",
  "revoked",
  "insufficient_permissions",
  "unsupported_coexistence",
  "exchange_uncertain",
  "registration_uncertain",
]);
export type WhatsAppReason = z.infer<typeof whatsAppReasonSchema>;
export const whatsAppSetupSchema = z.strictObject({
  configured: z.boolean(),
  techProvider: z.boolean(),
  businessVerification: z.boolean(),
  appReview: z.boolean(),
  liveApp: z.boolean(),
  secureConfiguration: z.boolean(),
  coexistence: z.boolean(),
});
export type WhatsAppSetup = z.infer<typeof whatsAppSetupSchema>;
export const whatsAppBilling = {
  payer: "customer",
  provider: "meta",
  includedInSubscription: false,
  includedInOperatorSpend: false,
  platformCreditLine: false,
  disclosure:
    "Your Business pays Meta directly using its own payment method. Meta messaging charges are separate from our automation subscription and allowances, and excluded from operator-paid spend. No prepaid Meta credit or paid BSP is included. Review current rates and billing in WhatsApp Manager.",
} as const;
export const whatsAppViewSchema = z.object({
  canManage: z.boolean(),
  setup: whatsAppSetupSchema,
  connection: z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      configuration: whatsAppConfigurationSchema,
      status: whatsAppStatusSchema,
      reason: whatsAppReasonSchema.nullable(),
      termsAcceptedAt: z.iso.datetime(),
      observation: metaObservationSchema.nullable(),
    })
    .nullable(),
  readiness: z.object({
    onboardingReady: z.boolean(),
    automationReady: z.literal(false),
    issues: z.array(z.string()),
  }),
  billing: z.object({
    payer: z.literal("customer"),
    provider: z.literal("meta"),
    includedInSubscription: z.literal(false),
    includedInOperatorSpend: z.literal(false),
    platformCreditLine: z.literal(false),
    disclosure: z.string(),
  }),
});
export type WhatsAppView = z.infer<typeof whatsAppViewSchema>;
