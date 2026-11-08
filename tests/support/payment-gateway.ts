import { createHash } from "node:crypto";
import type { Clock } from "../../src/models/business";
import {
  periodEnd,
  paymentObservationSchema,
  type PaymentGateway,
  type PaymentObservation,
} from "../../src/models/subscription-payments";
import { ApplicationError } from "../../src/models/application-error";

export function deterministicPayments(
  clock: Clock,
  mode: "fixture" | "live" = "fixture",
) {
  const created: Parameters<PaymentGateway["create"]>[0][] = [];
  const observations = new Map<string, PaymentObservation>();
  const gateway = {
    key: "deterministic-payments",
    account: "fixture-merchant",
    mode,
    created,
    observations,
    ambiguous: false,
    supports: () => true,
    async create(input: Parameters<PaymentGateway["create"]>[0]) {
      created.push(input);
      observations.set(input.operationKey, {
        provider: gateway.key,
        account: gateway.account,
        operationKey: input.operationKey,
        status: "pending",
        customerId: `customer-${input.actionId}`,
        checkoutId: `checkout-${input.actionId}`,
        subscriptionId: null,
        paymentId: null,
        currency: input.snapshot.quote.currency,
        amountMinor: input.snapshot.tax.totals!.totalMinor,
        paidAt: null,
        periodStart: null,
        periodEnd: null,
        checkout: {
          customerId: `customer-${input.actionId}`,
          checkoutId: `checkout-${input.actionId}`,
          subscriptionId: null,
          url: `https://payments.example.com/checkout/${input.actionId}`,
        },
      });
      if (gateway.ambiguous)
        throw new Error("external timeout after acceptance");
      return {
        customerId: `customer-${input.actionId}`,
        checkoutId: `checkout-${input.actionId}`,
        subscriptionId: null,
        url: `https://payments.example.com/checkout/${input.actionId}`,
      };
    },
    async authenticateEvent(
      input: Parameters<PaymentGateway["authenticateEvent"]>[0],
    ) {
      if (input.headers.get("x-fixture-signature") !== "valid")
        throw new ApplicationError("FORBIDDEN");
      const payload: unknown = JSON.parse(new TextDecoder().decode(input.body));
      if (
        !payload ||
        typeof payload !== "object" ||
        !("eventId" in payload) ||
        typeof payload.eventId !== "string" ||
        !("observation" in payload)
      )
        throw new ApplicationError("INVALID_INPUT");
      return {
        eventId: payload.eventId,
        payloadHash: createHash("sha256").update(input.body).digest("hex"),
        observation: paymentObservationSchema.parse(payload.observation),
      };
    },
    async reconcile({
      operationKey,
    }: Parameters<PaymentGateway["reconcile"]>[0]) {
      const observation = observations.get(operationKey);
      if (!observation) throw new ApplicationError("PROVIDER_UNAVAILABLE");
      return observation;
    },
    confirm(operationKey: string) {
      const original = observations.get(operationKey);
      const intent = created.find((row) => row.operationKey === operationKey);
      if (!original || !intent)
        throw new Error("Missing external fixture operation");
      const start = clock.now().toISOString();
      observations.set(operationKey, {
        ...original,
        status: "confirmed",
        paymentId: `payment-${operationKey}`,
        paidAt: start,
        periodStart: start,
        periodEnd: periodEnd(start, intent.snapshot.term),
      });
    },
  } satisfies PaymentGateway & Record<string, unknown>;
  return gateway;
}
