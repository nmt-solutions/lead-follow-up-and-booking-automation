import { and, eq } from "drizzle-orm";
import {
  permissionAllows,
  selectedMetadata,
  type MailboxMetadata,
} from "../models/mailboxes";
import type { Transaction } from "./scope";
import {
  mailboxPolicy,
  senderConnection,
  inboxConnection,
  mailboxJob,
  inboxMessage,
  inboxMessageLink,
} from "./schema";

/** Reply visibility belongs to the purchasing need, including a due action on another channel. */
export async function opportunityRepliesVisible(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
  at: Date,
) {
  const messages = await tx
    .select({
      connectionId: inboxMessage.connectionId,
      metadata: inboxMessage.mailboxMetadata,
      current: inboxMessage.mailboxCurrentMetadata,
    })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .innerJoin(
      inboxConnection,
      eq(inboxConnection.id, inboxMessage.connectionId),
    )
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessageLink.opportunityId, opportunityId),
        eq(inboxConnection.mode, "mailbox"),
      ),
    );
  for (const message of messages)
    if (
      !(await mailboxMessageAllowed(
        tx,
        businessId,
        message.connectionId,
        message.current ?? message.metadata,
        at,
      ))
    )
      return false;
  return true;
}

/** Already imported correspondence remains readable. Future automated use follows current scope. */
export async function mailboxMessageAllowed(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  metadata: MailboxMetadata | null,
  at: Date,
) {
  const [inbox] = await tx
    .select()
    .from(inboxConnection)
    .where(
      and(
        eq(inboxConnection.id, connectionId),
        eq(inboxConnection.businessId, businessId),
      ),
    );
  if (!inbox?.active) return false;
  if (inbox.mode === "normalized_import") return true;
  if (metadata) {
    const [message] = await tx
      .select({ current: inboxMessage.mailboxCurrentMetadata })
      .from(inboxMessage)
      .where(
        and(
          eq(inboxMessage.businessId, businessId),
          eq(inboxMessage.connectionId, connectionId),
          eq(inboxMessage.messageRef, metadata.messageRef),
        ),
      );
    metadata = message?.current ?? metadata;
  }
  const [policy] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.id, connectionId),
        eq(mailboxPolicy.businessId, businessId),
      ),
    );
  if (
    !policy ||
    !metadata ||
    !policy.grant ||
    policy.visibility !== "current" ||
    !policy.lastSyncedAt ||
    policy.lastSyncedAt.getTime() + 300000 <= at.getTime() ||
    !permissionAllows(policy.configuration, policy.grant, at)
  )
    return false;
  const [connection] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.id, policy.connectionId),
        eq(senderConnection.businessId, businessId),
      ),
    );
  return Boolean(
    connection?.configuration.enabled &&
    connection.version === policy.connectionVersion &&
    selectedMetadata(
      policy.configuration,
      metadata,
      "1970-01-01T00:00:00Z",
      "incremental",
    ),
  );
}

/** Generic reply routes currently promise complete capture. A folder/thread selection cannot establish that promise. */
export async function mailboxReplyReady(
  tx: Transaction,
  businessId: string,
  id: string,
  at: Date,
  replyConnectionId: string,
) {
  const [policy] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(eq(mailboxPolicy.id, id), eq(mailboxPolicy.businessId, businessId)),
    );
  if (!policy || policy.connectionId !== replyConnectionId) return false;
  if (
    policy.configuration.scope.kind !== "mailbox" ||
    !policy.completeReplyCapture ||
    policy.visibility !== "current" ||
    !policy.lastSyncedAt ||
    policy.lastSyncedAt.getTime() + 300000 <= at.getTime() ||
    !policy.grant ||
    !permissionAllows(policy.configuration, policy.grant, at)
  )
    return false;
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
    !connection?.configuration.enabled ||
    connection.version !== policy.connectionVersion
  )
    return false;
  const jobs = await tx
    .select()
    .from(mailboxJob)
    .where(
      and(
        eq(mailboxJob.businessId, businessId),
        eq(mailboxJob.mailboxId, id),
        eq(mailboxJob.policyVersion, policy.version),
      ),
    );
  const incremental = jobs.filter((job) => job.state.mode === "incremental");
  return (
    incremental.length > 0 &&
    incremental.every((job) => job.state.status === "completed")
  );
}
