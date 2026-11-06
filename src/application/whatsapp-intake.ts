import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../models/application-error";
import { enableMetaIntakeSchema } from "../models/whatsapp-intake";
import { metaTokenSchema } from "../models/whatsapp";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import type { calendarCredentialVault } from "../appointments/credentials";
import type {
  createWhatsAppIntakeRepository,
  MetaScope,
} from "../db/whatsapp-intake-repository";
import type { MetaProvider } from "../whatsapp/provider";
import { metaActivities, verifyMetaSignature } from "../whatsapp/webhook";

export type MetaWebhookConfiguration = {
  appSecret: string;
  verifyToken: string;
  workerConfigured: boolean;
};
export function createWhatsAppIntakeApplication<Credentials>(options: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createWhatsAppIntakeRepository>;
  provider: MetaProvider;
  clock: Clock;
  vault: ReturnType<typeof calendarCredentialVault> | null;
  configuration: MetaWebhookConfiguration | null;
}) {
  async function context(credentials: Credentials, id: unknown) {
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
    return {
      actor: await options.authenticate(credentials),
      businessId: parsed.data,
    };
  }
  return {
    async associate(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const parsed = z
        .strictObject({ receiptId: z.uuid(), messageId: z.uuid() })
        .safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      return options.repository.associate(
        c.actor,
        c.businessId,
        parsed.data.receiptId,
        parsed.data.messageId,
      );
    },
    verify(
      mode: string | null,
      token: string | null,
      challenge: string | null,
    ) {
      const config = options.configuration;
      if (!config) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      if (
        mode !== "subscribe" ||
        !token ||
        !challenge ||
        challenge.length > 1024 ||
        Buffer.byteLength(token) !== Buffer.byteLength(config.verifyToken) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(config.verifyToken))
      )
        throw new ApplicationError("FORBIDDEN");
      return challenge;
    },
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return options.repository.workspace(c.actor, c.businessId);
    },
    async enable(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const parsed = enableMetaIntakeSchema.safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      const row = await options.repository.scope(
        c.actor,
        c.businessId,
        parsed.data.expectedVersion,
        options.provider.key,
      );
      if (
        !options.configuration?.workerConfigured ||
        !options.vault ||
        !options.provider.subscribe ||
        !row.credentials ||
        !row.assets
      )
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      const token = metaTokenSchema.parse(
        JSON.parse(
          options.vault.decrypt(
            row.credentials,
            `whatsapp:${c.businessId}:${row.id}:${row.version}`,
          ),
        ),
      );
      if (token.expiresAt && new Date(token.expiresAt) <= options.clock.now())
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      await options.provider.subscribe(
        token,
        row.assets,
        AbortSignal.timeout(10000),
      );
      const current = await context(credentials, id);
      if (
        current.actor.userId !== c.actor.userId ||
        current.actor.sessionId !== c.actor.sessionId
      )
        throw new ApplicationError("FORBIDDEN");
      return options.repository.enable(
        current.actor,
        c.businessId,
        parsed.data.expectedVersion,
        parsed.data.receiptRetentionSeconds,
        options.provider.key,
      );
    },
    async accept(raw: Uint8Array, signature: string | null) {
      if (!options.configuration)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      if (raw.byteLength > 1024 * 1024)
        throw new ApplicationError("INVALID_INPUT");
      verifyMetaSignature(raw, signature, options.configuration.appSecret);
      const activities = metaActivities(raw, options.clock.now());
      const groups = new Map<
        string,
        {
          scope: MetaScope;
          activities: (typeof activities)[number]["activity"][];
        }
      >();
      // Resolve every provider account before accepting any part of a batch. No tenant ID comes from the payload.
      for (const event of activities) {
        const key = `${event.wabaId}:${event.phoneNumberId}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            scope: await options.repository.resolve(
              options.provider.key,
              event.wabaId,
              event.phoneNumberId,
            ),
            activities: [],
          };
          groups.set(key, group);
        }
        group.activities.push(event.activity);
      }
      for (const group of groups.values())
        await options.repository.accept(group.scope, group.activities);
      return { accepted: true };
    },
    async drain() {
      await options.repository.purge();
      const results = [];
      let failed = false;
      for (const scope of await options.repository.pending(
        options.provider.key,
      )) {
        try {
          results.push(await options.repository.process(scope));
        } catch (error: unknown) {
          if (
            error instanceof ApplicationError &&
            ["FORBIDDEN", "NOT_FOUND"].includes(error.code)
          )
            continue;
          failed = true;
        }
      }
      if (failed) throw new ApplicationError("PROVIDER_UNAVAILABLE");
      return results;
    },
  };
}
