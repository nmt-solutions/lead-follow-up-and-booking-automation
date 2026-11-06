import { and, eq } from "drizzle-orm";
import type { MailEnvelope, MailDispatchAccess } from "../models/mail-dispatch";
import type { Transaction } from "./scope";
import {
  gmailGrant,
  microsoftMailGrant,
  mailboxPolicy,
  senderConnection,
} from "./schema";
import { invalidateMailboxVisibility } from "./mailbox-visibility";
import { recordSenderConnectionFailure } from "./sender-health-repository";
import { currentMailbox } from "./email-handoff-observations";
import { gmailReadScope, gmailSendScope } from "../models/gmail";

/** Readiness for registered RFC replies and associated native inquiry threads, never general mailbox completeness. */
export async function nativeSequenceReplyReady(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
  connectionId: string,
  at: Date,
  provider: "gmail" | "microsoft" = "gmail",
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
    policy.provider !== provider ||
    policy.connectionId !== connectionId ||
    policy.configuration.scope.kind !== "mailbox" ||
    policy.visibility !== "current"
  )
    return false;
  const grants = provider === "gmail" ? gmailGrant : microsoftMailGrant;
  const [grant] = await tx
    .select()
    .from(grants)
    .where(and(eq(grants.businessId, businessId), eq(grants.id, mailboxId)));
  return Boolean(
    grant?.status === "connected" &&
    grant.scopes.includes(
      provider === "gmail" ? gmailReadScope : "Mail.Read",
    ) &&
    (await currentMailbox(tx, businessId, policy, at)),
  );
}

export async function nativeSendingAuthorized(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  account: string,
  provider: "gmail" | "microsoft" = "gmail",
) {
  const grants = provider === "gmail" ? gmailGrant : microsoftMailGrant;
  const rows = await tx
    .select({ policy: mailboxPolicy, grant: grants })
    .from(mailboxPolicy)
    .leftJoin(
      grants,
      and(eq(grants.businessId, businessId), eq(grants.id, mailboxPolicy.id)),
    )
    .where(
      and(
        eq(mailboxPolicy.businessId, businessId),
        eq(mailboxPolicy.connectionId, connectionId),
      ),
    );
  return (
    rows.length === 1 &&
    rows[0].policy.provider === provider &&
    rows[0].policy.account === account &&
    rows[0].policy.configuration.enabled &&
    rows[0].policy.configuration.requestedSend &&
    rows[0].grant?.status === "connected" &&
    Boolean(
      rows[0].grant.credentials &&
      rows[0].grant.accountSubject &&
      rows[0].grant.scopes.includes(
        provider === "gmail" ? gmailSendScope : "Mail.Send",
      ),
    )
  );
}

/** Called only within the authenticated, locked dispatch transaction; never opens a nested transaction. */
export async function nativeDispatchAccess(
  tx: Transaction,
  envelope: Pick<MailEnvelope, "businessId" | "connectionId" | "fromAddress">,
  previousReceipt: MailDispatchAccess["previousReceipt"],
  previousSubject: string | null,
  confirm: MailDispatchAccess["confirm"],
  replyParent?: MailDispatchAccess["replyParent"],
  now: () => Date = () => new Date(),
): Promise<MailDispatchAccess> {
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
  const provider = policy?.provider;
  if (!policy || !provider || policy.account !== envelope.fromAddress)
    return {
      gmail: null,
      previousReceipt,
      previousSubject,
      replyParent,
      confirm,
    };
  const [connection] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.businessId, envelope.businessId),
        eq(senderConnection.id, envelope.connectionId),
      ),
    );
  const grants = provider === "gmail" ? gmailGrant : microsoftMailGrant;
  const [grant] = await tx
    .select()
    .from(grants)
    .where(
      and(eq(grants.businessId, envelope.businessId), eq(grants.id, policy.id)),
    );
  return {
    previousReceipt,
    previousSubject,
    replyParent,
    confirm,
    gmail: null,
    [provider === "gmail" ? "gmail" : "microsoft"]: {
      policy,
      grant,
      processingEnabled: Boolean(
        policy.configuration.enabled &&
        connection?.configuration.enabled &&
        connection.configuration.provider === provider &&
        connection.configuration.account === envelope.fromAddress &&
        connection.version === policy.connectionVersion,
      ),
      async updateGrant(
        change: Parameters<
          NonNullable<MailDispatchAccess["gmail"]>["updateGrant"]
        >[0],
      ) {
        await tx
          .update(grants)
          .set(change)
          .where(
            and(
              eq(grants.businessId, envelope.businessId),
              eq(grants.id, policy.id),
            ),
          );
        if (grant) Object.assign(grant, change);
        if (
          change.reason === "revoked" ||
          change.reason === "insufficient" ||
          change.status === "insufficient" ||
          change.status === "reconnect_required"
        )
          await recordSenderConnectionFailure(
            tx,
            envelope.businessId,
            policy.connectionId,
            now(),
            change.reason === "revoked" ? "revoked" : "insufficient",
          );
      },
      invalidate: () =>
        invalidateMailboxVisibility(tx, envelope.businessId, policy.id),
    },
  };
}
