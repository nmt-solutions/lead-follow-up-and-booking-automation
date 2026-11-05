import { z } from "zod";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import {
  commercialActionRefSchema,
  commercialEvidenceSchema,
  decideCommercialSchema,
  proposeCommercialSchema,
  type CommercialProvider,
} from "../models/commercial-actions";
import type { createCommercialRepository } from "../db/commercial-actions-repository";

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
/** Conventional application boundary: trusted identity, validated commands, real repository and adapter. */
export function createCommercialApplication<Credentials>(dependencies: {
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createCommercialRepository>;
  provider: CommercialProvider;
}) {
  async function context(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const actor = await dependencies.authenticateForWork(credentials);
    return {
      actor,
      ...validate(
        z.strictObject({ businessId: z.uuid(), opportunityId: z.uuid() }),
        { businessId, opportunityId },
      ),
    };
  }
  async function read(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const c = await context(credentials, businessId, opportunityId);
    return dependencies.repository.read(
      c.actor,
      c.businessId,
      c.opportunityId,
      dependencies.provider.available,
    );
  }
  return {
    read,
    async propose(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.propose(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(proposeCommercialSchema, input),
      );
      return read(credentials, businessId, opportunityId);
    },
    async decide(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.decide(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(decideCommercialSchema, input),
      );
      return read(credentials, businessId, opportunityId);
    },
    async execute(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.execute(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(commercialActionRefSchema, input),
        dependencies.provider,
      );
      return read(credentials, businessId, opportunityId);
    },
    async evidence(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.evidence(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(commercialEvidenceSchema, input),
      );
      return read(credentials, businessId, opportunityId);
    },
  };
}
