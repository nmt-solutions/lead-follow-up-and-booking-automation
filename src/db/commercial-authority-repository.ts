import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { CommercialAuthorityRepository } from "../application/commercial-authority";
import { ApplicationError } from "../models/application-error";
import {
  commercialActions,
  commercialWorkspaceSchema,
  defaultCommercialPolicy,
} from "../models/commercial-authority";
import type { Database } from "./runtime";
import { commercialAuthorityRevision, user } from "./schema";
import { requireCapability, scoped, type Transaction } from "./scope";

async function read(tx: Transaction, businessId: string, canManage: boolean) {
  const rows = await tx
    .select()
    .from(commercialAuthorityRevision)
    .where(eq(commercialAuthorityRevision.businessId, businessId))
    .orderBy(asc(commercialAuthorityRevision.version));
  const approvers = await tx.execute(
    sql`select * from public.commercial_approvers()`,
  );
  return commercialWorkspaceSchema.parse({
    version: rows.at(-1)?.version ?? 0,
    policy: rows.at(-1)?.policy ?? defaultCommercialPolicy(),
    history: rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    canManage,
    approvers: approvers.rows,
  });
}

export function createCommercialAuthorityRepository(
  database: Database,
): CommercialAuthorityRepository {
  return {
    workspace(actor, businessId) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          const role = await requireCapability(
            tx,
            actor,
            businessId,
            "profile.read",
          );
          return read(tx, businessId, role !== "salesperson");
        },
        { lock: true },
      );
    },
    save(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(
            tx,
            actor,
            businessId,
            "commercial-authority.manage",
          );
          const state = await read(tx, businessId, true);
          if (state.version !== input.expectedVersion)
            throw new ApplicationError("CONFLICT");
          for (const action of commercialActions) {
            const id = input.policy[action].escalationOwnerId;
            if (id && !state.approvers.some((member) => member.userId === id))
              throw new ApplicationError("INVALID_INPUT");
          }
          const [identity] = await tx
            .select({ name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, actor.userId));
          if (!identity) throw new ApplicationError("UNAUTHENTICATED");
          await tx.insert(commercialAuthorityRevision).values({
            id: randomUUID(),
            businessId,
            version: state.version + 1,
            policy: input.policy,
            actorId: actor.userId,
            actorName: identity.name || identity.email,
            at,
            note: input.note,
          });
          return read(tx, businessId, true);
        },
        { lock: true },
      );
    },
  };
}
