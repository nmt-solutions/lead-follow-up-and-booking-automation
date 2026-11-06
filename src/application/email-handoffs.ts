import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import {
  prepareHandoffSchema,
  handoffRefSchema,
  useHandoffSchema,
  bindHandoffSchema,
} from "../models/email-handoffs";
import type { createEmailHandoffRepository } from "../db/email-handoff-repository";

export function createEmailHandoffApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createEmailHandoffRepository>;
}) {
  function parse<T>(schema: z.ZodType<T>, value: unknown) {
    const p = schema.safeParse(value);
    if (!p.success) throw new ApplicationError("INVALID_INPUT");
    return p.data;
  }
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
    async prepare(credentials: Credentials, id: unknown, value: unknown) {
      const c = await context(credentials, id);
      return d.repository.prepare(
        c.actor,
        c.businessId,
        parse(prepareHandoffSchema, value),
      );
    },
    async use(credentials: Credentials, id: unknown, value: unknown) {
      const c = await context(credentials, id);
      return d.repository.use(
        c.actor,
        c.businessId,
        parse(useHandoffSchema, value),
      );
    },
    async markSent(credentials: Credentials, id: unknown, value: unknown) {
      const c = await context(credentials, id);
      return d.repository.markSent(
        c.actor,
        c.businessId,
        parse(handoffRefSchema, value),
      );
    },
    async bindSent(credentials: Credentials, id: unknown, value: unknown) {
      const c = await context(credentials, id);
      return d.repository.bindSent(
        c.actor,
        c.businessId,
        parse(bindHandoffSchema, value),
      );
    },
  };
}
