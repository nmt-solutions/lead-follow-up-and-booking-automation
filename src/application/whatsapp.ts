import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  whatsAppConfigurationSchema,
  metaCompletionSchema,
  metaTokenSchema,
  metaObservationSchema,
  type MetaObservation,
  type WhatsAppReason,
} from "../models/whatsapp";
import type { calendarCredentialVault } from "../appointments/credentials";
import type { createWhatsAppRepository } from "../db/whatsapp-repository";
import type { MetaProvider } from "../whatsapp/provider";
import { MetaFailure } from "../whatsapp/provider";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
const versionInput = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export function createWhatsAppApplication<Credentials>(options: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createWhatsAppRepository>;
  provider: MetaProvider;
  clock: Clock;
  vault: ReturnType<typeof calendarCredentialVault> | null;
}) {
  async function context(credentials: Credentials, id: unknown) {
    return {
      actor: await options.authenticate(credentials),
      businessId: parse(z.uuid(), id),
    };
  }
  function observation(
    value: unknown,
    assets: { portfolioId: string; wabaId: string; phoneNumberId: string },
    requestedAt: Date,
    expiresAt: string | null,
  ): MetaObservation {
    const p = metaObservationSchema.safeParse(value);
    if (
      !p.success ||
      p.data.portfolioId !== assets.portfolioId ||
      p.data.wabaId !== assets.wabaId ||
      p.data.phoneNumberId !== assets.phoneNumberId ||
      new Date(p.data.observedAt) < requestedAt ||
      new Date(p.data.observedAt) > options.clock.now() ||
      new Date(p.data.validUntil) <= new Date(p.data.observedAt) ||
      new Date(p.data.validUntil).getTime() >
        options.clock.now().getTime() + 15 * 60000
    )
      throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
    const deadline = Math.min(
      new Date(p.data.validUntil).getTime(),
      expiresAt ? new Date(expiresAt).getTime() : Infinity,
    );
    if (deadline <= options.clock.now().getTime())
      throw new MetaFailure("revoked");
    return { ...p.data, validUntil: new Date(deadline).toISOString() };
  }
  async function reauthenticate(
    credentials: Credentials,
    id: unknown,
    actor: WorkIdentity,
  ) {
    const current = await context(credentials, id);
    if (
      current.actor.userId !== actor.userId ||
      current.actor.sessionId !== actor.sessionId
    )
      throw new ApplicationError("FORBIDDEN");
    return current.actor;
  }
  function failure(error: unknown): WhatsAppReason {
    return error instanceof MetaFailure
      ? error.reason
      : error instanceof ApplicationError &&
          error.code === "INVALID_PROVIDER_RESPONSE"
        ? "invalid_response"
        : "provider_unavailable";
  }
  return {
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return options.repository.workspace(
        c.actor,
        c.businessId,
        options.provider,
      );
    },
    async save(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return options.repository.save(
        c.actor,
        c.businessId,
        parse(
          z.strictObject({
            expectedVersion: z.number().int().nonnegative(),
            configuration: whatsAppConfigurationSchema,
          }),
          input,
        ),
      );
    },
    async start(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = parse(versionInput, input);
      if (!options.vault) {
        await options.repository.ensureAccess(c.actor, c.businessId);
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      }
      return options.repository.start(
        c.actor,
        c.businessId,
        data.expectedVersion,
        options.provider,
      );
    },
    async complete(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = parse(metaCompletionSchema, input);
      const row = await options.repository.claim(
        c.actor,
        c.businessId,
        data,
        options.provider,
      );
      if (row.blocked)
        return options.repository.workspace(
          c.actor,
          c.businessId,
          options.provider,
        );
      if (
        !data.assets ||
        !data.code ||
        !options.vault ||
        !options.provider.setup.configured
      )
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      let encrypted: string | null = null;
      let observed: MetaObservation | null = null;
      let reason: WhatsAppReason | null = null;
      const requestedAt = options.clock.now();
      try {
        const token = parse(
          metaTokenSchema,
          await options.provider.exchange(
            data.code,
            AbortSignal.timeout(10000),
          ),
        );
        encrypted = options.vault.encrypt(
          JSON.stringify(token),
          `whatsapp:${c.businessId}:${row.id}:${row.version}`,
        );
        observed = observation(
          await options.provider.inspect(
            token,
            data.assets,
            row.configuration,
            data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
            AbortSignal.timeout(10000),
          ),
          data.assets,
          requestedAt,
          token.expiresAt,
        );
      } catch (error: unknown) {
        reason = encrypted ? failure(error) : "exchange_uncertain";
      }
      // The original session, membership and MFA are checked again after external I/O.
      const actor = await reauthenticate(credentials, id, c.actor);
      await options.repository.finish(actor, row, {
        credentials: reason === "revoked" ? null : encrypted,
        observation: observed,
        reason,
        assets: encrypted ? data.assets : null,
        coexistenceFinished:
          data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      });
      return options.repository.workspace(
        actor,
        c.businessId,
        options.provider,
      );
    },
    async refresh(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = parse(versionInput, input);
      const row = await options.repository.reserveCheck(
        c.actor,
        c.businessId,
        data.expectedVersion,
        options.provider,
      );
      let observed: MetaObservation | null = null;
      let reason: WhatsAppReason | null = null;
      try {
        if (!options.vault || !row.credentials || !row.assets)
          throw new MetaFailure("revoked");
        const token = metaTokenSchema.parse(
          JSON.parse(
            options.vault.decrypt(
              row.credentials,
              `whatsapp:${c.businessId}:${row.id}:${row.version}`,
            ),
          ),
        );
        if (token.expiresAt && new Date(token.expiresAt) <= options.clock.now())
          throw new MetaFailure("revoked");
        const at = options.clock.now();
        observed = observation(
          await options.provider.inspect(
            token,
            row.assets,
            row.configuration,
            row.coexistenceFinished,
            AbortSignal.timeout(10000),
          ),
          row.assets,
          at,
          token.expiresAt,
        );
      } catch (error: unknown) {
        reason = failure(error);
      }
      const actor = await reauthenticate(credentials, id, c.actor);
      await options.repository.finish(actor, row, {
        credentials: reason === "revoked" ? null : row.credentials,
        observation: observed,
        reason,
        assets: row.assets,
        coexistenceFinished: row.coexistenceFinished,
      });
      return options.repository.workspace(
        actor,
        c.businessId,
        options.provider,
      );
    },
    async disconnect(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return options.repository.disconnect(
        c.actor,
        c.businessId,
        parse(versionInput, input).expectedVersion,
      );
    },
    async register(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = parse(
        z.strictObject({
          expectedVersion: z.number().int().positive(),
          pin: z.string().regex(/^[0-9]{6}$/),
        }),
        input,
      );
      const row = await options.repository.reserveCheck(
        c.actor,
        c.businessId,
        data.expectedVersion,
        options.provider,
        true,
      );
      let observed: MetaObservation | null = null;
      let reason: WhatsAppReason | null = null;
      let attempted = false;
      try {
        if (!options.vault || !row.credentials || !row.assets)
          throw new MetaFailure("revoked");
        const token = metaTokenSchema.parse(
          JSON.parse(
            options.vault.decrypt(
              row.credentials,
              `whatsapp:${c.businessId}:${row.id}:${row.version}`,
            ),
          ),
        );
        if (token.expiresAt && new Date(token.expiresAt) <= options.clock.now())
          throw new MetaFailure("revoked");
        await reauthenticate(credentials, id, c.actor);
        await options.repository.recheck(c.actor, row);
        attempted = true;
        // One explicit attempt. A timeout never triggers a blind registration retry.
        await options.provider.register(
          token,
          row.assets,
          data.pin,
          AbortSignal.timeout(10000),
        );
        const at = options.clock.now();
        observed = observation(
          await options.provider.inspect(
            token,
            row.assets,
            row.configuration,
            false,
            AbortSignal.timeout(10000),
          ),
          row.assets,
          at,
          token.expiresAt,
        );
      } catch (error: unknown) {
        reason = attempted ? "registration_uncertain" : failure(error);
      }
      const actor = await reauthenticate(credentials, id, c.actor);
      await options.repository.finish(actor, row, {
        credentials: reason === "revoked" ? null : row.credentials,
        observation: observed,
        reason,
        assets: row.assets,
        coexistenceFinished: false,
      });
      return options.repository.workspace(
        actor,
        c.businessId,
        options.provider,
      );
    },
  };
}
