import { randomUUID } from "node:crypto";
import { createHarness } from "./harness";
import { subscriptionFixture } from "./subscription";
import { razorpayFixture } from "./razorpay";
import { configuredPayments } from "../../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../../src/db/runtime";

export async function nativePilotFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  const f = await subscriptionFixture(h, { term: "paid_pilot" });
  await f.tax.saveRule(f.operator, {
    key: "fixture-unrelated-private",
    expectedVersion: 0,
    note: "fixture-private-global-tax-marker",
    rule: {
      ...f.rules.revisions[0].rule,
      customerCountry: "IN",
      currency: "INR",
      rationale: "fixture-private-global-tax-marker",
    },
  });
  const native = razorpayFixture(h.clock);
  const orders = new Map<string, Record<string, unknown>>();
  const mutations: { path: string; body: unknown }[] = [];
  let lostOrder = false;
  let afterCustomer: (() => Promise<void>) | undefined;
  let orderPage: ((skip: number) => unknown) | undefined;
  const review = {
    ...native.review,
    pilotOrders: {
      evidence: ["fixture:reviewed-card-order-and-separate-mandate"],
      customers: [
        {
          businessId: f.business.id,
          customerId: "cust_pilot",
          evidence: ["fixture:independent-customer-binding"],
        },
        {
          businessId: randomUUID(),
          customerId: "cust_privateOtherBusiness",
          evidence: ["fixture-private-customer-marker"],
        },
      ],
    },
  };
  const external: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const method = init?.method ?? "GET";
    if (!["GET", "HEAD"].includes(method))
      mutations.push({
        path: url.pathname,
        body: JSON.parse(String(init?.body)),
      });
    if (url.pathname === "/v1/customers/cust_pilot") {
      await afterCustomer?.();
      return Response.json({
        id: "cust_pilot",
        notes: { business_id: f.business.id },
      });
    }
    if (url.pathname === "/v1/payments/pay_pilot/card")
      return Response.json({
        id: "card_pilot",
        international: false,
        type: "credit",
      });
    if (url.pathname === "/v1/orders" && method === "POST") {
      const order = {
        ...JSON.parse(String(init?.body)),
        id: "order_pilot",
        amount_paid: 0,
        amount_due: 1100,
        status: "created",
        created_at: Math.floor(h.clock.now().getTime() / 1000),
      };
      orders.set(order.id, order);
      if (lostOrder)
        throw new Error("fixture lost acknowledgement after creation");
      return Response.json(order);
    }
    if (url.pathname === "/v1/orders")
      return Response.json(
        orderPage
          ? orderPage(Number(url.searchParams.get("skip")))
          : { count: orders.size, items: [...orders.values()] },
      );
    if (url.pathname === "/v1/orders/order_pilot")
      return Response.json(orders.get("order_pilot"));
    if (url.pathname === "/v1/orders/order_pilot/payments")
      return Response.json({
        count: native.payments.size,
        items: [...native.payments.values()],
      });
    return native.configuration.fetch(input, init);
  };
  const app = createSubscriptionPaymentApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createSubscriptionPaymentRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
    gateway: configuredPayments({
      env: {
        ...native.configuration.env,
        RAZORPAY_ACCOUNT_REVIEW: JSON.stringify(review),
      },
      fetch: external,
      clock: h.clock,
    }),
  });
  const action = await app.prepare(f.owner, f.business.id, {
    quoteId: f.quote.id,
    requestKey: randomUUID(),
  });
  function capture() {
    Object.assign(orders.get("order_pilot")!, {
      amount_paid: 1100,
      amount_due: 0,
      status: "paid",
    });
    native.payments.set("pay_pilot", {
      id: "pay_pilot",
      customer_id: "cust_pilot",
      card_id: "card_pilot",
      invoice_id: null,
      order_id: "order_pilot",
      status: "captured",
      captured: true,
      method: "card",
      international: false,
      amount: 1100,
      currency: "INR",
      amount_refunded: 0,
      created_at: Math.floor(h.clock.now().getTime() / 1000),
      fee: 25,
      tax: 3,
      base_amount: 1100,
      base_currency: "INR",
    });
  }
  return {
    f,
    app,
    action,
    native,
    orders,
    mutations,
    capture,
    loseOrder: () => {
      lostOrder = true;
    },
    afterCustomer: (fn: () => Promise<void>) => {
      afterCustomer = fn;
    },
    orderPage: (fn: (skip: number) => unknown) => {
      orderPage = fn;
    },
  };
}
