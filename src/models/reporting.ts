import { z } from "zod";

export const reportQuerySchema = z.strictObject({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  category: z
    .enum(["all", "discovery", "sales", "communication", "activity"])
    .default("all"),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export const reportMetricSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  group: z.enum(["discovery", "sales", "communication", "activity", "cost"]),
  value: z.number().finite().nullable(),
  denominator: z.number().finite().nonnegative().nullable(),
  ratio: z.number().finite().min(0).max(1).nullable(),
  unit: z.string(),
  status: z.enum(["recorded", "estimated", "unavailable", "stale"]),
  definition: z.string(),
  cohort: z.string(),
});
export type ReportMetric = z.infer<typeof reportMetricSchema>;
export const reportDetailSchema = z.strictObject({
  id: z.string(),
  category: z.enum(["discovery", "sales", "communication", "activity"]),
  entityId: z.string(),
  opportunityId: z.uuid().nullable(),
  channel: z.enum(["email", "whatsapp", "call"]).nullable(),
  kind: z.string(),
  state: z.string(),
  at: z.iso.datetime(),
  sourceIds: z.array(z.string()),
  version: z.number().int().nullable(),
  link: z.string().startsWith("/businesses/"),
  note: z.string(),
});
export type ReportDetail = z.infer<typeof reportDetailSchema>;
export const businessReportSchema = z.strictObject({
  businessId: z.uuid(),
  asOf: z.iso.datetime(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  coverage: z.array(z.string()),
  metrics: z.array(reportMetricSchema),
  details: z.strictObject({
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    nextOffset: z.number().int().nonnegative().nullable(),
    items: z.array(reportDetailSchema),
  }),
});
export type BusinessReport = z.infer<typeof businessReportSchema>;
