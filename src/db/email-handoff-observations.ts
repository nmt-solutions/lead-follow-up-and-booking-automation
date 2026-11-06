import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import type { HandoffSource } from "../models/email-handoffs";
import {
  handoffSyncFresh,
  handoffSyncCompleted,
  handoffVisibility,
  handoffSource,
  exactHandoffSent,
  exactHandoffReply,
  type HandoffObservation,
} from "../application/email-handoff-policy";
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

/** Functioning scoped observations can coexist with an explicit association review. They never establish complete reply capture. */
async function currentMailbox(
  tx: Transaction,
  businessId: string,
  p: typeof mailboxPolicy.$inferSelect,
  at: Date,
) {
  if (!handoffSyncFresh(p, at)) return null;
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
  if (!handoffSyncCompleted(incremental.map((j) => j.state))) return null;
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
): Promise<HandoffObservation[]> {
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
type MailboxFacts = {
  state: NonNullable<Awaited<ReturnType<typeof currentMailbox>>>;
  records: HandoffObservation[];
  messageIds: Map<string, number>;
};
/** Invocation-scoped only: never reuse this cache across commands or final time-boundary checks. */
export type HandoffObservationCache = Map<string, Promise<MailboxFacts | null>>;
async function mailboxFacts(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  at: Date,
  cache: HandoffObservationCache,
) {
  let pending = cache.get(connectionId);
  if (!pending) {
    pending = (async () => {
      const [policy] = await tx
        .select()
        .from(mailboxPolicy)
        .where(
          and(
            eq(mailboxPolicy.businessId, businessId),
            eq(mailboxPolicy.connectionId, connectionId),
          ),
        );
      const state =
        policy && (await currentMailbox(tx, businessId, policy, at));
      if (!state) return null;
      const records = await observations(tx, businessId, policy.id);
      const messageIds = new Map<string, number>();
      for (const o of records) {
        const ref = o.metadata.native?.internetMessageId;
        if (ref) messageIds.set(ref, (messageIds.get(ref) ?? 0) + 1);
      }
      return { state, records, messageIds };
    })();
    cache.set(connectionId, pending);
  }
  return pending;
}
async function handoffContext(
  tx: Transaction,
  row: Handoff,
  at: Date,
  cache: HandoffObservationCache,
) {
  const [revision] = await tx
    .select()
    .from(campaignRevision)
    .where(
      and(
        eq(campaignRevision.businessId, row.businessId),
        eq(campaignRevision.id, row.revisionId),
      ),
    );
  if (!revision || revision.payloadHash !== row.payloadHash)
    throw new ApplicationError("CONFLICT");
  const [identity] = await tx
    .select()
    .from(senderIdentity)
    .where(
      and(
        eq(senderIdentity.businessId, row.businessId),
        eq(senderIdentity.id, revision.snapshot.senderIdentityId),
      ),
    );
  const connectionId = revision.snapshot.sender.connectionId;
  if (
    !identity?.configuration.enabled ||
    identity.version !== revision.snapshot.senderVersion ||
    identity.connectionId !== connectionId ||
    !connectionId
  )
    return null;
  const facts = await mailboxFacts(tx, row.businessId, connectionId, at, cache);
  if (
    !facts ||
    facts.state.policy.account !== revision.snapshot.sender.fromAddress
  )
    return null;
  const recipient = revision.snapshot.recipients.find(
    (c) => c.contactId === row.contactId,
  );
  if (!recipient) throw new ApplicationError("CONFLICT");
  return { revision, recipient, facts };
}
export async function handoffObservations(
  tx: Transaction,
  row: Handoff,
  at: Date,
  cache: HandoffObservationCache = new Map(),
) {
  const context = await handoffContext(tx, row, at, cache);
  if (!context) return { visibility: "unavailable" as const, candidates: [] };
  const {
    revision,
    recipient,
    facts: { state, records, messageIds },
  } = context;
  const approved = {
    fromAddress: revision.snapshot.sender.fromAddress,
    recipient: recipient.address,
    ...revision.snapshot.steps[0],
    preparedAt: row.at,
  };
  const candidates = records.flatMap((o) => {
    const source = handoffSource(state, o);
    if (
      !source ||
      !exactHandoffSent(
        approved,
        state,
        o,
        messageIds.get(source.internetMessageId) === 1,
      )
    )
      return [];
    return [{ id: o.id, source, subject: o.event.subject, body: o.event.text }];
  });
  const linked = await tx
    .select({
      handoffId: emailHandoffEvidence.handoffId,
      sourceKey: emailHandoffEvidence.sourceKey,
    })
    .from(emailHandoffEvidence)
    .where(eq(emailHandoffEvidence.businessId, row.businessId));
  return {
    visibility: handoffVisibility(state.policy),
    candidates: candidates.filter(
      (c) =>
        !linked.some(
          (e) =>
            e.sourceKey === `${state.policy.id}:${c.source.messageRef}` &&
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
    return false;
  }
  await tx.insert(emailHandoffEvidence).values({
    id: randomUUID(),
    businessId: row.businessId,
    handoffId: row.id,
    kind,
    sourceKey,
    source,
    actorId: actor.userId,
    at,
  });
  return true;
}
/** Only a prior explicit native Sent binding permits reply correlation; subject or recipient equality is insufficient. */
export async function reconcileHandoffReplies(
  tx: Transaction,
  actor: WorkIdentity,
  businessId: string,
  clock: Clock,
) {
  const at = clock.now();
  const handoffs = await tx
    .select()
    .from(emailHandoff)
    .where(eq(emailHandoff.businessId, businessId));
  const cache: HandoffObservationCache = new Map();
  const changed = new Map<string, MailboxFacts["state"]>();
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
    if (!sent) continue;
    const context = await handoffContext(tx, row, at, cache);
    if (!context) continue;
    const {
      recipient,
      facts: { state, records, messageIds },
    } = context;
    if (
      state.policy.id !== sent.mailboxId ||
      state.generation !== sent.syncGeneration ||
      messageIds.get(sent.internetMessageId) !== 1
    )
      continue;
    for (const o of records) {
      const source = handoffSource(state, o);
      if (
        !source ||
        !exactHandoffReply(
          { sent, recipient: recipient.address, account: state.policy.account },
          o,
          source,
          messageIds.get(source.internetMessageId) === 1,
        )
      )
        continue;
      if (
        await appendHandoffObservation(
          tx,
          actor,
          row,
          "reply_observed",
          source,
          clock.now(),
        )
      )
        changed.set(state.policy.id, state);
    }
  }
  for (const state of changed.values())
    if (!(await currentMailbox(tx, businessId, state.policy, clock.now())))
      throw new ApplicationError("CONFLICT");
}
