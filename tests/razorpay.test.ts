import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayFixture } from "./support/razorpay";
import { createSubscriptionPaymentHttp } from "../src/http/subscription-payments";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";
import {
  paymentObservationSchema,
  type PaymentGateway,
} from "../src/models/subscription-payments";

describe("Native recurring cards at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  it("consumes the original agreed monthly allowances after a provider-agnostic paid pilot, freezing a separate renewal basis", async () => {
    const f = await subscriptionFixture(h, { term: "paid_pilot" });
    let observation: unknown;
    const gateway: PaymentGateway = {
      key: "pilot-fixture",
      account: "fixture",
      mode: "fixture",
      supports: () => true,
      async create({ operationKey }) {
        observation = {
          provider: "pilot-fixture",
          account: "fixture",
          operationKey,
          status: "confirmed",
          customerId: "cust_fixture",
          checkoutId: "sub_fixture",
          subscriptionId: "sub_fixture",
          paymentId: "pay_pilot",
          currency: "INR",
          amountMinor: "1100",
          paidAt: "2026-11-05T09:00:00.000Z",
          periodStart: "2026-11-05T09:00:00.000Z",
          periodEnd: "2026-11-19T09:00:00.000Z",
          checkout: null,
        };
        return {
          customerId: "cust_fixture",
          checkoutId: "sub_fixture",
          subscriptionId: "sub_fixture",
          planId: "plan_fixture",
          url: "https://payments.example.com/pilot",
        };
      },
      async authenticateEvent() {
        throw new Error("Unused external fixture boundary");
      },
      async reconcile() {
        return paymentObservationSchema.parse(observation);
      },
    };
    const app = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway,
    });
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).allowances?.discovery
        .included,
    ).toBe(10);
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-11-19T09:00:00.000Z");
    observation = {
      provider: "pilot-fixture",
      account: "fixture",
      operationKey: a.operationKey,
      status: "confirmed",
      customerId: "cust_fixture",
      checkoutId: "sub_fixture",
      subscriptionId: "sub_fixture",
      paymentId: "pay_monthly",
      currency: "INR",
      amountMinor: "11006",
      paidAt: "2026-11-19T09:00:00.000Z",
      periodStart: "2026-11-19T09:00:00.000Z",
      periodEnd: "2026-12-19T09:00:00.000Z",
      checkout: null,
      charge: {
        kind: "renewal",
        invoiceId: "inv_monthly",
        orderId: "order_monthly",
        planId: "plan_fixture",
        method: "card",
        international: false,
        subscriptionStart: "2026-11-19T09:00:00.000Z",
        feeMinor: null,
        feeTaxMinor: null,
        baseAmountMinor: null,
        baseCurrency: null,
      },
    };
    const owner = await h.signIn("tax-owner@example.com");
    await app.refresh(owner, f.business.id, { actionId: a.id });
    const state = await app.workspace(owner, f.business.id);
    expect(state.periods).toHaveLength(2);
    expect(state.allowances?.discovery.included).toBe(100);
    expect(state.periods[1].snapshot).toMatchObject({
      basis: { kind: "renewal", discovery: { quantity: 100 } },
      quote: { initial: { discovery: { quantity: 10 } } },
    });
  });
  function compose(native: ReturnType<typeof razorpayFixture>) {
    return createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: configuredPayments(native.configuration),
    });
  }
  async function checkout(
    country = "IN",
    term: "monthly" | "paid_pilot" = "monthly",
  ) {
    const f = await subscriptionFixture(h, { country, term });
    const native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    return { f, native, app, action };
  }
  function event(
    native: ReturnType<typeof razorpayFixture>,
    eventId: string,
    payload: unknown,
    secret = "fixture-webhook-secret",
  ) {
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: native.review.account,
        event: "subscription.charged",
        payload,
      }),
    );
    return {
      body,
      headers: new Headers({
        "x-razorpay-event-id": eventId,
        "x-razorpay-signature": createHmac("sha256", secret)
          .update(body)
          .digest("hex"),
      }),
    };
  }
  it("commits signed native receipts before HTTP recovery and never treats activation or a refundable token as a paid period", async () => {
    const { f, native, app, action } = await checkout();
    const sub = native.subscriptions.get("sub_fixture1")!;
    sub.status = "active";
    const receipt = event(
      native,
      "evt_activation",
      {
        subscription: { entity: { id: sub.id } },
        payment: { entity: { id: "pay_authToken" } },
      },
      "fixture-old-secret",
    );
    const count = native.requests.length;
    const http = createSubscriptionPaymentHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const response = await http.event(
      new Request("http://localhost:3000/api/payment-events", {
        method: "POST",
        headers: receipt.headers,
        body: Buffer.from(receipt.body),
      }),
    );
    expect(response.status).toBe(200);
    expect(native.requests).toHaveLength(count);
    let state = await app.workspace(f.owner, f.business.id);
    expect(state.actions[0].events).toHaveLength(1);
    expect(state.actions[0].events[0].observation.operationKey).toBeNull();
    expect(state.actions[0].reconciliationPending).toBe(true);
    await app.recover();
    expect((await app.workspace(f.owner, f.business.id)).periods).toHaveLength(
      0,
    );
    const forged = { ...receipt, body: new TextEncoder().encode("{}") };
    await expect(app.event(forged)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await app.event(receipt);
    await expect(
      app.event(
        event(native, "evt_activation", {
          subscription: {
            entity: {
              id: sub.id,
              notes: { operation_key: action.operationKey },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    native.charge(
      "pay_captured",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.event(
      event(native, "evt_capture", {
        subscription: { entity: { id: sub.id } },
      }),
    );
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    await app.recover();
    await app.event(receipt);
    await app.recover();
    state = await app.workspace(f.owner, f.business.id);
    expect(state.periods).toHaveLength(1);
    expect(state.actions[0].state).toBe("confirmed");
    expect(native.creations).toHaveLength(1);
  });
  it("recovers a lost creation by resumable exhaustive notes lookup without repeating a create", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    native.loseCreation = true;
    const app = compose(native);
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(
      (await app.start(f.owner, f.business.id, { actionId: a.id })).checkout,
    ).toBeNull();
    const real = native.subscriptions.get("sub_fixture1")!;
    native.subscriptions.clear();
    const notes = real.notes;
    if (!notes || typeof notes !== "object")
      throw new Error("Fixture notes missing");
    for (let n = 0; n < 100; n++)
      native.subscriptions.set(`sub_other${n}`, {
        ...real,
        id: `sub_other${n}`,
        notes: { ...notes, operation_key: randomUUID() },
      });
    native.subscriptions.set("sub_fixture1", real);
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].checkout,
    ).toBeNull();
    await compose(native).recover();
    const saved = (await app.workspace(f.owner, f.business.id)).actions[0];
    expect(saved.checkout?.subscriptionId).toBe("sub_fixture1");
    expect(native.requests.some((r) => r.path.includes("skip=100"))).toBe(true);
    await app.start(f.owner, f.business.id, { actionId: a.id });
    await app.recover();
    expect(native.creations).toHaveLength(1);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
  });
  it("bounds lost-creation lookup by the persisted start time when checkout review happened earlier", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    h.clock.set("2026-11-05T09:30:00.000Z");
    native.loseCreation = true;
    await app.start(f.owner, f.business.id, { actionId: a.id });
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].checkout
        ?.subscriptionId,
    ).toBe("sub_fixture1");
    expect(native.creations).toHaveLength(1);
  });
  it("executes USD international capture and retains charge-currency, fees and INR base evidence separately", async () => {
    const { f, native, app } = await checkout("US");
    native.charge(
      "pay_usd",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
      "USD",
    );
    await app.recover();
    const state = await app.workspace(f.owner, f.business.id);
    expect(state.periods).toHaveLength(1);
    expect(state.periods[0].charge).toMatchObject({
      currency: "USD",
      amountMinor: "2750",
      charge: {
        international: true,
        feeMinor: "25",
        feeTaxMinor: "3",
        baseAmountMinor: "240000",
        baseCurrency: "INR",
      },
    });
    expect(state.periods[0].snapshot.tax.totals).toEqual({
      netMinor: "2500",
      taxMinor: "250",
      totalMinor: "2750",
    });
  });
  it("keeps missing and ambiguous creations durable even after exhaustive lookup", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    native.loseCreation = true;
    const app = compose(native),
      a = await app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    const real = native.subscriptions.get("sub_fixture1")!;
    native.subscriptions.clear();
    await app.recover();
    await compose(native).recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].checkout,
    ).toBeNull();
    native.subscriptions.set("sub_fixture1", real);
    native.subscriptions.set("sub_duplicate", { ...real, id: "sub_duplicate" });
    await app.recover();
    await app.start(f.owner, f.business.id, { actionId: a.id });
    const state = await app.workspace(f.owner, f.business.id);
    expect(state.actions[0]).toMatchObject({
      state: "review_required",
      reason: "creation_lookup_ambiguous",
      checkout: null,
    });
    expect(state.periods).toHaveLength(0);
    expect(native.creations).toHaveLength(1);
  });
  it("blocks unknown capability, unreviewed provider settings, expired terms and unsupported pilot mapping before native creation", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    for (const review of [
      { ...native.review, methods: { card: true, upi: false, emandate: true } },
      { ...native.review, methods: { card: true, upi: true, emandate: false } },
      { ...native.review, settlement: "unknown" },
      { ...native.review, subscriptions: false },
      { ...native.review, terms: { ...native.review.terms, fx: "" } },
      { ...native.review, effectiveUntil: "2026-11-05T08:30:00.000Z" },
      {
        ...native.review,
        domestic: { ...native.review.domestic, enabled: false },
      },
    ]) {
      native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify(review);
      const app = compose(native);
      await expect(
        app.prepare(f.owner, f.business.id, {
          quoteId: f.quote.id,
          requestKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    }
    expect(native.creations).toHaveLength(0);
    native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify({
      ...native.review,
      domestic: { ...native.review.domestic, maxChargeMinor: "100" },
    });
    const limited = compose(native);
    const restricted = await limited.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(restricted).toMatchObject({
      state: "review_required",
      reason: "native_plan_or_capability_review_required",
    });
    await limited.start(f.owner, f.business.id, { actionId: restricted.id });
    expect(native.creations).toHaveLength(0);
  });
  it("keeps a native paid pilot visibly blocked instead of granting days from an authentication token or deprecated add-on", async () => {
    const { f, native, app, action } = await checkout("IN", "paid_pilot");
    expect(action).toMatchObject({
      state: "review_required",
      reason: "native_paid_pilot_mapping_unverified",
    });
    expect(native.creations).toHaveLength(0);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
  });
  it("requires the exact frozen account review before creating a mandate, even when its ID and version were reused", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    for (const review of [
      {
        ...native.review,
        plans: native.review.plans.map((plan) => ({ ...plan, totalCount: 24 })),
      },
      {
        ...native.review,
        terms: { ...native.review.terms, recurringSurcharge: "Changed terms" },
      },
    ]) {
      native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify(review);
      await expect(
        compose(native).start(f.owner, f.business.id, { actionId: action.id }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      expect(native.creations).toHaveLength(0);
    }
    native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify(
      native.review,
    );
    await app.start(f.owner, f.business.id, { actionId: action.id });
    expect(native.creations).toMatchObject([{ total_count: 12 }]);
  });
  it("freezes original renewal prices and allowances while evaluating the current approved tax binding and preserving old replay", async () => {
    const { f, native, app } = await checkout();
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const original = (await app.workspace(f.owner, f.business.id)).periods[0];
    const catalog = await f.quotes.catalog(f.operator);
    await f.quotes.configure(f.operator, {
      expectedVersion: 1,
      effectiveFrom: null,
      note: "Synthetic later prices",
      offers: catalog.current!.offers.map((o) => ({
        ...o,
        discovery: { quantity: 5, unit: "research units" },
        prices: { ...o.prices, INR: { monthlyMinor: 20000, pilotMinor: 1000 } },
      })),
    });
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.charge(
      "pay_renewal",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    await app.recover();
    let owner = await h.signIn("tax-owner@example.com");
    let state = await app.workspace(owner, f.business.id);
    expect(state.periods).toHaveLength(2);
    expect(state.periods[1].snapshot).toMatchObject({
      basis: { kind: "renewal", discovery: { quantity: 100 } },
      tax: {
        purpose: "subscription_charge",
        totals: { netMinor: "10005", totalMinor: "11006" },
      },
    });
    expect(state.allowances?.discovery.included).toBe(100);
    // Withdraw approved tax coverage: the old charge remains frozen; the next positive charge is held.
    const operator = await h.signIn("tax-operator@example.com");
    await f.tax.decideRule(operator, {
      revisionId: f.rules.revisions[0].id,
      expectedDecisionVersion: 1,
      outcome: "withdrawn",
      note: "Synthetic approval withdrawn",
    });
    h.clock.set("2027-01-05T09:00:00.000Z");
    native.charge(
      "pay_held",
      "2027-01-05T09:00:00.000Z",
      "2027-02-05T09:00:00.000Z",
    );
    await app.recover();
    owner = await h.signIn("tax-owner@example.com");
    state = await app.workspace(owner, f.business.id);
    expect(state.periods).toHaveLength(2);
    expect(state.periods[0]).toEqual(original);
    expect(state.access.active).toBe(false);
    expect(state.actions[0].state).toBe("review_required");
  });
  it("keeps a contradictory paid renewal visibly under review after an earlier confirmed charge, then recovers without another creation", async () => {
    const { f, native, app } = await checkout();
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const original = (await app.workspace(f.owner, f.business.id)).periods[0];
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.charge(
      "pay_renewal",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    native.payments.get("pay_renewal")!.method = "emandate";
    await app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    let state = await app.workspace(owner, f.business.id);
    expect(state.periods).toEqual([original]);
    expect(state.access.active).toBe(false);
    expect(state.actions[0]).toMatchObject({
      state: "review_required",
      reason: "provider_binding_mismatch",
      observation: {
        paymentId: "pay_renewal",
        review: {
          invoiceId: "inv_renewal",
          reason: "paid_invoice_binding_mismatch",
        },
      },
    });
    // Corrected authoritative card evidence reconciles the same native payment exactly once.
    native.payments.get("pay_renewal")!.method = "card";
    await app.recover();
    await app.recover();
    state = await app.workspace(owner, f.business.id);
    expect(state.actions[0].state).toBe("confirmed");
    expect(state.periods).toHaveLength(2);
    expect(state.periods[0]).toEqual(original);
    expect(state.access.active).toBe(true);
    expect(native.creations).toHaveLength(1);
  });
  it("uses the current reviewed billing country for a new USD renewal while retaining the original charge identity", async () => {
    const { f, native, app } = await checkout("US");
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
      "USD",
    );
    await app.recover();
    const original = (await app.workspace(f.owner, f.business.id)).periods[0];
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    const current = await f.billing.workspace(f.owner, f.business.id);
    await f.billing.save(f.owner, f.business.id, {
      expectedVersion: current.version,
      note: "Synthetic reviewed move within the USD billing path",
      profile: {
        ...current.current!.profile,
        address: { ...current.current!.profile.address, country: "GB" },
      },
    });
    await f.billing.review(f.operator, f.business.id, {
      expectedVersion: 2,
      expectedReviewVersion: 1,
      outcome: "reviewed",
      findings: [],
      note: "Synthetic current-country evidence reviewed",
    });
    const rules = await f.tax.saveRule(f.operator, {
      key: "fixture-gb",
      expectedVersion: 0,
      note: "Explicit synthetic GB coverage",
      rule: {
        ...f.rules.revisions[0].rule,
        customerCountry: "GB",
        jurisdiction: {
          code: "fixture-gb",
          name: "Synthetic GB jurisdiction",
          country: "GB",
        },
      },
    });
    await f.tax.decideRule(f.operator, {
      revisionId: rules.revisions.find((r) => r.key === "fixture-gb")!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic GB coverage approved",
    });
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.charge(
      "pay_renewal",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
      "USD",
    );
    await app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    const state = await app.workspace(owner, f.business.id);
    expect(state.periods).toHaveLength(2);
    expect(state.periods[0]).toEqual(original);
    expect(state.periods[1].snapshot.tax).toMatchObject({
      billing: { current: { profile: { address: { country: "GB" } } } },
      totals: { totalMinor: "2750" },
      lines: [{ rule: { revision: { key: "fixture-gb" } } }],
    });
    expect(state.access.active).toBe(true);
    expect(native.creations).toHaveLength(1);
  });
  it("preserves the native January-end monthly anchor across February and March instead of using a thirty-day term", async () => {
    h.clock.set("2027-01-31T09:00:00.000Z");
    const { f, native, app } = await checkout();
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    native.charge(
      "pay_january",
      "2027-01-31T09:00:00.000Z",
      "2027-02-28T09:00:00.000Z",
    );
    await app.recover();
    h.clock.set("2027-02-28T09:00:00.000Z");
    native.charge(
      "pay_february",
      "2027-02-28T09:00:00.000Z",
      "2027-03-31T09:00:00.000Z",
    );
    await app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    expect(
      (await app.workspace(owner, f.business.id)).periods.map((p) => p.end),
    ).toEqual(["2027-02-28T09:00:00.000Z", "2027-03-31T09:00:00.000Z"]);
  });
  it("preserves native charge history, scope helpers and renewability across actual schema reapplication", async () => {
    const { f, native, app, action } = await checkout();
    native.charge(
      "pay_before",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const before = await app.workspace(f.owner, f.business.id);
    await expect(
      h.runtime.query(
        "SELECT public.payment_renewal_context($1,$2) AS context",
        [action.id, f.business.id],
      ),
    ).resolves.toMatchObject({ rows: [{ context: null }] });
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect((await app.workspace(f.owner, f.business.id)).periods).toEqual(
      before.periods,
    );
    for (const signature of [
      "public.subscription_payment_reference_target(text,text,text)",
      "public.payment_renewal_context(uuid,uuid)",
    ]) {
      await h.admin.query(
        `REVOKE EXECUTE ON FUNCTION ${signature} FROM app_runtime`,
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      await secureDatabase(h.admin);
    }
    await verifyRuntimeRole(h.runtime);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      true,
    );
  });
  it.each([
    "payment_customer",
    "invoice_customer",
    "order",
    "amount",
    "method",
    "authorization",
    "invoice_status",
    "period",
    "plan",
    "notes",
    "international",
  ])("keeps %s mismatches from granting a paid period", async (variant) => {
    const { f, native, app } = await checkout();
    native.charge(
      "pay_bad",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    const p = native.payments.get("pay_bad")!,
      i = native.invoices[0],
      s = native.subscriptions.get("sub_fixture1")!;
    switch (variant) {
      case "payment_customer":
        p.customer_id = "cust_wrong";
        break;
      case "invoice_customer":
        i.customer_id = "cust_wrong";
        break;
      case "order":
        p.order_id = "order_wrong";
        break;
      case "amount":
        p.amount = 11005;
        break;
      case "method":
        p.method = "emandate";
        break;
      case "authorization":
        p.status = "authorized";
        p.captured = false;
        break;
      case "invoice_status":
        i.status = "issued";
        break;
      case "period":
        i.billing_end = Number(i.billing_start) + 31 * 86400;
        break;
      case "plan":
        s.plan_id = "plan_wrong";
        break;
      case "notes":
        s.notes = { operation_key: randomUUID() };
        break;
      case "international":
        p.international = true;
        break;
    }
    await app.recover();
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    expect(native.creations).toHaveLength(1);
  });
  it("requires the recovery-column privilege at startup and restores the restricted contract on security reapplication", async () => {
    await verifyRuntimeRole(h.runtime);
    await h.admin.query(
      "REVOKE UPDATE(recovery) ON subscription_payment FROM app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await secureDatabase(h.admin);
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
  });
  it("executes the native live-mode composition with explicitly approved synthetic live tax and account inputs", async () => {
    const f = await subscriptionFixture(h, { mode: "live" }),
      native = razorpayFixture(h.clock);
    native.configuration.env.RAZORPAY_KEY_ID = "rzp_live_fixture";
    native.configuration.env.RAZORPAY_ACCOUNT_REVIEW = JSON.stringify({
      ...native.review,
      mode: "live",
    });
    const app = compose(native),
      a = await app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    native.charge(
      "pay_liveFixture",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    expect(await app.workspace(f.owner, f.business.id)).toMatchObject({
      gateway: { mode: "live" },
      access: { active: true },
    });
    native.configuration.env.RAZORPAY_KEY_ID = "rzp_test_fixture";
    const mismatch = compose(native);
    expect(
      (await mismatch.workspace(f.owner, f.business.id)).gateway.ready,
    ).toBe(false);
    await expect(
      mismatch.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
  });
  it("denies foreign actors and wrong-account events and safely retains authenticated native events without an invented operation", async () => {
    const { f, native, app, action } = await checkout();
    const outsider = await h.signIn("payment-outsider@example.com");
    await expect(app.workspace(outsider, f.business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      app.refresh(outsider, f.business.id, { actionId: action.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const wrong = event(native, "evt_wrong", {});
    const payload = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_foreign",
        event: "subscription.charged",
        payload: {},
      }),
    );
    wrong.body = payload;
    wrong.headers.set(
      "x-razorpay-signature",
      createHmac("sha256", "fixture-webhook-secret")
        .update(payload)
        .digest("hex"),
    );
    await expect(app.event(wrong)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await app.event(
      event(native, "evt_unmatched", {
        payment: { entity: { id: "pay_noOperation" } },
      }),
    );
    const unmatched = await app.unmatchedEvents(f.operator);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toMatchObject({
      businessId: null,
      actionId: null,
      observation: { operationKey: null, paymentId: "pay_noOperation" },
    });
    const http = createSubscriptionPaymentHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const malformed = new TextEncoder().encode("not-json-fixture");
    const response = await http.event(
      new Request("http://localhost:3000/api/payment-events", {
        method: "POST",
        headers: {
          "x-razorpay-event-id": "evt_malformed",
          "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
            .update(malformed)
            .digest("hex"),
        },
        body: Buffer.from(malformed),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("fixture-api-secret");
    expect((await app.workspace(f.owner, f.business.id)).periods).toHaveLength(
      0,
    );
  });
  it("reconciles initial capture and two positive missing-event renewals using each invoice's immutable period", async () => {
    const f = await subscriptionFixture(h);
    const native = razorpayFixture(h.clock);
    const compose = () =>
      createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredPayments(native.configuration),
      });
    const app = compose();
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_first",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    expect((await app.workspace(f.owner, f.business.id)).periods).toHaveLength(
      1,
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    // Current reviewed evidence must survive beyond the original fixture's short retention.
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    native.charge(
      "pay_second",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    await compose().recover();
    h.clock.set("2027-01-05T09:00:00.000Z");
    native.charge(
      "pay_third",
      "2027-01-05T09:00:00.000Z",
      "2027-02-05T09:00:00.000Z",
    );
    await compose().recover();
    await compose().recover();
    const owner = await h.signIn("tax-owner@example.com");
    const state = await app.workspace(owner, f.business.id);
    expect(state.periods.map((p) => [p.paymentId, p.start, p.end])).toEqual([
      ["pay_first", "2026-11-05T09:00:00.000Z", "2026-12-05T09:00:00.000Z"],
      ["pay_second", "2026-12-05T09:00:00.000Z", "2027-01-05T09:00:00.000Z"],
      ["pay_third", "2027-01-05T09:00:00.000Z", "2027-02-05T09:00:00.000Z"],
    ]);
    expect(state.allowances?.automation.included).toBe(100);
    expect(state.access.paidThrough).toBe("2027-02-05T09:00:00.000Z");
    expect(native.creations).toHaveLength(1);
  });
  it("creates a server-bound domestic card subscription with truthful unresolved customer identity", async () => {
    const f = await subscriptionFixture(h);
    const native = razorpayFixture(h.clock);
    const gateway = configuredPayments(native.configuration);
    const app = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway,
    });
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    const checkout = await app.start(f.owner, f.business.id, {
      actionId: action.id,
    });
    expect(checkout.state).toBe("checkout");
    expect(checkout.checkout).toMatchObject({
      customerId: null,
      subscriptionId: "sub_fixture1",
      planId: "plan_fixtureINR",
      url: "https://rzp.io/i/fixture1",
    });
    expect(native.creations).toEqual([
      {
        plan_id: "plan_fixtureINR",
        quantity: 1,
        total_count: 12,
        customer_notify: true,
        notes: {
          operation_key: action.operationKey,
          action_id: action.id,
          business_id: f.business.id,
          financial_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          account_review: "fixture-review-1",
        },
      },
    ]);
    await app.start(f.owner, f.business.id, { actionId: action.id });
    expect(native.creations).toHaveLength(1);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
  });
  it("retains a definitive preflight rejection and permits a new explicit review without retrying the failed action", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    const originalFetch = native.configuration.fetch;
    native.configuration.fetch = async (url, init) =>
      String(url).includes("/plans/")
        ? Response.json({
            id: "plan_fixtureINR",
            period: "monthly",
            interval: 1,
            item: { amount: 1, currency: "INR" },
          })
        : originalFetch(url, init);
    const app = compose(native),
      a = await app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      });
    const failed = await app.start(f.owner, f.business.id, { actionId: a.id });
    expect(failed).toMatchObject({
      state: "failed",
      reason: "native_preflight_rejected",
    });
    expect(native.creations).toHaveLength(0);
    native.configuration.fetch = originalFetch;
    const repaired = compose(native);
    await repaired.start(f.owner, f.business.id, { actionId: a.id });
    expect(native.creations).toHaveLength(0);
    const next = await repaired.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(
      (await repaired.start(f.owner, f.business.id, { actionId: next.id }))
        .state,
    ).toBe("checkout");
    expect(native.creations).toHaveLength(1);
  });
});
