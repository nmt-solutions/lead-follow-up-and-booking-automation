import { briefSchema } from "./discovery-brief";
import { z } from "zod";

export const timingSchema = z.strictObject({
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => {
      if (/^[+-]/.test(value)) return false;
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length),
  missed: z.literal("skip"),
  overlap: z.literal("skip"),
  dst: z.literal("compatible"),
});
export const savedScheduleViewSchema = timingSchema.extend({
  brief: briefSchema,
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  status: z.enum(["active", "paused"]),
  nextDueAt: z.iso.datetime().nullable(),
  allowanceUnit: z.string().min(1),
  budget: z.number().int().positive(),
  markets: z.array(z.string()),
  publicOffering: z.string(),
  queueState: z.enum(["pending", "enqueued", "paused"]),
  failure: z
    .enum([
      "queue_unavailable",
      "authorization_revoked",
      "configuration_changed",
      "overlap_skipped",
      "missed_skipped",
      "setup_required",
      "worker_lost",
    ])
    .nullable(),
  lastRunId: z.uuid().nullable(),
  updatedAt: z.iso.datetime(),
});
export type Timing = z.infer<typeof timingSchema>;
export type SavedScheduleView = z.infer<typeof savedScheduleViewSchema>;
