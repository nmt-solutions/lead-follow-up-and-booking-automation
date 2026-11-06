import { randomUUID } from "node:crypto";
import { reservePaidUsage, paidReservationCurrent } from "./paid-access";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { emailDispatchAuthorization } from "../models/email-eligibility";
import type { campaignRefSchema } from "../models/campaigns";
import {
  sequenceResultSchema,
  sequenceWorkSchema,
  type SequenceEnvelope,
  type SequenceEventKind,
  type SequenceMailProvider,
  type SequenceWork,
  type SequenceWorkspace,
  type configureSequenceSchema,
  type sequenceCommandSchema,
  type classifySequenceReplySchema,
} from "../models/email-sequences";
import { sequenceDue } from "../email-sequences/timing";
import {
  sequenceMailCall,
  selectSequenceMail,
} from "../email-sequences/provider";
import { createCampaignRepository } from "./campaign-repository";
import {
  createSequenceGate,
  sequencePolicyAt,
  sequenceRevision,
  sequenceUsage,
  recipientReservedAttempts,
} from "./email-sequence-context";
import type { Database } from "./runtime";
import { requireCapability, scoped, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  finishStoppedSequence,
  cancelSequenceRecipient,
} from "./email-sequence-observations";
import {
  emailSequenceRun,
  emailSequenceAction,
  emailSequenceEvent,
  emailSequencePolicy,
  inboxOpportunity,
  inboxMessage,
  platformOperator,
  session,
  gmailManualMessage,
  mailboxPolicy,
} from "./schema";
import { currentMailbox } from "./email-handoff-observations";
import { handoffSource } from "../application/email-handoff-policy";
import { incomingInquirySchema } from "../models/inbox";
import { captureInboxInquiry } from "./inbox-repository";
import { sequenceReference } from "./email-sequence-observations";
import { nativeDispatchAccess } from "./native-mail-dispatch";
import { microsoftTransportKey } from "../microsoft-mail/transport";
import { exactSequenceSent } from "./email-sequence-observations";
import { gmailSequenceKey } from "../gmail/sequence-mail";

type Run = typeof emailSequenceRun.$inferSelect;
type Action = typeof emailSequenceAction.$inferSelect;
export function createEmailSequenceRepository(
  database: Database,
  clock: Clock,
) {
  const campaigns = createCampaignRepository(database, clock);
  const evaluateSequence = createSequenceGate({ campaigns, clock });
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    run: (tx: Transaction) => Promise<T>,
    sessionRequired = true,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        if (sessionRequired)
          await requireSalesSession(tx, actor, clock.now(), role);
        return run(tx);
      },
      { lock: true },
    );
  }
  async function event(
    tx: Transaction,
    actor: WorkIdentity,
    run: Run,
    kind: SequenceEventKind,
    action: Action | null = null,
    reason: string | null = null,
    envelope: SequenceEnvelope | null = null,
    receipt: Action["receipt"] = null,
    note: string | null = null,
    source: SequenceWorkspace["runs"][number]["history"][number]["source"] = null,
  ) {
    await tx.insert(emailSequenceEvent).values({
      id: randomUUID(),
      businessId: run.businessId,
      runId: run.id,
      actionId: action?.id ?? null,
      kind,
      reason,
      attemptId: action?.attemptId ?? null,
      envelope,
      receipt,
      note,
      source,
      actorId: actor.userId,
      at: clock.now(),
    });
  }
  async function load(tx: Transaction, businessId: string, id: string) {
    const [run] = await tx
      .select()
      .from(emailSequenceRun)
      .where(
        and(
          eq(emailSequenceRun.businessId, businessId),
          eq(emailSequenceRun.id, id),
        ),
      );
    if (!run) throw new ApplicationError("NOT_FOUND");
    const revision = await sequenceRevision(
      tx,
      businessId,
      run.revisionId,
      run.payloadHash,
    );
    const actions = await tx
      .select()
      .from(emailSequenceAction)
      .where(
        and(
          eq(emailSequenceAction.businessId, businessId),
          eq(emailSequenceAction.runId, id),
        ),
      )
      .orderBy(asc(emailSequenceAction.stepIndex));
    return { run, revision, actions };
  }
  async function actionUpdate(
    tx: Transaction,
    a: Action,
    patch: Partial<typeof emailSequenceAction.$inferInsert>,
  ) {
    const [updated] = await tx
      .update(emailSequenceAction)
      .set(patch)
      .where(
        and(
          eq(emailSequenceAction.businessId, a.businessId),
          eq(emailSequenceAction.id, a.id),
        ),
      )
      .returning();
    return updated;
  }
  async function stopBeforeProvider(
    tx: Transaction,
    actor: WorkIdentity,
    run: Run,
    action: Action,
    reason: string,
  ) {
    const terminal = [
      "buyer_replied",
      "recipient_suppressed",
      "campaign_conversation_changed",
      "sequence_cancelled",
    ].includes(reason);
    await actionUpdate(tx, action, {
      state: terminal ? "cancelled" : "paused",
      reason,
      queueState: "none",
    });
    await event(
      tx,
      actor,
      run,
      terminal ? "cancelled" : "paused",
      action,
      reason,
    );
    if (terminal)
      await cancelSequenceRecipient(
        tx,
        run.businessId,
        action.opportunityId,
        reason,
      );
    await finishStoppedSequence(tx, run.businessId, run.id);
  }
  function work(run: Run, action: Action): SequenceWork {
    return {
      businessId: run.businessId,
      runId: run.id,
      actionId: action.id,
      key: action.key,
      generation: action.generation,
      identity: action.identity,
    };
  }
  async function loadWork(tx: Transaction, input: SequenceWork) {
    const c = await load(tx, input.businessId, input.runId),
      a = c.actions.find((a) => a.id === input.actionId);
    if (!a) throw new ApplicationError("NOT_FOUND");
    if (
      a.identity.userId !== input.identity.userId ||
      a.identity.sessionId !== input.identity.sessionId ||
      a.key !== input.key ||
      a.generation !== input.generation
    )
      throw new ApplicationError("CONFLICT");
    return { ...c, action: a };
  }
  async function view(
    tx: Transaction,
    actor: WorkIdentity,
    businessId: string,
    provider: SequenceMailProvider,
    queueReady: boolean,
  ): Promise<SequenceWorkspace> {
    const policy = await sequencePolicyAt(tx, businessId);
    const adapters = provider.adapters;
    if (!policy?.configuration.adapterKeys)
      provider = selectSequenceMail(
        provider,
        policy?.configuration.adapterKey ??
          provider.adapters?.[0]?.key ??
          provider.key,
      );
    const usage = policy
      ? await sequenceUsage(tx, businessId, policy.configuration, clock.now())
      : { reserved: 0, remaining: 0 };
    const setupIssues: string[] = [];
    if (provider.mode === "unconfigured")
      setupIssues.push("mail_adapter_unconfigured");
    if (!queueReady) setupIssues.push("durable_queue_unconfigured");
    if (!policy?.configuration.enabled)
      setupIssues.push("allowance_not_enabled");
    else {
      if (
        clock.now() < new Date(policy.configuration.periodStart) ||
        clock.now() >= new Date(policy.configuration.periodEnd)
      )
        setupIssues.push("allowance_period_inactive");
      if (
        (policy.configuration.adapterKeys
          ? policy.configuration.adapterKeys.some((key) => {
              const selected = selectSequenceMail(provider, key);
              return (
                selected.key !== key ||
                selected.mode !== policy.configuration.mode
              );
            })
          : policy.configuration.adapterKey !== provider.key) ||
        policy.configuration.mode !== provider.mode
      )
        setupIssues.push("allowance_adapter_changed");
      if (!usage.remaining) setupIssues.push("allowance_exhausted");
    }
    const [operator] = await tx
      .select()
      .from(platformOperator)
      .where(eq(platformOperator.userId, actor.userId));
    const role = await requireCapability(tx, actor, businessId, "sales.work");
    const retainedReplies = await tx
      .select()
      .from(gmailManualMessage)
      .where(eq(gmailManualMessage.businessId, businessId));
    const rows = await tx
      .select()
      .from(emailSequenceRun)
      .where(eq(emailSequenceRun.businessId, businessId))
      .orderBy(asc(emailSequenceRun.at));
    const runs: SequenceWorkspace["runs"] = [];
    for (const row of rows) {
      const { run, revision, actions } = await load(tx, businessId, row.id);
      const history = await tx
        .select()
        .from(emailSequenceEvent)
        .where(
          and(
            eq(emailSequenceEvent.businessId, businessId),
            eq(emailSequenceEvent.runId, row.id),
          ),
        )
        .orderBy(asc(emailSequenceEvent.at), asc(emailSequenceEvent.id));
      const progress =
        run.state === "cancelled"
          ? "stopped"
          : actions.every(
                (a) => a.state === "accepted" || a.state === "cancelled",
              )
            ? "completed"
            : actions.some(
                  (a) => a.state === "committed" || a.state === "unknown",
                )
              ? "awaiting_reconciliation"
              : actions.some((a) => a.state === "pending")
                ? "scheduled"
                : "needs_review";
      runs.push({
        id: run.id,
        revisionId: revision.id,
        payloadHash: run.payloadHash,
        name: revision.snapshot.name,
        version: run.version,
        state: run.state,
        reason: run.reason,
        progress,
        recipients: revision.snapshot.recipients.map((r) => ({
          contactId: r.contactId,
          recipient: r.address,
          opportunityId: actions.find((a) => a.contactId === r.contactId)!
            .opportunityId,
          actions: actions
            .filter((a) => a.contactId === r.contactId)
            .map((a) => ({
              id: a.id,
              stepIndex: a.stepIndex,
              subject: revision.snapshot.steps[a.stepIndex].subject,
              body: revision.snapshot.steps[a.stepIndex].body,
              state: a.state,
              reason: a.reason,
              dueAt: a.dueAt?.toISOString() ?? null,
              queueState: a.queueState,
              attempts: history.filter(
                (e) => e.actionId === a.id && e.kind === "attempt_reserved",
              ).length,
              receipt: a.receipt,
              processingAcceptance: a.processingAcceptance,
            })),
        })),
        history: history.map((e) => {
          const retained = e.source
            ? retainedReplies.find(
                (p) =>
                  p.mailboxId === e.source!.mailboxId &&
                  p.messageRef === e.source!.messageRef,
              )
            : null;
          const reply =
            retained && retained.content.kind !== "manual_reply"
              ? retained.content
              : null;
          return {
            id: e.id,
            actionId: e.actionId,
            kind: e.kind,
            reason: e.reason,
            at: e.at.toISOString(),
            actorId: e.actorId,
            receipt: e.receipt,
            processingAcceptance: e.processingAcceptance,
            source: e.source,
            note: e.note,
            reviewNeeded:
              e.kind === "reply_observed" &&
              retained?.state === "pending" &&
              Boolean(reply),
            reply: reply
              ? {
                  subject: reply.subject,
                  text: reply.text,
                  sender: reply.senderRef,
                  occurredAt: reply.occurredAt,
                }
              : null,
          };
        }),
      });
    }
    return {
      provider: { key: provider.key, mode: provider.mode },
      adapters,
      queueReady,
      setupIssues,
      canConfigure: operator?.emailPolicy ?? false,
      canClassify: role !== "salesperson",
      policy: policy
        ? { version: policy.version, configuration: policy.configuration }
        : null,
      usage: { reserved: usage.reserved, remaining: usage.remaining },
      runs,
    };
  }
  const repository = {
    classifyReply(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof classifySequenceReplySchema>,
    ) {
      return scope(actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "integrations.manage");
        const { run, actions } = await load(tx, businessId, input.runId);
        const [observed] = await tx
          .select()
          .from(emailSequenceEvent)
          .where(
            and(
              eq(emailSequenceEvent.businessId, businessId),
              eq(emailSequenceEvent.runId, run.id),
              eq(emailSequenceEvent.id, input.observationId),
            ),
          );
        if (
          observed?.kind !== "reply_observed" ||
          !observed.source ||
          !observed.actionId
        )
          throw new ApplicationError("NOT_FOUND");
        const action = actions.find((a) => a.id === observed.actionId);
        if (!action) throw new ApplicationError("CONFLICT");
        const classifications = await tx
          .select()
          .from(emailSequenceEvent)
          .where(
            and(
              eq(emailSequenceEvent.businessId, businessId),
              eq(emailSequenceEvent.actionId, action.id),
              eq(emailSequenceEvent.kind, "reply_classified"),
            ),
          );
        const seen = classifications.find(
          (e) =>
            e.source?.mailboxId === observed.source!.mailboxId &&
            e.source?.messageRef === observed.source!.messageRef,
        );
        if (seen) {
          if (
            seen.actorId !== actor.userId ||
            seen.reason !== input.classification ||
            seen.note !== input.note
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        const [record] = await tx
          .select()
          .from(gmailManualMessage)
          .where(
            and(
              eq(gmailManualMessage.businessId, businessId),
              eq(gmailManualMessage.mailboxId, observed.source.mailboxId),
              eq(gmailManualMessage.messageRef, observed.source.messageRef),
            ),
          );
        const [policy] = await tx
          .select()
          .from(mailboxPolicy)
          .where(
            and(
              eq(mailboxPolicy.businessId, businessId),
              eq(mailboxPolicy.id, observed.source.mailboxId),
            ),
          );
        const current = policy
          ? await currentMailbox(tx, businessId, policy, clock.now())
          : null;
        if (!record || record.state !== "pending" || !current)
          throw new ApplicationError("CONFLICT");
        const parsed = incomingInquirySchema.safeParse(record.content);
        if (!parsed.success)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        const metadata = record.currentMetadata ?? record.metadata;
        const source = handoffSource(current, {
          id: record.id,
          event: record.content,
          metadata,
          generation: record.nativeSyncGeneration,
        });
        if (
          !source ||
          source.internetMessageId !== observed.source.internetMessageId ||
          !source.inReplyTo
        )
          throw new ApplicationError("CONFLICT");
        const reference = await sequenceReference(
          tx,
          businessId,
          policy!.id,
          source.inReplyTo,
          [parsed.data.senderRef.toLowerCase()],
        );
        if (reference?.action.id !== action.id)
          throw new ApplicationError("CONFLICT");
        const result =
          input.classification === "qualifying_inquiry"
            ? await captureInboxInquiry(
                tx,
                actor,
                businessId,
                policy!.id,
                parsed.data,
                clock.now(),
                { since: new Date(policy!.incrementalSince), metadata },
              )
            : null;
        await tx
          .update(gmailManualMessage)
          .set({
            state: "applied",
            conversationId: result?.conversationId ?? null,
            opportunityId: action.opportunityId,
          })
          .where(
            and(
              eq(gmailManualMessage.businessId, businessId),
              eq(gmailManualMessage.id, record.id),
            ),
          );
        await tx.insert(emailSequenceEvent).values({
          id: randomUUID(),
          businessId,
          runId: run.id,
          actionId: action.id,
          kind: "reply_classified",
          reason: input.classification,
          note: input.note,
          source,
          actorId: actor.userId,
          at: clock.now(),
        });
      });
    },
    async recoveryWork() {
      const rows = await database.execute(
        sql`select payload from public.pending_email_sequence_work()`,
      );
      return rows.rows.map((row) => sequenceWorkSchema.parse(row.payload));
    },
    async workerStopped(
      input: SequenceWork,
      reason: "authorization_changed" | "worker_lost",
    ) {
      await database.execute(
        sql`select public.stop_email_sequence_work(${JSON.stringify(input)}::jsonb,${reason})`,
      );
    },
    workspace(
      actor: WorkIdentity,
      businessId: string,
      provider: SequenceMailProvider,
      queueReady: boolean,
    ) {
      return scope(actor, businessId, (tx) =>
        view(tx, actor, businessId, provider, queueReady),
      );
    },
    configure(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof configureSequenceSchema>,
    ) {
      return scope(actor, businessId, async (tx) => {
        const [operator] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (!operator?.emailPolicy) throw new ApplicationError("FORBIDDEN");
        const [s] = await tx
          .select()
          .from(session)
          .where(
            and(
              eq(session.id, actor.sessionId),
              eq(session.userId, actor.userId),
            ),
          );
        if (
          !s ||
          !(await hasMfa(tx, s.token, clock.now(), operatorMfaLifetime))
        )
          throw new ApplicationError("MFA_REQUIRED");
        const current = await sequencePolicyAt(tx, businessId);
        if ((current?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        await tx.insert(emailSequencePolicy).values({
          id: randomUUID(),
          businessId,
          version: input.expectedVersion + 1,
          configuration: input.policy,
          actorId: actor.userId,
          at: clock.now(),
        });
      });
    },
    command(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof sequenceCommandSchema>,
      provider: SequenceMailProvider,
    ) {
      return scope(actor, businessId, async (tx) => {
        const { run, revision, actions } = await load(
          tx,
          businessId,
          input.runId,
        );
        if (run.version !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        if (input.command === "recover") {
          await event(
            tx,
            actor,
            run,
            "reconciled",
            null,
            "recovery_requested",
            null,
            null,
            input.note,
          );
          return;
        }
        if (run.state === "cancelled" || run.state === "completed")
          throw new ApplicationError("CONFLICT");
        const state =
          input.command === "resume"
            ? "active"
            : input.command === "cancel"
              ? "cancelled"
              : "paused";
        if (input.command === "resume") {
          for (const a of actions.filter((a) =>
            ["paused", "failed", "waiting"].includes(a.state),
          )) {
            const prior = actions.filter(
              (p) => p.contactId === a.contactId && p.stepIndex < a.stepIndex,
            );
            if (prior.some((p) => p.state === "cancelled")) continue;
            const [need] = await tx
              .select()
              .from(inboxOpportunity)
              .where(
                and(
                  eq(inboxOpportunity.businessId, businessId),
                  eq(inboxOpportunity.id, a.opportunityId),
                ),
              );
            if (
              !need ||
              need.ownerId !== actor.userId ||
              need.controlState !== "automation"
            )
              continue;
            await actionUpdate(tx, a, { controlVersion: need.controlVersion });
            const gate = await evaluateSequence(tx, {
              actor: actor,
              businessId: businessId,
              revision: revision,
              action: {
                contactId: a.contactId,
                stepIndex: a.stepIndex,
                opportunityId: a.opportunityId,
                id: a.id,
              },
              provider: provider,
            });
            if (gate.reason !== null) continue;
            const usage = await sequenceUsage(
              tx,
              businessId,
              gate.policy,
              clock.now(),
            );
            const reservations = recipientReservedAttempts(
              usage.events,
              run.id,
              a.contactId,
              actions,
            );
            if (
              !usage.remaining ||
              reservations >= revision.snapshot.maxAttempts
            )
              continue;
            if (prior.some((p) => p.state !== "accepted")) {
              await actionUpdate(tx, a, {
                state: "waiting",
                reason: null,
                dueAt: null,
                queueState: "none",
                identity: actor,
                controlVersion: need.controlVersion,
              });
              continue;
            }
            const previous = actions.find(
              (p) =>
                p.contactId === a.contactId && p.stepIndex === a.stepIndex - 1,
            );
            const minimum = previous?.receipt
              ? new Date(previous.receipt.acceptedAt).getTime() +
                revision.snapshot.steps[a.stepIndex].delayMinutes * 60000
              : 0;
            await actionUpdate(tx, a, {
              state: "pending",
              reason: null,
              dueAt: sequenceDue(
                revision.snapshot.timing!,
                new Date(
                  Math.max(
                    clock.now().getTime(),
                    a.dueAt?.getTime() ?? minimum,
                  ),
                ),
              ),
              generation: a.generation + 1,
              key: randomUUID(),
              queueState: "pending",
              queueRunId: null,
              identity: actor,
              controlVersion: need.controlVersion,
            });
          }
        } else {
          for (const a of actions.filter((a) =>
            ["waiting", "pending", "paused", "failed"].includes(a.state),
          ))
            await actionUpdate(tx, a, {
              state:
                input.command === "cancel"
                  ? "cancelled"
                  : a.state === "waiting"
                    ? "waiting"
                    : "paused",
              reason:
                input.command === "cancel"
                  ? "sequence_cancelled"
                  : "sequence_paused",
              queueState: "none",
            });
        }
        await tx
          .update(emailSequenceRun)
          .set({
            state,
            reason:
              state === "active"
                ? null
                : input.command === "cancel"
                  ? "sequence_cancelled"
                  : "sequence_paused",
            version: run.version + 1,
            ...(input.command === "resume" ? { identity: actor } : {}),
          })
          .where(
            and(
              eq(emailSequenceRun.businessId, businessId),
              eq(emailSequenceRun.id, run.id),
            ),
          );
        await event(
          tx,
          actor,
          run,
          input.command === "resume"
            ? "resumed"
            : input.command === "cancel"
              ? "cancelled"
              : "paused",
          null,
          null,
          null,
          null,
          input.note,
        );
        return actions.flatMap((a) => (a.queueRunId ? [a.queueRunId] : []));
      });
    },
    async reconcile(
      actor: WorkIdentity,
      businessId: string,
      runId: string,
      provider: SequenceMailProvider,
      signal: AbortSignal,
    ) {
      // Read-only provider reconciliation is allowed after pause/cancel so accepted history remains accountable.
      const attempts = await scope(actor, businessId, async (tx) => {
        const { actions } = await load(tx, businessId, runId);
        const events = await tx
          .select()
          .from(emailSequenceEvent)
          .where(
            and(
              eq(emailSequenceEvent.businessId, businessId),
              eq(emailSequenceEvent.runId, runId),
              eq(emailSequenceEvent.kind, "attempt_reserved"),
            ),
          );
        return actions
          .filter((a) => a.state === "committed" || a.state === "unknown")
          .flatMap((a) => {
            const e = events.find((e) => e.attemptId === a.attemptId);
            return e?.envelope
              ? [
                  {
                    actionId: a.id,
                    attemptId: a.attemptId,
                    envelope: e.envelope,
                  },
                ]
              : [];
          });
      });
      for (const attempt of attempts) {
        const mailProvider = selectSequenceMail(
          provider,
          attempt.envelope.adapterKey,
        );
        if (
          mailProvider.mode === "unconfigured" ||
          mailProvider.key !== attempt.envelope.adapterKey ||
          mailProvider.mode !== attempt.envelope.adapterMode
        )
          continue;
        let result: unknown;
        try {
          result = await sequenceMailCall(
            (s) => mailProvider.reconcile(attempt.envelope, s),
            signal,
          );
        } catch {
          result = { status: "unknown" };
        }
        await scope(actor, businessId, async (tx) => {
          const { run, revision, actions } = await load(tx, businessId, runId),
            a = actions.find((a) => a.id === attempt.actionId);
          if (
            !a ||
            a.attemptId !== attempt.attemptId ||
            !["committed", "unknown"].includes(a.state)
          )
            return;
          let reconciledSource: SequenceWorkspace["runs"][number]["history"][number]["source"] =
            null;
          // Search absence cannot prove non-acceptance. Only an exact, currently authorized
          // observation from the existing selected sync can account for an unresolved native identity.
          if (
            [gmailSequenceKey, microsoftTransportKey].includes(mailProvider.key)
          ) {
            const observations = await tx
              .select()
              .from(emailSequenceEvent)
              .where(
                and(
                  eq(emailSequenceEvent.businessId, businessId),
                  eq(emailSequenceEvent.actionId, a.id),
                  eq(emailSequenceEvent.kind, "sent_folder_observed"),
                ),
              );
            const matches = observations.filter(
              (e) =>
                e.attemptId === a.attemptId &&
                e.source?.provider ===
                  (mailProvider.key === microsoftTransportKey
                    ? "microsoft"
                    : "gmail") &&
                e.source.connectionId === attempt.envelope.connectionId &&
                e.source.internetMessageId ===
                  attempt.envelope.internetMessageId,
            );
            if (matches.length === 1) {
              const source = matches[0].source!;
              const [policy] = await tx
                .select()
                .from(mailboxPolicy)
                .where(
                  and(
                    eq(mailboxPolicy.businessId, businessId),
                    eq(mailboxPolicy.id, source.mailboxId),
                  ),
                );
              const current = policy
                ? await currentMailbox(tx, businessId, policy, clock.now())
                : null;
              const [retained] = await tx
                .select()
                .from(gmailManualMessage)
                .where(
                  and(
                    eq(gmailManualMessage.businessId, businessId),
                    eq(gmailManualMessage.mailboxId, source.mailboxId),
                    eq(gmailManualMessage.messageRef, source.messageRef),
                  ),
                );
              const fresh =
                current && retained
                  ? handoffSource(current, {
                      id: retained.id,
                      event: retained.content,
                      metadata: retained.currentMetadata ?? retained.metadata,
                      generation: retained.nativeSyncGeneration,
                    })
                  : null;
              const metadata = retained?.currentMetadata ?? retained?.metadata;
              if (
                fresh &&
                fresh.provider === source.provider &&
                fresh.connectionId === attempt.envelope.connectionId &&
                policy?.account === attempt.envelope.fromAddress &&
                fresh.threadRef === source.threadRef &&
                fresh.internetMessageId === source.internetMessageId &&
                metadata?.native?.direction === "manual_reply" &&
                metadata.native.from === attempt.envelope.fromAddress &&
                metadata.native.to.length === 1 &&
                metadata.native.to[0] === attempt.envelope.recipient &&
                exactSequenceSent(
                  attempt.envelope,
                  retained!.content,
                  metadata,
                  policy!.provider === "gmail"
                    ? "SENT"
                    : (policy!.grant?.microsoft?.sentFolderRef ?? ""),
                  clock.now(),
                ) &&
                (
                  await tx
                    .select()
                    .from(gmailManualMessage)
                    .where(
                      and(
                        eq(gmailManualMessage.businessId, businessId),
                        eq(gmailManualMessage.mailboxId, source.mailboxId),
                      ),
                    )
                ).filter(
                  (r) =>
                    (r.currentMetadata ?? r.metadata).native
                      ?.internetMessageId ===
                    attempt.envelope.internetMessageId,
                ).length === 1 &&
                !(
                  await tx
                    .select()
                    .from(inboxMessage)
                    .where(
                      and(
                        eq(inboxMessage.businessId, businessId),
                        eq(inboxMessage.connectionId, source.mailboxId),
                      ),
                    )
                ).some(
                  (r) =>
                    (r.mailboxCurrentMetadata ?? r.mailboxMetadata)?.native
                      ?.internetMessageId ===
                    attempt.envelope.internetMessageId,
                )
              ) {
                reconciledSource = fresh;
                result = {
                  status: "accepted",
                  receipt: {
                    businessId,
                    actionId: a.id,
                    attemptId: a.attemptId,
                    connectionId: attempt.envelope.connectionId,
                    recipient: attempt.envelope.recipient,
                    messageRef: fresh.messageRef,
                    threadRef: fresh.threadRef,
                    internetMessageId: fresh.internetMessageId,
                    acceptedAt: fresh.occurredAt,
                    evidence: "sent_folder",
                  },
                };
              }
            }
          }
          const parsed = sequenceResultSchema.safeParse(result);
          await actionUpdate(tx, a, { recoveryAt: clock.now() });
          if (!parsed.success || parsed.data.status === "unknown") {
            await event(
              tx,
              actor,
              run,
              "reconciled",
              a,
              "acceptance_unresolved",
            );
            return;
          }
          await settle(
            tx,
            actor,
            run,
            a,
            revision,
            result,
            attempt.envelope,
            reconciledSource,
          );
          await event(tx, actor, run, "reconciled", a);
        });
      }
    },
    start(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof campaignRefSchema>,
      provider: SequenceMailProvider,
    ) {
      return scope(actor, businessId, async (tx) => {
        const r = await sequenceRevision(
          tx,
          businessId,
          input.revisionId,
          input.payloadHash,
        );
        const [seen] = await tx
          .select()
          .from(emailSequenceRun)
          .where(
            and(
              eq(emailSequenceRun.businessId, businessId),
              eq(emailSequenceRun.revisionId, r.id),
            ),
          );
        if (seen) return seen.id;
        for (const recipient of r.snapshot.recipients) {
          const gate = await evaluateSequence(tx, {
            actor: actor,
            businessId: businessId,
            revision: r,
            action: {
              contactId: recipient.contactId,
              stepIndex: 0,
              opportunityId: null,
            },
            provider: provider,
          });
          if (gate.reason !== null)
            throw new ApplicationError("CONFLICT", { cause: gate.reason });
        }
        if (!r.snapshot.timing) throw new ApplicationError("CONFLICT");
        const run: Run = {
          id: randomUUID(),
          businessId,
          revisionId: r.id,
          payloadHash: r.payloadHash,
          identity: actor,
          actorId: actor.userId,
          at: clock.now(),
          version: 1,
          state: "active",
          reason: null,
        };
        await tx.insert(emailSequenceRun).values(run);
        await event(tx, actor, run, "started");
        for (const recipient of r.snapshot.recipients) {
          const opportunityId = randomUUID();
          await tx.insert(inboxOpportunity).values({
            id: opportunityId,
            businessId,
            title: `${r.snapshot.name}: ${recipient.prospect.name}`,
            stage: "prospect",
            ownerId: actor.userId,
            controlState: "automation",
            controlVersion: 0,
            policyVersion: r.snapshot.authorityVersion,
            handoffReason:
              "Approved prospect sequence; no direct engagement established",
            nextAction: "Await approved email sequence and monitor replies",
            createdAt: clock.now(),
          });
          for (const [stepIndex] of r.snapshot.steps.entries()) {
            const [action] = await tx
              .insert(emailSequenceAction)
              .values({
                id: randomUUID(),
                businessId,
                runId: run.id,
                contactId: recipient.contactId,
                opportunityId,
                stepIndex,
                identity: actor,
                controlVersion: 0,
                state: stepIndex === 0 ? "pending" : "waiting",
                dueAt:
                  stepIndex === 0
                    ? sequenceDue(r.snapshot.timing, clock.now())
                    : null,
                generation: 1,
                key: randomUUID(),
                queueState: stepIndex === 0 ? "pending" : "none",
                actorId: actor.userId,
                at: clock.now(),
              })
              .returning();
            await event(tx, actor, run, "prepared", action);
          }
        }
        return run.id;
      });
    },
    pending(actor: WorkIdentity, businessId: string, runId: string) {
      return scope(actor, businessId, async (tx) => {
        const { run, actions } = await load(tx, businessId, runId);
        return run.state !== "active"
          ? []
          : actions
              .filter(
                (a) =>
                  a.state === "pending" &&
                  a.dueAt &&
                  a.queueState !== "enqueued",
              )
              .map((a) => ({ work: work(run, a), dueAt: a.dueAt! }));
      });
    },
    queueResult(input: SequenceWork, queueRunId: string | null) {
      return scope(input.identity, input.businessId, async (tx) => {
        const { run, action } = await loadWork(tx, input);
        if (action.state !== "pending" || run.state !== "active") return;
        await actionUpdate(tx, action, {
          queueState: queueRunId ? "enqueued" : "failed",
          queueRunId,
          reason: queueRunId ? null : "queue_unavailable",
        });
        if (!queueRunId)
          await event(
            tx,
            input.identity,
            run,
            "queue_failed",
            action,
            "queue_unavailable",
          );
      });
    },
    async execute(
      input: SequenceWork,
      provider: SequenceMailProvider,
      signal: AbortSignal,
    ) {
      // Persist the reservation before any provider call. A crash after this commit can only reconcile.
      const claim = await scope(
        input.identity,
        input.businessId,
        async (tx) => {
          const c = await loadWork(tx, input),
            { run, action, revision } = c;
          if (
            run.state !== "active" ||
            action.state !== "pending" ||
            !action.dueAt ||
            action.dueAt > clock.now()
          )
            return null;
          const gate = await evaluateSequence(tx, {
            actor: input.identity,
            businessId: input.businessId,
            revision: revision,
            action: {
              contactId: action.contactId,
              stepIndex: action.stepIndex,
              opportunityId: action.opportunityId,
              id: action.id,
            },
            provider: provider,
          });
          if (gate.reason !== null) {
            await stopBeforeProvider(
              tx,
              input.identity,
              run,
              action,
              gate.reason,
            );
            return null;
          }
          const usage = await sequenceUsage(
            tx,
            input.businessId,
            gate.policy,
            clock.now(),
          );
          const attempts = recipientReservedAttempts(
            usage.events,
            run.id,
            action.contactId,
            c.actions,
          );
          if (!usage.remaining || attempts >= revision.snapshot.maxAttempts) {
            await actionUpdate(tx, action, {
              state: "paused",
              reason:
                attempts >= revision.snapshot.maxAttempts
                  ? "attempt_cap"
                  : "allowance_exhausted",
              queueState: "none",
            });
            return null;
          }
          const latest = usage.events
            .map((e) => e.at)
            .sort((a, b) => a.getTime() - b.getTime())
            .at(-1);
          const earliest = sequenceDue(
            revision.snapshot.timing!,
            new Date(
              Math.max(
                clock.now().getTime(),
                latest
                  ? latest.getTime() + gate.policy.minIntervalSeconds * 1000
                  : 0,
              ),
            ),
          );
          if (earliest > clock.now()) {
            await actionUpdate(tx, action, {
              dueAt: earliest,
              generation: action.generation + 1,
              key: randomUUID(),
              queueState: "pending",
            });
            return null;
          }
          const attemptId = randomUUID();
          try {
            await reservePaidUsage(
              tx,
              input.businessId,
              "automation",
              attemptId,
              1,
              "provider calls",
              clock.now(),
            );
          } catch (error: unknown) {
            if (
              !(error instanceof ApplicationError) ||
              error.code !== "PAID_ACCESS_REQUIRED"
            )
              throw error;
            await stopBeforeProvider(
              tx,
              input.identity,
              run,
              action,
              "paid_automation_exhausted",
            );
            return null;
          }
          const committed = await actionUpdate(tx, action, {
            state: "committed",
            attemptId,
            reason: "dispatch_unconfirmed",
            queueState: "none",
          });
          const envelope: SequenceEnvelope = {
            adapterKey: gate.sender.evidence!.adapterKey,
            adapterMode:
              gate.sender.evidence!.mode === "fixture" ? "fixture" : "live",
            reservedAt: clock.now().toISOString(),
            businessId: input.businessId,
            runId: run.id,
            actionId: action.id,
            attemptId,
            opportunityId: action.opportunityId,
            revisionId: revision.id,
            payloadHash: revision.payloadHash,
            stepIndex: action.stepIndex,
            connectionId: revision.snapshot.sender.connectionId!,
            replyConnectionId:
              revision.snapshot.senderContext.replyRoute!.configuration
                .connectionId,
            replyInboxId:
              revision.snapshot.senderContext.replyRoute!.configuration
                .inboxConnectionId,
            recipient: gate.review.recipient.address,
            subject: gate.review.step.subject,
            body: gate.review.step.body,
            fromAddress: revision.snapshot.sender.fromAddress,
            fromName: gate.sender.identification.fromName,
            replyTo:
              revision.snapshot.senderContext.replyRoute!.configuration.address,
            platformDisclosure: gate.sender.identification.platformDisclosure,
            internetMessageId: `<${attemptId}@${revision.snapshot.sender.fromAddress.split("@")[1]}>`,
            ...(action.stepIndex &&
            c.actions.find(
              (a) =>
                a.contactId === action.contactId &&
                a.stepIndex === action.stepIndex - 1,
            )?.receipt
              ? {
                  parent: {
                    internetMessageId: c.actions.find(
                      (a) =>
                        a.contactId === action.contactId &&
                        a.stepIndex === action.stepIndex - 1,
                    )!.receipt!.internetMessageId,
                    threadRef: c.actions.find(
                      (a) =>
                        a.contactId === action.contactId &&
                        a.stepIndex === action.stepIndex - 1,
                    )!.receipt!.threadRef,
                    subject:
                      revision.snapshot.steps[action.stepIndex - 1].subject,
                  },
                }
              : {}),
            emailEligibility: emailDispatchAuthorization(gate.eligibility),
          };
          await event(
            tx,
            input.identity,
            run,
            "attempt_reserved",
            committed,
            null,
            envelope,
          );
          return { attemptId, envelope };
        },
      );
      if (!claim) return false;
      // Reviewed exception to external I/O outside transactions: like #19/#31, hold the Business and
      // market-policy locks through one bounded adapter call. A restriction that wins the lock fences stale work.
      await scope(input.identity, input.businessId, async (tx) => {
        const { run, action, revision } = await loadWork(tx, input);
        if (
          action.state !== "committed" ||
          action.attemptId !== claim.attemptId
        )
          return;
        let gate = await evaluateSequence(tx, {
          actor: input.identity,
          businessId: input.businessId,
          revision: revision,
          action: {
            contactId: action.contactId,
            stepIndex: action.stepIndex,
            opportunityId: action.opportunityId,
            id: action.id,
          },
          provider: provider,
        });
        if (run.state !== "active" || gate.reason !== null) {
          await stopBeforeProvider(
            tx,
            input.identity,
            run,
            action,
            gate.reason ??
              (run.state === "cancelled"
                ? "sequence_cancelled"
                : "sequence_paused"),
          );
          return;
        }
        const usage = await sequenceUsage(
          tx,
          input.businessId,
          gate.policy,
          clock.now(),
        );
        const reserved = usage.events.find(
          (e) =>
            e.kind === "attempt_reserved" && e.attemptId === action.attemptId,
        );
        const lastOther = usage.events
          .filter((e) => e.actionId !== action.id)
          .map((e) => e.at)
          .sort((a, b) => a.getTime() - b.getTime())
          .at(-1);
        const boundary = clock.now();
        const reason = !(await paidReservationCurrent(
          tx,
          input.businessId,
          "automation",
          action.attemptId!,
          boundary,
        ))
          ? "paid_automation_changed"
          : !reserved ||
              reserved.at < new Date(gate.policy.periodStart) ||
              usage.reserved > gate.policy.maxProviderCalls
            ? "allowance_changed"
            : lastOther &&
                lastOther.getTime() + gate.policy.minIntervalSeconds * 1000 >
                  boundary.getTime()
              ? "pacing_changed"
              : sequenceDue(revision.snapshot.timing!, boundary) > boundary
                ? "outside_local_window"
                : null;
        if (reason) {
          await actionUpdate(tx, action, { state: "paused", reason });
          return;
        }
        await event(tx, input.identity, run, "dispatch_boundary", action);
        gate = await evaluateSequence(tx, {
          actor: input.identity,
          businessId: input.businessId,
          revision: revision,
          action: {
            contactId: action.contactId,
            stepIndex: action.stepIndex,
            opportunityId: action.opportunityId,
            id: action.id,
          },
          provider: provider,
        });
        if (gate.reason !== null) {
          await stopBeforeProvider(
            tx,
            input.identity,
            run,
            action,
            gate.reason,
          );
          return;
        }
        const dispatchAt = clock.now();
        const finalReason = signal.aborted
          ? "worker_aborted_before_dispatch"
          : sequenceDue(revision.snapshot.timing!, dispatchAt) > dispatchAt
            ? "outside_local_window"
            : (gate.eligibility.recheckAt &&
                  new Date(gate.eligibility.recheckAt) <= dispatchAt) ||
                new Date(gate.sender.evidence!.validUntil) <= dispatchAt ||
                new Date(gate.policy.periodEnd) <= dispatchAt
              ? "effective_time_changed"
              : null;
        if (finalReason) {
          await stopBeforeProvider(
            tx,
            input.identity,
            run,
            action,
            finalReason,
          );
          return;
        }
        const previous =
          (await load(tx, input.businessId, run.id)).actions.find(
            (a) =>
              a.contactId === action.contactId &&
              a.stepIndex === action.stepIndex - 1,
          )?.receipt ?? null;
        const access = await nativeDispatchAccess(
          tx,
          claim.envelope,
          previous,
          action.stepIndex
            ? revision.snapshot.steps[action.stepIndex - 1].subject
            : null,
          async () => {
            const current = await evaluateSequence(tx, {
              actor: input.identity,
              businessId: input.businessId,
              revision,
              action: {
                contactId: action.contactId,
                stepIndex: action.stepIndex,
                opportunityId: action.opportunityId,
                id: action.id,
              },
              provider,
            });
            const at = clock.now();
            if (current.reason !== null) return false;
            const currentUsage = await sequenceUsage(
              tx,
              input.businessId,
              current.policy,
              at,
            );
            const currentReservation = currentUsage.events.find(
              (e) =>
                e.attemptId === action.attemptId &&
                e.kind === "attempt_reserved",
            );
            return (
              (await paidReservationCurrent(
                tx,
                input.businessId,
                "automation",
                action.attemptId!,
                at,
              )) &&
              Boolean(
                currentReservation &&
                currentReservation.at >= new Date(current.policy.periodStart) &&
                currentUsage.reserved <= current.policy.maxProviderCalls,
              ) &&
              !signal.aborted &&
              sequenceDue(revision.snapshot.timing!, at) <= at
            );
          },
          undefined,
          () => clock.now(),
        );
        let result: unknown;
        try {
          result = await sequenceMailCall(
            (s) =>
              provider.send(
                {
                  ...claim.envelope,
                  emailEligibility: emailDispatchAuthorization(
                    gate.eligibility,
                  ),
                },
                s,
                access,
              ),
            signal,
          );
        } catch {
          result = { status: "unknown" };
        }
        await settle(
          tx,
          input.identity,
          run,
          action,
          revision,
          result,
          claim.envelope,
        );
      });
      return true;
    },
  };
  async function settle(
    tx: Transaction,
    actor: WorkIdentity,
    run: Run,
    action: Action,
    revision: Awaited<ReturnType<typeof sequenceRevision>>,
    raw: unknown,
    envelope: SequenceEnvelope,
    source: SequenceWorkspace["runs"][number]["history"][number]["source"] = null,
  ) {
    const parsed = sequenceResultSchema.safeParse(raw);
    let result = parsed.success ? parsed.data : { status: "unknown" as const };
    if (
      result.status === "accepted" &&
      (result.receipt.actionId !== action.id ||
        result.receipt.attemptId !== action.attemptId ||
        result.receipt.businessId !== run.businessId ||
        result.receipt.recipient !== envelope.recipient ||
        result.receipt.connectionId !== envelope.connectionId ||
        result.receipt.internetMessageId !== envelope.internetMessageId ||
        new Date(result.receipt.acceptedAt) > clock.now() ||
        new Date(result.receipt.acceptedAt) < new Date(envelope.reservedAt))
    )
      result = { status: "unknown" };
    if (result.status === "accepted_pending_identity") {
      const a = result.acceptance;
      if (
        envelope.adapterKey !== "microsoft-mail-send-v1" ||
        a.businessId !== run.businessId ||
        a.actionId !== action.id ||
        a.attemptId !== action.attemptId ||
        a.connectionId !== envelope.connectionId ||
        a.recipient !== envelope.recipient ||
        a.submittedInternetMessageId !== envelope.internetMessageId ||
        new Date(a.acceptedAt) < new Date(envelope.reservedAt) ||
        new Date(a.acceptedAt) > clock.now()
      )
        result = { status: "unknown" };
      else {
        await actionUpdate(tx, action, {
          state: "committed",
          reason: "provider_accepted_identity_pending",
          processingAcceptance: a,
        });
        await tx.insert(emailSequenceEvent).values({
          id: randomUUID(),
          businessId: run.businessId,
          runId: run.id,
          actionId: action.id,
          attemptId: action.attemptId,
          kind: "provider_accepted_identity_pending",
          processingAcceptance: a,
          actorId: actor.userId,
          at: clock.now(),
        });
        return;
      }
    }
    if (result.status === "unknown") {
      await actionUpdate(tx, action, {
        state: "unknown",
        reason: "acceptance_unknown",
      });
      await event(
        tx,
        actor,
        run,
        "acceptance_unknown",
        action,
        "reconcile_required",
      );
      return;
    }
    if (result.status === "not_accepted") {
      const retryAt = result.retryAt ? new Date(result.retryAt) : null;
      const policy = await sequencePolicyAt(tx, run.businessId);
      const usage = policy
        ? await sequenceUsage(
            tx,
            run.businessId,
            policy.configuration,
            clock.now(),
          )
        : null;
      const actions = await tx
        .select()
        .from(emailSequenceAction)
        .where(
          and(
            eq(emailSequenceAction.businessId, run.businessId),
            eq(emailSequenceAction.runId, run.id),
            eq(emailSequenceAction.contactId, action.contactId),
          ),
        );
      const attempts = usage
        ? recipientReservedAttempts(
            usage.events,
            run.id,
            action.contactId,
            actions,
          )
        : revision.snapshot.maxAttempts;
      const retry =
        run.state === "active" &&
        retryAt &&
        retryAt > clock.now() &&
        usage?.remaining &&
        attempts < revision.snapshot.maxAttempts;
      await actionUpdate(tx, action, {
        state: retry ? "pending" : "failed",
        reason: result.reason,
        dueAt: retryAt
          ? sequenceDue(revision.snapshot.timing!, retryAt)
          : action.dueAt,
        ...(retry
          ? {
              generation: action.generation + 1,
              key: randomUUID(),
              queueState: "pending" as const,
            }
          : {}),
      });
      await event(tx, actor, run, "not_accepted", action, result.reason);
      return;
    }
    await actionUpdate(tx, action, {
      state: "accepted",
      reason: null,
      receipt: result.receipt,
    });
    await event(
      tx,
      actor,
      run,
      "provider_accepted",
      action,
      result.receipt.evidence === "sent_folder"
        ? "sent_folder_reconciliation"
        : null,
      null,
      result.receipt,
      null,
      source,
    );
    const [next] = await tx
      .select()
      .from(emailSequenceAction)
      .where(
        and(
          eq(emailSequenceAction.businessId, run.businessId),
          eq(emailSequenceAction.runId, run.id),
          eq(emailSequenceAction.contactId, action.contactId),
          eq(emailSequenceAction.stepIndex, action.stepIndex + 1),
        ),
      );
    if (next?.state === "waiting" && run.state === "active")
      await actionUpdate(tx, next, {
        identity: action.identity,
        controlVersion: action.controlVersion,
        state: "pending",
        dueAt: sequenceDue(
          revision.snapshot.timing!,
          new Date(
            new Date(result.receipt.acceptedAt).getTime() +
              revision.snapshot.steps[next.stepIndex].delayMinutes * 60000,
          ),
        ),
        queueState: "pending",
      });
    const remaining = await tx
      .select()
      .from(emailSequenceAction)
      .where(
        and(
          eq(emailSequenceAction.businessId, run.businessId),
          eq(emailSequenceAction.runId, run.id),
          inArray(emailSequenceAction.state, [
            "waiting",
            "pending",
            "committed",
            "unknown",
            "failed",
            "paused",
          ]),
        ),
      );
    if (!remaining.length && run.state === "active")
      await tx
        .update(emailSequenceRun)
        .set({ state: "completed", version: run.version + 1 })
        .where(
          and(
            eq(emailSequenceRun.businessId, run.businessId),
            eq(emailSequenceRun.id, run.id),
          ),
        );
  }
  return repository;
}
