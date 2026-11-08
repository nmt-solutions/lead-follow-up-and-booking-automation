import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { financialNativeFixture } from "./support/financial-native";
import { approveFixtureIssuer } from "./support/pilot-issuer";
import { createMemoryStorage } from "./support/storage";
import { runtimeDatabase } from "../src/db/runtime";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";

describe("Native pilot composition with immutable invoice and actual refund/credit contracts", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  it("issues from the new initial pilot paid period and keeps native cash 1100, approved credit 1099 and residual 1 separate", async () => {
    const s = await pilotFixture(h),
      businessId = s.f.business.id,
      actor = await h.authenticate(s.f.owner),
      database = runtimeDatabase(h.runtime),
      storage = createMemoryStorage();
    await h.admin.query(
      "update platform_operator set documents=true,refunds=true where user_id=$1",
      [actor.userId],
    );
    const native = financialNativeFixture(h.clock);
    native.payments.set(
      "pay_pilot",
      structuredClone(s.native.payments.get("pay_pilot")!),
    );
    const documents = createSellerDocumentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSellerDocumentRepository(database),
      clock: h.clock,
      storage,
      policy: {
        accountScope: "fixture:pilot-documents",
        maxBytes: 1000000,
        accessTtlSeconds: 60,
        recoveryLeaseSeconds: 60,
      },
      mode: "fixture",
    });
    await approveFixtureIssuer(documents, s.f.owner);
    const original = (await s.app.workspace(s.f.owner, businessId)).periods[0];
    const invoice = await documents.issue(s.f.owner, businessId, {
      periodId: original.id,
      requestKey: randomUUID(),
    });
    expect(invoice.snapshot.source).toMatchObject({
      periodId: original.id,
      paymentId: "pay_pilot",
      charge: { subscriptionId: null, charge: { invoiceId: null } },
    });
    expect(invoice.snapshot.totals.totalMinor).toBe("1100");
    expect(invoice.snapshot.financial.provider.review).toBeUndefined();
    const adjustments = createFinancialAdjustmentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createFinancialAdjustmentRepository(database),
      clock: h.clock,
      gateway: configuredFinancialAdjustments(native.configuration),
      documents,
    });
    const refund = await adjustments.review(s.f.owner, businessId, {
      kind: "refund",
      invoiceId: invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "1000" }],
      reason: "Fixture approved actual refund",
      evidence: ["fixture:approved-refund"],
    });
    await adjustments.execute(s.f.owner, businessId, { caseId: refund.id });
    native.refunds[0].status = "processed";
    await adjustments.refresh(s.f.owner, businessId, { caseId: refund.id });
    await adjustments.reviewCredit(s.f.owner, businessId, {
      caseId: refund.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "999" }],
      reason: "Fixture exact approved credit basis",
      evidence: ["fixture:credit-review"],
    });
    await adjustments.credit(s.f.owner, businessId, { caseId: refund.id });
    const view = (await s.pilots.workspace(s.f.owner, businessId)).pilots[0];
    expect(view.financialEvidence.pilotPaid).toBe(false);
    expect(view.financialEvidence.accounting.adjustments).toMatchObject([
      {
        actualCashMinor: "1100",
        issuedCreditMinor: "1099",
        residualMinor: "1",
        status: "processed",
      },
    ]);
    expect((await s.app.workspace(s.f.owner, businessId)).periods).toEqual([
      original,
    ]);
    expect(
      (await documents.workspace(s.f.owner, businessId)).documents.find(
        (d) => d.kind === "invoice",
      ),
    ).toEqual(invoice);
    expect(
      native.effectRequests.filter((r) => r.path.endsWith("/refund")),
    ).toHaveLength(1);
    expect(s.mutations).toHaveLength(1);
    expect(
      JSON.stringify(await adjustments.workspace(s.f.owner, businessId)),
    ).not.toContain("pilotOrders");
  });
});
