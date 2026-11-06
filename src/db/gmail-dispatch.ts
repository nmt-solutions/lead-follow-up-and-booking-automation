import { and, eq } from "drizzle-orm";
import type {
  SequenceEnvelope,
  SequenceMailAccess,
} from "../models/email-sequences";
import type { Transaction } from "./scope";
import { gmailGrant, mailboxPolicy, senderConnection } from "./schema";
import { invalidateMailboxVisibility } from "./mailbox-visibility";
import { currentMailbox } from "./email-handoff-observations";
import { gmailReadScope, gmailSendScope } from "../models/gmail";

/** Readiness for exact RFC references registered by this sequence contract, never general mailbox completeness. */
export async function gmailSequenceReplyReady(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
  connectionId: string,
  at: Date,
) {
  const [policy] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, businessId),
        eq(mailboxPolicy.id, mailboxId),
      ),
    );
  if (
    !policy ||
    policy.provider !== "gmail" ||
    policy.connectionId !== connectionId ||
    policy.configuration.scope.kind !== "mailbox" ||
    policy.visibility !== "current"
  )
    return false;
  const [grant] = await tx
    .select()
    .from(gmailGrant)
    .where(
      and(eq(gmailGrant.businessId, businessId), eq(gmailGrant.id, mailboxId)),
    );
  return Boolean(
    grant?.status === "connected" &&
    grant.scopes.includes(gmailReadScope) &&
    (await currentMailbox(tx, businessId, policy, at)),
  );
}

export async function gmailSendingAuthorized(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  account: string,
) {
  const rows = await tx
    .select({ policy: mailboxPolicy, grant: gmailGrant })
    .from(mailboxPolicy)
    .leftJoin(
      gmailGrant,
      and(
        eq(gmailGrant.businessId, businessId),
        eq(gmailGrant.id, mailboxPolicy.id),
      ),
    )
    .where(
      and(
        eq(mailboxPolicy.businessId, businessId),
        eq(mailboxPolicy.connectionId, connectionId),
      ),
    );
  return (
    rows.length === 1 &&
    rows[0].policy.provider === "gmail" &&
    rows[0].policy.account === account &&
    rows[0].policy.configuration.enabled &&
    rows[0].policy.configuration.requestedSend &&
    rows[0].grant?.status === "connected" &&
    Boolean(
      rows[0].grant.credentials &&
      rows[0].grant.accountSubject &&
      rows[0].grant.scopes.includes(gmailSendScope),
    )
  );
}

/** Called only within the authenticated, locked dispatch transaction; never opens a nested transaction. */
export async function gmailDispatchAccess(
  tx: Transaction,
  envelope: SequenceEnvelope,
  previousReceipt: SequenceMailAccess["previousReceipt"],
  previousSubject: string | null,
  confirm: SequenceMailAccess["confirm"],
): Promise<SequenceMailAccess> {
  const policies = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, envelope.businessId),
        eq(mailboxPolicy.connectionId, envelope.connectionId),
      ),
    );
  const policy = policies.length === 1 ? policies[0] : null;
  if (
    !policy ||
    policy.provider !== "gmail" ||
    policy.account !== envelope.fromAddress
  )
    return { gmail: null, previousReceipt, previousSubject, confirm };
  const [connection] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.businessId, envelope.businessId),
        eq(senderConnection.id, envelope.connectionId),
      ),
    );
  const [grant] = await tx
    .select()
    .from(gmailGrant)
    .where(
      and(
        eq(gmailGrant.businessId, envelope.businessId),
        eq(gmailGrant.id, policy.id),
      ),
    );
  return {
    previousReceipt,
    previousSubject,
    confirm,
    gmail: {
      policy,
      grant,
      processingEnabled: Boolean(
        policy.configuration.enabled &&
        connection?.configuration.enabled &&
        connection.configuration.provider === "gmail" &&
        connection.configuration.account === envelope.fromAddress &&
        connection.version === policy.connectionVersion,
      ),
      async updateGrant(change) {
        await tx
          .update(gmailGrant)
          .set(change)
          .where(
            and(
              eq(gmailGrant.businessId, envelope.businessId),
              eq(gmailGrant.id, policy.id),
            ),
          );
      },
      invalidate: () =>
        invalidateMailboxVisibility(tx, envelope.businessId, policy.id),
    },
  };
}
