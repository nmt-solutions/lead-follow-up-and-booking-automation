import { z } from "zod";
import { senderBindingSchema } from "./senders";

const label = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\u0000-\u001f\u007f<>]+$/);
const key = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
// References identify an access-controlled artifact; never accept credentials, queries or fragments.
const reference = z
  .url()
  .max(512)
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  });
export const healthMetrics = [
  "spf",
  "dkim",
  "dmarc_alignment",
  "bounces",
  "complaints",
] as const;
export type HealthMetric = (typeof healthMetrics)[number];
const threshold = z
  .strictObject({
    unit: z.enum(["count", "rate"]),
    limit: z.number().positive().max(1000000000),
    minimumSample: z.number().int().positive().max(1000000000),
  })
  .refine((v) =>
    v.unit === "rate" ? v.limit <= 1 : Number.isInteger(v.limit),
  );
const thresholds = z.strictObject({
  spf: threshold,
  dkim: threshold,
  dmarc_alignment: threshold,
  bounces: threshold,
  complaints: threshold,
});
export const healthPolicySchema = z.strictObject({
  source: z.literal("assisted_review"),
  sourceAuthority: label,
  sourceOrigin: reference.refine((v) => new URL(v).origin === v),
  population: label,
  windowSeconds: z.number().int().min(1).max(864000),
  freshnessSeconds: z.number().int().min(1).max(604800),
  maximumLatenessSeconds: z.number().int().min(0).max(604800),
  retentionDays: z.number().int().min(1).max(3650),
  thresholds,
});
export type HealthPolicy = z.infer<typeof healthPolicySchema>;
export const healthBindingSchema = z.strictObject({
  sender: senderBindingSchema,
  provider: z.enum([
    "gmail",
    "microsoft",
    "customer_domain",
    "service_provided",
  ]),
  account: z.email(),
  mailboxId: z.uuid().nullable(),
  generation: z.number().int().positive().nullable(),
  accountSubject: z.string().min(1).max(256).nullable(),
});
export type HealthBinding = z.infer<typeof healthBindingSchema>;
const measurement = z
  .strictObject({
    failed: z.number().int().min(0).max(1000000000),
    total: z.number().int().min(0).max(1000000000),
  })
  .refine((v) => v.failed <= v.total);
export const healthEvidenceSchema = z.strictObject({
  eventKey: key,
  policyVersion: z.number().int().positive(),
  binding: healthBindingSchema,
  observedAt: z.iso.datetime({ offset: true }),
  windowStart: z.iso.datetime({ offset: true }),
  windowEnd: z.iso.datetime({ offset: true }),
  reference,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  metrics: z.strictObject({
    spf: measurement,
    dkim: measurement,
    dmarc_alignment: measurement,
    bounces: measurement,
    complaints: measurement,
  }),
  repairs: z
    .array(z.uuid())
    .max(100)
    .refine((v) => new Set(v).size === v.length),
});
export type HealthEvidence = z.infer<typeof healthEvidenceSchema>;
export type HealthFailure = HealthMetric | "sending_authorization";
export type HealthPayload =
  | { kind: "policy"; version: number; configuration: HealthPolicy }
  | { kind: "evidence"; evidence: HealthEvidence | null }
  | {
      kind: "incident";
      evidenceId: string;
      binding: HealthBinding;
      observedAt: string;
      windowEnd: string;
      failures: HealthFailure[];
      policy: HealthPolicy | null;
      metrics: HealthEvidence["metrics"] | null;
      reason: "threshold" | "revoked" | "insufficient";
    }
  | { kind: "repair"; incidentId: string; evidenceId: string }
  | {
      kind: "failure";
      incidentId: string;
      evidenceId: string;
      observedAt: string;
      windowEnd: string;
    }
  | { kind: "alert"; incidentId: string; audience: "business" | "operator" }
  | {
      kind: "acknowledgement";
      alertId: string;
      audience: "business" | "operator";
    };
export const healthCommandSchema = z.discriminatedUnion("command", [
  z.strictObject({ command: z.literal("prune"), identityId: z.uuid() }),
  z.strictObject({
    command: z.literal("configure"),
    identityId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    policy: healthPolicySchema,
  }),
  z.strictObject({
    command: z.literal("ingest"),
    identityId: z.uuid(),
    evidence: healthEvidenceSchema,
  }),
  z.strictObject({ command: z.literal("acknowledge"), alertId: z.uuid() }),
]);

/** Rates are fractions. Equality fails. Snapshots are never summed; undersized samples stay unknown. */
export function assessHealth(
  metrics: HealthEvidence["metrics"],
  policy: HealthPolicy,
) {
  const failures: HealthMetric[] = [],
    unknown: HealthMetric[] = [];
  for (const metric of healthMetrics) {
    const sample = metrics[metric],
      rule = policy.thresholds[metric];
    if (sample.total < rule.minimumSample) {
      unknown.push(metric);
      continue;
    }
    if (
      (rule.unit === "rate" ? sample.failed / sample.total : sample.failed) >=
      rule.limit
    )
      failures.push(metric);
  }
  return { failures, unknown };
}

export const metricMeaning: Record<HealthMetric, string> = {
  spf: "SPF failures / messages with trusted receiver authentication results",
  dkim: "DKIM failures / messages with trusted receiver authentication results",
  dmarc_alignment:
    "DMARC alignment failures / messages with trusted receiver authentication results",
  bounces: "Permanent delivery failures / provider-accepted submissions",
  complaints:
    "Attributable recipient complaints / delivered messages in the reviewed population",
};
