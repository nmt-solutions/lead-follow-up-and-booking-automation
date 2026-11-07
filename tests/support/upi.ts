import { randomUUID, createHmac } from "node:crypto";
import type { ReachPolicy } from "../../src/models/reach-changes";
import type { createHarness } from "./harness";
import { subscriptionFixture } from "./subscription";
import { razorpayFixture } from "./razorpay";
import {
  financialNativeFixture,
  fixtureAdjustmentPolicy,
} from "./financial-native";
import { runtimeDatabase } from "../../src/db/runtime";
import { createSubscriptionPaymentApplication } from "../../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../../src/db/subscription-payment-repository";
import { createReachChangeApplication } from "../../src/application/reach-changes";
import { createReachChangeRepository } from "../../src/db/reach-change-repository";
import { configuredPayments } from "../../src/subscription-payments/configuration";

export const upiFixturePolicy: ReachPolicy = {
  id: "upi-fixture-replacement",
  version: 1,
  mode: "test",
  reviewedBy: "fixture commercial reviewer",
  checkedAt: "2026-11-01T00:00:00.000Z",
  effectiveFrom: "2026-11-01T00:00:00.000Z",
  effectiveUntil: "2027-11-01T00:00:00.000Z",
  evidence: ["fixture explicit new mandate and separate payment terms"],
  previewSeconds: 600,
  proration: "remaining_calendar_seconds",
  rounding: "half_up",
  unusedUnits: "retain_consumed_add_prorated_difference",
  inFlightUnengaged: "pause_outside_target",
  nativeProration: { enabled: false, evidence: ["UPI updates unsupported"] },
  replacement: {
    enabled: true,
    stopOldBeforeCreate: true,
    evidence: ["fixture exact old end and future new start"],
  },
};

export async function upiFixture(h: Awaited<ReturnType<typeof createHarness>>) {
  const f = await subscriptionFixture(h);
  await h.admin.query(
    "UPDATE business_file SET retention_until='2027-06-01' WHERE id=$1",
    [f.fileId],
  );
  const card = razorpayFixture(h.clock),
    upi = financialNativeFixture(h.clock, {
      keyId: "rzp_test_upi",
      secret: "upi-api-secret",
    });
  const mutations: { account: string; path: string; body: unknown }[] = [];
  const database = runtimeDatabase(h.runtime);
  const deps = {
    authenticate: h.access.authenticateForWork,
    authenticatePlatform: h.access.authenticatePlatformForWork,
    clock: h.clock,
  };
  const originalPayments = createSubscriptionPaymentApplication({
    ...deps,
    repository: createSubscriptionPaymentRepository(database),
    gateway: configuredPayments(card.configuration),
  });
  const action = await originalPayments.prepare(f.owner, f.business.id, {
    quoteId: f.quote.id,
    requestKey: randomUUID(),
  });
  await originalPayments.start(f.owner, f.business.id, { actionId: action.id });
  card.charge(
    "pay_original",
    "2026-11-05T09:00:00.000Z",
    "2026-12-05T09:00:00.000Z",
  );
  Object.assign(card.subscriptions.get("sub_fixture1")!, {
    remaining_count: 11,
  });
  await originalPayments.refresh(f.owner, f.business.id, {
    actionId: action.id,
  });
  const original = (await originalPayments.workspace(f.owner, f.business.id))
    .periods[0];
  await f.quotes.configure(f.operator, {
    expectedVersion: 1,
    effectiveFrom: null,
    note: "Fixture approved expanded terms",
    offers: [
      {
        ...f.quote.pricing.offer,
        id: "expanded",
        label: "Expanded reach",
        markets: ["Pune", "United States", "Canada"],
        discovery: { quantity: 200, unit: "research units" },
        automation: { quantity: 200, unit: "provider calls" },
        prices: { INR: { monthlyMinor: 20010, pilotMinor: null }, USD: null },
        pilot: null,
        reservedCapacity: [],
      },
    ],
  });
  const target = await f.quotes.createQuote(f.owner, f.business.id, {
    offerId: "expanded",
    reservedCapacityId: null,
    term: "monthly",
    expectedCatalogVersion: 2,
    expectedBillingVersion: 1,
    expectedReviewVersion: 1,
    requestKey: randomUUID(),
  });
  const upiReview = {
    ...upi.review,
    id: "upi-review",
    account: "acc_upi",
    methods: { card: false, upi: true, emandate: false },
    plans: [
      {
        offerId: "expanded",
        reservedCapacityId: null,
        currency: "INR",
        planId: "plan_upiINR",
        totalCount: 6,
      },
    ],
    upiPath: {
      id: "separate-upi",
      enabled: true,
      merchantCategoryCode: "7399",
      currency: "INR",
      method: "upi",
      schedule: "utc_calendar_month",
      minimumMinor: "100",
      maximumMinor: "100000",
      supportedApps: ["fixture PSP"],
      supportedHandles: ["fixture"],
      accountSupport: ["fixture account settings/MCC/PSP support"],
      sandbox: {
        kind: "deterministic_fixture",
        mode: "test",
        account: "acc_upi",
        checkedAt: "2026-11-01T00:00:00.000Z",
        references: ["fixture only; no actual sandbox execution"],
      },
      terms:
        "A separate UPI mandate begins at the old paid term boundary; an approved separate order funds remaining expanded reach.",
      mappings: [
        {
          id: "identity-map",
          businessId: f.business.id,
          originalAccount: "acc_fixture:test",
          originalCustomerId: "cust_fixture",
          customerId: "cust_upi",
          evidence: ["fixture explicit application identity review"],
        },
      ],
    },
  };
  const orders = new Map<string, Record<string, unknown>>();
  const condition = {
    loseCreate: false,
    oldCancelUnknown: false,
    beforeRead: undefined as (() => Promise<void>) | undefined,
  };
  const rawCard = card.configuration.fetch,
    rawUpi = upi.configuration.fetch;
  const http: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const isUpi =
      new Headers(init?.headers).get("authorization") ===
      `Basic ${Buffer.from("rzp_test_upi:upi-api-secret").toString("base64")}`;
    if ((init?.method ?? "GET") !== "GET")
      mutations.push({
        account: isUpi ? "upi" : "card",
        path: url.pathname,
        body: JSON.parse(String(init?.body)),
      });
    if (!isUpi) {
      const result = await rawCard(input, init);
      if (url.pathname.endsWith("/cancel") && init?.method === "POST") {
        if (condition.oldCancelUnknown)
          throw new Error("lost old cancellation");
        return result;
      }
      return result;
    }
    await condition.beforeRead?.();
    condition.beforeRead = undefined;
    if (url.pathname === "/v1/methods") return Response.json({ upi: true });
    if (url.pathname === "/v1/customers/cust_upi")
      return Response.json({ id: "cust_upi", entity: "customer" });
    if (url.pathname === "/v1/plans/plan_upiINR")
      return Response.json({
        id: "plan_upiINR",
        interval: 1,
        period: "monthly",
        item: { amount: 22011, currency: "INR" },
      });
    if (url.pathname === "/v1/orders" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const o = {
        ...body,
        id: "order_upi",
        status: "created",
        amount_paid: 0,
        amount_due: body.amount,
      };
      orders.set(o.id, o);
      return Response.json(o);
    }
    if (url.pathname === "/v1/orders")
      return Response.json({ items: [...orders.values()], count: orders.size });
    if (url.pathname === "/v1/orders/order_upi")
      return Response.json(orders.get("order_upi"));
    if (url.pathname === "/v1/orders/order_upi/payments") {
      const p = upi.payments.get("pay_delta");
      return Response.json({ count: p ? 1 : 0, items: p ? [p] : [] });
    }
    // The fixture's native credential check remains active with this configured key set.
    const result = await rawUpi(input, init);
    if (
      url.pathname === "/v1/subscriptions" &&
      init?.method === "POST" &&
      condition.loseCreate
    )
      throw new Error("lost new mandate acknowledgement");
    return result;
  };
  upi.configuration.env.RAZORPAY_KEY_ID = "rzp_test_upi";
  upi.configuration.env.RAZORPAY_KEY_SECRET = "upi-api-secret";
  const transport = http;
  const env = {
    ...card.configuration.env,
    RAZORPAY_UPI_ACCOUNT_REVIEW: JSON.stringify(upiReview),
    RAZORPAY_UPI_KEY_ID: "rzp_test_upi",
    RAZORPAY_UPI_KEY_SECRET: "upi-api-secret",
    RAZORPAY_UPI_WEBHOOK_SECRETS: JSON.stringify(["upi-webhook"]),
    FINANCIAL_UPI_ADJUSTMENT_POLICY: JSON.stringify({
      ...fixtureAdjustmentPolicy,
      id: "upi-refund-policy",
      account: "acc_upi:test",
    }),
    SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
      id: "upi-life",
      version: 1,
      mode: "test",
      reviewedBy: "fixture",
      checkedAt: "2026-11-01T00:00:00.000Z",
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      effectiveUntil: "2027-11-01T00:00:00.000Z",
      evidence: ["fixture"],
      graceSeconds: 0,
      graceAccess: "none",
      cancellationTiming: "immediate",
      cancellationAccess: "paid_through",
      preserveRecords: true,
    }),
  };
  const gateway = configuredPayments({ env, fetch: transport, clock: h.clock });
  const payments = createSubscriptionPaymentApplication({
    ...deps,
    repository: createSubscriptionPaymentRepository(database),
    gateway,
  });
  const changes = createReachChangeApplication({
    ...deps,
    repository: createReachChangeRepository(database, h.clock),
    gateway,
    policy: upiFixturePolicy,
  });
  const preview = () =>
    changes.preview(f.owner, f.business.id, {
      periodId: original.id,
      quoteId: target.snapshot.id,
      requestKey: randomUUID(),
      paymentMethod: "upi",
    });
  return {
    ...f,
    card,
    upi,
    env,
    configuration: { env, fetch: transport, clock: h.clock },
    gateway,
    payments,
    changes,
    preview,
    original,
    target: target.snapshot,
    action,
    mutations,
    orders,
    condition,
  };
}

/** Complete actual production-adapter path, using deterministic external HTTP only. */
export async function orderedUpiFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  const f = await upiFixture(h),
    preview = await f.preview();
  const reviewed = await f.changes.validateMethod(f.operator, f.business.id, {
    changeId: preview.id,
    requestKey: randomUUID(),
  });
  const change = await f.changes.approve(f.owner, f.business.id, {
    changeId: preview.id,
    requestKey: randomUUID(),
    accept: true,
    reviewHash: reviewed.reviewHash,
  });
  await f.changes.execute(f.owner, f.business.id, {
    changeId: change.id,
    requestKey: randomUUID(),
  });
  Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
    customer_id: "cust_upi",
    status: "authenticated",
  });
  f.upi.payments.set("pay_auth", {
    id: "pay_auth",
    customer_id: "cust_upi",
    invoice_id: null,
    order_id: null,
    status: "refunded",
    captured: true,
    method: "upi",
    vpa: "synthetic@fixture",
    international: false,
    amount: 500,
    currency: "INR",
    amount_refunded: 500,
  });
  await f.payments.confirmMandate(f.owner, f.business.id, {
    actionId: change.snapshot.replacementActionId,
    requestKey: randomUUID(),
    paymentId: "pay_auth",
    subscriptionId: "sub_fixture1",
    signature: createHmac("sha256", "upi-api-secret")
      .update("pay_auth|sub_fixture1")
      .digest("hex"),
  });
  await f.changes.execute(f.owner, f.business.id, {
    changeId: change.id,
    requestKey: randomUUID(),
  });
  return { ...f, change };
}

export async function fundedUpiFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  const f = await orderedUpiFixture(h),
    change = f.change;
  const amount = Number(change.snapshot.delta.tax.totals!.totalMinor);
  Object.assign(f.orders.get("order_upi")!, {
    status: "paid",
    amount_paid: amount,
    amount_due: 0,
  });
  f.upi.payments.set("pay_delta", {
    id: "pay_delta",
    customer_id: "cust_upi",
    invoice_id: null,
    order_id: "order_upi",
    status: "captured",
    captured: true,
    method: "upi",
    vpa: "synthetic@fixture",
    international: false,
    amount,
    currency: "INR",
    amount_refunded: 0,
    fee: 25,
    tax: 3,
    base_amount: amount,
    base_currency: "INR",
    created_at: 1793869200,
  });
  await f.changes.refresh(f.owner, f.business.id, {
    changeId: change.id,
    requestKey: randomUUID(),
  });
  const period = (
    await f.payments.workspace(f.owner, f.business.id)
  ).periods.find((p) => p.paymentId === "pay_delta")!;
  return { ...f, change, period };
}
