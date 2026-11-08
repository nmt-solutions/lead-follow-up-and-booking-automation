import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { subscriptionCheckoutUrl } from "./razorpay-checkout";
import type {
  PaymentGateway,
  PaymentSnapshot,
  PaymentObservation,
  PaymentAction,
} from "../models/subscription-payments";
import type { RazorpayAccountReview } from "../models/razorpay-account";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import { PaymentCreationNotAttempted } from "../models/subscription-payments";
import { lifecycleObservationSchema } from "../models/subscription-lifecycle";
import { effectiveLifecyclePolicy } from "../models/subscription-lifecycle";
import { createRazorpayReachGateway } from "./reach-razorpay";
import { createNativePilotOrders } from "./pilot-razorpay";

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
const subscriptionSchema = z.object({
  id: id("sub"),
  plan_id: id("plan"),
  customer_id: id("cust").nullable().optional(),
  status: z.string(),
  quantity: z.number().int(),
  total_count: z.number().int(),
  start_at: z.number().int().nullable().optional(),
  notes: z.record(z.string(), z.string()),
  short_url: z.string(),
  created_at: z.number().int(),
  current_end: z.number().int().nullable().optional(),
  ended_at: z.number().int().nullable().optional(),
});
const money = z.number().int().nonnegative().safe();
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
  fee: money.nullable().optional(),
  tax: money.nullable().optional(),
  base_amount: money.nullable().optional(),
  base_currency: z.string().nullable().optional(),
});
export function createRazorpayGateway(d: {
  review: RazorpayAccountReview;
  keyId: string;
  secret: string;
  webhookSecrets: string[];
  fetch: typeof fetch;
  clock: Clock;
  sourceRequest?(
    source: PaymentSnapshot["provider"],
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ): Promise<unknown>;
  verifySandbox?(): Promise<void>;
}): PaymentGateway {
  const review = d.review;
  const account = `${review.account}:${review.mode}`;
  const method = review.upiPath ? "upi" : "card";
  function upiMethod(
    p: z.infer<typeof paymentSchema>,
    snapshot: PaymentSnapshot,
  ) {
    return (
      !snapshot.upi ||
      (p.method === "upi" &&
        p.customer_id === snapshot.upi.customerId &&
        snapshot.provider.review?.upiPath?.supportedHandles.includes(
          p.vpa?.split("@").at(-1)?.toLowerCase() ?? "",
        ))
    );
  }
  function readiness() {
    const at = d.clock.now();
    const reasons: string[] = [];
    if (
      new Date(review.checkedAt) > at ||
      new Date(review.effectiveFrom) > at ||
      new Date(review.effectiveUntil) <= at
    )
      reasons.push("account_review_expired_or_not_effective");
    if (!review.subscriptions)
      reasons.push("subscriptions_activation_required");
    if (method === "card") {
      if (!review.methods.card || review.methods.upi || review.methods.emandate)
        reasons.push("provider_card_only_settings_required");
    } else {
      const p = review.upiPath!;
      if (
        !p.enabled ||
        review.methods.card ||
        !review.methods.upi ||
        review.methods.emandate
      )
        reasons.push("provider_upi_only_settings_required");
      if (
        p.sandbox.account !== review.account ||
        new Date(p.sandbox.checkedAt) > at ||
        (review.mode === "live" && p.sandbox.kind !== "native_sandbox") ||
        BigInt(p.minimumMinor) > BigInt(p.maximumMinor)
      )
        reasons.push("matching_upi_support_and_sandbox_evidence_required");
      if (
        p.sandbox.kind === "native_sandbox" &&
        (!p.sandbox.native || !d.verifySandbox)
      )
        reasons.push("native_upi_sandbox_evidence_read_configuration_required");
    }
    if (review.settlement !== "INR")
      reasons.push("inr_settlement_review_required");
    if (!review.calendar.utcCalendarMonth)
      reasons.push("utc_calendar_term_review_required");
    return reasons;
  }
  function supports(currency: "INR" | "USD") {
    return (
      !readiness().length &&
      (method === "upi"
        ? currency === "INR" && review.domestic.enabled
        : (currency === "INR" ? review.domestic : review.international).enabled)
    );
  }
  const financialHash = (s: PaymentSnapshot) =>
    createHash("sha256").update(JSON.stringify(s)).digest("hex");
  function planFor(s: PaymentSnapshot) {
    const plans = review.plans.filter(
      (p) =>
        p.offerId === s.quote.selection.offerId &&
        p.reservedCapacityId === s.quote.selection.reservedCapacityId &&
        p.currency === s.quote.currency,
    );
    if (
      !supports(s.quote.currency) ||
      s.term.kind !== "calendar_month" ||
      plans.length !== 1 ||
      !isDeepStrictEqual(s.provider.review, review)
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const maximum = BigInt(
      method === "upi"
        ? review.upiPath!.maximumMinor
        : s.quote.currency === "INR"
          ? review.domestic.maxChargeMinor
          : review.international.maxChargeMinor,
    );
    if (
      !s.tax.totals ||
      (!s.pilotContinuation &&
        s.quote.initial.subtotalMinor !== s.quote.renewal.subtotalMinor) ||
      BigInt(s.tax.totals.totalMinor) > maximum ||
      (method === "card" &&
        s.quote.currency === "INR" &&
        BigInt(s.tax.totals.totalMinor) > 1500000n) ||
      (method === "upi" &&
        (!s.upi ||
          s.upi.account !== account ||
          s.upi.mode !== review.mode ||
          BigInt(s.tax.totals.totalMinor) <
            BigInt(review.upiPath!.minimumMinor))) ||
      (method === "upi" &&
        review.upiPath!.sandbox.kind === "native_sandbox" &&
        BigInt(s.tax.totals!.totalMinor) >
          BigInt(review.upiPath!.sandbox.native!.amountMinor))
    )
      throw new ApplicationError("SETUP_REQUIRED");
    return plans[0];
  }
  async function request(
    path: string,
    body?: unknown,
    method?: "POST" | "PATCH",
  ): Promise<unknown> {
    try {
      const response = await d.fetch(`https://api.razorpay.com/v1/${path}`, {
        method: method ?? (body ? "POST" : "GET"),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
        headers: {
          authorization: `Basic ${Buffer.from(`${d.keyId}:${d.secret}`).toString("base64")}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error("native request failed");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("native response missing");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 1024 * 1024) {
            await reader.cancel();
            throw new Error("native response too large");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    }
  }
  async function verifyPlan(s: PaymentSnapshot) {
    const mapping = planFor(s);
    if (method === "upi" && review.upiPath?.sandbox.kind === "native_sandbox")
      await d.verifySandbox?.();
    const plan = z
      .object({
        id: id("plan"),
        period: z.literal("monthly"),
        interval: z.literal(1),
        item: z.object({
          amount: z.number().int().positive().safe(),
          currency: z.enum(["INR", "USD"]),
        }),
      })
      .parse(await request(`plans/${mapping.planId}`));
    if (
      plan.id !== mapping.planId ||
      plan.item.currency !== s.quote.currency ||
      String(plan.item.amount) !== s.tax.totals?.totalMinor
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const methods = z
      .object({
        card: z.record(z.string(), z.boolean()).optional(),
        upi: z.boolean().optional(),
      })
      .parse(await request("methods"));
    if (
      method === "upi"
        ? methods.upi !== true
        : !Object.values(methods.card ?? {}).some(Boolean)
    )
      throw new ApplicationError("SETUP_REQUIRED");
    if (s.upi) {
      const customer = z
        .object({ id: id("cust"), entity: z.literal("customer") })
        .parse(
          await request(`customers/${id("cust").parse(s.upi.customerId)}`),
        );
      if (customer.id !== s.upi.customerId)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    }
    return mapping;
  }
  function checkout(
    sub: z.infer<typeof subscriptionSchema>,
    snapshot?: PaymentSnapshot,
  ) {
    return {
      ...(snapshot?.pilotContinuation
        ? {
            mandate: {
              script: "https://checkout.razorpay.com/v1/checkout.js" as const,
              key: d.keyId,
              customer_id: snapshot.pilotContinuation.customerId,
              subscription_id: sub.id,
            },
          }
        : {}),
      customerId: sub.customer_id ?? null,
      checkoutId: sub.id,
      subscriptionId: sub.id,
      planId: sub.plan_id,
      url: subscriptionCheckoutUrl(sub.short_url),
    };
  }
  function bound(
    sub: z.infer<typeof subscriptionSchema>,
    action: PaymentAction,
  ) {
    const s = action.snapshot,
      mapping = s.provider.review?.plans.filter(
        (p) =>
          p.offerId === s.quote.selection.offerId &&
          p.reservedCapacityId === s.quote.selection.reservedCapacityId &&
          p.currency === s.quote.currency,
      );
    const changed = action.reachRenewals
      ?.filter((c) => c.native.updated)
      .at(-1);
    return (
      mapping?.length === 1 &&
      (sub.plan_id === mapping[0].planId ||
        sub.plan_id === changed?.native.planId) &&
      sub.quantity === 1 &&
      sub.total_count ===
        (changed?.native.totalCount ?? mapping[0].totalCount) &&
      sub.notes.operation_key === action.operationKey &&
      sub.notes.action_id === action.id &&
      sub.notes.business_id === action.businessId &&
      sub.notes.financial_hash === financialHash(s) &&
      sub.notes.account_review === s.provider.review?.id &&
      (!s.pilotContinuation ||
        (sub.start_at ===
          Math.floor(new Date(s.pilotContinuation.startAt).getTime() / 1000) &&
          (!sub.customer_id ||
            sub.customer_id === s.pilotContinuation.customerId)))
    );
  }
  function lifecycle(
    sub: z.infer<typeof subscriptionSchema>,
    action: PaymentAction,
    unpaidPeriodStart: string | null = null,
  ) {
    return lifecycleObservationSchema.parse({
      provider: "razorpay",
      account,
      operationKey: action.operationKey,
      subscriptionId: sub.id,
      status: sub.status,
      currentEnd:
        sub.current_end == null
          ? null
          : new Date(sub.current_end * 1000).toISOString(),
      endedAt:
        sub.ended_at == null
          ? null
          : new Date(sub.ended_at * 1000).toISOString(),
      unpaidPeriodStart,
      observedAt: d.clock.now().toISOString(),
    });
  }
  async function currentSubscription(action: PaymentAction) {
    if (
      action.snapshot.provider.key !== "razorpay" ||
      action.snapshot.provider.account !== account ||
      action.snapshot.provider.mode !== review.mode ||
      !action.checkout?.subscriptionId
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const sub = subscriptionSchema.parse(
      await request(
        `subscriptions/${id("sub").parse(action.checkout.subscriptionId)}`,
      ),
    );
    if (
      sub.id !== action.checkout.subscriptionId ||
      !bound(sub, action) ||
      (action.checkout.customerId &&
        sub.customer_id !== action.checkout.customerId)
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return sub;
  }
  async function poll({ action }: { action: PaymentAction }) {
    const recovery = action.recovery ?? {
      subscriptionSkip: 0,
      candidateId: null,
      ambiguous: false,
      invoiceSkip: 0,
    };
    let sub: z.infer<typeof subscriptionSchema> | null = null;
    if (action.checkout?.subscriptionId) {
      sub = await currentSubscription(action);
    } else {
      const plan = action.snapshot.provider.review?.plans.find(
        (p) =>
          p.offerId === action.snapshot.quote.selection.offerId &&
          p.reservedCapacityId ===
            action.snapshot.quote.selection.reservedCapacityId &&
          p.currency === action.snapshot.quote.currency,
      );
      if (!plan || recovery.ambiguous)
        return { checkout: null, observations: [], recovery };
      const from =
        Math.floor(
          new Date(action.recovery?.creationAt ?? action.at).getTime() / 1000,
        ) - 60;
      const page = z
        .object({ items: z.array(subscriptionSchema).max(100), count: money })
        .parse(
          await request(
            `subscriptions?plan_id=${plan.planId}&from=${from}&to=${from + 360}&count=100&skip=${recovery.subscriptionSkip}`,
          ),
        );
      if (page.count !== page.items.length)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      for (const candidate of page.items) {
        if (candidate.notes.operation_key !== action.operationKey) continue;
        if (
          !bound(candidate, action) ||
          (recovery.candidateId && recovery.candidateId !== candidate.id)
        )
          recovery.ambiguous = true;
        else recovery.candidateId = candidate.id;
      }
      if (page.items.length === 100) {
        recovery.subscriptionSkip += 100;
        return { checkout: null, observations: [], recovery };
      }
      // Even an exhaustive empty list never authorizes another create. Restart lookup on the next sweep.
      recovery.subscriptionSkip = 0;
      if (!recovery.candidateId || recovery.ambiguous)
        return { checkout: null, observations: [], recovery };
      sub = subscriptionSchema.parse(
        await request(`subscriptions/${recovery.candidateId}`),
      );
      if (sub.id !== recovery.candidateId || !bound(sub, action))
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    }
    const hosted = checkout(sub, action.snapshot);
    const page = z
      .object({ items: z.array(invoiceSchema).max(20), count: money })
      .parse(
        await request(
          `invoices?subscription_id=${sub.id}&count=20&skip=${recovery.invoiceSkip}`,
        ),
      );
    if (page.count !== page.items.length)
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const observations: PaymentObservation[] = [];
    // Re-read exact original captures independently of current plan changes.
    // Invoice pagination remains coordinated with #47 and never reallocates them.
    for (const original of action.snapshot.pilotContinuation
      ? (action.settledCaptures ?? [])
      : []) {
      if (
        !original.paymentId ||
        !original.charge ||
        original.provider !== "razorpay" ||
        original.account !== account ||
        original.operationKey !== action.operationKey ||
        original.subscriptionId !== sub.id
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const p = paymentSchema.parse(
        await request(`payments/${id("pay").parse(original.paymentId)}`),
      );
      if (
        p.id !== original.paymentId ||
        p.invoice_id !== original.charge.invoiceId ||
        p.order_id !== original.charge.orderId ||
        p.customer_id !== original.customerId ||
        String(p.amount) !== original.amountMinor ||
        p.currency !== original.currency ||
        p.method !== "card" ||
        p.international !== original.charge.international ||
        !p.captured ||
        !["captured", "refunded"].includes(p.status) ||
        p.amount_refunded > p.amount
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      observations.push({
        ...original,
        charge: {
          ...original.charge,
          ...(p.amount_refunded > 0
            ? { refundedMinor: String(p.amount_refunded) }
            : {}),
          feeMinor: p.fee == null ? null : String(p.fee),
          feeTaxMinor: p.tax == null ? null : String(p.tax),
          baseAmountMinor: p.base_amount == null ? null : String(p.base_amount),
          baseCurrency: p.base_currency === "INR" ? "INR" : null,
        },
      });
    }
    const unpaid = page.items
      .filter(
        (i) =>
          i.status === "issued" &&
          i.amount_due > 0 &&
          i.billing_start !== null &&
          i.subscription_id === sub.id &&
          i.customer_id === sub.customer_id &&
          i.currency === action.snapshot.quote.currency &&
          i.line_items.length === 1 &&
          i.line_items[0].type === "plan" &&
          i.line_items[0].quantity === 1 &&
          i.line_items[0].amount === i.amount &&
          i.line_items[0].currency === i.currency,
      )
      .sort((a, b) => (b.billing_start ?? 0) - (a.billing_start ?? 0))[0];
    for (const invoice of page.items) {
      if (invoice.status !== "paid" || !invoice.payment_id) continue;
      if (
        action.settledPaymentIds?.includes(invoice.payment_id) ||
        action.reachRenewals?.some(
          (c) =>
            c.deltaPaymentId === invoice.payment_id ||
            (invoice.billing_start != null &&
              invoice.billing_end != null &&
              new Date(invoice.billing_start * 1000).toISOString() ===
                c.effectiveAt &&
              new Date(invoice.billing_end * 1000).toISOString() ===
                c.renewalAt),
        )
      )
        continue;
      const p = paymentSchema.parse(
        await request(`payments/${invoice.payment_id}`),
      );
      const epoch = (value: number | null) =>
        value === null ? null : new Date(value * 1000).toISOString();
      const valid =
        p.id === invoice.payment_id &&
        p.invoice_id === invoice.id &&
        p.order_id === invoice.order_id &&
        p.customer_id === invoice.customer_id &&
        p.customer_id === sub.customer_id &&
        invoice.subscription_id === sub.id &&
        (p.status === "captured" ||
          (p.status === "refunded" && p.amount_refunded > 0)) &&
        p.captured &&
        p.method === method &&
        upiMethod(p, action.snapshot) &&
        sub.start_at != null &&
        p.amount_refunded <= p.amount &&
        p.amount === invoice.amount &&
        invoice.amount_paid === invoice.amount &&
        invoice.amount_due === 0 &&
        p.currency === invoice.currency &&
        invoice.currency === action.snapshot.quote.currency &&
        invoice.line_items.length === 1 &&
        invoice.line_items[0].type === "plan" &&
        invoice.line_items[0].quantity === 1 &&
        invoice.line_items[0].amount === invoice.amount &&
        invoice.line_items[0].currency === invoice.currency &&
        p.international === (invoice.currency === "USD");
      const customerValid =
        !action.snapshot.pilotContinuation ||
        p.customer_id === action.snapshot.pilotContinuation.customerId;
      observations.push({
        provider: "razorpay",
        account,
        operationKey: action.operationKey,
        status: valid && customerValid ? "confirmed" : "unknown",
        customerId: invoice.customer_id,
        checkoutId: sub.id,
        subscriptionId: sub.id,
        paymentId: p.id,
        currency: invoice.currency,
        amountMinor: String(invoice.amount),
        paidAt: epoch(invoice.paid_at),
        periodStart: epoch(invoice.billing_start),
        periodEnd: epoch(invoice.billing_end),
        checkout: hosted,
        ...(valid && customerValid
          ? {
              charge: {
                kind:
                  invoice.billing_start === sub.start_at
                    ? ("initial" as const)
                    : ("renewal" as const),
                invoiceId: invoice.id,
                ...(p.amount_refunded > 0
                  ? { refundedMinor: String(p.amount_refunded) }
                  : {}),
                orderId: invoice.order_id!,
                planId: sub.plan_id,
                method,
                international: p.international,
                subscriptionStart: new Date(sub.start_at! * 1000).toISOString(),
                feeMinor: p.fee == null ? null : String(p.fee),
                feeTaxMinor: p.tax == null ? null : String(p.tax),
                baseAmountMinor:
                  p.base_amount == null ? null : String(p.base_amount),
                baseCurrency:
                  p.base_currency === "INR" ? ("INR" as const) : null,
              },
            }
          : {
              review: {
                invoiceId: invoice.id,
                reason: "paid_invoice_binding_mismatch" as const,
              },
            }),
      });
    }
    recovery.invoiceSkip =
      page.items.length === 20 ? recovery.invoiceSkip + 20 : 0;
    return {
      checkout: hosted,
      lifecycle: lifecycle(
        sub,
        action,
        unpaid?.billing_start == null
          ? null
          : new Date(unpaid.billing_start * 1000).toISOString(),
      ),
      observations: observations.sort((a, b) =>
        (a.periodStart ?? "").localeCompare(b.periodStart ?? ""),
      ),
      recovery,
    };
  }
  const unavailable = async (): Promise<never> => {
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  };
  const pilot = createNativePilotOrders({
    review,
    keyId: d.keyId,
    secret: d.secret,
    request,
    ready: readiness,
  });
  const gateway: PaymentGateway = {
    method,
    nativeRequest: request,
    reach: createRazorpayReachGateway({
      review,
      keyId: d.keyId,
      clock: d.clock,
      request,
      verifyPlan,
      sourceRequest: d.sourceRequest,
    }),
    key: "razorpay",
    account,
    mode: review.mode,
    review,
    readiness,
    supports,
    reviewSnapshot(snapshot) {
      if (snapshot.term.kind === "days") return pilot.review(snapshot);
      try {
        planFor(snapshot);
        return [];
      } catch {
        return ["native_plan_or_capability_review_required"];
      }
    },
    poll: (input) =>
      input.action.snapshot.term.kind === "days"
        ? pilot.poll(input.action)
        : poll(input),
    verifyPilotSignature: pilot.signature,
    async updatePayment(action) {
      if (method === "upi") throw new ApplicationError("SETUP_REQUIRED");
      if (readiness().length) throw new ApplicationError("SETUP_REQUIRED");
      const sub = await currentSubscription(action);
      if (!["active", "pending", "halted"].includes(sub.status))
        throw new ApplicationError("CONFLICT");
      return {
        script: "https://checkout.razorpay.com/v1/checkout.js",
        key: d.keyId,
        subscription_id: sub.id,
        subscription_card_change: true,
      };
    },
    async cancel(action, timing, authorize) {
      if (method === "card" && readiness().length)
        throw new ApplicationError("SETUP_REQUIRED");
      const sub = await currentSubscription(action);
      if (["cancelled", "completed", "expired"].includes(sub.status))
        return lifecycle(sub, action);
      if (
        timing === "cycle_end" &&
        (!sub.current_end || sub.current_end * 1000 <= d.clock.now().getTime())
      )
        throw new ApplicationError("SETUP_REQUIRED");
      await authorize();
      if (
        method === "upi" &&
        !isDeepStrictEqual(
          effectiveLifecyclePolicy(
            gateway.lifecyclePolicy,
            review.mode,
            d.clock.now(),
          ),
          action.lifecycle?.policy,
        )
      )
        throw new ApplicationError("SETUP_REQUIRED");
      const cancelled = subscriptionSchema.parse(
        await request(`subscriptions/${sub.id}/cancel`, {
          cancel_at_cycle_end: timing === "cycle_end",
        }),
      );
      if (
        cancelled.id !== sub.id ||
        !bound(cancelled, action) ||
        cancelled.customer_id !== sub.customer_id ||
        (timing === "cycle_end" && cancelled.current_end !== sub.current_end)
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      if (
        timing === "immediate" &&
        (cancelled.status !== "cancelled" || cancelled.ended_at == null)
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      return lifecycle(cancelled, action);
    },
    deferEvents: true,
    async authenticateCheckout({
      action,
      paymentId,
      subscriptionId,
      signature,
    }) {
      const savedId = action.checkout?.subscriptionId;
      if (
        method !== "upi" ||
        !savedId ||
        subscriptionId !== savedId ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(
          Buffer.from(signature, "hex"),
          createHmac("sha256", d.secret)
            .update(`${id("pay").parse(paymentId)}|${savedId}`)
            .digest(),
        )
      )
        throw new ApplicationError("FORBIDDEN");
      const sub = await currentSubscription(action);
      const p = paymentSchema.parse(await request(`payments/${paymentId}`));
      if (
        !["authenticated", "active"].includes(sub.status) ||
        p.id !== paymentId ||
        !upiMethod(p, action.snapshot) ||
        p.international ||
        p.currency !== "INR" ||
        sub.customer_id !== p.customer_id ||
        !["authorized", "captured", "refunded"].includes(p.status)
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      return {
        eventId: `checkout:${action.id}:${paymentId}`,
        payloadHash: createHash("sha256")
          .update(
            JSON.stringify({
              actionId: action.id,
              paymentId,
              subscriptionId: savedId,
              signature,
            }),
          )
          .digest("hex"),
        observation: {
          provider: "razorpay",
          account,
          operationKey: action.operationKey,
          status: "unknown",
          customerId: null,
          checkoutId: savedId,
          subscriptionId: savedId,
          paymentId,
          currency: null,
          amountMinor: null,
          paidAt: null,
          periodStart: null,
          periodEnd: null,
          checkout: null,
          native: {
            event: "subscription.authenticated",
            status: null,
            occurredAt: null,
          },
        },
      };
    },
    async create(input) {
      if (input.snapshot.term.kind === "days") return pilot.create(input);
      let mapping;
      try {
        mapping = await verifyPlan(input.snapshot);
      } catch {
        throw new PaymentCreationNotAttempted();
      }
      const notes = {
        operation_key: input.operationKey,
        action_id: input.actionId,
        business_id: input.businessId,
        financial_hash: financialHash(input.snapshot),
        account_review: review.id,
      };
      try {
        await input.authorize?.();
      } catch {
        throw new PaymentCreationNotAttempted();
      }
      const sub = subscriptionSchema.parse(
        await request("subscriptions", {
          plan_id: mapping.planId,
          quantity: 1,
          total_count: mapping.totalCount,
          customer_notify: true,
          ...(input.snapshot.pilotContinuation
            ? {
                start_at: Math.floor(
                  new Date(input.snapshot.pilotContinuation.startAt).getTime() /
                    1000,
                ),
                expire_by: Math.floor(
                  new Date(
                    input.snapshot.pilotContinuation.approvalExpiresAt,
                  ).getTime() / 1000,
                ),
              }
            : {}),
          notes,
        }),
      );
      if (
        sub.plan_id !== mapping.planId ||
        sub.quantity !== 1 ||
        sub.total_count !== mapping.totalCount ||
        (input.snapshot.pilotContinuation &&
          sub.start_at !==
            Math.floor(
              new Date(input.snapshot.pilotContinuation.startAt).getTime() /
                1000,
            )) ||
        Object.entries(notes).some(([key, value]) => sub.notes[key] !== value)
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      return checkout(sub, input.snapshot);
    },
    async authenticateEvent(input) {
      const signature = input.headers.get("x-razorpay-signature") ?? "";
      if (
        !/^[a-fA-F0-9]{64}$/.test(signature) ||
        !d.webhookSecrets.some((secret) =>
          timingSafeEqual(
            Buffer.from(signature, "hex"),
            createHmac("sha256", secret).update(input.body).digest(),
          ),
        )
      )
        throw new ApplicationError("FORBIDDEN");
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(input.body),
        );
      } catch {
        throw new ApplicationError("INVALID_INPUT");
      }
      const event = z
        .object({
          account_id: z.literal(review.account),
          event: z.string().min(1).max(100),
          created_at: z.number().int().nonnegative().safe().optional(),
          payload: z.object({
            subscription: z
              .object({
                entity: z.object({
                  id: id("sub"),
                  status: lifecycleObservationSchema.shape.status.optional(),
                  notes: z
                    .union([
                      z.record(z.string(), z.string()),
                      z.array(z.never()),
                    ])
                    .optional(),
                }),
              })
              .optional(),
            payment: z
              .object({
                entity: z.object({
                  id: id("pay"),
                  invoice_id: id("inv").nullable().optional(),
                  notes: z
                    .union([
                      z.record(z.string(), z.string()),
                      z.array(z.never()),
                    ])
                    .optional(),
                }),
              })
              .optional(),
          }),
        })
        .safeParse(payload);
      const eventId = z
        .string()
        .min(1)
        .max(200)
        .safeParse(input.headers.get("x-razorpay-event-id"));
      if (!event.success || !eventId.success)
        throw new ApplicationError("INVALID_INPUT");
      const sub = event.data.payload.subscription?.entity,
        p = event.data.payload.payment?.entity;
      const notes = sub?.notes;
      const operation = z
        .uuid()
        .safeParse(notes && !Array.isArray(notes) ? notes.operation_key : null);
      return {
        eventId: eventId.data,
        payloadHash: createHash("sha256").update(input.body).digest("hex"),
        observation: {
          provider: "razorpay",
          account,
          operationKey: operation.success ? operation.data : null,
          status: "unknown",
          customerId: null,
          checkoutId: sub?.id ?? null,
          subscriptionId: sub?.id ?? null,
          paymentId: p?.id ?? null,
          currency: null,
          amountMinor: null,
          paidAt: null,
          periodStart: null,
          periodEnd: null,
          checkout: null,
          native: {
            event: event.data.event,
            status: sub?.status ?? null,
            occurredAt:
              event.data.created_at == null
                ? null
                : new Date(event.data.created_at * 1000).toISOString(),
          },
        },
      };
    },
    reconcile: unavailable,
  };
  return gateway;
}
