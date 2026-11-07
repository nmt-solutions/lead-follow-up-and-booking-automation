import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { createHarness } from "./support/harness";
import { nativeSubscriptionFixture as subscriptionFixture } from "./support/native-subscription";
import { financialNativeFixture } from "./support/financial-native";
import { runtimeDatabase } from "../src/db/runtime";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { createReconciliationApplication } from "../src/application/reconciliation";
import { createReconciliationRepository } from "../src/db/reconciliation-repository";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { fixtureIssuer } from "./support/seller-issuer";
import { createMemoryStorage } from "./support/storage";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";
import { createReconciliationHttp } from "../src/http/reconciliation";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase, prepareDatabaseRole } from "../src/db/setup";

describe("Subscription money reconciliation through the public application", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  function compose() {
    return createReconciliationApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
  }
  async function purchase(country = "IN", paymentId = "pay_original") {
    const f = await subscriptionFixture(h, {
        country,
        ...(paymentId === "pay_usd"
          ? { catalogVersion: 1, ruleKey: "usd" }
          : {}),
      }),
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
      paymentId,
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
      country === "US" ? "USD" : "INR",
    );
    await payments.refresh(f.owner, f.business.id, { actionId: a.id });
    const period = (await payments.workspace(f.owner, f.business.id))
      .periods[0];
    await h.provisionOperator(f.operator, { tax: true, reconciliation: true });
    return { ...f, native, payments, period };
  }
  const cohort = {
    from: "2026-11-01T00:00:00.000Z",
    until: "2026-12-01T00:00:00.000Z",
  };
  it("uses central MFA for reconciliation-only authority without inheriting global access from independent operator capabilities", async () => {
    const mfa = await h.signIn("bank-operator@example.com", false);
    await h.provisionOperator(mfa, { tax: false, reconciliation: true });
    expect(await h.access.status(mfa)).toMatchObject({
      operator: true,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(compose().workspace(mfa, cohort)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const other = await h.signIn("other-global-operator@example.com"),
      actor = await h.authenticate(other);
    await h.admin.query(
      "insert into platform_operator(user_id,documents,refunds,costs) values($1,true,true,true)",
      [actor.userId],
    );
    await expect(compose().workspace(other, cohort)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  async function evidence(
    app: ReturnType<typeof compose>,
    op: Headers,
    reference = "provider-statement-1",
  ) {
    return app.recordEvidence(op, {
      requestKey: randomUUID(),
      source: "provider_statement",
      reference,
      name: "statement.txt",
      contentType: "text/plain",
      contentBase64: Buffer.from(
        "Synthetic authoritative statement: " + reference,
      ).toString("base64"),
      note: "Operator assertion transcribed from retained original statement",
    });
  }
  function settlement(
    f: Awaited<ReturnType<typeof purchase>>,
    evidenceId: string,
  ) {
    return {
      requestKey: randomUUID(),
      supersedes: null,
      evidenceId,
      kind: "settlement",
      provider: "razorpay",
      account: f.period.snapshot.provider.account,
      mode: "test",
      observedAt: "2026-11-05T09:00:00.000Z",
      reference: "statement:setl_1",
      note: "Retained provider statement transcription",
      settlementId: "setl_1",
      bankAccountRef: "bank:treasury-1234",
      transferReference: "UTR-1",
      transferAt: "2026-11-05T09:00:00.000Z",
      status: "processed",
      period: cohort,
      money: { currency: "INR", precision: 2, minor: "10981" },
      creditMinor: "10981",
      debitMinor: "0",
      fees: {
        coverage: "lines",
        amountMinor: null,
        taxMinor: null,
        presentation: "inclusive",
      },
      lines: [
        {
          kind: "capture",
          sourceId: f.period.id,
          businessId: f.business.id,
          paymentId: "pay_original",
          nativeId: "pay_original",
          nativeInvoiceId: "inv_original",
          orderId: "order_original",
          original: { currency: "INR", precision: 2, minor: "11006" },
          convertedMinor: "11006",
          conversion: null,
          creditMinor: "10981",
          debitMinor: "0",
          feeMinor: "25",
          feeTaxMinor: "3",
          feePresentation: "inclusive",
        },
      ],
    };
  }
  it("shows original gross, customer tax and revenue separately under independent reconciliation authority", async () => {
    const f = await purchase(),
      app = compose();
    await expect(app.workspace(f.owner, cohort)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const view = await app.workspace(f.operator, cohort);
    expect(view.expected).toEqual([
      {
        currency: "INR",
        precision: 2,
        grossMinor: "11006",
        salesTaxMinor: "1001",
        revenueMinor: "10005",
        refundCashMinor: "0",
        disputeDeductionMinor: "0",
        creditGrossMinor: "0",
        creditTaxMinor: "0",
      },
    ]);
    expect(view.sources[0]).toMatchObject({
      periodId: f.period.id,
      paymentId: "pay_original",
      kind: "initial",
      nativeInvoiceId: "inv_original",
      orderId: "order_original",
    });
    expect(view.sources[0]).not.toHaveProperty("review");
    expect(view.unresolved).toContainEqual({
      sourceId: f.period.id,
      reason: "settlement_unavailable",
    });
  });
  it("compares equivalent ISO instants chronologically for transfers, bank receipts and report boundaries", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id);
    const saved = await app.record(f.operator, {
      ...input,
      transferAt: "2026-11-05T09:00:00Z",
    });
    const bank = await app.recordEvidence(f.operator, {
      requestKey: randomUUID(),
      source: "bank_statement",
      reference: "bank-time-precision",
      name: "bank.txt",
      contentType: "text/plain",
      contentBase64: Buffer.from("Synthetic bank credit at 09:00 UTC").toString(
        "base64",
      ),
      note: "Independent bank statement with millisecond timestamp",
    });
    await app.record(f.operator, {
      requestKey: randomUUID(),
      supersedes: null,
      kind: "bank_receipt",
      evidenceId: bank.id,
      provider: input.provider,
      account: input.account,
      mode: input.mode,
      observedAt: input.observedAt,
      reference: "bank-time-precision",
      note: "Independent receipt at the transfer instant",
      settlementId: input.settlementId,
      bankAccountRef: input.bankAccountRef,
      transferReference: input.transferReference,
      money: input.money,
      bankTransactionId: "bank-time-precision",
      valueAt: "2026-11-05T09:00:00.000Z",
    });
    const view = await app.workspace(f.operator, {
      from: "2026-11-05T09:00:00Z",
      until: "2026-11-05T09:00:01Z",
    });
    expect(view.sources.map((s) => s.periodId)).toEqual([f.period.id]);
    expect(view.settlements).toHaveLength(1);
    expect(view.settlements[0]).toMatchObject({
      id: saved.id,
      bankObservedMinor: "10981",
      bankDifferenceMinor: "0",
    });
    const excluded = await app.workspace(f.operator, {
      from: "2026-11-05T08:59:59Z",
      until: "2026-11-05T09:00:00Z",
    });
    expect(excluded.sources).toEqual([]);
    expect(excluded.settlements).toEqual([]);
  });
  it.each(["IN", "US"])(
    "keeps actual native %s refund cash, original-tax permanent credit and residual distinct, requiring its own actual FX",
    async (country) => {
      const f = await purchase(country),
        actor = await h.authenticate(f.operator);
      if (country === "US")
        f.native.afterPost = async () => {
          f.native.refunds[0].currency = "USD";
        };
      await h.admin.query(
        "update platform_operator set refunds=true,documents=true where user_id=$1",
        [actor.userId],
      );
      const documents = createSellerDocumentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        storage: createMemoryStorage(),
        mode: "fixture",
        policy: {
          accountScope: "fixture",
          maxBytes: 1000000,
          accessTtlSeconds: 60,
          recoveryLeaseSeconds: 60,
        },
      });
      const issuer = await documents.saveIssuer(f.operator, {
        expectedVersion: 0,
        configuration: {
          ...fixtureIssuer,
          currencies: fixtureIssuer.currencies.map((c) => ({
            ...c,
            currency: country === "US" ? "USD" : "INR",
          })),
        },
        note: "Synthetic issuer",
      });
      await documents.decideIssuer(f.operator, {
        revisionId: issuer.revisions[0].id,
        expectedVersion: 0,
        outcome: "approved",
        note: "Approved synthetic issuer",
      });
      const invoice = await documents.issue(f.owner, f.business.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      });
      const financial = createFinancialAdjustmentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createFinancialAdjustmentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredFinancialAdjustments(f.native.configuration),
        documents,
      });
      const intent = await financial.review(f.operator, f.business.id, {
        kind: "refund",
        invoiceId: invoice.id,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "1000" }],
        reason: "Approved partial refund",
        evidence: ["fixture:original-request"],
      });
      await financial.execute(f.operator, f.business.id, { caseId: intent.id });
      let view = await compose().workspace(f.operator, cohort);
      expect(view.sources[0].effects).toHaveLength(0);
      expect(view.unresolved).toContainEqual({
        sourceId: intent.id,
        reason: "native_outcome_not_money_proof",
      });
      f.native.refunds[0].status = "processed";
      await financial.recover();
      await financial.reviewCredit(f.operator, f.business.id, {
        caseId: intent.id,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "999" }],
        reason: "Original component rounding retains one minor unit difference",
        evidence: ["fixture:reviewed-residual"],
      });
      await financial.credit(f.operator, f.business.id, { caseId: intent.id });
      const app = compose(),
        e = await evidence(app, f.operator),
        input = settlement(f, e.id);
      if (country === "US") {
        input.lines[0].original = {
          currency: "USD",
          precision: 2,
          minor: "2750",
        };
        input.lines[0].convertedMinor = "240000";
        input.lines[0].creditMinor = "239975";
        input.creditMinor = "239975";
      }
      view = await app.workspace(f.operator, cohort);
      const effect = view.sources[0].effects[0];
      expect(effect).toMatchObject({
        actualMinor: "1100",
        approvedCredit: {
          uncreditedDifferenceMinor: "1",
          allocation: { totals: { totalMinor: "1099" } },
        },
      });
      const saved = await app.record(f.operator, {
        ...input,
        money: { ...input.money, minor: country === "US" ? "144975" : "9881" },
        debitMinor: country === "US" ? "95000" : "1100",
        lines: [
          ...input.lines,
          {
            ...input.lines[0],
            kind: "refund",
            sourceId: effect.id,
            nativeId: effect.nativeId,
            original: {
              currency: country === "US" ? "USD" : "INR",
              precision: 2,
              minor: "1100",
            },
            convertedMinor: country === "US" ? "95000" : "1100",
            creditMinor: "0",
            debitMinor: country === "US" ? "95000" : "1100",
            feeMinor: "0",
            feeTaxMinor: "0",
          },
        ],
      });
      let row = (await app.workspace(f.operator, cohort)).settlements[0];
      if (country === "US") {
        expect(row.expectedNetMinor).toBeNull();
        expect(row.reasons).toContain("actual_fx_unavailable");
        const fx = await app.recordEvidence(f.operator, {
          requestKey: randomUUID(),
          source: "conversion_confirmation",
          reference: "refund-fx-native-confirmation",
          name: "fx.txt",
          contentType: "text/plain",
          contentBase64: Buffer.from(
            "Refund conversion 1100 USD minor to 95000 INR minor, actual provider confirmation",
          ).toString("base64"),
          note: "Separately evidenced refund conversion differs from original capture rate",
        });
        if (saved.data.kind !== "settlement")
          throw Error("Expected settlement fixture");
        await app.record(f.operator, {
          ...saved.data,
          requestKey: randomUUID(),
          supersedes: saved.id,
          lines: saved.data.lines.map((l) =>
            l.kind === "refund"
              ? {
                  ...l,
                  conversion: {
                    numerator: "95000",
                    denominator: "1100",
                    units: "target_minor_per_source_minor",
                    effectiveAt: "2026-11-05T09:00:00.000Z",
                    rounding: "half_up",
                    evidenceId: fx.id,
                    reference: "refund-fx-native-confirmation",
                  },
                }
              : l,
          ),
        });
        row = (await app.workspace(f.operator, cohort)).settlements[0];
        expect(row).toMatchObject({
          expectedNetMinor: "144975",
          observedNetMinor: "144975",
          providerDifferenceMinor: "0",
        });
      } else
        expect(row).toMatchObject({
          expectedNetMinor: "9881",
          observedNetMinor: "9881",
          providerDifferenceMinor: "0",
        });
      expect(
        (await app.workspace(f.operator, cohort)).expected[0],
      ).toMatchObject({
        refundCashMinor: "1100",
        creditGrossMinor: "1099",
        creditTaxMinor: "100",
      });
      expect((await app.export(f.operator, cohort)).content).toContain(
        '"uncreditedDifferenceMinor": "1"',
      );
    },
  );
  it("records attributable original evidence and reconciles fee-inclusive tax once without pretending a processed settlement is bank credit", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator);
    const input = settlement(f, e.id),
      saved = await app.record(f.operator, input);
    expect(await compose().record(f.operator, input)).toEqual(saved);
    const view = await compose().workspace(f.operator, cohort),
      row = view.settlements[0];
    expect(row).toMatchObject({
      id: saved.id,
      provenance: "operator_assertion",
      expectedNetMinor: "10981",
      observedNetMinor: "10981",
      providerDifferenceMinor: "0",
      transferDifferenceMinor: "0",
      processingCostMinor: "22",
      feeTaxMinor: "3",
      bankObservedMinor: null,
      bankDifferenceMinor: null,
      status: "review_required",
    });
    expect(row.reasons).toContain("bank_evidence_unavailable");
    expect(view.evidence[0]).toMatchObject({
      id: e.id,
      sha256: e.sha256,
      actorId: (await h.authenticate(f.operator)).userId,
    });
    expect(JSON.stringify(view)).not.toContain("contentBase64");
  });
  it("retains partial and contradictory bank observations, attributable acknowledgement and superseding corrections without balancing adjustments", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      saved = await app.record(f.operator, settlement(f, e.id));
    const bank = await app.recordEvidence(f.operator, {
      requestKey: randomUUID(),
      source: "bank_statement",
      reference: "bank-original",
      name: "bank.txt",
      contentType: "text/plain",
      contentBase64: Buffer.from("Independent bank observation UTR-1").toString(
        "base64",
      ),
      note: "Observed account statement",
    });
    const receipt = {
      requestKey: randomUUID(),
      supersedes: null,
      evidenceId: bank.id,
      kind: "bank_receipt",
      provider: "razorpay",
      account: f.period.snapshot.provider.account,
      mode: "test",
      observedAt: "2026-11-05T09:00:00.000Z",
      reference: "bank-row-1",
      note: "Partial observed credit",
      settlementId: "setl_1",
      bankAccountRef: "bank:treasury-1234",
      transferReference: "UTR-1",
      money: { currency: "INR", precision: 2, minor: "5000" },
      bankTransactionId: "bank-tx-1",
      valueAt: "2026-11-05",
    };
    await app.record(f.operator, receipt);
    let row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row).toMatchObject({
      bankObservedMinor: "5000",
      bankDifferenceMinor: "-5981",
      status: "review_required",
    });
    expect(row.receipts[0]).toMatchObject({
      data: { valueAt: "2026-11-05" },
      valueTimePrecision: "date_only",
      valueTimeZone: null,
      matchingBasis: "calendar_date_compatibility_only",
    });
    const review = {
      requestKey: randomUUID(),
      recordId: saved.id,
      reportHash: row.reportHash,
      outcome: "acknowledged",
      note: "Investigating partial receipt; original difference retained",
      evidenceIds: [bank.id],
    };
    const acknowledged = await app.review(f.operator, review);
    await expect(
      app.review(f.operator, {
        ...review,
        requestKey: randomUUID(),
        outcome: "resolved",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const wrong = await app.record(f.operator, {
      ...receipt,
      requestKey: randomUUID(),
      bankTransactionId: "bank-tx-2",
      money: { ...receipt.money, minor: "5981" },
      transferReference: "WRONG-UTR",
    });
    row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row.bankObservedMinor).toBe("5000");
    expect(row.reasons).toContain("bank_identity_currency_or_date_mismatch");
    await app.record(f.operator, {
      ...wrong.data,
      requestKey: randomUUID(),
      supersedes: wrong.id,
      transferReference: "UTR-1",
    });
    row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row).toMatchObject({
      bankObservedMinor: "10981",
      bankDifferenceMinor: "0",
      status: "ready_for_review",
    });
    expect(row.reviews[0].discrepancy).toMatchObject({
      bankDifferenceMinor: "-5981",
    });
    expect(await app.review(f.operator, review)).toEqual(acknowledged);
    await app.review(f.operator, {
      ...review,
      requestKey: randomUUID(),
      reportHash: row.reportHash,
      outcome: "resolved",
    });
    expect(
      (await compose().workspace(f.operator, cohort)).settlements[0].status,
    ).toBe("resolved_operator_assertion");
    const exported = JSON.parse((await app.export(f.operator, cohort)).content);
    expect(exported.history).toHaveLength(4);
    expect(exported.settlements[0].reviews).toHaveLength(2);
  });
  it("uses actual native base amounts for USD captures while keeping multiple Businesses and original currency totals separate", async () => {
    const domestic = await purchase();
    await purchase("US", "pay_usd");
    const app = compose(),
      e = await evidence(app, domestic.operator);
    const input = settlement(domestic, e.id),
      usd = (await app.workspace(domestic.operator, cohort)).sources.find(
        (s) => s.paymentId === "pay_usd",
      )!;
    const saved = await app.record(domestic.operator, {
      ...input,
      money: { ...input.money, minor: "250956" },
      creditMinor: "250956",
      lines: [
        ...input.lines,
        {
          ...input.lines[0],
          sourceId: usd.periodId,
          businessId: usd.businessId,
          paymentId: usd.paymentId,
          nativeId: usd.paymentId,
          nativeInvoiceId: usd.nativeInvoiceId,
          orderId: usd.orderId,
          original: { currency: "USD", precision: 2, minor: "2750" },
          convertedMinor: "240000",
        },
      ],
    });
    const report = await app.workspace(domestic.operator, cohort);
    expect(report.expected).toMatchObject([
      { currency: "INR", grossMinor: "11006" },
      { currency: "USD", grossMinor: "2750" },
    ]);
    expect(report.settlements[0]).toMatchObject({
      expectedNetMinor: "250956",
      processingCostMinor: "44",
      feeTaxMinor: "6",
    });
    expect(
      report.settlements[0].movements.find((l) => l.paymentId === "pay_usd")
        ?.conversionSource,
    ).toBe("native_base_amount");
    if (saved.data.kind !== "settlement")
      throw Error("Settlement fixture expected");
    await app.record(domestic.operator, {
      ...saved.data,
      requestKey: randomUUID(),
      supersedes: saved.id,
      lines: saved.data.lines.map((l) =>
        l.paymentId === "pay_usd" ? { ...l, convertedMinor: "239999" } : l,
      ),
    });
    const mismatch = (await app.workspace(domestic.operator, cohort))
      .settlements[0];
    expect(mismatch.expectedNetMinor).toBeNull();
    expect(mismatch.reasons).toContain("converted_amount_mismatch");
  });
  it("does not let same-currency statement assertions bypass a retained native settlement conversion", async () => {
    const f = await purchase("US"),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id);
    await app.record(f.operator, {
      ...input,
      money: { currency: "USD", precision: 2, minor: "2750" },
      creditMinor: "2750",
      fees: {
        coverage: "aggregate",
        amountMinor: "0",
        taxMinor: "0",
        presentation: "inclusive",
      },
      lines: [
        {
          ...input.lines[0],
          original: { currency: "USD", precision: 2, minor: "2750" },
          convertedMinor: "2750",
          creditMinor: "2750",
          feeMinor: "0",
          feeTaxMinor: "0",
        },
      ],
    });
    const view = await app.workspace(f.operator, cohort);
    expect(view.sources[0]).toMatchObject({
      currency: "USD",
      baseAmountMinor: "240000",
      baseCurrency: "INR",
    });
    expect(view.settlements[0].reasons).toContain(
      "settlement_currency_conflicts_with_native_base",
    );
    expect(view.settlements[0].expectedNetMinor).toBeNull();
  });
  it("rejects spoofed original Business/account/mode/payment/order/invoice identities and pending outcomes while retaining unknown movements for review", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id);
    for (const change of [
      { account: "another-account" },
      { mode: "live" },
      { lines: [{ ...input.lines[0], businessId: randomUUID() }] },
      { lines: [{ ...input.lines[0], paymentId: "pay_foreign" }] },
      { lines: [{ ...input.lines[0], orderId: "order_wrong" }] },
      { lines: [{ ...input.lines[0], nativeInvoiceId: "inv_wrong" }] },
      {
        lines: [{ ...input.lines[0], sourceId: randomUUID(), kind: "refund" }],
      },
    ]) {
      await expect(
        app.record(f.operator, { ...input, ...change }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await app.record(f.operator, {
      ...input,
      lines: [
        {
          ...input.lines[0],
          kind: "unclassified",
          sourceId: null,
          businessId: null,
          paymentId: null,
          nativeInvoiceId: null,
          orderId: null,
          original: null,
          nativeId: "provider:unknown-row",
        },
      ],
    });
    const row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row.expectedNetMinor).toBeNull();
    expect(row.reasons).toContain("unclassified_provider_movement");
  });
  it("binds retries to the original operator and exact payload and makes duplicate transaction identities visible", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id),
      saved = await app.record(f.operator, input);
    const op = await h.signIn("another-reconciler@example.com");
    await h.provisionOperator(op, { tax: false, reconciliation: true });
    await expect(app.record(op, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      app.record(f.operator, { ...input, note: "Changed original request" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const duplicate = await app.record(op, {
      ...input,
      requestKey: randomUUID(),
      reference: "independent conflicting statement",
    });
    const report = await app.workspace(op, cohort);
    expect(report.settlements).toHaveLength(2);
    for (const row of report.settlements)
      expect(row.reasons).toContain("duplicate_settlement_identity");
    expect(report.history.some((r) => r.id === saved.id)).toBe(true);
    await app.record(op, {
      ...input,
      requestKey: randomUUID(),
      supersedes: saved.id,
      supersedesAlso: [duplicate.id],
      reference: "consolidated authoritative correction",
      note: "Both retained copies superseded by this complete same-identity statement",
    });
    const corrected = await app.workspace(op, cohort);
    expect(corrected.settlements).toHaveLength(1);
    expect(corrected.settlements[0].reasons).not.toContain(
      "duplicate_settlement_identity",
    );
    expect(corrected.history).toHaveLength(3);
  });
  it("keeps aggregate fee coverage separate from its included lines and exposes contradictory native fee and actual FX evidence", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id);
    const saved = await app.record(f.operator, {
      ...input,
      fees: {
        coverage: "aggregate",
        amountMinor: "25",
        taxMinor: "3",
        presentation: "inclusive",
      },
    });
    let row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row).toMatchObject({
      expectedNetMinor: "10981",
      processingCostMinor: "22",
      feeTaxMinor: "3",
    });
    await app.record(f.operator, {
      ...saved.data,
      requestKey: randomUUID(),
      supersedes: saved.id,
      lines: [{ ...input.lines[0], feePresentation: "exclusive" }],
    });
    row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row.reasons).toContain("fee_conflicts_with_native_capture");
    expect(row.reasons).toContain("fee_coverage_difference");
    expect(row.expectedNetMinor).toBe("10981");
  });
  it("does not treat a zero settlement aggregate as proof that known transaction processing fees were zero", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      input = settlement(f, e.id);
    await app.record(f.operator, {
      ...input,
      money: { ...input.money, minor: "11006" },
      creditMinor: "11006",
      fees: {
        coverage: "aggregate",
        amountMinor: "0",
        taxMinor: "0",
        presentation: "inclusive",
      },
      lines: [
        {
          ...input.lines[0],
          creditMinor: "11006",
          feeMinor: null,
          feeTaxMinor: null,
          feePresentation: "unavailable",
        },
      ],
    });
    const row = (await app.workspace(f.operator, cohort)).settlements[0];
    expect(row.reasons).toContain("aggregate_omits_native_processing_fees");
    expect(row.processingCostMinor).toBeNull();
  });
  it.each([
    {
      component: "fee tax",
      tax: "0",
      reason: "aggregate_omits_native_fee_tax",
    },
    {
      component: "cost",
      tax: "10",
      reason: "aggregate_omits_native_processing_cost",
    },
  ])(
    "does not let aggregate coverage erase known native processing $component when included line fees are unavailable",
    async ({ tax, reason }) => {
      const f = await purchase(),
        app = compose(),
        e = await evidence(app, f.operator),
        input = settlement(f, e.id);
      await app.record(f.operator, {
        ...input,
        fees: {
          coverage: "aggregate",
          amountMinor: "25",
          taxMinor: tax,
          presentation: "inclusive",
        },
        lines: [
          {
            ...input.lines[0],
            feeMinor: null,
            feeTaxMinor: null,
            feePresentation: "unavailable",
          },
        ],
      });
      const report = await app.workspace(f.operator, cohort),
        row = report.settlements[0];
      expect(report.sources[0]).toMatchObject({
        feeMinor: "25",
        feeTaxMinor: "3",
        feeCurrency: "INR",
      });
      expect(row.reasons).toContain(reason);
      expect(row.expectedNetMinor).toBeNull();
      expect(row.processingCostMinor).toBeNull();
      expect(row.feeTaxMinor).toBeNull();
    },
  );
  it("requires current platform authority after persistence I/O and isolates private expiring evidence from every other capability", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      actor = await h.authenticate(f.operator);
    const grant = await app.evidenceAccess(f.operator, { evidenceId: e.id });
    expect(
      Buffer.from(
        (
          await app.evidenceContent(f.operator, {
            evidenceId: e.id,
            token: grant.token,
          })
        ).bytes,
      ).toString(),
    ).toContain("Synthetic authoritative statement");
    const taxOnly = await h.signIn("tax-only-global@example.com");
    await h.provisionOperator(taxOnly, { tax: true, reconciliation: false });
    await expect(
      app.evidenceContent(taxOnly, { evidenceId: e.id, token: grant.token }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    let reads = 0;
    const revoking = createReconciliationApplication({
      repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      authenticatePlatform: async (headers: Headers) => {
        if (++reads === 2)
          await h.admin.query(
            "update platform_operator set reconciliation=false where user_id=$1",
            [actor.userId],
          );
        return h.access.authenticatePlatform(headers);
      },
    });
    await expect(revoking.workspace(f.operator, cohort)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      app.evidenceContent(f.operator, { evidenceId: e.id, token: grant.token }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(f.operator, { tax: true, reconciliation: true });
    reads = 0;
    await expect(
      revoking.evidenceContent(f.operator, {
        evidenceId: e.id,
        token: grant.token,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(f.operator, { tax: true, reconciliation: true });
    await h.admin.query(
      "update reconciliation_access set expires_at=statement_timestamp()-interval '1 second',at=statement_timestamp()-interval '61 seconds' where token_hash=$1",
      [createHash("sha256").update(grant.token).digest("hex")],
    );
    await expect(
      app.evidenceContent(f.operator, { evidenceId: e.id, token: grant.token }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks current MFA after financial reads before returning private global evidence", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      grant = await app.evidenceAccess(f.operator, { evidenceId: e.id });
    let reads = 0;
    const expiring = createReconciliationApplication({
      repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      authenticatePlatform: async (headers: Headers) => {
        if (++reads === 2) h.clock.set("2026-11-05T09:16:00.000Z");
        return h.access.authenticatePlatform(headers);
      },
    });
    await expect(
      expiring.evidenceContent(f.operator, {
        evidenceId: e.id,
        token: grant.token,
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("rechecks the current session after the final evidence grant serialization wait", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      grant = await app.evidenceAccess(f.operator, { evidenceId: e.id }),
      blocker = await h.admin.connect();
    let reads = 0,
      locked: (() => void) | undefined;
    const lockReady = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const guarded = createReconciliationApplication({
      repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      authenticatePlatform: async (headers: Headers) => {
        const actor = await h.access.authenticatePlatform(headers);
        if (++reads === 2) {
          await blocker.query("begin");
          await blocker.query(
            "select pg_advisory_xact_lock(hashtextextended('reconciliation',0))",
          );
          locked?.();
        }
        return actor;
      },
    });
    try {
      const outcome = guarded
        .evidenceContent(f.operator, {
          evidenceId: e.id,
          token: grant.token,
        })
        .then(
          () => "private evidence returned",
          (error: unknown) => error,
        );
      await lockReady;
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const state = await h.admin.query(
          "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory' and query like '%pg_advisory_xact_lock%') as waiting",
        );
        waiting = state.rows[0].waiting;
      }
      expect(waiting).toBe(true);
      h.clock.set("2026-11-05T09:16:00.000Z");
      await blocker.query("commit");
      expect(await outcome).toMatchObject({ code: "MFA_REQUIRED" });
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
  it("validates bounded same-origin HTTP commands and returns role-bound original evidence and complete private exports", async () => {
    const f = await purchase(),
      app = compose(),
      e = await evidence(app, f.operator),
      http = createReconciliationHttp({
        application: app,
        origin: "http://localhost:3000",
        reportFailure: (d) => h.diagnostics.push(d),
      });
    const request = (body: unknown, origin = "http://localhost:3000") => {
      const headers = new Headers(f.operator);
      headers.set("origin", origin);
      headers.set("content-type", "application/json");
      return new Request(
        "http://localhost:3000/api/platform/reconciliation/access",
        { method: "POST", headers, body: JSON.stringify(body) },
      );
    };
    expect(
      (
        await http.command(
          request({ evidenceId: e.id }, "https://foreign.example"),
          "access",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.command(
          request({ contentBase64: "x".repeat(1100001) }),
          "evidence",
        )
      ).status,
    ).toBe(400);
    const access = await http.command(request({ evidenceId: e.id }), "access"),
      grant = await access.json();
    const content = await http.command(
      request({ evidenceId: e.id, token: grant.data.token }),
      "content",
    );
    expect(content.headers.get("cache-control")).toBe("private, no-store");
    expect(await content.text()).toContain("Synthetic authoritative statement");
    const exported = await http.command(request(cohort), "export");
    expect(JSON.parse(await exported.text()).coverage.pagination).toBe(
      "complete",
    );
    expect(JSON.stringify(h.diagnostics)).not.toContain(grant.data.token);
  });
  it("retains the exact advertised 256 KiB evidence through HTTP and refuses oversized or unsafe attachments", async () => {
    const f = await purchase(),
      http = createReconciliationHttp({
        application: compose(),
        origin: "http://localhost:3000",
        reportFailure: (d) => h.diagnostics.push(d),
      }),
      original = Buffer.alloc(262144, 97);
    const request = (input: unknown) => {
      const headers = new Headers(f.operator);
      headers.set("origin", "http://localhost:3000");
      headers.set("content-type", "application/json");
      return new Request(
        "http://localhost:3000/api/platform/reconciliation/evidence",
        {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        },
      );
    };
    const input = {
      requestKey: randomUUID(),
      source: "provider_statement",
      reference: "maximum-supported-original",
      name: "statement.txt",
      contentType: "text/plain",
      contentBase64: original.toString("base64"),
      note: "Synthetic exact maximum-size original",
    };
    const saved = await http.command(request(input), "evidence");
    expect(saved.status).toBe(200);
    const metadata = (await saved.json()).data;
    expect(metadata).toMatchObject({
      bytes: 262144,
      name: "statement.txt",
      contentType: "text/plain",
    });
    expect(metadata).not.toHaveProperty("contentBase64");
    const access = await http.command(
      request({ evidenceId: metadata.id }),
      "access",
    );
    const grant = (await access.json()).data;
    const content = await http.command(
      request({ evidenceId: metadata.id, token: grant.token }),
      "content",
    );
    expect(content.headers.get("content-type")).toBe("text/plain");
    expect(content.headers.get("content-disposition")).toBe(
      'attachment; filename="statement.txt"',
    );
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await content.arrayBuffer()).equals(original)).toBe(
      true,
    );
    for (const override of [
      { contentBase64: Buffer.alloc(262145, 97).toString("base64") },
      { contentType: "text/html" },
      { name: 'statement.txt"\r\nx-injected: true' },
    ]) {
      const rejected = await http.command(
        request({ ...input, requestKey: randomUUID(), ...override }),
        "evidence",
      );
      expect(rejected.status).toBe(400);
    }
    expect(JSON.stringify(h.diagnostics)).not.toContain(grant.token);
    expect(JSON.stringify(h.diagnostics)).not.toContain(input.contentBase64);
  });
  it("requires every ledger SELECT and INSERT grant separately and every public or private helper ACL", async () => {
    for (const table of [
      "reconciliation_evidence",
      "reconciliation_record",
      "reconciliation_review",
      "reconciliation_access",
    ]) {
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(`revoke ${privilege} on ${table} from app_runtime`);
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
        await h.admin.query(`grant ${privilege} on ${table} to app_runtime`);
      }
    }
    await h.admin.query(
      "revoke execute on function reconciliation_sources(timestamptz,timestamptz) from app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await h.admin.query(
      "grant execute on function reconciliation_sources(timestamptz,timestamptz) to app_runtime",
    );
    await h.admin.query(
      "update pg_proc set proacl=null where oid='public.reconciliation_sources(timestamptz,timestamptz)'::regprocedure",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await h.admin.query(
      "revoke all on function reconciliation_sources(timestamptz,timestamptz) from public; grant execute on function reconciliation_sources(timestamptz,timestamptz) to app_runtime",
    );
    await h.admin.query(
      "update pg_proc set proacl=null where oid='public.protect_reconciliation_record()'::regprocedure",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await secureDatabase(h.admin);
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
  });
  describe("populated complete managed reapplication", () => {
    let f: Awaited<ReturnType<typeof purchase>>,
      saved: Awaited<ReturnType<ReturnType<typeof compose>["record"]>>,
      e: Awaited<ReturnType<ReturnType<typeof compose>["recordEvidence"]>>;
    beforeEach(async () => {
      f = await purchase();
      const actor = await h.authenticate(f.operator);
      await h.admin.query(
        "update platform_operator set documents=true where user_id=$1",
        [actor.userId],
      );
      const documents = createSellerDocumentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        storage: createMemoryStorage(),
        mode: "fixture",
        policy: {
          accountScope: "fixture",
          maxBytes: 1000000,
          accessTtlSeconds: 60,
          recoveryLeaseSeconds: 60,
        },
      });
      const issuer = await documents.saveIssuer(f.operator, {
        expectedVersion: 0,
        configuration: fixtureIssuer,
        note: "Populated reapplication issuer",
      });
      await documents.decideIssuer(f.operator, {
        revisionId: issuer.revisions[0].id,
        expectedVersion: 0,
        outcome: "approved",
        note: "Approved fixture issuer",
      });
      await documents.issue(f.owner, f.business.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      });
      const app = compose();
      e = await evidence(app, f.operator);
      saved = await app.record(f.operator, settlement(f, e.id));
      const row = (await app.workspace(f.operator, cohort)).settlements[0];
      await app.review(f.operator, {
        requestKey: randomUUID(),
        recordId: saved.id,
        reportHash: row.reportHash,
        outcome: "acknowledged",
        note: "Bank evidence still unavailable",
        evidenceIds: [e.id],
      });
      await app.evidenceAccess(f.operator, { evidenceId: e.id });
    });
    it("preserves original source/evidence/history and all restricted scopes while pausing writes before full configured DDL", async () => {
      const before = await compose().workspace(f.operator, cohort),
        actor = await h.authenticate(f.operator);
      const definitions = () =>
        h.admin.query(
          "select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid::regprocedure::text",
        );
      const functions = await definitions();
      const constraints = () =>
        h.admin.query(
          "select conrelid::regclass::text as table_name,conname,pg_get_constraintdef(oid) as definition,convalidated from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname",
        );
      const originalConstraints = await constraints();
      await prepareDatabaseRole(h.admin);
      const client = await h.runtime.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.actor_id',$1,true)", [
          actor.userId,
        ]);
        await expect(
          client.query("select * from reconciliation_record"),
        ).rejects.toThrow();
        await client.query("rollback");
      } finally {
        client.release();
      }
      await h.reapplySchema();
      await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
      expect((await definitions()).rows).toEqual(functions.rows);
      expect((await constraints()).rows).toEqual(originalConstraints.rows);
      expect(await compose().workspace(f.operator, cohort)).toEqual(before);
      const raw = await h.runtime.query(
        "select * from reconciliation_evidence",
      );
      expect(raw.rows).toEqual([]);
      const scopes = await h.admin.query(
        "select count(*)::int n from pg_constraint where conname='reconciliation_record_predecessor' and convalidated",
      );
      expect(scopes.rows[0].n).toBe(1);
      const grant = await compose().evidenceAccess(f.operator, {
        evidenceId: e.id,
      });
      expect(
        (
          await compose().evidenceContent(f.operator, {
            evidenceId: e.id,
            token: grant.token,
          })
        ).sha256,
      ).toBe(e.sha256);
    });
    it("denies direct raw spoofing and immutable changes and clamps a forged future evidence lease to trusted database time", async () => {
      const actor = await h.authenticate(f.operator),
        client = await h.runtime.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.actor_id',$1,true)", [
          actor.userId,
        ]);
        const bad = { ...saved.data, requestKey: randomUUID() };
        if (bad.kind !== "settlement")
          throw Error("Fixture must be a settlement");
        bad.lines[0].businessId = randomUUID();
        await expect(
          client.query(
            "insert into reconciliation_record(id,request_key,actor_id,evidence_id,identity,data) values($1,$2,$3,$4,'forged',$5)",
            [randomUUID(), bad.requestKey, actor.userId, e.id, bad],
          ),
        ).rejects.toThrow();
        await client.query("rollback");
        for (const table of [
          "reconciliation_record",
          "reconciliation_evidence",
          "reconciliation_review",
          "reconciliation_access",
        ])
          await expect(client.query(`delete from ${table}`)).rejects.toThrow();
        await client.query("begin");
        await client.query("select set_config('app.actor_id',$1,true)", [
          actor.userId,
        ]);
        const lease = await client.query(
          "insert into reconciliation_access(id,actor_id,evidence_id,token_hash,at,expires_at) values($1,$2,$3,$4,statement_timestamp()+interval '1 year',statement_timestamp()+interval '2 years') returning expires_at<=statement_timestamp()+interval '60 seconds' as bounded",
          [randomUUID(), actor.userId, e.id, "f".repeat(64)],
        );
        expect(lease.rows[0].bounded).toBe(true);
        await client.query("rollback");
        await client.query("begin");
        await client.query(
          "select set_config('app.business_id',$1,true),set_config('app.actor_id',$2,true)",
          [f.business.id, actor.userId],
        );
        expect(
          (
            await client.query(
              "select reconciliation_sources('1970-01-01','9999-01-01') as sources",
            )
          ).rows[0].sources,
        ).toBeNull();
        expect(
          (await client.query("select * from reconciliation_record")).rows,
        ).toEqual([]);
        await client.query("rollback");
      } finally {
        client.release();
      }
    });
    it("requires retained conversion evidence and canonical money precision at the restricted database write boundary", async () => {
      if (saved.data.kind !== "settlement")
        throw Error("Settlement fixture expected");
      const data = saved.data,
        line = data.lines[0];
      if (!line.original) throw Error("Original money fixture expected");
      const conversion = {
        numerator: "1",
        denominator: "1",
        units: "target_minor_per_source_minor",
        effectiveAt: data.observedAt,
        rounding: "half_up",
        reference: "synthetic conversion",
      };
      const cases = [
        { ...data, evidenceId: null },
        { ...data, lines: [] },
        {
          ...data,
          lines: [
            {
              ...line,
              conversion: { ...conversion, evidenceId: randomUUID() },
            },
          ],
        },
        {
          ...data,
          lines: [{ ...line, conversion: { ...conversion, evidenceId: e.id } }],
        },
        {
          ...data,
          lines: [{ ...line, original: { ...line.original, precision: 3 } }],
        },
        { ...data, money: { ...data.money, precision: 3 } },
        { ...data, money: { ...data.money, currency: "EUR" } },
        {
          ...data,
          lines: [
            {
              ...line,
              kind: "unclassified",
              sourceId: null,
              businessId: null,
              paymentId: null,
              original: null,
              nativeInvoiceId: "forged-invoice",
              orderId: "forged-order",
            },
          ],
        },
      ];
      const actor = await h.authenticate(f.operator),
        client = await h.runtime.connect();
      try {
        for (const sample of cases) {
          const requestKey = randomUUID();
          await client.query("begin");
          try {
            await client.query("select set_config('app.actor_id',$1,true)", [
              actor.userId,
            ]);
            await expect(
              client.query(
                "insert into reconciliation_record(id,request_key,actor_id,evidence_id,identity,data) values($1,$2,$3,$4,'untrusted',$5)",
                [
                  randomUUID(),
                  requestKey,
                  actor.userId,
                  e.id,
                  { ...sample, requestKey },
                ],
              ),
            ).rejects.toThrow();
          } finally {
            await client.query("rollback");
          }
        }
      } finally {
        client.release();
      }
    });
    it("requires current reconciliation authority after a direct insert waits for serialization", async () => {
      const actor = await h.authenticate(f.operator),
        client = await h.runtime.connect(),
        blocker = await h.admin.connect();
      try {
        await blocker.query("begin");
        await blocker.query(
          "select pg_advisory_xact_lock(hashtextextended('reconciliation',0))",
        );
        await client.query("begin");
        await client.query("select set_config('app.actor_id',$1,true)", [
          actor.userId,
        ]);
        const pid = (await client.query("select pg_backend_pid() as pid"))
            .rows[0].pid,
          requestKey = randomUUID();
        const outcome = client
          .query(
            "insert into reconciliation_record(id,request_key,actor_id,evidence_id,identity,data) values($1,$2,$3,$4,'untrusted',$5)",
            [
              randomUUID(),
              requestKey,
              actor.userId,
              e.id,
              { ...saved.data, requestKey },
            ],
          )
          .then(
            () => "accepted",
            () => "denied",
          );
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting = (
            await h.admin.query(
              "select cardinality(pg_blocking_pids($1))>0 as waiting",
              [pid],
            )
          ).rows[0].waiting;
        }
        expect(waiting).toBe(true);
        await h.admin.query(
          "update platform_operator set reconciliation=false where user_id=$1",
          [actor.userId],
        );
        await blocker.query("commit");
        expect(await outcome).toBe("denied");
      } finally {
        await blocker.query("rollback");
        await client.query("rollback");
        blocker.release();
        client.release();
      }
    });
  });
});
