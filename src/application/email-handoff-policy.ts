import type { HandoffSource } from "../models/email-handoffs";
import type { IncomingInquiry } from "../models/inbox";
import type { MailManual } from "../models/mail-native";
import {
  permissionAllows,
  selectedMetadata,
  type MailboxConfiguration,
  type MailboxGrant,
  type MailboxJobState,
  type MailboxMetadata,
} from "../models/mailboxes";

export type HandoffObservation = {
  id: string;
  event: IncomingInquiry | MailManual;
  metadata: MailboxMetadata;
  generation: number | null;
};
type Policy = {
  id: string;
  connectionId: string;
  version: number;
  provider: "gmail" | "microsoft";
  configuration: MailboxConfiguration;
  incrementalSince: Date;
  grant: MailboxGrant | null;
  visibility: string;
  lastSyncedAt: Date | null;
  completeReplyCapture: boolean;
};
export type HandoffSync = { policy: Policy; generation: number };
export function handoffSyncFresh(p: Policy, at: Date) {
  return Boolean(
    p.grant &&
    p.lastSyncedAt &&
    p.lastSyncedAt <= at &&
    p.lastSyncedAt.getTime() + 300000 > at.getTime() &&
    permissionAllows(p.configuration, p.grant, at) &&
    ["current", "limited"].includes(p.visibility),
  );
}
/** Association review supports an individual scoped fact; gaps or unfinished work do not. */
export function handoffSyncCompleted(states: MailboxJobState[]) {
  return (
    states.length > 0 &&
    states.every(
      (s) =>
        s.status === "completed" &&
        (!s.reason ||
          ["manual_reply_review", "reply_association_review"].includes(
            s.reason,
          )),
    )
  );
}
export function handoffVisibility(p: Policy) {
  return p.visibility === "current" &&
    p.configuration.scope.kind === "mailbox" &&
    p.completeReplyCapture
    ? ("current" as const)
    : ("limited" as const);
}
export function handoffSource(
  state: HandoffSync,
  o: HandoffObservation,
): HandoffSource | null {
  const { metadata: m } = o,
    { policy: p } = state;
  if (
    !m.native ||
    o.generation !== state.generation ||
    !selectedMetadata(
      p.configuration,
      m,
      p.incrementalSince.toISOString(),
      "incremental",
    )
  )
    return null;
  return {
    provider: p.provider,
    mailboxId: p.id,
    connectionId: p.connectionId,
    policyVersion: p.version,
    syncGeneration: o.generation,
    messageRef: m.messageRef,
    threadRef: m.conversationRef,
    internetMessageId: m.native.internetMessageId,
    inReplyTo: m.native.inReplyTo,
    occurredAt: m.occurredAt,
  };
}
const lines = (value: string) => value.replace(/\r\n|\r/g, "\n");
export function exactHandoffSent(
  approved: {
    fromAddress: string;
    recipient: string;
    subject: string;
    body: string;
    preparedAt: Date;
  },
  sync: HandoffSync,
  o: HandoffObservation,
  uniqueMessageId: boolean,
) {
  const e = o.event,
    m = o.metadata;
  const inSent =
    sync.policy.provider === "gmail"
      ? m.folderRefs.includes("SENT")
      : m.folderRefs.includes(
          sync.policy.grant?.microsoft?.sentFolderRef ?? "",
        );
  return Boolean(
    uniqueMessageId &&
    inSent &&
    e.kind === "manual_reply" &&
    m.native?.direction === "manual_reply" &&
    e.native.from === approved.fromAddress &&
    e.native.to.length === 1 &&
    e.native.to[0] === approved.recipient &&
    new Date(e.occurredAt) >= approved.preparedAt &&
    e.subject === approved.subject &&
    lines(e.text) === lines(approved.body),
  );
}
/** Native thread + exact RFC parent + expected participants; text similarity conveys no authority. */
export function exactHandoffReply(
  context: { sent: HandoffSource; recipient: string; account: string },
  o: HandoffObservation,
  source: HandoffSource,
  uniqueMessageId: boolean,
) {
  const native = o.metadata.native;
  return Boolean(
    uniqueMessageId &&
    native?.direction === "incoming" &&
    o.event.kind !== "manual_reply" &&
    native.from === context.recipient &&
    native.to.includes(context.account) &&
    source.threadRef === context.sent.threadRef &&
    source.inReplyTo === context.sent.internetMessageId &&
    new Date(source.occurredAt) >= new Date(context.sent.occurredAt),
  );
}
