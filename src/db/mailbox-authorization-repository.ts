import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isPendingEmailAccount } from "../models/email-setup";
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
  senderReplyRoute,
  senderIdentity,
  business,
} from "./schema";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type {
  MailboxAuthorizationRepository,
  MailboxAuthorizationStore,
} from "../models/mailbox-authorization";
import { invalidateMailboxVisibility } from "./mailbox-visibility";
import { recordSenderConnectionFailure } from "./sender-health-repository";

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
              if (
                change.reason === "revoked" ||
                change.reason === "insufficient" ||
                change.status === "reconnect_required" ||
                change.status === "insufficient"
              )
                await recordSenderConnectionFailure(
                  tx,
                  businessId,
                  policy.connectionId,
                  clock.now(),
                  change.reason === "revoked" ? "revoked" : "insufficient",
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
            async bindPendingAccount(value) {
              const account = z.email().max(254).parse(value).toLowerCase();
              if (
                !isPendingEmailAccount(policy.account) ||
                grant?.accountSubject
              )
                throw new ApplicationError("CONFLICT");
              const [duplicate] = await tx
                .select({ id: mailboxPolicy.id })
                .from(mailboxPolicy)
                .where(
                  and(
                    eq(mailboxPolicy.businessId, businessId),
                    eq(mailboxPolicy.provider, provider),
                    eq(mailboxPolicy.account, account),
                  ),
                );
              if (duplicate) throw new ApplicationError("CONFLICT");
              const configuration = {
                ...connection.configuration,
                account,
                label: account,
              };
              await tx
                .update(senderConnection)
                .set({
                  configuration,
                  version: connection.version + 1,
                  updatedAt: clock.now(),
                })
                .where(
                  and(
                    eq(senderConnection.id, connection.id),
                    eq(senderConnection.businessId, businessId),
                  ),
                );
              await tx
                .update(mailboxPolicy)
                .set({
                  account,
                  connectionVersion: connection.version + 1,
                  version: policy.version + 1,
                  updatedAt: clock.now(),
                })
                .where(
                  and(
                    eq(mailboxPolicy.id, mailboxId),
                    eq(mailboxPolicy.businessId, businessId),
                  ),
                );
              const [profile] = await tx
                .select({ name: business.name })
                .from(business)
                .where(eq(business.id, businessId));
              if (!profile) throw new ApplicationError("NOT_FOUND");
              const replyRouteId = randomUUID();
              await tx.insert(senderReplyRoute).values({
                id: replyRouteId,
                businessId,
                version: 1,
                createdBy: identity.userId,
                updatedAt: clock.now(),
                connectionId: connection.id,
                inboxConnectionId: mailboxId,
                configuration: {
                  address: account,
                  connectionId: connection.id,
                  inboxConnectionId: mailboxId,
                  enabled: true,
                },
              });
              await tx.insert(senderIdentity).values({
                id: randomUUID(),
                businessId,
                version: 1,
                createdBy: identity.userId,
                updatedAt: clock.now(),
                connectionId: connection.id,
                replyRouteId,
                configuration: {
                  origin: "customer_mailbox",
                  purpose: "ordinary_sales",
                  fromAddress: account,
                  displayName: profile.name,
                  uses: ["inbound", "existing_conversation"],
                  connectionId: connection.id,
                  replyRouteId,
                  enabled: true,
                },
              });
            },
            invalidate: () =>
              invalidateMailboxVisibility(tx, businessId, mailboxId),
            async googlePrimaryRevocable() {
              if (provider !== "gmail" || !grant) return false;
              const result = await tx.execute<{ allowed: boolean }>(
                sql`select public.google_primary_revocable('gmail',${grant.id}::uuid,${grant.generation}) allowed`,
              );
              return result.rows[0]?.allowed === true;
            },
          };
          return operation(store);
        },
        { lock: true },
      );
    },
  };
}
