import { createHash, randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { runtimeDatabase, type Database } from "../../src/db/runtime";
import { createTaxPeriodApplication } from "../../src/application/tax-periods";
import { createTaxPeriodRepository } from "../../src/db/tax-period-repository";
import { createTaxFilingApplication } from "../../src/application/tax-filings";
import { createTaxFilingRepository } from "../../src/db/tax-filing-repository";
import type { LiabilityReport } from "../../src/models/tax-periods";
import type { FilingIntent } from "../../src/models/tax-filings";

/** Genuine public source commands populate every private filing ledger before native backup. */
export async function recoveryTaxFilingFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  f: { native: { effectRequests: { method: string; path: string }[] } },
) {
  const operator = await h.signIn("tax-operator@example.com"),
    reviewer = await h.signIn("recovery-tax-reviewer@example.com"),
    actor = await h.authenticate(operator),
    reviewerActor = await h.authenticate(reviewer);
  await h.provisionOperator(operator, { tax: true, reconciliation: false });
  await h.provisionOperator(reviewer, { tax: true, reconciliation: false });
  async function currentSource(credentials: Headers) {
    // Restored historical grants never establish current source-domain authority.
    await h.team.requirePlatformCapability(credentials, "tax.manage");
    return h.access.authenticatePlatformForWork(credentials);
  }
  const application = (database: Database) => {
    const periods = createTaxPeriodApplication({
      authenticatePlatform: currentSource,
      repository: createTaxPeriodRepository(database),
      clock: h.clock,
    });
    return {
      periods,
      filings: createTaxFilingApplication({
        authenticatePlatform: currentSource,
        periods,
        clock: h.clock,
        repository: createTaxFilingRepository(database, h.clock),
      }),
    };
  };
  const { periods, filings } = application(runtimeDatabase(h.runtime));
  const obligation = await periods.saveObligation(operator, {
    requestKey: randomUUID(),
    key: "recovery-synthetic-return",
    expectedVersion: 0,
    note: "Synthetic recovery scope; no legal jurisdiction assertion",
    definition: {
      mode: "fixture",
      name: "Recovery synthetic return",
      jurisdiction: "fixture-domestic",
      timeZone: "Asia/Kolkata",
      currency: "INR",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      registration: {
        key: "recovery-registration",
        identifier: "TEST-ONLY",
        status: "registered",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        evidence: ["synthetic recovery registration"],
      },
      basis: "document_issue_date",
      unissuedCharges: "require_invoice",
      preparerIds: [actor.userId],
      reviewerIds: [actor.userId, reviewerActor.userId],
      distinctReviewer: false,
      evidence: ["fixture-only explicit tax scope"],
    },
  });
  await periods.decideObligation(operator, {
    requestKey: randomUUID(),
    revisionId: obligation.id,
    expectedVersion: 0,
    outcome: "approved",
    note: "Reviewed exact synthetic scope",
  });
  const period = await periods.openPeriod(operator, {
    requestKey: randomUUID(),
    obligationId: obligation.id,
    startDate: "2026-11-01",
    endDate: "2026-12-01",
    dueAt: "2026-12-12T12:30:00.000Z",
    evidence: ["synthetic recovery due instant"],
    reminders: [],
    note: "Explicit fixture coverage",
  });
  async function report(revision: number) {
    h.clock.set(
      (
        await h.admin.query<{ stamp: Date }>("SELECT clock_timestamp() stamp")
      ).rows[0].stamp.toISOString(),
    );
    const prepared = await periods.prepare(operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: revision,
      cutoff: h.clock.now().toISOString(),
      note: "Retain genuine original invoice and permanent credit",
    });
    if (prepared.unresolved.length)
      throw Error(
        "Recovery tax fixture unresolved: " +
          prepared.unresolved.map((issue) => issue.code).join(","),
      );
    return periods.act(reviewer, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      evidence: ["reviewed retained originals"],
      note: "Exact report review",
    });
  }
  const originalReport = await report(0);
  const identity = (r: LiabilityReport) => ({
    reportId: r.id,
    periodId: r.periodId,
    revision: r.revision,
    digest: r.digest,
    approvalId: r.actions.filter((a) => a.kind === "approve").at(-1)!.id,
  });
  const policy = await filings.savePolicy(operator, {
    requestKey: randomUUID(),
    obligationId: obligation.id,
    expectedVersion: 0,
    note: "Synthetic supported manual procedure",
    definition: {
      adapter: "manual_evidence_v1",
      authorityAccount: "recovery-authority-account",
      fundingAccount: "recovery-funding-account",
      returnType: "Synthetic recovery return",
      filingRequired: true,
      paymentRequired: true,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      retention: {
        disposition: "protected_history",
        policyReference: "synthetic protected filing history and holds",
      },
      evidence: ["explicit fixture procedure; no native filing or banking"],
    },
  });
  await filings.decidePolicy(reviewer, {
    requestKey: randomUUID(),
    policyId: policy.id,
    expectedVersion: 0,
    outcome: "approved",
    note: "Independent procedure review",
  });
  await filings.exportReport(operator, {
    ...identity(originalReport),
    requestKey: randomUUID(),
    note: "Retain exact original export",
  });
  async function work(
    r: LiabilityReport,
    kind: "submission" | "remittance",
    amountMinor: string,
    amendmentOf: string | null = null,
    supersedesId: string | null = null,
  ) {
    const intent = await filings.prepare(operator, {
      ...identity(r),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind,
      amountMinor,
      amendmentOf,
      supersedesId,
      note: "Exact original recovery work order",
    });
    return filings.act(reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Independent exact work approval",
    });
  }
  const marker = "PRIVATE-TAX-FILING-52-ORIGINAL";
  async function original(
    intent: FilingIntent,
    result: "filed" | "settled" | "no_effect",
  ) {
    const bytes = Buffer.from(`${marker} ${intent.id} ${result}`);
    const artifact = await filings.storeEvidence(operator, {
      requestKey: randomUUID(),
      reportId: intent.report.id,
      target: intent.target,
      kind:
        intent.kind === "submission"
          ? "authority_acknowledgement"
          : "bank_confirmation",
      result,
      reference: `synthetic-${randomUUID()}`,
      amountMinor: intent.amountMinor,
      occurredAt: h.clock.now().toISOString(),
      name: "retained-original.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Synthetic original and provenance; operator-entered, not native verification",
    });
    return { artifact, bytes };
  }
  async function confirm(intent: FilingIntent) {
    const retained = await original(
      intent,
      intent.kind === "submission" ? "filed" : "settled",
    );
    const ack = await filings.act(operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: intent.version,
      kind: "acknowledge",
      evidenceId: retained.artifact.id,
      note: "Retain original acknowledgement",
    });
    const confirmed = await filings.act(reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: ack.version,
      kind: "confirm",
      acknowledgementId: ack.events.at(-1)!.id,
      note: "Independent exact original evidence review",
    });
    return { intent: confirmed, ...retained };
  }
  const originalLiability = originalReport.snapshot.totals.taxMinor;
  if (BigInt(originalLiability) <= 400n)
    throw Error(
      "Recovery fixture requires positive retained remittance components",
    );
  const filing = await confirm(
    await work(originalReport, "submission", originalLiability),
  );
  await confirm(await work(originalReport, "remittance", "400"));
  await confirm(
    await work(
      originalReport,
      "remittance",
      String(BigInt(originalLiability) - 400n),
    ),
  );
  const unknown = await work(originalReport, "remittance", "100");
  const attempted = await filings.act(operator, {
    requestKey: randomUUID(),
    intentId: unknown.id,
    expectedVersion: unknown.version,
    kind: "attempt",
    outcome: "unknown",
    reference: "recovery-original-unknown",
    occurredAt: h.clock.now().toISOString(),
    note: "Original uncertain manual assertion; no native effect",
  });
  const absent = await original(attempted, "no_effect");
  await filings.act(reviewer, {
    requestKey: randomUUID(),
    intentId: unknown.id,
    expectedVersion: attempted.version,
    kind: "supersede",
    evidenceId: absent.artifact.id,
    note: "Independent exact conclusive no-effect review",
  });
  const replacement = await work(
    originalReport,
    "remittance",
    "100",
    null,
    unknown.id,
  );
  await filings.act(operator, {
    requestKey: randomUUID(),
    intentId: replacement.id,
    expectedVersion: replacement.version,
    kind: "attempt",
    outcome: "failed",
    reference: "recovery-replacement-failed",
    occurredAt: h.clock.now().toISOString(),
    note: "Failure alone does not prove no effect",
  });
  const currentReport = await report(1);
  await confirm(
    await work(
      currentReport,
      "submission",
      currentReport.snapshot.totals.taxMinor,
      filing.intent.id,
    ),
  );
  for (const allocation of (await filings.workspace(operator)).allocations)
    await filings.reconcileRemittance(reviewer, {
      ...identity(currentReport),
      requestKey: randomUUID(),
      allocationId: allocation.id,
      expectedVersion: 0,
      expectedReportId: originalReport.id,
      policyId: policy.id,
      note: "Explicit same-payment carry-forward; no new transfer",
    });
  await filings.downloadEvidence(operator, { evidenceId: filing.artifact.id });
  const expiredGrant = (
    await h.admin.query<{ id: string; access_hash: string }>(
      "SELECT id,access_hash FROM tax_filing_access WHERE evidence_id=$1 ORDER BY at DESC LIMIT 1",
      [filing.artifact.id],
    )
  ).rows[0];
  // An explicit expired-grant fixture, still within the original 30s CHECK. Recovery must retain this tombstone unchanged.
  await h.admin.query(
    "WITH stamp AS(SELECT clock_timestamp() observed) UPDATE tax_filing_access SET at=stamp.observed-interval '60 seconds',expires_at=stamp.observed-interval '30 seconds' FROM stamp WHERE id=$1",
    [expiredGrant.id],
  );
  return {
    application,
    operator,
    reviewer,
    actor,
    filing,
    originalReport,
    currentReport,
    policy,
    unknown,
    replacement,
    marker,
    expiredGrant,
    async readExpiredOriginal(database: Database) {
      const current = await currentSource(operator);
      return createTaxFilingRepository(database, h.clock).readEvidence(
        current,
        { id: expiredGrant.id, hash: expiredGrant.access_hash },
      );
    },
    nativeEffects: structuredClone(f.native.effectRequests),
  };
}
