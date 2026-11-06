import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import {
  preparePaymentSchema,
  paymentCommandSchema,
  checkoutReferenceSchema,
  paymentObservationSchema,
  authenticatedPaymentEventSchema,
  paymentActionSchema,
  PaymentCreationNotAttempted,
  type PaymentGateway,
} from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { createSubscriptionPaymentRepository } from "../db/subscription-payment-repository";

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}
export function createSubscriptionPaymentApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: ReturnType<typeof createSubscriptionPaymentRepository>;
  gateway: PaymentGateway;
  clock: Clock;
}) {
  async function reconcile(
    work: Awaited<ReturnType<typeof d.repository.authorizeWork>>,
  ) {
    const action = await d.repository.readWork(work);
    if (
      action.snapshot.provider.key !== d.gateway.key ||
      action.snapshot.provider.account !== d.gateway.account ||
      action.snapshot.provider.mode !== d.gateway.mode
    )
      throw new ApplicationError("SETUP_REQUIRED");
    if (d.gateway.poll) {
      let result;
      try {
        result = await d.gateway.poll({ action });
      } catch {
        return d.repository.pollUnavailable(work, d.clock.now());
      }
      if (result.checkout)
        await d.repository.creation(
          work,
          parse(checkoutReferenceSchema, result.checkout),
          d.clock.now(),
        );
      for (const charge of result.observations)
        await d.repository.reconcile(
          work,
          parse(paymentObservationSchema, charge),
          d.clock.now(),
        );
      await d.repository.saveRecovery(
        work,
        parse(paymentActionSchema.shape.recovery, result.recovery) ?? null,
        d.clock.now(),
      );
      return d.repository.readWork(work);
    }
    let observation = null;
    try {
      observation = parse(
        paymentObservationSchema,
        await d.gateway.reconcile({
          operationKey: action.operationKey,
          checkout: action.checkout,
        }),
      );
    } catch {
      /* Unknown outcomes stay durable and recoverable; creation is never retried here. */
    }
    return d.repository.reconcile(work, observation, d.clock.now());
  }
  return {
    async prepare(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return d.repository.prepare(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        parse(preparePaymentSchema, value),
        d.clock.now(),
        d.gateway,
      );
    },
    async workspace(credentials: Credentials, businessId: unknown) {
      return d.repository.workspace(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        d.clock.now(),
        d.gateway,
      );
    },
    async start(credentials: Credentials, businessId: unknown, value: unknown) {
      const result = await d.repository.begin(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        parse(paymentCommandSchema, value).actionId,
        d.clock.now(),
        d.gateway,
      );
      if (!result.work) return result.action;
      let checkout = null;
      try {
        checkout = parse(
          checkoutReferenceSchema,
          await d.gateway.create({
            operationKey: result.action.operationKey,
            actionId: result.action.id,
            businessId: result.action.businessId,
            snapshot: result.action.snapshot,
          }),
        );
      } catch (error: unknown) {
        if (error instanceof PaymentCreationNotAttempted)
          return d.repository.creationRejected(result.work, d.clock.now());
        /* The persisted intent owns this operation, including a crash before/after I/O. */
      }
      return d.repository.creation(result.work, checkout, d.clock.now());
    },
    async refresh(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const work = await d.repository.authorizeWork(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        parse(paymentCommandSchema, value).actionId,
        d.clock.now(),
      );
      return reconcile(work);
    },
    async event(input: { body: Uint8Array; headers: Headers }) {
      const event = parse(
        authenticatedPaymentEventSchema,
        await d.gateway.authenticateEvent(input),
      );
      if (
        event.observation.provider !== d.gateway.key ||
        event.observation.account !== d.gateway.account
      )
        throw new ApplicationError("FORBIDDEN");
      const work = await d.repository.receive(event, d.clock.now());
      // Receipt commits first; a crash here is recovered from the persisted action.
      if (work && !d.gateway.deferEvents) await reconcile(work);
      return { received: true };
    },
    async recover() {
      let reconciled = 0;
      for (const work of await d.repository.pending(d.gateway)) {
        await reconcile(work);
        reconciled++;
      }
      return { reconciled };
    },
    async operatorQueue(credentials: Credentials) {
      return d.repository.operatorQueue(
        await d.authenticatePlatform(credentials),
      );
    },
    async unmatchedEvents(credentials: Credentials) {
      return d.repository.unmatchedEvents(
        await d.authenticatePlatform(credentials),
      );
    },
    async operatorRefresh(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return reconcile(
        await d.repository.authorizeWork(
          await d.authenticatePlatform(credentials),
          parse(businessIdSchema, businessId),
          parse(paymentCommandSchema, value).actionId,
          d.clock.now(),
          true,
        ),
      );
    },
  };
}
