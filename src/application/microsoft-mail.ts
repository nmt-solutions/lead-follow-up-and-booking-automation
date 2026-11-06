import { z } from "zod";
import type { createSessionAccess } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { createMicrosoftMailGrantService } from "./microsoft-mail-grants";
import { microsoftMailCallbackSchema } from "../models/microsoft-mail";

export function createMicrosoftMailApplication(options: {
  access: Pick<ReturnType<typeof createSessionAccess>, "authenticateForWork">;
  connection: Pick<
    ReturnType<typeof createMicrosoftMailGrantService>,
    "read" | "start" | "callback" | "disconnect" | "folders"
  >;
  queueInitialSync?(
    credentials: Headers,
    businessId: string,
    mailboxId: string,
  ): Promise<unknown>;
}) {
  const repository = options.connection;
  function validate<T>(schema: z.ZodType<T>, input: unknown) {
    const p = schema.safeParse(input);
    if (!p.success) throw new ApplicationError("INVALID_INPUT");
    return p.data;
  }
  async function context(
    credentials: Headers,
    id: unknown,
    mailboxId: unknown,
  ) {
    return {
      actor: await options.access.authenticateForWork(credentials),
      businessId: validate(z.uuid(), id),
      mailboxId: validate(z.uuid(), mailboxId),
    };
  }
  return {
    async folders(credentials: Headers, id: unknown, mailboxId: unknown) {
      const c = await context(credentials, id, mailboxId);
      return repository.folders(c.actor, c.businessId, c.mailboxId);
    },
    async read(credentials: Headers, id: unknown, mailboxId: unknown) {
      const c = await context(credentials, id, mailboxId);
      return repository.read(c.actor, c.businessId, c.mailboxId);
    },
    async start(credentials: Headers, id: unknown, mailboxId: unknown) {
      const c = await context(credentials, id, mailboxId);
      return repository.start(c.actor, c.businessId, c.mailboxId);
    },
    async callback(
      credentials: Headers,
      id: unknown,
      mailboxId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id, mailboxId);
      const data = validate(microsoftMailCallbackSchema, input);
      const result = await repository.callback(
        c.actor,
        c.businessId,
        c.mailboxId,
        data,
      );
      const state = await repository.read(c.actor, c.businessId, c.mailboxId);
      if (state.read && options.queueInitialSync)
        await options.queueInitialSync(credentials, c.businessId, c.mailboxId);
      return result;
    },
    async disconnect(credentials: Headers, id: unknown, mailboxId: unknown) {
      const c = await context(credentials, id, mailboxId);
      return repository.disconnect(c.actor, c.businessId, c.mailboxId);
    },
  };
}
