import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { membership } from "./schema";
import type { Actor } from "../models/business";
import { capabilities, type BusinessCapability } from "../models/team";
import { ApplicationError } from "../models/application-error";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function scoped<T>(
  database: Database,
  actor: Actor,
  businessId: string,
  operation: (tx: Transaction) => Promise<T>,
  options: { at?: Date; invitationHash?: string; lock?: boolean } = {},
) {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.actor_id', ${actor.userId}, true),
      set_config('app.business_id', ${businessId}, true),
      set_config('app.at', ${options.at?.toISOString() ?? ""}, true),
      set_config('app.invitation_hash', ${options.invitationHash ?? ""}, true)`);
    if (options.lock && businessId) await lockBusiness(tx, businessId);
    return operation(tx);
  });
}

export async function lockBusiness(tx: Transaction, businessId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${businessId}, 0))`,
  );
}

export async function requireCapability(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  capability: BusinessCapability,
) {
  const [member] = await tx
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.businessId, businessId),
        eq(membership.userId, actor.userId),
      ),
    );
  if (!member) throw new ApplicationError("NOT_FOUND");
  if (!capabilities[member.role].includes(capability))
    throw new ApplicationError("FORBIDDEN");
  return member.role;
}
