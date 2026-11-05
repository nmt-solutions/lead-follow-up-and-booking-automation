import { timingSchema, type SavedScheduleView } from "./discovery-timing";
export {
  timingSchema,
  savedScheduleViewSchema,
  type Timing,
  type SavedScheduleView,
} from "./discovery-timing";
import { z } from "zod";
import { startDiscoverySchema, workSchema } from "./discovery";

export const saveScheduleSchema = timingSchema.extend({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().trim().min(1).max(120),
  search: startDiscoverySchema,
  confirmRecurring: z.literal(true),
});
export const scheduleCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("pause"),
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    requestKey: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("resume"),
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().positive(),
    requestKey: z.uuid(),
    confirmRecurring: z.literal(true),
  }),
]);
export const scheduleWorkSchema = z.strictObject({
  businessId: z.uuid(),
  userId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  scheduleId: z.uuid(),
  revision: z.number().int().positive(),
  dispatchKey: z.uuid(),
  dueAt: z.iso.datetime(),
});
export const dispatchSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("schedule"), work: scheduleWorkSchema }),
  z.strictObject({ kind: z.literal("discovery"), work: workSchema }),
]);
export type SaveSchedule = z.infer<typeof saveScheduleSchema>;
export type ScheduleCommand = z.infer<typeof scheduleCommandSchema>;
export type ScheduleWork = z.infer<typeof scheduleWorkSchema>;
export type Dispatch = z.infer<typeof dispatchSchema>;
export type ScheduleFailure = SavedScheduleView["failure"];
export type DurableAttempt = { runId: string; number: number };
