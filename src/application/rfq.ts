import { z } from "zod";
import type { Actor } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import { saveRfqSchema } from "../models/rfq";
import type { createRfqRepository } from "../db/rfq-repository";

/** Native manual capture/review only. No commercial execution or provider capability. */
export function createRfqApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createRfqRepository>;
}) {
  async function context(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const actor = await dependencies.authenticate(credentials);
    const identity = await dependencies.authenticateForWork(credentials);
    if (identity.userId !== actor.userId)
      throw new ApplicationError("FORBIDDEN");
    const ids = z
      .strictObject({ businessId: z.uuid(), opportunityId: z.uuid() })
      .safeParse({ businessId, opportunityId });
    if (!ids.success) throw new ApplicationError("INVALID_INPUT");
    return { actor: identity, ...ids.data };
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
      const parsed = saveRfqSchema.safeParse(input);
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
