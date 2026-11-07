import { sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import { ApplicationError } from "../models/application-error";
export async function reservePilotEffect(
  tx: Transaction,
  businessId: string,
  kind: "discovery" | "automation" | "mailbox" | "calendar",
  operationId: string,
  quantity = 1,
  intent: Record<string, unknown> = {},
) {
  const result = await tx.execute<{ allowed: boolean }>(
    sql`select public.reserve_pilot_effect(${businessId}::uuid,${kind},${operationId},${quantity},${JSON.stringify(intent)}::jsonb) as allowed`,
  );
  if (!result.rows[0]?.allowed)
    throw new ApplicationError("PAID_ACCESS_REQUIRED");
}
export async function pilotEffectCurrent(
  tx: Transaction,
  businessId: string,
  kind: string,
  operationId = "",
) {
  const result = await tx.execute<{ allowed: boolean }>(
    sql`select public.pilot_effect_current(${businessId}::uuid,${kind},${operationId}) as allowed`,
  );
  return result.rows[0]?.allowed === true;
}

export async function pilotPathAllowed(
  tx: Transaction,
  businessId: string,
  capability: string,
  path: Record<string, unknown>,
) {
  const result = await tx.execute<{ allowed: boolean }>(
    sql`select public.pilot_path_allowed(${businessId}::uuid,${capability},${JSON.stringify(path)}::jsonb) as allowed`,
  );
  return result.rows[0]?.allowed === true;
}
export async function requirePilotPath(
  tx: Transaction,
  businessId: string,
  capability: string,
  path: Record<string, unknown>,
) {
  if (!(await pilotPathAllowed(tx, businessId, capability, path)))
    throw new ApplicationError("PAID_ACCESS_REQUIRED");
}
