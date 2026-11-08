import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import type { financialExportFixture } from "./governance-financial";
import type { Database } from "../../src/db/runtime";
import { runtimeDatabase } from "../../src/db/runtime";
import { createReconciliationApplication } from "../../src/application/reconciliation";
import { createReconciliationRepository } from "../../src/db/reconciliation-repository";

export async function recoveryReconciliationFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  f: Awaited<ReturnType<typeof financialExportFixture>>,
) {
  const operator = await h.signIn("export-documents@example.com"),
    actor = await h.authenticate(operator);
  await h.admin.query(
    "UPDATE platform_operator SET reconciliation=true WHERE user_id=$1",
    [actor.userId],
  );
  const application = (database: Database) =>
    createReconciliationApplication({
      authenticatePlatform: async (credentials: Headers) => {
        // Trusted recovery inspection requires CURRENT source domain authority;
        // a restored platform grant is not current authorization after PITR.
        await h.team.requirePlatformCapability(
          credentials,
          "reconciliation.manage",
        );
        return h.access.authenticatePlatformForWork(credentials);
      },
      repository: createReconciliationRepository(database),
      clock: h.clock,
    });
  const app = application(runtimeDatabase(h.runtime)),
    period = {
      from: "2026-11-01T00:00:00.000Z",
      until: "2026-12-01T00:00:00.000Z",
    },
    source = (await app.workspace(operator, period)).sources.find(
      (s) => s.periodId === f.period.id,
    )!;
  const bytes = Buffer.from(
      "Retained private reconciliation statement fixture 58",
    ),
    evidence = await app.recordEvidence(operator, {
      requestKey: randomUUID(),
      source: "provider_statement",
      reference: "recovery-statement-original",
      name: "statement.txt",
      contentType: "text/plain",
      contentBase64: bytes.toString("base64"),
      note: "Retain exact private original bytes under independent reconciliation authority",
    });
  const original = await app.record(operator, {
    requestKey: randomUUID(),
    supersedes: null,
    evidenceId: evidence.id,
    kind: "settlement",
    provider: "razorpay",
    account: source.account,
    mode: source.mode,
    observedAt: h.clock.now().toISOString(),
    reference: "recovery-settlement",
    note: "Original retained statement assertion; fee coverage remains unavailable",
    settlementId: "setl_recovery",
    bankAccountRef: "bank:recovery-fixture",
    transferReference: "UTR-RECOVERY",
    transferAt: h.clock.now().toISOString(),
    status: "processed",
    period,
    money: {
      currency: source.currency,
      precision: 2,
      minor: source.totals.totalMinor,
    },
    creditMinor: source.totals.totalMinor,
    debitMinor: "0",
    fees: {
      coverage: "unavailable",
      amountMinor: null,
      taxMinor: null,
      presentation: "unavailable",
    },
    lines: [
      {
        kind: "capture",
        sourceId: source.periodId,
        businessId: source.businessId,
        paymentId: source.paymentId,
        nativeId: source.paymentId,
        nativeInvoiceId: source.nativeInvoiceId,
        orderId: source.orderId,
        original: {
          currency: source.currency,
          precision: 2,
          minor: source.totals.totalMinor,
        },
        convertedMinor: source.totals.totalMinor,
        conversion: null,
        creditMinor: source.totals.totalMinor,
        debitMinor: "0",
        feeMinor: null,
        feeTaxMinor: null,
        feePresentation: "unavailable",
      },
    ],
  });
  const row = (await app.workspace(operator, period)).settlements.find(
    (s) => s.id === original.id,
  )!;
  const review = await app.review(operator, {
    requestKey: randomUUID(),
    recordId: original.id,
    reportHash: row.reportHash,
    outcome: "acknowledged",
    note: "Retain missing fee/bank coverage as an unresolved assertion",
    evidenceIds: [evidence.id],
  });
  const corrected = await app.record(operator, {
    ...original.data,
    requestKey: randomUUID(),
    supersedes: original.id,
    note: "Append-only correction retains original evidence and financial identities",
  });
  const grant = await app.evidenceAccess(operator, { evidenceId: evidence.id });
  return {
    application,
    operator,
    actor,
    period,
    evidence,
    original,
    corrected,
    review,
    grant,
    bytes,
  };
}
