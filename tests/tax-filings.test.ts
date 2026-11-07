import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createMemoryStorage } from "./support/storage";
import { financialExportFixture } from "./support/governance-financial";
import { createTaxPeriodApplication } from "../src/application/tax-periods";
import { createTaxPeriodRepository } from "../src/db/tax-period-repository";
import { createTaxFilingApplication } from "../src/application/tax-filings";
import { createTaxFilingRepository } from "../src/db/tax-filing-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import {
  prepareTaxFilingSecurity,
  taxFilingTables,
} from "../src/db/tax-filing-security";
import { createTaxFilingHttp } from "../src/http/tax-filings";
import { financialNotifications } from "./support/financial-notifications";
import { createCostApplication } from "../src/application/costs";
import { createCostRepository } from "../src/db/cost-repository";

describe("Tax filing confirmations at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let periods: ReturnType<typeof createTaxPeriodApplication<Headers>>;
  let app: ReturnType<typeof createTaxFilingApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    const database = runtimeDatabase(h.runtime);
    periods = createTaxPeriodApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTaxPeriodRepository(database),
      clock: h.clock,
    });
    app = createTaxFilingApplication({
      authenticatePlatform: h.access.authenticatePlatformForWork,
      repository: createTaxFilingRepository(database, h.clock),
      periods,
      clock: h.clock,
    });
  });
  afterEach(async () => h?.close());

  async function approvedPeriod(extraReviewerIds: string[] = []) {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "filing-test",
      true,
    );
    const actor = await h.authenticate(f.operator);
    const reviewer = await h.signIn("filing-reviewer@example.com");
    await h.provisionOperator(reviewer, { tax: true, reconciliation: false });
    const reviewerId = (await h.authenticate(reviewer)).userId;
    const obligation = await periods.saveObligation(f.operator, {
      requestKey: randomUUID(),
      key: "synthetic-return",
      expectedVersion: 0,
      note: "Synthetic explicit reporting policy",
      definition: {
        mode: "fixture",
        name: "Synthetic return",
        jurisdiction: "fixture-domestic",
        timeZone: "Asia/Kolkata",
        currency: "INR",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        registration: {
          key: "synthetic-registration",
          identifier: "TEST-ONLY",
          status: "registered",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: null,
          evidence: ["synthetic registration"],
        },
        basis: "document_issue_date",
        unissuedCharges: "require_invoice",
        preparerIds: [actor.userId],
        reviewerIds: [actor.userId, reviewerId, ...extraReviewerIds],
        distinctReviewer: false,
        evidence: ["synthetic legal fixture, no jurisdiction assertion"],
      },
    });
    await periods.decideObligation(f.operator, {
      requestKey: randomUUID(),
      revisionId: obligation.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Reviewed exact configuration",
    });
    const period = await periods.openPeriod(f.operator, {
      requestKey: randomUUID(),
      obligationId: obligation.id,
      startDate: "2026-11-01",
      endDate: "2026-12-01",
      dueAt: "2026-12-12T12:30:00.000Z",
      evidence: ["synthetic due instant"],
      reminders: [{ key: "filing-due", at: "2026-11-05T09:00:00.000Z" }],
      note: "Synthetic period",
    });
    const prepared = await periods.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Retained actual originals",
    });
    const report = await periods.act(f.operator, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      evidence: ["reviewed exact originals"],
      note: "Approved report",
    });
    return { ...f, report, obligation, reportingPeriod: period, reviewer };
  }

  const identity = (
    report: Awaited<ReturnType<typeof approvedPeriod>>["report"],
  ) => ({
    reportId: report.id,
    periodId: report.periodId,
    revision: report.revision,
    digest: report.digest,
    approvalId: report.actions.filter((a) => a.kind === "approve").at(-1)!.id,
  });
  async function manualPolicy(
    f: Awaited<ReturnType<typeof approvedPeriod>>,
    options: Record<string, unknown> = {},
  ) {
    const policy = await app.savePolicy(f.operator, {
      requestKey: randomUUID(),
      obligationId: f.obligation.id,
      expectedVersion: 0,
      definition: {
        adapter: "manual_evidence_v1",
        authorityAccount: "synthetic-authority-account",
        fundingAccount: "synthetic-remitting-account",
        returnType: "Synthetic return",
        filingRequired: true,
        paymentRequired: true,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        retention: {
          disposition: "protected_history",
          policyReference: "synthetic explicit preservation and holds",
        },
        evidence: [
          "synthetic authorized manual filing and remittance procedure",
        ],
        ...options,
      },
      note: "Explicit synthetic scope, no native integration",
    });
    await app.decidePolicy(f.reviewer, {
      requestKey: randomUUID(),
      policyId: policy.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Reviewed the exact supported scope",
    });
    return policy;
  }
  async function confirmed(
    f: Awaited<ReturnType<typeof approvedPeriod>>,
    policy: Awaited<ReturnType<typeof manualPolicy>>,
    kind: "submission" | "remittance",
    amountMinor: string,
    amendmentOf: string | null = null,
  ) {
    const intent = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind,
      amountMinor,
      amendmentOf,
      note: "Exact supported manual work order",
    });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Exact scope and amount approved",
    });
    const bytes = Buffer.from(
      `Synthetic original ${kind} evidence ${randomUUID()}`,
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: intent.target,
      kind:
        kind === "submission"
          ? "authority_acknowledgement"
          : "bank_confirmation",
      result: kind === "submission" ? "filed" : "settled",
      reference: randomUUID(),
      amountMinor,
      occurredAt: h.clock.now().toISOString(),
      name: "original.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Synthetic original manual evidence",
    });
    const acknowledged = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "acknowledge",
      evidenceId: artifact.id,
      note: "Record fact, including out-of-order acknowledgement",
    });
    const result = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 2,
      kind: "confirm",
      acknowledgementId: acknowledged.events.at(-1)!.id,
      note: "Independent original evidence review",
    });
    return { intent: result, artifact, bytes };
  }

  it("exports the exact approved accounting evidence without claiming filing or payment", async () => {
    const f = await approvedPeriod();
    const exported = await app.exportReport(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      periodId: f.report.periodId,
      revision: f.report.revision,
      digest: f.report.digest,
      approvalId: f.report.actions[0].id,
      note: "Accounting export only",
    });
    expect(exported.report).toEqual(f.report);
    expect(exported.report.snapshot.totals.taxMinor).toBe("901");
    expect(exported.report.snapshot.adjustments[0]).toMatchObject({
      actualMinor: "1100",
      creditMinor: "1099",
      uncreditedDifferenceMinor: "1",
    });
    expect(exported).toMatchObject({
      filed: false,
      paid: false,
      format: "tax_accounting_filing_v1",
    });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: false,
      paid: false,
      readiness: "setup_required",
    });
  });

  it("persists separate manual submission approval and uncertain attempt without completing the obligation", async () => {
    const f = await approvedPeriod();
    const policy = await manualPolicy(f);
    const intent = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "901",
      amendmentOf: null,
      note: "Authorize only this reviewed return revision",
    });
    expect(intent).toMatchObject({
      status: "awaiting_approval",
      kind: "submission",
      verification: "operator_evidence_review",
    });
    const approved = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Approve exact manual submission",
    });
    expect(approved.status).toBe("approved");
    const attempted = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "unknown",
      reference: "synthetic-request-1",
      occurredAt: h.clock.now().toISOString(),
      note: "Authority portal timed out; outcome unknown",
    });
    expect(attempted).toMatchObject({
      status: "unknown",
      filed: false,
      paid: false,
    });
    await expect(
      app.prepare(f.operator, {
        ...identity(f.report),
        requestKey: randomUUID(),
        policyId: policy.id,
        kind: "submission",
        amountMinor: "901",
        amendmentOf: null,
        note: "Unsafe duplicate",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: false,
      paid: false,
      readiness: "configured",
      fulfilled: false,
    });
  });

  it("reviews original authority acknowledgement and bank evidence independently and allocates partial remittances once", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    let submission = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "901",
      amendmentOf: null,
      note: "Exact manual return",
    });
    submission = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: submission.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Approved submission",
    });
    submission = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: submission.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "pending",
      reference: "portal-request",
      occurredAt: h.clock.now().toISOString(),
      note: "Operator entered portal submission assertion",
    });
    const bytes = Buffer.from(
      "Synthetic authority acknowledgement of filed return, retained original bytes",
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: submission.target,
      kind: "authority_acknowledgement",
      result: "filed",
      reference: "return-accepted-1",
      amountMinor: "901",
      occurredAt: h.clock.now().toISOString(),
      name: "authority.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Original authority document entered by operator; no native verification",
    });
    submission = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: submission.id,
      expectedVersion: 2,
      kind: "acknowledge",
      evidenceId: artifact.id,
      note: "Record authority acknowledgement",
    });
    expect(submission).toMatchObject({
      status: "acknowledged",
      filed: false,
      paid: false,
    });
    const confirmation = {
      requestKey: randomUUID(),
      intentId: submission.id,
      expectedVersion: 3,
      kind: "confirm",
      acknowledgementId: submission.events.at(-1)!.id,
      note: "Independently reviewed original acknowledgement and exact return scope",
    };
    await expect(app.act(f.operator, confirmation)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    submission = await app.act(f.reviewer, confirmation);
    expect(submission).toMatchObject({
      status: "confirmed",
      filed: true,
      paid: false,
      verification: "operator_evidence_review",
    });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: true,
      paid: false,
      fulfilled: false,
      remainingMinor: "901",
    });

    let payment = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "remittance",
      amountMinor: "400",
      amendmentOf: null,
      note: "Partial manual remittance approval",
    });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Approve exact partial amount and accounts",
    });
    await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "unknown",
      reference: "bank-initiation-1",
      occurredAt: h.clock.now().toISOString(),
      note: "Initiation is not bank confirmation",
    });
    const bankBytes = Buffer.from(
      "Synthetic independently observed settled bank remittance 400 INR minor",
    );
    const bank = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: payment.target,
      kind: "bank_confirmation",
      result: "settled",
      reference: "bank-settled-1",
      amountMinor: "400",
      occurredAt: h.clock.now().toISOString(),
      name: "bank.txt",
      contentType: "text/plain",
      bytesBase64: bankBytes.toString("base64"),
      sha256: createHash("sha256").update(bankBytes).digest("hex"),
      note: "Original bank statement evidence; manual verification only",
    });
    payment = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 2,
      kind: "acknowledge",
      evidenceId: bank.id,
      note: "Record settled bank fact",
    });
    const paidInput = {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 3,
      kind: "confirm",
      acknowledgementId: payment.events.at(-1)!.id,
      note: "Independent evidence review",
    };
    await app.act(f.reviewer, paidInput);
    await app.act(f.reviewer, paidInput);
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: true,
      paid: false,
      fulfilled: false,
      liabilityMinor: "901",
      confirmedPaidMinor: "400",
      remainingMinor: "501",
      overpaidMinor: "0",
    });
    expect(await periods.report(f.operator, f.report.id)).toMatchObject({
      filed: false,
      paid: false,
    });
    const downloaded = await app.downloadEvidence(f.reviewer, {
      evidenceId: bank.id,
    });
    expect(Buffer.from(downloaded.bytes)).toEqual(bankBytes);
    expect(JSON.stringify(await app.workspace(f.operator))).not.toMatch(
      /bytesBase64|accessHash|lease|capability/,
    );
  });
  it("blocks a fresh remittance key after unknown initiation and rejects stale concurrent approvals", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      input = {
        ...identity(f.report),
        requestKey: randomUUID(),
        policyId: policy.id,
        kind: "remittance",
        amountMinor: "400",
        amendmentOf: null,
        note: "Exact remittance",
      };
    const intent = await app.prepare(f.operator, input);
    await expect(app.prepare(f.reviewer, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const approvals = await Promise.allSettled(
      [1, 2].map(() =>
        app.act(f.reviewer, {
          requestKey: randomUUID(),
          intentId: intent.id,
          expectedVersion: 0,
          kind: "approve",
          note: "Concurrent exact review",
        }),
      ),
    );
    expect(approvals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(approvals.filter((r) => r.status === "rejected")).toHaveLength(1);
    await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "unknown",
      reference: "unresolved-bank-1",
      occurredAt: h.clock.now().toISOString(),
      note: "Bank portal outcome unknown",
    });
    await expect(
      app.prepare(f.operator, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 2,
        kind: "confirm",
        acknowledgementId: randomUUID(),
        note: "Reference alone cannot confirm",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("composes current confirmation truth into period status and keeps partial payment reminders due", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    await confirmed(f, policy, "submission", "901");
    await confirmed(f, policy, "remittance", "400");
    await periods.evaluateReminders(f.operator);
    let workspace = await periods.workspace(f.operator);
    expect(workspace.periods[0].confirmation).toMatchObject({
      filed: true,
      paid: false,
      fulfilled: false,
      confirmedPaidMinor: "400",
      remainingMinor: "501",
    });
    expect(workspace.reminders.filter((r) => r.current)).toHaveLength(1);
    await confirmed(f, policy, "remittance", "501");
    workspace = await periods.workspace(f.operator);
    expect(workspace.periods[0].confirmation).toMatchObject({
      filed: true,
      paid: true,
      fulfilled: true,
      confirmedPaidMinor: "901",
      remainingMinor: "0",
    });
    expect(workspace.reminders.filter((r) => r.current)).toHaveLength(0);
    await periods.evaluateReminders(f.operator);
    expect((await periods.workspace(f.operator)).reminders).toHaveLength(1);
    expect(workspace.periods[0].report).toMatchObject({
      filed: false,
      paid: false,
      status: "approved",
    });
  });
  it("keeps mismatched currency evidence for review and blocks approval until an independent resolution", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    let intent = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "remittance",
      amountMinor: "400",
      amendmentOf: null,
      note: "Manual payment",
    });
    const bytes = Buffer.from(
      "Original wrong-currency bank evidence, no conversion authority",
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: { ...intent.target, currency: "USD" },
      kind: "bank_confirmation",
      result: "settled",
      reference: "wrong-currency",
      amountMinor: "400",
      occurredAt: h.clock.now().toISOString(),
      name: "bank.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Keep unmatched original",
    });
    intent = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "acknowledge",
      evidenceId: artifact.id,
      note: "Unmatched bank fact",
    });
    expect(intent.status).toBe("unmatched_evidence");
    const issueId = intent.events.at(-1)!.id;
    await expect(
      app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 1,
        kind: "approve",
        note: "Cannot approve unresolved required issue",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    intent = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "resolve_issue",
      issueId,
      evidenceId: artifact.id,
      note: "Documented as unrelated USD transfer; retain without allocating or converting",
    });
    intent = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 2,
      kind: "raise_issue",
      evidenceId: artifact.id,
      note: "Required review before authorizing any new payment",
    });
    await expect(
      app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 3,
        kind: "approve",
        note: "Cannot skip a required issue",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    intent = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 3,
      kind: "resolve_issue",
      issueId: intent.events.at(-1)!.id,
      evidenceId: artifact.id,
      note: "Independently resolved under explicit review",
    });
    intent = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 4,
      kind: "approve",
      note: "New attributable approval following resolution",
    });
    expect(intent.status).toBe("approved");
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      paid: false,
      confirmedPaidMinor: "0",
      remainingMinor: "901",
    });
    expect(
      (await app.downloadEvidence(f.reviewer, { evidenceId: artifact.id }))
        .sha256,
    ).toBe(artifact.sha256);
  });
  it("retains filed history after a new permanent credit and requires amendment and explicit remittance reallocation", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      original = await confirmed(f, policy, "submission", "901");
    await confirmed(f, policy, "remittance", "901");
    await f.documents.adjust(f.op, f.business.id, {
      invoiceId: f.invoice.id,
      periodId: f.period.id,
      paymentId: f.period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: {
        kind: "refund",
        reference:
          "separately evidenced subsequent original-component correction",
      },
      reason: "Permanent original-tax correction; no extra cash inferred",
      evidence: ["synthetic approved permanent credit"],
      lines: [{ lineId: "subscription", netMinor: "100" }],
    });
    expect(await periods.report(f.operator, f.report.id)).toMatchObject({
      current: false,
      status: "review_required",
      snapshot: f.report.snapshot,
    });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: true,
      fulfilled: false,
      correctionRequired: true,
    });
    await expect(
      app.prepare(f.operator, {
        ...identity(f.report),
        requestKey: randomUUID(),
        policyId: policy.id,
        kind: "submission",
        amountMinor: "901",
        amendmentOf: original.intent.id,
        note: "Stale report",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const prepared = await periods.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: f.report.periodId,
      expectedRevision: 1,
      cutoff: h.clock.now().toISOString(),
      note: "New permanent credit needs fresh report review",
    });
    const report = await periods.act(f.reviewer, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      evidence: ["new original credit reviewed"],
      note: "Approve successor report",
    });
    expect(report.snapshot.totals.taxMinor).toBe("891");
    const amendment = await app.prepare(f.operator, {
      ...identity(report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "891",
      amendmentOf: original.intent.id,
      note: "Explicit amendment of the actually filed original revision",
    });
    expect(amendment.amendmentOf).toBe(original.intent.id);
    const before = await app.workspace(f.operator);
    expect(before.periods[0]).toMatchObject({
      filed: true,
      currentRevisionFiled: false,
      paid: false,
      historicalPaidMinor: "901",
      unallocatedPaidMinor: "901",
    });
    const allocation = before.allocations[0];
    const reconciliation = {
      ...identity(report),
      requestKey: randomUUID(),
      allocationId: allocation.id,
      expectedVersion: 0,
      expectedReportId: f.report.id,
      policyId: policy.id,
      note: "Reviewed carry-forward of the same original remittance, no new transfer",
    };
    await app.reconcileRemittance(f.reviewer, reconciliation);
    await app.reconcileRemittance(f.reviewer, reconciliation);
    const after = await app.workspace(f.operator);
    expect(after.periods[0]).toMatchObject({
      filed: true,
      currentRevisionFiled: false,
      paid: true,
      fulfilled: false,
      confirmedPaidMinor: "901",
      overpaidMinor: "10",
      unallocatedPaidMinor: "0",
    });
    expect(after.allocations).toHaveLength(1);
    expect(after.allocationReviews).toHaveLength(1);
    expect(
      after.intents.find((i) => i.id === original.intent.id)?.report.snapshot,
    ).toEqual(f.report.snapshot);
    expect(
      (
        await app.downloadEvidence(f.reviewer, {
          evidenceId: original.artifact.id,
        })
      ).bytes,
    ).toEqual(new Uint8Array(original.bytes));
  });
  it("denies ordinary and unrelated operators, invalid bytes and authority revoked after evidence reads", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901");
    for (const credentials of [f.owner, f.op]) {
      await expect(app.workspace(credentials)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        app.downloadEvidence(credentials, { evidenceId: fact.artifact.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      app.storeEvidence(f.operator, {
        requestKey: randomUUID(),
        reportId: f.report.id,
        target: fact.intent.target,
        kind: "supporting",
        result: "unknown",
        reference: "bad hash",
        amountMinor: "0",
        occurredAt: h.clock.now().toISOString(),
        name: "evidence.txt",
        contentType: "text/plain",
        bytesBase64: Buffer.from("original").toString("base64"),
        sha256: "0".repeat(64),
        note: "Invalid original bytes",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    let checks = 0;
    const guarded = createTaxFilingApplication({
      periods,
      clock: h.clock,
      repository: createTaxFilingRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      authenticatePlatform: async (credentials: Headers) => {
        if (++checks === 2)
          await h.admin.query(
            "update platform_operator set tax=false where user_id=$1",
            [(await h.authenticate(f.reviewer)).userId],
          );
        return h.access.authenticatePlatformForWork(credentials);
      },
    });
    await expect(
      guarded.downloadEvidence(f.reviewer, { evidenceId: fact.artifact.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(checks).toBeGreaterThanOrEqual(2);
  });
  it("does not reuse old account confirmations when the approved manual procedure changes", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    await confirmed(f, policy, "submission", "901");
    await confirmed(f, policy, "remittance", "901");
    expect((await app.workspace(f.operator)).periods[0].fulfilled).toBe(true);
    const replacement = await app.savePolicy(f.operator, {
      requestKey: randomUUID(),
      obligationId: f.obligation.id,
      expectedVersion: 1,
      definition: {
        ...policy.definition,
        authorityAccount: "a-different-authority-account",
      },
      note: "Explicit source account procedure correction",
    });
    await app.decidePolicy(f.reviewer, {
      requestKey: randomUUID(),
      policyId: replacement.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Reviewed replacement scope",
    });
    expect(await periods.report(f.operator, f.report.id)).toMatchObject({
      current: false,
      status: "review_required",
      snapshot: f.report.snapshot,
    });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: true,
      currentRevisionFiled: false,
      paid: false,
      fulfilled: false,
      correctionRequired: true,
      unallocatedPaidMinor: "901",
    });
  });
  it("attributes an explicit filing expense once with independent cost authority and never expenses remitted tax", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901");
    const bytes = Buffer.from(
      "Synthetic original service receipt INR 25.00 for one filing; explicit fixture price only",
    );
    const receipt = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: fact.intent.target,
      kind: "supporting",
      result: "unknown",
      reference: "synthetic-filing-expense-1",
      amountMinor: "2500",
      occurredAt: h.clock.now().toISOString(),
      name: "service-receipt.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Actual synthetic external service expense, separate from collected tax",
    });
    const input = {
      requestKey: randomUUID(),
      evidenceId: receipt.id,
      quantity: 1,
      unit: "filing",
      funding: "cash",
      retentionSeconds: 86400,
      note: "Explicit original expense and unit evidence",
    };
    await expect(app.recordExpense(f.operator, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.admin.query(
      "update platform_operator set costs=true where user_id=$1",
      [(await h.authenticate(f.operator)).userId],
    );
    await app.recordExpense(f.operator, input);
    await app.recordExpense(f.operator, input);
    await expect(
      app.recordExpense(f.operator, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.recordExpense(f.operator, {
        ...input,
        requestKey: randomUUID(),
        evidenceId: fact.artifact.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const costs = createCostApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createCostRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
    const workspace = await costs.workspace(f.operator, "2026-11");
    expect(workspace.totals.operatorMicros).toBe("25000000");
    expect(
      workspace.sources.filter(
        (s) => s.sourceId === `evidence:tax_filing:${receipt.id}`,
      ),
    ).toHaveLength(1);
    expect(
      workspace.sources.find(
        (s) => s.sourceId === `evidence:tax_filing:${receipt.id}`,
      )?.source,
    ).toMatchObject({
      category: "billing_tax",
      amount: { currency: "INR", micros: "25000000" },
      quantity: 1,
      unit: "filing",
    });
  });
  it("requires actual filing evidence for a zero-liability return under explicit fulfillment requirements", async () => {
    const original = await approvedPeriod();
    const period = await periods.openPeriod(original.operator, {
      requestKey: randomUUID(),
      obligationId: original.obligation.id,
      startDate: "2026-01-02",
      endDate: "2026-02-01",
      dueAt: "2026-02-10T00:00:00.000Z",
      evidence: ["synthetic empty-period requirement"],
      reminders: [],
      note: "No universal zero-return exemption",
    });
    const prepared = await periods.prepare(original.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Complete zero original-document population",
    });
    const report = await periods.act(original.operator, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Reviewed zero liability, return still required",
      evidence: ["explicit synthetic zero-return obligation"],
    });
    expect(report.snapshot.totals.taxMinor).toBe("0");
    const f = { ...original, report, reportingPeriod: period },
      policy = await manualPolicy(f, {
        filingRequired: true,
        paymentRequired: false,
      });
    expect(
      (await app.workspace(f.operator)).periods.find(
        (p) => p.period.id === period.id,
      ),
    ).toMatchObject({ filed: false, paid: false, fulfilled: false });
    await confirmed(f, policy, "submission", "0");
    expect(
      (await app.workspace(f.operator)).periods.find(
        (p) => p.period.id === period.id,
      ),
    ).toMatchObject({ filed: true, paid: false, fulfilled: true });
  });
  it("binds identical digests to exact report revision and approval identity", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    const prepared = await periods.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: f.report.periodId,
      expectedRevision: 1,
      cutoff: f.report.snapshot.cutoff,
      note: "An explicit identical-evidence successor",
    });
    const report = await periods.act(f.reviewer, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Review the new report identity",
      evidence: ["exact new revision"],
    });
    expect(report.digest).toBe(f.report.digest);
    expect(report.id).not.toBe(f.report.id);
    const input = {
      ...identity(report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "901",
      amendmentOf: null,
      note: "Exact successor",
    };
    await expect(
      app.prepare(f.operator, { ...input, revision: f.report.revision }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.prepare(f.operator, { ...input, approvalId: f.report.actions[0].id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await app.prepare(f.operator, input)).report.id).toBe(report.id);
  });
  it("requires each ledger SELECT and INSERT separately and every narrow helper without implicit PUBLIC access", async () => {
    for (const table of taxFilingTables)
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(
          `revoke ${privilege} on public.${table} from app_runtime`,
        );
        try {
          await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
        } finally {
          await h.admin.query(
            `grant ${privilege} on public.${table} to app_runtime`,
          );
        }
      }
    for (const signature of [
      "tax_filing_artifact_store(uuid,text)",
      "tax_filing_artifact_read(uuid,text)",
      "tax_filing_status(uuid)",
    ]) {
      await h.admin.query(
        `revoke execute on function public.${signature} from app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      } finally {
        await h.admin.query(
          `grant execute on function public.${signature} to app_runtime`,
        );
      }
    }
    for (const signature of [
      "tax_filing_session_current()",
      "tax_filing_fulfillment(uuid)",
      "tax_filing_binding_guard()",
      "tax_filing_artifact_store(uuid,text)",
      "tax_filing_artifact_read(uuid,text)",
      "tax_filing_status(uuid)",
    ]) {
      const [original] = (
        await h.admin.query<{ acl: string | null }>(
          "select proacl::text acl from pg_proc where oid=$1::regprocedure",
          [`public.${signature}`],
        )
      ).rows;
      await h.admin.query(
        "update pg_proc set proacl=null where oid=$1::regprocedure",
        [`public.${signature}`],
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      } finally {
        await h.admin.query(
          "update pg_proc set proacl=$1::aclitem[] where oid=$2::regprocedure",
          [original.acl, `public.${signature}`],
        );
      }
    }
    await verifyRuntimeRole(h.runtime);
  });
  it("uses actor/session-bound technical access and trusted database expiry while denying raw/global and foreign scope", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901");
    await app.downloadEvidence(f.operator, { evidenceId: fact.artifact.id });
    const principal = await h.access.authenticatePlatformForWork(f.operator);
    const [grant] = (
      await h.admin.query<{
        id: string;
        access_hash: string;
        session_id: string;
      }>(
        "select id,access_hash,session_id from tax_filing_access where evidence_id=$1 order by at desc limit 1",
        [fact.artifact.id],
      )
    ).rows;
    const client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.tax_session_id',$3,true),set_config('app.tax_at',$4,true)",
        [
          principal.userId,
          f.business.id,
          principal.sessionId,
          h.clock.now().toISOString(),
        ],
      );
      expect(
        (
          await client.query(
            "select public.tax_filing_status($1) status,public.tax_filing_artifact_read($2,$3) body",
            [f.report.periodId, grant.id, grant.access_hash],
          )
        ).rows[0],
      ).toEqual({ status: null, body: null });
      for (const table of taxFilingTables)
        expect(
          (await client.query(`select count(*)::int n from public.${table}`))
            .rows[0].n,
        ).toBe(0);
      await client.query("rollback");
      await expect(
        client.query("select body from public.tax_filing_bytes"),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true),set_config('app.tax_session_id',$2,true),set_config('app.tax_at',$3,true)",
        [principal.userId, principal.sessionId, h.clock.now().toISOString()],
      );
      expect(
        (await client.query("select count(*)::int n from financial_case"))
          .rows[0].n,
      ).toBe(0);
      const [bounded] = (
        await client.query<{ bounded: boolean }>(
          "insert into tax_filing_access(id,evidence_id,actor_id,session_id,access_hash,at,expires_at) values(gen_random_uuid(),$1,$2,$3,repeat('a',64),statement_timestamp()+interval '1 day',statement_timestamp()+interval '1 day 30 seconds') returning at<=statement_timestamp() and expires_at<=statement_timestamp()+interval '30 seconds' bounded",
          [fact.artifact.id, principal.userId, principal.sessionId],
        )
      ).rows;
      expect(bounded.bounded).toBe(true);
      await client.query("rollback");
    } finally {
      client.release();
    }
    await h.admin.query(
      "update tax_filing_access set at=statement_timestamp()-interval '60 seconds',expires_at=statement_timestamp()-interval '30 seconds' where id=$1",
      [grant.id],
    );
    const expired = await h.runtime.connect();
    try {
      await expired.query("begin");
      await expired.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true),set_config('app.tax_session_id',$2,true),set_config('app.tax_at',$3,true)",
        [principal.userId, principal.sessionId, h.clock.now().toISOString()],
      );
      expect(
        (
          await expired.query(
            "select public.tax_filing_artifact_read($1,$2) body",
            [grant.id, grant.access_hash],
          )
        ).rows[0].body,
      ).toBeNull();
      await expired.query("rollback");
    } finally {
      expired.release();
    }
  });
  it("keeps typed tax notifications separate and suppresses completed configured obligations", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      n = await financialNotifications(h);
    f.operator = await h.signIn("tax-operator@example.com");
    f.reviewer = await h.signIn("filing-reviewer@example.com");
    await n.app.setPreference(f.operator, null, {
      purpose: "tax_period",
      enabled: true,
      expectedVersion: 0,
    });
    await periods.evaluateReminders(f.operator);
    expect(
      (await periods.workspace(f.operator)).reminders.some((r) => r.current),
    ).toBe(true);
    await confirmed(f, policy, "submission", "901");
    await confirmed(f, policy, "remittance", "901");
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(0);
    expect(
      (await periods.workspace(f.operator)).reminders.some((r) => r.current),
    ).toBe(false);
  });
  it("validates the public HTTP file boundary and never exposes private access/session data or unsafe errors", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901");
    const http = createTaxFilingHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const headers = {
      cookie: f.operator.get("cookie")!,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    };
    expect(
      (
        await http.get(
          new Request("http://localhost:3000", { headers: f.owner }),
        )
      ).status,
    ).toBe(403);
    expect((await http.get(new Request("http://localhost:3000"))).status).toBe(
      401,
    );
    const screen = await http.get(
      new Request("http://localhost:3000", { headers: f.operator }),
    );
    expect(screen.status).toBe(200);
    expect(await screen.text()).not.toMatch(
      /bytesBase64|accessHash|sessionId|lease|capability/,
    );
    const bytes = Buffer.alloc(2097152, 97),
      input = {
        requestKey: randomUUID(),
        reportId: f.report.id,
        target: fact.intent.target,
        kind: "supporting",
        result: "unknown",
        reference: "exact largest supported original",
        amountMinor: "0",
        occurredAt: h.clock.now().toISOString(),
        name: "maximum.txt",
        contentType: "text/plain",
        bytesBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        note: "Original byte boundary",
      };
    const response = await http.command(
      new Request("http://localhost:3000", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "store_evidence", input }),
      }),
    );
    expect(response.status).toBe(200);
    const artifact = (await app.workspace(f.operator)).evidence.find(
      (e) => e.reference === input.reference,
    )!;
    const content = await http.content(
      new Request("http://localhost:3000", { headers: f.operator }),
      artifact.id,
    );
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(content.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes);
    const invalid = await http.command(
      new Request("http://localhost:3000", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "store_evidence",
          input: {
            ...input,
            requestKey: randomUUID(),
            contentType: "text/html",
            name: "private-native-secret\r\nInjected",
          },
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("private-native-secret");
    expect(
      (
        await http.command(
          new Request("http://localhost:3000", {
            method: "POST",
            headers: { ...headers, origin: "https://foreign.example" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("does not replace an unknown payment until independent original no-effect evidence supersedes it", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    const input = {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "remittance",
      amountMinor: "400",
      amendmentOf: null,
      note: "Original manual payment authorization",
    };
    let intent = await app.prepare(f.operator, input);
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Original approval",
    });
    await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "unknown",
      reference: "original-bank-request",
      occurredAt: h.clock.now().toISOString(),
      note: "Uncertain initiation",
    });
    const bytes = Buffer.from(
      "Synthetic original bank statement and final rejection establishing that this exact request moved no money",
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: intent.target,
      kind: "bank_confirmation",
      result: "no_effect",
      reference: "original-bank-request-final-rejection",
      amountMinor: "400",
      occurredAt: h.clock.now().toISOString(),
      name: "no-transfer.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Original conclusive absence evidence, operator-entered, no native verification",
    });
    await expect(
      app.prepare(f.operator, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    intent = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 2,
      kind: "supersede",
      evidenceId: artifact.id,
      note: "Independently reviewed exact conclusive no-transfer source",
    });
    expect(intent.status).toBe("superseded");
    const replacement = await app.prepare(f.operator, {
      ...input,
      requestKey: randomUUID(),
      supersedesId: intent.id,
    });
    expect(replacement).toMatchObject({
      supersedesId: intent.id,
      status: "awaiting_approval",
      paid: false,
    });
    expect((await app.workspace(f.operator)).allocations).toHaveLength(0);
  });
  it("recovers late original facts after source correction and obsolete initiating sessions without another effect", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f);
    const intent = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "901",
      amendmentOf: null,
      note: "Original return",
    });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Original approval",
    });
    await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 1,
      kind: "attempt",
      outcome: "unknown",
      reference: "original-submission",
      occurredAt: h.clock.now().toISOString(),
      note: "Lost acknowledgement",
    });
    const bytes = Buffer.from(
      "Original final authority acknowledgement for the exact earlier revision",
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: intent.target,
      kind: "authority_acknowledgement",
      result: "filed",
      reference: "late-original-authority-final",
      amountMinor: "901",
      occurredAt: h.clock.now().toISOString(),
      name: "late-original.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Retained original before subsequent source correction",
    });
    await f.documents.adjust(f.op, f.business.id, {
      invoiceId: f.invoice.id,
      periodId: f.period.id,
      paymentId: f.period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "refund", reference: "later original-tax adjustment" },
      reason: "New separately approved permanent credit",
      evidence: ["synthetic original component correction"],
      lines: [{ lineId: "subscription", netMinor: "100" }],
    });
    const originalActor = (await h.authenticate(f.operator)).userId;
    await h.admin.query(
      "update platform_operator set tax=false where user_id=$1",
      [originalActor],
    );
    await h.admin.query("delete from session where user_id=$1", [
      originalActor,
    ]);
    const ack = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 2,
      kind: "acknowledge",
      evidenceId: artifact.id,
      note: "Recover factual acknowledgement under current reviewer authority",
    });
    const confirmed = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 3,
      kind: "confirm",
      acknowledgementId: ack.events.at(-1)!.id,
      note: "Independent original evidence review; later correction still requires amendment",
    });
    expect(confirmed).toMatchObject({
      filed: true,
      paid: false,
      report: { id: f.report.id, snapshot: f.report.snapshot },
    });
    expect((await app.workspace(f.reviewer)).periods[0]).toMatchObject({
      filed: true,
      currentRevisionFiled: false,
      fulfilled: false,
      correctionRequired: true,
    });
    expect(f.native.refunds).toHaveLength(1);
  });
  it("rechecks fresh central MFA after the final serialized evidence wait", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901"),
      blocker = await h.admin.connect();
    let resolveRead: () => void = () => {};
    const read = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });
    let calls = 0;
    const guarded = createTaxFilingApplication({
      periods,
      clock: h.clock,
      repository: createTaxFilingRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      authenticatePlatform: async (credentials: Headers) => {
        const actor = await h.access.authenticatePlatformForWork(credentials);
        if (++calls === 2) {
          await blocker.query("begin");
          await blocker.query(
            "select pg_advisory_xact_lock(hashtextextended('tax-reporting',0))",
          );
          resolveRead();
        }
        return actor;
      },
    });
    const pending = guarded.downloadEvidence(f.reviewer, {
      evidenceId: fact.artifact.id,
    });
    const result = expect(pending).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    try {
      await read;
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        waiting = (
          await h.admin.query<{ waiting: boolean }>(
            "select exists(select 1 from pg_stat_activity where usename='app_runtime' and wait_event_type='Lock' and query like '%tax-reporting%') waiting",
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      h.clock.set("2026-11-05T09:16:00Z");
      await blocker.query("commit");
      await result;
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
  it("rejects a restricted insert when tax authority is revoked during its database guard wait", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901"),
      principal = await h.access.authenticatePlatformForWork(f.operator),
      blocker = await h.admin.connect(),
      client = await h.runtime.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended('tax-reporting',0))",
      );
      await client.query("begin");
      const pid = (
        await client.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0].pid;
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true),set_config('app.tax_session_id',$2,true),set_config('app.tax_at',$3,true)",
        [principal.userId, principal.sessionId, h.clock.now().toISOString()],
      );
      const pending = client.query(
        "insert into tax_filing_access(id,evidence_id,actor_id,session_id,access_hash) values(gen_random_uuid(),$1,$2,$3,repeat('b',64))",
        [fact.artifact.id, principal.userId, principal.sessionId],
      );
      const result = expect(pending).rejects.toMatchObject({ code: "42501" });
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        waiting = (
          await h.admin.query<{ waiting: boolean }>(
            "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') waiting",
            [pid],
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await h.provisionOperator(f.operator, {
        tax: false,
        reconciliation: false,
      });
      await blocker.query("commit");
      await result;
    } finally {
      await blocker.query("rollback");
      await client.query("rollback");
      blocker.release();
      client.release();
    }
  });
  it("denies original bytes when the grant expires while the database read is blocked", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      fact = await confirmed(f, policy, "submission", "901");
    await app.downloadEvidence(f.operator, { evidenceId: fact.artifact.id });
    const principal = await h.access.authenticatePlatformForWork(f.operator),
      grant = (
        await h.admin.query<{ id: string; access_hash: string }>(
          "select id,access_hash from tax_filing_access where evidence_id=$1 order by at desc limit 1",
          [fact.artifact.id],
        )
      ).rows[0],
      blocker = await h.admin.connect(),
      client = await h.runtime.connect();
    try {
      await blocker.query("begin");
      await blocker.query(
        "lock table tax_filing_bytes in access exclusive mode",
      );
      await client.query("begin");
      const pid = (
        await client.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0].pid;
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true),set_config('app.tax_session_id',$2,true),set_config('app.tax_at',$3,true)",
        [principal.userId, principal.sessionId, h.clock.now().toISOString()],
      );
      const pending = client.query(
        "select public.tax_filing_artifact_read($1,$2) body",
        [grant.id, grant.access_hash],
      );
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        waiting = (
          await h.admin.query<{ waiting: boolean }>(
            "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') waiting",
            [pid],
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await h.admin.query(
        "update tax_filing_access set at=clock_timestamp()-interval '30 seconds',expires_at=clock_timestamp()-interval '1 millisecond' where id=$1",
        [grant.id],
      );
      await blocker.query("commit");
      expect((await pending).rows[0]).toEqual({ body: null });
    } finally {
      await blocker.query("rollback");
      await client.query("rollback");
      blocker.release();
      client.release();
    }
  });
  it("rejects missing original export bindings instead of accepting SQL unknown", async () => {
    const f = await approvedPeriod(),
      principal = await h.access.authenticatePlatformForWork(f.operator),
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true)",
        [principal.userId],
      );
      await expect(
        client.query(
          "insert into tax_filing_export(id,report_id,report,actor_id,actor_name,note,request_key,input,at) values(gen_random_uuid(),$1,'{}'::jsonb,$2,'Fixture operator','Invalid original binding',gen_random_uuid(),'{}'::jsonb,statement_timestamp())",
          [f.report.id, principal.userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it.each(["pending", "unknown", "failed"])(
    "never turns a %s manual attempt into a second initiation through a review cycle",
    async (outcome) => {
      const f = await approvedPeriod(),
        policy = await manualPolicy(f),
        intent = await app.prepare(f.operator, {
          ...identity(f.report),
          requestKey: randomUUID(),
          policyId: policy.id,
          kind: "remittance",
          amountMinor: "400",
          amendmentOf: null,
          note: "Original exact payment authorization",
        });
      await app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 0,
        kind: "approve",
        note: "Original approval",
      });
      await app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 1,
        kind: "attempt",
        outcome,
        reference: "original-bank-request",
        occurredAt: h.clock.now().toISOString(),
        note: "Original bank outcome assertion",
      });
      const bytes = Buffer.from(
        "Supporting review note without conclusive no-effect proof",
      );
      const artifact = await app.storeEvidence(f.operator, {
        requestKey: randomUUID(),
        reportId: f.report.id,
        target: intent.target,
        kind: "supporting",
        result: "unknown",
        reference: "review-only",
        amountMinor: "400",
        occurredAt: h.clock.now().toISOString(),
        name: "review.txt",
        contentType: "text/plain",
        bytesBase64: bytes.toString("base64"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        note: "Supporting review, not a new payment authority",
      });
      const issue = await app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 2,
        kind: "raise_issue",
        evidenceId: artifact.id,
        note: "Review original outcome",
      });
      await app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 3,
        kind: "resolve_issue",
        issueId: issue.events.at(-1)!.id,
        evidenceId: artifact.id,
        note: "Review resolution does not establish no native effect",
      });
      await expect(
        app.act(f.reviewer, {
          requestKey: randomUUID(),
          intentId: intent.id,
          expectedVersion: 4,
          kind: "approve",
          note: "Cannot reauthorize the already attempted request",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    },
  );
  it("retains unsupported and unknown scope originals without adopting currency or an accepted-for-processing message", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      intent = await app.prepare(f.operator, {
        ...identity(f.report),
        requestKey: randomUUID(),
        policyId: policy.id,
        kind: "submission",
        amountMinor: "901",
        amendmentOf: null,
        note: "Actual final filing evidence still required",
      });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: intent.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Exact current report",
    });
    const bytes = Buffer.from(
      "Original authority accepted this return for processing; final filing status is not established",
    );
    const base = {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: intent.target,
      kind: "authority_acknowledgement",
      result: "accepted_for_processing",
      reference: "processing-only",
      amountMinor: "901",
      occurredAt: h.clock.now().toISOString(),
      name: "original.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Do not treat processing acceptance as a completed return",
    };
    const artifact = await app.storeEvidence(f.operator, base),
      ack = await app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 1,
        kind: "acknowledge",
        evidenceId: artifact.id,
        note: "Authority processing acknowledgement only",
      });
    await expect(
      app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: intent.id,
        expectedVersion: 2,
        kind: "confirm",
        acknowledgementId: ack.events.at(-1)!.id,
        note: "No final filing proof",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const foreign = await app.storeEvidence(f.operator, {
      ...base,
      requestKey: randomUUID(),
      target: { ...intent.target, currency: "EUR" },
      reference: "unsupported-currency-original",
    });
    const unknown = await app.storeEvidence(f.operator, {
      ...base,
      requestKey: randomUUID(),
      target: null,
      reference: "unknown-scope-original",
    });
    expect(foreign.target?.currency).toBe("EUR");
    expect(unknown.target).toBeNull();
    expect(
      (await app.downloadEvidence(f.reviewer, { evidenceId: unknown.id }))
        .bytes,
    ).toEqual(new Uint8Array(bytes));
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: false,
      paid: false,
      fulfilled: false,
    });
  });
  it("keeps overpayment as an unresolved difference and never regresses final filing from an older failure", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      filing = await confirmed(f, policy, "submission", "901");
    await confirmed(f, policy, "remittance", "1000");
    const bytes = Buffer.from(
      "Synthetic older failed portal response, superseded by the retained final authority acknowledgement",
    );
    const old = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: filing.intent.target,
      kind: "authority_acknowledgement",
      result: "failed",
      reference: "older-failed-response",
      amountMinor: "901",
      occurredAt: "2026-11-05T08:59:00.000Z",
      name: "old-failure.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "Retain chronology without reversing later final evidence",
    });
    expect(
      await app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: filing.intent.id,
        expectedVersion: 3,
        kind: "acknowledge",
        evidenceId: old.id,
        note: "Late arrival of an older response",
      }),
    ).toMatchObject({ status: "confirmed", filed: true });
    expect((await app.workspace(f.operator)).periods[0]).toMatchObject({
      filed: true,
      paid: true,
      fulfilled: false,
      confirmedPaidMinor: "1000",
      overpaidMinor: "99",
      remainingMinor: "0",
    });
    expect(f.native.refunds).toHaveLength(1);
  });
  it("requires fresh attributable approval when other confirmed facts change the displayed source basis", async () => {
    const priorReviewer = await h.signIn("prior-filing-reviewer@example.com");
    await h.provisionOperator(priorReviewer, {
      tax: true,
      reconciliation: false,
    });
    const priorReviewerId = (await h.authenticate(priorReviewer)).userId;
    const f = await approvedPeriod([priorReviewerId]),
      policy = await manualPolicy(f);
    const filing = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "submission",
      amountMinor: "901",
      amendmentOf: null,
      note: "Original submission",
    });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: filing.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Original submission approval",
    });
    const payment = await app.prepare(f.operator, {
      ...identity(f.report),
      requestKey: randomUUID(),
      policyId: policy.id,
      kind: "remittance",
      amountMinor: "400",
      amendmentOf: null,
      note: "Original partial payment",
    });
    await app.act(priorReviewer, {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Original payment context",
    });
    const bytes = Buffer.from(
      "Synthetic final authority filing acknowledgement that arrived after payment approval",
    );
    const artifact = await app.storeEvidence(f.operator, {
      requestKey: randomUUID(),
      reportId: f.report.id,
      target: filing.target,
      kind: "authority_acknowledgement",
      result: "filed",
      reference: "new-source-authority-final",
      amountMinor: "901",
      occurredAt: h.clock.now().toISOString(),
      name: "final.txt",
      contentType: "text/plain",
      bytesBase64: bytes.toString("base64"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      note: "New source after payment review",
    });
    const ack = await app.act(f.operator, {
      requestKey: randomUUID(),
      intentId: filing.id,
      expectedVersion: 1,
      kind: "acknowledge",
      evidenceId: artifact.id,
      note: "Record new authority fact",
    });
    await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: filing.id,
      expectedVersion: 2,
      kind: "confirm",
      acknowledgementId: ack.events.at(-1)!.id,
      note: "Independent confirmation",
    });
    await h.provisionOperator(priorReviewer, {
      tax: false,
      reconciliation: false,
    });
    await expect(
      app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: payment.id,
        expectedVersion: 1,
        kind: "attempt",
        outcome: "pending",
        reference: "bank-original",
        occurredAt: h.clock.now().toISOString(),
        note: "Stale authorization cannot initiate",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.act(f.reviewer, {
        requestKey: randomUUID(),
        intentId: payment.id,
        expectedVersion: 1,
        kind: "approve",
        basisDigest: payment.basisDigest,
        note: "Stale displayed basis cannot be approved",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const current = (await app.workspace(f.operator)).intents.find(
      (i) => i.id === payment.id,
    )!;
    expect(current.currentBasisDigest).not.toBe(payment.basisDigest);
    const reviewed = await app.act(f.reviewer, {
      requestKey: randomUUID(),
      intentId: payment.id,
      expectedVersion: 1,
      kind: "approve",
      basisDigest: current.currentBasisDigest,
      note: "New attributable review of the actual current facts",
    });
    expect(reviewed.events.filter((e) => e.kind === "approve")).toHaveLength(2);
    expect(
      reviewed.events.filter((e) => e.kind === "approve").at(-1)?.actorId,
    ).toBe((await h.authenticate(f.reviewer)).userId);
    expect(
      await app.act(f.operator, {
        requestKey: randomUUID(),
        intentId: payment.id,
        expectedVersion: 2,
        kind: "attempt",
        outcome: "pending",
        reference: "bank-original",
        occurredAt: h.clock.now().toISOString(),
        note: "First initiation under fresh exact source approval",
      }),
    ).toMatchObject({ status: "pending", paid: false });
  });
  it("keeps original remittance separate from a foreign obligation with unknown reporting FX liability", async () => {
    const f = await approvedPeriod(),
      policy = await manualPolicy(f),
      original = await confirmed(f, policy, "remittance", "901");
    await expect(
      periods.saveObligation(f.operator, {
        requestKey: randomUUID(),
        key: f.obligation.key,
        expectedVersion: 1,
        definition: { ...f.obligation.definition, currency: "USD" },
        note: "An obligation cannot silently change currency identity",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const foreign = await periods.saveObligation(f.operator, {
      requestKey: randomUUID(),
      key: "synthetic-foreign-return",
      expectedVersion: 0,
      definition: {
        ...f.obligation.definition,
        currency: "USD",
        registration: {
          ...f.obligation.definition.registration,
          key: "synthetic-foreign-registration",
          identifier: "TEST-USD-ONLY",
        },
      },
      note: "Separate explicit reporting obligation; original remittance is not conversion evidence",
    });
    await periods.decideObligation(f.reviewer, {
      requestKey: randomUUID(),
      revisionId: foreign.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Review the separate explicit reporting policy",
    });
    const period = await periods.openPeriod(f.operator, {
      requestKey: randomUUID(),
      obligationId: foreign.id,
      startDate: f.reportingPeriod.startDate,
      endDate: f.reportingPeriod.endDate,
      dueAt: f.reportingPeriod.dueAt,
      reminders: [],
      evidence: ["Synthetic distinct obligation coverage"],
      note: "Separate explicit coverage, never adopt original INR payment",
    });
    const report = await periods.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "No invented reporting FX",
    });
    expect(report.snapshot.currency).toBe("USD");
    expect(report.snapshot.totalsKnown).toBe(false);
    expect(report.unresolved.map((i) => i.code)).toContain(
      "reporting_currency_evidence_required",
    );
    const workspace = await app.workspace(f.operator);
    expect(
      workspace.periods.find((p) => p.period.id === period.id),
    ).toMatchObject({
      liabilityMinor: null,
      remainingMinor: null,
      confirmedPaidMinor: "0",
      historicalPaidMinor: "0",
      unallocatedPaidMinor: "0",
      paid: false,
      fulfilled: false,
    });
    expect(workspace.allocations[0]).toMatchObject({
      amountMinor: "901",
      currency: "INR",
      currentReportId: f.report.id,
    });
    expect(
      workspace.intents.find((i) => i.id === original.intent.id),
    ).toMatchObject({ paid: true, target: { currency: "INR" } });
    expect(
      (
        await app.downloadEvidence(f.reviewer, {
          evidenceId: original.artifact.id,
        })
      ).bytes,
    ).toEqual(new Uint8Array(original.bytes));
  });
  describe("populated complete schema preservation", () => {
    let f: Awaited<ReturnType<typeof approvedPeriod>>,
      original: Awaited<ReturnType<typeof confirmed>>,
      before: Awaited<ReturnType<typeof app.workspace>>;
    beforeEach(async () => {
      f = await approvedPeriod();
      const policy = await manualPolicy(f);
      await app.exportReport(f.operator, {
        ...identity(f.report),
        requestKey: randomUUID(),
        note: "Retain the original approved export",
      });
      original = await confirmed(f, policy, "submission", "901");
      await confirmed(f, policy, "remittance", "400");
      await periods.evaluateReminders(f.operator);
      await confirmed(f, policy, "remittance", "501");
      const prepared = await periods.prepare(f.operator, {
        requestKey: randomUUID(),
        periodId: f.report.periodId,
        expectedRevision: 1,
        cutoff: f.report.snapshot.cutoff,
        note: "Explicit identical-source successor, preserve original filing",
      });
      const report = await periods.act(f.reviewer, {
        requestKey: randomUUID(),
        reportId: prepared.id,
        expectedVersion: 0,
        kind: "approve",
        issueId: null,
        note: "New exact report approval",
        evidence: ["synthetic successor review"],
      });
      const next = { ...f, report };
      await confirmed(next, policy, "submission", "901", original.intent.id);
      for (const allocation of (await app.workspace(f.operator)).allocations)
        await app.reconcileRemittance(f.reviewer, {
          ...identity(report),
          requestKey: randomUUID(),
          allocationId: allocation.id,
          expectedVersion: 0,
          expectedReportId: f.report.id,
          policyId: policy.id,
          note: "Explicit once-only original allocation carry-forward",
        });
      await app.downloadEvidence(f.reviewer, {
        evidenceId: original.artifact.id,
      });
      before = await app.workspace(f.operator);
    });
    it("preserves original sources, filing/remittance/approval/byte histories through FULL prepare Drizzle secure reapplication", async () => {
      async function dataFingerprint() {
        const tables = (
          await h.admin.query<{ name: string }>(
            "select tablename name from pg_tables where schemaname='public' order by tablename",
          )
        ).rows;
        const result: Record<string, { count: string; digest: string }> = {};
        for (const { name } of tables) {
          if (!/^[a-z_]+$/.test(name))
            throw Error("Unexpected disposable table identifier");
          result[name] = (
            await h.admin.query<{ count: string; digest: string }>(
              `select count(*)::text count,md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) digest from public."${name}" r`,
            )
          ).rows[0];
        }
        return result;
      }
      const catalog = async () => ({
        constraints: (
          await h.admin.query(
            "select c.conrelid::regclass::text as table_name,c.conname,pg_get_constraintdef(c.oid) definition,c.convalidated from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' order by c.conrelid::regclass::text,c.conname",
          )
        ).rows,
        functions: (
          await h.admin.query(
            "select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid::regprocedure::text",
          )
        ).rows,
      });
      const originalData = await dataFingerprint(),
        originalCatalog = await catalog();
      await prepareTaxFilingSecurity(h.admin);
      await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      await h.reapplySchema();
      await verifyRuntimeRole(h.runtime);
      expect(await dataFingerprint()).toEqual(originalData);
      expect(await catalog()).toEqual(originalCatalog);
      expect(await app.workspace(f.operator)).toEqual(before);
      expect(
        (
          await app.downloadEvidence(f.reviewer, {
            evidenceId: original.artifact.id,
          })
        ).bytes,
      ).toEqual(new Uint8Array(original.bytes));
      const keys = (
        await h.admin.query<{
          count: number;
          primary: boolean;
          validated: boolean;
        }>(
          "select count(*)::int count,bool_and(exists(select 1 from pg_constraint pk where pk.conrelid=fk.confrelid and pk.contype='p' and pk.conkey=fk.confkey)) primary,bool_and(fk.convalidated) validated from pg_constraint fk where fk.contype='f' and fk.conrelid in(select oid from pg_class where relname=any($1::text[]))",
          [[...taxFilingTables, "tax_filing_bytes"]],
        )
      ).rows[0];
      expect(keys).toEqual({ count: 31, primary: true, validated: true });
      expect(f.native.refunds).toHaveLength(1);
    });
  });
});
