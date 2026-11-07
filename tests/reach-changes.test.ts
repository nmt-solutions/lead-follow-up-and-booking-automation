import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { financialNativeFixture } from "./support/financial-native";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { createMemoryStorage } from "./support/storage";
import { fixtureIssuer } from "./support/seller-issuer";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createReachChangeApplication } from "../src/application/reach-changes";
import { createReachChangeRepository } from "../src/db/reach-change-repository";
import type { ReachPolicy } from "../src/models/reach-changes";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";
import { reachFunctions } from "../src/db/reach-change-security";
import { createReachChangeHttp } from "../src/http/reach-changes";
import { campaignFixture } from "./support/campaigns";

const reachPolicy: ReachPolicy = {
  id: "synthetic-reach-policy",
  version: 1,
  mode: "test",
  reviewedBy: "deployment-operator",
  checkedAt: "2026-11-01T00:00:00.000Z",
  effectiveFrom: "2026-11-01T00:00:00.000Z",
  effectiveUntil: "2027-11-01T00:00:00.000Z",
  evidence: ["fixture:explicit-commercial-and-mandate-review"],
  previewSeconds: 600,
  proration: "remaining_calendar_seconds",
  rounding: "half_up",
  unusedUnits: "retain_consumed_add_prorated_difference",
  inFlightUnengaged: "pause_outside_target",
  nativeProration: {
    enabled: true,
    evidence: ["fixture:merchant-exact-proration-review"],
  },
  replacement: {
    enabled: true,
    stopOldBeforeCreate: true,
    evidence: ["fixture:explicit-replacement-terms"],
  },
};

describe("Approved reach changes at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  async function setup(
    country = "US",
    reduction = false,
    dates?: { start: string; end: string; at: string },
    capacity = false,
    nativeOptions: { targetCount?: number; replacementUrl?: string } = {},
  ) {
    const f = await subscriptionFixture(h, { country });
    await h.admin.query(
      "UPDATE business_file SET retention_until='2027-06-01' WHERE id=$1",
      [f.fileId],
    );
    if (dates) {
      h.clock.set(dates.start);
      f.owner = await h.signIn("tax-owner@example.com");
      f.operator = await h.signIn("tax-operator@example.com");
    }
    const native = financialNativeFixture(h.clock);
    native.afterPost = async () => {
      if (native.refunds.at(-1))
        native.refunds.at(-1)!.currency = country === "US" ? "USD" : "INR";
    };
    Object.assign(native.review, {
      internationalUpdates: "native_proration_reviewed",
    });
    native.review.plans.push({
      offerId: "expanded",
      reservedCapacityId: capacity ? "reserved" : null,
      currency: country === "US" ? "USD" : "INR",
      planId: country === "US" ? "plan_expandedUSD" : "plan_expandedINR",
      totalCount: nativeOptions.targetCount ?? 12,
    });
    native.review.plans.push({
      offerId: "further",
      reservedCapacityId: null,
      currency: "USD",
      planId: "plan_expandedFurtherUSD",
      totalCount: 12,
    });
    native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify(
      native.review,
    );
    const request = native.configuration.fetch;
    const effects: { path: string; body: unknown }[] = [];
    const conditions: {
      loseUpdate: boolean;
      failUpdate: boolean;
      paymentReads: number;
      beforeEffect?: () => Promise<void>;
      afterMutation?: () => Promise<void>;
    } = { loseUpdate: false, failUpdate: false, paymentReads: 0 };
    const orders = new Map<string, Record<string, unknown>>();
    native.configuration.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (
        url.pathname === "/v1/payments/pay_original" &&
        conditions.beforeEffect &&
        ++conditions.paymentReads === 2
      )
        await conditions.beforeEffect();
      if (url.pathname.startsWith("/v1/plans/plan_expanded"))
        return Response.json({
          id: url.pathname.split("/").at(-1),
          interval: 1,
          period: "monthly",
          item: {
            amount: url.pathname.endsWith("plan_expandedFurtherUSD")
              ? 8250
              : country === "US"
                ? reduction
                  ? 1375
                  : capacity
                    ? 6600
                    : 5500
                : reduction
                  ? 5500
                  : 22011,
            currency: country === "US" ? "USD" : "INR",
          },
        });
      if (url.pathname.endsWith("/retrieve_scheduled_changes"))
        return Response.json({
          ...native.subscriptions.get("sub_fixture1"),
          plan_id: "plan_expandedUSD",
          change_scheduled_at: 1796461200,
        });
      if (
        url.pathname === "/v1/subscriptions" &&
        init?.method === "POST" &&
        native.subscriptions.size
      ) {
        const body: unknown = JSON.parse(String(init.body));
        effects.push({ path: url.pathname, body });
        if (!body || typeof body !== "object")
          throw new Error("Invalid native mandate");
        const sub = {
          ...body,
          id: "sub_replacement",
          customer_id: null,
          status: "created",
          short_url:
            nativeOptions.replacementUrl ?? "https://rzp.io/i/replacement",
          created_at: Math.floor(h.clock.now().getTime() / 1000),
        };
        native.subscriptions.set(sub.id, sub);
        return Response.json(sub);
      }
      if (url.pathname === "/v1/orders" && init?.method === "POST") {
        const body: unknown = JSON.parse(String(init.body));
        effects.push({ path: url.pathname, body });
        if (!body || typeof body !== "object")
          throw new Error("Invalid native order");
        const order = {
          ...body,
          id: "order_separate",
          amount_paid: 0,
          amount_due: 5503,
          status: "created",
        };
        orders.set(order.id, order);
        return Response.json(order);
      }
      if (url.pathname === "/v1/orders")
        return Response.json({
          count: orders.size,
          items: [...orders.values()],
        });
      if (url.pathname === "/v1/orders/order_separate")
        return Response.json(orders.get("order_separate"));
      if (url.pathname === "/v1/orders/order_separate/payments")
        return Response.json({
          count: native.payments.has("pay_separate") ? 1 : 0,
          items: native.payments.has("pay_separate")
            ? [native.payments.get("pay_separate")]
            : [],
        });
      if (
        init?.method === "PATCH" &&
        url.pathname === "/v1/subscriptions/sub_fixture1"
      ) {
        const body: unknown = JSON.parse(String(init.body));
        effects.push({ path: url.pathname, body });
        expect(new Headers(init.headers).has("x-idempotency-key")).toBe(false);
        if (conditions.failUpdate)
          return Response.json(
            { error: { description: "fixture declined" } },
            { status: 400 },
          );
        if (!body || typeof body !== "object")
          throw new Error("Invalid update");
        const sub = native.subscriptions.get("sub_fixture1")!;
        if (
          "schedule_change_at" in body &&
          body.schedule_change_at === "cycle_end"
        )
          sub.has_scheduled_changes = true;
        else Object.assign(sub, body, { has_scheduled_changes: false });
        await conditions.afterMutation?.();
        if (conditions.loseUpdate)
          throw new Error("Lost update acknowledgement");
        return Response.json(sub);
      }
      const response = await request(input, init);
      if (
        native.loseCancellation &&
        init?.method === "POST" &&
        url.pathname.endsWith("/cancel")
      )
        throw new Error("Lost cancellation acknowledgement");
      return response;
    };
    const database = runtimeDatabase(h.runtime);
    const gateway = configuredPayments(native.configuration);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(database),
      gateway,
      clock: h.clock,
    });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_original",
      dates?.start ?? "2026-11-05T09:00:00.000Z",
      dates?.end ?? "2026-12-05T09:00:00.000Z",
      country === "US" ? "USD" : "INR",
    );
    Object.assign(native.subscriptions.get("sub_fixture1")!, {
      remaining_count: 11,
    });
    await payments.refresh(f.owner, f.business.id, { actionId: action.id });
    const original = (await payments.workspace(f.owner, f.business.id))
      .periods[0];
    const offer = f.quote.pricing.offer;
    if (capacity) {
      const rules = await f.tax.saveRule(f.operator, {
        key: "reserved-tax",
        expectedVersion: 0,
        note: "Synthetic capacity tax",
        rule: {
          ...f.rules.revisions[0].rule,
          productCode: "reserved_capacity",
        },
      });
      await f.tax.decideRule(f.operator, {
        revisionId: rules.revisions.find(
          (r) => r.rule.productCode === "reserved_capacity",
        )!.id,
        expectedDecisionVersion: 0,
        outcome: "approved",
        note: "Synthetic capacity review",
      });
    }
    await f.quotes.configure(f.operator, {
      expectedVersion: 1,
      effectiveFrom: null,
      note: "Synthetic changed terms",
      offers: [
        {
          ...offer,
          id: "expanded",
          label: "Changed reach",
          markets: reduction ? ["Pune"] : ["Pune", "United States", "Canada"],
          discovery: { quantity: reduction ? 50 : 200, unit: "research units" },
          automation: {
            quantity: reduction ? 50 : 200,
            unit: "provider calls",
          },
          prices: {
            INR: { monthlyMinor: reduction ? 5000 : 20010, pilotMinor: null },
            USD: { monthlyMinor: reduction ? 1250 : 5000, pilotMinor: null },
          },
          pilot: null,
          reservedCapacity: capacity
            ? [
                {
                  id: "reserved",
                  label: "Reserved execution",
                  capacity: { quantity: 2, unit: "concurrent runs" },
                  prices: {
                    USD: { monthlyMinor: 1000, pilotMinor: null },
                    INR: null,
                  },
                },
              ]
            : [],
        },
      ],
    });
    const target = await f.quotes.createQuote(f.owner, f.business.id, {
      offerId: "expanded",
      reservedCapacityId: capacity ? "reserved" : null,
      term: "monthly",
      expectedCatalogVersion: 2,
      expectedBillingVersion: 1,
      expectedReviewVersion: 1,
      requestKey: randomUUID(),
    });
    h.clock.set(dates?.at ?? "2026-11-20T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    const operator = await h.signIn("tax-operator@example.com");
    const changes = createReachChangeApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createReachChangeRepository(database),
      gateway,
      policy: reachPolicy,
      clock: h.clock,
    });
    const captureDelta = () => {
      native.invoices.push({
        id: "inv_delta",
        subscription_id: "sub_fixture1",
        customer_id: "cust_fixture",
        payment_id: "pay_delta",
        order_id: "order_delta",
        status: "paid",
        currency: "USD",
        amount: capacity ? 1925 : 1375,
        amount_paid: capacity ? 1925 : 1375,
        amount_due: 0,
        billing_start: 1795165200,
        billing_end: 1796461200,
        paid_at: Math.floor(h.clock.now().getTime() / 1000),
        line_items: [
          {
            type: "plan",
            quantity: 1,
            amount: capacity ? 1925 : 1375,
            currency: "USD",
          },
        ],
      });
      native.payments.set("pay_delta", {
        id: "pay_delta",
        customer_id: "cust_fixture",
        invoice_id: "inv_delta",
        order_id: "order_delta",
        status: "captured",
        captured: true,
        method: "card",
        international: true,
        amount: capacity ? 1925 : 1375,
        currency: "USD",
        amount_refunded: 0,
        fee: 1,
        tax: 0,
        base_amount: 115000,
        base_currency: "INR",
      });
    };
    async function authenticateReplacement() {
      const sub = native.subscriptions.get("sub_replacement")!;
      Object.assign(sub, {
        status: "authenticated",
        customer_id: "cust_fixture",
      });
      native.payments.set("pay_auth", {
        id: "pay_auth",
        customer_id: "cust_fixture",
        invoice_id: null,
        order_id: null,
        status: "refunded",
        captured: true,
        method: "card",
        international: country === "US",
        amount: 100,
        currency: country === "US" ? "USD" : "INR",
        amount_refunded: 100,
      });
      const body = new TextEncoder().encode(
        JSON.stringify({
          account_id: native.review.account,
          event: "subscription.authenticated",
          created_at: 1795165200,
          payload: {
            subscription: { entity: sub },
            payment: { entity: { id: "pay_auth" } },
          },
        }),
      );
      await payments.event({
        body,
        headers: new Headers({
          "x-razorpay-event-id": "event_auth",
          "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
            .update(body)
            .digest("hex"),
        }),
      });
    }
    return {
      ...f,
      owner,
      operator,
      native,
      payments,
      changes,
      original,
      action,
      target: target.snapshot,
      gateway,
      effects,
      conditions,
      captureDelta,
      authenticateReplacement,
      orders,
    };
  }
  it("freezes the exact approved calendar proration, tax and effective scope without granting reach", async () => {
    const f = await setup();
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.snapshot.version).toBe(1);
    expect(preview.snapshot.delta.tax.totals).toEqual({
      netMinor: "1250",
      taxMinor: "125",
      totalMinor: "1375",
    });
    expect(preview.snapshot.scope.discovery).toEqual({
      quantity: 150,
      unit: "research units",
    });
    expect(preview.snapshot.proration).toMatchObject({
      numerator: "1296000000",
      denominator: "2592000000",
      rounding: "half_up",
    });
    expect(preview.snapshot.path).toBe("international_native");
    expect(preview.state).toBe("preview");
    const workspace = await f.payments.workspace(f.owner, f.business.id);
    expect(workspace.allowances?.discovery.included).toBe(100);
    expect(workspace.periods).toEqual([f.original]);
  });
  it("prorates the real January-31 to February-28 UTC calendar period without assuming thirty days", async () => {
    const f = await setup("US", false, {
      start: "2027-01-31T09:00:00.000Z",
      end: "2027-02-28T09:00:00.000Z",
      at: "2027-02-14T09:00:00.000Z",
    });
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.snapshot.proration).toMatchObject({
      numerator: "1209600000",
      denominator: "2419200000",
    });
    expect(preview.snapshot.delta.tax.totals).toEqual({
      netMinor: "1250",
      taxMinor: "125",
      totalMinor: "1375",
    });
    expect(preview.snapshot.original.end).toBe("2027-02-28T09:00:00.000Z");
  });
  it("requires explicit approval and actual corresponding capture; lost acknowledgement never repeats the upgrade", async () => {
    const f = await setup();
    await campaignFixture(h, {
      at: h.clock.now().toISOString(),
      businessContext: { owner: f.owner, business: f.business },
      market: "United States",
      discoveryUnit: "research units",
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances
        ?.discovery,
    ).toMatchObject({ included: 100, reserved: 2, remaining: 98 });
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.conditions.loseUpdate = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
    f.captureDelta();
    const reconciled = await f.changes.refresh(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(reconciled.events.map((e) => e.fact)).toContainEqual(
      expect.objectContaining({ kind: "capture" }),
    );
    const workspace = await f.payments.workspace(f.owner, f.business.id);
    expect(workspace.allowances?.discovery.included).toBe(150);
    expect(preview.snapshot.consumed.discovery).toBe(2);
    expect(workspace.allowances?.discovery).toMatchObject({
      included: 150,
      reserved: 2,
      remaining: 148,
    });
    expect(workspace.effectiveContract).toMatchObject({
      periodId: f.original.id,
      changeId: preview.id,
      offerId: "expanded",
      markets: ["Pune", "United States", "Canada"],
      reservedCapacity: null,
    });
    expect(JSON.stringify(workspace.effectiveContract)).not.toMatch(
      /invoiceContact|billingReview|prices|recovery/,
    );
    expect(workspace.periods.find((p) => p.id === f.original.id)).toEqual(
      f.original,
    );
    const delta = workspace.periods.find((p) => p.snapshot.adjustment);
    expect(delta?.paymentId).toBe("pay_delta");
    expect(delta?.snapshot.tax.totals).toEqual({
      netMinor: "1250",
      taxMinor: "125",
      totalMinor: "1375",
    });
    expect(f.effects).toHaveLength(1);
  });
  it.each(["US", "IN"])(
    "invoices and refunds the immutable %s delta using its own original tax and cash basis, retracting only the expansion",
    async (country) => {
      const f = await setup(country);
      const c = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
      await f.changes.approve(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: c.reviewHash,
      });
      await f.changes.execute(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      });
      if (country === "US") f.captureDelta();
      else {
        await f.authenticateReplacement();
        await f.changes.execute(f.owner, f.business.id, {
          changeId: c.id,
          requestKey: randomUUID(),
        });
        Object.assign(f.orders.get("order_separate")!, {
          status: "paid",
          amount_paid: 5503,
          amount_due: 0,
        });
        f.native.payments.set("pay_separate", {
          id: "pay_separate",
          customer_id: "cust_fixture",
          invoice_id: null,
          order_id: "order_separate",
          status: "captured",
          captured: true,
          method: "card",
          international: false,
          amount: 5503,
          currency: "INR",
          amount_refunded: 0,
          created_at: 1795165200,
        });
      }
      await f.changes.refresh(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      });
      let before = await f.payments.workspace(f.owner, f.business.id);
      const delta = before.periods.find((p) => p.snapshot.adjustment)!;
      expect(before.allowances?.discovery.included).toBe(150);
      if (country === "US") {
        h.clock.set("2026-11-20T09:01:00.000Z");
        await f.quotes.configure(f.operator, {
          expectedVersion: 2,
          effectiveFrom: null,
          note: "Synthetic further reach",
          offers: [
            {
              ...f.target.pricing.offer,
              id: "further",
              markets: ["Pune", "United States", "Canada", "Mexico"],
              discovery: { quantity: 300, unit: "research units" },
              automation: { quantity: 300, unit: "provider calls" },
              prices: {
                USD: { monthlyMinor: 7500, pilotMinor: null },
                INR: null,
              },
            },
          ],
        });
        const quote = await f.quotes.createQuote(f.owner, f.business.id, {
          offerId: "further",
          reservedCapacityId: null,
          term: "monthly",
          expectedCatalogVersion: 3,
          expectedBillingVersion: 1,
          expectedReviewVersion: 1,
          requestKey: randomUUID(),
        });
        const further = await f.changes.preview(f.owner, f.business.id, {
          periodId: f.original.id,
          quoteId: quote.snapshot.id,
          requestKey: randomUUID(),
        });
        await f.changes.approve(f.owner, f.business.id, {
          changeId: further.id,
          requestKey: randomUUID(),
          accept: true,
          reviewHash: further.reviewHash,
        });
        await f.changes.execute(f.owner, f.business.id, {
          changeId: further.id,
          requestKey: randomUUID(),
        });
        f.native.invoices.push({
          ...f.native.invoices.find((i) => i.id === "inv_delta")!,
          id: "inv_further",
          payment_id: "pay_further",
          order_id: "order_further",
          billing_start: 1795165260,
          paid_at: 1795165260,
        });
        f.native.payments.set("pay_further", {
          ...f.native.payments.get("pay_delta")!,
          id: "pay_further",
          invoice_id: "inv_further",
          order_id: "order_further",
        });
        await f.changes.refresh(f.owner, f.business.id, {
          changeId: further.id,
          requestKey: randomUUID(),
        });
        before = await f.payments.workspace(f.owner, f.business.id);
        expect(before.allowances?.discovery.included).toBe(200);
      }
      const op = await h.signIn("delta-refunds@example.com"),
        actor = await h.authenticate(op);
      await h.admin.query(
        "insert into platform_operator(user_id,refunds,documents) values($1,true,true)",
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
      const configuration = {
        ...fixtureIssuer,
        currencies: [
          {
            ...fixtureIssuer.currencies[0],
            currency: country === "US" ? "USD" : "INR",
          },
        ],
      };
      const issuer = await documents.saveIssuer(op, {
        expectedVersion: 0,
        configuration,
        note: "Synthetic delta issuer",
      });
      await documents.decideIssuer(op, {
        revisionId: issuer.revisions[0].id,
        expectedVersion: 0,
        outcome: "approved",
        note: "Synthetic reviewed issuer",
      });
      const original = await documents.issue(f.owner, f.business.id, {
        periodId: f.original.id,
        requestKey: randomUUID(),
      });
      const invoice = await documents.issue(f.owner, f.business.id, {
        periodId: delta.id,
        requestKey: randomUUID(),
      });
      expect(invoice.snapshot.totals).toEqual(
        country === "US"
          ? { netMinor: "1250", taxMinor: "125", totalMinor: "1375" }
          : { netMinor: "5003", taxMinor: "500", totalMinor: "5503" },
      );
      const app = createFinancialAdjustmentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createFinancialAdjustmentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredFinancialAdjustments(f.native.configuration),
        documents,
      });
      const reviewed = await app.review(op, f.business.id, {
        kind: "refund",
        invoiceId: invoice.id,
        requestKey: randomUUID(),
        lines: [
          {
            lineId: "subscription",
            netMinor: country === "US" ? "1250" : "5003",
          },
        ],
        reason: "Approved full delta refund",
        evidence: ["fixture:delta-refund-review"],
      });
      await app.execute(op, f.business.id, { caseId: reviewed.id });
      expect(f.native.refundPosts).toHaveLength(1);
      f.native.refunds[0].status = "processed";
      await app.recover();
      const credited = await app.credit(op, f.business.id, {
        caseId: reviewed.id,
      });
      expect(credited).toMatchObject({
        state: "processed",
        access: "block_period",
        creditDocumentId: expect.any(String),
      });
      expect(await app.financialFeed(f.operator)).toMatchObject([
        {
          effect: {
            actualMinor: country === "US" ? "1375" : "5503",
            allocation: { totals: invoice.snapshot.totals },
          },
          approvedCredit: null,
        },
      ]);
      const after = await f.payments.workspace(f.owner, f.business.id);
      expect(after.access.active).toBe(true);
      expect(after.allowances?.discovery.included).toBe(100);
      expect(after.effectiveContract?.changeId).toBe(null);
      expect(after.periods).toEqual(before.periods);
      const history = await documents.workspace(f.owner, f.business.id);
      expect(
        history.documents.find((d) => d.id === original.id)?.snapshot,
      ).toEqual(original.snapshot);
      expect(
        history.documents.find((d) => d.kind === "credit_note")?.snapshot
          .totals,
      ).toEqual(invoice.snapshot.totals);
      await app.execute(op, f.business.id, { caseId: reviewed.id });
      expect(f.native.refundPosts).toHaveLength(1);
    },
  );
  it("renews the approved native target using its full captured price without rewriting the original or counting the delta as another term", async () => {
    const f = await setup();
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    f.captureDelta();
    await f.changes.refresh(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    h.clock.set("2026-12-05T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    f.native.charge(
      "pay_newterm",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "USD",
    );
    const invoice = f.native.invoices.at(-1)!;
    Object.assign(invoice, {
      amount: 5500,
      amount_paid: 5500,
      line_items: [
        { type: "plan", quantity: 1, amount: 5500, currency: "USD" },
      ],
    });
    Object.assign(f.native.payments.get("pay_newterm")!, { amount: 5500 });
    await f.payments.refresh(owner, f.business.id, { actionId: f.action.id });
    await f.changes.recover();
    const workspace = await f.payments.workspace(owner, f.business.id);
    expect(workspace.allowances?.discovery.included).toBe(200);
    expect(workspace.access.period?.paymentId).toBe("pay_newterm");
    expect(workspace.periods.find((p) => p.id === f.original.id)).toEqual(
      f.original,
    );
    expect(workspace.access.period?.snapshot.tax.totals?.totalMinor).toBe(
      "5500",
    );
  });
  it("renews an approved reserved-capacity target with its own tax product and canonical effective capacity", async () => {
    const f = await setup("US", false, undefined, true);
    const c = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(c.snapshot.delta.tax.totals).toEqual({
      netMinor: "1750",
      taxMinor: "175",
      totalMinor: "1925",
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: c.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    f.captureDelta();
    await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).effectiveContract
        ?.reservedCapacity,
    ).toEqual({
      id: "reserved",
      label: "Reserved execution",
      capacity: { quantity: 2, unit: "concurrent runs" },
    });
    h.clock.set("2026-12-05T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    f.native.charge(
      "pay_capacityrenewal",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "USD",
    );
    Object.assign(f.native.invoices.at(-1)!, {
      amount: 6600,
      amount_paid: 6600,
      line_items: [
        { type: "plan", quantity: 1, amount: 6600, currency: "USD" },
      ],
    });
    Object.assign(f.native.payments.get("pay_capacityrenewal")!, {
      amount: 6600,
    });
    await f.payments.refresh(owner, f.business.id, { actionId: f.action.id });
    await f.changes.recover();
    const renewed = await f.payments.workspace(owner, f.business.id);
    expect(renewed.access.period?.paymentId).toBe("pay_capacityrenewal");
    expect(renewed.access.period?.snapshot.tax.totals).toEqual({
      netMinor: "6000",
      taxMinor: "600",
      totalMinor: "6600",
    });
    expect(renewed.effectiveContract?.reservedCapacityId).toBe("reserved");
    expect(renewed.periods.find((p) => p.id === f.original.id)).toEqual(
      f.original,
    );
  });
  it("keeps reductions pending until the actual eligible captured renewal and preserves the original financial history", async () => {
    const f = await setup("US", true);
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.snapshot.direction).toBe("reduction");
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects[0]?.body).toMatchObject({
      schedule_change_at: "cycle_end",
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    h.clock.set("2026-12-05T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    await f.changes.recover();
    expect(
      (await f.payments.workspace(owner, f.business.id)).access.active,
    ).toBe(false);
    Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
      plan_id: "plan_expandedUSD",
      has_scheduled_changes: false,
    });
    f.native.charge(
      "pay_reduced",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "USD",
    );
    Object.assign(f.native.invoices.at(-1)!, {
      amount: 1375,
      amount_paid: 1375,
      line_items: [
        { type: "plan", quantity: 1, amount: 1375, currency: "USD" },
      ],
    });
    Object.assign(f.native.payments.get("pay_reduced")!, { amount: 1375 });
    await f.payments.refresh(owner, f.business.id, { actionId: f.action.id });
    await f.changes.recover();
    const workspace = await f.payments.workspace(owner, f.business.id);
    expect(workspace.allowances?.discovery.included).toBe(50);
    expect(workspace.periods.find((p) => p.id === f.original.id)).toEqual(
      f.original,
    );
    expect(
      (await f.changes.workspace(owner, f.business.id)).changes[0].state,
    ).toBe("applied");
  });
  it("uses a separate domestic payment and genuine future mandate only after stopping the old renewal; authentication never grants reach", async () => {
    const f = await setup("IN");
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.snapshot.path).toBe("replacement_mandate");
    expect(preview.snapshot.delta.tax.totals?.totalMinor).toBe("5503");
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(
      f.native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(1);
    expect(
      f.effects.filter((e) => e.path === "/v1/subscriptions"),
    ).toHaveLength(1);
    expect(
      f.effects.find((e) => e.path === "/v1/subscriptions")?.body,
    ).toMatchObject({ start_at: 1796461200, plan_id: "plan_expandedINR" });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    await f.authenticateReplacement();
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects.filter((e) => e.path === "/v1/orders")).toHaveLength(1);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    Object.assign(f.orders.get("order_separate")!, {
      status: "paid",
      amount_paid: 5503,
      amount_due: 0,
    });
    f.native.payments.set("pay_separate", {
      id: "pay_separate",
      customer_id: "cust_fixture",
      invoice_id: null,
      order_id: "order_separate",
      status: "captured",
      captured: true,
      method: "card",
      international: false,
      amount: 5503,
      currency: "INR",
      amount_refunded: 0,
      created_at: 1795165200,
    });
    await f.changes.refresh(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    const workspace = await f.payments.workspace(f.owner, f.business.id);
    expect(workspace.allowances?.discovery.included).toBe(150);
    expect(
      workspace.periods.find((p) => p.paymentId === "pay_separate")?.charge
        ?.charge?.invoiceId,
    ).toBe(null);
    expect(
      f.effects.filter((e) => e.path === "/v1/subscriptions/sub_fixture1"),
    ).toHaveLength(0);
    h.clock.set("2026-12-05T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    f.native.charge(
      "pay_oldunexpected",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "INR",
    );
    await f.payments.refresh(owner, f.business.id, { actionId: f.action.id });
    expect(
      (await f.payments.workspace(owner, f.business.id)).access.active,
    ).toBe(false);
    Object.assign(f.native.subscriptions.get("sub_replacement")!, {
      status: "active",
      current_start: 1796461200,
      current_end: 1799139600,
    });
    f.native.invoices.push({
      id: "inv_replacement",
      subscription_id: "sub_replacement",
      customer_id: "cust_fixture",
      payment_id: "pay_replacement",
      order_id: "order_replacement",
      status: "paid",
      currency: "INR",
      amount: 22011,
      amount_paid: 22011,
      amount_due: 0,
      billing_start: 1796461200,
      billing_end: 1799139600,
      paid_at: 1796461200,
      line_items: [
        { type: "plan", quantity: 1, amount: 22011, currency: "INR" },
      ],
    });
    f.native.payments.set("pay_replacement", {
      id: "pay_replacement",
      customer_id: "cust_fixture",
      invoice_id: "inv_replacement",
      order_id: "order_replacement",
      status: "captured",
      captured: true,
      method: "card",
      international: false,
      amount: 22011,
      currency: "INR",
      amount_refunded: 0,
    });
    await f.payments.refresh(owner, f.business.id, {
      actionId: preview.snapshot.replacementActionId,
    });
    await f.changes.recover();
    const renewed = await f.payments.workspace(owner, f.business.id);
    expect(renewed.access.period?.paymentId).toBe("pay_replacement");
    expect(renewed.allowances?.discovery.included).toBe(200);
  });
  it.each([
    ["approved boundary", 1796461200, true],
    ["unapproved early end", 1796461199, false],
  ] as const)(
    "applies a captured domestic reduction renewal only for its own old stop at the %s",
    async (_reason, endedAt, eligible) => {
      const f = await setup("IN", true);
      f.gateway.lifecyclePolicy = {
        id: "synthetic-lifecycle-policy",
        version: 1,
        mode: "test",
        reviewedBy: "deployment-operator",
        checkedAt: "2026-11-01T00:00:00.000Z",
        effectiveFrom: "2026-11-01T00:00:00.000Z",
        effectiveUntil: "2028-01-01T00:00:00.000Z",
        evidence: ["fixture:reviewed-customer-terms"],
        graceSeconds: 86400,
        graceAccess: "remaining_allowance",
        cancellationTiming: "cycle_end",
        cancellationAccess: "paid_through",
        preserveRecords: true,
      };
      const preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
      expect(preview.snapshot.direction).toBe("reduction");
      await f.changes.approve(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: preview.reviewHash,
      });
      await f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      });
      await f.authenticateReplacement();
      await f.changes.recover();
      expect(
        (await f.payments.workspace(f.owner, f.business.id)).allowances
          ?.discovery.included,
      ).toBe(100);
      h.clock.set("2026-12-05T09:00:00.000Z");
      const owner = await h.signIn("tax-owner@example.com");
      Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
        status: "cancelled",
        ended_at: endedAt,
      });
      const stopped = await f.payments.refresh(owner, f.business.id, {
        actionId: f.action.id,
      });
      expect(stopped.lifecycle?.state).toBe("cancelled");
      Object.assign(f.native.subscriptions.get("sub_replacement")!, {
        status: "active",
        current_start: 1796461200,
        current_end: 1799139600,
      });
      f.native.invoices.push({
        id: "inv_replacement",
        subscription_id: "sub_replacement",
        customer_id: "cust_fixture",
        payment_id: "pay_replacement",
        order_id: "order_replacement",
        status: "paid",
        currency: "INR",
        amount: 5500,
        amount_paid: 5500,
        amount_due: 0,
        billing_start: 1796461200,
        billing_end: 1799139600,
        paid_at: 1796461200,
        line_items: [
          { type: "plan", quantity: 1, amount: 5500, currency: "INR" },
        ],
      });
      f.native.payments.set("pay_replacement", {
        id: "pay_replacement",
        customer_id: "cust_fixture",
        invoice_id: "inv_replacement",
        order_id: "order_replacement",
        status: "captured",
        captured: true,
        method: "card",
        international: false,
        amount: 5500,
        currency: "INR",
        amount_refunded: 0,
      });
      await f.payments.refresh(owner, f.business.id, {
        actionId: preview.snapshot.replacementActionId,
      });
      await f.changes.recover();
      const renewed = await f.payments.workspace(owner, f.business.id);
      expect(renewed.access.period?.paymentId).toBe(
        eligible ? "pay_replacement" : undefined,
      );
      expect(renewed.allowances?.discovery.included).toBe(
        eligible ? 50 : undefined,
      );
      expect(
        renewed.periods.some((p) => p.paymentId === "pay_replacement"),
      ).toBe(true);
      expect(
        renewed.actions.find((a) => a.id === f.action.id)?.lifecycle?.state,
      ).toBe("cancelled");
      expect(renewed.periods.find((p) => p.id === f.original.id)).toEqual(
        f.original,
      );
      expect(f.effects.filter((e) => e.path === "/v1/orders")).toHaveLength(0);
      expect(
        f.effects.filter((e) => e.path === "/v1/subscriptions"),
      ).toHaveLength(1);
    },
  );
  it("accepts the documented replacement subscription link without treating its URL or authentication as payment", async () => {
    const f = await setup("IN", false, undefined, false, {
      replacementUrl: "https://rzp.io/rzp/Dqdqx3h",
    });
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    const result = await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(
      result.events.filter((e) => e.fact.native).at(-1)?.fact.native
        ?.subscriptionId,
    ).toBe("sub_replacement");
    expect(
      await f.changes.checkout(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
        purpose: "mandate",
      }),
    ).toMatchObject({
      kind: "mandate",
      subscription_id: "sub_replacement",
      customer_id: "cust_fixture",
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    await f.authenticateReplacement();
    await f.changes.recover();
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    expect(
      f.effects.filter((e) => e.path === "/v1/subscriptions"),
    ).toHaveLength(1);
  });
  it.each([
    "https://evil.example/i/replacement",
    "https://rzp.io.evil.example/i/replacement",
    "https://user:password@rzp.io/i/replacement",
    "https://rzp.io/i/replacement?redirect=evil",
    "https://rzp.io/i/replacement#fragment",
    "https://rzp.io/unreviewed/replacement",
  ])(
    "rejects an unsafe replacement subscription link %s without duplicate mandate creation",
    async (replacementUrl) => {
      const f = await setup("IN", false, undefined, false, { replacementUrl });
      const preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
      await f.changes.approve(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: preview.reviewHash,
      });
      await f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      });
      await expect(
        f.changes.checkout(f.owner, f.business.id, {
          changeId: preview.id,
          requestKey: randomUUID(),
          purpose: "mandate",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      });
      expect(
        f.effects.filter((e) => e.path === "/v1/subscriptions"),
      ).toHaveLength(1);
      expect(
        (await f.payments.workspace(f.owner, f.business.id)).allowances
          ?.discovery.included,
      ).toBe(100);
    },
  );
  it("previews and approves the replacement target collection count rather than the old subscription duration", async () => {
    const f = await setup("IN", false, undefined, false, { targetCount: 6 });
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.events.at(-1)?.fact.native).toMatchObject({
      totalCount: 6,
      remainingCount: 11,
    });
    const approved = await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    expect(
      approved.events.find((e) => e.fact.kind === "approved")?.fact.native
        ?.totalCount,
    ).toBe(6);
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(
      f.effects.find((e) => e.path === "/v1/subscriptions")?.body,
    ).toMatchObject({
      total_count: 6,
      start_at: 1796461200,
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
  });
  it("binds approval to the exact native duration and frozen review; a changed duration cannot issue the native mutation", async () => {
    const f = await setup();
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(preview.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.events.at(-1)?.fact.native?.remainingCount).toBe(11);
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
      remaining_count: 10,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(0);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
  });
  it("withdraws only a proven unsent approval so a fresh exact review can proceed, retaining the old request and forbidding its execution", async () => {
    const f = await setup(),
      input = {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      },
      preview = await f.changes.preview(f.owner, f.business.id, input);
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
      remaining_count: 10,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(0);
    expect(
      (
        await f.changes.withdraw(f.owner, f.business.id, {
          changeId: preview.id,
          requestKey: randomUUID(),
        })
      ).state,
    ).toBe("withdrawn");
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await f.changes.preview(f.owner, f.business.id, {
      ...input,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: next.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: next.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: next.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
    await expect(
      f.changes.withdraw(f.owner, f.business.id, {
        changeId: next.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.changes.workspace(f.owner, f.business.id)).changes,
    ).toHaveLength(2);
  });
  it("allows ordinary cancellation after withdrawing a domestic change whose old-stop effect was proven unsent", async () => {
    const f = await setup("IN");
    const c = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: c.reviewHash,
    });
    const actor = await h.authenticate(f.owner);
    f.conditions.beforeEffect = async () => {
      await h.admin.query(
        "update membership set role='salesperson' where business_id=$1 and user_id=$2",
        [f.business.id, actor.userId],
      );
    };
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "update membership set role='owner' where business_id=$1 and user_id=$2",
      [f.business.id, actor.userId],
    );
    const withdrawn = await f.changes.withdraw(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(withdrawn.state).toBe("withdrawn");
    expect(
      f.native.requests.filter((r) => r.path.endsWith("/cancel")),
    ).toHaveLength(0);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: configuredPayments({
        ...f.native.configuration,
        env: {
          ...f.native.configuration.env,
          SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
            id: "fixture-cancellation-policy",
            version: 1,
            mode: "test",
            reviewedBy: "deployment-operator",
            checkedAt: "2026-11-01T00:00:00.000Z",
            effectiveFrom: "2026-11-01T00:00:00.000Z",
            effectiveUntil: "2027-11-01T00:00:00.000Z",
            evidence: ["fixture:explicit-cancellation"],
            graceSeconds: 0,
            graceAccess: "none",
            cancellationTiming: "cycle_end",
            cancellationAccess: "paid_through",
            preserveRecords: true,
          }),
        },
      }),
    });
    const cancelled = await payments.cancel(f.owner, f.business.id, {
      actionId: f.action.id,
      requestKey: randomUUID(),
    });
    expect(cancelled.lifecycle?.cancellation?.status).toBe("confirmed");
    expect(
      f.native.requests.filter((r) => r.path.endsWith("/cancel")),
    ).toHaveLength(1);
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("binds every request UUID to its original actor while another current operator can execute using its own action", async () => {
    const f = await setup(),
      request = {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      };
    const preview = await f.changes.preview(f.owner, f.business.id, request);
    expect((await f.changes.preview(f.owner, f.business.id, request)).id).toBe(
      preview.id,
    );
    const approval = {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    };
    await f.changes.approve(f.owner, f.business.id, approval);
    const other = await h.signIn("another-operator@example.com");
    await h.provisionOperator(other, { tax: false, reconciliation: true });
    const execute = { changeId: preview.id, requestKey: randomUUID() };
    await f.changes.execute(f.owner, f.business.id, execute);
    await expect(
      f.changes.operatorExecute(other, f.business.id, execute),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.changes.operatorExecute(other, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
    const otherBusiness = await h.application.createBusiness(other, {
      name: "Other",
      offering: "Steel",
      homeMarket: "Pune",
      website: "",
    });
    await expect(
      f.changes.workspace(f.owner, otherBusiness.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.changes.approve(other, f.business.id, approval),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not repeat a failed or unknown native upgrade and rejects mismatched captured money", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.conditions.failUpdate = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
    f.captureDelta();
    Object.assign(f.native.payments.get("pay_delta")!, { amount: 1376 });
    await f.changes.recover();
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.original]);
  });
  it("rechecks current Business authority after native reads and allows a different operator to resume the proven unsent stage", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    const actor = await h.authenticate(f.owner);
    f.conditions.beforeEffect = async () => {
      await h.admin.query(
        "UPDATE membership SET role='salesperson' WHERE user_id=$1 AND business_id=$2",
        [actor.userId, f.business.id],
      );
    };
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.effects).toHaveLength(0);
    f.conditions.beforeEffect = undefined;
    await f.changes.operatorExecute(f.operator, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(1);
  });
  it("reconciles an already changed native target and its exact paid delta during preflight without another PATCH", async () => {
    const f = await setup();
    const c = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: c.reviewHash,
    });
    f.conditions.beforeEffect = async () => {
      Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
        plan_id: "plan_expandedUSD",
      });
      f.captureDelta();
    };
    const result = await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(result.state).toBe("applied");
    expect(f.effects).toHaveLength(0);
    const paid = await f.payments.workspace(f.owner, f.business.id);
    expect(
      paid.periods.filter((p) => p.paymentId === "pay_delta"),
    ).toHaveLength(1);
    expect(paid.allowances?.discovery.included).toBe(150);
  });
  it("rechecks the effective native account review immediately before mutation after external reads", async () => {
    const f = await setup();
    Object.assign(f.gateway.review!, {
      id: "short-current-review",
      version: 2,
      effectiveUntil: "2026-11-20T09:00:01.000Z",
    });
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.conditions.beforeEffect = async () => {
      h.clock.set("2026-11-20T09:00:02.000Z");
    };
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.effects).toHaveLength(0);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.original]);
  });
  it("rechecks current operator MFA after native reads and protects final disclosure", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.conditions.beforeEffect = async () => {
      h.clock.set("2026-11-20T09:16:00.000Z");
    };
    await expect(
      f.changes.operatorExecute(f.operator, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.effects).toHaveLength(0);
  });
  it("recovers incurred native money independently of a revoked initiating session without disclosing it to that session", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    const actor = await h.authenticate(f.owner);
    f.conditions.afterMutation = async () => {
      await h.admin.query(
        "UPDATE membership SET role='salesperson' WHERE user_id=$1 AND business_id=$2",
        [actor.userId, f.business.id],
      );
    };
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.captureDelta();
    await f.changes.recover();
    await expect(
      f.changes.workspace(f.owner, f.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "UPDATE membership SET role='owner' WHERE user_id=$1 AND business_id=$2",
      [actor.userId, f.business.id],
    );
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(150);
    expect(f.effects).toHaveLength(1);
  });
  it("preserves an incurred canonical delta after the initiating account review becomes obsolete without executing another native effect", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.conditions.loseUpdate = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    f.captureDelta();
    f.gateway.review!.effectiveUntil = "2026-11-19T00:00:00.000Z";
    await f.changes.recover();
    const workspace = await f.payments.workspace(f.owner, f.business.id);
    expect(
      workspace.periods.find((p) => p.paymentId === "pay_delta")?.snapshot.tax
        .totals?.totalMinor,
    ).toBe("1375");
    expect(workspace.allowances?.discovery.included).toBe(100);
    expect(f.effects).toHaveLength(1);
  });
  it("uses trusted database time for approval expiry and leaves an unknown campaign disposition gated", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await h.admin.query(
      "UPDATE reach_change SET expires_at=statement_timestamp()-interval '1 second' WHERE id=$1",
      [preview.id],
    );
    await expect(
      f.changes.approve(f.owner, f.business.id, {
        changeId: preview.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: preview.reviewHash,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const gated = createReachChangeApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createReachChangeRepository(runtimeDatabase(h.runtime)),
      gateway: f.gateway,
      policy: { ...reachPolicy, inFlightUnengaged: "unknown" },
      clock: h.clock,
    });
    await expect(
      gated.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    expect(f.effects).toHaveLength(0);
  });
  it("keeps lost old-cancellation acknowledgement unresolved without creating a second mandate or repeating cancellation", async () => {
    const f = await setup("IN"),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    f.native.loseCancellation = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    await f.changes.recover();
    expect(
      f.native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(1);
    expect(f.effects).toHaveLength(0);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toEqual([f.original]);
  });
  it("rejects unselected native mandate methods and never treats an authentication token as a delta payment", async () => {
    const f = await setup("IN"),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    await f.authenticateReplacement();
    Object.assign(f.native.payments.get("pay_auth")!, { method: "upi" });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    expect(f.orders.size).toBe(0);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(100);
  });
  it("preserves populated financial sources and managed unique/composite scopes through actual isolated reapplication", async () => {
    const f = await setup(),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    f.captureDelta();
    await f.changes.recover();
    const before = await f.payments.workspace(f.owner, f.business.id),
      changes = await f.changes.workspace(f.owner, f.business.id);
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(await f.payments.workspace(f.owner, f.business.id)).toEqual(before);
    expect(await f.changes.workspace(f.owner, f.business.id)).toEqual(changes);
    expect(
      (
        await h.admin.query(
          "SELECT count(*)::int AS n FROM pg_constraint WHERE convalidated AND conname=ANY($1)",
          [
            [
              "reach_change_period_scope",
              "reach_change_action_scope",
              "reach_change_quote_scope",
              "reach_change_event_scope",
            ],
          ],
        )
      ).rows[0].n,
    ).toBe(4);
    expect(
      (
        await h.runtime.query(
          "SELECT public.reach_current_context($1::uuid,$2::uuid) AS context",
          [preview.id, f.business.id],
        )
      ).rows[0].context,
    ).toBe(null);
    expect((await h.runtime.query("SELECT * FROM reach_change")).rows).toEqual(
      [],
    );
  });
  for (const table of ["reach_change", "reach_change_event"])
    for (const privilege of ["SELECT", "INSERT"])
      it(`requires the individual ${privilege} grant on ${table}`, async () => {
        await h.admin.query(
          `REVOKE ${privilege} ON public.${table} FROM app_runtime`,
        );
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
        await secureDatabase(h.admin);
        await verifyRuntimeRole(h.runtime);
      });
  it("refuses implicit PUBLIC execution on a required reach helper and restores its private ACL", async () => {
    await h.admin.query(
      "update pg_proc set proacl=null where oid='public.current_paid_contract(uuid,timestamptz)'::regprocedure",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await secureDatabase(h.admin);
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
  });
  for (const name of reachFunctions)
    it(`requires restricted helper ${name}`, async () => {
      const functionName = (
        await h.admin.query(
          "SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",
          [name],
        )
      ).rows[0].signature;
      await h.admin.query(
        `REVOKE EXECUTE ON FUNCTION ${functionName} FROM app_runtime`,
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      await secureDatabase(h.admin);
      await verifyRuntimeRole(h.runtime);
    });
  it("validates bounded same-origin commands and does not expose private recovery authority", async () => {
    const f = await setup();
    const http = createReachChangeHttp({
      application: f.changes,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const foreign = await http.preview(
      new Request("http://localhost:3000/api/reach", {
        method: "POST",
        headers: {
          ...Object.fromEntries(f.owner),
          origin: "https://foreign.invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          periodId: f.original.id,
          quoteId: f.target.id,
          requestKey: randomUUID(),
        }),
      }),
      f.business.id,
    );
    expect(foreign.status).toBe(403);
    const forged = await http.preview(
      new Request("http://localhost:3000/api/reach", {
        method: "POST",
        headers: {
          ...Object.fromEntries(f.owner),
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          periodId: f.original.id,
          quoteId: f.target.id,
          requestKey: randomUUID(),
          amountMinor: "1",
          recipient: "attacker@example.com",
        }),
      }),
      f.business.id,
    );
    expect(forged.status).toBe(400);
    const preview = await f.changes.preview(f.owner, f.business.id, {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /recoveryKey|recovery_key|reach_capability|payment_capability/,
    );
    expect(f.effects).toHaveLength(0);
  });
  it("revalidates real saved searches, queued acquisition and approved unengaged campaign reach while retaining prospects and engaged incoming work", async () => {
    const f = await setup("US", true),
      preview = await f.changes.preview(f.owner, f.business.id, {
        periodId: f.original.id,
        quoteId: f.target.id,
        requestKey: randomUUID(),
      });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: preview.reviewHash,
    });
    h.clock.set("2026-12-05T08:59:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    const sales = await campaignFixture(h, {
      at: "2026-12-05T08:59:00.000Z",
      businessContext: { owner, business: f.business },
      market: "United States",
      discoveryUnit: "research units",
    });
    const saved = await sales.app.save(owner, f.business.id, sales.draft()),
      revision = saved.campaigns[0].revisions[0],
      recipient = revision.snapshot.recipients[0];
    await sales.app.decide(owner, f.business.id, {
      ...sales.ref(revision),
      decision: "approved",
      note: "Synthetic approval before paid reduction",
    });
    const campaignInput = {
      ...sales.ref(revision),
      recipient: {
        prospectId: recipient.prospectId,
        contactId: recipient.contactId,
        address: recipient.address,
      },
      stepIndex: 0,
    };
    expect(
      (await sales.app.inspect(owner, f.business.id, campaignInput)).current
        .reach.status,
    ).toBe("allowed");
    expect(
      (await sales.app.inspect(owner, f.business.id, campaignInput)).eligibility
        .status,
    ).toBe("unknown");
    const history = (await sales.discovery.workspace(owner, f.business.id))
      .prospects;
    await sales.discovery.start(owner, f.business.id, {
      markets: ["United States"],
      publicOffering: "Galvanized steel",
      confirmPublicQuery: true,
      budget: 2,
      requestKey: randomUUID(),
    });
    await sales.discovery.saveSchedule(owner, f.business.id, {
      scheduleId: randomUUID(),
      expectedRevision: 0,
      name: "US acquisition",
      timeZone: "UTC",
      localTime: "09:01",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      missed: "skip",
      overlap: "skip",
      dst: "compatible",
      search: {
        markets: ["United States"],
        publicOffering: "Galvanized steel",
        confirmPublicQuery: true,
        budget: 2,
        requestKey: randomUUID(),
      },
      confirmRecurring: true,
    });
    const connection = await sales.inbox.addConnection(owner, f.business.id, {
      label: "Incoming history",
      channel: "email",
      conversationRefs: [],
    });
    await sales.inbox.capture(owner, f.business.id, connection.id, {
      eventId: "retained-inquiry",
      messageRef: "retained-inquiry",
      conversationRef: "engaged-thread",
      senderRef: "engaged@example.net",
      senderName: "Engaged overseas buyer",
      geography: "United States",
      kind: "direct_inquiry",
      subject: "Steel request",
      text: "Can you quote steel?",
      occurredAt: h.clock.now().toISOString(),
    });
    await f.changes.execute(owner, f.business.id, {
      changeId: preview.id,
      requestKey: randomUUID(),
    });
    h.clock.set("2026-12-05T09:00:00.000Z");
    Object.assign(f.native.subscriptions.get("sub_fixture1")!, {
      plan_id: "plan_expandedUSD",
      has_scheduled_changes: false,
    });
    f.native.charge(
      "pay_reduced",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "USD",
    );
    Object.assign(f.native.invoices.at(-1)!, {
      amount: 1375,
      amount_paid: 1375,
      line_items: [
        { type: "plan", quantity: 1, amount: 1375, currency: "USD" },
      ],
    });
    Object.assign(f.native.payments.get("pay_reduced")!, { amount: 1375 });
    await f.payments.refresh(owner, f.business.id, { actionId: f.action.id });
    await f.changes.recover();
    expect((await sales.discovery.execute(sales.queued.at(-1))).outcome).toBe(
      "configuration_changed",
    );
    expect(
      (await sales.app.inspect(owner, f.business.id, campaignInput)).current
        .reach.status,
    ).toBe("blocked");
    expect(
      (await sales.discovery.workspace(owner, f.business.id)).prospects,
    ).toEqual(history);
    const inbox = await sales.inbox.workspace(owner, f.business.id);
    expect(inbox.conversations).toHaveLength(1);
    expect(
      (
        await sales.inbox.conversation(
          owner,
          f.business.id,
          inbox.conversations[0].id,
        )
      ).buyer.relationship,
    ).toBe("engaged");
    h.clock.set("2026-12-05T09:01:00.000Z");
    expect(
      (await sales.discovery.dispatchScheduled(sales.scheduled[0])).outcome,
    ).toBe("configuration_changed");
    expect(
      (await sales.discovery.workspace(owner, f.business.id)).schedules[0],
    ).toMatchObject({ status: "paused", failure: "configuration_changed" });
  });
});
