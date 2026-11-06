import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  controlChangeSchema,
  manualReplySchema,
  queueOpportunityActionSchema,
  type ControlChange,
  type ManualReply,
  type OpportunityActionProvider,
  type OpportunityControl,
  type QueueOpportunityAction,
  type DueAction,
} from "../models/opportunity-control";

export type OpportunityRepository = {
  reconcile(
    actor: WorkIdentity,
    businessId: string,
    actionId: string,
  ): Promise<DueAction>;
  read(
    actor: WorkIdentity,
    businessId: string,
    id: string,
  ): Promise<OpportunityControl>;
  change(
    actor: WorkIdentity,
    businessId: string,
    id: string,
    input: ControlChange,
    at: Date,
  ): Promise<void>;
  manualReply(
    actor: WorkIdentity,
    businessId: string,
    connectionId: string,
    input: ManualReply,
    at: Date,
  ): Promise<{ status: "captured" | "duplicate"; opportunityId: string }>;
  queue(
    actor: WorkIdentity,
    businessId: string,
    id: string,
    input: QueueOpportunityAction,
    at: Date,
  ): Promise<DueAction>;
  dispatch(
    actor: WorkIdentity,
    businessId: string,
    actionId: string,
    now: () => Date,
    provider: OpportunityActionProvider,
  ): Promise<DueAction>;
};
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Conventional application seam. Re-authentication happens again under the dispatch/control lock.
 * Known failures use ApplicationError; unknown provider failures stay private at the HTTP boundary.
 */
export function createOpportunityApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: OpportunityRepository;
  clock: Clock;
  provider: OpportunityActionProvider;
}) {
  async function context(
    credentials: Credentials,
    businessId: unknown,
    id: unknown,
  ) {
    const actor = await dependencies.authenticate(credentials);
    return {
      actor,
      businessId: parse(businessIdSchema, businessId),
      id: parse(z.uuid(), id),
    };
  }
  async function identity(credentials: Credentials, actor: Actor) {
    const current = await dependencies.authenticateForWork(credentials);
    if (current.userId !== actor.userId)
      throw new ApplicationError("FORBIDDEN");
    return current;
  }
  return {
    async read(credentials: Credentials, businessId: unknown, id: unknown) {
      const c = await context(credentials, businessId, id);
      return dependencies.repository.read(
        await identity(credentials, c.actor),
        c.businessId,
        c.id,
      );
    },
    async change(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, id);
      await dependencies.repository.change(
        await identity(credentials, c.actor),
        c.businessId,
        c.id,
        parse(controlChangeSchema, input),
        dependencies.clock.now(),
      );
    },
    async manualReply(
      credentials: Credentials,
      businessId: unknown,
      connectionId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, connectionId);
      const event = parse(manualReplySchema, input);
      if (new Date(event.occurredAt) > dependencies.clock.now())
        throw new ApplicationError("INVALID_INPUT");
      return dependencies.repository.manualReply(
        await identity(credentials, c.actor),
        c.businessId,
        c.id,
        event,
        dependencies.clock.now(),
      );
    },
    async queue(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, id);
      return dependencies.repository.queue(
        await identity(credentials, c.actor),
        c.businessId,
        c.id,
        parse(queueOpportunityActionSchema, input),
        dependencies.clock.now(),
      );
    },
    async dispatch(
      credentials: Credentials,
      businessId: unknown,
      actionId: unknown,
    ) {
      const c = await context(credentials, businessId, actionId);
      return dependencies.repository.dispatch(
        await identity(credentials, c.actor),
        c.businessId,
        c.id,
        dependencies.clock.now,
        dependencies.provider,
      );
    },
  };
}
