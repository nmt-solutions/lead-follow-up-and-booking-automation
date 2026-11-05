import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  commercialChangeSchema,
  commercialEvaluationSchema,
  evaluateCommercialAuthority,
  type CommercialChange,
  type CommercialWorkspace,
} from "../models/commercial-authority";

export type CommercialAuthorityRepository = {
  workspace(actor: Actor, businessId: string): Promise<CommercialWorkspace>;
  save(
    actor: Actor,
    businessId: string,
    input: CommercialChange,
    at: Date,
  ): Promise<CommercialWorkspace>;
};
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Classified authentication, current Business scope and validation failures. */
export function createCommercialAuthorityApplication<
  Credentials,
>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePrivileged(credentials: Credentials): Promise<Actor>;
  repository: CommercialAuthorityRepository;
  clock: Clock;
}) {
  async function workspace(credentials: Credentials, id: unknown) {
    return dependencies.repository.workspace(
      await dependencies.authenticate(credentials),
      validate(businessIdSchema, id),
    );
  }
  return {
    workspace,
    async save(credentials: Credentials, id: unknown, input: unknown) {
      const actor = await dependencies.authenticatePrivileged(credentials);
      return dependencies.repository.save(
        actor,
        validate(businessIdSchema, id),
        validate(commercialChangeSchema, input),
        dependencies.clock.now(),
      );
    },
    async evaluate(credentials: Credentials, id: unknown, input: unknown) {
      const actor = await dependencies.authenticate(credentials);
      const parsed = validate(commercialEvaluationSchema, input);
      return evaluateCommercialAuthority(
        await dependencies.repository.workspace(
          actor,
          validate(businessIdSchema, id),
        ),
        parsed,
        dependencies.clock.now(),
      );
    },
  };
}
