import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { KnowledgeRepository } from "../application/knowledge";
import { ApplicationError } from "../models/application-error";
import { knowledgeState } from "../models/knowledge";
import type { Database } from "./runtime";
import { knowledgeRevision, user } from "./schema";
import { requireCapability, scoped, type Transaction } from "./scope";

async function read(tx: Transaction, businessId: string, canManage: boolean) {
  const rows = await tx
    .select()
    .from(knowledgeRevision)
    .where(eq(knowledgeRevision.businessId, businessId))
    .orderBy(asc(knowledgeRevision.version));
  return knowledgeState(
    rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    canManage,
  );
}
export function createKnowledgeRepository(
  database: Database,
): KnowledgeRepository {
  return {
    workspace(actor, businessId) {
      return scoped(database, actor, businessId, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "profile.read",
        );
        return read(tx, businessId, role !== "salesperson");
      });
    },
    change(actor, businessId, action, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          const state = await read(tx, businessId, true);
          if (state.version !== input.expectedVersion)
            throw new ApplicationError("CONFLICT");
          const latest = state.history.at(-1);
          if (action === "approved" && latest?.action !== "draft")
            throw new ApplicationError("CONFLICT");
          const configuration =
            action === "draft" && "configuration" in input
              ? input.configuration
              : action === "approved"
                ? latest?.configuration
                : state.current?.configuration;
          if (!configuration) throw new ApplicationError("CONFLICT");
          await tx
            .insert(knowledgeRevision)
            .values({
              id: randomUUID(),
              businessId,
              version: state.version + 1,
              action,
              configuration,
              actorId: actor.userId,
              actorName: await actorName(tx, actor.userId),
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

async function actorName(tx: Transaction, actorId: string) {
  const [identity] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, actorId));
  if (!identity) throw new ApplicationError("UNAUTHENTICATED");
  return identity.name;
}
