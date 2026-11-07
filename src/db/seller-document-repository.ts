import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  issuerRevision,
  issuerDecision,
  platformOperator,
  sellerDocument,
  sellerDocumentRequest,
  sellerDocumentAccess,
  sellerDocumentStorage,
  subscriptionPeriod,
} from "./schema";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import {
  sellerDocumentSchema,
  type SaveIssuer,
  type DecideIssuer,
  type IssuerCatalog,
  type IssueDocument,
  type DocumentSnapshot,
  type AdjustDocument,
} from "../models/seller-documents";
import { allocateCredit } from "../application/seller-document-credit";
import { renderSellerDocument } from "../application/seller-document-artifact";
import { createHash } from "node:crypto";

type Row = typeof sellerDocument.$inferSelect;
function requireDocumentMode(row: Row, mode: "fixture" | "live") {
  const financial = row.snapshot.financial;
  if (
    (financial.provider.mode === "test"
      ? "fixture"
      : financial.provider.mode) !== mode ||
    financial.tax.mode !== mode ||
    row.snapshot.issuer.revision.configuration.mode !== mode
  )
    throw new ApplicationError("CONFLICT");
}
export type DocumentWork = {
  id: string;
  business_id: string;
  recovery_key: string;
};
export type DocumentIdentity = Actor & { work?: DocumentWork };
function view(row: Row) {
  return sellerDocumentSchema.parse({
    ...row,
    at: row.at.toISOString(),
    retainUntil: row.retainUntil.toISOString(),
    artifact: {
      state: row.artifactState,
      failure: row.failure,
      sha256: row.sha256,
      bytes: row.bytes,
    },
  });
}
async function access(
  tx: Transaction,
  actor: DocumentIdentity,
  businessId: string,
  operator: boolean,
) {
  if (actor.work) {
    await tx.execute(
      sql`select set_config('app.seller_document',${actor.work.id},true),set_config('app.seller_capability',${actor.work.recovery_key},true)`,
    );
    const result = await tx.execute<{ allowed: boolean }>(
      sql`select public.seller_artifact_worker_authorized(${actor.work.id}::uuid,${businessId}::uuid) as allowed`,
    );
    if (actor.work.business_id !== businessId || !result.rows[0]?.allowed)
      throw new ApplicationError("FORBIDDEN");
    return;
  }
  if (operator) return requireOperator(tx, actor);
  await requireCapability(tx, actor, businessId, "billing.manage");
}
async function documents(tx: Transaction, businessId: string) {
  return tx
    .select()
    .from(sellerDocument)
    .where(eq(sellerDocument.businessId, businessId))
    .orderBy(asc(sellerDocument.at), asc(sellerDocument.number));
}
async function read(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(sellerDocument)
    .where(
      and(eq(sellerDocument.businessId, businessId), eq(sellerDocument.id, id)),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
function selectedIssuer(
  state: IssuerCatalog,
  mode: "fixture" | "live",
  at: Date,
) {
  const revision = state.revisions
    .filter(
      (r) =>
        r.configuration.mode === mode &&
        new Date(r.configuration.effectiveFrom) <= at &&
        state.decisions.some((d) => d.revisionId === r.id),
    )
    .at(-1);
  const approval = state.decisions
    .filter((d) => d.revisionId === revision?.id)
    .at(-1);
  if (
    !revision ||
    !approval ||
    approval.outcome !== "approved" ||
    (revision.configuration.effectiveUntil &&
      new Date(revision.configuration.effectiveUntil) <= at)
  )
    throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
  return { revision, approval };
}

async function requireOperator(tx: Transaction, actor: Actor) {
  const [op] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!op?.documents) throw new ApplicationError("FORBIDDEN");
}
async function lockIssuers(tx: Transaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('seller-documents',0))`,
  );
}
async function catalog(tx: Transaction): Promise<IssuerCatalog> {
  const revisions = await tx
    .select()
    .from(issuerRevision)
    .orderBy(asc(issuerRevision.version));
  const decisions = await tx
    .select()
    .from(issuerDecision)
    .orderBy(asc(issuerDecision.version));
  return {
    revisions: revisions.map((r) => ({ ...r, at: r.at.toISOString() })),
    decisions: decisions.map((r) => ({ ...r, at: r.at.toISOString() })),
  };
}
export function createSellerDocumentRepository(database: Database) {
  return {
    queue: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        await requireOperator(tx, actor);
        const periods = await tx
          .select()
          .from(subscriptionPeriod)
          .orderBy(asc(subscriptionPeriod.start));
        const grouped = new Map<
          string,
          { businessId: string; name: string; payments: number }
        >();
        for (const p of periods) {
          const item = grouped.get(p.businessId) ?? {
            businessId: p.businessId,
            name:
              p.snapshot.tax.billing.current?.profile.legalName ?? p.businessId,
            payments: 0,
          };
          item.payments++;
          grouped.set(p.businessId, item);
        }
        return [...grouped.values()];
      }),
    async pending(accountScope: string, leaseSeconds: number) {
      const result = await database.execute<DocumentWork>(
        sql`select * from public.claim_seller_artifacts(${accountScope},${leaseSeconds})`,
      );
      return result.rows;
    },
    workspace: (actor: Actor, businessId: string, operator: boolean) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        const periods = await tx
          .select()
          .from(subscriptionPeriod)
          .where(eq(subscriptionPeriod.businessId, businessId))
          .orderBy(asc(subscriptionPeriod.start));
        const docs = await documents(tx, businessId),
          usage = await tx
            .select()
            .from(sellerDocumentStorage)
            .where(eq(sellerDocumentStorage.businessId, businessId));
        return {
          documents: docs.map(view),
          periods: periods.map((p) => ({
            id: p.id,
            paymentId: p.paymentId,
            start: p.start.toISOString(),
            end: p.end.toISOString(),
            currency: p.snapshot.tax.currency,
            totalMinor: p.snapshot.tax.totals?.totalMinor ?? null,
          })),
          storageUsage: {
            storedBytes: docs.reduce((n, d) => n + d.bytes, 0),
            putAttempts: usage.filter((u) => u.action === "put").length,
            getAttempts: usage.filter((u) => u.action === "get").length,
            uncertainAttempts: usage.filter((u) => u.outcome === "uncertain")
              .length,
          },
        };
      }),
    issue: (
      actor: Actor,
      businessId: string,
      input: IssueDocument,
      at: Date,
      mode: "fixture" | "live",
      policy: { accountScope: string; maxBytes: number },
      operator: boolean,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await access(tx, actor, businessId, operator);
          await lockIssuers(tx);
          const payload = { kind: "invoice", periodId: input.periodId };
          const [previous] = await tx
            .select()
            .from(sellerDocumentRequest)
            .where(
              and(
                eq(sellerDocumentRequest.businessId, businessId),
                eq(sellerDocumentRequest.requestKey, input.requestKey),
              ),
            );
          if (previous) {
            if (!isDeepStrictEqual(previous.payload, payload))
              throw new ApplicationError("CONFLICT");
            const row = await read(tx, businessId, previous.documentId);
            requireDocumentMode(row, mode);
            return view(row);
          }
          const existing = (await documents(tx, businessId)).find(
            (d) => d.kind === "invoice" && d.periodId === input.periodId,
          );
          let row = existing;
          if (row) requireDocumentMode(row, mode);
          if (!row) {
            const [period] = await tx
              .select()
              .from(subscriptionPeriod)
              .where(
                and(
                  eq(subscriptionPeriod.id, input.periodId),
                  eq(subscriptionPeriod.businessId, businessId),
                ),
              );
            if (!period) throw new ApplicationError("NOT_FOUND");
            // Financial amounts come ONLY from the captured period's actual charge/tax basis.
            const financial = period.snapshot,
              tax = financial.tax;
            if (
              tax.status !== "calculated" ||
              !tax.totals ||
              BigInt(tax.totals.totalMinor) <= 0n ||
              !tax.lines.length ||
              tax.businessId !== businessId ||
              financial.quote.businessId !== businessId ||
              tax.billing.status !== "reviewed" ||
              !tax.billing.current ||
              (financial.provider.mode === "test"
                ? "fixture"
                : financial.provider.mode) !== mode ||
              period.provider !== financial.provider.key ||
              period.account !== financial.provider.account ||
              tax.mode !== mode
            )
              throw new ApplicationError("CONFLICT");
            const issuer = selectedIssuer(
                await catalog(tx),
                mode,
                period.start,
              ),
              configuration = issuer.revision.configuration;
            const currency = configuration.currencies.find(
              (c) => c.currency === tax.currency,
            );
            if (
              !currency ||
              tax.lines.some(
                (l) =>
                  ![currency.rounding, ...currency.additionalRoundings].some(
                    (rounding) =>
                      isDeepStrictEqual(
                        l.rule.revision.rule.rounding,
                        rounding,
                      ),
                  ),
              )
            )
              throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
            const customer = tax.billing.current.profile;
            for (const field of configuration.requiredCustomerFields) {
              if (
                field === "address"
                  ? !customer.address.line1 || !customer.address.country
                  : field === "invoiceContact"
                    ? !customer.invoiceContact.email
                    : field === "taxIdentifiers"
                      ? !customer.taxIdentifiers.length
                      : !customer[field]
              )
                throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
            }
            const series = configuration.series.invoice;
            const allocated = await tx.execute<{ ordinal: string }>(
              sql`select public.seller_next_number(${businessId}::uuid,${series.key},${series.first}::bigint)::text as ordinal`,
            );
            const ordinal = BigInt(allocated.rows[0].ordinal);
            const snapshot: DocumentSnapshot = {
              version: 1,
              source: {
                periodId: period.id,
                actionId: period.actionId,
                paymentId: period.paymentId,
                provider: period.provider,
                account: period.account,
                start: period.start.toISOString(),
                end: period.end.toISOString(),
                charge: period.charge ?? null,
              },
              financial,
              issuer,
              currency: tax.currency,
              precision: currency.precision,
              lines: tax.lines,
              totals: tax.totals,
              original: null,
              adjustment: null,
            };
            const initial = {
              id: randomUUID(),
              recoveryKey: randomUUID(),
              businessId,
              periodId: period.id,
              originalId: null,
              kind: "invoice" as const,
              seriesKey: series.key,
              ordinal,
              number: `${series.prefix}${ordinal.toString().padStart(series.width, "0")}`,
              snapshot,
              actorId: actor.userId,
              at,
              retainUntil: new Date(
                at.getTime() + configuration.retention.minimumSeconds * 1000,
              ),
              accountScope: policy.accountScope,
            };
            const bytes = renderSellerDocument({
              ...initial,
              at: at.toISOString(),
            });
            if (bytes.byteLength > policy.maxBytes)
              throw new ApplicationError("FILE_DISALLOWED");
            [row] = await tx
              .insert(sellerDocument)
              .values({
                ...initial,
                artifactState: "pending",
                bytes: bytes.byteLength,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              })
              .returning();
          }
          await tx.insert(sellerDocumentRequest).values({
            id: randomUUID(),
            businessId,
            documentId: row.id,
            requestKey: input.requestKey,
            payload,
            actorId: actor.userId,
            at,
          });
          return view(row);
        },
        { lock: true },
      ),
    adjust: (
      actor: Actor,
      businessId: string,
      input: AdjustDocument,
      at: Date,
      mode: "fixture" | "live",
      policy: { accountScope: string; maxBytes: number },
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireOperator(tx, actor);
          await lockIssuers(tx);
          const { requestKey, ...adjustment } = input,
            payload = { kind: "credit_note", ...adjustment };
          const native = await tx.execute<{ allowed: boolean }>(
            sql`select public.financial_credit_allowed(${JSON.stringify(input)}::jsonb) as allowed`,
          );
          if (!native.rows[0]?.allowed) throw new ApplicationError("CONFLICT");
          const reservation = await tx.execute<{ reserved: boolean }>(
            sql`select public.financial_reserved(${input.invoiceId}::uuid,${input.adjustmentId}::uuid) as reserved`,
          );
          if (reservation.rows[0]?.reserved)
            throw new ApplicationError("CONFLICT");
          const [request] = await tx
            .select()
            .from(sellerDocumentRequest)
            .where(
              and(
                eq(sellerDocumentRequest.businessId, businessId),
                eq(sellerDocumentRequest.requestKey, requestKey),
              ),
            );
          if (request) {
            if (!isDeepStrictEqual(request.payload, payload))
              throw new ApplicationError("CONFLICT");
            const row = await read(tx, businessId, request.documentId);
            requireDocumentMode(row, mode);
            return view(row);
          }
          const rows = await documents(tx, businessId),
            original = rows.find(
              (r) => r.id === input.invoiceId && r.kind === "invoice",
            );
          if (!original) throw new ApplicationError("NOT_FOUND");
          requireDocumentMode(original, mode);
          if (
            original.periodId !== input.periodId ||
            original.snapshot.source.paymentId !== input.paymentId
          )
            throw new ApplicationError("CONFLICT");
          let row = rows.find(
            (r) =>
              r.adjustmentId === input.adjustmentId ||
              (r.originalId === original.id &&
                r.adjustmentSource ===
                  `${input.source.kind}:${input.source.reference}`),
          );
          if (row) {
            const recorded = row.snapshot.adjustment;
            if (
              !recorded ||
              !isDeepStrictEqual(
                {
                  invoiceId: recorded.invoiceId,
                  periodId: recorded.periodId,
                  paymentId: recorded.paymentId,
                  adjustmentId: recorded.adjustmentId,
                  source: recorded.source,
                  reason: recorded.reason,
                  evidence: recorded.evidence,
                  lines: recorded.lines,
                },
                adjustment,
              )
            )
              throw new ApplicationError("CONFLICT");
          } else {
            const issuer = selectedIssuer(await catalog(tx), mode, at),
              configuration = issuer.revision.configuration;
            if (
              !configuration.currencies.some(
                (c) => c.currency === original.snapshot.currency,
              )
            )
              throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
            const allocated = allocateCredit(
              view(original),
              rows.filter((d) => d.originalId === original.id).map(view),
              input,
            );
            const series = configuration.series.credit_note,
              allocation = await tx.execute<{ ordinal: string }>(
                sql`select public.seller_next_number(${businessId}::uuid,${series.key},${series.first}::bigint)::text as ordinal`,
              ),
              ordinal = BigInt(allocation.rows[0].ordinal);
            const snapshot: DocumentSnapshot = {
              ...original.snapshot,
              issuer,
              lines: allocated.lines,
              totals: allocated.totals,
              original: {
                id: original.id,
                number: original.number,
                issuer: original.snapshot.issuer,
              },
              adjustment: {
                ...adjustment,
                allocation:
                  original.snapshot.issuer.revision.configuration
                    .creditAllocation,
                cumulative: allocated.cumulative,
              },
            };
            const initial = {
              id: randomUUID(),
              recoveryKey: randomUUID(),
              businessId,
              periodId: original.periodId,
              originalId: original.id,
              adjustmentId: input.adjustmentId,
              adjustmentSource: `${input.source.kind}:${input.source.reference}`,
              kind: "credit_note" as const,
              seriesKey: series.key,
              ordinal,
              number: `${series.prefix}${ordinal.toString().padStart(series.width, "0")}`,
              snapshot,
              actorId: actor.userId,
              at,
              retainUntil: new Date(
                Math.max(
                  original.retainUntil.getTime(),
                  at.getTime() + configuration.retention.minimumSeconds * 1000,
                ),
              ),
              accountScope: policy.accountScope,
            };
            const bytes = renderSellerDocument({
              ...initial,
              at: at.toISOString(),
            });
            if (bytes.byteLength > policy.maxBytes)
              throw new ApplicationError("FILE_DISALLOWED");
            [row] = await tx
              .insert(sellerDocument)
              .values({
                ...initial,
                artifactState: "pending",
                bytes: bytes.byteLength,
                sha256: createHash("sha256").update(bytes).digest("hex"),
              })
              .returning();
          }
          await tx.insert(sellerDocumentRequest).values({
            id: randomUUID(),
            businessId,
            documentId: row.id,
            requestKey,
            payload,
            actorId: actor.userId,
            at,
          });
          return view(row);
        },
        { lock: true },
      ),
    read: (
      actor: DocumentIdentity,
      businessId: string,
      id: string,
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        return read(tx, businessId, id);
      }),
    grant: (
      actor: Actor,
      businessId: string,
      id: string,
      tokenHash: string,
      expiresAt: Date,
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        const row = await read(tx, businessId, id);
        if (row.artifactState !== "ready")
          throw new ApplicationError("FILE_UNAVAILABLE");
        await tx.insert(sellerDocumentAccess).values({
          id: randomUUID(),
          businessId,
          documentId: id,
          actorId: actor.userId,
          tokenHash,
          expiresAt,
        });
      }),
    checkGrant: (
      actor: Actor,
      businessId: string,
      id: string,
      tokenHash: string,
      at: Date,
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        const row = await read(tx, businessId, id);
        const [grant] = await tx
          .select()
          .from(sellerDocumentAccess)
          .where(
            and(
              eq(sellerDocumentAccess.businessId, businessId),
              eq(sellerDocumentAccess.documentId, id),
              eq(sellerDocumentAccess.actorId, actor.userId),
              eq(sellerDocumentAccess.tokenHash, tokenHash),
            ),
          );
        if (!grant || grant.expiresAt <= at || row.artifactState !== "ready")
          throw new ApplicationError("FILE_UNAVAILABLE");
        return row;
      }),
    storageIntent: (
      actor: DocumentIdentity,
      businessId: string,
      id: string,
      action: "put" | "get",
      at: Date,
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        await read(tx, businessId, id);
        const operationId = randomUUID();
        await tx.insert(sellerDocumentStorage).values({
          id: operationId,
          businessId,
          documentId: id,
          actorId: actor.work ? null : actor.userId,
          at,
          action,
          outcome: "uncertain",
        });
        return operationId;
      }),
    confirmStorage: (
      actor: DocumentIdentity,
      businessId: string,
      operationId: string,
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        await tx
          .update(sellerDocumentStorage)
          .set({ outcome: "confirmed" })
          .where(
            and(
              eq(sellerDocumentStorage.id, operationId),
              eq(sellerDocumentStorage.businessId, businessId),
            ),
          );
      }),
    artifact: (
      actor: DocumentIdentity,
      businessId: string,
      id: string,
      state: "ready" | "failed",
      operator: boolean,
    ) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId, operator);
        const row = await read(tx, businessId, id);
        if (row.artifactState === "ready") return view(row);
        const [updated] = await tx
          .update(sellerDocument)
          .set({
            artifactState: state,
            failure: state === "failed" ? "ARTIFACT_UNCONFIRMED" : null,
          })
          .where(
            and(
              eq(sellerDocument.id, id),
              ne(sellerDocument.artifactState, "ready"),
            ),
          )
          .returning();
        // A concurrent successful recovery is terminal, including when this
        // attempt read the older state before waiting on the UPDATE lock.
        return view(updated ?? (await read(tx, businessId, id)));
      }),
    catalog: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        await requireOperator(tx, actor);
        return catalog(tx);
      }),
    saveIssuer: (actor: Actor, input: SaveIssuer, at: Date) =>
      scoped(database, actor, "", async (tx) => {
        await requireOperator(tx, actor);
        await lockIssuers(tx);
        const state = await catalog(tx);
        if (state.revisions.length !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        for (const previous of state.revisions)
          for (const kind of ["invoice", "credit_note"] as const) {
            const old = previous.configuration.series[kind];
            for (const next of Object.values(input.configuration.series)) {
              if (
                (old.key === next.key && !isDeepStrictEqual(old, next)) ||
                (old.prefix === next.prefix && old.key !== next.key)
              )
                throw new ApplicationError("CONFLICT");
            }
          }
        await tx.insert(issuerRevision).values({
          id: randomUUID(),
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          actorId: actor.userId,
          at,
          note: input.note,
        });
        return catalog(tx);
      }),
    decideIssuer: (actor: Actor, input: DecideIssuer, at: Date) =>
      scoped(database, actor, "", async (tx) => {
        await requireOperator(tx, actor);
        await lockIssuers(tx);
        const state = await catalog(tx);
        if (!state.revisions.some((r) => r.id === input.revisionId))
          throw new ApplicationError("NOT_FOUND");
        const decisions = state.decisions.filter(
          (d) => d.revisionId === input.revisionId,
        );
        if (decisions.length !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        await tx.insert(issuerDecision).values({
          ...input,
          id: randomUUID(),
          version: input.expectedVersion + 1,
          actorId: actor.userId,
          at,
        });
        return catalog(tx);
      }),
  };
}
