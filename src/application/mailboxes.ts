import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { incomingInquirySchema } from "../models/inbox";
import { mailManualSchema } from "../models/mail-native";
import {
  mailboxGrantSchema,
  MailboxFailure,
  mailboxPageSchema,
  mailboxWorkSchema,
  saveMailboxSchema,
  queueMailboxSchema,
  permissionAllows,
  selectedMetadata,
  type MailboxProvider,
  type MailboxRepository,
  type MailboxGrant,
  type MailboxBatch,
} from "../models/mailboxes";

function parse<T>(schema: z.ZodType<T>, value: unknown, provider = false): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApplicationError(
      provider ? "INVALID_PROVIDER_RESPONSE" : "INVALID_INPUT",
    );
  return result.data;
}
/** Only trusted server adapters can supply grants and mailbox events. No send/AI/calendar dependency. */
export function createMailboxApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: MailboxRepository;
  provider: MailboxProvider;
  clock: Clock;
  enqueue?(work: z.infer<typeof mailboxWorkSchema>): Promise<void>;
}) {
  const { repository, provider, clock } = dependencies;
  async function context(credentials: Credentials, id: unknown) {
    return {
      identity: await dependencies.authenticate(credentials),
      businessId: parse(businessIdSchema, id),
    };
  }
  return {
    async recoverConnection(
      credentials: Credentials,
      id: unknown,
      mailboxId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id),
        { mode, pilotSetupRequestKey } = parse(queueMailboxSchema, input);
      const work = await repository.queue(
        c.identity,
        c.businessId,
        parse(z.uuid(), mailboxId),
        mode,
        pilotSetupRequestKey,
      );
      if (provider.mode !== "unconfigured" && dependencies.enqueue) {
        try {
          await dependencies.enqueue(work);
          return { outcome: "queued" as const };
        } catch {
          /* The same persisted work remains recoverable. */
        }
      }
      const snapshot = await repository.prepare(work);
      if (snapshot)
        await repository.fail(
          snapshot,
          provider.mode === "unconfigured"
            ? "setup_required"
            : "worker_required",
        );
      return { outcome: "unavailable" as const };
    },
    // Trusted maintenance composition preserves the original actor and selected
    // work. It cannot transfer ownership, extend history or read private output.
    async recoverExisting(input: unknown) {
      const work = parse(mailboxWorkSchema, input);
      const snapshot = await repository.prepare(work);
      if (!snapshot) return { outcome: "checked" as const };
      if (!dependencies.enqueue || provider.mode === "unconfigured") {
        await repository.fail(
          snapshot,
          provider.mode === "unconfigured"
            ? "setup_required"
            : "worker_required",
        );
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      }
      await dependencies.enqueue(work);
      return { outcome: "queued" as const };
    },
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return {
        ...(await repository.workspace(c.identity, c.businessId)),
        providerMode: provider.mode,
      };
    },
    async save(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return repository.save(
        c.identity,
        c.businessId,
        parse(saveMailboxSchema, input),
      );
    },
    async queue(
      credentials: Credentials,
      id: unknown,
      mailboxId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, id);
      const { mode, pilotSetupRequestKey } = parse(queueMailboxSchema, input);
      const work = await repository.queue(
        c.identity,
        c.businessId,
        parse(z.uuid(), mailboxId),
        mode,
        pilotSetupRequestKey,
      );
      if (provider.mode === "unconfigured") {
        const snapshot = await repository.prepare(work);
        if (snapshot) await repository.fail(snapshot, "setup_required");
        return work;
      }
      if (dependencies.enqueue) {
        try {
          await dependencies.enqueue(work);
        } catch {
          const snapshot = await repository.prepare(work);
          if (snapshot) await repository.fail(snapshot, "worker_required");
        }
      } else if (provider.mode === "live") {
        const snapshot = await repository.prepare(work);
        if (snapshot) await repository.fail(snapshot, "worker_required");
      }
      return work;
    },
    async execute(input: unknown, signal = AbortSignal.timeout(30000)) {
      const work = parse(mailboxWorkSchema, input);
      const snapshot = await repository.prepare(work);
      if (!snapshot) return null;
      if (snapshot.pilotSetupRequestKey)
        snapshot.authorizeNative = (operation) =>
          repository.authorizeCall(work, snapshot.checkpoint, "native:read", {
            operation,
          });
      if (snapshot.retryAt && new Date(snapshot.retryAt) > clock.now())
        return repository.fail(
          snapshot,
          "rate_limited",
          snapshot.permissionObservation ?? undefined,
          Math.ceil(
            (new Date(snapshot.retryAt).getTime() - clock.now().getTime()) /
              1000,
          ),
        );
      async function call<T>(
        phase: string,
        payload: Record<string, unknown>,
        invoke: () => Promise<T>,
      ) {
        signal.throwIfAborted();
        await repository.authorizeCall(
          work,
          snapshot!.checkpoint,
          phase,
          payload,
        );
        signal.throwIfAborted();
        return invoke();
      }
      let grant: MailboxGrant | undefined;
      try {
        signal.throwIfAborted();
        grant = parse(
          mailboxGrantSchema,
          await call("inspect", {}, () => provider.inspect(snapshot, signal)),
          true,
        );
        if (
          grant.provider !== snapshot.provider ||
          grant.account.toLowerCase() !== snapshot.account.toLowerCase() ||
          new Date(grant.observedAt) > clock.now() ||
          new Date(grant.validUntil) <= clock.now()
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        if (!permissionAllows(snapshot.configuration, grant, clock.now()))
          return await repository.fail(snapshot, "permission_required", grant);
        const page = parse(
          mailboxPageSchema,
          await call(
            "list",
            { cursor: snapshot.cursor, limit: snapshot.limit },
            () => provider.list(snapshot, grant!, signal),
          ),
          true,
        );
        const remaining =
          snapshot.mode === "history"
            ? snapshot.configuration.history!.maxMessages - snapshot.considered
            : 100;
        if (page.messages.length > snapshot.limit)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        if (
          page.provider !== snapshot.provider ||
          page.account.toLowerCase() !== snapshot.account.toLowerCase() ||
          page.grantRevision !== grant.revision ||
          page.cursor !== snapshot.cursor ||
          (page.hasMore && page.nextCursor === page.cursor)
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        // Recheck current actor/session, policy and checkpoint before asking for any bodies.
        const current = await repository.prepare(work);
        if (
          !current ||
          current.checkpoint !== snapshot.checkpoint ||
          current.oauthGeneration !== snapshot.oauthGeneration ||
          !isDeepStrictEqual(
            current.permissionObservation,
            snapshot.permissionObservation,
          )
        )
          throw new ApplicationError("CONFLICT");
        const selected: MailboxBatch["selected"] = [];
        const seen = new Set(snapshot.seen);
        let excluded = 0;
        const mode = snapshot.mode;
        for (const metadata of page.messages) {
          if (new Date(metadata.occurredAt) > clock.now())
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          if (
            !selectedMetadata(
              snapshot.configuration,
              metadata,
              snapshot.incrementalSince,
              mode,
            )
          ) {
            excluded++;
            continue;
          }
          if (seen.has(metadata.messageRef)) continue;
          if (mode === "history" && selected.length >= remaining)
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          const event = parse(
            z.union([incomingInquirySchema, mailManualSchema]),
            await call("read", { messageRef: metadata.messageRef }, () =>
              provider.read(snapshot, metadata, signal),
            ),
            true,
          );
          if (
            event.messageRef !== metadata.messageRef ||
            event.conversationRef !== metadata.conversationRef ||
            new Date(event.occurredAt).getTime() !==
              new Date(metadata.occurredAt).getTime() ||
            (event.kind === "manual_reply" &&
              !isDeepStrictEqual(event.native, metadata.native)) ||
            (event.kind !== "manual_reply" &&
              metadata.native &&
              (metadata.native.direction !== "incoming" ||
                event.senderRef.toLowerCase() !==
                  metadata.native.from.toLowerCase() ||
                !metadata.native.to
                  .map((v) => v.toLowerCase())
                  .includes(snapshot.account.toLowerCase()))) ||
            (event.kind !== "direct_inquiry" &&
              event.kind !== "buying_interest_reply" &&
              event.kind !== "opt_out" &&
              event.kind !== "manual_reply")
          )
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          selected.push({
            metadata,
            event: { ...event, eventId: metadata.messageRef },
          });
          seen.add(metadata.messageRef);
        }
        signal.throwIfAborted();
        const confirmed = parse(
          mailboxGrantSchema,
          await call("confirm_grant", {}, () =>
            provider.inspect(snapshot, signal),
          ),
          true,
        );
        if (
          confirmed.provider !== snapshot.provider ||
          confirmed.account.toLowerCase() !== snapshot.account.toLowerCase()
        )
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        if (
          !isDeepStrictEqual(
            { ...grant, observedAt: null, validUntil: null },
            { ...confirmed, observedAt: null, validUntil: null },
          ) ||
          !permissionAllows(snapshot.configuration, confirmed, clock.now())
        )
          return await repository.fail(
            snapshot,
            "permission_required",
            confirmed,
          );
        return await repository.commit({
          snapshot,
          grant: confirmed,
          page,
          selected,
          seen: [...seen],
          excluded,
        });
      } catch (error: unknown) {
        if (signal.aborted)
          return await repository.fail(snapshot, "interrupted", grant);
        if (
          error instanceof ApplicationError &&
          [
            "CONFLICT",
            "FORBIDDEN",
            "NOT_FOUND",
            "UNAUTHENTICATED",
            "MFA_REQUIRED",
          ].includes(error.code)
        ) {
          try {
            await repository.stop(
              snapshot,
              ["CONFLICT", "FORBIDDEN"].includes(error.code)
                ? "scope_changed"
                : "authorization_required",
            );
          } catch {
            /* Removed members cannot write even a failure acknowledgement; a verified manager reconciles it on review. */
          }
          throw error;
        }
        return await repository.fail(
          snapshot,
          error instanceof MailboxFailure
            ? error.condition
            : error instanceof ApplicationError &&
                error.code === "CHANNEL_SETUP_REQUIRED"
              ? "setup_required"
              : error instanceof ApplicationError &&
                  error.code === "INVALID_PROVIDER_RESPONSE"
                ? "invalid_provider_response"
                : "provider_unavailable",
          error instanceof MailboxFailure &&
            error.condition === "permission_required"
            ? undefined
            : error instanceof ApplicationError &&
                error.code === "INVALID_PROVIDER_RESPONSE"
              ? undefined
              : grant,
          error instanceof MailboxFailure ? error.retryAfterSeconds : undefined,
        );
      }
    },
    async repeat(input: unknown) {
      return repository.repeat(parse(mailboxWorkSchema, input));
    },
  };
}
