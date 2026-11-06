import type { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import {
  billingSaveSchema,
  billingReviewInputSchema,
  type BillingSave,
  type BillingWorkspace,
  type BillingQueue,
  type BillingReviewInput,
} from "../models/billing";

export type BillingRepository = {
  workspace(
    actor: Actor,
    businessId: string,
    at: Date,
  ): Promise<BillingWorkspace>;
  save(
    actor: Actor,
    businessId: string,
    input: BillingSave,
    at: Date,
  ): Promise<BillingWorkspace>;
  reviewQueue(actor: Actor, at: Date): Promise<BillingQueue>;
  reviewWorkspace(
    actor: Actor,
    businessId: string,
    at: Date,
  ): Promise<BillingWorkspace>;
  review(
    actor: Actor,
    businessId: string,
    input: BillingReviewInput,
    at: Date,
  ): Promise<BillingWorkspace>;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
export function createBillingApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: BillingRepository;
  clock: Clock;
}) {
  return {
    async workspace(credentials: Credentials, businessId: unknown) {
      return dependencies.repository.workspace(
        await dependencies.authenticate(credentials),
        parse(businessIdSchema, businessId),
        dependencies.clock.now(),
      );
    },
    async save(credentials: Credentials, businessId: unknown, value: unknown) {
      return dependencies.repository.save(
        await dependencies.authenticate(credentials),
        parse(businessIdSchema, businessId),
        parse(billingSaveSchema, value),
        dependencies.clock.now(),
      );
    },
    async reviewQueue(credentials: Credentials) {
      return dependencies.repository.reviewQueue(
        await dependencies.authenticatePlatform(credentials),
        dependencies.clock.now(),
      );
    },
    async reviewWorkspace(credentials: Credentials, businessId: unknown) {
      return dependencies.repository.reviewWorkspace(
        await dependencies.authenticatePlatform(credentials),
        parse(businessIdSchema, businessId),
        dependencies.clock.now(),
      );
    },
    async review(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return dependencies.repository.review(
        await dependencies.authenticatePlatform(credentials),
        parse(businessIdSchema, businessId),
        parse(billingReviewInputSchema, value),
        dependencies.clock.now(),
      );
    },
  };
}
