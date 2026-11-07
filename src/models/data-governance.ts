import { z } from "zod";

const reference = z.string().trim().min(1).max(500);
export const dataPolicySchema = z
  .strictObject({
    id: reference,
    version: z.number().int().positive(),
    businessIds: z.array(z.uuid()).min(1).max(1000),
    mode: z.enum(["fixture", "test", "live"]),
    reviewedBy: reference,
    evidence: z.array(reference).min(1).max(20),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime(),
    access: z.literal("owner_admin"),
    afterCancellation: z.literal(true),
    preserveFinancial: z.literal(true),
    retention: z.strictObject({
      retainedRecords: z.literal("source_contract"),
      financialEvidenceUntil: z.iso.datetime().nullable(),
      evidence: reference,
    }),
    exportSeconds: z.number().int().min(60).max(86400),
    grantSeconds: z.number().int().min(1).max(600),
    maxBytes: z.number().int().min(1024).max(20_000_000),
    maxRows: z.number().int().min(1).max(1000),
    storageScope: reference,
    sourceRights: z
      .array(
        z.strictObject({
          adapterId: reference,
          scopeRef: reference,
          evidence: reference,
          export: z.boolean(),
          afterCancellation: z.boolean(),
          sourceOrigins: z
            .array(z.url({ protocol: /^https$/ }))
            .min(1)
            .max(100),
        }),
      )
      .max(50),
    deletion: z
      .strictObject({
        generalFiles: z.boolean(),
        notBefore: z.iso.datetime(),
        holds: z.array(z.uuid()).max(1000),
        evidence: reference,
      })
      .nullable(),
    nativeRevocation: z.boolean(),
    maxAttempts: z.number().int().min(1).max(5),
    retrySeconds: z.number().int().min(1).max(86400),
  })
  .refine(
    (p) =>
      new Date(p.effectiveUntil) > new Date(p.effectiveFrom) &&
      p.grantSeconds < p.exportSeconds,
  );
export type DataPolicy = z.infer<typeof dataPolicySchema>;
export function samePolicy(a: DataPolicy, b: DataPolicy): boolean {
  const stable = (v: unknown): string =>
    JSON.stringify(
      v && typeof v === "object"
        ? Array.isArray(v)
          ? v.map((x) => JSON.parse(stable(x)))
          : Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, JSON.parse(stable(x))]),
            )
        : v,
    );
  return stable(a) === stable(b);
}
export const exportInputSchema = z.strictObject({
  requestKey: z.uuid(),
  part: z.number().int().min(1).max(1_000_000).default(1),
});
export const offboardInputSchema = z.strictObject({
  requestKey: z.uuid(),
  policyId: reference,
  policyVersion: z.number().int().positive(),
  confirmStop: z.literal(true),
  deleteGeneralFiles: z.boolean(),
  cancellation: z.union([
    z.null(),
    z.strictObject({
      actionId: z.uuid(),
      requestKey: z.uuid(),
      confirmed: z.literal(true),
    }),
  ]),
});
export type OffboardInput = z.infer<typeof offboardInputSchema>;
export const recordDataEvidenceSchema = z.strictObject({
  stepId: z.uuid(),
  fact: z.enum([
    "external_consent_removal_reported",
    "number_transfer_reported",
    "number_control_reviewed",
  ]),
  reference: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[\p{L}\p{N} .:_/-]+$/u),
});
export type NativeCleanup = {
  id: string;
  businessId: string;
  requestId: string;
  kind:
    | "gmail"
    | "google_calendar"
    | "microsoft_mail"
    | "microsoft_calendar"
    | "meta"
    | "file"
    | "artifact";
  targetId: string;
  attempt: number;
  lease: string;
  secret: { credentials: string | null; rejected: string | null } | null;
  details: Record<string, string>;
  policy: DataPolicy;
};
export type RevocationOutcome =
  | "confirmed"
  | "subscription_removed"
  | "manual_required"
  | "shared_identity"
  | "unconfirmed";
export const dataPolicyViewSchema = z
  .object({ ...dataPolicySchema.shape })
  .omit({
    businessIds: true,
    storageScope: true,
    sourceRights: true,
    deletion: true,
  })
  .extend({
    deletion: z
      .object({
        generalFiles: z.boolean(),
        notBefore: z.string(),
        evidence: z.string(),
        holdCount: z.number(),
      })
      .nullable(),
  });
export const dataWorkspaceSchema = z.object({
  policy: dataPolicyViewSchema.nullable(),
  stopped: z.boolean(),
  exports: z.array(
    z.object({
      id: z.uuid(),
      state: z.string(),
      bytes: z.number().nullable(),
      sha256: z.string().nullable(),
      expiresAt: z.string(),
      createdAt: z.string(),
      part: z.number(),
      cleanupAttempts: z.number(),
      cleanupLimit: z.number(),
      nextCleanupAt: z.string(),
    }),
  ),
  offboarding: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      policyId: z.string(),
      policyVersion: z.number(),
      createdAt: z.string(),
      cancellation: z.unknown(),
      steps: z.array(
        z.object({
          id: z.uuid(),
          kind: z.string(),
          targetId: z.string(),
          state: z.string(),
          attempts: z.number(),
          outcome: z.string().nullable(),
          tokenWiped: z.boolean(),
          control: z.string().nullable(),
          history: z.array(
            z.object({
              id: z.uuid(),
              at: z.string(),
              outcome: z.string(),
              actorId: z.string().nullable(),
              evidence: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type DataWorkspace = z.infer<typeof dataWorkspaceSchema>;
