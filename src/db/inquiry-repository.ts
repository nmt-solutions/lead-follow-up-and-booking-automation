import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import {
  initialInquiryResult,
  type InquiryResult,
  type InquiryRun,
  type InquiryWorkspace,
} from "../models/inquiries";
import {
  inquiryRun,
  opportunityDueAction,
  inboxConnection,
  inboxMessage,
  membership,
  user,
  aiExecution,
} from "./schema";
import {
  inquiryContext,
  lockInquiryProfile,
  sameInquirySnapshot,
} from "./inquiry-context";
import {
  requireSalesSession,
  writeControl,
} from "./opportunity-control-repository";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { responseSender, responseSenderUse } from "./sender-repository";
import { gmailSequenceKey } from "../gmail/sequence-mail";

type Run = typeof inquiryRun.$inferSelect;
async function view(tx: Transaction, row: Run, at: Date): Promise<InquiryRun> {
  const [action] = await tx
    .select()
    .from(opportunityDueAction)
    .where(
      and(
        eq(opportunityDueAction.businessId, row.businessId),
        eq(opportunityDueAction.inquiryRunId, row.id),
      ),
    );
  const [source] = await tx
    .select({ message: inboxMessage, connection: inboxConnection })
    .from(inboxMessage)
    .innerJoin(
      inboxConnection,
      eq(inboxConnection.id, inboxMessage.connectionId),
    )
    .where(
      and(
        eq(inboxMessage.businessId, row.businessId),
        eq(inboxMessage.id, row.messageId),
      ),
    );
  const sender =
    source.connection.channel === "email"
      ? await responseSender(
          tx,
          row.businessId,
          source.connection.id,
          at,
          responseSenderUse(source.message),
        )
      : null;
  return {
    reply: {
      nativeGmail:
        source.connection.mode === "mailbox" &&
        sender?.sender?.adapterKey === gmailSequenceKey,
      recipient: source.message.content.senderRef,
      subject: source.message.content.subject,
      fromAddress:
        action?.email?.envelope.fromAddress ??
        sender?.sender?.fromAddress ??
        null,
      replyTo:
        action?.email?.envelope.replyTo ?? sender?.sender?.replyTo ?? null,
    },
    ...row.result,
    id: row.id,
    messageId: row.messageId,
    actorId: row.actorId,
    at: row.at.toISOString(),
    knowledgeVersion: row.snapshot.knowledgeVersion,
    profileId: row.snapshot.profileId,
    executionId: row.executionId,
    action: action
      ? {
          id: action.id,
          state: action.state,
          reason: action.reason,
          dueAt: action.dueAt.toISOString(),
          email: action.email
            ? { result: action.email.result, sent: action.email.sent }
            : null,
        }
      : null,
  };
}
export function createInquiryRepository(database: Database, clock: Clock) {
  async function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
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
        await requireSalesSession(tx, actor, clock.now(), role);
        await lockInquiryProfile(tx);
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function runs(tx: Transaction, businessId: string, id: string) {
    return tx
      .select()
      .from(inquiryRun)
      .where(
        and(
          eq(inquiryRun.businessId, businessId),
          eq(inquiryRun.opportunityId, id),
        ),
      )
      .orderBy(asc(inquiryRun.sequence));
  }
  async function ownedRun(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
    id: string,
  ) {
    const [row] = await tx
      .select()
      .from(inquiryRun)
      .where(
        and(
          eq(inquiryRun.businessId, businessId),
          eq(inquiryRun.opportunityId, opportunityId),
          eq(inquiryRun.id, id),
        ),
      );
    if (!row) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  return {
    read(
      actor: WorkIdentity,
      businessId: string,
      id: string,
    ): Promise<InquiryWorkspace> {
      return scope(actor, businessId, async (tx) => {
        const context = await inquiryContext(tx, businessId, id, clock.now());
        const canProcess =
          context.need.controlState === "automation" &&
          context.need.ownerId === actor.userId;
        const result = [];
        for (const row of await runs(tx, businessId, id))
          result.push(await view(tx, row, clock.now()));
        return {
          runs: result,
          canProcess,
          latestMessageId: context.messages.at(-1)?.id ?? null,
          nextAction: canProcess
            ? "Evaluate the latest associated inquiry using current approved knowledge."
            : "The accountable owner must explicitly hand back before inquiry automation can run.",
        };
      });
    },
    prepare(
      actor: WorkIdentity,
      businessId: string,
      id: string,
      messageId: string,
    ) {
      return scope(actor, businessId, async (tx) => {
        const context = await inquiryContext(tx, businessId, id, clock.now());
        const history = await runs(tx, businessId, id);
        const latest = history.findLast((r) => r.messageId === messageId);
        if (
          context.need.controlState === "human" &&
          latest?.result.status === "handoff"
        )
          return {
            fresh: false as const,
            row: latest,
            context,
            previousFacts: [],
            result: await view(tx, latest, clock.now()),
          };
        for (const row of history.filter((v) => v.messageId === messageId)) {
          const existing = await view(tx, row, clock.now());
          // A delivered or ambiguous action can never be regenerated for the same inbound message.
          if (
            existing.action &&
            ["committed", "dispatched"].includes(existing.action.state)
          )
            return {
              fresh: false as const,
              row,
              context,
              previousFacts: [],
              result: existing,
            };
        }
        if (
          context.need.controlState !== "automation" ||
          context.need.ownerId !== actor.userId
        )
          throw new ApplicationError("CONFLICT");
        if (context.messages.at(-1)?.id !== messageId)
          throw new ApplicationError("CONFLICT");
        const [message] = await tx
          .select()
          .from(inboxMessage)
          .where(
            and(
              eq(inboxMessage.id, messageId),
              eq(inboxMessage.businessId, businessId),
            ),
          );
        const [connection] = await tx
          .select()
          .from(inboxConnection)
          .where(
            and(
              eq(inboxConnection.id, message.connectionId),
              eq(inboxConnection.businessId, businessId),
            ),
          );
        if (!connection?.active) throw new ApplicationError("CONFLICT");
        const requestKey = createHash("sha256")
          .update(JSON.stringify({ id, messageId, snapshot: context.snapshot }))
          .digest("hex");
        const existing = history.find((r) => r.requestKey === requestKey);
        if (existing)
          return {
            fresh: false as const,
            row: existing,
            context,
            previousFacts: [],
            result: await view(tx, existing, clock.now()),
          };
        // Cancel stale pending drafts, never revive them on retry or handback.
        await tx
          .update(opportunityDueAction)
          .set({ state: "cancelled", reason: "new_inquiry_evaluation" })
          .where(
            and(
              eq(opportunityDueAction.businessId, businessId),
              eq(opportunityDueAction.opportunityId, id),
              eq(opportunityDueAction.state, "pending"),
            ),
          );
        const facts = new Map<string, InquiryResult["facts"][number]>();
        for (const previous of history) {
          if (previous.result.status !== "ready") continue;
          for (const fact of previous.result.facts) {
            const source = context.messages.find(
              (m) => m.id === fact.messageId,
            );
            const original = previous.snapshot.messages.find(
              (m) => m.id === fact.messageId,
            );
            if (
              source &&
              source.correctionVersion === original?.correctionVersion &&
              context.knowledge?.configuration.qualification.some(
                (f) => f.key === fact.key,
              )
            )
              facts.set(fact.key, fact);
          }
        }
        const [row] = await tx
          .insert(inquiryRun)
          .values({
            id: randomUUID(),
            businessId,
            opportunityId: id,
            messageId,
            conversationId: message.conversationId,
            sequence: history.length + 1,
            requestKey,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            snapshot: context.snapshot,
            result: initialInquiryResult,
            at: clock.now(),
          })
          .returning();
        return {
          fresh: true as const,
          row,
          context,
          previousFacts: [...facts.values()],
          result: await view(tx, row, clock.now()),
        };
      });
    },
    authorize(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
    ) {
      return scope(actor, businessId, async (tx) => {
        const row = await ownedRun(tx, businessId, opportunityId, id);
        const context = await inquiryContext(
          tx,
          businessId,
          opportunityId,
          clock.now(),
        );
        const [message] = await tx
          .select()
          .from(inboxMessage)
          .where(
            and(
              eq(inboxMessage.id, row.messageId),
              eq(inboxMessage.businessId, businessId),
            ),
          );
        const [connection] = await tx
          .select()
          .from(inboxConnection)
          .where(
            and(
              eq(inboxConnection.id, message.connectionId),
              eq(inboxConnection.businessId, businessId),
            ),
          );
        if (
          row.actorId !== actor.userId ||
          row.sessionId !== actor.sessionId ||
          !sameInquirySnapshot(row.snapshot, context.snapshot) ||
          context.need.controlState !== "automation" ||
          context.need.ownerId !== actor.userId ||
          !connection?.active
        )
          throw new ApplicationError("CONFLICT");
      });
    },
    complete(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
      result: InquiryResult,
      executionId: string | null,
    ) {
      return scope(actor, businessId, async (tx) => {
        const row = await ownedRun(tx, businessId, opportunityId, id);
        if (row.actorId !== actor.userId || row.sessionId !== actor.sessionId)
          throw new ApplicationError("FORBIDDEN");
        if (row.result.status !== "processing")
          return view(tx, row, clock.now());
        const context = await inquiryContext(
          tx,
          businessId,
          opportunityId,
          clock.now(),
        );
        if (
          !sameInquirySnapshot(row.snapshot, context.snapshot) ||
          context.need.controlState !== "automation" ||
          context.need.ownerId !== actor.userId
        )
          result = {
            ...result,
            status: "stale",
            reason: "inquiry_context_changed",
            body: null,
            nextAction:
              "Reload current context and evaluate again after review.",
          };
        if (result.status === "handoff") {
          const members = await tx
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              role: membership.role,
            })
            .from(membership)
            .innerJoin(user, eq(user.id, membership.userId))
            .where(eq(membership.businessId, businessId));
          const contact = context.knowledge?.configuration.escalation;
          const owner =
            members.find(
              (m) => m.email.toLowerCase() === contact?.email.toLowerCase(),
            ) ??
            members.find((m) => m.id === context.need.ownerId) ??
            members.find((m) => m.role === "owner");
          if (!owner) throw new ApplicationError("CONFLICT");
          result = {
            ...result,
            ownerId: owner.id,
            ownerName: owner.name,
            escalationEmail: contact?.email ?? owner.email,
            nextAction:
              "Review this handoff in the inbox and respond manually; no external notification has been sent.",
          };
          await writeControl(
            tx,
            actor,
            businessId,
            context.need,
            {
              reason: `Inquiry needs review: ${result.reason}`,
              nextAction: result.nextAction,
            },
            "inquiry_handoff",
            clock.now(),
            null,
            row.id,
            owner.id,
          );
        }
        if (!executionId) {
          const [execution] = await tx
            .select({ id: aiExecution.id })
            .from(aiExecution)
            .where(
              and(
                eq(aiExecution.businessId, businessId),
                eq(aiExecution.requestKey, row.id),
                eq(aiExecution.actorId, row.actorId),
              ),
            );
          executionId = execution?.id ?? null;
        }
        const [saved] = await tx
          .update(inquiryRun)
          .set({ result, executionId })
          .where(
            and(eq(inquiryRun.id, id), eq(inquiryRun.businessId, businessId)),
          )
          .returning();
        if (result.status === "ready") {
          const [message] = await tx
            .select()
            .from(inboxMessage)
            .where(
              and(
                eq(inboxMessage.id, row.messageId),
                eq(inboxMessage.businessId, businessId),
              ),
            );
          const policy = await readCommercialPolicy(tx, businessId, false);
          const associationVersion = row.snapshot.messages.find(
            (m) => m.id === row.messageId,
          )!.associationVersion;
          await tx.insert(opportunityDueAction).values({
            id: randomUUID(),
            businessId,
            opportunityId,
            messageId: row.messageId,
            connectionId: message.connectionId,
            conversationId: message.conversationId,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            controlVersion: context.need.controlVersion,
            associationVersion,
            policyVersion: policy.version,
            inquiryRunId: id,
            evaluation: null,
            state: "pending",
            dueAt: clock.now(),
            createdAt: clock.now(),
          });
        }
        return view(tx, saved, clock.now());
      });
    },
    action(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
    ) {
      return scope(actor, businessId, async (tx) => {
        const row = await ownedRun(tx, businessId, opportunityId, id);
        if (row.actorId !== actor.userId)
          throw new ApplicationError("FORBIDDEN");
        return view(tx, row, clock.now());
      });
    },
  };
}
