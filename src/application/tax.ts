import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  taxCalculationInputSchema,
  taxRuleSaveSchema,
  taxDecisionInputSchema,
  taxResolveSchema,
  type TaxCatalog,
  type TaxCalculation,
  type TaxWorkspace,
  type TaxRuleSave,
  type TaxDecisionInput,
  type TaxCalculationInput,
  type TaxResolve,
  type TaxMode,
} from "../models/tax";

export type TaxRepository = {
  rules(actor: Actor): Promise<TaxCatalog>;
  saveRule(actor: Actor, input: TaxRuleSave, at: Date): Promise<TaxCatalog>;
  decideRule(
    actor: Actor,
    input: TaxDecisionInput,
    at: Date,
  ): Promise<TaxCatalog>;
  workspace(
    actor: Actor,
    businessId: string,
    at: Date,
    mode: TaxMode,
    operator: boolean,
  ): Promise<TaxWorkspace>;
  calculate(
    actor: Actor,
    businessId: string,
    input: TaxCalculationInput,
    at: Date,
    mode: TaxMode,
  ): Promise<TaxCalculation>;
  resolve(
    actor: Actor,
    businessId: string,
    input: TaxResolve,
    at: Date,
    mode: TaxMode,
  ): Promise<TaxCalculation>;
  queue(
    actor: Actor,
  ): Promise<{ businessId: string; calculation: TaxCalculation }[]>;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Public tax command/query seam. A preview never authorizes a price, charge or entitlement. */
export function createTaxApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: TaxRepository;
  clock: Clock;
  mode: TaxMode;
}) {
  const { repository, clock, mode } = dependencies;
  return {
    async rules(credentials: Credentials) {
      return repository.rules(
        await dependencies.authenticatePlatform(credentials),
      );
    },
    async saveRule(credentials: Credentials, value: unknown) {
      return repository.saveRule(
        await dependencies.authenticatePlatform(credentials),
        parse(taxRuleSaveSchema, value),
        clock.now(),
      );
    },
    async decideRule(credentials: Credentials, value: unknown) {
      return repository.decideRule(
        await dependencies.authenticatePlatform(credentials),
        parse(taxDecisionInputSchema, value),
        clock.now(),
      );
    },
    async workspace(credentials: Credentials, businessId: unknown) {
      return repository.workspace(
        await dependencies.authenticate(credentials),
        parse(businessIdSchema, businessId),
        clock.now(),
        mode,
        false,
      );
    },
    async reviewWorkspace(credentials: Credentials, businessId: unknown) {
      return repository.workspace(
        await dependencies.authenticatePlatform(credentials),
        parse(businessIdSchema, businessId),
        clock.now(),
        mode,
        true,
      );
    },
    async calculate(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return repository.calculate(
        await dependencies.authenticate(credentials),
        parse(businessIdSchema, businessId),
        parse(taxCalculationInputSchema, value),
        clock.now(),
        mode,
      );
    },
    async resolve(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      return repository.resolve(
        await dependencies.authenticatePlatform(credentials),
        parse(businessIdSchema, businessId),
        parse(taxResolveSchema, value),
        clock.now(),
        mode,
      );
    },
    async reviewQueue(credentials: Credentials) {
      return repository.queue(
        await dependencies.authenticatePlatform(credentials),
      );
    },
  };
}
