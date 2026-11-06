import { and, eq } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  gmailGrant,
  microsoftMailGrant,
  microsoftMailOauth,
  gmailOauth,
  mailboxPolicy,
  senderConnection,
} from "./schema";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type {
  MailboxAuthorizationRepository,
  MailboxAuthorizationStore,
} from "../models/mailbox-authorization";
import { invalidateMailboxVisibility } from "./mailbox-visibility";

/** Current-state authorization and local atomic storage only. Provider I/O belongs to the application. */
export function createMailboxAuthorizationRepository(
  database: Database,
  clock: Clock,
  provider: "gmail" | "microsoft",
): MailboxAuthorizationRepository {
  const grants = provider === "gmail" ? gmailGrant : microsoftMailGrant;
  const states = provider === "gmail" ? gmailOauth : microsoftMailOauth;
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
            policy.provider !== provider ||
            !connection ||
            connection.configuration.provider !== provider ||
            connection.configuration.account !== policy.account
          )
            throw new ApplicationError("INVALID_INPUT");
          const [grant] = await tx
            .select()
            .from(grants)
            .where(
              and(eq(grants.id, mailboxId), eq(grants.businessId, businessId)),
            );
          const store: MailboxAuthorizationStore = {
            policy,
            grant,
            processingEnabled:
              policy.configuration.enabled &&
              connection.configuration.enabled &&
              policy.connectionVersion === connection.version,
            async createGrant() {
              const [created] = await tx
                .insert(grants)
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
                .update(grants)
                .set(change)
                .where(
                  and(
                    eq(grants.id, mailboxId),
                    eq(grants.businessId, businessId),
                  ),
                );
            },
            async state(hash) {
              const [state] = await tx
                .select()
                .from(states)
                .where(
                  and(
                    eq(states.businessId, businessId),
                    eq(states.mailboxId, mailboxId),
                    eq(states.stateHash, hash),
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
              await tx.insert(states).values(state);
            },
            async consumeState(id) {
              await tx
                .update(states)
                .set({ consumed: true })
                .where(
                  and(
                    eq(states.businessId, businessId),
                    eq(states.mailboxId, mailboxId),
                    eq(states.id, id),
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
