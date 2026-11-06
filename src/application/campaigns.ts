import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import {
  saveCampaignSchema,
  decideCampaignSchema,
  inspectCampaignSchema,
} from "../models/campaigns";
import type { createCampaignRepository } from "../db/campaign-repository";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Authenticated commands use campaign-policy against facts loaded under the repository's Business lock. There is no sender, queue or execution port. */
export function createCampaignApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createCampaignRepository>;
}) {
  async function context(credentials: Credentials, id: unknown) {
    return {
      actor: await d.authenticate(credentials),
      businessId: parse(z.uuid(), id),
    };
  }
  return {
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async save(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.save(
        c.actor,
        c.businessId,
        parse(saveCampaignSchema, input),
      );
    },
    async decide(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.decide(
        c.actor,
        c.businessId,
        parse(decideCampaignSchema, input),
      );
    },
    async inspect(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.inspect(
        c.actor,
        c.businessId,
        parse(inspectCampaignSchema, input),
      );
    },
    async review(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.review(
        c.actor,
        c.businessId,
        parse(inspectCampaignSchema, input),
      );
    },
  };
}
