import { createHash } from "node:crypto";
import { z } from "zod";
import { subscriptionCheckoutUrl } from "./razorpay-checkout";
import { isDeepStrictEqual } from "node:util";
import { ApplicationError } from "../models/application-error";
import {
  ReachEffectNotAttempted,
  type ReachChange,
  type ReachFact,
  type ReachGateway,
  type ReachStage,
} from "../models/reach-changes";
import type {
  PaymentSnapshot,
  PaymentObservation,
} from "../models/subscription-payments";
import type { RazorpayAccountReview } from "../models/razorpay-account";
import type { Clock } from "../models/business";

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const money = z.number().int().nonnegative().safe();
const subSchema = z.object({
  id: id("sub"),
  plan_id: id("plan"),
  customer_id: id("cust").nullable().optional(),
  status: z.string(),
  quantity: money,
  total_count: money,
  remaining_count: money.optional(),
  start_at: money.nullable().optional(),
  current_end: money.nullable().optional(),
  ended_at: money.nullable().optional(),
  notes: z.record(z.string(), z.string()),
  short_url: z.string(),
  has_scheduled_changes: z.boolean().optional(),
  change_scheduled_at: money.nullable().optional(),
});
const paymentSchema = z.object({
  vpa: z.string().nullable().optional(),
  id: id("pay"),
  customer_id: id("cust").nullable(),
  invoice_id: id("inv").nullable(),
  order_id: id("order").nullable(),
  status: z.string(),
  captured: z.boolean(),
  method: z.string(),
  international: z.boolean(),
  amount: money,
  currency: z.enum(["INR", "USD"]),
  amount_refunded: money,
  created_at: money.optional(),
  fee: money.nullable().optional(),
  tax: money.nullable().optional(),
  base_amount: money.nullable().optional(),
  base_currency: z.string().nullable().optional(),
});
const invoiceSchema = z.object({
  id: id("inv"),
  subscription_id: id("sub"),
  customer_id: id("cust").nullable(),
  payment_id: id("pay").nullable(),
  order_id: id("order").nullable(),
  status: z.string(),
  currency: z.enum(["INR", "USD"]),
  amount: money,
  amount_paid: money,
  amount_due: money,
  billing_start: money.nullable(),
  billing_end: money.nullable(),
  paid_at: money.nullable(),
  line_items: z.array(
    z.object({
      type: z.string(),
      quantity: money,
      amount: money,
      currency: z.string(),
    }),
  ),
});
const orderSchema = z.object({
  id: id("order"),
  amount: money,
  amount_paid: money,
  amount_due: money,
  currency: z.enum(["INR", "USD"]),
  receipt: z.string(),
  status: z.string(),
  notes: z.record(z.string(), z.string()),
});
const epoch = (value: string) => Math.floor(new Date(value).getTime() / 1000);
const stamp = (value: number) => new Date(value * 1000).toISOString();
const hash = (s: PaymentSnapshot) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");

/** Native contracts only: no monetary-preview API, universal update key or add-ons. */
export function createRazorpayReachGateway(d: {
  review: RazorpayAccountReview;
  keyId: string;
  clock: Clock;
  sourceRequest?(
    source: PaymentSnapshot["provider"],
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ): Promise<unknown>;
  request(
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ): Promise<unknown>;
  verifyPlan(
    snapshot: PaymentSnapshot,
  ): Promise<{ planId: string; totalCount: number }>;
}): ReachGateway {
  const account = `${d.review.account}:${d.review.mode}`;
  function sourceRequest(
    change: ReachChange,
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ) {
    const source = change.snapshot.action.snapshot.provider;
    if (source.account === account && source.mode === d.review.mode)
      return d.request(path, body, method);
    if (!d.sourceRequest) throw new ApplicationError("SETUP_REQUIRED");
    return d.sourceRequest(source, path, body, method);
  }
  const lastNative = (change: ReachChange) =>
    change.events.filter((e) => e.fact.native).at(-1)?.fact.native;
  async function page<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const results: T[] = [];
    for (let skip = 0; skip < 1000; skip += 100) {
      const result = z
        .object({ items: z.array(schema).max(100), count: money })
        .parse(
          await d.request(
            `${path}${path.includes("?") ? "&" : "?"}count=100&skip=${skip}`,
          ),
        );
      if (result.count !== result.items.length)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      results.push(...result.items);
      if (result.items.length < 100) return results;
    }
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  }
  function mapping(change: ReachChange) {
    const s = change.snapshot;
    if (
      s.target.provider.account !== account ||
      s.target.provider.mode !== d.review.mode ||
      !s.target.provider.review
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const found = s.target.provider.review!.plans.filter(
      (p) =>
        p.offerId === s.target.quote.selection.offerId &&
        p.reservedCapacityId === s.target.quote.selection.reservedCapacityId &&
        p.currency === s.target.quote.currency,
    );
    if (found.length !== 1) throw new ApplicationError("SETUP_REQUIRED");
    return found[0];
  }
  function replacementNotes(change: ReachChange) {
    const s = change.snapshot;
    return {
      operation_key: s.replacementOperationKey,
      action_id: s.replacementActionId,
      business_id: change.businessId,
      financial_hash: hash(s.target),
      account_review: s.target.provider.review!.id,
    };
  }
  function orderBody(change: ReachChange) {
    const s = change.snapshot;
    return {
      amount: Number(s.delta.tax.totals!.totalMinor),
      currency: s.delta.quote.currency,
      receipt: change.id,
      partial_payment: false,
      notes: {
        reach_change: change.id,
        financial_hash: hash(s.delta),
        customer_id: s.target.upi?.customerId ?? s.original.charge!.customerId!,
      },
    };
  }
  async function original(change: ReachChange, effect = false) {
    const s = change.snapshot,
      a = s.action,
      old = s.original.charge!;
    if (!a.checkout?.subscriptionId || !old.paymentId || !old.charge)
      throw new ApplicationError("SETUP_REQUIRED");
    const payment = paymentSchema.parse(
      await sourceRequest(change, `payments/${id("pay").parse(old.paymentId)}`),
    );
    if (
      !["captured", "refunded"].includes(payment.status) ||
      !payment.captured ||
      payment.method !== old.charge.method ||
      payment.customer_id !== old.customerId ||
      payment.order_id !== old.charge.orderId ||
      payment.invoice_id !== old.charge.invoiceId ||
      String(payment.amount) !== s.original.snapshot.tax.totals?.totalMinor ||
      payment.currency !== s.target.quote.currency ||
      payment.amount_refunded > payment.amount ||
      (effect && payment.amount_refunded !== 0) ||
      payment.international !== old.charge.international
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const sub = subSchema.parse(
      await sourceRequest(
        change,
        `subscriptions/${id("sub").parse(a.checkout.subscriptionId)}`,
      ),
    );
    const target = mapping(change);
    if (
      effect &&
      sub.plan_id !== s.sourcePlanId &&
      !(
        change.events.some(
          (e) => e.fact.kind === "attempt" && e.fact.stage === "update",
        ) && sub.plan_id === target.planId
      )
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const expected = {
      operation_key: a.operationKey,
      action_id: a.id,
      business_id: change.businessId,
      financial_hash: hash(a.snapshot),
      account_review: a.snapshot.provider.review?.id,
    };
    if (
      sub.id !== a.checkout.subscriptionId ||
      sub.customer_id !== old.customerId ||
      sub.quantity !== 1 ||
      Object.entries(expected).some(([k, v]) => sub.notes[k] !== v)
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return sub;
  }
  function capture(
    change: ReachChange,
    p: z.infer<typeof paymentSchema>,
    invoice: z.infer<typeof invoiceSchema> | null,
    order: z.infer<typeof orderSchema> | null,
  ): PaymentObservation {
    const s = change.snapshot,
      plan = mapping(change);
    if (
      !["captured", "refunded"].includes(p.status) ||
      !p.captured ||
      p.method !== (s.target.upi ? "upi" : "card") ||
      (s.target.upi &&
        !s.target.provider.review?.upiPath?.supportedHandles.includes(
          p.vpa?.split("@").at(-1)?.toLowerCase() ?? "",
        )) ||
      p.customer_id !==
        (s.target.upi?.customerId ?? s.original.charge!.customerId) ||
      p.international !==
        (s.target.upi ? false : s.original.charge!.charge!.international) ||
      p.amount_refunded > p.amount ||
      String(p.amount) !== s.delta.tax.totals!.totalMinor ||
      p.currency !== s.delta.quote.currency ||
      !p.order_id
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    if (
      invoice &&
      (invoice.payment_id !== p.id ||
        invoice.id !== p.invoice_id ||
        invoice.order_id !== p.order_id ||
        invoice.subscription_id !== s.action.checkout!.subscriptionId ||
        invoice.customer_id !== p.customer_id ||
        invoice.status !== "paid" ||
        invoice.amount_paid !== invoice.amount ||
        invoice.amount_due !== 0 ||
        invoice.amount !== p.amount ||
        invoice.currency !== p.currency ||
        invoice.billing_start !== epoch(s.effectiveAt) ||
        invoice.billing_end !== epoch(s.renewalAt) ||
        invoice.line_items.length !== 1 ||
        invoice.line_items[0].quantity !== 1 ||
        invoice.line_items[0].type !== "plan" ||
        invoice.line_items[0].amount !== p.amount ||
        invoice.line_items[0].currency !== p.currency)
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    if (
      order &&
      (p.order_id !== order.id ||
        order.status !== "paid" ||
        order.amount_paid !== p.amount ||
        order.amount_due !== 0 ||
        p.invoice_id !== null)
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const paidAt = invoice?.paid_at ?? p.created_at;
    if (
      paidAt == null ||
      paidAt < epoch(s.effectiveAt) ||
      paidAt > epoch(d.clock.now().toISOString())
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return {
      provider: "razorpay",
      account,
      operationKey: s.deltaOperationKey,
      status: "confirmed",
      customerId: p.customer_id,
      checkoutId: invoice ? s.action.checkout!.subscriptionId : order!.id,
      subscriptionId: invoice ? s.action.checkout!.subscriptionId : null,
      paymentId: p.id,
      currency: p.currency,
      amountMinor: String(p.amount),
      paidAt: stamp(paidAt),
      periodStart: s.effectiveAt,
      periodEnd: s.renewalAt,
      checkout: null,
      charge: {
        kind: "reach_delta",
        invoiceId: invoice?.id ?? null,
        orderId: p.order_id,
        planId: plan.planId,
        method: s.target.upi ? "upi" : "card",
        international: p.international,
        subscriptionStart: s.original.charge!.charge!.subscriptionStart,
        feeMinor: p.fee == null ? null : String(p.fee),
        feeTaxMinor: p.tax == null ? null : String(p.tax),
        baseAmountMinor: p.base_amount == null ? null : String(p.base_amount),
        baseCurrency: p.base_currency === "INR" ? "INR" : null,
      },
    };
  }
  async function sourceTerms(change: ReachChange) {
    const s = change.snapshot,
      plan = mapping(change);
    if (s.target.upi) await d.verifyPlan(s.target);
    const target = z
      .object({
        id: id("plan"),
        period: z.literal("monthly"),
        interval: z.literal(1),
        item: z.object({ amount: money, currency: z.enum(["INR", "USD"]) }),
      })
      .parse(await d.request(`plans/${plan.planId}`));
    if (
      target.id !== plan.planId ||
      target.item.currency !== s.target.quote.currency ||
      String(target.item.amount) !== s.target.tax.totals?.totalMinor
    )
      throw new ApplicationError("SETUP_REQUIRED");
    if (s.path === "international_native") {
      const source = z
        .object({
          id: id("plan"),
          period: z.literal("monthly"),
          interval: z.literal(1),
          item: z.object({ amount: money, currency: z.enum(["INR", "USD"]) }),
        })
        .parse(await d.request(`plans/${id("plan").parse(s.sourcePlanId)}`));
      if (
        source.id !== s.sourcePlanId ||
        source.item.currency !== s.target.quote.currency ||
        String(source.item.amount) !== s.currentFinancial.tax.totals?.totalMinor
      )
        throw new ApplicationError("SETUP_REQUIRED");
      if (s.direction === "expansion") {
        if (BigInt(s.delta.tax.totals!.totalMinor) < 50n)
          throw new ApplicationError("SETUP_REQUIRED");
        const difference =
            BigInt(s.target.tax.totals!.totalMinor) -
            BigInt(source.item.amount),
          n = BigInt(s.proration.numerator),
          den = BigInt(s.proration.denominator);
        if (
          difference <= 0n ||
          (difference * n * 2n + den) / (den * 2n) !==
            BigInt(s.delta.tax.totals!.totalMinor)
        )
          throw new ApplicationError("SETUP_REQUIRED");
      }
    }
  }
  async function inspect(change: ReachChange): Promise<ReachFact> {
    const s = change.snapshot,
      plan = mapping(change),
      sub = await original(change),
      saved = lastNative(change),
      approved = change.events.some((e) => e.fact.kind === "approved");
    let planReady = true;
    try {
      await sourceTerms(change);
    } catch (error: unknown) {
      if (!approved) throw error;
      planReady = false;
    }
    if (!approved && !sub.remaining_count)
      throw new ApplicationError("SETUP_REQUIRED");
    const native: NonNullable<ReachFact["native"]> = {
      subscriptionId: null,
      orderId: null,
      checkoutUrl: null,
      oldStopped: saved?.oldStopped ?? false,
      mandateReady: false,
      updated: false,
      planId: plan.planId,
      totalCount:
        s.path === "replacement_mandate" ? plan.totalCount : sub.total_count,
      remainingCount: sub.remaining_count ?? 0,
      deltaRefundedMinor: "0",
      customerId: s.target.upi?.customerId ?? s.original.charge!.customerId!,
    };
    let paid: PaymentObservation | undefined;
    let incurred: ReachFact["incurred"];
    if (s.path === "international_native") {
      if (
        !s.original.charge!.charge!.international ||
        s.target.provider.review?.internationalUpdates !==
          "native_proration_reviewed" ||
        !s.policy.nativeProration.enabled
      )
        throw new ApplicationError("SETUP_REQUIRED");
      if (s.direction === "reduction" && sub.has_scheduled_changes) {
        const pending = subSchema.parse(
          await d.request(`subscriptions/${sub.id}/retrieve_scheduled_changes`),
        );
        native.updated =
          pending.id === sub.id &&
          pending.customer_id === sub.customer_id &&
          pending.plan_id === plan.planId &&
          pending.quantity === 1 &&
          pending.change_scheduled_at === epoch(s.renewalAt) &&
          planReady;
      } else
        native.updated =
          sub.plan_id === plan.planId &&
          ["authenticated", "active"].includes(sub.status) &&
          planReady;
      native.subscriptionId = sub.id;
      native.mandateReady = true;
      const invoices = await page(
        `invoices?subscription_id=${sub.id}`,
        invoiceSchema,
      );
      const candidates = invoices.filter(
        (i) =>
          i.status === "paid" &&
          i.payment_id &&
          i.billing_start === epoch(s.effectiveAt) &&
          i.billing_end === epoch(s.renewalAt),
      );
      if (candidates.length > 1)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      if (candidates[0]?.payment_id) {
        const payment = paymentSchema.parse(
          await d.request(`payments/${candidates[0].payment_id}`),
        );
        paid = capture(change, payment, candidates[0], null);
        native.deltaRefundedMinor = String(payment.amount_refunded);
      }
    } else {
      if (!approved && sub.plan_id !== s.sourcePlanId)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      if (sub.status === "cancelled" && sub.ended_at === epoch(s.renewalAt))
        native.oldStopped = true;
      const attempted = change.events.some(
        (e) => e.fact.kind === "attempt" && e.fact.stage === "mandate",
      );
      let replacement: z.infer<typeof subSchema> | undefined;
      if (saved?.subscriptionId)
        replacement = subSchema.parse(
          await d.request(
            `subscriptions/${id("sub").parse(saved.subscriptionId)}`,
          ),
        );
      else if (attempted) {
        const subs = await page(
          `subscriptions?plan_id=${plan.planId}&from=${epoch(change.at) - 300}&to=${epoch(d.clock.now().toISOString()) + 1}`,
          subSchema,
        );
        const matches = subs.filter((r) =>
          Object.entries(replacementNotes(change)).every(
            ([k, v]) => r.notes[k] === v,
          ),
        );
        if (matches.length > 1)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        replacement = matches[0];
      }
      if (replacement) {
        if (
          replacement.plan_id !== plan.planId ||
          replacement.quantity !== 1 ||
          replacement.total_count !== plan.totalCount ||
          replacement.start_at !== epoch(s.renewalAt) ||
          Object.entries(replacementNotes(change)).some(
            ([k, v]) => replacement.notes[k] !== v,
          ) ||
          (replacement.customer_id &&
            replacement.customer_id !== native.customerId)
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        native.subscriptionId = replacement.id;
        native.checkoutUrl = subscriptionCheckoutUrl(replacement.short_url);
        if (
          ["authenticated", "active"].includes(replacement.status) &&
          replacement.customer_id === native.customerId &&
          planReady
        ) {
          for (const proof of change.mandatePayments.filter(
            (p) => p.subscriptionId === replacement.id,
          )) {
            const p = paymentSchema.parse(
              await d.request(`payments/${id("pay").parse(proof.paymentId)}`),
            );
            if (
              p.id !== proof.paymentId ||
              p.customer_id !== native.customerId ||
              p.method !== (s.target.upi ? "upi" : "card") ||
              (s.target.upi &&
                !s.target.provider.review?.upiPath?.supportedHandles.includes(
                  p.vpa?.split("@").at(-1)?.toLowerCase() ?? "",
                )) ||
              p.international !==
                (s.target.upi
                  ? false
                  : s.original.charge!.charge!.international) ||
              p.currency !== s.target.quote.currency ||
              !["authorized", "captured", "refunded"].includes(p.status)
            )
              throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
            native.mandateReady = true;
          }
        }
      }
      let order: z.infer<typeof orderSchema> | undefined;
      if (saved?.orderId)
        order = orderSchema.parse(
          await d.request(`orders/${id("order").parse(saved.orderId)}`),
        );
      else if (
        change.events.some(
          (e) => e.fact.kind === "attempt" && e.fact.stage === "order",
        )
      ) {
        const orders = await page(
            `orders?from=${epoch(change.at) - 300}&to=${epoch(d.clock.now().toISOString()) + 1}`,
            orderSchema,
          ),
          body = orderBody(change);
        const matches = orders.filter(
          (o) =>
            o.receipt === body.receipt &&
            isDeepStrictEqual(o.notes, body.notes),
        );
        if (matches.length > 1)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        order = matches[0];
      }
      if (order) {
        const body = orderBody(change);
        if (
          order.receipt !== body.receipt ||
          order.amount !== body.amount ||
          order.currency !== body.currency ||
          !isDeepStrictEqual(order.notes, body.notes)
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        native.orderId = order.id;
        const payments = z
            .object({ count: money, items: z.array(paymentSchema).max(100) })
            .parse(await d.request(`orders/${order.id}/payments`)).items,
          captured = payments.filter(
            (p) => ["captured", "refunded"].includes(p.status) && p.captured,
          );
        if (captured.length > 1)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        if (captured[0]) {
          try {
            paid = capture(change, captured[0], null, order);
          } catch (error: unknown) {
            if (!s.target.upi) throw error;
            const p = captured[0];
            incurred = {
              account,
              mode: d.review.mode,
              paymentId: p.id,
              orderId: order.id,
              customerId: p.customer_id,
              method: p.method,
              amountMinor: String(p.amount),
              currency: p.currency,
              refundedMinor: String(p.amount_refunded),
              observedAt: d.clock.now().toISOString(),
            };
          }
          native.deltaRefundedMinor = String(captured[0].amount_refunded);
        }
      }
    }
    return {
      kind: "native",
      native,
      ...(paid ? { capture: paid } : {}),
      ...(incurred ? { incurred } : {}),
    };
  }
  function intent(change: ReachChange, stage: ReachStage) {
    const s = change.snapshot,
      plan = mapping(change),
      approved = change.events.find((e) => e.fact.kind === "approved")?.fact
        .native;
    if (!approved) throw new ApplicationError("CONFLICT");
    if (stage === "update")
      return {
        plan_id: plan.planId,
        quantity: 1,
        remaining_count: approved.remainingCount,
        schedule_change_at: s.direction === "expansion" ? "now" : "cycle_end",
        customer_notify: true,
      };
    if (stage === "stop_old") return { cancel_at_cycle_end: true };
    if (stage === "mandate")
      return {
        plan_id: plan.planId,
        quantity: 1,
        total_count: plan.totalCount,
        customer_notify: true,
        start_at: epoch(s.renewalAt),
        notes: replacementNotes(change),
      };
    return orderBody(change);
  }
  return {
    inspect,
    intent,
    async effect(change, stage, authorize) {
      let sub: z.infer<typeof subSchema>;
      try {
        await d.verifyPlan(change.snapshot.target);
        await sourceTerms(change);
        sub = await original(change, true);
        if (
          !["active", "authenticated"].includes(sub.status) ||
          sub.current_end !== epoch(change.snapshot.renewalAt) ||
          d.clock.now().getTime() >=
            new Date(change.snapshot.renewalAt).getTime()
        )
          throw new Error("Obsolete source");
        mapping(change);
        const approved = change.events.find((e) => e.fact.kind === "approved")
          ?.fact.native;
        if (!approved || sub.remaining_count !== approved.remainingCount)
          throw new Error("Native duration changed");
        if (
          stage === "update" &&
          (!change.snapshot.original.charge!.charge!.international ||
            change.snapshot.path !== "international_native")
        )
          throw new Error("Domestic update denied");
        await authorize();
        if (
          change.snapshot.target.upi &&
          (!isDeepStrictEqual(
            d.review,
            change.snapshot.target.provider.review,
          ) ||
            new Date(d.review.effectiveUntil) <= d.clock.now() ||
            new Date(d.review.effectiveFrom) > d.clock.now() ||
            !d.review.upiPath?.enabled)
        )
          throw new Error("UPI review changed");
      } catch {
        throw new ReachEffectNotAttempted();
      }
      const s = change.snapshot;
      const body = change.events
        .filter((e) => e.fact.kind === "attempt" && e.fact.stage === stage)
        .at(-1)?.fact.body;
      if (!body || !isDeepStrictEqual(body, intent(change, stage)))
        throw new ReachEffectNotAttempted();
      if (stage === "update") {
        // An earlier or concurrent native update may win during preflight reads.
        // Reconcile its independent capture instead of mutating the same target again.
        if (sub.plan_id === mapping(change).planId) return inspect(change);
        await d.request(`subscriptions/${sub.id}`, body, "PATCH");
        return inspect(change);
      }
      if (stage === "stop_old") {
        const result = subSchema.parse(
          await sourceRequest(change, `subscriptions/${sub.id}/cancel`, body),
        );
        if (
          result.id !== sub.id ||
          result.customer_id !== sub.customer_id ||
          result.plan_id !== sub.plan_id ||
          result.current_end !== epoch(s.renewalAt) ||
          !isDeepStrictEqual(result.notes, sub.notes)
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        const fact = await inspect(change);
        fact.native!.oldStopped = true;
        return fact;
      }
      if (!lastNative(change)?.oldStopped) throw new ReachEffectNotAttempted();
      if (stage === "mandate") {
        await d.request("subscriptions", body);
      } else await d.request("orders", body);
      return inspect(change);
    },
    checkout(change, purpose) {
      const native = lastNative(change);
      if (!native?.oldStopped || change.snapshot.path !== "replacement_mandate")
        throw new ApplicationError("CONFLICT");
      const base = {
        ...(change.snapshot.target.upi
          ? {
              paymentMethod: "upi",
              actionId: change.snapshot.replacementActionId,
            }
          : {}),
        script: "https://checkout.razorpay.com/v1/checkout.js",
        key: d.keyId,
        customer_id: native.customerId,
      };
      if (
        purpose === "mandate" &&
        native.subscriptionId &&
        !native.mandateReady
      )
        return {
          ...base,
          kind: "mandate",
          subscription_id: native.subscriptionId,
        };
      if (
        purpose === "delta" &&
        native.orderId &&
        native.mandateReady &&
        !change.events.some((e) => e.fact.kind === "capture")
      )
        return {
          ...base,
          kind: "delta",
          order_id: native.orderId,
          amount: change.snapshot.delta.tax.totals?.totalMinor,
          currency: change.snapshot.delta.quote.currency,
        };
      throw new ApplicationError("CONFLICT");
    },
  };
}
