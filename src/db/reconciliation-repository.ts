import { and, or, eq, sql, getTableColumns } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  reconciliationSourceSchema,
  type ReconciliationPeriod,
  type ReconciliationEntry,
  type ReconciliationEvidenceInput,
  reconciliationReviewSchema,
} from "../models/reconciliation";
import {
  platformOperator,
  reconciliationEvidence,
  reconciliationRecord,
  reconciliationReview,
  reconciliationAccess,
} from "./schema";
import { scoped, type Transaction } from "./scope";
import type { Database } from "./runtime";
import { reconciliationReport } from "../application/reconciliation-report";

async function authorize(tx: Transaction, actor: Actor) {
  const [op] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!op?.reconciliation) throw new ApplicationError("FORBIDDEN");
}
export const reconciliationHash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function reconciliationIdentity(data: ReconciliationEntry) {
  const parts =
    data.kind === "settlement"
      ? [data.kind, data.provider, data.account, data.mode, data.settlementId]
      : [data.kind, data.bankAccountRef, data.bankTransactionId];
  return `[${parts.map((p) => JSON.stringify(p)).join(", ")}]`;
}
const { contentBase64: privateContentColumn, ...evidenceMetadataColumns } =
  getTableColumns(reconciliationEvidence);
void privateContentColumn;
function evidenceView(
  row: Omit<typeof reconciliationEvidence.$inferSelect, "contentBase64"> & {
    contentBase64?: string;
  },
) {
  const { contentBase64, ...view } = row;
  void contentBase64;
  return {
    ...view,
    at: row.at.toISOString(),
    storageIdentity: `postgres:reconciliation_evidence:${row.id}:${row.sha256}`,
    provenance: "operator_assertion" as const,
  };
}
const recordView = (row: typeof reconciliationRecord.$inferSelect) => ({
  ...row,
  at: row.at.toISOString(),
  provenance: "operator_assertion" as const,
});
async function sources(tx: Transaction, period: ReconciliationPeriod) {
  const result = await tx.execute<{ sources: unknown }>(
    sql`select public.reconciliation_sources(${period.from}::timestamptz,${period.until}::timestamptz) as sources`,
  );
  return z.array(reconciliationSourceSchema).parse(result.rows[0]?.sources);
}
async function requireGrant(
  tx: Transaction,
  actor: Actor,
  evidenceId: string,
  token: string,
) {
  const [grant] = await tx
    .select({ id: reconciliationAccess.id })
    .from(reconciliationAccess)
    .where(
      and(
        eq(reconciliationAccess.evidenceId, evidenceId),
        eq(reconciliationAccess.actorId, actor.userId),
        eq(reconciliationAccess.tokenHash, reconciliationHash(token)),
        sql`${reconciliationAccess.expiresAt}>statement_timestamp()`,
      ),
    );
  if (!grant) throw new ApplicationError("FORBIDDEN");
}
export function createReconciliationRepository(database: Database) {
  async function snapshot(tx: Transaction) {
    return {
      sources: await sources(tx, {
        from: "1970-01-01T00:00:00.000Z",
        until: "9999-01-01T00:00:00.000Z",
      }),
      records: (await tx.select().from(reconciliationRecord))
        .map(recordView)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
      evidence: (
        await tx.select(evidenceMetadataColumns).from(reconciliationEvidence)
      ).map(evidenceView),
      reviews: (await tx.select().from(reconciliationReview)).map((r) => ({
        ...r,
        at: r.at.toISOString(),
      })),
    };
  }
  const global = <T>(actor: Actor, op: (tx: Transaction) => Promise<T>) =>
    scoped(database, actor, "", async (tx) => {
      await authorize(tx, actor);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('reconciliation',0))`,
      );
      await authorize(tx, actor);
      const result = await op(tx);
      await authorize(tx, actor);
      return result;
    });
  return {
    authorize: (actor: Actor) =>
      scoped(database, actor, "", (tx) => authorize(tx, actor)),
    sources: (actor: Actor, period: ReconciliationPeriod) =>
      scoped(database, actor, "", async (tx) => {
        await authorize(tx, actor);
        return sources(tx, period);
      }),
    snapshot: (actor: Actor) => global(actor, snapshot),
    recordEvidence: (
      actor: Actor,
      input: ReconciliationEvidenceInput,
      sha256: string,
      bytes: number,
    ) =>
      global(actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(reconciliationEvidence)
          .where(eq(reconciliationEvidence.requestKey, input.requestKey));
        if (old) {
          const { id, at, ...saved } = old;
          void id;
          void at;
          if (
            !isDeepStrictEqual(saved, {
              ...input,
              actorId: actor.userId,
              sha256,
              bytes,
            })
          )
            throw new ApplicationError("CONFLICT");
          return evidenceView(old);
        }
        const [row] = await tx
          .insert(reconciliationEvidence)
          .values({
            id: randomUUID(),
            ...input,
            sha256,
            bytes,
            actorId: actor.userId,
          })
          .returning();
        return evidenceView(row);
      }),
    record: (actor: Actor, data: ReconciliationEntry) =>
      global(actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(reconciliationRecord)
          .where(eq(reconciliationRecord.requestKey, data.requestKey));
        if (old) {
          if (
            old.actorId !== actor.userId ||
            !isDeepStrictEqual(old.data, data)
          )
            throw new ApplicationError("CONFLICT");
          return recordView(old);
        }
        const identity = reconciliationIdentity(data);
        const [evidence] = await tx
          .select()
          .from(reconciliationEvidence)
          .where(eq(reconciliationEvidence.id, data.evidenceId));
        if (
          !evidence ||
          evidence.source !==
            (data.kind === "settlement"
              ? "provider_statement"
              : "bank_statement")
        )
          throw new ApplicationError("INVALID_INPUT");
        const predecessors = [
          ...(data.supersedes ? [data.supersedes] : []),
          ...data.supersedesAlso,
        ];
        if (new Set(predecessors).size !== predecessors.length)
          throw new ApplicationError("INVALID_INPUT");
        for (const predecessor of predecessors) {
          const [previous] = await tx
            .select()
            .from(reconciliationRecord)
            .where(eq(reconciliationRecord.id, predecessor));
          const [replaced] = await tx
            .select()
            .from(reconciliationRecord)
            .where(
              or(
                eq(reconciliationRecord.supersedes, predecessor),
                sql`${reconciliationRecord.data}->'supersedesAlso' ? ${predecessor}`,
              ),
            );
          if (!previous || previous.identity !== identity || replaced)
            throw new ApplicationError("CONFLICT");
        }
        if (data.kind === "settlement") {
          const available = await sources(tx, {
            from: "1970-01-01T00:00:00.000Z",
            until: "9999-01-01T00:00:00.000Z",
          });
          for (const line of data.lines) {
            if (line.kind === "unclassified") {
              if (
                line.sourceId ||
                line.businessId ||
                line.paymentId ||
                line.original ||
                line.nativeInvoiceId ||
                line.orderId
              )
                throw new ApplicationError("INVALID_INPUT");
              continue;
            }
            const source = available.find((s) =>
              line.kind === "capture"
                ? s.periodId === line.sourceId
                : s.effects.some(
                    (e) => e.id === line.sourceId && e.source === line.kind,
                  ),
            );
            const effect = source?.effects.find((e) => e.id === line.sourceId);
            if (
              !source ||
              source.businessId !== line.businessId ||
              source.provider !== data.provider ||
              source.account !== data.account ||
              source.mode !== data.mode ||
              source.paymentId !== line.paymentId ||
              source.orderId !== line.orderId ||
              source.nativeInvoiceId !== line.nativeInvoiceId ||
              line.nativeId !==
                (line.kind === "capture"
                  ? source.paymentId
                  : effect?.nativeId) ||
              !line.original ||
              line.original.currency !== source.currency ||
              line.original.minor !==
                (line.kind === "capture"
                  ? source.totals.totalMinor
                  : effect?.actualMinor)
            )
              throw new ApplicationError("INVALID_INPUT");
            if (line.conversion) {
              const [fx] = await tx
                .select()
                .from(reconciliationEvidence)
                .where(
                  eq(reconciliationEvidence.id, line.conversion.evidenceId),
                );
              if (!fx || fx.source !== "conversion_confirmation")
                throw new ApplicationError("INVALID_INPUT");
            }
          }
        }
        const [row] = await tx
          .insert(reconciliationRecord)
          .values({
            id: randomUUID(),
            requestKey: data.requestKey,
            evidenceId: data.evidenceId,
            supersedes: data.supersedes,
            identity,
            data,
            actorId: actor.userId,
          })
          .returning();
        return recordView(row);
      }),
    review: (actor: Actor, input: z.infer<typeof reconciliationReviewSchema>) =>
      global(actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(reconciliationReview)
          .where(eq(reconciliationReview.requestKey, input.requestKey));
        if (old) {
          if (
            old.actorId !== actor.userId ||
            !isDeepStrictEqual(input, {
              requestKey: old.requestKey,
              recordId: old.recordId,
              reportHash: old.reportHash,
              outcome: old.outcome,
              note: old.note,
              evidenceIds: old.evidenceIds,
            })
          )
            throw new ApplicationError("CONFLICT");
          return { ...old, at: old.at.toISOString() };
        }
        const state = reconciliationReport(await snapshot(tx), {
          from: "1970-01-01T00:00:00.000Z",
          until: "9999-01-01T00:00:00.000Z",
        });
        const current = state.settlements.find((r) => r.id === input.recordId);
        if (
          !current ||
          current.reportHash !== input.reportHash ||
          (input.outcome === "resolved" && current.reasons.length)
        )
          throw new ApplicationError("CONFLICT");
        const discrepancy = {
          reportHash: current.reportHash,
          expectedNetMinor: current.expectedNetMinor,
          observedNetMinor: current.observedNetMinor,
          providerDifferenceMinor: current.providerDifferenceMinor,
          transferDifferenceMinor: current.transferDifferenceMinor,
          bankObservedMinor: current.bankObservedMinor,
          bankDifferenceMinor: current.bankDifferenceMinor,
          reasons: current.reasons,
          receiptIds: current.receipts.map((r) => r.id),
          sourceIds: current.movements.map((l) => l.sourceId),
        };
        for (const id of input.evidenceIds) {
          const [e] = await tx
            .select({ id: reconciliationEvidence.id })
            .from(reconciliationEvidence)
            .where(eq(reconciliationEvidence.id, id));
          if (!e) throw new ApplicationError("INVALID_INPUT");
        }
        const [row] = await tx
          .insert(reconciliationReview)
          .values({
            id: randomUUID(),
            ...input,
            discrepancy,
            actorId: actor.userId,
          })
          .returning();
        return { ...row, at: row.at.toISOString() };
      }),
    grant: (actor: Actor, evidenceId: string) =>
      global(actor, async (tx) => {
        const [e] = await tx
          .select({ id: reconciliationEvidence.id })
          .from(reconciliationEvidence)
          .where(eq(reconciliationEvidence.id, evidenceId));
        if (!e) throw new ApplicationError("NOT_FOUND");
        const token = randomBytes(32).toString("hex");
        const [row] = await tx
          .insert(reconciliationAccess)
          .values({
            id: randomUUID(),
            actorId: actor.userId,
            evidenceId,
            tokenHash: reconciliationHash(token),
          })
          .returning();
        return { token, expiresAt: row.expiresAt.toISOString(), evidenceId };
      }),
    content: (actor: Actor, evidenceId: string, token: string) =>
      global(actor, async (tx) => {
        await requireGrant(tx, actor, evidenceId, token);
        const [e] = await tx
          .select()
          .from(reconciliationEvidence)
          .where(eq(reconciliationEvidence.id, evidenceId));
        if (!e) throw new ApplicationError("NOT_FOUND");
        return e;
      }),
    checkAccess: (actor: Actor, evidenceId: string, token: string) =>
      global(actor, (tx) => requireGrant(tx, actor, evidenceId, token)),
  };
}
