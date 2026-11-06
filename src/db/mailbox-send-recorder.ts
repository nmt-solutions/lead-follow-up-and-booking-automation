import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "./runtime";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { mailAppMessageSchema } from "../models/mail-native";
import { ApplicationError } from "../models/application-error";
import { scoped, requireCapability } from "./scope";
import { requireSalesSession } from "./sales-session";
import { inboxMessage, mailboxAppMessage, mailboxPolicy } from "./schema";

/** Server transport seam for #36. No public route, sender or provider-header assertion can call this through sync. */
export function createMailboxSendRecorder(database: Database, clock: Clock) {
  return {
    async record(identity: WorkIdentity, businessId: string, input: unknown) {
      const parsed = mailAppMessageSchema.safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      const receipt = parsed.data;
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
          const [message] = await tx
            .select()
            .from(inboxMessage)
            .where(
              and(
                eq(inboxMessage.id, receipt.replyToMessageId),
                eq(inboxMessage.businessId, businessId),
                eq(inboxMessage.connectionId, receipt.mailboxId),
              ),
            );
          const [policy] = await tx
            .select()
            .from(mailboxPolicy)
            .where(
              and(
                eq(mailboxPolicy.id, receipt.mailboxId),
                eq(mailboxPolicy.businessId, businessId),
              ),
            );
          if (!message || !policy) throw new ApplicationError("NOT_FOUND");
          const [existing] = await tx
            .select()
            .from(mailboxAppMessage)
            .where(
              and(
                eq(mailboxAppMessage.mailboxId, receipt.mailboxId),
                eq(mailboxAppMessage.messageRef, receipt.messageRef),
                eq(mailboxAppMessage.businessId, businessId),
              ),
            );
          if (existing) {
            if (
              existing.internetMessageId !== receipt.internetMessageId ||
              existing.replyToMessageId !== receipt.replyToMessageId
            )
              throw new ApplicationError("CONFLICT");
            return;
          }
          await tx.insert(mailboxAppMessage).values({
            ...receipt,
            id: randomUUID(),
            businessId,
            actorId: identity.userId,
            at: clock.now(),
          });
        },
        { lock: true },
      );
    },
  };
}
