import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createMemoryStorage } from "./support/storage";
import { financialExportFixture } from "./support/governance-financial";
import { createTaxPeriodApplication } from "../src/application/tax-periods";
import { createTaxPeriodRepository } from "../src/db/tax-period-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { financialNotifications } from "./support/financial-notifications";
import { taxCaptureFixture } from "./support/tax-periods";
import { createTaxPeriodHttp } from "../src/http/tax-periods";
import { verifyRuntimeRole } from "../src/db/runtime";
import {
  secureTaxPeriods,
  taxPeriodTables,
} from "../src/db/tax-period-security";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { fixtureIssuer } from "./support/seller-issuer";

describe("Tax periods at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let app: ReturnType<typeof createTaxPeriodApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    app = createTaxPeriodApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTaxPeriodRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
  });
  afterEach(async () => h?.close());

  async function obligation(
    operator: Headers,
    options: Record<string, unknown> = {},
  ) {
    const actor = await h.authenticate(operator);
    return app.saveObligation(operator, {
      requestKey: randomUUID(),
      key: "fixture-return",
      expectedVersion: 0,
      note: "Explicit synthetic configuration, no legal assertion",
      definition: {
        mode: "fixture",
        name: "Synthetic subscription return",
        jurisdiction: "fixture-domestic",
        timeZone: "Asia/Kolkata",
        currency: "INR",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveUntil: null,
        registration: {
          key: "fixture-registration",
          identifier: "TEST-ONLY",
          status: "registered",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveUntil: null,
          evidence: ["fixture:registration-review"],
        },
        basis: "document_issue_date",
        unissuedCharges: "require_invoice",
        preparerIds: [actor.userId],
        reviewerIds: [actor.userId],
        distinctReviewer: false,
        evidence: ["fixture:approved-reporting-policy"],
        ...options,
      },
    });
  }
  async function configure(
    operator: Headers,
    options: Record<string, unknown> = {},
  ) {
    const config = await obligation(operator, options);
    await app.decideObligation(operator, {
      requestKey: randomUUID(),
      revisionId: config.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Exact synthetic approval",
    });
    const period = await app.openPeriod(operator, {
      requestKey: randomUUID(),
      obligationId: config.id,
      startDate: "2026-11-01",
      endDate: "2026-12-01",
      dueAt: "2026-12-12T12:30:00.000Z",
      evidence: ["fixture:explicit-due-date"],
      reminders: [{ key: "review-due", at: "2026-11-05T09:10:00.000Z" }],
      note: "Explicit local calendar boundaries and timing",
    });
    return { config, period };
  }
  it("freezes exact original invoice minus permanent credit components and keeps real cash residual separate", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-period",
      true,
    );
    const { period } = await configure(f.operator);
    const prepared = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Prepare retained original sources",
    });
    expect(prepared.snapshot.totals).toEqual({
      netMinor: "9006",
      taxMinor: "901",
      totalMinor: "9907",
    });
    expect(
      prepared.snapshot.sources.filter((s) => s.included).map((s) => s.id),
    ).toEqual(expect.arrayContaining([f.invoice.id, f.credit.id]));
    expect(prepared.snapshot.adjustments[0]).toMatchObject({
      actualMinor: "1100",
      creditDocumentId: f.credit.id,
      creditMinor: "1099",
      uncreditedDifferenceMinor: "1",
      taxEffect: "linked_credit_only",
    });
    expect(
      prepared.snapshot.sources.find((s) => s.id === f.credit.id)?.adjustment
        ?.cumulative,
    ).toEqual([
      expect.objectContaining({
        lineId: "subscription",
        netBefore: "0",
        netAfter: "999",
        components: [{ name: "Synthetic tax", before: "0", after: "100" }],
      }),
    ]);
    expect(prepared.snapshot.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Synthetic tax",
          amountMinor: "901",
          registration: "TEST-ONLY",
        }),
      ]),
    );
    expect(prepared.snapshot.period).toMatchObject({
      start: "2026-10-31T18:30:00.000Z",
      end: "2026-11-30T18:30:00.000Z",
      timeZone: "Asia/Kolkata",
    });
    const approved = await app.act(f.operator, {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      note: "Reviewed exact frozen sources",
      evidence: ["fixture:review"],
      issueId: null,
    });
    expect(approved).toMatchObject({
      status: "approved",
      filed: false,
      paid: false,
      digest: prepared.digest,
    });
    expect(approved.actions[0]).toMatchObject({
      kind: "approve",
      actorId: (await h.authenticate(f.operator)).userId,
    });
    expect(JSON.stringify(prepared)).not.toMatch(
      /"(?:recoveryKey|recovery_key|lease|capability|apiKey|credential)"\s*:/,
    );
    expect((await app.workspace(f.operator)).periods[0].report?.id).toBe(
      prepared.id,
    );
  });
  it("retains the approved revision and records source invalidation before a late credit can enter its successor", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-late",
    );
    const { period } = await configure(f.operator);
    const prepared = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Original preparation",
    });
    const approval = {
      requestKey: randomUUID(),
      reportId: prepared.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Reviewed original",
      evidence: ["fixture:review"],
    };
    await app.act(f.operator, approval);
    const original = await app.exportReport(f.operator, {
      reportId: prepared.id,
      digest: prepared.digest,
    });
    expect(original.report.snapshot.totals).toEqual({
      netMinor: "9005",
      taxMinor: "901",
      totalMinor: "9906",
    });
    h.clock.set("2026-11-05T09:01:00Z");
    await f.documents.adjust(f.op, f.business.id, {
      invoiceId: f.invoice.id,
      periodId: f.period.id,
      paymentId: f.period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "refund", reference: "fixture:late-correction" },
      reason: "Late original component correction",
      evidence: ["fixture:approved-correction"],
      lines: [{ lineId: "subscription", netMinor: "1000" }],
    });
    const historical = await app.report(f.operator, prepared.id);
    expect(historical).toMatchObject({
      digest: prepared.digest,
      status: "review_required",
      current: false,
      snapshot: original.report.snapshot,
    });
    expect(historical.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "approve" }),
        expect.objectContaining({ kind: "invalidated" }),
      ]),
    );
    await expect(
      app.exportReport(f.operator, {
        reportId: prepared.id,
        digest: prepared.digest,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const successor = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 1,
      cutoff: h.clock.now().toISOString(),
      note: "Include late correction",
    });
    expect(successor).toMatchObject({
      revision: 2,
      status: "prepared",
      snapshot: {
        totals: { netMinor: "8005", taxMinor: "801", totalMinor: "8806" },
      },
    });
    expect((await app.report(f.operator, prepared.id)).status).toBe(
      "superseded",
    );
  });
  it("requires attributed issue resolution and a fresh approval after a reviewer raises a later concern", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-review",
    );
    const { period } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Review fixture",
    });
    const command = (
      kind: string,
      expectedVersion: number,
      issueId: string | null = null,
    ) => ({
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion,
      kind,
      issueId,
      note: "Explicit independent review evidence",
      evidence: ["fixture:review-decision"],
    });
    await app.act(f.operator, command("review", 0));
    await app.act(f.operator, command("approve", 1));
    const raised = await app.act(
      f.operator,
      command("raise_issue", 2, f.invoice.id),
    );
    expect(raised.status).toBe("review_required");
    await expect(
      app.act(f.operator, command("approve", 3)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const resolved = await app.act(
      f.operator,
      command("resolve_issue", 3, raised.unresolved[0].id),
    );
    expect(resolved.status).toBe("in_review");
    const approval = command("approve", 4);
    expect((await app.act(f.operator, approval)).status).toBe("approved");
    expect((await app.act(f.operator, approval)).actions).toHaveLength(5);
    const other = await h.signIn("other-tax-reviewer@example.com");
    await h.provisionOperator(other, { tax: true, reconciliation: false });
    await expect(app.act(other, approval)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("prevents overlapping duplicate obligations and serializes concurrent preparations with actor-bound retries", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-concurrency",
    );
    const { config, period } = await configure(f.operator);
    const other = await app.saveObligation(f.operator, {
      requestKey: randomUUID(),
      key: "duplicate-return",
      expectedVersion: 0,
      definition: config.definition,
      note: "Same registration and jurisdiction",
    });
    await app.decideObligation(f.operator, {
      requestKey: randomUUID(),
      revisionId: other.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Synthetic configuration",
    });
    await expect(
      app.openPeriod(f.operator, {
        requestKey: randomUUID(),
        obligationId: other.id,
        startDate: "2026-11-15",
        endDate: "2026-12-15",
        dueAt: "2026-12-20T00:00:00.000Z",
        evidence: ["fixture:date"],
        reminders: [],
        note: "Duplicate coverage",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const input = {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Concurrent request",
    };
    const results = await Promise.all([
      app.prepare(f.operator, input),
      app.prepare(f.operator, input),
    ]);
    expect(results[0].id).toBe(results[1].id);
    await expect(
      app.prepare(f.operator, { ...input, note: "Changed payload" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.prepare(f.operator, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await app.workspace(f.operator)).periods).toHaveLength(1);
  });
  it("corrects configured due timing through an explicit successor period while preserving approved history", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-period-successor",
      ),
      { period, config } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Original approved schedule",
    });
    await app.act(f.operator, {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Original review",
      evidence: ["fixture:review"],
    });
    const replacement = await app.openPeriod(f.operator, {
      requestKey: randomUUID(),
      obligationId: config.id,
      supersedesId: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      dueAt: "2026-12-20T12:30:00.000Z",
      evidence: ["fixture:reviewed-due-date-correction"],
      reminders: [{ key: "corrected-review", at: "2026-11-05T09:11:00.000Z" }],
      note: "Explicit correction, no inferred legal extension",
    });
    expect(replacement).toMatchObject({
      supersedesId: period.id,
      dueAt: "2026-12-20T12:30:00.000Z",
    });
    expect(await app.report(f.operator, report.id)).toMatchObject({
      status: "superseded",
      current: false,
      digest: report.digest,
      snapshot: report.snapshot,
    });
    await expect(
      app.prepare(f.operator, {
        requestKey: randomUUID(),
        periodId: period.id,
        expectedRevision: 1,
        cutoff: h.clock.now().toISOString(),
        note: "Cannot prepare superseded timing",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const successor = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: replacement.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Review corrected explicit schedule",
    });
    expect(successor.snapshot.totals).toEqual(report.snapshot.totals);
    expect(
      (await app.workspace(f.operator)).periods.map((p) => p.status),
    ).toEqual(["superseded", "prepared"]);
  });
  it("persists only configured due reminder stages across restart and supersedes their source after review", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-reminders",
    );
    const { period } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Due fixture",
    });
    expect(await app.evaluateReminders(f.operator)).toEqual({ created: 0 });
    h.clock.set("2026-11-05T09:10:00Z");
    expect(await app.evaluateReminders(f.operator)).toEqual({ created: 1 });
    expect(await app.evaluateReminders(f.operator)).toEqual({ created: 0 });
    const restarted = createTaxPeriodApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTaxPeriodRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
    const before = (await restarted.workspace(f.operator)).reminders;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      stage: "review-due",
      channel: "in_app",
      status: "available",
      current: true,
      source: { reportId: report.id, reportDigest: report.digest },
    });
    await restarted.act(f.operator, {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Reviewed before later configured stages",
      evidence: ["fixture:review"],
    });
    expect((await restarted.workspace(f.operator)).reminders[0]).toMatchObject({
      id: before[0].id,
      current: false,
    });
    expect(await restarted.evaluateReminders(f.operator)).toEqual({
      created: 0,
    });
    h.clock.set("2026-12-13T09:00:00Z");
    const current = await h.signIn("tax-operator@example.com");
    expect((await restarted.workspace(current)).periods[0]).toMatchObject({
      overdue: true,
      report: { status: "approved", filed: false, paid: false },
    });
  });
  it("retains configured report reminders for a covered historical obligation after its sales coverage has ended", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-ended-obligation",
      ),
      config = await obligation(f.operator, {
        effectiveUntil: "2026-11-06T00:00:00.000Z",
      });
    await app.decideObligation(f.operator, {
      requestKey: randomUUID(),
      revisionId: config.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Historical covered obligation remains reviewable",
    });
    await app.openPeriod(f.operator, {
      requestKey: randomUUID(),
      obligationId: config.id,
      startDate: "2026-11-05",
      endDate: "2026-11-06",
      dueAt: "2026-11-12T00:00:00.000Z",
      evidence: ["fixture:explicit-after-coverage-due"],
      reminders: [{ key: "review-due", at: "2026-11-05T09:10:00.000Z" }],
      note: "Report remains due after the sales window",
    });
    h.clock.set("2026-11-05T09:10:00Z");
    expect(await app.evaluateReminders(f.operator)).toEqual({ created: 1 });
    expect((await app.workspace(f.operator)).reminders[0].current).toBe(true);
  });
  it("enforces a configured distinct reviewer and binds retry UUIDs to the original authorized actor", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-distinct",
    );
    const reviewer = await h.signIn("independent-tax@example.com");
    await h.provisionOperator(reviewer, { tax: true, reconciliation: false });
    const prepId = (await h.authenticate(f.operator)).userId,
      reviewerId = (await h.authenticate(reviewer)).userId;
    const { period } = await configure(f.operator, {
      distinctReviewer: true,
      reviewerIds: [prepId, reviewerId],
    });
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Prepared by original operator",
    });
    const approval = {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Distinct authorized reviewer",
      evidence: ["fixture:review"],
    };
    await expect(app.act(f.operator, approval)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const approved = await app.act(reviewer, approval);
    expect(approved).toMatchObject({
      actorId: prepId,
      actions: [{ actorId: reviewerId, kind: "approve" }],
    });
    await expect(app.act(f.operator, approval)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await h.admin.query(
      "update platform_operator set tax=false where user_id=$1",
      [reviewerId],
    );
    await expect(app.act(reviewer, approval)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      app.exportReport(reviewer, {
        reportId: report.id,
        digest: report.digest,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps original liability after customer and current tax-rule edits, and invalidates only a changed obligation", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-original",
    );
    const { period, config } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Original historical evidence",
    });
    const original = f.rules.revisions[0];
    await f.tax.saveRule(f.operator, {
      key: original.key,
      expectedVersion: 1,
      rule: {
        ...original.rule,
        rates: [
          { name: "Changed current rate", numerator: "1", denominator: "2" },
        ],
        registration: {
          ...original.rule.registration,
          identifier: "NEW-REGISTRATION",
        },
      },
      note: "Later configured rule",
    });
    const billing = await f.billing.workspace(f.owner, f.business.id);
    await f.billing.save(f.owner, f.business.id, {
      expectedVersion: 1,
      note: "Later customer correction",
      profile: { ...billing.current!.profile, legalName: "Changed buyer" },
    });
    expect((await app.report(f.operator, report.id)).snapshot).toEqual(
      report.snapshot,
    );
    expect((await app.report(f.operator, report.id)).current).toBe(true);
    await app.saveObligation(f.operator, {
      requestKey: randomUUID(),
      key: config.key,
      expectedVersion: 1,
      definition: {
        ...config.definition,
        evidence: ["fixture:successor-policy"],
      },
      note: "Obligation revision requires a new review",
    });
    const stale = await app.report(f.operator, report.id);
    expect(stale.current).toBe(false);
    expect(stale.actions.at(-1)?.kind).toBe("invalidated");
    expect(stale.snapshot).toEqual(report.snapshot);
    await expect(
      app.prepare(f.operator, {
        requestKey: randomUUID(),
        periodId: period.id,
        expectedRevision: 1,
        cutoff: h.clock.now().toISOString(),
        note: "Unapproved configuration cannot prepare",
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
  });
  it("delivers an opted-in typed tax reminder once to its current verified tax audience", async () => {
    await financialExportFixture(h, createMemoryStorage(), "tax-mail");
    const n = await financialNotifications(h);
    const operator = await h.signIn("tax-operator@example.com");
    await configure(operator);
    await n.app.setPreference(operator, null, {
      purpose: "tax_period",
      enabled: true,
      expectedVersion: 0,
    });
    expect(await app.evaluateReminders(operator)).toEqual({ created: 1 });
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(1);
    expect(n.effects[0].body).toMatchObject({
      to: ["tax-operator@example.com"],
      subject: "Tax period review is due",
    });
    expect(String(n.effects[0].body.text)).toContain("/platform/tax/periods");
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(1);
    expect((await app.workspace(operator)).reminders[0]).toMatchObject({
      channel: "in_app",
      status: "available",
    });
  });
  it("fences tax email on current verification, preference and tax role without accepting recipient or body overrides", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-mail-authority",
      ),
      n = await financialNotifications(h),
      operator = await h.signIn("tax-operator@example.com"),
      actor = await h.authenticate(operator);
    await configure(operator);
    await n.app.setPreference(operator, null, {
      purpose: "tax_period",
      enabled: true,
      expectedVersion: 0,
    });
    await app.evaluateReminders(operator);
    await h.admin.query('update "user" set email_verified=false where id=$1', [
      actor.userId,
    ]);
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(0);
    await h.admin.query('update "user" set email_verified=true where id=$1', [
      actor.userId,
    ]);
    await n.app.setPreference(operator, null, {
      purpose: "tax_period",
      enabled: false,
      expectedVersion: 1,
    });
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(0);
    await n.app.setPreference(operator, null, {
      purpose: "tax_period",
      enabled: true,
      expectedVersion: 2,
    });
    await h.admin.query(
      "update platform_operator set tax=false where user_id=$1",
      [actor.userId],
    );
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(0);
    const owner = await h.signIn("tax-owner@example.com");
    await expect(
      n.app.setPreference(owner, f.business.id, {
        purpose: "tax_period",
        enabled: true,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      n.app.setPreference(owner, null, {
        purpose: "tax_period",
        enabled: true,
        expectedVersion: 0,
        email: "foreign@example.com",
        body: "arbitrary",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("supersedes a persisted reminder before any email when its report stage changes", async () => {
    await financialExportFixture(h, createMemoryStorage(), "tax-mail-stage");
    const n = await financialNotifications(h),
      operator = await h.signIn("tax-operator@example.com"),
      { period } = await configure(operator);
    await n.app.setPreference(operator, null, {
      purpose: "tax_period",
      enabled: true,
      expectedVersion: 0,
    });
    await app.evaluateReminders(operator);
    expect((await app.workspace(operator)).reminders[0].current).toBe(true);
    await app.prepare(operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "New persisted report stage supersedes the old reminder",
    });
    await n.app.recoverPending();
    expect(n.effects).toHaveLength(0);
    expect((await app.workspace(operator)).reminders[0].current).toBe(false);
  });
  it("requires explicit source coverage for a genuine captured charge without an issued invoice", async () => {
    const f = await taxCaptureFixture(h);
    const { period } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Missing numbered invoice",
    });
    expect(report).toMatchObject({
      status: "review_required",
      snapshot: {
        totalsKnown: false,
        totals: { netMinor: "0", taxMinor: "0", totalMinor: "0" },
        sources: [
          expect.objectContaining({
            id: f.period.id,
            kind: "captured_charge",
            included: false,
            reason: "captured_charge_without_invoice",
            nativePaymentId: "pay_taxunissued",
          }),
        ],
      },
    });
    const command = {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "resolve_issue",
      issueId: report.unresolved[0].id,
      note: "Cannot waive a required invoice",
      evidence: ["fixture:note"],
    };
    await expect(app.act(f.operator, command)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      app.act(f.operator, { ...command, kind: "approve", issueId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("requires an attributed exclusion decision when the configured issue-date policy permits unissued-charge review", async () => {
    const f = await taxCaptureFixture(h),
      { period } = await configure(f.operator, {
        unissuedCharges: "review_exclusion",
      });
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Explicit document-basis coverage review",
    });
    const issue = report.unresolved[0];
    expect(issue).toMatchObject({
      code: "captured_charge_without_invoice",
      resolvable: true,
      required: true,
    });
    const action = {
      reportId: report.id,
      note: "Reviewed exclusion under the configured issue-date basis; capture retained for later invoicing",
      evidence: ["fixture:reviewed-source-coverage"],
      issueId: issue.id,
    };
    await app.act(f.operator, {
      ...action,
      requestKey: randomUUID(),
      expectedVersion: 0,
      kind: "resolve_issue",
    });
    const approved = await app.act(f.operator, {
      ...action,
      issueId: null,
      requestKey: randomUUID(),
      expectedVersion: 1,
      kind: "approve",
    });
    expect(approved).toMatchObject({
      status: "approved",
      filed: false,
      paid: false,
      snapshot: {
        sources: [
          expect.objectContaining({
            id: f.period.id,
            included: false,
            reason: "captured_charge_without_invoice",
          }),
        ],
      },
    });
    expect(approved.actions.map((a) => a.kind)).toEqual([
      "resolve_issue",
      "approve",
    ]);
  });
  it("serializes concurrent review and successor preparation without mutating either frozen snapshot", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-review-race",
      ),
      { period } = await configure(f.operator);
    const first = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "First frozen report",
    });
    const outcomes = await Promise.allSettled([
      app.prepare(f.operator, {
        requestKey: randomUUID(),
        periodId: period.id,
        expectedRevision: 1,
        cutoff: h.clock.now().toISOString(),
        note: "Explicit successor",
      }),
      app.act(f.operator, {
        requestKey: randomUUID(),
        reportId: first.id,
        expectedVersion: 0,
        kind: "approve",
        issueId: null,
        note: "Concurrent exact review",
        evidence: ["fixture:review"],
      }),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    if (outcomes[1].status === "rejected")
      expect(outcomes[1].reason).toMatchObject({ code: "CONFLICT" });
    const previous = await app.report(f.operator, first.id),
      latest = (await app.workspace(f.operator)).periods[0].report!;
    expect(previous).toMatchObject({
      status: "superseded",
      digest: first.digest,
      snapshot: first.snapshot,
    });
    expect(latest).toMatchObject({ revision: 2, status: "prepared" });
    expect(
      previous.actions.filter((a) => a.kind === "approve").length,
    ).toBeLessThanOrEqual(1);
  });
  it("gates reporting-currency conversion and distinguishes a complete zero period across DST", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-currency",
    );
    const { period } = await configure(f.operator, {
      currency: "USD",
      timeZone: "America/New_York",
    });
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Bank settlement FX is not filing FX",
    });
    expect(report.snapshot.totalsKnown).toBe(false);
    expect(report.unresolved.map((i) => i.code)).toContain(
      "reporting_currency_evidence_required",
    );
    expect(report.snapshot.sources.every((s) => !s.included)).toBe(true);
    const config = await app.saveObligation(f.operator, {
      requestKey: randomUUID(),
      key: "different-jurisdiction",
      expectedVersion: 0,
      definition: {
        ...(await app.workspace(f.operator)).obligations[0].definition,
        jurisdiction: "fixture-other",
      },
      note: "Separate explicit coverage",
    });
    await app.decideObligation(f.operator, {
      requestKey: randomUUID(),
      revisionId: config.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Synthetic approval",
    });
    const dst = await app.openPeriod(f.operator, {
      requestKey: randomUUID(),
      obligationId: config.id,
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      dueAt: "2026-11-10T00:00:00.000Z",
      evidence: ["fixture:calendar"],
      reminders: [],
      note: "Fall transition day",
    });
    expect(dst).toMatchObject({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
    const zero = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: dst.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Complete retained zero population",
    });
    expect(zero).toMatchObject({
      status: "prepared",
      snapshot: {
        totalsKnown: true,
        totals: { netMinor: "0", taxMinor: "0", totalMinor: "0" },
      },
    });
  });
  it("denies Business and unrelated operator authority and uses central current tax MFA at the HTTP seam", async () => {
    const n = await financialNotifications(h),
      owner = await h.signIn("business-only@example.com"),
      operator = await h.signIn("tax-primary@example.com", false);
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    expect(await h.access.status(operator)).toMatchObject({
      required: true,
      operator: true,
      operatorVerified: false,
    });
    await expect(app.workspace(operator)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const unrelated = await h.signIn("unrelated-financial@example.com"),
      actor = await h.authenticate(unrelated);
    await h.admin.query(
      "insert into platform_operator(user_id,documents,refunds,reconciliation) values($1,true,true,true)",
      [actor.userId],
    );
    await expect(app.workspace(unrelated)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const http = createTaxPeriodHttp({
      application: app,
      notifications: n.app,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    expect(
      (
        await http.get(
          new Request("http://localhost:3000/api/platform/tax/periods", {
            headers: owner,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.get(
          new Request("http://localhost:3000/api/platform/tax/periods"),
        )
      ).status,
    ).toBe(401);
    const current = await h.signIn("tax-primary@example.com");
    const response = await http.command(
      new Request("http://localhost:3000/api/platform/tax/periods", {
        method: "POST",
        headers: {
          cookie: current.get("cookie")!,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "prepare",
          input: {
            periodId: "private-native-secret-invalid",
            requestKey: randomUUID(),
          },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(
      "private-native-secret-invalid",
    );
    expect(
      (
        await http.command(
          new Request("http://localhost:3000/api/platform/tax/periods", {
            method: "POST",
            headers: {
              cookie: current.get("cookie")!,
              origin: "https://foreign.example",
              "content-type": "application/json",
            },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("rechecks current tax authority after reading a sensitive approved export", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-export-authority",
      ),
      { period } = await configure(f.operator);
    const report = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Export review",
    });
    await app.act(f.operator, {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "approve",
      issueId: null,
      note: "Approved exact snapshot",
      evidence: ["fixture:review"],
    });
    let calls = 0;
    const raced = createTaxPeriodApplication({
      clock: h.clock,
      repository: createTaxPeriodRepository(runtimeDatabase(h.runtime)),
      authenticatePlatform: async (credentials: Headers) => {
        const actor = await h.access.authenticatePlatform(credentials);
        if (++calls === 2)
          await h.admin.query(
            "update platform_operator set tax=false where user_id=$1",
            [actor.userId],
          );
        return actor;
      },
    });
    await expect(
      raced.exportReport(f.operator, {
        reportId: report.id,
        digest: report.digest,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not let a Business actor run global due work by clearing its Business scope", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-global-job",
    );
    await configure(f.operator);
    const client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true)",
        [(await h.authenticate(f.owner)).userId],
      );
      expect(
        (
          await client.query(
            "select public.tax_reporting_due(statement_timestamp()) as created",
          )
        ).rows[0].created,
      ).toBe(0);
      await client.query("commit");
    } finally {
      client.release();
    }
    expect((await app.workspace(f.operator)).reminders).toHaveLength(0);
  });
  it("includes a permanent numbered invoice despite failed artifact bytes and requires evidenced resolution", async () => {
    const f = await taxCaptureFixture(h),
      storage = createMemoryStorage();
    storage.failPut = true;
    const documents = createSellerDocumentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      mode: "fixture",
      storage,
      policy: {
        accountScope: "tax-artifact",
        maxBytes: 1000000,
        accessTtlSeconds: 60,
        recoveryLeaseSeconds: 60,
      },
    });
    await h.admin.query(
      "update platform_operator set documents=true where user_id=$1",
      [(await h.authenticate(f.operator)).userId],
    );
    const catalog = await documents.saveIssuer(f.operator, {
      expectedVersion: 0,
      note: "Explicit synthetic legal configuration",
      configuration: fixtureIssuer,
    });
    await documents.decideIssuer(f.operator, {
      revisionId: catalog.revisions[0].id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Synthetic exact approval",
    });
    const invoice = await documents.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    expect(invoice.artifact.state).toBe("failed");
    const { period } = await configure(f.operator),
      report = await app.prepare(f.operator, {
        requestKey: randomUUID(),
        periodId: period.id,
        expectedRevision: 0,
        cutoff: h.clock.now().toISOString(),
        note: "Number survives missing artifact",
      });
    expect(report.snapshot).toMatchObject({
      totals: { netMinor: "10005", taxMinor: "1001", totalMinor: "11006" },
    });
    const issue = report.unresolved.find(
      (i) => i.code === "numbered_document_artifact_unavailable",
    )!;
    const resolved = await app.act(f.operator, {
      requestKey: randomUUID(),
      reportId: report.id,
      expectedVersion: 0,
      kind: "resolve_issue",
      issueId: issue.id,
      note: "Reviewed retained permanent snapshot; bytes remain unavailable",
      evidence: ["fixture:original-ledger-verification"],
    });
    expect(resolved.unresolved).toHaveLength(0);
    expect(
      resolved.snapshot.sources.find((s) => s.id === invoice.id)?.artifactState,
    ).toBe("failed");
  });
  it("keeps pending refunds out of cash and tax, then requires a permanent credit after confirmed money", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-pending",
      ),
      { period } = await configure(f.operator);
    const pending = await f.adjustments.review(f.op, f.business.id, {
      kind: "refund",
      invoiceId: f.invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "1000" }],
      reason: "Pending request only",
      evidence: ["fixture:refund-review"],
    });
    await f.adjustments.execute(f.op, f.business.id, { caseId: pending.id });
    const first = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Pending native refund is not money or credit",
    });
    expect(first.snapshot.adjustments).toEqual([]);
    expect(first.snapshot.totals.taxMinor).toBe("901");
    f.native.refunds[0].status = "processed";
    await f.adjustments.refresh(f.op, f.business.id, { caseId: pending.id });
    const next = await app.prepare(f.operator, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 1,
      cutoff: h.clock.now().toISOString(),
      note: "Confirmed cash still awaits permanent credit",
    });
    expect(next.snapshot.totals.taxMinor).toBe("901");
    expect(next.snapshot.adjustments[0]).toMatchObject({
      actualMinor: "1100",
      creditDocumentId: null,
      taxEffect: "linked_credit_only",
    });
    expect(next.unresolved.map((i) => i.code)).toContain(
      "confirmed_adjustment_without_permanent_credit",
    );
  });
  it("uses inclusive local starts and exclusive ends, assigning a later credit to its own issue period", async () => {
    const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-boundaries",
      ),
      config = await obligation(f.operator, { timeZone: "Etc/GMT+9" });
    await app.decideObligation(f.operator, {
      requestKey: randomUUID(),
      revisionId: config.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Explicit issue-date basis",
    });
    const open = (startDate: string, endDate: string) =>
      app.openPeriod(f.operator, {
        requestKey: randomUUID(),
        obligationId: config.id,
        startDate,
        endDate,
        dueAt: "2026-12-12T00:00:00.000Z",
        evidence: ["fixture:calendar"],
        reminders: [],
        note: "Adjacent explicit periods",
      });
    const before = await open("2026-11-04", "2026-11-05"),
      original = await open("2026-11-05", "2026-11-06"),
      later = await open("2026-11-06", "2026-11-07");
    const prepare = (periodId: string, operator: Headers) =>
      app.prepare(operator, {
        requestKey: randomUUID(),
        periodId,
        expectedRevision: 0,
        cutoff: h.clock.now().toISOString(),
        note: "Exact local date boundary",
      });
    expect(
      (await prepare(before.id, f.operator)).snapshot.totals.taxMinor,
    ).toBe("0");
    const initial = await prepare(original.id, f.operator);
    expect(initial.snapshot.totals.taxMinor).toBe("901");
    h.clock.set("2026-11-06T09:00:00Z");
    const documentsActor = await h.signIn("export-documents@example.com"),
      taxActor = await h.signIn("tax-operator@example.com");
    await f.documents.adjust(documentsActor, f.business.id, {
      invoiceId: f.invoice.id,
      periodId: f.period.id,
      paymentId: f.period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "refund", reference: "fixture:boundary-credit" },
      reason: "Later issue date",
      evidence: ["fixture:correction"],
      lines: [{ lineId: "subscription", netMinor: "1000" }],
    });
    expect((await app.report(taxActor, initial.id)).current).toBe(true);
    const correction = await prepare(later.id, taxActor);
    expect(correction.snapshot.totals).toEqual({
      netMinor: "-1000",
      taxMinor: "-100",
      totalMinor: "-1100",
    });
    expect(
      correction.snapshot.sources.find((s) => s.id === f.invoice.id),
    ).toMatchObject({
      included: false,
      reason: "outside_period_original_context",
    });
  });
  it("retains confirmed cash and original-tax provenance when its permanent credit is issued in a later period", async () => {
    const f = await financialExportFixture(
      h,
      createMemoryStorage(),
      "tax-later-credit",
      true,
    );
    const refund = await f.adjustments.review(f.op, f.business.id, {
      kind: "refund",
      invoiceId: f.invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "1000" }],
      reason: "Second confirmed partial refund",
      evidence: ["fixture:refund-review"],
    });
    await f.adjustments.execute(f.op, f.business.id, { caseId: refund.id });
    f.native.refunds[1].status = "processed";
    await f.adjustments.refresh(f.op, f.business.id, { caseId: refund.id });
    h.clock.set("2026-11-06T09:00:00Z");
    const documentsActor = await h.signIn("export-documents@example.com"),
      taxActor = await h.signIn("tax-operator@example.com");
    await f.adjustments.credit(documentsActor, f.business.id, {
      caseId: refund.id,
    });
    const config = await obligation(taxActor, { timeZone: "Etc/GMT+9" });
    await app.decideObligation(taxActor, {
      requestKey: randomUUID(),
      revisionId: config.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Original issue-date basis",
    });
    const period = await app.openPeriod(taxActor, {
      requestKey: randomUUID(),
      obligationId: config.id,
      startDate: "2026-11-06",
      endDate: "2026-11-07",
      dueAt: "2026-12-12T00:00:00.000Z",
      evidence: ["fixture:calendar"],
      reminders: [],
      note: "Later credit period",
    });
    const report = await app.prepare(taxActor, {
      requestKey: randomUUID(),
      periodId: period.id,
      expectedRevision: 0,
      cutoff: h.clock.now().toISOString(),
      note: "Cash context follows its linked credit",
    });
    expect(report.snapshot.totals).toEqual({
      netMinor: "-1000",
      taxMinor: "-100",
      totalMinor: "-1100",
    });
    expect(report.snapshot.adjustments).toHaveLength(1);
    expect(report.snapshot.adjustments[0]).toMatchObject({
      actualMinor: "1100",
      creditMinor: "1100",
      uncreditedDifferenceMinor: "0",
      originalTax: { id: f.invoice.snapshot.financial.tax.id },
      taxEffect: "linked_credit_only",
    });
  });
  describe("complete retained document population", () => {
    let operator: Headers, periodId: string;
    beforeEach(async () => {
      const f = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-population",
      );
      operator = f.operator;
      for (let i = 0; i < 201; i++)
        await f.documents.adjust(f.op, f.business.id, {
          invoiceId: f.invoice.id,
          periodId: f.period.id,
          paymentId: f.period.paymentId,
          requestKey: randomUUID(),
          adjustmentId: randomUUID(),
          source: {
            kind: "refund",
            reference: `fixture:retained-correction-${i}`,
          },
          reason: "Explicit original-component correction",
          evidence: [`fixture:approved-correction-${i}`],
          lines: [{ lineId: "subscription", netMinor: "1" }],
        });
      periodId = (await configure(operator)).period.id;
    });
    it("aggregates beyond 200 retained source documents without a history-page cap", async () => {
      const report = await app.prepare(operator, {
        requestKey: randomUUID(),
        periodId,
        expectedRevision: 0,
        cutoff: h.clock.now().toISOString(),
        note: "Complete retained original population",
      });
      expect(report.snapshot.sources.filter((s) => s.included)).toHaveLength(
        203,
      );
      expect(report.snapshot.totals).toEqual({
        netMinor: "8804",
        taxMinor: "881",
        totalMinor: "9685",
      });
      expect(
        new Set(
          report.snapshot.sources.filter((s) => s.included).map((s) => s.id),
        ).size,
      ).toBe(203);
    });
  });
  for (const privilege of ["SELECT", "INSERT"])
    it(`requires ${privilege} individually on every tax ledger`, async () => {
      for (const table of taxPeriodTables) {
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
      await verifyRuntimeRole(h.runtime);
    });
  it("requires each operational helper, denies private helpers and rejects implicit default PUBLIC execution", async () => {
    for (const signature of [
      "tax_reporting_operator()",
      "tax_reporting_sources(uuid)",
      "tax_reporting_due(timestamptz)",
      "tax_reminder_visible(uuid)",
      "tax_reporting_people()",
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
      "tax_reporting_changed()",
      "tax_reminder_current(uuid)",
    ]) {
      expect(
        (
          await h.runtime.query<{ allowed: boolean }>(
            "select has_function_privilege(current_user,$1,'EXECUTE') as allowed",
            [`public.${signature}`],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
    const definition = (
      await h.admin.query<{ definition: string }>(
        "select pg_get_functiondef('public.tax_reporting_people()'::regprocedure) as definition",
      )
    ).rows[0].definition;
    await h.admin.query("drop function public.tax_reporting_people()");
    await h.admin.query(definition);
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await secureTaxPeriods(h.admin);
    await verifyRuntimeRole(h.runtime);
  });
  describe("populated full-schema reapplication", () => {
    let fixture: Awaited<ReturnType<typeof financialExportFixture>>,
      before: Awaited<ReturnType<typeof app.workspace>>;
    beforeEach(async () => {
      fixture = await financialExportFixture(
        h,
        createMemoryStorage(),
        "tax-reapply",
        true,
      );
      const { period } = await configure(fixture.operator);
      const report = await app.prepare(fixture.operator, {
        requestKey: randomUUID(),
        periodId: period.id,
        expectedRevision: 0,
        cutoff: h.clock.now().toISOString(),
        note: "Populated immutable report",
      });
      await app.act(fixture.operator, {
        requestKey: randomUUID(),
        reportId: report.id,
        expectedVersion: 0,
        kind: "review",
        issueId: null,
        note: "Original reviewer",
        evidence: ["fixture:review"],
      });
      h.clock.set("2026-11-05T09:10:00Z");
      await app.evaluateReminders(fixture.operator);
      const successor = await app.openPeriod(fixture.operator, {
        requestKey: randomUUID(),
        obligationId: period.obligationId,
        supersedesId: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        dueAt: "2026-12-20T12:30:00.000Z",
        evidence: ["fixture:explicit-timing-correction"],
        reminders: [
          { key: "corrected-review", at: "2026-11-05T09:10:00.000Z" },
        ],
        note: "Populate the stable-primary-key successor scope",
      });
      await app.prepare(fixture.operator, {
        requestKey: randomUUID(),
        periodId: successor.id,
        expectedRevision: 0,
        cutoff: h.clock.now().toISOString(),
        note: "Retain original and successor review histories",
      });
      await app.evaluateReminders(fixture.operator);
      before = await app.workspace(fixture.operator);
    });
    it("preserves original financial/report/history/reminder records and all restricted protections", async () => {
      await h.reapplySchema();
      await verifyRuntimeRole(h.runtime);
      expect(await app.workspace(fixture.operator)).toEqual(before);
      const client = await h.runtime.connect();
      try {
        await client.query("begin");
        await client.query(
          "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true)",
          [(await h.authenticate(fixture.owner)).userId, fixture.business.id],
        );
        for (const table of taxPeriodTables)
          expect(
            (
              await client.query(
                `select count(*)::int as count from public.${table}`,
              )
            ).rows[0].count,
          ).toBe(0);
        expect(
          (
            await client.query(
              "select public.tax_reporting_sources($1) as sources,public.tax_reporting_people() as people,public.tax_reporting_due(statement_timestamp()) as created",
              [before.periods[0].period.id],
            )
          ).rows[0],
        ).toEqual({ sources: null, people: null, created: 0 });
        await client.query("rollback");
      } finally {
        client.release();
      }
      const taxClient = await h.runtime.connect();
      try {
        await taxClient.query("begin");
        await taxClient.query(
          "select set_config('app.actor_id',$1,true),set_config('app.business_id','',true)",
          [(await h.authenticate(fixture.operator)).userId],
        );
        expect(
          (
            await taxClient.query(
              "select count(*)::int as count from financial_case",
            )
          ).rows[0].count,
        ).toBe(0);
        await expect(
          taxClient.query(
            "update tax_liability_report set digest=repeat('0',64)",
          ),
        ).rejects.toThrow();
        await taxClient.query("rollback");
      } finally {
        taxClient.release();
      }
    });
  });
});
