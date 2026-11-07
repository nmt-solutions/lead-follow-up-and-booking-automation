import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import { lockBusiness } from "./scope";
import { subscriptionUsage } from "./schema";
import { ApplicationError } from "../models/application-error";
import { paidContractSchema } from "../models/subscription-payments";
import { reservePilotEffect, pilotEffectCurrent } from "./pilot-limits";

export async function readPaidContract(
  tx: Transaction,
  businessId: string,
  at: Date,
) {
  const result = await tx.execute<{ contract: unknown }>(
    sql`select public.current_paid_contract(${businessId}::uuid,${at.toISOString()}::timestamptz) as contract`,
  );
  return paidContractSchema.nullable().parse(result.rows[0]?.contract ?? null);
}

export async function paidAllowance(
  tx: Transaction,
  businessId: string,
  kind: "discovery" | "automation",
  at: Date,
) {
  const result = await tx.execute<{
    id: string;
    markets: string[];
    discovery: { quantity: number; unit: string };
    automation: { quantity: number; unit: string };
  }>(
    sql`select * from public.current_paid_scope(${businessId}::uuid,${at.toISOString()}::timestamptz)`,
  );
  const period = result.rows[0];
  if (!period) return null;
  const allowance = period[kind];
  const usage = await tx
    .select()
    .from(subscriptionUsage)
    .where(
      and(
        eq(subscriptionUsage.businessId, businessId),
        eq(subscriptionUsage.periodId, period.id),
        eq(subscriptionUsage.kind, kind),
      ),
    );
  return {
    period,
    allowance,
    remaining: Math.max(
      0,
      allowance.quantity - usage.reduce((sum, row) => sum + row.quantity, 0),
    ),
  };
}
/** Units are equal, never converted: discovery's configured unit or one actual provider call. */
export async function reservePaidUsage(
  tx: Transaction,
  businessId: string,
  kind: "discovery" | "automation",
  operationId: string,
  quantity: number,
  unit: string,
  at: Date,
) {
  await lockBusiness(tx, businessId);
  await reservePilotEffect(tx, businessId, kind, operationId, quantity);
  const current = await paidAllowance(tx, businessId, kind, at);
  if (!current || current.allowance.unit !== unit)
    throw new ApplicationError("PAID_ACCESS_REQUIRED");
  const [previous] = await tx
    .select()
    .from(subscriptionUsage)
    .where(
      and(
        eq(subscriptionUsage.businessId, businessId),
        eq(subscriptionUsage.kind, kind),
        eq(subscriptionUsage.operationId, operationId),
      ),
    );
  if (previous) {
    if (
      previous.periodId !== current.period.id ||
      previous.quantity !== quantity ||
      previous.unit !== unit
    )
      throw new ApplicationError("PAID_ACCESS_REQUIRED");
    return;
  }
  if (current.remaining < quantity)
    throw new ApplicationError("PAID_ACCESS_REQUIRED");
  await tx.insert(subscriptionUsage).values({
    id: randomUUID(),
    businessId,
    periodId: current.period.id,
    kind,
    operationId,
    quantity,
    unit,
    at,
  });
}
export async function paidReservationCurrent(
  tx: Transaction,
  businessId: string,
  kind: "discovery" | "automation",
  operationId: string,
  at: Date,
) {
  if (!(await pilotEffectCurrent(tx, businessId, kind, operationId)))
    return false;
  const current = await paidAllowance(tx, businessId, kind, at);
  if (!current) return false;
  const [usage] = await tx
    .select()
    .from(subscriptionUsage)
    .where(
      and(
        eq(subscriptionUsage.businessId, businessId),
        eq(subscriptionUsage.periodId, current.period.id),
        eq(subscriptionUsage.kind, kind),
        eq(subscriptionUsage.operationId, operationId),
      ),
    );
  return !!usage && usage.unit === current.allowance.unit;
}
