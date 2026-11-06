import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { HandoffSource } from "../models/email-handoffs";
import type { IncomingInquiry } from "../models/inbox";
import type { MailManual } from "../models/mail-native";
import {
  permissionAllows,
  selectedMetadata,
  type MailboxMetadata,
} from "../models/mailboxes";
import { requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  emailHandoff,
  emailHandoffEvidence,
  campaignRevision,
  gmailManualMessage,
  inboxMessage,
  inboxConnection,
  mailboxPolicy,
  mailboxJob,
  senderConnection,
  senderIdentity,
  gmailGrant,
  microsoftMailGrant,
} from "./schema";

type Handoff = typeof emailHandoff.$inferSelect;
type NativeObservation = {
  id: string;
  event: IncomingInquiry | MailManual;
  metadata: MailboxMetadata;
  generation: number | null;
};
const lines = (value: string) => value.replace(/\r\n|\r/g, "\n");

/** Functioning scoped observations can coexist with an explicit association review. They never establish complete reply capture. */
async function currentMailbox(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
  at: Date,
) {
  const [p] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, businessId),
        eq(mailboxPolicy.id, mailboxId),
      ),
    );
  if (
    !p?.grant ||
    !p.lastSyncedAt ||
    p.lastSyncedAt > at ||
    p.lastSyncedAt.getTime() + 300000 <= at.getTime() ||
    !permissionAllows(p.configuration, p.grant, at) ||
    !["current", "limited"].includes(p.visibility)
  )
    return null;
  const [connection] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.businessId, businessId),
        eq(senderConnection.id, p.connectionId),
      ),
    );
  const [inbox] = await tx
    .select()
    .from(inboxConnection)
    .where(
      and(
        eq(inboxConnection.businessId, businessId),
        eq(inboxConnection.id, p.id),
      ),
    );
  if (
    !connection?.configuration.enabled ||
    connection.version !== p.connectionVersion ||
    connection.configuration.account !== p.account ||
    connection.configuration.provider !== p.provider ||
    !inbox?.active ||
    inbox.mode !== "mailbox"
  )
    return null;
  const table = p.provider === "gmail" ? gmailGrant : microsoftMailGrant;
  const [oauth] = await tx
    .select()
    .from(table)
    .where(and(eq(table.businessId, businessId), eq(table.id, p.id)));
  if (oauth?.status !== "connected") return null;
  const jobs = await tx
    .select()
    .from(mailboxJob)
    .where(
      and(
        eq(mailboxJob.businessId, businessId),
        eq(mailboxJob.mailboxId, p.id),
        eq(mailboxJob.policyVersion, p.version),
      ),
    );
  const incremental = jobs.filter((j) => j.state.mode === "incremental");
  if (
    !incremental.length ||
    incremental.some(
      (j) =>
        j.state.status !== "completed" ||
        (j.state.reason &&
          !["manual_reply_review", "reply_association_review"].includes(
            j.state.reason,
          )),
    )
  )
    return null;
  const latest = incremental.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  try {
    const role = await requireCapability(
      tx,
      latest.identity,
      businessId,
      "integrations.manage",
    );
    await requireSalesSession(tx, latest.identity, at, role);
  } catch (error: unknown) {
    if (!(error instanceof ApplicationError)) throw error;
    return null;
  }
  return { policy: p, generation: oauth.generation };
}
async function observations(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
): Promise<NativeObservation[]> {
  const sent = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, businessId),
        eq(gmailManualMessage.mailboxId, mailboxId),
      ),
    );
  const incoming = await tx
    .select()
    .from(inboxMessage)
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessage.connectionId, mailboxId),
      ),
    );
  return [
    ...sent.map((r) => ({
      id: r.id,
      event: r.content,
      metadata: r.currentMetadata ?? r.metadata,
      generation: r.nativeSyncGeneration,
    })),
    ...incoming.flatMap((r) => {
      const metadata = r.mailboxCurrentMetadata ?? r.mailboxMetadata;
      return metadata
        ? [
            {
              id: r.id,
              event: r.content,
              metadata,
              generation: r.nativeSyncGeneration,
            },
          ]
        : [];
    }),
  ];
}
function sourceFor(
  state: NonNullable<Awaited<ReturnType<typeof currentMailbox>>>,
  o: NativeObservation,
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
export async function handoffObservations(
  tx: Transaction,
  row: Handoff,
  at: Date,
) {
  const [r] = await tx
    .select()
    .from(campaignRevision)
    .where(
      and(
        eq(campaignRevision.businessId, row.businessId),
        eq(campaignRevision.id, row.revisionId),
      ),
    );
  if (!r || r.payloadHash !== row.payloadHash)
    throw new ApplicationError("CONFLICT");
  const [identity] = await tx
    .select()
    .from(senderIdentity)
    .where(
      and(
        eq(senderIdentity.businessId, row.businessId),
        eq(senderIdentity.id, r.snapshot.senderIdentityId),
      ),
    );
  const connectionId = r.snapshot.sender.connectionId;
  if (
    !identity?.configuration.enabled ||
    identity.version !== r.snapshot.senderVersion ||
    identity.connectionId !== connectionId ||
    !connectionId
  )
    return { visibility: "unavailable" as const, candidates: [] };
  const policies = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, row.businessId),
        eq(mailboxPolicy.connectionId, connectionId),
      ),
    );
  const p = policies[0];
  const current = p && (await currentMailbox(tx, row.businessId, p.id, at));
  if (!current || p.account !== r.snapshot.sender.fromAddress)
    return { visibility: "unavailable" as const, candidates: [] };
  const records = await observations(tx, row.businessId, p.id);
  const recipient = r.snapshot.recipients.find(
    (c) => c.contactId === row.contactId,
  );
  const candidates = records.flatMap((o) => {
    const e = o.event,
      m = o.metadata,
      source = sourceFor(current, o);
    if (
      !source ||
      e.kind !== "manual_reply" ||
      m.native?.direction !== "manual_reply" ||
      e.native.from !== p.account ||
      e.native.to.length !== 1 ||
      e.native.to[0] !== recipient?.address ||
      new Date(e.occurredAt) < row.at ||
      e.subject !== r.snapshot.steps[0].subject ||
      lines(e.text) !== lines(r.snapshot.steps[0].body)
    )
      return [];
    const inSent =
      p.provider === "gmail"
        ? m.folderRefs.includes("SENT")
        : m.folderRefs.includes(p.grant!.microsoft?.sentFolderRef ?? "");
    // Duplicate RFC identities cannot be disambiguated by equal content or recipient.
    if (
      !inSent ||
      records.filter(
        (other) =>
          other.metadata.native?.internetMessageId === source.internetMessageId,
      ).length !== 1
    )
      return [];
    return [{ id: o.id, source, subject: e.subject, body: e.text }];
  });
  const linked = await tx
    .select()
    .from(emailHandoffEvidence)
    .where(eq(emailHandoffEvidence.businessId, row.businessId));
  return {
    visibility:
      p.visibility === "current" &&
      p.configuration.scope.kind === "mailbox" &&
      p.completeReplyCapture
        ? ("current" as const)
        : ("limited" as const),
    candidates: candidates.filter(
      (c) =>
        !linked.some(
          (e) =>
            e.sourceKey === `${p.id}:${c.source.messageRef}` &&
            e.handoffId !== row.id,
        ),
    ),
  };
}
export async function appendHandoffObservation(
  tx: Transaction,
  actor: WorkIdentity,
  row: Handoff,
  kind: "sent_folder_observed" | "reply_observed",
  source: HandoffSource,
  at: Date,
) {
  const sourceKey = `${source.mailboxId}:${source.messageRef}`;
  const [existing] = await tx
    .select()
    .from(emailHandoffEvidence)
    .where(
      and(
        eq(emailHandoffEvidence.businessId, row.businessId),
        eq(emailHandoffEvidence.sourceKey, sourceKey),
      ),
    );
  if (existing) {
    if (existing.handoffId !== row.id || existing.kind !== kind)
      throw new ApplicationError("CONFLICT");
    return;
  }
  await tx
    .insert(emailHandoffEvidence)
    .values({
      id: randomUUID(),
      businessId: row.businessId,
      handoffId: row.id,
      kind,
      sourceKey,
      source,
      actorId: actor.userId,
      at,
    });
}
/** Only a prior explicit native Sent binding permits reply correlation; subject or recipient equality is insufficient. */
export async function reconcileHandoffReplies(
  tx: Transaction,
  actor: WorkIdentity,
  businessId: string,
  at: Date,
) {
  const handoffs = await tx
    .select()
    .from(emailHandoff)
    .where(eq(emailHandoff.businessId, businessId));
  for (const row of handoffs) {
    const events = await tx
      .select()
      .from(emailHandoffEvidence)
      .where(
        and(
          eq(emailHandoffEvidence.businessId, businessId),
          eq(emailHandoffEvidence.handoffId, row.id),
          eq(emailHandoffEvidence.kind, "sent_folder_observed"),
        ),
      );
    const sent = events[0]?.source;
    if (
      !sent ||
      (await handoffObservations(tx, row, at)).visibility === "unavailable"
    )
      continue;
    const state = await currentMailbox(tx, businessId, sent.mailboxId, at);
    if (!state || state.generation !== sent.syncGeneration) continue;
    const [revision] = await tx
      .select()
      .from(campaignRevision)
      .where(
        and(
          eq(campaignRevision.businessId, businessId),
          eq(campaignRevision.id, row.revisionId),
        ),
      );
    const recipient = revision?.snapshot.recipients.find(
      (c) => c.contactId === row.contactId,
    );
    const records = await observations(tx, businessId, sent.mailboxId);
    if (
      records.filter(
        (o) => o.metadata.native?.internetMessageId === sent.internetMessageId,
      ).length !== 1
    )
      continue;
    for (const o of records) {
      const native = o.metadata.native,
        source = sourceFor(state, o);
      if (
        !source ||
        !native ||
        native.direction !== "incoming" ||
        o.event.kind === "manual_reply" ||
        native.from !== recipient?.address ||
        !native.to.includes(state.policy.account) ||
        source.threadRef !== sent.threadRef ||
        source.inReplyTo !== sent.internetMessageId ||
        new Date(source.occurredAt) < new Date(sent.occurredAt)
      )
        continue;
      if (
        records.filter(
          (other) =>
            other.metadata.native?.internetMessageId ===
            source.internetMessageId,
        ).length !== 1
      )
        continue;
      await appendHandoffObservation(
        tx,
        actor,
        row,
        "reply_observed",
        source,
        at,
      );
    }
  }
}
