import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  sameSenderBinding,
  senderConnectionSchema,
  senderIdentitySchema,
  replyRouteSchema,
  senderSaveSchema,
  senderVersionSchema,
  senderObservationSchema,
  type SenderAdapter,
} from "../models/senders";
import type { createSenderRepository } from "../db/sender-repository";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Conventional authenticated application seam. Adapter proof is never accepted from an HTTP body. */
export function createSenderApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createSenderRepository>;
  adapter: SenderAdapter;
  clock: Clock;
}) {
  const { repository, adapter, clock } = dependencies;
  async function context(credentials: Credentials, id: unknown) {
    return {
      actor: await dependencies.authenticate(credentials),
      businessId: parse(businessIdSchema, id),
    };
  }
  return {
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return repository.workspace(c.actor, c.businessId, adapter);
    },
    async saveConnection(
      credentials: Credentials,
      id: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id);
      return repository.saveConnection(
        c.actor,
        c.businessId,
        parse(senderSaveSchema(senderConnectionSchema), input),
      );
    },
    async saveReplyRoute(
      credentials: Credentials,
      id: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id);
      return repository.saveReplyRoute(
        c.actor,
        c.businessId,
        parse(senderSaveSchema(replyRouteSchema), input),
      );
    },
    async saveIdentity(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return repository.saveIdentity(
        c.actor,
        c.businessId,
        parse(senderSaveSchema(senderIdentitySchema), input),
        adapter,
      );
    },
    async check(
      credentials: Credentials,
      id: unknown,
      identityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id);
      const identity = parse(z.uuid(), identityId);
      const { expectedVersion } = parse(
        z.strictObject({ expectedVersion: senderVersionSchema }),
        input,
      );
      const inspection = await repository.inspection(
        c.actor,
        c.businessId,
        identity,
        expectedVersion,
      );
      let result: unknown;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        result = await Promise.race([
          adapter.inspect(inspection, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ApplicationError("PROVIDER_UNAVAILABLE"));
            }, 5000);
          }),
        ]);
      } catch (cause: unknown) {
        if (
          cause instanceof ApplicationError &&
          cause.code === "CHANNEL_SETUP_REQUIRED"
        ) {
          await repository.invalidate(
            c.actor,
            c.businessId,
            inspection,
            adapter,
          );
          throw cause;
        }
        // Persist a failed refresh so an earlier healthy observation cannot remain authoritative.
        result = {
          binding: inspection.binding,
          observedAt: clock.now().toISOString(),
          validUntil: clock.now().toISOString(),
          approvedUses: [],
          checks: {
            identity_control: "unknown",
            domain_verification: "unknown",
            spf: "unknown",
            dkim: "unknown",
            dmarc_alignment: "unknown",
            sending_grant: "unknown",
            delivery_transport: "unavailable",
            reply_reading_grant: "unknown",
            inbox_sync: "unavailable",
            reply_capture: "unknown",
            health: "unavailable",
          },
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
      const observation = senderObservationSchema.safeParse(result);
      const current = await dependencies.authenticate(credentials);
      if (
        current.userId !== c.actor.userId ||
        current.sessionId !== c.actor.sessionId
      )
        throw new ApplicationError("FORBIDDEN");
      if (
        !observation.success ||
        !sameSenderBinding(observation.data.binding, inspection.binding) ||
        new Date(observation.data.observedAt) <
          new Date(inspection.requestedAt) ||
        new Date(observation.data.observedAt) > clock.now() ||
        new Date(observation.data.validUntil) <
          new Date(observation.data.observedAt)
      ) {
        await repository.invalidate(c.actor, c.businessId, inspection, adapter);
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      }
      return repository.record(
        c.actor,
        c.businessId,
        inspection,
        observation.data,
        adapter,
      );
    },
  };
}
