import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { inquiryContext } from "./inquiry-context";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { readRfqWorkspace } from "./rfq-repository";
import { requireSalesSession } from "./opportunity-control-repository";
import {
  commercialProposal,
  commercialDecision,
  commercialExecution,
  commercialOutcome,
  inboxConnection,
  inboxMessage,
  user,
} from "./schema";
import { ApplicationError } from "../models/application-error";
import { evaluateCommercialAuthority } from "../models/commercial-authority";
import {
  commercialProviderResultSchema,
  type CommercialActionWorkspace,
  type ProposeCommercial,
  type DecideCommercial,
  type CommercialProvider,
  type CommercialEvidence,
  type CommercialPayload,
} from "../models/commercial-actions";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";

type Proposal = typeof commercialProposal.$inferSelect;
type Ref = { actionId: string; payloadHash: string };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const evaluationInput = (p: CommercialPayload) => ({
  action: p.action,
  amount: p.grossAmount,
  discountBps: p.discountBps,
});

/** Durable claims precede external I/O. The shared #19 lock serializes current policy,
 * team/ownership/context checks through bounded provider I/O (the same reviewed exception
 * as Opportunity dispatch). No task or HTTP retry can repeat a committed action.
 */
export function createCommercialRepository(database: Database, clock: Clock) {
  function scope<T>(
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
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function context(
    tx: Transaction,
    actor: WorkIdentity,
    businessId: string,
    opportunityId: string,
  ) {
    const c = await inquiryContext(tx, businessId, opportunityId, clock.now());
    const rfq = await readRfqWorkspace(tx, actor, businessId, c);
    const authority = await readCommercialPolicy(tx, businessId, false);
    const key = hash({
      knowledgeVersion: c.snapshot.knowledgeVersion,
      messages: c.snapshot.messages,
      controlVersion: c.need.controlVersion,
      ownerId: c.need.ownerId,
      rfqRevisionId: rfq.current?.revisionId ?? null,
      rfqStatus: rfq.current?.status ?? null,
    });
    return { ...c, rfq, authority, key };
  }
  async function rows(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
  ) {
    return tx
      .select()
      .from(commercialProposal)
      .where(
        and(
          eq(commercialProposal.businessId, businessId),
          eq(commercialProposal.opportunityId, opportunityId),
        ),
      )
      .orderBy(asc(commercialProposal.sequence));
  }
  async function find(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
    ref: Ref,
  ) {
    const [row] = await tx
      .select()
      .from(commercialProposal)
      .where(
        and(
          eq(commercialProposal.id, ref.actionId),
          eq(commercialProposal.businessId, businessId),
          eq(commercialProposal.opportunityId, opportunityId),
        ),
      );
    if (!row) throw new ApplicationError("NOT_FOUND");
    if (
      row.payloadHash !== ref.payloadHash ||
      hash(row.payload) !== ref.payloadHash
    )
      throw new ApplicationError("CONFLICT");
    return row;
  }
  async function decision(tx: Transaction, p: Proposal) {
    const [d] = await tx
      .select()
      .from(commercialDecision)
      .where(
        and(
          eq(commercialDecision.actionId, p.id),
          eq(commercialDecision.businessId, p.businessId),
        ),
      );
    return d ?? null;
  }
  async function execution(tx: Transaction, p: Proposal) {
    const [e] = await tx
      .select()
      .from(commercialExecution)
      .where(
        and(
          eq(commercialExecution.actionId, p.id),
          eq(commercialExecution.businessId, p.businessId),
        ),
      );
    return e ?? null;
  }
  async function latest(tx: Transaction, p: Proposal) {
    return !(await rows(tx, p.businessId, p.opportunityId)).some(
      (r) => r.seriesId === p.seriesId && r.version > p.version,
    );
  }
  async function authorizeOriginal(tx: Transaction, p: Proposal) {
    const identity = { userId: p.actorId, sessionId: p.sessionId };
    const role = await requireCapability(
      tx,
      identity,
      p.businessId,
      "sales.work",
    );
    await requireSalesSession(tx, identity, clock.now(), role);
  }
  async function privileged(
    tx: Transaction,
    actor: WorkIdentity,
    businessId: string,
  ) {
    const role = await requireCapability(
      tx,
      actor,
      businessId,
      "commercial-authority.manage",
    );
    await requireSalesSession(tx, actor, clock.now(), role);
  }
  async function guard(tx: Transaction, actor: WorkIdentity, p: Proposal) {
    const c = await context(tx, actor, p.businessId, p.opportunityId);
    if (c.need.ownerId !== p.actorId) throw new ApplicationError("FORBIDDEN");
    await authorizeOriginal(tx, p);
    const d = await decision(tx, p);
    if (!(await latest(tx, p))) return "proposal_replaced";
    if (p.contextKey !== c.key) return "context_changed";
    if (p.policyVersion !== c.authority.version) return "policy_changed";
    if (p.payload.mode === "automation" && c.need.controlState !== "automation")
      return "human_takeover";
    if (d?.decision === "rejected") return "rejected";
    if (d) {
      if (
        d.policyVersion !== c.authority.version ||
        d.contextKey !== c.key ||
        d.payloadHash !== p.payloadHash
      )
        return "approval_stale";
      try {
        await privileged(
          tx,
          { userId: d.actorId, sessionId: d.sessionId },
          p.businessId,
        );
      } catch (error: unknown) {
        if (error instanceof ApplicationError)
          return "approval_authority_revoked";
        throw error;
      }
    } else if (
      evaluateCommercialAuthority(
        c.authority,
        evaluationInput(p.payload),
        clock.now(),
      ).status !== "permitted"
    )
      throw new ApplicationError("CONFLICT");
    const [connection] = await tx
      .select()
      .from(inboxConnection)
      .where(
        and(
          eq(inboxConnection.businessId, p.businessId),
          eq(inboxConnection.id, p.payload.connectionId),
        ),
      );
    if (!connection?.active) return "connection_revoked";
    return null;
  }
  async function outcomes(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
  ) {
    return tx
      .select()
      .from(commercialOutcome)
      .where(
        and(
          eq(commercialOutcome.businessId, businessId),
          eq(commercialOutcome.opportunityId, opportunityId),
        ),
      )
      .orderBy(asc(commercialOutcome.at));
  }
  async function addEvidence(
    tx: Transaction,
    actor: WorkIdentity,
    p: Proposal,
    input: CommercialEvidence,
    source: string,
  ) {
    const seen = await outcomes(tx, p.businessId, p.opportunityId);
    const previous = seen.find(
      (e) => e.actionId === p.id && e.kind === input.kind,
    );
    if (previous) {
      if (
        previous.payloadHash !== input.payloadHash ||
        previous.source !== source ||
        previous.reference !== input.reference ||
        previous.occurredAt.toISOString() !==
          new Date(input.occurredAt).toISOString() ||
        previous.note !== input.note
      )
        throw new ApplicationError("CONFLICT");
      return;
    }
    if (
      new Date(input.occurredAt) > clock.now() ||
      new Date(input.occurredAt) < p.at ||
      (input.kind === "issued_quote" && p.payload.action !== "quotations") ||
      (input.kind !== "issued_quote" && p.payload.action !== "orders") ||
      (input.kind === "confirmed_sale" &&
        !seen.some((e) => e.actionId === p.id && e.kind === "accepted_order"))
    )
      throw new ApplicationError("INVALID_INPUT");
    const [duplicate] = await tx
      .select()
      .from(commercialOutcome)
      .where(
        and(
          eq(commercialOutcome.businessId, p.businessId),
          eq(commercialOutcome.source, source),
          eq(commercialOutcome.kind, input.kind),
          eq(commercialOutcome.reference, input.reference),
        ),
      );
    if (duplicate) throw new ApplicationError("CONFLICT");
    await tx.insert(commercialOutcome).values({
      id: randomUUID(),
      businessId: p.businessId,
      opportunityId: p.opportunityId,
      actionId: p.id,
      payloadHash: p.payloadHash,
      kind: input.kind,
      source,
      reference: input.reference,
      occurredAt: new Date(input.occurredAt),
      actorId: actor.userId,
      note: input.note,
      at: clock.now(),
    });
  }
  return {
    read(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      providerAvailable: boolean,
    ): Promise<CommercialActionWorkspace> {
      return scope(actor, businessId, async (tx) => {
        const c = await context(tx, actor, businessId, opportunityId);
        const all = await rows(tx, businessId, opportunityId);
        const ids = [
          ...new Set([
            actor.userId,
            ...all.map((p) => p.actorId),
            ...c.authority.approvers.map((a) => a.userId),
          ]),
        ];
        const identities = await tx
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, ids));
        const name = (id: string) =>
          identities.find((i) => i.id === id)?.name ?? id;
        const actions: CommercialActionWorkspace["actions"] = [];
        for (const p of all) {
          const d = await decision(tx, p);
          const e = await execution(tx, p);
          actions.push({
            id: p.id,
            seriesId: p.seriesId,
            version: p.version,
            payloadHash: p.payloadHash,
            payload: p.payload,
            actorId: p.actorId,
            actorName: name(p.actorId),
            note: p.note,
            at: p.at.toISOString(),
            policyVersion: p.policyVersion,
            contextKey: p.contextKey,
            evaluation: p.evaluation,
            currentEvaluation: evaluateCommercialAuthority(
              c.authority,
              evaluationInput(p.payload),
              clock.now(),
            ),
            decision: d
              ? {
                  decision: d.decision,
                  actorId: d.actorId,
                  actorName: name(d.actorId),
                  at: d.at.toISOString(),
                  note: d.note,
                  policyVersion: d.policyVersion,
                }
              : null,
            execution: e
              ? {
                  state: e.state,
                  reason: e.reason,
                  reference: e.reference,
                  provider: e.provider,
                  at: e.at.toISOString(),
                }
              : null,
            latest: !all.some(
              (r) => r.seriesId === p.seriesId && r.version > p.version,
            ),
            stale:
              p.contextKey !== c.key || p.policyVersion !== c.authority.version,
          });
        }
        return {
          contextKey: c.key,
          ownerId: c.need.ownerId,
          ownerName: c.rfq.ownerName,
          controlState: c.need.controlState,
          canPropose: c.need.ownerId === actor.userId && !!c.knowledge,
          canApprove: c.authority.approvers.some(
            (a) => a.userId === actor.userId,
          ),
          providerAvailable,
          setupReason: !c.knowledge
            ? "Approve Business knowledge and an offering first."
            : c.need.ownerId !== actor.userId
              ? "The assigned Opportunity owner prepares and executes commercial actions."
              : null,
          authority: c.authority,
          offerings: c.knowledge?.configuration.offerings ?? [],
          messages: c.messages.map((m) => ({
            id: m.id,
            text: m.text.text,
            recipientRef: m.text.senderRef,
          })),
          actions,
          outcomes: (await outcomes(tx, businessId, opportunityId)).map(
            (o) => ({
              ...o,
              occurredAt: o.occurredAt.toISOString(),
              at: o.at.toISOString(),
            }),
          ),
        };
      });
    },
    propose(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: ProposeCommercial,
    ) {
      return scope(actor, businessId, async (tx) => {
        const c = await context(tx, actor, businessId, opportunityId);
        if (c.need.ownerId !== actor.userId)
          throw new ApplicationError("FORBIDDEN");
        const fingerprint = hash(input);
        const [replay] = await tx
          .select()
          .from(commercialProposal)
          .where(
            and(
              eq(commercialProposal.businessId, businessId),
              eq(commercialProposal.requestKey, input.requestKey),
            ),
          );
        if (replay) {
          if (
            replay.fingerprint !== fingerprint ||
            replay.actorId !== actor.userId ||
            replay.opportunityId !== opportunityId
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        if (
          input.expectedContextKey !== c.key ||
          !c.knowledge ||
          !c.knowledge.configuration.offerings.some(
            (o) => o.name === input.offering,
          )
        )
          throw new ApplicationError("CONFLICT");
        if (input.mode === "automation" && c.need.controlState !== "automation")
          throw new ApplicationError("CONFLICT");
        if (
          input.action === "quotations" &&
          (c.rfq.current?.status !== "complete" ||
            c.rfq.current.offering.name !== input.offering)
        )
          throw new ApplicationError("CONFLICT");
        const message = c.messages.find((m) => m.id === input.messageId);
        if (!message) throw new ApplicationError("INVALID_INPUT");
        const previous = input.replacesId
          ? await find(tx, businessId, opportunityId, {
              actionId: input.replacesId,
              payloadHash:
                (await rows(tx, businessId, opportunityId)).find(
                  (p) => p.id === input.replacesId,
                )?.payloadHash ?? "",
            })
          : null;
        if (previous) {
          const priorExecution = await execution(tx, previous);
          if (
            !(await latest(tx, previous)) ||
            (priorExecution &&
              !["failed", "blocked"].includes(priorExecution.state))
          )
            throw new ApplicationError("CONFLICT");
        }
        const [source] = await tx
          .select()
          .from(inboxMessage)
          .where(
            and(
              eq(inboxMessage.id, input.messageId),
              eq(inboxMessage.businessId, businessId),
            ),
          );
        if (!source) throw new ApplicationError("NOT_FOUND");
        const [connection] = await tx
          .select()
          .from(inboxConnection)
          .where(
            and(
              eq(inboxConnection.id, source.connectionId),
              eq(inboxConnection.businessId, businessId),
            ),
          );
        if (!connection?.active) throw new ApplicationError("CONFLICT");
        const payload: CommercialPayload = {
          mode: input.mode,
          action: input.action,
          offering: input.offering,
          description: input.description,
          grossAmount: input.grossAmount,
          discountBps: input.discountBps,
          netAmount: {
            currency: input.grossAmount.currency,
            minor: (
              (BigInt(input.grossAmount.minor) *
                BigInt(10000 - input.discountBps)) /
              10000n
            ).toString(),
          },
          terms: input.terms,
          messageId: input.messageId,
          connectionId: connection.id,
          channel: connection.channel,
          recipientRef: message.text.senderRef,
          conversationRef: message.text.conversationRef,
          replyToMessageRef: message.text.messageRef,
          rfqRevisionId: c.rfq.current?.revisionId ?? null,
        };
        await tx.insert(commercialProposal).values({
          id: randomUUID(),
          businessId,
          opportunityId,
          sequence: (await rows(tx, businessId, opportunityId)).length + 1,
          seriesId: previous?.seriesId ?? randomUUID(),
          version: (previous?.version ?? 0) + 1,
          requestKey: input.requestKey,
          fingerprint,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          payload,
          payloadHash: hash(payload),
          contextKey: c.key,
          policyVersion: c.authority.version,
          evaluation: evaluateCommercialAuthority(
            c.authority,
            evaluationInput(payload),
            clock.now(),
          ),
          note: input.note,
          at: clock.now(),
        });
      });
    },
    decide(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: DecideCommercial,
    ) {
      return scope(actor, businessId, async (tx) => {
        await privileged(tx, actor, businessId);
        const p = await find(tx, businessId, opportunityId, input);
        const d = await decision(tx, p);
        if (d) {
          if (
            d.actorId !== actor.userId ||
            d.decision !== input.decision ||
            d.note !== input.note
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        const c = await context(tx, actor, businessId, opportunityId);
        if (
          !(await latest(tx, p)) ||
          (await execution(tx, p)) ||
          p.contextKey !== c.key ||
          p.policyVersion !== c.authority.version ||
          c.need.ownerId !== p.actorId
        )
          throw new ApplicationError("CONFLICT");
        await authorizeOriginal(tx, p);
        await tx.insert(commercialDecision).values({
          id: randomUUID(),
          businessId,
          opportunityId,
          actionId: p.id,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          payloadHash: p.payloadHash,
          decision: input.decision,
          policyVersion: c.authority.version,
          contextKey: c.key,
          note: input.note,
          at: clock.now(),
        });
      });
    },
    async execute(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: Ref,
      provider: CommercialProvider,
    ) {
      const acquired = await scope(actor, businessId, async (tx) => {
        const p = await find(tx, businessId, opportunityId, input);
        if (p.actorId !== actor.userId) throw new ApplicationError("FORBIDDEN");
        if (await execution(tx, p)) return false;
        const reason = await guard(tx, actor, p);
        if (!reason && !provider.available)
          throw new ApplicationError("COMMERCIAL_SETUP_REQUIRED");
        await tx.insert(commercialExecution).values({
          id: randomUUID(),
          businessId,
          opportunityId,
          actionId: p.id,
          actorId: actor.userId,
          state: reason ? "blocked" : "committed",
          reason: reason ?? "dispatch_unconfirmed",
          provider: provider.key,
          at: clock.now(),
        });
        return !reason;
      });
      if (!acquired) return;
      await scope(actor, businessId, async (tx) => {
        const p = await find(tx, businessId, opportunityId, input);
        // Reconciliation may have completed the action between the durable claim
        // and this transaction. Its evidence must prevent a later provider call.
        const currentExecution = await execution(tx, p);
        if (currentExecution?.state !== "committed") return;
        const reason = await guard(tx, actor, p);
        async function finish(
          state: "completed" | "failed" | "ambiguous" | "blocked",
          reason: string | null,
          reference: string | null = null,
        ) {
          await tx
            .update(commercialExecution)
            .set({ state, reason, reference })
            .where(
              and(
                eq(commercialExecution.actionId, p.id),
                eq(commercialExecution.businessId, businessId),
              ),
            );
        }
        if (reason) {
          await finish("blocked", reason);
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        try {
          const raw = await Promise.race([
            provider.execute(
              {
                businessId,
                opportunityId,
                actionId: p.id,
                payloadHash: p.payloadHash,
                payload: p.payload,
              },
              controller.signal,
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new ApplicationError("PROVIDER_UNAVAILABLE"));
              }, 5000);
            }),
          ]);
          const result = commercialProviderResultSchema.safeParse(raw);
          if (!result.success) {
            await finish("ambiguous", "invalid_provider_result");
            return;
          }
          const r = result.data;
          if (r.status === "failed") {
            await finish("failed", r.reason);
            return;
          }
          if (
            r.businessId !== businessId ||
            r.actionId !== p.id ||
            r.payloadHash !== p.payloadHash ||
            new Date(r.occurredAt) > clock.now() ||
            new Date(r.occurredAt) < p.at ||
            (r.outcome &&
              ((r.outcome === "issued_quote" &&
                p.payload.action !== "quotations") ||
                (r.outcome !== "issued_quote" &&
                  p.payload.action !== "orders") ||
                r.outcome === "confirmed_sale"))
          ) {
            await finish("ambiguous", "receipt_mismatch");
            return;
          }
          if (r.outcome)
            await addEvidence(
              tx,
              actor,
              p,
              {
                actionId: p.id,
                payloadHash: p.payloadHash,
                kind: r.outcome,
                reference: r.reference,
                occurredAt: r.occurredAt,
                note: "Authoritative configured provider receipt",
              },
              `provider:${provider.key}`,
            );
          await finish("completed", null, r.reference);
        } catch {
          await finish("ambiguous", "external_result_unknown");
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
    },
    evidence(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: CommercialEvidence,
    ) {
      return scope(actor, businessId, async (tx) => {
        await privileged(tx, actor, businessId);
        const p = await find(tx, businessId, opportunityId, input);
        const e = await execution(tx, p);
        if (!e) {
          if (p.payload.mode !== "manual" || (await guard(tx, actor, p)))
            throw new ApplicationError("CONFLICT");
          await tx.insert(commercialExecution).values({
            id: randomUUID(),
            businessId,
            opportunityId,
            actionId: p.id,
            actorId: actor.userId,
            state: "completed",
            reason: "business_attested",
            reference: input.reference,
            provider: "business",
            at: clock.now(),
          });
        } else if (!["completed", "ambiguous", "committed"].includes(e.state))
          throw new ApplicationError("CONFLICT");
        await addEvidence(tx, actor, p, input, "business");
        if (e && e.state !== "completed")
          await tx
            .update(commercialExecution)
            .set({
              state: "completed",
              reason: "business_reconciled",
              reference: input.reference,
            })
            .where(
              and(
                eq(commercialExecution.actionId, p.id),
                eq(commercialExecution.businessId, businessId),
              ),
            );
      });
    },
  };
}
