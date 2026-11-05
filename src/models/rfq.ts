import { z } from "zod";
import { knowledgeConfigurationSchema } from "./knowledge";
import { inquiryFactSchema } from "./inquiries";

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !v.includes("\0"));
export const rfqFieldSchema = inquiryFactSchema
  .extend({
    messageId: z.uuid().nullable(),
    quote: text(4000).nullable(),
  })
  .superRefine((value, ctx) => {
    if ((value.messageId === null) !== (value.quote === null))
      ctx.addIssue({
        code: "custom",
        message: "Provide both the source message and exact excerpt.",
      });
  });
export const saveRfqSchema = z
  .strictObject({
    expectedVersion: z.number().int().min(0).max(2147483646),
    expectedKnowledgeVersion: z.number().int().positive(),
    expectedControlVersion: z.number().int().nonnegative(),
    expectedContextKey: z.string().regex(/^[a-f0-9]{64}$/),
    requestKey: z.uuid(),
    offering: text(200),
    fields: z.array(rfqFieldSchema).max(50),
    note: text(1000),
    nextAction: text(1000),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.fields.map((f) => f.key)).size !== value.fields.length)
      ctx.addIssue({
        code: "custom",
        message: "Use distinct requirement keys.",
      });
  });
export type SaveRfq = z.infer<typeof saveRfqSchema>;
export const rfqRecordSchema = z.strictObject({
  offering: z.strictObject({ name: z.string(), details: z.string() }),
  fields: z.array(rfqFieldSchema),
  requirements: knowledgeConfigurationSchema.shape.qualification,
  knowledgeVersion: z.number().int().positive(),
  sources: z.array(
    z.strictObject({
      id: z.uuid(),
      associationVersion: z.number().int(),
      correctionVersion: z.number().int(),
    }),
  ),
  completeness: z.enum(["incomplete", "complete"]),
  missing: z.array(z.string()),
});
export type RfqRecord = z.infer<typeof rfqRecordSchema>;
export const rfqRevisionSchema = rfqRecordSchema.extend({
  id: z.uuid(),
  revisionId: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
  nextAction: z.string(),
});
export const rfqWorkspaceSchema = z.strictObject({
  current: rfqRevisionSchema
    .extend({
      status: z.enum(["incomplete", "complete", "review_required"]),
      missing: z.array(z.string()),
      issues: z.array(z.string()),
    })
    .nullable(),
  history: z.array(rfqRevisionSchema),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  nextAction: z.string(),
  controlVersion: z.number().int().nonnegative(),
  contextKey: z.string().regex(/^[a-f0-9]{64}$/),
  knowledgeVersion: z.number().int().positive().nullable(),
  offerings: knowledgeConfigurationSchema.shape.offerings,
  requirements: knowledgeConfigurationSchema.shape.qualification,
  suggestions: z.array(inquiryFactSchema),
  messages: z.array(z.strictObject({ id: z.uuid(), text: z.string() })),
  canSave: z.boolean(),
  setupReason: z.string().nullable(),
});
export type RfqWorkspace = z.infer<typeof rfqWorkspaceSchema>;
