import { z } from "zod";

const text = z.string().trim().min(1).max(2000);
const evidence = z.array(text).min(1).max(20);
/** Deployment evidence is separate from the current, attributed application validation. */
export const upiPathSchema = z.strictObject({
  id: z.string().min(1).max(100),
  enabled: z.boolean(),
  merchantCategoryCode: z.string().regex(/^\d{4}$/),
  currency: z.literal("INR"),
  method: z.literal("upi"),
  schedule: z.literal("utc_calendar_month"),
  minimumMinor: z.string().regex(/^[1-9]\d{0,14}$/),
  maximumMinor: z.string().regex(/^[1-9]\d{0,14}$/),
  supportedApps: z.array(text).min(1).max(50),
  supportedHandles: z
    .array(z.string().regex(/^[a-z0-9]+$/))
    .min(1)
    .max(100),
  accountSupport: evidence,
  sandbox: z.strictObject({
    kind: z.enum(["deterministic_fixture", "native_sandbox"]),
    mode: z.literal("test"),
    account: z.string().regex(/^acc_[A-Za-z0-9]+$/),
    checkedAt: z.iso.datetime(),
    references: evidence,
    native: z
      .strictObject({
        subscriptionId: z.string().regex(/^sub_[A-Za-z0-9]+$/),
        planId: z.string().regex(/^plan_[A-Za-z0-9]+$/),
        customerId: z.string().regex(/^cust_[A-Za-z0-9]+$/),
        failedPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        authorizationPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        initialPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        renewalPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
        amountMinor: z.string().regex(/^[1-9]\d{0,14}$/),
      })
      .optional(),
  }),
  terms: text,
  mappings: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        businessId: z.uuid(),
        originalAccount: text,
        originalCustomerId: z.string().regex(/^cust_[A-Za-z0-9]+$/),
        customerId: z.string().regex(/^cust_[A-Za-z0-9]+$/),
        evidence,
      }),
    )
    .max(1000),
});
export const upiAgreementSchema = z.strictObject({
  pathId: z.string(),
  mappingId: z.string(),
  businessId: z.uuid(),
  originalAccount: z.string(),
  originalCustomerId: z.string(),
  account: z.string(),
  mode: z.enum(["test", "live"]),
  method: z.literal("upi"),
  customerId: z.string(),
  supportedApps: z.array(text).min(1),
  supportedHandles: z.array(text).min(1),
  terms: z.string(),
});
export type UpiAgreement = z.infer<typeof upiAgreementSchema>;
