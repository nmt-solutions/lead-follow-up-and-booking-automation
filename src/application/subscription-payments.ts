import {
  publicPaymentAction,
  publicPaymentWorkspace,
} from "../subscription-payments/projection";
import { z } from "zod";
import {
  paymentAccount,
  paymentAccounts,
} from "../subscription-payments/accounts";
import { publicFinancialValue } from "../models/public-financial";
import { createHash } from "node:crypto";
import { mandateProofSchema } from "../models/subscription-payments";
import { paymentWorkspaceSchema } from "../models/subscription-payments";
import {
  lifecycleObservationSchema,
  lifecycleCommandSchema,
  recoveryCheckoutSchema,
} from "../models/subscription-lifecycle";
import type { WorkIdentity } from "../models/discovery";
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
  pilotRenewalSchema,
  pilotCheckoutProofSchema,
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
  authenticateForWork?(credentials: Credentials): Promise<WorkIdentity>;
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
    const gateway = paymentAccount(d.gateway, action.snapshot.provider);
    if (
      action.snapshot.provider.key !== gateway.key ||
      action.snapshot.provider.account !== gateway.account ||
      action.snapshot.provider.mode !== gateway.mode
    )
      throw new ApplicationError("SETUP_REQUIRED");
    if (gateway.authenticateCheckout)
      for (const proof of await d.repository.checkoutProofs(work)) {
        try {
          const event = parse(
            authenticatedPaymentEventSchema,
            await gateway.authenticateCheckout({ action, ...proof }),
          );
          await d.repository.receive(event, d.clock.now());
        } catch {
          // A retained callback is only a hint. Keep it for original-identity
          // recovery; no proof outcome authorizes another native mutation.
        }
      }
    if (gateway.poll) {
      let result;
      try {
        result = await gateway.poll({ action });
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
        gateway.lifecyclePolicy,
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
        await gateway.reconcile({
          operationKey: action.operationKey,
          checkout: action.checkout,
        }),
      );
    } catch {
      /* Unknown outcomes stay durable and recoverable; creation is never retried here. */
    }
    await d.repository.reconcile(work, observation, d.clock.now());
    await d.repository.lifecycle(work, d.clock.now(), gateway.lifecyclePolicy);
    return d.repository.readWork(work);
  }
  const application = {
    async preparePilotRenewal(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return publicPaymentAction(
        await d.repository.preparePilotRenewal(
          await d.authenticate(credentials),
          parse(businessIdSchema, businessId),
          parse(pilotRenewalSchema, value),
          d.clock.now(),
          d.gateway,
        ),
      );
    },
    async confirmPilotCheckout(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const id = parse(businessIdSchema, businessId),
        input = parse(pilotCheckoutProofSchema, value),
        actor = d.authenticateForWork
          ? await d.authenticateForWork(credentials)
          : await d.authenticate(credentials);
      const work = await d.repository.authorizeWork(
        actor,
        id,
        input.actionId,
        d.clock.now(),
      );
      const action = await d.repository.readWork(work);
      const gateway = paymentAccount(d.gateway, action.snapshot.provider);
      if (!gateway.verifyPilotSignature?.(action, input))
        throw new ApplicationError("FORBIDDEN");
      await d.repository.retainPilotCheckoutProof(
        actor,
        id,
        input,
        d.clock.now(),
      );
      await reconcile(work);
      return publicPaymentAction(
        await d.repository.readAuthorizedAction(
          await d.authenticate(credentials),
          id,
          input.actionId,
        ),
      );
    },
    async confirmMandate(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const id = parse(businessIdSchema, businessId),
        input = parse(mandateProofSchema, value);
      const work = await d.repository.checkoutProofIntent(
        await d.authenticate(credentials),
        id,
        {
          ...input,
          payloadHash: createHash("sha256")
            .update(JSON.stringify(input))
            .digest("hex"),
        },
        d.clock.now(),
      );
      const action = await d.repository.readWork(work),
        gateway = paymentAccount(d.gateway, action.snapshot.provider);
      if (!gateway.authenticateCheckout)
        throw new ApplicationError("SETUP_REQUIRED");
      const event = parse(
        authenticatedPaymentEventSchema,
        await gateway.authenticateCheckout({ action, ...input }),
      );
      await d.repository.receive(event, d.clock.now());
      return d.repository.readAuthorizedAction(
        await d.authenticate(credentials),
        id,
        input.actionId,
      );
    },
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
      const gateway = paymentAccount(d.gateway, action.snapshot.provider);
      if (
        action.snapshot.provider.key !== gateway.key ||
        action.snapshot.provider.account !== gateway.account ||
        action.snapshot.provider.mode !== gateway.mode
      )
        throw new ApplicationError("SETUP_REQUIRED");
      if (!gateway.updatePayment) throw new ApplicationError("SETUP_REQUIRED");
      const checkout = parse(
        recoveryCheckoutSchema,
        await gateway.updatePayment(action),
      );
      if (checkout.subscription_id !== action.checkout?.subscriptionId)
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      await d.repository.paymentMethodPrepared(
        await d.authenticate(credentials),
        id,
        input.actionId,
        input.requestKey,
        d.clock.now(),
        gateway,
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
      const boundAction = await d.repository.readAuthorizedAction(
        await d.authenticate(credentials),
        id,
        input.actionId,
      );
      const gateway = paymentAccount(d.gateway, boundAction.snapshot.provider);
      const result = await d.repository.beginCancellation(
        await d.authenticate(credentials),
        id,
        input.actionId,
        input.requestKey,
        d.clock.now(),
        gateway,
      );
      if (!result.work) return publicPaymentAction(result.action);
      try {
        const observation = parse(
          lifecycleObservationSchema,
          await gateway.cancel!(
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
          gateway.lifecyclePolicy,
          observation,
        );
      } catch {
        /* Persisted intent remains unconfirmed. Recovery only polls; it NEVER repeats cancel. */
      }
      return publicPaymentAction(
        await d.repository.readAuthorizedAction(
          await d.authenticate(credentials),
          id,
          input.actionId,
        ),
      );
    },
    async prepare(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return publicPaymentAction(
        await d.repository.prepare(
          await d.authenticate(credentials),
          parse(businessIdSchema, businessId),
          parse(preparePaymentSchema, value),
          d.clock.now(),
          d.gateway,
        ),
      );
    },
    async usage(credentials: Credentials, businessId: unknown) {
      return d.repository.usage(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        d.clock.now(),
      );
    },
    async workspace(credentials: Credentials, businessId: unknown) {
      return publicPaymentWorkspace(
        await d.repository.workspace(
          await d.authenticate(credentials),
          parse(businessIdSchema, businessId),
          d.clock.now(),
          d.gateway,
        ),
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
      if (!result.work) return publicPaymentAction(result.action);
      let checkout = null;
      try {
        checkout = parse(
          checkoutReferenceSchema,
          await d.gateway.create({
            operationKey: result.action.operationKey,
            actionId: result.action.id,
            businessId: result.action.businessId,
            snapshot: result.action.snapshot,
            authorize: async () => {
              await d.repository.authorizeCreation(
                d.authenticateForWork
                  ? await d.authenticateForWork(credentials)
                  : await d.authenticate(credentials),
                result.work!,
                d.clock.now(),
                d.gateway,
              );
            },
          }),
        );
      } catch (error: unknown) {
        if (error instanceof PaymentCreationNotAttempted) {
          await d.repository.creationRejected(result.work, d.clock.now());
          return publicPaymentAction(
            await d.repository.readAuthorizedAction(
              await d.authenticate(credentials),
              result.action.businessId,
              result.action.id,
            ),
          );
        }
        /* The persisted intent owns this operation, including a crash before/after I/O. */
      }
      await d.repository.creation(result.work, checkout, d.clock.now());
      return publicPaymentAction(
        await d.repository.readAuthorizedAction(
          await d.authenticate(credentials),
          result.action.businessId,
          result.action.id,
        ),
      );
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
      return publicPaymentAction(
        await d.repository.readAuthorizedAction(
          await d.authenticate(credentials),
          id,
          actionId,
        ),
      );
    },
    async event(
      input: { body: Uint8Array; headers: Headers },
      path: "card" | "upi" = "card",
    ) {
      const gateway =
        path === "upi"
          ? paymentAccounts(d.gateway).find((g) => g.method === "upi")
          : d.gateway;
      if (!gateway) throw new ApplicationError("SETUP_REQUIRED");
      const event = parse(
        authenticatedPaymentEventSchema,
        await gateway.authenticateEvent(input),
      );
      if (
        event.observation.provider !== gateway.key ||
        event.observation.account !== gateway.account
      )
        throw new ApplicationError("FORBIDDEN");
      const work = await d.repository.receive(event, d.clock.now());
      // Receipt commits first; a crash here is recovered from the persisted action.
      if (work && !gateway.deferEvents) await reconcile(work);
      return { received: true };
    },
    async recover() {
      let reconciled = 0;
      for (const work of (
        await Promise.all(
          paymentAccounts(d.gateway).map((g) => d.repository.pending(g)),
        )
      ).flat()) {
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
      return publicPaymentAction(
        await d.repository.readAuthorizedAction(
          await d.authenticatePlatform(credentials),
          id,
          actionId,
          true,
        ),
      );
    },
  };
  const publicAction = (value: unknown) =>
    paymentActionSchema.parse(
      publicFinancialValue(
        publicPaymentAction(paymentActionSchema.parse(value)),
      ),
    );
  return {
    ...application,
    prepare: async (...args: Parameters<typeof application.prepare>) =>
      publicAction(await application.prepare(...args)),
    confirmMandate: async (
      ...args: Parameters<typeof application.confirmMandate>
    ) => publicAction(await application.confirmMandate(...args)),
    start: async (...args: Parameters<typeof application.start>) =>
      publicAction(await application.start(...args)),
    refresh: async (...args: Parameters<typeof application.refresh>) =>
      publicAction(await application.refresh(...args)),
    cancel: async (...args: Parameters<typeof application.cancel>) =>
      publicAction(await application.cancel(...args)),
    operatorRefresh: async (
      ...args: Parameters<typeof application.operatorRefresh>
    ) => publicAction(await application.operatorRefresh(...args)),
    operatorQueue: async (
      ...args: Parameters<typeof application.operatorQueue>
    ) => (await application.operatorQueue(...args)).map(publicAction),
    workspace: async (...args: Parameters<typeof application.workspace>) => {
      const value = await application.workspace(...args);
      const projected = paymentWorkspaceSchema.parse(
        publicFinancialValue(value),
      );
      return {
        ...projected,
        gateway: {
          key: value.gateway.key,
          mode: value.gateway.mode,
          ready: value.gateway.ready,
          reasons: value.gateway.reasons,
        },
      };
    },
  };
}
