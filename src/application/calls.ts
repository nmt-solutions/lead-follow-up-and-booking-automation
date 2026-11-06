import { z } from "zod";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import { saveCallSchema } from "../models/calls";
import type { createCallRepository } from "../db/call-repository";

/** Written human activity only; no voice, message, calendar or commercial provider capability. */
export function createCallApplication<Credentials>(dependencies: {
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createCallRepository>;
}) {
  async function context(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const actor = await dependencies.authenticateForWork(credentials);
    const ids = z
      .strictObject({ businessId: z.uuid(), opportunityId: z.uuid() })
      .safeParse({ businessId, opportunityId });
    if (!ids.success) throw new ApplicationError("INVALID_INPUT");
    return { actor, ...ids.data };
  }
  return {
    async read(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      return dependencies.repository.read(
        c.actor,
        c.businessId,
        c.opportunityId,
      );
    },
    async save(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      const parsed = saveCallSchema.safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      return dependencies.repository.save(
        c.actor,
        c.businessId,
        c.opportunityId,
        parsed.data,
      );
    },
  };
}
