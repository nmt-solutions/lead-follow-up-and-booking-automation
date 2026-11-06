import { and, eq } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  gmailGrant,
  gmailOauth,
  mailboxPolicy,
  senderConnection,
} from "./schema";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type { GmailRepository, GmailStore } from "../models/gmail";
import { invalidateMailboxVisibility } from "./mailbox-visibility";

/** Current-state authorization and local atomic storage only. Provider I/O belongs to the application. */
export function createGmailRepository(
  database: Database,
  clock: Clock,
): GmailRepository {
  return {
    withMailbox(identity, businessId, mailboxId, operation) {
      return scoped(
        database,
        identity,
        businessId,
        async (tx) => {
          const role = await requireCapability(
            tx,
            identity,
            businessId,
            "integrations.manage",
          );
          await requireSalesSession(tx, identity, clock.now(), role);
          const [policy] = await tx
            .select()
            .from(mailboxPolicy)
            .where(
              and(
                eq(mailboxPolicy.id, mailboxId),
                eq(mailboxPolicy.businessId, businessId),
              ),
            );
          if (!policy) throw new ApplicationError("NOT_FOUND");
          const [connection] = await tx
            .select()
            .from(senderConnection)
            .where(
              and(
                eq(senderConnection.id, policy.connectionId),
                eq(senderConnection.businessId, businessId),
              ),
            );
          if (
            policy.provider !== "gmail" ||
            !connection ||
            connection.configuration.provider !== "gmail" ||
            connection.configuration.account !== policy.account
          )
            throw new ApplicationError("INVALID_INPUT");
          const [grant] = await tx
            .select()
            .from(gmailGrant)
            .where(
              and(
                eq(gmailGrant.id, mailboxId),
                eq(gmailGrant.businessId, businessId),
              ),
            );
          const store: GmailStore = {
            policy,
            grant,
            processingEnabled:
              policy.configuration.enabled &&
              connection.configuration.enabled &&
              policy.connectionVersion === connection.version,
            async createGrant() {
              const [created] = await tx
                .insert(gmailGrant)
                .values({
                  id: mailboxId,
                  businessId,
                  generation: 1,
                  status: "connecting",
                  scopes: [],
                  actorId: identity.userId,
                })
                .returning();
              store.grant = created;
              return created;
            },
            async updateGrant(change) {
              await tx
                .update(gmailGrant)
                .set(change)
                .where(
                  and(
                    eq(gmailGrant.id, mailboxId),
                    eq(gmailGrant.businessId, businessId),
                  ),
                );
            },
            async state(hash) {
              const [state] = await tx
                .select()
                .from(gmailOauth)
                .where(
                  and(
                    eq(gmailOauth.businessId, businessId),
                    eq(gmailOauth.mailboxId, mailboxId),
                    eq(gmailOauth.stateHash, hash),
                  ),
                );
              return state;
            },
            async createState(state) {
              if (
                state.businessId !== businessId ||
                state.mailboxId !== mailboxId ||
                state.actorId !== identity.userId ||
                state.sessionId !== identity.sessionId
              )
                throw new ApplicationError("FORBIDDEN");
              await tx.insert(gmailOauth).values(state);
            },
            async consumeState(id) {
              await tx
                .update(gmailOauth)
                .set({ consumed: true })
                .where(
                  and(
                    eq(gmailOauth.businessId, businessId),
                    eq(gmailOauth.mailboxId, mailboxId),
                    eq(gmailOauth.id, id),
                  ),
                );
            },
            invalidate: () =>
              invalidateMailboxVisibility(tx, businessId, mailboxId),
          };
          return operation(store);
        },
        { lock: true },
      );
    },
  };
}
