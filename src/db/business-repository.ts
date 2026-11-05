import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { BusinessRepository } from "../application/business";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import type { Database } from "./runtime";
import { business, membership } from "./schema";

export function createBusinessRepository(
  database: Database,
): BusinessRepository {
  type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

  async function scoped<T>(
    actor: Actor,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return database.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor_id', ${actor.userId}, true), set_config('app.business_id', ${businessId}, true)`,
      );
      return operation(tx);
    });
  }

  async function requireMembership(
    tx: Transaction,
    actor: Actor,
    businessId: string,
  ) {
    const [member] = await tx
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.businessId, businessId),
          eq(membership.userId, actor.userId),
          eq(membership.role, "owner"),
        ),
      );
    if (!member) throw new ApplicationError("NOT_FOUND");
  }

  return {
    create(actor, profile, at) {
      const id = randomUUID();
      return scoped(actor, id, async (tx) => {
        // The deferred FK allows membership first; both records commit together.
        await tx
          .insert(membership)
          .values({ businessId: id, userId: actor.userId, role: "owner" });
        const [created] = await tx
          .insert(business)
          .values({ id, ...profile, createdAt: at, updatedAt: at })
          .returning();
        return created;
      });
    },
    list(actor) {
      return scoped(actor, "", async (tx) => {
        const memberships = await tx
          .select({ businessId: membership.businessId })
          .from(membership)
          .where(eq(membership.userId, actor.userId));
        const profiles = [];
        for (const member of memberships) {
          await tx.execute(
            sql`select set_config('app.business_id', ${member.businessId}, true)`,
          );
          const [profile] = await tx
            .select()
            .from(business)
            .where(eq(business.id, member.businessId));
          if (profile) profiles.push(profile);
        }
        return profiles.sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
      });
    },
    get(actor, businessId) {
      return scoped(actor, businessId, async (tx) => {
        await requireMembership(tx, actor, businessId);
        const [profile] = await tx
          .select()
          .from(business)
          .where(eq(business.id, businessId));
        if (!profile) throw new ApplicationError("NOT_FOUND");
        return profile;
      });
    },
    update(actor, businessId, profile, at) {
      return scoped(actor, businessId, async (tx) => {
        await requireMembership(tx, actor, businessId);
        const [updated] = await tx
          .update(business)
          .set({ ...profile, updatedAt: at })
          .where(eq(business.id, businessId))
          .returning();
        if (!updated) throw new ApplicationError("NOT_FOUND");
        return updated;
      });
    },
  };
}
