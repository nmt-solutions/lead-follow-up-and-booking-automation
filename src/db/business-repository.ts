import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { BusinessRepository } from "../application/business";
import { ApplicationError } from "../models/application-error";
import type { Database } from "./runtime";
import { business, membership } from "./schema";
import { scoped, requireCapability } from "./scope";

export function createBusinessRepository(
  database: Database,
): BusinessRepository {
  return {
    create(actor, profile, at) {
      const id = randomUUID();
      return scoped(database, actor, id, async (tx) => {
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
      return scoped(database, actor, "", async (tx) => {
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
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        const [profile] = await tx
          .select()
          .from(business)
          .where(eq(business.id, businessId));
        if (!profile) throw new ApplicationError("NOT_FOUND");
        return profile;
      });
    },
    update(actor, businessId, profile, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          const [updated] = await tx
            .update(business)
            .set({ ...profile, updatedAt: at })
            .where(eq(business.id, businessId))
            .returning();
          if (!updated) throw new ApplicationError("NOT_FOUND");
          return updated;
        },
        { lock: true },
      );
    },
  };
}
