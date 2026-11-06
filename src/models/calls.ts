import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !v.includes("\0"));
export const callDetailsSchema = z.strictObject({
  occurredAt: z.iso.datetime({ offset: true }).refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }),
  notes: text(8000),
  outcome: text(1000),
  responsibleId: text(256),
  nextAction: text(1000),
});
export const saveCallSchema = callDetailsSchema
  .extend({
    callId: z.uuid().nullable(),
    buyerId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    expectedControlVersion: z.number().int().min(0).max(2147483646),
    requestKey: z.uuid(),
  })
  .refine((v) =>
    v.callId === null ? v.expectedVersion === 0 : v.expectedVersion > 0,
  );
export type SaveCall = z.infer<typeof saveCallSchema>;
export const callRevisionSchema = callDetailsSchema.extend({
  id: z.uuid(),
  revisionId: z.uuid(),
  buyerId: z.uuid(),
  opportunityId: z.uuid(),
  version: z.number().int().positive(),
  actorId: z.string(),
  actorName: z.string(),
  responsibleName: z.string(),
  at: z.iso.datetime(),
  recordedBy: z.string(),
  recordedByName: z.string(),
  recordedAt: z.iso.datetime(),
});
export type CallRevision = z.infer<typeof callRevisionSchema>;
export const callMemberSchema = z.strictObject({
  userId: z.string(),
  name: z.string(),
});
export const callWorkspaceSchema = z.strictObject({
  buyerId: z.uuid(),
  buyerName: z.string(),
  opportunityId: z.uuid(),
  opportunityTitle: z.string(),
  actorId: z.string(),
  controlVersion: z.number().int().nonnegative(),
  members: z.array(callMemberSchema),
  calls: z.array(callRevisionSchema),
  history: z.array(callRevisionSchema),
  callCount: z.number().int().nonnegative(),
});
export type CallWorkspace = z.infer<typeof callWorkspaceSchema>;
