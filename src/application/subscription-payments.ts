import { z } from "zod";
import {
  lifecycleObservationSchema,
  lifecycleCommandSchema,
  recoveryCheckoutSchema,
} from "../models/subscription-lifecycle";
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
    if (action.snapshot.adjustment) return action;
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
      await d.repository.lifecycle(
        work,
        d.clock.now(),
        d.gateway.lifecyclePolicy,
        result.lifecycle
          ? parse(lifecycleObservationSchema, result.lifecycle)
          : undefined,
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
    await d.repository.reconcile(work, observation, d.clock.now());
    await d.repository.lifecycle(
      work,
      d.clock.now(),
      d.gateway.lifecyclePolicy,
    );
    return d.repository.readWork(work);
  }
  return {
    async updatePayment(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const id = parse(businessIdSchema, businessId),
        input = parse(lifecycleCommandSchema, value);
      const work = await d.repository.authorizeWork(
        await d.authenticate(credentials),
        id,
        input.actionId,
        d.clock.now(),
      );
      const action = await d.repository.readWork(work);
      if (
        action.snapshot.provider.key !== d.gateway.key ||
        action.snapshot.provider.account !== d.gateway.account ||
        action.snapshot.provider.mode !== d.gateway.mode
      )
        throw new ApplicationError("SETUP_REQUIRED");
      if (!d.gateway.updatePayment)
        throw new ApplicationError("SETUP_REQUIRED");
      const checkout = parse(
        recoveryCheckoutSchema,
        await d.gateway.updatePayment(action),
      );
      if (checkout.subscription_id !== action.checkout?.subscriptionId)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      await d.repository.paymentMethodPrepared(
        await d.authenticate(credentials),
        id,
        input.actionId,
        input.requestKey,
        d.clock.now(),
        d.gateway,
      );
      return checkout;
    },
    async cancel(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const id = parse(businessIdSchema, businessId),
        input = parse(lifecycleCommandSchema, value);
      const result = await d.repository.beginCancellation(
        await d.authenticate(credentials),
        id,
        input.actionId,
        input.requestKey,
        d.clock.now(),
        d.gateway,
      );
      if (!result.work) return result.action;
      try {
        const observation = parse(
          lifecycleObservationSchema,
          await d.gateway.cancel!(
            await d.repository.readWork(result.work),
            result.action.lifecycle!.cancellation!.timing,
            async () => {
              await d.repository.authorizeWork(
                await d.authenticate(credentials),
                id,
                input.actionId,
                d.clock.now(),
              );
            },
          ),
        );
        await d.repository.cancellationResult(
          result.work,
          d.clock.now(),
          d.gateway.lifecyclePolicy,
          observation,
        );
      } catch {
        /* Persisted intent remains unconfirmed. Recovery only polls; it NEVER repeats cancel. */
      }
      return d.repository.readAuthorizedAction(
        await d.authenticate(credentials),
        id,
        input.actionId,
      );
    },
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
      const id = parse(businessIdSchema, businessId),
        actionId = parse(paymentCommandSchema, value).actionId;
      const work = await d.repository.authorizeWork(
        await d.authenticate(credentials),
        id,
        actionId,
        d.clock.now(),
      );
      await reconcile(work);
      return d.repository.readAuthorizedAction(
        await d.authenticate(credentials),
        id,
        actionId,
      );
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
    /** Platform notifications (#59): stable persisted source IDs and exact channel/status; no email delivery assertion. */
    async notificationFeed(credentials: Credentials) {
      const actions = await d.repository.operatorQueue(
        await d.authenticatePlatform(credentials),
      );
      return actions.flatMap((a) =>
        a.lifecycleEvents.filter((e) => e.notice !== null),
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
      const id = parse(businessIdSchema, businessId),
        actionId = parse(paymentCommandSchema, value).actionId;
      await reconcile(
        await d.repository.authorizeWork(
          await d.authenticatePlatform(credentials),
          id,
          actionId,
          d.clock.now(),
          true,
        ),
      );
      return d.repository.readAuthorizedAction(
        await d.authenticatePlatform(credentials),
        id,
        actionId,
        true,
      );
    },
  };
}
