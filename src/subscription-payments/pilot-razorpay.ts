import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { RazorpayAccountReview } from "../models/razorpay-account";
import { ApplicationError } from "../models/application-error";
import {
  periodEnd,
  PaymentCreationNotAttempted,
  type CheckoutReference,
  type PaymentAction,
  type PaymentObservation,
  type PaymentSnapshot,
} from "../models/subscription-payments";
const nativeId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const money = z.number().int().nonnegative().safe();
const orderSchema = z.object({
  id: nativeId("order"),
  amount: money,
  amount_paid: money,
  amount_due: money,
  currency: z.enum(["INR", "USD"]),
  receipt: z.string(),
  notes: z.record(z.string(), z.string()),
  status: z.string(),
  created_at: money,
});
const paymentSchema = z.object({
  id: nativeId("pay"),
  order_id: nativeId("order"),
  invoice_id: z.null(),
  customer_id: nativeId("cust"),
  card_id: nativeId("card"),
  amount: money,
  currency: z.enum(["INR", "USD"]),
  method: z.string(),
  international: z.boolean(),
  captured: z.boolean(),
  status: z.string(),
  amount_refunded: money,
  created_at: money,
  fee: money.nullable().optional(),
  tax: money.nullable().optional(),
  base_amount: money.nullable().optional(),
  base_currency: z.string().nullable().optional(),
});
const hash = (s: PaymentSnapshot) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");

/** A one-time Orders/Standard Checkout collector. Monthly mandates are separately approved. */
export function createNativePilotOrders(d: {
  review: RazorpayAccountReview;
  keyId: string;
  secret: string;
  request(path: string, body?: unknown): Promise<unknown>;
  ready(): string[];
}) {
  function binding(s: PaymentSnapshot, effect = false) {
    const review = s.provider.review;
    if (
      !review ||
      review.account !== d.review.account ||
      review.mode !== d.review.mode
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const customer = review.pilotOrders?.customers.find(
      (c) => c.businessId === s.quote.businessId,
    );
    const plans = review.plans.filter(
      (p) =>
        p.offerId === s.quote.selection.offerId &&
        p.reservedCapacityId === s.quote.selection.reservedCapacityId &&
        p.currency === s.quote.currency,
    );
    if (
      (effect && (d.ready().length || !isDeepStrictEqual(review, d.review))) ||
      !customer ||
      plans.length !== 1 ||
      s.term.kind !== "days" ||
      s.tax.status !== "calculated" ||
      !s.tax.totals ||
      BigInt(s.tax.totals.totalMinor) <= 0n ||
      BigInt(s.tax.totals.totalMinor) >
        BigInt(
          (s.quote.currency === "INR" ? review.domestic : review.international)
            .maxChargeMinor,
        )
    )
      throw new ApplicationError("SETUP_REQUIRED");
    return { customer, plan: plans[0] };
  }
  function body(a: {
    operationKey: string;
    actionId: string;
    businessId: string;
    snapshot: PaymentSnapshot;
  }) {
    const { customer } = binding(a.snapshot);
    return {
      amount: Number(a.snapshot.tax.totals!.totalMinor),
      currency: a.snapshot.quote.currency,
      receipt: a.operationKey,
      partial_payment: false,
      notes: {
        operation_key: a.operationKey,
        action_id: a.actionId,
        business_id: a.businessId,
        financial_hash: hash(a.snapshot),
        account_review: a.snapshot.provider.review!.id,
        account: a.snapshot.provider.account,
        mode: a.snapshot.provider.mode,
        customer_id: customer.customerId,
      },
    };
  }
  function bound(
    o: z.infer<typeof orderSchema>,
    a: {
      operationKey: string;
      id: string;
      businessId: string;
      snapshot: PaymentSnapshot;
    },
  ) {
    const expected = body({ ...a, actionId: a.id });
    return (
      o.receipt === expected.receipt &&
      o.amount === expected.amount &&
      o.currency === expected.currency &&
      Object.entries(expected.notes).every(([k, v]) => o.notes[k] === v)
    );
  }
  function checkout(
    o: z.infer<typeof orderSchema>,
    s: PaymentSnapshot,
  ): CheckoutReference {
    const { customer, plan } = binding(s);
    return {
      customerId: customer.customerId,
      checkoutId: o.id,
      subscriptionId: null,
      planId: plan.planId,
      url: "https://checkout.razorpay.com/v1/checkout.js",
      standard: {
        script: "https://checkout.razorpay.com/v1/checkout.js",
        key: d.keyId,
        order_id: o.id,
        customer_id: customer.customerId,
        amount: o.amount,
        currency: o.currency,
      },
    };
  }
  async function customer(s: PaymentSnapshot) {
    const expected = binding(s).customer;
    const native = z
      .object({ id: nativeId("cust"), notes: z.record(z.string(), z.string()) })
      .parse(await d.request(`customers/${expected.customerId}`));
    if (
      native.id !== expected.customerId ||
      native.notes.business_id !== s.quote.businessId
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  }
  return {
    review(s: PaymentSnapshot) {
      try {
        binding(s, true);
        return [];
      } catch {
        return ["pilot_order_customer_and_card_path_review_required"];
      }
    },
    async create(a: {
      operationKey: string;
      actionId: string;
      businessId: string;
      snapshot: PaymentSnapshot;
      authorize?: () => Promise<void>;
    }) {
      let payload;
      try {
        payload = body(a);
        await customer(a.snapshot);
        await a.authorize?.();
        binding(a.snapshot, true);
      } catch {
        throw new PaymentCreationNotAttempted();
      }
      const o = orderSchema.parse(await d.request("orders", payload));
      if (!bound(o, { ...a, id: a.actionId }))
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      return checkout(o, a.snapshot);
    },
    signature(
      a: PaymentAction,
      input: { orderId: string; paymentId: string; signature: string },
    ) {
      if (
        a.snapshot.term.kind !== "days" ||
        !a.checkout?.standard ||
        input.orderId !== a.checkout.checkoutId ||
        !nativeId("pay").safeParse(input.paymentId).success ||
        !/^[a-fA-F0-9]{64}$/.test(input.signature) ||
        !timingSafeEqual(
          Buffer.from(input.signature, "hex"),
          createHmac("sha256", d.secret)
            .update(`${a.checkout.checkoutId}|${input.paymentId}`)
            .digest(),
        )
      )
        throw new ApplicationError("FORBIDDEN");
      return true;
    },
    async poll(a: PaymentAction) {
      // Recovery never creates: receipt filtering is CONTAINS and not a uniqueness guarantee.
      let o: z.infer<typeof orderSchema> | undefined;
      if (a.checkout) {
        o = orderSchema.parse(
          await d.request(
            `orders/${nativeId("order").parse(a.checkout.checkoutId)}`,
          ),
        );
        if (o.id !== a.checkout.checkoutId || !bound(o, a))
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      } else {
        const candidates: z.infer<typeof orderSchema>[] = [];
        let complete = false;
        const ids = new Set<string>();
        for (let skip = 0; skip < 1000; skip += 100) {
          const page = z
            .object({ count: money, items: z.array(orderSchema).max(100) })
            .parse(
              await d.request(
                `orders?receipt=${a.operationKey}&count=100&skip=${skip}`,
              ),
            );
          if (page.count !== page.items.length)
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          for (const candidate of page.items) {
            if (ids.has(candidate.id))
              throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
            ids.add(candidate.id);
            if (candidate.receipt === a.operationKey) {
              if (!bound(candidate, a))
                throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
              candidates.push(candidate);
            }
          }
          if (page.items.length < 100) {
            complete = true;
            break;
          }
        }
        if (!complete || candidates.length !== 1)
          return {
            checkout: null,
            observations: [],
            recovery: { ...a.recovery!, ambiguous: candidates.length > 1 },
          };
        o = candidates[0];
        const fetched = orderSchema.parse(await d.request(`orders/${o.id}`));
        if (fetched.id !== o.id || !bound(fetched, a))
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        o = fetched;
      }
      const hosted = checkout(o, a.snapshot);
      const response = z
        .object({ count: money, items: z.array(z.unknown()).max(100) })
        .parse(await d.request(`orders/${o.id}/payments`));
      if (
        response.count !== response.items.length ||
        response.items.length === 100
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const captures = response.items
        .map((p) => paymentSchema.safeParse(p))
        .filter((p) => p.success)
        .map((p) => p.data)
        .filter((p) => p.captured);
      if (captures.length > 1)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const observations: PaymentObservation[] = [];
      for (const found of captures) {
        const p = paymentSchema.parse(await d.request(`payments/${found.id}`));
        const card = z
          .object({
            id: nativeId("card"),
            international: z.boolean(),
            type: z.string(),
          })
          .parse(await d.request(`payments/${p.id}/card`));
        await customer(a.snapshot);
        if (
          p.id !== found.id ||
          p.created_at < o.created_at ||
          p.created_at < Math.floor(new Date(a.at).getTime() / 1000) ||
          p.order_id !== o.id ||
          p.customer_id !== hosted.customerId ||
          p.amount !== o.amount ||
          p.currency !== o.currency ||
          p.method !== "card" ||
          p.international !== (p.currency === "USD") ||
          card.id !== p.card_id ||
          card.international !== p.international ||
          !["credit", "debit"].includes(card.type) ||
          !["captured", "refunded"].includes(p.status) ||
          !p.captured ||
          p.amount_refunded > p.amount ||
          o.status !== "paid" ||
          o.amount_paid !== o.amount ||
          o.amount_due !== 0
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        const start = new Date(p.created_at * 1000).toISOString();
        observations.push({
          provider: "razorpay",
          account: a.snapshot.provider.account,
          operationKey: a.operationKey,
          status: "confirmed",
          customerId: p.customer_id,
          checkoutId: o.id,
          subscriptionId: null,
          paymentId: p.id,
          currency: p.currency,
          amountMinor: String(p.amount),
          paidAt: start,
          periodStart: start,
          periodEnd: periodEnd(start, a.snapshot.term),
          checkout: hosted,
          charge: {
            kind: "initial",
            invoiceId: null,
            refundedMinor: String(p.amount_refunded),
            orderId: o.id,
            planId: hosted.planId!,
            method: "card",
            international: p.international,
            subscriptionStart: start,
            feeMinor: p.fee == null ? null : String(p.fee),
            feeTaxMinor: p.tax == null ? null : String(p.tax),
            baseAmountMinor:
              p.base_amount == null ? null : String(p.base_amount),
            baseCurrency: p.base_currency === "INR" ? "INR" : null,
          },
        });
      }
      return { checkout: hosted, observations, recovery: a.recovery ?? null };
    },
  };
}
