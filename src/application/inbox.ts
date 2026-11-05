import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import {
  inboxConnectionSchema,
  incomingInquirySchema,
  type AddInboxConnection,
  type CaptureResult,
  type InboxConnection,
  type InboxConversation,
  type InboxWorkspace,
  type IncomingInquiry,
  type InquiryAdapter,
} from "../models/inbox";

export type InboxRepository = {
  workspace(actor: Actor, businessId: string): Promise<InboxWorkspace>;
  conversation(
    actor: Actor,
    businessId: string,
    id: string,
  ): Promise<InboxConversation>;
  addConnection(
    actor: Actor,
    businessId: string,
    input: AddInboxConnection,
    at: Date,
  ): Promise<InboxConnection>;
  revokeConnection(actor: Actor, businessId: string, id: string): Promise<void>;
  intakeConnection(
    actor: Actor,
    businessId: string,
    id: string,
  ): Promise<InboxConnection>;
  capture(
    actor: Actor,
    businessId: string,
    connectionId: string,
    event: IncomingInquiry,
    at: Date,
  ): Promise<CaptureResult>;
};
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}

/** Classified failures: auth/scope, INVALID_INPUT and CONFLICT.
 * Intake records untrusted content only. It has no sending, model, spending or booking dependency.
 */
export function createInboxApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  repository: InboxRepository;
  adapter: InquiryAdapter;
  clock: Clock;
}) {
  const { repository } = dependencies;
  async function context(credentials: Credentials, businessId: unknown) {
    return {
      actor: await dependencies.authenticate(credentials),
      businessId: validate(businessIdSchema, businessId),
    };
  }
  return {
    async workspace(credentials: Credentials, id: unknown) {
      const ctx = await context(credentials, id);
      return repository.workspace(ctx.actor, ctx.businessId);
    },
    async conversation(
      credentials: Credentials,
      id: unknown,
      conversationId: unknown,
    ) {
      const ctx = await context(credentials, id);
      return repository.conversation(
        ctx.actor,
        ctx.businessId,
        validate(z.uuid(), conversationId),
      );
    },
    async addConnection(credentials: Credentials, id: unknown, input: unknown) {
      const ctx = await context(credentials, id);
      return repository.addConnection(
        ctx.actor,
        ctx.businessId,
        validate(inboxConnectionSchema, input),
        dependencies.clock.now(),
      );
    },
    async revokeConnection(
      credentials: Credentials,
      id: unknown,
      connectionId: unknown,
    ) {
      const ctx = await context(credentials, id);
      await repository.revokeConnection(
        ctx.actor,
        ctx.businessId,
        validate(z.uuid(), connectionId),
      );
    },
    async capture(
      credentials: Credentials,
      id: unknown,
      connectionId: unknown,
      input: unknown,
    ) {
      const ctx = await context(credentials, id);
      const connection = await repository.intakeConnection(
        ctx.actor,
        ctx.businessId,
        validate(z.uuid(), connectionId),
      );
      // Context comes from the authorized persisted connection; external data cannot choose it.
      const normalized = await dependencies.adapter.normalize(
        { connectionId: connection.id, channel: connection.channel },
        input,
      );
      const parsed = incomingInquirySchema.safeParse(normalized);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      const at = dependencies.clock.now();
      if (new Date(parsed.data.occurredAt) > at)
        throw new ApplicationError("INVALID_INPUT");
      const currentActor = await dependencies.authenticate(credentials);
      if (currentActor.userId !== ctx.actor.userId)
        throw new ApplicationError("FORBIDDEN");
      return repository.capture(
        ctx.actor,
        ctx.businessId,
        connection.id,
        parsed.data,
        at,
      );
    },
  };
}
