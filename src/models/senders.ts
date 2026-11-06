import { z } from "zod";

const text = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f<>]+$/);
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const senderUseSchema = z.enum([
  "first_contact",
  "trial",
  "inbound",
  "existing_conversation",
]);
export type SenderUse = z.infer<typeof senderUseSchema>;
export const senderConnectionSchema = z.strictObject({
  label: text,
  provider: z.enum([
    "gmail",
    "microsoft",
    "customer_domain",
    "service_provided",
  ]),
  account: email,
  enabled: z.boolean(),
});
export const replyRouteSchema = z.strictObject({
  address: email,
  connectionId: z.uuid(),
  inboxConnectionId: z.uuid(),
  enabled: z.boolean(),
});
export const senderIdentitySchema = z.strictObject({
  origin: z.enum(["customer_mailbox", "customer_domain", "service_provided"]),
  purpose: z.enum(["dedicated_outreach", "ordinary_sales"]),
  fromAddress: email,
  displayName: text,
  uses: z
    .array(senderUseSchema)
    .min(1)
    .max(4)
    .refine((v) => new Set(v).size === v.length),
  connectionId: z.uuid().nullable(),
  replyRouteId: z.uuid().nullable(),
  enabled: z.boolean(),
});
export const senderVersionSchema = z.number().int().min(0).max(2147483646);
export function senderSaveSchema<T extends z.ZodType>(configuration: T) {
  return z
    .strictObject({
      id: z.uuid().nullable(),
      expectedVersion: senderVersionSchema,
      configuration,
    })
    .refine((value) => value.id !== null || value.expectedVersion === 0);
}
export type SenderConnectionConfiguration = z.infer<
  typeof senderConnectionSchema
>;
export type ReplyRouteConfiguration = z.infer<typeof replyRouteSchema>;
export type SenderIdentityConfiguration = z.infer<typeof senderIdentitySchema>;
export type SenderRecord<T> = { id: string; version: number; configuration: T };
export type SenderConnection = SenderRecord<SenderConnectionConfiguration>;
export type ReplyRoute = SenderRecord<ReplyRouteConfiguration>;
export const senderCheckNames = [
  "identity_control",
  "domain_verification",
  "spf",
  "dkim",
  "dmarc_alignment",
  "sending_grant",
  "delivery_transport",
  "reply_reading_grant",
  "inbox_sync",
  "reply_capture",
  "health",
] as const;
export const senderCheckSchema = z.enum([
  "pass",
  "missing",
  "unknown",
  "failed",
  "revoked",
  "insufficient",
  "unavailable",
  "authentication_failed",
  "bounces",
  "complaints",
]);
export type SenderCheck = z.infer<typeof senderCheckSchema>;
export const senderChecksSchema = z.strictObject({
  identity_control: senderCheckSchema,
  domain_verification: senderCheckSchema,
  spf: senderCheckSchema,
  dkim: senderCheckSchema,
  dmarc_alignment: senderCheckSchema,
  sending_grant: senderCheckSchema,
  delivery_transport: senderCheckSchema,
  reply_reading_grant: senderCheckSchema,
  inbox_sync: senderCheckSchema,
  reply_capture: senderCheckSchema,
  health: senderCheckSchema,
});
export const senderBindingSchema = z.strictObject({
  businessId: z.uuid(),
  identityId: z.uuid(),
  identityVersion: senderVersionSchema,
  connectionId: z.uuid().nullable(),
  connectionVersion: senderVersionSchema.nullable(),
  replyRouteId: z.uuid().nullable(),
  replyRouteVersion: senderVersionSchema.nullable(),
  replyConnectionId: z.uuid().nullable(),
  replyConnectionVersion: senderVersionSchema.nullable(),
});
export const senderObservationSchema = z.strictObject({
  binding: senderBindingSchema,
  observedAt: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
  verificationReference: z
    .url()
    .max(2000)
    .regex(/^https:\/\//)
    .optional(),
  checks: senderChecksSchema,
  approvedUses: z
    .array(senderUseSchema)
    .max(4)
    .refine((v) => new Set(v).size === v.length),
});
export type SenderObservation = z.infer<typeof senderObservationSchema>;
export type SenderBinding = SenderObservation["binding"];
export type SenderInspection = {
  healthProof?: { observedAt: string; validUntil: string } | null;
  requestedAt: string;
  previousEvidenceId: string | null;
  binding: SenderBinding;
  identity: SenderIdentityConfiguration;
  connection: SenderConnection | null;
  replyRoute: ReplyRoute | null;
  replyConnection: SenderConnection | null;
  nativeGmail?: { send: boolean; reply: boolean };
};
export function sameSenderBinding(a: SenderBinding, b: SenderBinding) {
  return Object.entries(a).every(
    ([key, value]) => Reflect.get(b, key) === value,
  );
}
export type SenderAdapter = {
  key: string;
  mode: "unconfigured" | "fixture" | "live";
  inspect(context: SenderInspection, signal: AbortSignal): Promise<unknown>;
};
export type SenderEvidence = SenderObservation & {
  id: string;
  adapterKey: string;
  mode: SenderAdapter["mode"];
  recordedAt: string;
};
export type SenderReadiness = {
  ready: boolean;
  mode: SenderAdapter["mode"];
  issues: { code: string; action: string }[];
  uses: Record<SenderUse, { ready: boolean; reasons: string[] }>;
};
export type SenderIdentity = SenderRecord<SenderIdentityConfiguration> & {
  identification: {
    businessName: string;
    fromName: string;
    platformDisclosure: string;
  };
  evidence: SenderEvidence | null;
  readiness: SenderReadiness;
};
export type SenderWorkspace = {
  canManage: boolean;
  connections: SenderConnection[];
  replyRoutes: ReplyRoute[];
  inboxes: { id: string; label: string; active: boolean }[];
  identities: SenderIdentity[];
};
const recordFields = { id: z.uuid(), version: senderVersionSchema };
const useReadiness = z.object({
  ready: z.boolean(),
  reasons: z.array(z.string()),
});
export const senderWorkspaceSchema = z.object({
  canManage: z.boolean(),
  connections: z.array(
    z.object({ ...recordFields, configuration: senderConnectionSchema }),
  ),
  replyRoutes: z.array(
    z.object({ ...recordFields, configuration: replyRouteSchema }),
  ),
  inboxes: z.array(
    z.object({ id: z.uuid(), label: z.string(), active: z.boolean() }),
  ),
  identities: z.array(
    z.object({
      ...recordFields,
      configuration: senderIdentitySchema,
      identification: z.object({
        businessName: z.string(),
        fromName: z.string(),
        platformDisclosure: z.string(),
      }),
      evidence: senderObservationSchema
        .extend({
          id: z.uuid(),
          adapterKey: z.string(),
          mode: z.enum(["unconfigured", "fixture", "live"]),
          recordedAt: z.iso.datetime({ offset: true }),
        })
        .nullable(),
      readiness: z.object({
        ready: z.boolean(),
        mode: z.enum(["unconfigured", "fixture", "live"]),
        issues: z.array(z.object({ code: z.string(), action: z.string() })),
        uses: z.object({
          first_contact: useReadiness,
          trial: useReadiness,
          inbound: useReadiness,
          existing_conversation: useReadiness,
        }),
      }),
    }),
  ),
});
