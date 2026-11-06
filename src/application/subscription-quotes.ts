import type { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import {
  pricingConfigureSchema,
  quoteRequestSchema,
  type PricingConfigure,
  type PricingCatalog,
  type QuoteRequest,
  type QuoteReview,
  type SubscriptionQuoteWorkspace,
} from "../models/subscription-quotes";

export type SubscriptionQuoteRepository = {
  workspace(
    actor: Actor,
    businessId: string,
    at: Date,
  ): Promise<SubscriptionQuoteWorkspace>;
  catalog(actor: Actor, at: Date): Promise<PricingCatalog>;
  configure(
    actor: Actor,
    input: PricingConfigure,
    at: Date,
  ): Promise<PricingCatalog>;
  createQuote(
    actor: Actor,
    businessId: string,
    input: QuoteRequest,
    at: Date,
  ): Promise<QuoteReview>;
  quote(
    actor: Actor,
    businessId: string,
    quoteId: string,
    at: Date,
  ): Promise<QuoteReview>;
};
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
export function createSubscriptionQuoteApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: SubscriptionQuoteRepository;
  clock: Clock;
}) {
  return {
    async catalog(credentials: Credentials) {
      return dependencies.repository.catalog(
        await dependencies.authenticatePlatform(credentials),
        dependencies.clock.now(),
      );
    },
    async configure(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const input = pricingConfigureSchema.safeParse(value);
      if (!input.success) throw new ApplicationError("INVALID_INPUT");
      return dependencies.repository.configure(
        actor,
        input.data,
        dependencies.clock.now(),
      );
    },
    async workspace(credentials: Credentials, businessId: unknown) {
      const actor = await dependencies.authenticate(credentials);
      const id = businessIdSchema.safeParse(businessId);
      if (!id.success) throw new ApplicationError("INVALID_INPUT");
      return dependencies.repository.workspace(
        actor,
        id.data,
        dependencies.clock.now(),
      );
    },
    async createQuote(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const actor = await dependencies.authenticate(credentials);
      return dependencies.repository.createQuote(
        actor,
        parse(businessIdSchema, businessId),
        parse(quoteRequestSchema, value),
        dependencies.clock.now(),
      );
    },
    // Later tax/checkout commands must re-read this assessment; a stored quote is no payment or entitlement authority.
    async quote(
      credentials: Credentials,
      businessId: unknown,
      quoteId: unknown,
    ) {
      const actor = await dependencies.authenticate(credentials);
      return dependencies.repository.quote(
        actor,
        parse(businessIdSchema, businessId),
        parse(businessIdSchema, quoteId),
        dependencies.clock.now(),
      );
    },
  };
}
