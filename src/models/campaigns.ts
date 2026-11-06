import { z } from "zod";
import { contactEvidenceSchema, persistedProspectSchema } from "./discovery";
import {
  senderIdentitySchema,
  senderBindingSchema,
  senderConnectionSchema,
  replyRouteSchema,
} from "./senders";
import { emailEligibilitySchema } from "./email-eligibility";
import { sequenceTimingSchema, sequenceActionStates } from "./email-sequences";

const text = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
const version = z.number().int().min(0).max(2147483646);
export const campaignSelectionSchema = z.strictObject({
  prospectId: z.uuid(),
  contactId: z.string().min(1).max(256),
  evidenceKey: z.string().regex(/^[a-f0-9]{64}$/),
});
export const campaignStepSchema = z.strictObject({
  subject: text.refine((v) => !/[\r\n]/.test(v)),
  body: text,
  delayMinutes: z.number().int().min(0).max(2147483646),
});
/** Mandatory safety stops cannot be removed by a client or generated text. Delays are relative to the previous successful attempt. */
export const campaignStopsSchema = z.strictObject({
  reply: z.literal(true),
  optOut: z.literal(true),
  humanControl: z.literal(true),
  authorityChange: z.literal(true),
  eligibilityChange: z.literal(true),
  senderFailure: z.literal(true),
  reachChange: z.literal(true),
  additional: z.array(text),
});
export const mandatoryCampaignStops: z.infer<typeof campaignStopsSchema> = {
  reply: true,
  optOut: true,
  humanControl: true,
  authorityChange: true,
  eligibilityChange: true,
  senderFailure: true,
  reachChange: true,
  additional: [],
};
const plan = {
  timing: sequenceTimingSchema.nullable().default(null),
  name: text,
  channel: z.literal("email"),
  senderIdentityId: z.uuid(),
  senderVersion: version,
  steps: z.array(campaignStepSchema).min(1),
  maxAttempts: z.number().int().positive().max(2147483646),
  stopConditions: campaignStopsSchema,
};
function validPlan(v: {
  steps: z.infer<typeof campaignStepSchema>[];
  maxAttempts: number;
}) {
  return (
    v.maxAttempts === v.steps.length &&
    v.steps[0]?.delayMinutes === 0 &&
    v.steps.slice(1).every((s) => s.delayMinutes > 0) &&
    Number.isSafeInteger(
      v.steps.reduce((sum, s) => sum + s.delayMinutes * 60000, 0),
    )
  );
}
export const saveCampaignSchema = z
  .strictObject({
    requestKey: z.uuid(),
    campaignId: z.uuid(),
    expectedVersion: version,
    ...plan,
    recipients: z.array(campaignSelectionSchema).min(1),
    note: text,
  })
  .refine(validPlan, {
    message:
      "Use one attempt per message, zero delay for the initial message and positive follow-up delays.",
  });
export type SaveCampaign = z.infer<typeof saveCampaignSchema>;
export const campaignRefSchema = z.strictObject({
  revisionId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const inspectCampaignSchema = campaignRefSchema.extend({
  sequenceActionId: z.uuid().optional(),
  recipient: z.strictObject({
    prospectId: z.uuid(),
    contactId: z.string().min(1).max(256),
    address: z.email(),
  }),
  stepIndex: z.number().int().nonnegative(),
});
export const decideCampaignSchema = campaignRefSchema.extend({
  decision: z.enum(["approved", "rejected"]),
  note: text,
});
export type DecideCampaign = z.infer<typeof decideCampaignSchema>;
/** Consolidation combines individually bounded source observations without discarding their retained evidence. */
export const campaignProspectSchema = persistedProspectSchema.extend({
  contacts: z.array(contactEvidenceSchema),
  evidence: z.array(persistedProspectSchema.shape.evidence.element).min(1),
});
export const campaignRecipientSchema = campaignSelectionSchema.extend({
  address: z.email(),
  contact: contactEvidenceSchema,
  contactStatus: z.enum(["buyer_contact", "general_business_contact"]),
  prospect: campaignProspectSchema,
  reviewReasons: z.array(z.string()),
});
export const campaignSnapshotSchema = z
  .strictObject({
    ...plan,
    sender: senderIdentitySchema,
    authorityVersion: version,
    senderContext: z.strictObject({
      binding: senderBindingSchema,
      connection: z
        .object({
          id: z.uuid(),
          version,
          configuration: senderConnectionSchema,
        })
        .nullable(),
      replyRoute: z
        .object({ id: z.uuid(), version, configuration: replyRouteSchema })
        .nullable(),
      replyConnection: z
        .object({
          id: z.uuid(),
          version,
          configuration: senderConnectionSchema,
        })
        .nullable(),
    }),
    recipients: z.array(campaignRecipientSchema).min(1),
  })
  .refine(validPlan);
export type CampaignSnapshot = z.infer<typeof campaignSnapshotSchema>;
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  actorId: z.string(),
  actorName: z.string(),
  role: z.literal("owner"),
  at: z.iso.datetime(),
  note: z.string(),
});
const currentCheckSchema = z.object({
  status: z.enum(["allowed", "blocked", "unknown"]),
  reason: z.string(),
});
export const campaignCurrentSchema = z.object({
  version: currentCheckSchema,
  authority: currentCheckSchema,
  evidence: currentCheckSchema,
  sender: currentCheckSchema,
  reach: currentCheckSchema,
  conversation: currentCheckSchema,
  policyVersion: version,
  approvalPolicyVersion: version,
});
export const campaignRevisionSchema = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  version: version,
  payloadHash: z.string(),
  snapshot: campaignSnapshotSchema,
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
  decision: decisionSchema.nullable(),
  current: campaignCurrentSchema,
});
export type CampaignRevision = z.infer<typeof campaignRevisionSchema>;
export const campaignWorkspaceSchema = z.object({
  actorId: z.string(),
  canApprove: z.boolean(),
  candidates: z.array(campaignRecipientSchema),
  senders: z.array(
    z.object({ id: z.uuid(), version, configuration: senderIdentitySchema }),
  ),
  campaigns: z.array(
    z.object({ id: z.uuid(), revisions: z.array(campaignRevisionSchema) }),
  ),
});
export type CampaignWorkspace = z.infer<typeof campaignWorkspaceSchema>;
export const campaignReviewSchema = z.object({
  revision: campaignRevisionSchema,
  approval: decisionSchema.nullable(),
  current: campaignCurrentSchema,
  recipient: campaignRecipientSchema,
  step: campaignStepSchema,
  stepIndex: z.number().int(),
  eligibility: emailEligibilitySchema,
  execution: z.object({
    configured: z.boolean(),
    state: z.enum(["not_scheduled", ...sequenceActionStates]),
  }),
});
export const campaignInspectionSchema = campaignReviewSchema.extend({
  approval: decisionSchema,
});
export type CampaignReview = z.infer<typeof campaignReviewSchema>;
