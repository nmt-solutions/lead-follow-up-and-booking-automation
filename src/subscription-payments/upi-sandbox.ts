import { z } from "zod";
import type { RazorpayAccountReview } from "../models/razorpay-account";
import { monthlyPeriodMatches } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";

/** Read-only native test-account evidence. This verifier never creates an experiment or charge. */
export function upiSandboxVerifier(d: {
  review: RazorpayAccountReview;
  keyId: string;
  secret: string;
  fetch: typeof fetch;
}) {
  const proof = d.review.upiPath?.sandbox.native;
  async function read(path: string): Promise<unknown> {
    try {
      const r = await d.fetch(`https://api.razorpay.com/v1/${path}`, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
        headers: {
          authorization: `Basic ${Buffer.from(`${d.keyId}:${d.secret}`).toString("base64")}`,
        },
      });
      if (!r.ok) throw new Error("evidence unavailable");
      const reader = r.body?.getReader();
      if (!reader) throw new Error("evidence unavailable");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 1024 * 1024) {
            await reader.cancel();
            throw new Error("evidence bound");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApplicationError("SETUP_REQUIRED");
    }
  }
  async function verify() {
    if (
      !proof ||
      !d.keyId.startsWith("rzp_test_") ||
      d.review.upiPath?.sandbox.kind !== "native_sandbox"
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const sub = z
      .object({
        id: z.string(),
        customer_id: z.string(),
        plan_id: z.string(),
        status: z.literal("cancelled"),
        start_at: z.number().int(),
        ended_at: z.number().int(),
      })
      .parse(await read(`subscriptions/${proof.subscriptionId}`));
    const plan = z
      .object({
        id: z.string(),
        period: z.literal("monthly"),
        interval: z.literal(1),
        item: z.object({
          amount: z.number().int().positive().safe(),
          currency: z.literal("INR"),
        }),
      })
      .parse(await read(`plans/${proof.planId}`));
    if (
      sub.id !== proof.subscriptionId ||
      sub.customer_id !== proof.customerId ||
      sub.plan_id !== proof.planId ||
      plan.id !== proof.planId ||
      String(plan.item.amount) !== proof.amountMinor ||
      sub.ended_at * 1000 >
        new Date(d.review.upiPath!.sandbox.checkedAt).getTime()
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const payment = z.object({
      id: z.string(),
      customer_id: z.string(),
      method: z.literal("upi"),
      international: z.literal(false),
      vpa: z.string(),
      currency: z.literal("INR"),
      amount: z.number().int().nonnegative().safe(),
      status: z.string(),
      captured: z.boolean(),
      amount_refunded: z.number().int().nonnegative().safe(),
      invoice_id: z.string().nullable(),
      order_id: z.string().nullable(),
    });
    const payments = [];
    for (const id of [
      proof.failedPaymentId,
      proof.authorizationPaymentId,
      proof.initialPaymentId,
      proof.renewalPaymentId,
    ]) {
      const p = payment.parse(await read(`payments/${id}`));
      if (
        p.id !== id ||
        p.customer_id !== proof.customerId ||
        !d.review.upiPath!.supportedHandles.includes(
          p.vpa.split("@").at(-1)?.toLowerCase() ?? "",
        )
      )
        throw new ApplicationError("SETUP_REQUIRED");
      payments.push(p);
    }
    if (
      new Set(payments.map((p) => p.id)).size !== 4 ||
      payments[0].status !== "failed" ||
      payments[0].captured ||
      payments[0].amount_refunded !== 0 ||
      !["authorized", "captured", "refunded"].includes(payments[1].status)
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const periods = [];
    for (const p of payments.slice(2)) {
      if (
        p.status !== "captured" ||
        !p.captured ||
        p.amount_refunded !== 0 ||
        String(p.amount) !== proof.amountMinor ||
        !p.invoice_id ||
        !/^inv_[A-Za-z0-9]+$/.test(p.invoice_id) ||
        !p.order_id
      )
        throw new ApplicationError("SETUP_REQUIRED");
      const i = z
        .object({
          id: z.string(),
          subscription_id: z.string(),
          customer_id: z.string(),
          payment_id: z.string(),
          order_id: z.string(),
          status: z.literal("paid"),
          amount: z.number().int(),
          amount_paid: z.number().int(),
          amount_due: z.literal(0),
          currency: z.literal("INR"),
          billing_start: z.number().int(),
          billing_end: z.number().int(),
          paid_at: z.number().int(),
          line_items: z
            .array(
              z.object({
                type: z.literal("plan"),
                quantity: z.literal(1),
                amount: z.number().int(),
                currency: z.literal("INR"),
              }),
            )
            .length(1),
        })
        .parse(await read(`invoices/${p.invoice_id}`));
      if (
        i.id !== p.invoice_id ||
        i.subscription_id !== sub.id ||
        i.customer_id !== p.customer_id ||
        i.payment_id !== p.id ||
        i.order_id !== p.order_id ||
        i.amount !== p.amount ||
        i.amount_paid !== p.amount ||
        i.line_items[0].amount !== p.amount ||
        i.paid_at < i.billing_start ||
        i.paid_at >= i.billing_end ||
        i.paid_at * 1000 >
          new Date(d.review.upiPath!.sandbox.checkedAt).getTime() ||
        !monthlyPeriodMatches(
          new Date(sub.start_at * 1000).toISOString(),
          new Date(i.billing_start * 1000).toISOString(),
          new Date(i.billing_end * 1000).toISOString(),
        )
      )
        throw new ApplicationError("SETUP_REQUIRED");
      periods.push(i);
    }
    if (
      periods[0].billing_start !== sub.start_at ||
      periods[1].billing_start !== periods[0].billing_end ||
      sub.ended_at < periods[1].billing_start
    )
      throw new ApplicationError("SETUP_REQUIRED");
  }
  return async () => {
    try {
      await verify();
    } catch {
      throw new ApplicationError("SETUP_REQUIRED");
    }
  };
}
