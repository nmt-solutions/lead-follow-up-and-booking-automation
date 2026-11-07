import type { Clock } from "../../src/models/business";
import type { RazorpayAccountReview } from "../../src/models/razorpay-account";

/** Synthetic account review and HTTP boundary; no native credentials or account calls. */
export function razorpayFixture(
  clock: Clock,
  options: { keyId?: string; secret?: string } = {},
) {
  const review = {
    id: "fixture-review-1",
    version: 1,
    account: "acc_fixture",
    mode: "test",
    reviewedBy: "deployment-operator-fixture",
    checkedAt: "2026-11-05T08:00:00.000Z",
    effectiveFrom: "2026-11-01T00:00:00.000Z",
    effectiveUntil: "2027-11-01T00:00:00.000Z",
    evidence: ["fixture:account-activation-and-settings"],
    subscriptions: true,
    methods: { card: true, upi: false, emandate: false },
    settlement: "INR",
    domestic: {
      enabled: true,
      currency: "INR",
      maxChargeMinor: "1500000",
      evidence: ["fixture:domestic-approval"],
    },
    international: {
      enabled: true,
      currency: "USD",
      maxChargeMinor: "1000000",
      evidence: ["fixture:international-approval"],
    },
    terms: {
      activation: "Synthetic activation terms",
      fees: "Synthetic fee terms",
      recurringSurcharge: "Synthetic recurring terms",
      feeTaxes: "Synthetic fee tax terms",
      fx: "Synthetic USD to INR terms",
    },
    calendar: {
      utcCalendarMonth: true,
      evidence: ["fixture:calendar-month-approved"],
    },
    internationalUpdates: "unknown",
    plans: Array.from<RazorpayAccountReview["plans"][number]>([
      {
        offerId: "fixture",
        reservedCapacityId: null,
        currency: "INR",
        planId: "plan_fixtureINR",
        totalCount: 12,
      },
      {
        offerId: "fixture",
        reservedCapacityId: null,
        currency: "USD",
        planId: "plan_fixtureUSD",
        totalCount: 12,
      },
    ]),
  };
  const creations: unknown[] = [];
  const subscriptions = new Map<string, Record<string, unknown>>();
  const invoices: Record<string, unknown>[] = [];
  const payments = new Map<string, Record<string, unknown>>();
  const requests: { method: string; path: string }[] = [];
  const fixture = {
    review,
    creations,
    subscriptions,
    invoices,
    payments,
    requests,
    loseCreation: false,
    loseCancellation: false,
    shortUrl: "https://rzp.io/i/fixture1",
    charge(
      paymentId: string,
      start: string,
      end: string,
      currency: "INR" | "USD" = "INR",
    ) {
      const sub = subscriptions.get("sub_fixture1");
      if (!sub) throw new Error("Create the native fixture subscription first");
      sub.customer_id = "cust_fixture";
      sub.status = "active";
      sub.current_start = Math.floor(new Date(start).getTime() / 1000);
      sub.current_end = Math.floor(new Date(end).getTime() / 1000);
      sub.start_at ??= sub.current_start;
      const invoiceId = `inv_${paymentId.replace("pay_", "")}`,
        orderId = `order_${paymentId.replace("pay_", "")}`;
      invoices.push({
        id: invoiceId,
        entity: "invoice",
        subscription_id: sub.id,
        customer_id: sub.customer_id,
        payment_id: paymentId,
        order_id: orderId,
        status: "paid",
        currency,
        amount: currency === "INR" ? 11006 : 2750,
        amount_paid: currency === "INR" ? 11006 : 2750,
        amount_due: 0,
        billing_start: sub.current_start,
        billing_end: sub.current_end,
        paid_at: Math.floor(clock.now().getTime() / 1000),
        line_items: [
          {
            type: "plan",
            quantity: 1,
            amount: currency === "INR" ? 11006 : 2750,
            currency,
          },
        ],
      });
      payments.set(paymentId, {
        id: paymentId,
        entity: "payment",
        customer_id: sub.customer_id,
        invoice_id: invoiceId,
        order_id: orderId,
        status: "captured",
        captured: true,
        method: "card",
        international: currency === "USD",
        amount: currency === "INR" ? 11006 : 2750,
        currency,
        amount_refunded: 0,
        fee: 25,
        tax: 3,
        base_amount: currency === "INR" ? 11006 : 240000,
        base_currency: "INR",
        created_at: Math.floor(clock.now().getTime() / 1000),
      });
    },
    configuration: {
      env: {
        RAZORPAY_KEY_ID: options.keyId ?? "rzp_test_fixture",
        RAZORPAY_KEY_SECRET: options.secret ?? "fixture-api-secret",
        RAZORPAY_WEBHOOK_SECRETS: JSON.stringify([
          "fixture-webhook-secret",
          "fixture-old-secret",
        ]),
        RAZORPAY_ACCOUNT_REVIEW: JSON.stringify(review),
      },
      clock,
      fetch: (async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = new URL(
          typeof input === "string" || input instanceof URL ? input : input.url,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, path: url.pathname + url.search });
        const json = (data: unknown) => Response.json(data);
        if (url.origin !== "https://api.razorpay.com")
          throw new Error("Unexpected provider origin");
        if (
          new Headers(init?.headers).get("authorization") !==
          `Basic ${Buffer.from(`${fixture.configuration.env.RAZORPAY_KEY_ID}:${options.secret ?? "fixture-api-secret"}`).toString("base64")}`
        )
          throw new Error("Missing native authentication");
        if (url.pathname === "/v1/methods")
          return json({ card: { VISA: true, MC: true } });
        if (url.pathname.startsWith("/v1/plans/"))
          return json({
            id: url.pathname.split("/").at(-1),
            entity: "plan",
            interval: 1,
            period: "monthly",
            item: {
              amount: url.pathname.endsWith("USD") ? 2750 : 11006,
              currency: url.pathname.endsWith("USD") ? "USD" : "INR",
            },
          });
        if (url.pathname === "/v1/subscriptions" && method === "POST") {
          const body: unknown = JSON.parse(String(init?.body));
          creations.push(body);
          if (!body || typeof body !== "object")
            throw new Error("Invalid creation");
          const sub = {
            ...body,
            id: "sub_fixture1",
            entity: "subscription",
            customer_id: null,
            short_url: fixture.shortUrl,
            status: "created",
            created_at: Math.floor(clock.now().getTime() / 1000),
          };
          subscriptions.set(sub.id, sub);
          if (fixture.loseCreation)
            throw new Error("Lost response after provider creation");
          return json(sub);
        }
        if (url.pathname === "/v1/subscriptions") {
          const skip = Number(url.searchParams.get("skip") ?? 0),
            count = Number(url.searchParams.get("count") ?? 100);
          const items = [...subscriptions.values()]
            .filter(
              (s) =>
                s.plan_id === url.searchParams.get("plan_id") &&
                Number(s.created_at) >= Number(url.searchParams.get("from")) &&
                Number(s.created_at) <= Number(url.searchParams.get("to")),
            )
            .slice(skip, skip + count);
          return json({ entity: "collection", count: items.length, items });
        }
        if (url.pathname.endsWith("/cancel") && method === "POST") {
          const sub = subscriptions.get(url.pathname.split("/").at(-2)!);
          if (!sub) throw new Error("Missing native subscription");
          const value: unknown = JSON.parse(String(init?.body));
          if (
            !value ||
            typeof value !== "object" ||
            !("cancel_at_cycle_end" in value)
          )
            throw new Error("Invalid cancellation input");
          if (!value.cancel_at_cycle_end) {
            sub.status = "cancelled";
            sub.ended_at = Math.floor(clock.now().getTime() / 1000);
          }
          if (fixture.loseCancellation)
            throw new Error("Lost native cancellation acknowledgement");
          return json(sub);
        }
        if (url.pathname.startsWith("/v1/subscriptions/"))
          return json(subscriptions.get(url.pathname.split("/").at(-1)!));
        if (url.pathname === "/v1/invoices") {
          const skip = Number(url.searchParams.get("skip") ?? 0),
            count = Number(url.searchParams.get("count") ?? 100);
          const items = invoices
            .filter(
              (i) =>
                i.subscription_id === url.searchParams.get("subscription_id"),
            )
            .slice(skip, skip + count);
          return json({ entity: "collection", count: items.length, items });
        }
        if (url.pathname.startsWith("/v1/payments/"))
          return json(payments.get(url.pathname.split("/").at(-1)!));
        throw new Error("Unexpected native HTTP request");
      }) satisfies typeof fetch,
    },
  };
  return fixture;
}
