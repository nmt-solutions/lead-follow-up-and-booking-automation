import { z } from "zod";
import type { createSessionAccess } from "../auth/access";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import { mailboxAuthorizationCallbackSchema } from "../models/mailbox-authorization";

type Access = Pick<
  ReturnType<typeof createSessionAccess>,
  "authenticateForWork"
>;
export async function mailboxAuthorizationContext(
  access: Access,
  credentials: Headers,
  id: unknown,
  mailboxId: unknown,
) {
  const actor = await access.authenticateForWork(credentials);
  const business = z.uuid().safeParse(id),
    mailbox = z.uuid().safeParse(mailboxId);
  if (!business.success || !mailbox.success)
    throw new ApplicationError("INVALID_INPUT");
  return { actor, businessId: business.data, mailboxId: mailbox.data };
}
export function createMailboxAuthorizationApplication<
  View extends { read: boolean },
>(options: {
  access: Access;
  connection: {
    read(
      actor: WorkIdentity,
      businessId: string,
      mailboxId: string,
    ): Promise<View>;
    start(
      actor: WorkIdentity,
      businessId: string,
      mailboxId: string,
    ): Promise<{ authorizationUrl: string }>;
    callback(
      actor: WorkIdentity,
      businessId: string,
      mailboxId: string,
      input: z.infer<typeof mailboxAuthorizationCallbackSchema>,
    ): Promise<{ returnPath: string }>;
    disconnect(
      actor: WorkIdentity,
      businessId: string,
      mailboxId: string,
    ): Promise<View>;
  };
  queueInitialSync?(
    credentials: Headers,
    businessId: string,
    mailboxId: string,
  ): Promise<unknown>;
}) {
  const repository = options.connection;
  const context = (credentials: Headers, id: unknown, mailboxId: unknown) =>
    mailboxAuthorizationContext(options.access, credentials, id, mailboxId);
  return {
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
      const c = await context(credentials, id, mailboxId),
        data = mailboxAuthorizationCallbackSchema.safeParse(input);
      if (!data.success) throw new ApplicationError("INVALID_INPUT");
      const result = await repository.callback(
        c.actor,
        c.businessId,
        c.mailboxId,
        data.data,
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
