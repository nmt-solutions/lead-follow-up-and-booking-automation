import { z } from "zod";
const minor = z.string().regex(/^-?[0-9]+$/);
export const taxFilingStatusSchema = z.object({
  configured: z.boolean(),
  reportId: z.string().nullable(),
  filed: z.boolean(),
  currentRevisionFiled: z.boolean(),
  paid: z.boolean(),
  fulfilled: z.boolean(),
  filingRequired: z.boolean().nullable(),
  paymentRequired: z.boolean().nullable(),
  liabilityMinor: minor.nullable(),
  confirmedPaidMinor: minor,
  historicalPaidMinor: minor,
  unallocatedPaidMinor: minor,
  remainingMinor: minor.nullable(),
  overpaidMinor: minor,
  correctionRequired: z.boolean(),
  unresolvedEvidenceCount: z.number().int().nonnegative(),
  unconfirmedWorkCount: z.number().int().nonnegative(),
});
export type TaxFilingStatus = z.infer<typeof taxFilingStatusSchema>;
