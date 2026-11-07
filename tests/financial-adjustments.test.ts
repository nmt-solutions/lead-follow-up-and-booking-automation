import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { randomUUID, createHmac } from "node:crypto";
import { subscriptionFixture } from "./support/subscription";
import { razorpayFixture } from "./support/razorpay";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { createReconciliationApplication } from "../src/application/reconciliation";
import { createReconciliationRepository } from "../src/db/reconciliation-repository";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { createMemoryStorage } from "./support/storage";
import { fixtureIssuer } from "./support/seller-issuer";
import { financialNativeFixture } from "./support/financial-native";
import { createFinancialAdjustmentHttp } from "../src/http/financial-adjustments";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";
import { financialResearch } from "./support/financial-operational";
import { financialNotifications } from "./support/financial-notifications";

describe("Refunds and disputes at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  async function purchase() {
    const f = await subscriptionFixture(h),
      native = financialNativeFixture(h.clock);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: configuredPayments(native.configuration),
    });
    const a = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: a.id });
    native.charge(
      "pay_original",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await payments.refresh(f.owner, f.business.id, { actionId: a.id });
    const period = (await payments.workspace(f.owner, f.business.id))
      .periods[0];
    const op = await h.signIn("refunds@example.com"),
      actor = await h.authenticate(op);
    await h.admin.query(
      "insert into platform_operator(user_id,refunds,documents) values($1,true,true)",
      [actor.userId],
    );
    const storage = createMemoryStorage();
    const documents = createSellerDocumentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage,
      mode: "fixture",
      policy: {
        accountScope: "fixture",
        maxBytes: 1000000,
        accessTtlSeconds: 60,
        recoveryLeaseSeconds: 60,
      },
    });
    const catalog = await documents.saveIssuer(op, {
      expectedVersion: 0,
      configuration: fixtureIssuer,
      note: "Fixture issuer",
    });
    await documents.decideIssuer(op, {
      revisionId: catalog.revisions[0].id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Fixture approval",
    });
    const invoice = await documents.issue(f.owner, f.business.id, {
      periodId: period.id,
      requestKey: randomUUID(),
    });
    const compose = () =>
      createFinancialAdjustmentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createFinancialAdjustmentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredFinancialAdjustments(native.configuration),
        documents,
      });
    const input = (netMinor = "1000") => ({
      kind: "refund",
      invoiceId: invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor }],
      reason: "Approved partial service credit",
      evidence: ["fixture:private-reviewed-request"],
    });
    return {
      ...f,
      native,
      payments,
      period,
      invoice,
      documents,
      storage,
      op,
      compose,
      input,
    };
  }
  it("classifies a refunds-only operator as privileged and requires current MFA", async () => {
    const op = await h.signIn("refund-review@example.com", false);
    const actor = await h.authenticate(op);
    await h.admin.query(
      "insert into platform_operator(user_id,refunds) values($1,true)",
      [actor.userId],
    );
    expect(await h.access.status(op)).toMatchObject({
      operator: true,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(h.authenticate(op)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
  });
  it("requires refund authority independently of reconciliation and document privileges", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    const app = createFinancialAdjustmentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createFinancialAdjustmentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: configuredFinancialAdjustments(native.configuration),
      documents: null,
    });
    await expect(
      app.workspace(f.operator, f.business.id, true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app.review(f.owner, f.business.id, {
        kind: "refund",
        invoiceId: randomUUID(),
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "100" }],
        reason: "Review",
        evidence: ["fixture:review"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const only = await h.signIn("refunds-only@example.com"),
      actor = await h.authenticate(only);
    await h.admin.query(
      "insert into platform_operator(user_id,refunds) values($1,true)",
      [actor.userId],
    );
    await expect(
      h.team.requirePlatformCapability(only, "refunds.manage"),
    ).resolves.toBeDefined();
    await expect(
      h.team.requirePlatformCapability(only, "documents.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("processes a native partial refund, original-tax credit and configured operational access once across restart", async () => {
    const f = await purchase(),
      app = f.compose(),
      request = f.input();
    const reviewed = await app.review(f.op, f.business.id, request);
    expect(reviewed).toMatchObject({
      kind: "refund",
      amountMinor: "1100",
      state: "reviewed",
      creditDocumentId: null,
    });
    expect(await app.review(f.op, f.business.id, request)).toEqual(reviewed);
    const started = await app.execute(f.op, f.business.id, {
      caseId: reviewed.id,
    });
    expect(started).toMatchObject({ state: "pending", creditDocumentId: null });
    expect(f.native.refundPosts).toHaveLength(1);
    f.native.refunds[0].status = "processed";
    await f.compose().recover();
    const result = await f
      .compose()
      .credit(f.op, f.business.id, { caseId: reviewed.id });
    expect(result).toMatchObject({
      state: "processed",
      creditDocumentId: expect.any(String),
      access: "block_period",
    });
    await f.compose().execute(f.op, f.business.id, { caseId: reviewed.id });
    await f.compose().credit(f.op, f.business.id, { caseId: reviewed.id });
    expect(f.native.refundPosts).toHaveLength(1);
    const docs = await f.documents.workspace(f.owner, f.business.id);
    expect(docs.documents).toHaveLength(2);
    expect(docs.documents.find((d) => d.kind === "invoice")?.snapshot).toEqual(
      f.invoice.snapshot,
    );
    expect(
      docs.documents.find((d) => d.kind === "credit_note")?.snapshot.totals,
    ).toEqual({ netMinor: "1000", taxMinor: "100", totalMinor: "1100" });
    expect(JSON.stringify(docs)).not.toContain("private-reviewed-request");
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(false);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.period]);
    const customer = await app.workspace(f.owner, f.business.id);
    expect(JSON.stringify(customer)).not.toContain("private-reviewed-request");
    expect(customer.cases[0].notices.at(-1)).toMatchObject({
      channel: "in_app",
      status: "available",
    });
  });
  it("applies full-refund policy on the cumulative last partial and reserves concurrent partials", async () => {
    const f = await purchase();
    const p = JSON.parse(
      f.native.configuration.env.FINANCIAL_ADJUSTMENT_POLICY,
    );
    p.partialRefundAccess = "preserve";
    f.native.configuration.env.FINANCIAL_ADJUSTMENT_POLICY = JSON.stringify(p);
    const app = f.compose(),
      first = await app.review(f.op, f.business.id, f.input("1000"));
    const last = await app.review(f.op, f.business.id, f.input("9005"));
    expect(last.amountMinor).toBe("9906");
    await expect(
      app.review(f.op, f.business.id, f.input("1")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await app.execute(f.op, f.business.id, { caseId: first.id });
    f.native.refunds[0].status = "processed";
    await app.refresh(f.op, f.business.id, { caseId: first.id });
    await app.credit(f.op, f.business.id, { caseId: first.id });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(true);
    await app.execute(f.op, f.business.id, { caseId: last.id });
    f.native.refunds[1].status = "processed";
    const result = await app.refresh(f.op, f.business.id, { caseId: last.id });
    expect(result.access).toBe("block_period");
    await app.credit(f.op, f.business.id, { caseId: last.id });
    const docs = (
      await f.documents.workspace(f.owner, f.business.id)
    ).documents.filter((d) => d.kind === "credit_note");
    expect(docs.map((d) => d.snapshot.totals.taxMinor).sort()).toEqual([
      "100",
      "901",
    ]);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(false);
  });
  it("recovers an unknown refund on its original identity after authority loss without another money request", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    const actor = await h.authenticate(f.op);
    f.native.loseRefund = true;
    f.native.afterPost = async () => {
      await h.admin.query(
        "update platform_operator set refunds=false where user_id=$1",
        [actor.userId],
      );
    };
    await expect(
      app.execute(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.native.refundPosts).toHaveLength(1);
    f.native.refunds[0].status = "processed";
    expect(await f.compose().recover()).toEqual({ attempted: 1, failed: 0 });
    await h.admin.query(
      "update platform_operator set refunds=true where user_id=$1",
      [actor.userId],
    );
    const result = await f
      .compose()
      .execute(f.op, f.business.id, { caseId: c.id });
    expect(result.state).toBe("processed");
    expect(f.native.refundPosts).toHaveLength(1);
    expect(f.native.refundPosts[0]).toMatchObject({
      key: c.id,
      body: {
        amount: 1100,
        speed: "normal",
        receipt: c.id,
        notes: { financial_case: c.id },
      },
    });
    await h.admin.query(
      "update platform_operator set documents=false where user_id=$1",
      [actor.userId],
    );
    await expect(
      app.credit(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0],
    ).toMatchObject({ state: "processed", creditDocumentId: null });
    await h.admin.query(
      "update platform_operator set documents=true where user_id=$1",
      [actor.userId],
    );
    expect(
      (await app.credit(f.op, f.business.id, { caseId: c.id }))
        .creditDocumentId,
    ).not.toBeNull();
  });
  it("keeps dispute draft, submission and authoritative loss distinct and recovers the actual deduction", async () => {
    const f = await purchase(),
      app = f.compose();
    f.native.disputes.set("disp_fixture1", {
      id: "disp_fixture1",
      entity: "dispute",
      payment_id: "pay_original",
      amount: 1100,
      currency: "INR",
      amount_deducted: 0,
      status: "open",
      phase: "chargeback",
      reason_code: "chargeback",
      respond_by: Math.floor(new Date("2026-11-06T09:00:00Z").getTime() / 1000),
      created_at: Math.floor(h.clock.now().getTime() / 1000),
      evidence: { submitted_at: null },
    });
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: "disp_fixture1",
    });
    expect(
      (await app.refresh(f.op, f.business.id, { caseId: c.id })).state,
    ).toBe("open");
    f.native.documents.set(
      "doc_fixture1",
      new TextEncoder().encode("%PDF-1.7\nSynthetic evidence"),
    );
    const evidence = {
      category: "proof_of_service",
      documentId: "doc_fixture1",
      sha256:
        "60b0f361d572ecc4b6af97287052c04f92354e35b025083a3865dbed5c9d0784c",
    };
    evidence.sha256 = (await import("node:crypto"))
      .createHash("sha256")
      .update(f.native.documents.get("doc_fixture1")!)
      .digest("hex");
    const draft = {
      caseId: c.id,
      requestKey: randomUUID(),
      action: "draft",
      summary: "Service evidence reviewed",
      documents: [evidence],
    };
    const d = await app.dispute(f.op, f.business.id, draft);
    expect(d.state).toBe("open");
    expect(d.observation?.submittedAt).toBeNull();
    f.native.loseDispute = true;
    await app.dispute(f.op, f.business.id, {
      ...draft,
      requestKey: randomUUID(),
      action: "submit",
    });
    await f.compose().recover();
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0],
    ).toMatchObject({ state: "under_review", creditDocumentId: null });
    await expect(
      app.credit(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    f.native.disputes.get("disp_fixture1")!.status = "lost";
    f.native.disputes.get("disp_fixture1")!.amount_deducted = 1100;
    await f.compose().recover();
    expect(
      (await app.credit(f.op, f.business.id, { caseId: c.id })).state,
    ).toBe("lost");
    await expect(app.financialFeed(f.op)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const actor = await h.authenticate(f.op);
    await h.admin.query(
      "update platform_operator set reconciliation=true where user_id=$1",
      [actor.userId],
    );
    expect(await app.financialFeed(f.op)).toMatchObject([
      {
        effect: {
          source: "dispute",
          actualMinor: "1100",
          bankSettlementConfirmed: false,
        },
      },
    ]);
    const bank = createReconciliationApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
    const report = await bank.workspace(f.op, {
      from: "2026-11-01T00:00:00.000Z",
      until: "2026-12-01T00:00:00.000Z",
    });
    expect(report.expected).toMatchObject([
      {
        grossMinor: "11006",
        refundCashMinor: "0",
        disputeDeductionMinor: "1100",
        creditGrossMinor: "1100",
        creditTaxMinor: "100",
      },
    ]);
    expect(report.sources[0].effects[0]).toMatchObject({
      source: "dispute",
      actualMinor: "1100",
      nativeId: "disp_fixture1",
    });
    expect(report.settlements).toHaveLength(0);
  });
  it("durably authenticates native receipts before deferred reconciliation and rejects conflicting duplicate identities", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_fixture",
        event: "refund.processed",
        payload: { refund: { entity: f.native.refunds[0] } },
      }),
    );
    const headers = new Headers({
      "x-razorpay-event-id": "evt_refund1",
      "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
        .update(body)
        .digest("hex"),
    });
    await expect(
      app.event({
        body,
        headers: new Headers({
          "x-razorpay-event-id": "evt_refund1",
          "x-razorpay-signature": "invalid",
        }),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await app.event({ body, headers })).toEqual({
      received: true,
      duplicate: false,
    });
    expect(await f.compose().event({ body, headers })).toEqual({
      received: true,
      duplicate: true,
    });
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0].state,
    ).toBe("pending");
    await f.compose().recover();
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0].state,
    ).toBe("processed");
    const conflicting = new TextEncoder().encode(
      new TextDecoder()
        .decode(body)
        .replace("refund.processed", "refund.failed"),
    );
    const other = new Headers(headers);
    other.set(
      "x-razorpay-signature",
      createHmac("sha256", "fixture-webhook-secret")
        .update(conflicting)
        .digest("hex"),
    );
    await expect(
      app.event({ body: conflicting, headers: other }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    f.native.refunds[0].status = "pending";
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    expect((await app.workspace(f.owner, f.business.id)).cases[0].state).toBe(
      "processed",
    );
  });
  it("serializes concurrent native partials and keeps an unresolved refund reserved until failure is authoritative", async () => {
    const f = await purchase(),
      app = f.compose();
    const a = await app.review(f.op, f.business.id, f.input("4000")),
      b = await app.review(f.op, f.business.id, f.input("4000"));
    const results = await Promise.allSettled([
      app.execute(f.op, f.business.id, { caseId: a.id }),
      app.execute(f.op, f.business.id, { caseId: b.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.native.refundPosts).toHaveLength(1);
    f.native.refunds[0].status = "failed";
    await app.recover();
    const state = await app.workspace(f.op, f.business.id, true),
      remaining = state.cases.find((c) => !c.started)!;
    await app.execute(f.op, f.business.id, { caseId: remaining.id });
    expect(f.native.refundPosts).toHaveLength(2);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(true);
  });
  it("withdraws only an unexecuted review and preserves protected review evidence", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input("10005"));
    const details = await app.details(f.op, f.business.id, { caseId: c.id });
    expect(details.input.evidence).toEqual([
      "fixture:private-reviewed-request",
    ]);
    await expect(
      app.details(f.owner, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await app.withdraw(f.op, f.business.id, { caseId: c.id })).state,
    ).toBe("withdrawn");
    await expect(
      app.execute(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await app.review(f.op, f.business.id, f.input("10005"));
    await app.execute(f.op, f.business.id, { caseId: next.id });
    await expect(
      app.withdraw(f.op, f.business.id, { caseId: next.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("validates the same-origin operator HTTP command and keeps public errors safe", async () => {
    const f = await purchase(),
      app = f.compose(),
      http = createFinancialAdjustmentHttp({
        application: app,
        origin: "http://localhost:3000",
        reportFailure: () => {},
      });
    const request = (value: unknown, origin = "http://localhost:3000") =>
      new Request(
        "http://localhost:3000/api/platform/financial-adjustments/review",
        {
          method: "POST",
          headers: new Headers({
            ...Object.fromEntries(f.op),
            origin,
            "content-type": "application/json",
          }),
          body: JSON.stringify(value),
        },
      );
    expect(
      (
        await http.command(
          request(f.input(), "https://foreign.example"),
          f.business.id,
          "review",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.command(
          request({ ...f.input(), providerSecret: "private" }),
          f.business.id,
          "review",
        )
      ).status,
    ).toBe(400);
    expect(
      (await http.command(request(f.input()), f.business.id, "review")).status,
    ).toBe(200);
    expect(
      (await http.command(request({}), f.business.id, "unapprovedAction"))
        .status,
    ).toBe(400);
    const event = await http.event(
      new Request("http://localhost:3000/api/webhooks/razorpay-adjustments", {
        method: "POST",
        body: "sensitive-provider-credentials",
      }),
    );
    expect(event.status).toBe(403);
    expect(await event.text()).not.toContain("sensitive-provider");
  });
  it("rechecks current MFA immediately before native money I/O and safely resumes a proven unattempted intent", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    let reads = 0;
    f.native.onPaymentRead = async () => {
      if (++reads === 2) h.clock.set("2026-11-05T09:16:00Z");
    };
    await expect(
      app.execute(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.native.refundPosts).toHaveLength(0);
    await h.reverifyAuthenticator(f.op);
    await app.execute(f.op, f.business.id, { caseId: c.id });
    expect(f.native.refundPosts).toHaveLength(1);
    expect(f.native.refundPosts[0].key).toBe(c.id);
  });
  it("preserves populated original facts and runtime security through managed schema reapplication", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    await app.credit(f.op, f.business.id, { caseId: c.id });
    const before = await app.workspace(f.op, f.business.id, true),
      docs = await f.documents.workspace(f.owner, f.business.id);
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(await app.workspace(f.op, f.business.id, true)).toEqual(before);
    expect(await f.documents.workspace(f.owner, f.business.id)).toEqual(docs);
    expect(
      (await h.runtime.query("select * from financial_case")).rows,
    ).toEqual([]);
    expect(
      (
        await h.runtime.query(
          "select public.financial_public($1::uuid) as result",
          [f.business.id],
        )
      ).rows[0].result,
    ).toBeNull();
    await expect(
      h.runtime.query("update financial_case set intent='{}'::jsonb"),
    ).rejects.toBeDefined();
    await expect(
      h.runtime.query("delete from financial_case_event"),
    ).rejects.toBeDefined();
  });
  it.each(["refund", "dispute"] as const)(
    "stops a %s when the reviewed merchant account expires during final preflight",
    async (kind) => {
      const f = await purchase();
      const review = JSON.parse(
        f.native.configuration.env.RAZORPAY_ACCOUNT_REVIEW,
      );
      review.effectiveUntil = "2026-11-05T09:01:00.000Z";
      f.native.configuration.env.RAZORPAY_ACCOUNT_REVIEW =
        JSON.stringify(review);
      const app = f.compose();
      const disputeId = "disp_accountExpiry";
      f.native.disputes.set(disputeId, {
        id: disputeId,
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-06T09:00:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      });
      const c = await app.review(f.op, f.business.id, {
        ...f.input(),
        kind,
        ...(kind === "dispute" ? { disputeId } : {}),
      });
      let reads = 0;
      f.native.onPaymentRead = async () => {
        if (++reads === 2) h.clock.set(review.effectiveUntil);
      };
      const result =
        kind === "refund"
          ? await app.execute(f.op, f.business.id, { caseId: c.id })
          : await app.dispute(f.op, f.business.id, {
              caseId: c.id,
              requestKey: randomUUID(),
              action: "accept",
            });
      expect(f.native.refundPosts).toHaveLength(0);
      expect(f.native.disputePosts).toHaveLength(0);
      expect(result).toMatchObject({ state: "reviewed", started: false });
      if (kind === "dispute")
        expect(result.actions).toEqual([
          expect.objectContaining({ action: "accept", state: "not_attempted" }),
        ]);
      expect(
        (await f.payments.workspace(f.owner, f.business.id)).access.active,
      ).toBe(true);
    },
  );
  it.each(["review", "credit review", "dispute action"] as const)(
    "binds an exact %s replay to its original requesting operator",
    async (command) => {
      const f = await purchase(),
        app = f.compose(),
        colleague = await h.signIn("other-refund-operator@example.com"),
        actor = await h.authenticate(colleague);
      await h.admin.query(
        "insert into platform_operator(user_id,refunds,documents) values($1,true,true)",
        [actor.userId],
      );
      if (command === "review") {
        const input = f.input(),
          original = await app.review(f.op, f.business.id, input);
        await expect(
          app.review(colleague, f.business.id, input),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await app.review(f.op, f.business.id, input)).toEqual(original);
        expect(
          await app.execute(colleague, f.business.id, { caseId: original.id }),
        ).toMatchObject({ state: "pending" });
        expect(f.native.refundPosts).toHaveLength(1);
        return;
      }
      if (command === "credit review") {
        const c = await app.review(f.op, f.business.id, f.input());
        await app.execute(f.op, f.business.id, { caseId: c.id });
        f.native.refunds[0].status = "processed";
        await app.refresh(f.op, f.business.id, { caseId: c.id });
        const input = {
          caseId: c.id,
          requestKey: randomUUID(),
          lines: [{ lineId: "subscription", netMinor: "1000" }],
          reason: "Approved original-tax credit basis",
          evidence: ["fixture:credit-approval"],
        };
        const original = await app.reviewCredit(f.op, f.business.id, input);
        await expect(
          app.reviewCredit(colleague, f.business.id, input),
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await app.reviewCredit(f.op, f.business.id, input)).toEqual(
          original,
        );
        expect(f.native.refundPosts).toHaveLength(1);
        return;
      }
      const disputeId = "disp_actorBinding";
      f.native.disputes.set(disputeId, {
        id: disputeId,
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-06T09:00:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      });
      const c = await app.review(f.op, f.business.id, {
        ...f.input(),
        kind: "dispute",
        disputeId,
      });
      const input = {
        caseId: c.id,
        requestKey: randomUUID(),
        action: "draft",
        summary: "Reviewed service evidence draft",
      };
      const original = await app.dispute(f.op, f.business.id, input);
      await expect(
        app.dispute(colleague, f.business.id, input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await app.dispute(f.op, f.business.id, input)).toEqual(original);
      expect(f.native.disputePosts).toHaveLength(1);
    },
  );
  it.each(
    ["financial_case", "financial_case_event", "financial_receipt"].flatMap(
      (table) =>
        ["SELECT", "INSERT"].map((privilege) => ({ table, privilege })),
    ),
  )(
    "requires $privilege independently on $table",
    async ({ table, privilege }) => {
      await h.admin.query(`revoke ${privilege} on ${table} from app_runtime`);
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
      await verifyRuntimeRole(h.runtime);
    },
  );
  it.each([
    "financial_credit_allowed(jsonb)",
    "financial_capture_receipt(jsonb)",
    "financial_receipt_work(text,text)",
    "financial_adjustments_feed()",
    "financial_refunded(uuid,uuid)",
    "financial_worker_authorized(uuid,uuid)",
    "financial_pending(text,text)",
    "financial_reserved(uuid,uuid)",
    "financial_public(uuid)",
  ])("requires the restricted financial helper %s", async (signature) => {
    await h.admin.query(
      `revoke execute on function public.${signature} from app_runtime`,
    );
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await secureDatabase(h.admin);
    }
    await verifyRuntimeRole(h.runtime);
  });
  it("accepts a signed action-required reopening, then restores only the existing paid scope on a win", async () => {
    const f = await purchase(),
      app = f.compose(),
      d = {
        id: "disp_reopen",
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "under_review",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-06T09:00:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: Math.floor(h.clock.now().getTime() / 1000) },
      };
    f.native.disputes.set(d.id, d);
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: d.id,
    });
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(false);
    d.status = "open";
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0].state,
    ).toBe("under_review");
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_fixture",
        event: "payment.dispute.action_required",
        payload: { dispute: { entity: d } },
      }),
    );
    await app.event({
      body,
      headers: new Headers({
        "x-razorpay-event-id": "evt_action_required",
        "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
          .update(body)
          .digest("hex"),
      }),
    });
    await app.recover();
    expect((await app.workspace(f.owner, f.business.id)).cases[0].state).toBe(
      "open",
    );
    d.status = "won";
    await app.recover();
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).access.active,
    ).toBe(true);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.period]);
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
  });
  it("fences a native reservation from a forged manual credit using its adjustment identity", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    await expect(
      f.documents.adjust(f.op, f.business.id, {
        invoiceId: f.invoice.id,
        periodId: f.period.id,
        paymentId: f.period.paymentId,
        requestKey: randomUUID(),
        adjustmentId: c.id,
        source: { kind: "manual", reference: "fixture:unrelated" },
        reason: "Unrelated correction",
        evidence: ["fixture:other"],
        lines: [{ lineId: "subscription", netMinor: "1000" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
  });
  it("stops already queued discovery at the real paid-scope consumer after a processed refund", async () => {
    const f = await purchase(),
      r = await financialResearch(h, f),
      app = f.compose();
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual(["Pune"]);
    await r.app.start(f.owner, f.business.id, r.request());
    const c = await app.review(f.op, f.business.id, f.input());
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    await app.recover();
    await r.app.execute(r.queued[0]);
    expect(r.searches).toHaveLength(0);
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual([]);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.period]);
  });
  it("keeps a saved native outcome recoverable after policy withdrawal and rejects policy identity rebinding", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    const policy = JSON.parse(
      f.native.configuration.env.FINANCIAL_ADJUSTMENT_POLICY,
    );
    policy.partialRefundAccess = "preserve";
    f.native.configuration.env.FINANCIAL_ADJUSTMENT_POLICY =
      JSON.stringify(policy);
    await expect(
      f.compose().review(f.op, f.business.id, f.input("1")),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    f.native.configuration.env.FINANCIAL_ADJUSTMENT_POLICY = "";
    expect((await f.compose().workspace(f.op, f.business.id, true)).ready).toBe(
      false,
    );
    await expect(
      f.compose().review(f.op, f.business.id, f.input("1")),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await f.compose().recover();
    expect(
      (await f.compose().credit(f.op, f.business.id, { caseId: c.id })).state,
    ).toBe("processed");
  });
  it("resumes a paged original-refund lookup and never treats an absent page as permission to send again", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    f.native.loseRefund = true;
    await app.execute(f.op, f.business.id, { caseId: c.id });
    const original = f.native.refunds.pop()!;
    for (let i = 0; i < 100; i++)
      f.native.refunds.push({
        ...original,
        id: `rfnd_other${i}`,
        receipt: `unrelated-${i}`,
        notes: {},
        status: "processed",
      });
    f.native.refunds.push({ ...original, status: "processed" });
    await f.compose().recover();
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0].state,
    ).toBe("unknown");
    await f.compose().recover();
    expect(
      (await app.workspace(f.op, f.business.id, true)).cases[0].state,
    ).toBe("processed");
    expect(f.native.refundPosts).toHaveLength(1);
  });
  it("accepts a native dispute once after a lost acknowledgement without inventing dispute idempotency", async () => {
    const f = await purchase(),
      app = f.compose(),
      d = {
        id: "disp_accept",
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-06T09:00:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      };
    f.native.disputes.set(d.id, d);
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: d.id,
    });
    f.native.loseDispute = true;
    const request = {
      caseId: c.id,
      requestKey: randomUUID(),
      action: "accept",
    };
    await app.dispute(f.op, f.business.id, request);
    await app.recover();
    const result = await f.compose().dispute(f.op, f.business.id, request);
    expect(result).toMatchObject({
      state: "lost",
      actions: [{ action: "accept", state: "confirmed" }],
    });
    expect(f.native.disputePosts).toEqual([
      {
        path: "/v1/disputes/disp_accept/accept",
        method: "POST",
        body: null,
        idempotency: null,
      },
    ]);
    await app.credit(f.op, f.business.id, { caseId: c.id });
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(2);
  });
  it("verifies selected merchant document content, submission requirements and the exact dispute deadline", async () => {
    const f = await purchase(),
      app = f.compose(),
      d = {
        id: "disp_evidence",
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-05T09:10:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      };
    f.native.disputes.set(d.id, d);
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: d.id,
    });
    f.native.documents.set(
      "doc_test",
      new TextEncoder().encode("%PDF-1.7\nExact private evidence"),
    );
    const input = {
      caseId: c.id,
      requestKey: randomUUID(),
      action: "submit",
      summary: "Reviewed",
      documents: [
        {
          category: "proof_of_service",
          documentId: "doc_test",
          sha256: "0".repeat(64),
        },
      ],
    };
    await expect(app.dispute(f.op, f.business.id, input)).rejects.toMatchObject(
      { code: "INVALID_PROVIDER_RESPONSE" },
    );
    await expect(
      app.dispute(f.op, f.business.id, { ...input, documents: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      app.dispute(f.op, f.business.id, {
        ...input,
        documents: [
          {
            ...input.documents[0],
            documentId: "https://foreign.example/proof",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    h.clock.set("2026-11-05T09:10:00Z");
    await expect(
      app.dispute(f.op, f.business.id, {
        caseId: c.id,
        requestKey: randomUUID(),
        action: "accept",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.native.disputePosts).toHaveLength(0);
  });
  it("validates the saved native customer, invoice, order, amount, currency and remaining refund cap", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input("10005")),
      payment = f.native.payments.get("pay_original")!,
      original = { ...payment };
    for (const [key, value] of [
      ["customer_id", "cust_foreign"],
      ["invoice_id", "inv_foreign"],
      ["order_id", "order_foreign"],
      ["currency", "USD"],
      ["amount", 11007],
    ] as const) {
      payment[key] = value;
      await expect(
        app.execute(f.op, f.business.id, { caseId: c.id }),
      ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
      Object.assign(payment, original);
    }
    payment.amount_refunded = 1;
    await expect(
      app.execute(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.native.refundPosts).toHaveLength(0);
  });
  it("retains a completed native effect through credit-artifact failure and recovers the same numbered document", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    await app.recover();
    f.storage.failPut = true;
    const result = await app.credit(f.op, f.business.id, { caseId: c.id });
    expect(result).toMatchObject({
      state: "processed",
      creditState: "issued",
      creditDocumentId: expect.any(String),
    });
    const credit = (
      await f.documents.workspace(f.owner, f.business.id)
    ).documents.find((d) => d.kind === "credit_note")!;
    expect(credit.artifact.state).toBe("failed");
    f.storage.failPut = false;
    await f.documents.recover(
      f.op,
      f.business.id,
      { documentId: credit.id },
      true,
    );
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents.find(
        (d) => d.id === credit.id,
      ),
    ).toMatchObject({ number: credit.number, artifact: { state: "ready" } });
    expect(f.native.refundPosts).toHaveLength(1);
  });
  it("keeps actual partial dispute deductions visible for tax-credit review without fabricating a full refund", async () => {
    const f = await purchase(),
      app = f.compose(),
      d = {
        id: "disp_deduction",
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 500,
        status: "lost",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(h.clock.now().getTime() / 1000),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      };
    f.native.disputes.set(d.id, d);
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: d.id,
    });
    expect(
      await app.refresh(f.op, f.business.id, { caseId: c.id }),
    ).toMatchObject({
      state: "lost",
      creditState: "review_required",
      observation: { deductedMinor: "500" },
    });
    await expect(
      app.credit(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.native.refundPosts).toHaveLength(0);
    const actor = await h.authenticate(f.op);
    await h.admin.query(
      "update platform_operator set reconciliation=true where user_id=$1",
      [actor.userId],
    );
    expect(await app.financialFeed(f.op)).toMatchObject([
      { effect: { source: "dispute", actualMinor: "500" } },
    ]);
    const review = {
      caseId: c.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "454" }],
      reason:
        "Approved original-tax credit basis; residual minor unit retained for reconciliation",
      evidence: ["fixture:explicit-credit-allocation-review"],
    };
    expect(await app.reviewCredit(f.op, f.business.id, review)).toMatchObject({
      creditState: "pending",
      creditAmountMinor: "499",
    });
    await app.reviewCredit(f.op, f.business.id, review);
    const completed = await app.credit(f.op, f.business.id, { caseId: c.id });
    expect(completed).toMatchObject({
      state: "lost",
      creditState: "issued",
      creditAmountMinor: "499",
    });
    const doc = (
      await f.documents.workspace(f.owner, f.business.id)
    ).documents.find((d) => d.kind === "credit_note")!;
    expect(doc.snapshot.totals).toEqual({
      netMinor: "454",
      taxMinor: "45",
      totalMinor: "499",
    });
    expect(await app.financialFeed(f.op)).toMatchObject([
      {
        effect: { actualMinor: "500" },
        approvedCredit: {
          allocation: { totals: { totalMinor: "499" } },
          uncreditedDifferenceMinor: "1",
        },
      },
    ]);
    await expect(
      app.reviewCredit(f.op, f.business.id, {
        ...review,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "453" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const excess = await app.review(f.op, f.business.id, f.input("9551"));
    await expect(
      app.execute(f.op, f.business.id, { caseId: excess.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.native.refundPosts).toHaveLength(0);
  });
  it("retains the first durable deduction and flags conflicting later native financial evidence for review", async () => {
    const f = await purchase(),
      app = f.compose(),
      d = {
        id: "disp_conflict",
        entity: "dispute",
        payment_id: "pay_original",
        amount: 1100,
        currency: "INR",
        amount_deducted: 1100,
        status: "lost",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(h.clock.now().getTime() / 1000),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      };
    f.native.disputes.set(d.id, d);
    const c = await app.review(f.op, f.business.id, {
      ...f.input(),
      kind: "dispute",
      disputeId: d.id,
    });
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    d.amount_deducted = 500;
    const current = await app.refresh(f.op, f.business.id, { caseId: c.id });
    expect(current).toMatchObject({
      reviewRequired: true,
      observation: { deductedMinor: "1100" },
    });
    await expect(
      app.credit(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    d.amount_deducted = 1100;
    expect(
      await app.refresh(f.op, f.business.id, { caseId: c.id }),
    ).toMatchObject({
      reviewRequired: false,
      observation: { deductedMinor: "1100" },
    });
  });
  it("denies foreign Business reads, foreign invoice commands and post-I/O revoked reconciliation disclosure", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    const otherOwner = await h.signIn("foreign-financial-owner@example.com"),
      other = await h.application.createBusiness(otherOwner, {
        name: "Other Business",
        offering: "Other",
        homeMarket: "Other",
        website: "",
      });
    await expect(
      app.workspace(otherOwner, f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.review(f.op, other.id, f.input())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      app.refresh(f.op, other.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await app.execute(f.op, f.business.id, { caseId: c.id });
    const actor = await h.authenticate(f.op);
    f.native.onPaymentRead = async () => {
      await h.admin.query(
        "update platform_operator set refunds=false where user_id=$1",
        [actor.userId],
      );
    };
    await expect(
      app.refresh(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.native.refundPosts).toHaveLength(1);
  });
  it("requires a fresh credit basis before numbering when an earlier withdrawn reservation changes original-tax rounding", async () => {
    const f = await purchase(),
      app = f.compose(),
      earlier = await app.review(f.op, f.business.id, f.input("5")),
      later = await app.review(f.op, f.business.id, f.input("5"));
    expect(earlier.amountMinor).toBe("6");
    expect(later.amountMinor).toBe("5");
    await app.withdraw(f.op, f.business.id, { caseId: earlier.id });
    await app.execute(f.op, f.business.id, { caseId: later.id });
    f.native.refunds[0].status = "processed";
    await app.refresh(f.op, f.business.id, { caseId: later.id });
    await expect(
      app.credit(f.op, f.business.id, { caseId: later.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
    expect(await app.financialFeed(f.operator)).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({ actualMinor: "5" }),
      }),
    ]);
    await app.reviewCredit(f.op, f.business.id, {
      caseId: later.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "4" }],
      reason: "Review the changed original tax rounding after withdrawal",
      evidence: ["fixture:reviewed-one-subunit-uncredited-difference"],
    });
    await app.credit(f.op, f.business.id, { caseId: later.id });
    const note = (
      await f.documents.workspace(f.owner, f.business.id)
    ).documents.find((d) => d.kind === "credit_note");
    expect(note).toMatchObject({
      number: "TEST-C-0001",
      snapshot: { totals: { netMinor: "4", taxMinor: "0", totalMinor: "4" } },
    });
    expect(await app.financialFeed(f.operator)).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({ actualMinor: "5" }),
        approvedCredit: expect.objectContaining({
          actualMinor: "5",
          uncreditedDifferenceMinor: "1",
        }),
      }),
    ]);
    expect(f.native.refundPosts).toHaveLength(1);
  });
  it("reviews a credit against its actual earlier allocation while retaining a later native refund and its residual", async () => {
    const f = await purchase(),
      app = f.compose(),
      earlier = await app.review(f.op, f.business.id, f.input("5")),
      later = await app.review(f.op, f.business.id, f.input("5"));
    await app.execute(f.op, f.business.id, { caseId: earlier.id });
    f.native.refunds[0].status = "processed";
    await app.refresh(f.op, f.business.id, { caseId: earlier.id });
    const basis = await app.reviewCredit(f.op, f.business.id, {
      caseId: earlier.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "4" }],
      reason: "Approve the first credit before the later reservation",
      evidence: ["fixture:earlier-credit-with-explicit-residual"],
    });
    expect(basis.creditAmountMinor).toBe("4");
    await app.credit(f.op, f.business.id, { caseId: earlier.id });
    await app.execute(f.op, f.business.id, { caseId: later.id });
    f.native.refunds[1].status = "processed";
    await app.refresh(f.op, f.business.id, { caseId: later.id });
    await expect(
      app.credit(f.op, f.business.id, { caseId: later.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.documents.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(2);
    await app.reviewCredit(f.op, f.business.id, {
      caseId: later.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "4" }],
      reason: "Review the later credit against the issued original components",
      evidence: ["fixture:later-original-component-review"],
    });
    await app.credit(f.op, f.business.id, { caseId: later.id });
    const notes = (
      await f.documents.workspace(f.owner, f.business.id)
    ).documents
      .filter((d) => d.kind === "credit_note")
      .sort((a, b) => a.number.localeCompare(b.number));
    expect(
      notes.map((d) => ({ number: d.number, totals: d.snapshot.totals })),
    ).toEqual([
      {
        number: "TEST-C-0001",
        totals: { netMinor: "4", taxMinor: "0", totalMinor: "4" },
      },
      {
        number: "TEST-C-0002",
        totals: { netMinor: "4", taxMinor: "1", totalMinor: "5" },
      },
    ]);
    expect(await app.financialFeed(f.operator)).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({ actualMinor: "6" }),
        approvedCredit: expect.objectContaining({
          uncreditedDifferenceMinor: "2",
        }),
      }),
      expect.objectContaining({
        effect: expect.objectContaining({ actualMinor: "5" }),
        approvedCredit: expect.objectContaining({
          uncreditedDifferenceMinor: "0",
        }),
      }),
    ]);
    expect(f.native.refundPosts).toHaveLength(2);
  });
  it("binds a native dispute claim separately from its original-tax credit allocation and retains the actual residual", async () => {
    const f = await purchase(),
      app = f.compose(),
      disputeId = "disp_separateClaim",
      native = {
        id: disputeId,
        entity: "dispute",
        payment_id: "pay_original",
        amount: 500,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: Math.floor(
          new Date("2026-11-06T09:00:00Z").getTime() / 1000,
        ),
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      };
    f.native.disputes.set(disputeId, native);
    const input = {
      ...f.input("454"),
      kind: "dispute",
      disputeId,
      disputeAmountMinor: "500",
    };
    const c = await app.review(f.op, f.business.id, input);
    expect(c).toMatchObject({ amountMinor: "500", creditAmountMinor: "499" });
    await expect(
      app.review(f.op, f.business.id, {
        ...input,
        requestKey: randomUUID(),
        disputeId: "disp_excessClaim",
        disputeAmountMinor: "11007",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.review(f.op, f.business.id, { ...input, disputeAmountMinor: "501" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    native.amount = 501;
    await expect(
      app.refresh(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(f.native.disputePosts).toHaveLength(0);
    native.amount = 500;
    await app.refresh(f.op, f.business.id, { caseId: c.id });
    const result = await app.dispute(f.op, f.business.id, {
      caseId: c.id,
      requestKey: randomUUID(),
      action: "accept",
    });
    expect(result).toMatchObject({
      amountMinor: "500",
      creditState: "review_required",
      observation: { amountMinor: "500", deductedMinor: "500", status: "lost" },
    });
    await expect(
      app.credit(f.op, f.business.id, { caseId: c.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await app.reviewCredit(f.op, f.business.id, {
      caseId: c.id,
      requestKey: randomUUID(),
      lines: input.lines,
      reason: "Approve original-tax credit499 against actual native claim500",
      evidence: ["fixture:explicit-native-claim-residual-review"],
    });
    await app.credit(f.op, f.business.id, { caseId: c.id });
    expect(await app.financialFeed(f.operator)).toEqual([
      expect.objectContaining({
        effect: expect.objectContaining({
          actualMinor: "500",
          bankSettlementConfirmed: false,
        }),
        approvedCredit: expect.objectContaining({
          uncreditedDifferenceMinor: "1",
        }),
      }),
    ]);
    expect(
      (await app.workspace(f.owner, f.business.id)).cases[0],
    ).toMatchObject({
      amountMinor: "500",
      creditAmountMinor: "499",
      creditState: "issued",
    });
    expect(f.native.disputePosts).toHaveLength(1);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.period]);
  });
  it("composes actual opt-in customer financial emails through the final notification seam without repeating money", async () => {
    const f = await purchase(),
      app = f.compose(),
      c = await app.review(f.op, f.business.id, f.input());
    await app.execute(f.op, f.business.id, { caseId: c.id });
    f.native.refunds[0].status = "processed";
    await app.recover();
    const notifications = await financialNotifications(h),
      owner = await h.signIn("tax-owner@example.com");
    await notifications.app.recoverPending();
    expect(notifications.effects).toHaveLength(0);
    await notifications.app.setPreference(owner, f.business.id, {
      purpose: "subscription",
      enabled: true,
      expectedVersion: 0,
    });
    await notifications.app.recoverPending();
    const financial = notifications.effects.filter((e) =>
      String(e.body.text).includes("/financial-adjustments"),
    );
    expect(financial).toHaveLength(1);
    expect(financial[0].body.to).toEqual(["tax-owner@example.com"]);
    expect(
      (await notifications.app.businessWorkspace(owner, f.business.id)).notices,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceStage: "financial_refund_processed",
          state: "accepted",
          providerId: financial[0].id,
        }),
      ]),
    );
    await notifications.app.recoverPending();
    expect(
      notifications.effects.filter((e) =>
        String(e.body.text).includes("/financial-adjustments"),
      ),
    ).toHaveLength(1);
    expect(f.native.refundPosts).toHaveLength(1);
    expect(
      (await app.workspace(owner, f.business.id)).cases[0].notices.at(-1),
    ).toMatchObject({ channel: "in_app", status: "available" });
  });
});
