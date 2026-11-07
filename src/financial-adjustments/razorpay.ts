import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { RazorpayAccountReview } from "../models/razorpay-account";
import {
  FinancialWriteNotAttempted,
  nativeRefundSchema,
  nativeDisputeSchema,
  financialReceiptSchema,
  type AdjustmentIntent,
  type AdjustmentObservation,
  type AdjustmentPolicy,
  type FinancialGateway,
  type DisputeIntent,
  currentAdjustmentPolicy,
  reviewedNativeAmount,
} from "../models/financial-adjustments";

const payment = z.object({
  id: z.string(),
  customer_id: z.string().nullable(),
  invoice_id: z.string().nullable(),
  order_id: z.string().nullable(),
  status: z.string(),
  captured: z.boolean(),
  method: z.string(),
  amount: z.number().int().safe(),
  currency: z.string(),
  amount_refunded: z.number().int().nonnegative().safe(),
});
const iso = (v: number) => new Date(v * 1000).toISOString();
export function createRazorpayAdjustments(d: {
  review: RazorpayAccountReview;
  keyId: string;
  secret: string;
  policy: AdjustmentPolicy | null;
  webhookSecrets: string[];
  fetch: typeof fetch;
  clock: Clock;
}): FinancialGateway {
  const account = `${d.review.account}:${d.review.mode}`;
  async function response(
    path: string,
    method = "GET",
    body?: string,
    key?: string,
  ) {
    const headers = new Headers({
      authorization: `Basic ${Buffer.from(`${d.keyId}:${d.secret}`).toString("base64")}`,
    });
    if (body) headers.set("content-type", "application/json");
    if (key) headers.set("X-Refund-Idempotency", key);
    let response: Response;
    try {
      response = await d.fetch(`https://api.razorpay.com/v1/${path}`, {
        method,
        headers,
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    }
    if (!response.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
    return response;
  }
  async function request(
    path: string,
    method = "GET",
    body?: string,
    key?: string,
  ) {
    const r = await response(path, method, body, key);
    try {
      const value: unknown = await r.json();
      return value;
    } catch {
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    }
  }
  function binding(intent: AdjustmentIntent) {
    const p = intent.period;
    if (
      p.snapshot.provider.key !== "razorpay" ||
      p.snapshot.provider.account !== account ||
      p.snapshot.provider.mode !== d.review.mode ||
      !/^pay_[A-Za-z0-9]+$/.test(p.paymentId)
    )
      throw new ApplicationError("SETUP_REQUIRED");
  }
  function currentAccountReview() {
    const at = d.clock.now();
    if (
      new Date(d.review.effectiveFrom) > at ||
      new Date(d.review.effectiveUntil) <= at ||
      new Date(d.review.checkedAt) > at
    )
      throw new ApplicationError("SETUP_REQUIRED");
  }
  async function validate(intent: AdjustmentIntent) {
    binding(intent);
    const p = intent.period,
      charge = p.charge;
    const native = payment.parse(await request(`payments/${p.paymentId}`));
    if (
      !charge?.charge ||
      native.id !== p.paymentId ||
      native.customer_id !== charge.customerId ||
      native.invoice_id !== charge.charge.invoiceId ||
      native.order_id !== charge.charge.orderId ||
      native.method !== "card" ||
      !native.captured ||
      !["captured", "refunded"].includes(native.status) ||
      String(native.amount) !== p.snapshot.tax.totals?.totalMinor ||
      native.currency !== intent.invoice.snapshot.currency ||
      native.amount_refunded > native.amount
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return { refundedMinor: String(native.amount_refunded) };
  }
  function refundObservation(intent: AdjustmentIntent, value: unknown) {
    const r = nativeRefundSchema.parse(value);
    if (
      r.payment_id !== intent.period.paymentId ||
      String(r.amount) !== reviewedNativeAmount(intent) ||
      r.currency !== intent.invoice.snapshot.currency ||
      r.receipt !== intent.key ||
      r.notes.financial_case !== intent.key
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return {
      nativeId: r.id,
      paymentId: r.payment_id,
      currency: r.currency,
      amountMinor: String(r.amount),
      status: r.status,
      deductedMinor: "0",
      createdAt: iso(r.created_at),
      observedAt: d.clock.now().toISOString(),
      phase: null,
      respondBy: null,
      submittedAt: null,
      acquirerReference: r.acquirer_data?.arn ?? null,
    } satisfies AdjustmentObservation;
  }
  function disputeObservation(intent: AdjustmentIntent, value: unknown) {
    const r = nativeDisputeSchema.parse(value);
    if (
      r.id !== intent.input.disputeId ||
      r.payment_id !== intent.period.paymentId ||
      String(r.amount) !== reviewedNativeAmount(intent) ||
      BigInt(r.amount) > BigInt(intent.invoice.snapshot.totals.totalMinor) ||
      r.currency !== intent.invoice.snapshot.currency ||
      r.amount_deducted > r.amount ||
      (r.status !== "lost" && r.amount_deducted !== 0)
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const submitted = z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .parse(r.evidence.submitted_at);
    return {
      nativeId: r.id,
      paymentId: r.payment_id,
      currency: r.currency,
      amountMinor: String(r.amount),
      status: r.status,
      deductedMinor: String(r.amount_deducted),
      createdAt: iso(r.created_at),
      observedAt: d.clock.now().toISOString(),
      phase: r.phase,
      respondBy: iso(r.respond_by),
      submittedAt: submitted ? iso(submitted) : null,
      acquirerReference: null,
    } satisfies AdjustmentObservation;
  }
  async function currentDispute(intent: AdjustmentIntent) {
    await validate(intent);
    const native = nativeDisputeSchema.parse(
      await request(`disputes/${intent.input.disputeId}`),
    );
    disputeObservation(intent, native);
    return native;
  }
  function canAct(
    intent: AdjustmentIntent,
    native: z.infer<typeof nativeDisputeSchema>,
  ) {
    currentAccountReview();
    const p = currentAdjustmentPolicy(
      d.policy,
      d.clock.now(),
      account,
      d.review.mode,
    );
    if (
      !isDeepStrictEqual(p, intent.policy) ||
      native.status !== "open" ||
      native.respond_by * 1000 <= d.clock.now().getTime()
    )
      throw new ApplicationError("CONFLICT");
  }
  async function document(documentId: string, sha256: string) {
    const r = await response(`documents/${documentId}/content`),
      contentType = r.headers.get("content-type")?.split(";")[0] ?? "";
    if (
      !["application/pdf", "image/jpeg", "image/jpg", "image/png"].includes(
        contentType,
      )
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const reader = r.body?.getReader();
    if (!reader) throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks),
      hash = createHash("sha256").update(bytes).digest("hex");
    const magic =
      contentType === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : contentType === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!magic || hash !== sha256)
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    return {
      documentId,
      sha256: hash,
      contentType,
      base64: bytes.toString("base64"),
    };
  }
  function commandResult(
    intent: AdjustmentIntent,
    command: DisputeIntent,
    native: z.infer<typeof nativeDisputeSchema>,
  ) {
    const observation = disputeObservation(intent, native);
    if (command.input.action === "accept")
      return { observation, confirmed: native.status === "lost" };
    const expected: unknown = JSON.parse(command.body),
      body = z.record(z.string(), z.unknown()).parse(expected);
    const same = Object.entries(body)
      .filter(([k]) => k !== "action")
      .every(([k, v]) => isDeepStrictEqual(native.evidence[k], v));
    return {
      observation,
      confirmed:
        same &&
        (command.input.action === "draft"
          ? native.evidence.submitted_at == null
          : observation.submittedAt !== null && native.status !== "open"),
    };
  }
  return {
    account,
    mode: d.review.mode,
    policy: d.policy,
    validate,
    async authenticateEvent({ body, headers }) {
      const signature = headers.get("x-razorpay-signature") ?? "";
      if (
        body.length > 256 * 1024 ||
        !/^[a-f0-9]{64}$/.test(signature) ||
        !d.webhookSecrets.some((s) =>
          timingSafeEqual(
            Buffer.from(signature, "hex"),
            createHmac("sha256", s).update(body).digest(),
          ),
        )
      )
        throw new ApplicationError("FORBIDDEN");
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(body),
        );
      } catch {
        throw new ApplicationError("INVALID_INPUT");
      }
      const event = z
        .object({
          account_id: z.literal(d.review.account),
          event: z.enum([
            "refund.created",
            "refund.processed",
            "refund.failed",
            "payment.dispute.created",
            "payment.dispute.under_review",
            "payment.dispute.action_required",
            "payment.dispute.won",
            "payment.dispute.lost",
            "payment.dispute.closed",
          ]),
          payload: z.record(z.string(), z.object({ entity: z.unknown() })),
        })
        .safeParse(value);
      if (!event.success) throw new ApplicationError("INVALID_INPUT");
      const kind = event.data.event.startsWith("refund.")
        ? "refund"
        : "dispute";
      const entity =
        kind === "refund"
          ? nativeRefundSchema.safeParse(event.data.payload.refund?.entity)
          : nativeDisputeSchema.safeParse(event.data.payload.dispute?.entity);
      if (!entity.success) throw new ApplicationError("INVALID_INPUT");
      const caseRef =
        kind === "refund"
          ? z
              .object({
                notes: z.object({ financial_case: z.uuid().optional() }),
              })
              .safeParse(entity.data)
          : null;
      const receipt = financialReceiptSchema.safeParse({
        eventId: headers.get("x-razorpay-event-id"),
        payloadHash: createHash("sha256").update(body).digest("hex"),
        account,
        mode: d.review.mode,
        kind,
        eventName: event.data.event,
        nativeId: entity.data.id,
        paymentId: entity.data.payment_id,
        caseRef: caseRef?.success
          ? (caseRef.data.notes.financial_case ?? null)
          : null,
      });
      if (!receipt.success) throw new ApplicationError("INVALID_INPUT");
      return receipt.data;
    },
    async prepareDispute(intent, input) {
      const native = await currentDispute(intent);
      canAct(intent, native);
      const documents = [];
      for (const selected of input.documents)
        documents.push(await document(selected.documentId, selected.sha256));
      const body: Record<string, unknown> = {
        amount: native.amount,
        summary: input.summary,
      };
      for (const selected of input.documents) {
        const previous = body[selected.category];
        body[selected.category] = [
          ...(Array.isArray(previous) ? previous : []),
          selected.documentId,
        ];
      }
      body.action = input.action;
      return {
        input,
        body: input.action === "accept" ? "" : JSON.stringify(body),
        documents,
      };
    },
    async dispute(intent, command, authorize) {
      try {
        const native = await currentDispute(intent);
        canAct(intent, native);
        if (
          command.input.action === "accept"
            ? !intent.policy.acceptDisputes
            : !intent.policy.contestDisputes
        )
          throw new ApplicationError("SETUP_REQUIRED");
        for (const selected of command.documents)
          await document(selected.documentId, selected.sha256);
        await authorize();
        canAct(intent, native);
      } catch (error: unknown) {
        throw new FinancialWriteNotAttempted({ cause: error });
      }
      const result = nativeDisputeSchema.parse(
        await request(
          `disputes/${intent.input.disputeId}/${command.input.action === "accept" ? "accept" : "contest"}`,
          command.input.action === "accept" ? "POST" : "PATCH",
          command.body || undefined,
        ),
      );
      return commandResult(intent, command, result);
    },
    async confirmDispute(intent, command) {
      return commandResult(intent, command, await currentDispute(intent));
    },
    async refund(intent, authorize) {
      try {
        binding(intent);
        currentAccountReview();
        const p = await validate(intent);
        if (
          BigInt(intent.allocation.totals.totalMinor) +
            BigInt(p.refundedMinor) >
          BigInt(intent.invoice.snapshot.totals.totalMinor)
        )
          throw new ApplicationError("CONFLICT");
        await authorize();
        currentAccountReview();
      } catch (error: unknown) {
        throw new FinancialWriteNotAttempted({ cause: error });
      }
      return refundObservation(
        intent,
        await request(
          `payments/${intent.period.paymentId}/refund`,
          "POST",
          intent.body,
          intent.key,
        ),
      );
    },
    async poll(intent, previous, skip) {
      await validate(intent);
      if (intent.input.kind === "dispute")
        return {
          observation: disputeObservation(
            intent,
            await request(`disputes/${intent.input.disputeId}`),
          ),
          skip: 0,
        };
      if (previous)
        return {
          observation: refundObservation(
            intent,
            await request(
              `payments/${intent.period.paymentId}/refunds/${previous.nativeId}`,
            ),
          ),
          skip: 0,
        };
      const page = z
        .object({
          entity: z.literal("collection"),
          count: z.number().int(),
          items: z.array(nativeRefundSchema).max(100),
        })
        .parse(
          await request(
            `payments/${intent.period.paymentId}/refunds?count=100&skip=${skip}`,
          ),
        );
      if (page.count !== page.items.length)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const candidates = page.items.filter(
        (r) =>
          r.receipt === intent.key || r.notes.financial_case === intent.key,
      );
      if (candidates.length > 1) throw new ApplicationError("CONFLICT");
      return {
        observation: candidates.length
          ? refundObservation(intent, candidates[0])
          : null,
        skip: page.items.length === 100 ? skip + 100 : 0,
      };
    },
  };
}
