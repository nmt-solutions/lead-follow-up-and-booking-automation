import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import type { PrivateStorage } from "../../src/models/files";
import { subscriptionFixture } from "./subscription";
import { financialNativeFixture } from "./financial-native";
import { createFinancialAdjustmentApplication } from "../../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../../src/db/financial-adjustment-repository";
import { configuredFinancialAdjustments } from "../../src/financial-adjustments/configuration";
import { configuredPayments } from "../../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../../src/db/subscription-payment-repository";
import { createSellerDocumentApplication } from "../../src/application/seller-documents";
import { createSellerDocumentRepository } from "../../src/db/seller-document-repository";
import { runtimeDatabase } from "../../src/db/runtime";
export async function financialExportFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  storage: PrivateStorage,
  scope: string,
  nativeCredit = false,
) {
  const f = await subscriptionFixture(h),
    native = financialNativeFixture(h.clock);
  const gateway = configuredPayments({
    ...native.configuration,
    env: {
      ...native.configuration.env,
      SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
        id: "fixture-cancel",
        version: 1,
        mode: "test",
        reviewedBy: "fixture operator",
        checkedAt: "2026-11-01T00:00:00Z",
        effectiveFrom: "2026-11-01T00:00:00Z",
        effectiveUntil: "2027-11-01T00:00:00Z",
        evidence: ["fixture reviewed cancellation terms"],
        graceSeconds: 0,
        graceAccess: "none",
        cancellationTiming: "immediate",
        cancellationAccess: "provider_end",
        preserveRecords: true,
      }),
    },
  });
  const payments = createSubscriptionPaymentApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createSubscriptionPaymentRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
    gateway,
  });
  const action = await payments.prepare(f.owner, f.business.id, {
    quoteId: f.quote.id,
    requestKey: randomUUID(),
  });
  await payments.start(f.owner, f.business.id, { actionId: action.id });
  native.charge("pay_export", "2026-11-05T09:00:00Z", "2026-12-05T09:00:00Z");
  await payments.recover();
  const period = (await payments.workspace(f.owner, f.business.id)).periods[0];
  const op = await h.signIn("export-documents@example.com");
  await h.admin.query(
    "insert into platform_operator(user_id,documents,refunds) values($1,true,true)",
    [(await h.authenticate(op)).userId],
  );
  const documents = createSellerDocumentApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
    storage,
    policy: {
      accountScope: scope,
      maxBytes: 1_000_000,
      accessTtlSeconds: 60,
      recoveryLeaseSeconds: 60,
    },
    mode: "fixture",
  });
  const catalog = await documents.saveIssuer(op, {
    expectedVersion: 0,
    note: "Fixture legal approval",
    configuration: {
      mode: "fixture",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveUntil: null,
      seller: {
        legalName: "Synthetic seller",
        address: "Fixture address",
        country: "IN",
        contact: "seller@example.com",
      },
      legalFields: [{ label: "Registration", value: "TEST-ONLY" }],
      requiredCustomerFields: ["legalName", "address", "invoiceContact"],
      series: {
        invoice: {
          key: "export-invoice",
          prefix: "EXP-I-",
          first: "1",
          width: 4,
        },
        credit_note: {
          key: "export-credit",
          prefix: "EXP-C-",
          first: "1",
          width: 4,
        },
      },
      currencies: [
        {
          currency: "INR",
          precision: 2,
          rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
          additionalRoundings: [],
        },
      ],
      template: {
        format: "text_v1",
        invoiceTitle: "Seller invoice",
        creditTitle: "Credit note",
        footer: "Fixture only",
      },
      retention: {
        minimumSeconds: 86400,
        policyReference: "fixture protected financial history",
        disposition: "protected_history",
      },
      creditAllocation: "cumulative_original_components_v1",
      evidence: [
        {
          title: "Fixture legal review",
          reference: "fixture legal record",
          checkedAt: "2026-11-01T00:00:00Z",
        },
      ],
    },
  });
  await documents.decideIssuer(op, {
    revisionId: catalog.revisions[0].id,
    expectedVersion: 0,
    outcome: "approved",
    note: "Fixture exact approval",
  });
  const invoice = await documents.issue(f.owner, f.business.id, {
    periodId: period.id,
    requestKey: randomUUID(),
  });
  const adjustments = createFinancialAdjustmentApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createFinancialAdjustmentRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
    gateway: configuredFinancialAdjustments(native.configuration),
    documents,
  });
  let refund = null;
  if (nativeCredit) {
    refund = await adjustments.review(op, f.business.id, {
      kind: "refund",
      invoiceId: invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "1000" }],
      reason: "private operator-only refund reason",
      evidence: ["private operator-only refund evidence"],
    });
    await adjustments.execute(op, f.business.id, { caseId: refund.id });
    native.refunds[0].status = "processed";
    await adjustments.refresh(op, f.business.id, { caseId: refund.id });
    await adjustments.reviewCredit(op, f.business.id, {
      caseId: refund.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "999" }],
      reason: "private operator-only credit reason",
      evidence: ["private operator-only credit evidence"],
    });
    await adjustments.credit(op, f.business.id, { caseId: refund.id });
  }
  const credit = nativeCredit
    ? (await documents.workspace(f.owner, f.business.id)).documents.find(
        (d) => d.kind === "credit_note",
      )!
    : await documents.adjust(op, f.business.id, {
        invoiceId: invoice.id,
        periodId: period.id,
        paymentId: period.paymentId,
        requestKey: randomUUID(),
        adjustmentId: randomUUID(),
        source: {
          kind: "refund",
          reference: "fixture reviewed external correction",
        },
        reason: "Fixture adjustment only; no native refund executed",
        evidence: ["fixture confirmed adjustment evidence"],
        lines: [{ lineId: "subscription", netMinor: "1000" }],
      });
  return {
    ...f,
    native,
    payments,
    action,
    period,
    documents,
    invoice,
    credit,
    adjustments,
    refund,
    op,
  };
}
