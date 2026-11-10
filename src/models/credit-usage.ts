import { z } from "zod";

const creditPoolSchema = z.object({
  included: z.number().finite().nonnegative(),
  reserved: z.number().finite().nonnegative(),
  remaining: z.number().finite().nonnegative(),
  unit: z.string(),
});

export const creditUsageSchema = z.object({
  active: z.boolean(),
  paidThrough: z.iso.datetime().nullable(),
  allowances: z
    .object({ discovery: creditPoolSchema, automation: creditPoolSchema })
    .nullable(),
});
export type CreditUsage = z.infer<typeof creditUsageSchema>;
export type CreditPool = z.infer<typeof creditPoolSchema>;

/** Reservations include completed work and work whose provider outcome is pending. */
export function creditPercentage(pool: CreditPool) {
  if (
    !Number.isFinite(pool.included) ||
    pool.included <= 0 ||
    !Number.isFinite(pool.reserved) ||
    pool.reserved < 0
  )
    return null;
  return Math.min(
    100,
    Math.max(0, Math.round((pool.reserved / pool.included) * 100)),
  );
}
