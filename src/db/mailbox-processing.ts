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
} from "./schema";

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
