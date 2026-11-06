import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { validQualificationValue } from "../models/knowledge";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type { RfqRecord, RfqWorkspace, SaveRfq } from "../models/rfq";
import { ApplicationError } from "../models/application-error";
import { inquiryContext } from "./inquiry-context";
import {
  requireSalesSession,
  writeControl,
} from "./opportunity-control-repository";
import { inquiryRun, rfqRequest, rfqRevision, user } from "./schema";

type Context = Awaited<ReturnType<typeof inquiryContext>>;
function currentSource(
  c: Context,
  field: RfqRecord["fields"][number],
  sources: RfqRecord["sources"],
) {
  if (!field.messageId) return true;
  const message = c.messages.find((m) => m.id === field.messageId);
  const original = sources.find((m) => m.id === field.messageId);
  return (
    !!message &&
    !!original &&
    message.correctionVersion === original.correctionVersion &&
    !!field.quote &&
    message.text.text.includes(field.quote)
  );
}
async function history(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
) {
  return tx
    .select({ row: rfqRevision, actorName: user.name })
    .from(rfqRevision)
    .innerJoin(user, eq(user.id, rfqRevision.actorId))
    .where(
      and(
        eq(rfqRevision.businessId, businessId),
        eq(rfqRevision.opportunityId, opportunityId),
      ),
    )
    .orderBy(asc(rfqRevision.version));
}
export async function readRfqWorkspace(
  tx: Transaction,
  actor: WorkIdentity,
  businessId: string,
  c: Context,
): Promise<RfqWorkspace> {
  const entries = await history(tx, businessId, c.need.id);
  const revisions = entries.map(({ row, actorName }) => ({
    ...row.record,
    id: row.requestId,
    revisionId: row.id,
    version: row.version,
    actorId: row.actorId,
    actorName,
    at: row.at.toISOString(),
    note: row.note,
    nextAction: row.nextAction,
  }));
  const latest = revisions.at(-1);
  const config = c.knowledge?.configuration;
  const [owner] = await tx
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(
      and(
        eq(user.id, c.need.ownerId ?? ""),
        sql`public.rfq_owner_is_current(${c.need.ownerId})`,
      ),
    );
  const setupReason = !config
    ? "Approve current Business knowledge before capturing or reviewing a quotation request."
    : config.goal !== "rfq"
      ? "The approved conversion goal is not quotation requests. Existing RFQ history is retained."
      : !config.offerings.length
        ? "Configure and approve an offering before capturing a quotation request."
        : !owner
          ? "Assign a current Business member as the Opportunity owner."
          : null;
  const issues: string[] = [];
  if (latest) {
    if (!config || config.goal !== "rfq")
      issues.push("Approved RFQ knowledge is unavailable.");
    else if (latest.knowledgeVersion !== c.knowledge?.version)
      issues.push(
        "Approved requirements or knowledge changed; review against the current configuration.",
      );
    if (latest.fields.some((f) => !currentSource(c, f, latest.sources)))
      issues.push(
        "Supporting message association changed; review the retained evidence.",
      );
    if (!owner)
      issues.push("The responsible owner is no longer a Business member.");
  }
  const missing = (config?.qualification ?? latest?.requirements ?? [])
    .filter(
      (r) =>
        r.required &&
        !latest?.fields.some(
          (f) =>
            f.key === r.key &&
            validQualificationValue(r.type, f.value) &&
            currentSource(c, f, latest.sources),
        ),
    )
    .map((r) => r.key);
  const candidates = await tx
    .select()
    .from(inquiryRun)
    .where(
      and(
        eq(inquiryRun.businessId, businessId),
        eq(inquiryRun.opportunityId, c.need.id),
      ),
    )
    .orderBy(asc(inquiryRun.sequence));
  const suggestions = new Map<string, RfqWorkspace["suggestions"][number]>();
  for (const run of candidates) {
    if (
      run.result.status !== "ready" ||
      run.snapshot.knowledgeVersion !== c.knowledge?.version
    )
      continue;
    for (const fact of run.result.facts) {
      const rule = config?.qualification.find((r) => r.key === fact.key);
      if (
        rule &&
        validQualificationValue(rule.type, fact.value) &&
        currentSource(c, fact, run.snapshot.messages)
      )
        suggestions.set(fact.key, fact);
    }
  }
  return {
    current: latest
      ? {
          ...latest,
          status: issues.length
            ? "review_required"
            : missing.length
              ? "incomplete"
              : "complete",
          missing,
          issues,
        }
      : null,
    history: revisions,
    ownerId: c.need.ownerId,
    ownerName: owner?.name ?? null,
    nextAction: c.need.nextAction,
    controlVersion: c.need.controlVersion,
    contextKey: createHash("sha256")
      .update(
        JSON.stringify({
          messages: c.snapshot.messages,
          knowledgeVersion: c.snapshot.knowledgeVersion,
          controlVersion: c.snapshot.controlVersion,
        }),
      )
      .digest("hex"),
    knowledgeVersion: c.knowledge?.version ?? null,
    offerings: config?.offerings ?? [],
    requirements: config?.qualification ?? [],
    suggestions: [...suggestions.values()],
    messages: c.messages.map((m) => ({ id: m.id, text: m.text.text })),
    canSave: !setupReason && owner?.id === actor.userId,
    setupReason,
  };
}

/** All operations reauthorize persisted membership/session/MFA under the #19 Business lock.
 * Requests and revisions are append-only; manual review takes human control and cancels pending automation.
 */
export function createRfqRepository(database: Database, clock: Clock) {
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
  return {
    read(actor: WorkIdentity, businessId: string, opportunityId: string) {
      return scope(actor, businessId, async (tx) =>
        readRfqWorkspace(
          tx,
          actor,
          businessId,
          await inquiryContext(tx, businessId, opportunityId, clock.now()),
        ),
      );
    },
    save(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: SaveRfq,
    ) {
      return scope(actor, businessId, async (tx) => {
        const c = await inquiryContext(
          tx,
          businessId,
          opportunityId,
          clock.now(),
        );
        const state = await readRfqWorkspace(tx, actor, businessId, c);
        if (c.need.ownerId !== actor.userId)
          throw new ApplicationError("FORBIDDEN");
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ opportunityId, input }))
          .digest("hex");
        const [replay] = await tx
          .select()
          .from(rfqRevision)
          .where(
            and(
              eq(rfqRevision.businessId, businessId),
              eq(rfqRevision.requestKey, input.requestKey),
            ),
          );
        if (replay) {
          if (
            replay.fingerprint !== fingerprint ||
            replay.actorId !== actor.userId
          )
            throw new ApplicationError("CONFLICT");
          return state;
        }
        if (
          !state.canSave ||
          input.expectedVersion !== (state.current?.version ?? 0) ||
          input.expectedKnowledgeVersion !== state.knowledgeVersion ||
          input.expectedControlVersion !== state.controlVersion ||
          input.expectedContextKey !== state.contextKey
        )
          throw new ApplicationError("CONFLICT");
        const config = c.knowledge!.configuration;
        const offering = config.offerings.find(
          (o) => o.name === input.offering,
        );
        if (!offering) throw new ApplicationError("INVALID_INPUT");
        for (const field of input.fields) {
          const rule = config.qualification.find((r) => r.key === field.key);
          if (!rule || !validQualificationValue(rule.type, field.value))
            throw new ApplicationError("INVALID_INPUT");
          if (field.messageId) {
            const message = c.messages.find((m) => m.id === field.messageId);
            if (
              !message ||
              !field.quote ||
              !message.text.text.includes(field.quote)
            )
              throw new ApplicationError("INVALID_INPUT");
          }
        }
        const missing = config.qualification
          .filter(
            (r) => r.required && !input.fields.some((f) => f.key === r.key),
          )
          .map((r) => r.key);
        const record: RfqRecord = {
          offering: { name: offering.name, details: offering.details },
          fields: input.fields,
          requirements: config.qualification,
          knowledgeVersion: c.knowledge!.version,
          sources: c.snapshot.messages
            .filter((m) => input.fields.some((f) => f.messageId === m.id))
            .map(({ id, associationVersion, correctionVersion }) => ({
              id,
              associationVersion,
              correctionVersion,
            })),
          completeness: missing.length ? "incomplete" : "complete",
          missing,
        };
        const at = clock.now();
        const id = state.current?.id ?? randomUUID();
        if (!state.current)
          await tx.insert(rfqRequest).values({
            id,
            businessId,
            opportunityId,
            actorId: actor.userId,
            createdAt: at,
          });
        const revisionId = randomUUID();
        await tx.insert(rfqRevision).values({
          id: revisionId,
          businessId,
          opportunityId,
          requestId: id,
          version: input.expectedVersion + 1,
          requestKey: input.requestKey,
          fingerprint,
          actorId: actor.userId,
          record,
          note: input.note,
          nextAction: input.nextAction,
          at,
        });
        await writeControl(
          tx,
          actor,
          businessId,
          c.need,
          {
            reason: `Quotation-request review: ${input.note}`,
            nextAction: input.nextAction,
          },
          "update",
          at,
          null,
          revisionId,
        );
        return readRfqWorkspace(
          tx,
          actor,
          businessId,
          await inquiryContext(tx, businessId, opportunityId, clock.now()),
        );
      });
    },
  };
}
