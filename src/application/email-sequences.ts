import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { campaignRefSchema } from "../models/campaigns";
import {
  configureSequenceSchema,
  sequenceCommandSchema,
  sequenceWorkSchema,
  classifySequenceReplySchema,
  type SequenceMailProvider,
  type SequenceQueue,
} from "../models/email-sequences";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type { createEmailSequenceRepository } from "../db/email-sequence-repository";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
export function createEmailSequenceApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createEmailSequenceRepository>;
  clock: Clock;
  provider: SequenceMailProvider;
  queue?: SequenceQueue;
}) {
  async function context(credentials: Credentials, id: unknown) {
    return {
      actor: await d.authenticate(credentials),
      businessId: parse(z.uuid(), id),
    };
  }
  async function flush(actor: WorkIdentity, businessId: string, runId: string) {
    for (const job of await d.repository.pending(actor, businessId, runId)) {
      let queueRunId: string | null = null;
      try {
        queueRunId = (await d.queue?.enqueue(job.work, job.dueAt)) ?? null;
      } catch {
        /* Persist safe queue failure; replay uses the same durable identity. */
      }
      await d.repository.queueResult(job.work, queueRunId);
    }
  }
  return {
    async classifyReply(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      await d.repository.classifyReply(
        c.actor,
        c.businessId,
        parse(classifySequenceReplySchema, input),
      );
      return d.repository.workspace(
        c.actor,
        c.businessId,
        d.provider,
        Boolean(d.queue),
      );
    },
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return d.repository.workspace(
        c.actor,
        c.businessId,
        d.provider,
        Boolean(d.queue),
      );
    },
    async configure(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      await d.repository.configure(
        c.actor,
        c.businessId,
        parse(configureSequenceSchema, input),
      );
      return d.repository.workspace(
        c.actor,
        c.businessId,
        d.provider,
        Boolean(d.queue),
      );
    },
    async start(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      if (d.provider.mode === "unconfigured" || !d.queue)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      const runId = await d.repository.start(
        c.actor,
        c.businessId,
        parse(campaignRefSchema, input),
        d.provider,
      );
      await flush(c.actor, c.businessId, runId);
      return d.repository.workspace(
        c.actor,
        c.businessId,
        d.provider,
        Boolean(d.queue),
      );
    },
    async command(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id),
        command = parse(sequenceCommandSchema, input);
      const cancelled = await d.repository.command(
        c.actor,
        c.businessId,
        command,
        d.provider,
      );
      if (command.command === "pause" || command.command === "cancel")
        for (const runId of cancelled ?? []) {
          try {
            await d.queue?.cancel(runId);
          } catch {
            /* Persistent state is the cancellation fence even if the queue is unavailable. */
          }
        }
      if (command.command === "recover")
        await d.repository.reconcile(
          c.actor,
          c.businessId,
          command.runId,
          d.provider,
          AbortSignal.timeout(5000),
        );
      await flush(c.actor, c.businessId, command.runId);
      return d.repository.workspace(
        c.actor,
        c.businessId,
        d.provider,
        Boolean(d.queue),
      );
    },
    async execute(input: unknown, signal = AbortSignal.timeout(5000)) {
      const work = parse(sequenceWorkSchema, input);
      try {
        const attempted = await d.repository.execute(work, d.provider, signal);
        if (!attempted)
          await d.repository.reconcile(
            work.identity,
            work.businessId,
            work.runId,
            d.provider,
            signal,
          );
        await flush(work.identity, work.businessId, work.runId);
      } catch (error: unknown) {
        if (
          error instanceof ApplicationError &&
          [
            "NOT_FOUND",
            "FORBIDDEN",
            "UNAUTHENTICATED",
            "MFA_REQUIRED",
          ].includes(error.code)
        )
          await d.repository.workerStopped(work, "authorization_changed");
        throw error;
      }
    },
    async workerStopped(
      input: unknown,
      reason: "authorization_changed" | "worker_lost",
    ) {
      await d.repository.workerStopped(
        parse(sequenceWorkSchema, input),
        reason,
      );
    },
    async recoverDue(target?: { businessId: string; runId: string }) {
      if (!d.queue || d.provider.mode === "unconfigured") return { queued: 0 };
      const work = (await d.repository.recoveryWork()).filter(
        (item) =>
          !target ||
          (item.businessId === target.businessId &&
            item.runId === target.runId),
      );
      let queued = 0;
      for (const item of work) {
        try {
          await d.repository.reconcile(
            item.identity,
            item.businessId,
            item.runId,
            d.provider,
            AbortSignal.timeout(5000),
          );
          await flush(item.identity, item.businessId, item.runId);
          queued++;
        } catch (error: unknown) {
          if (
            error instanceof ApplicationError &&
            [
              "NOT_FOUND",
              "FORBIDDEN",
              "UNAUTHENTICATED",
              "MFA_REQUIRED",
              "CONFLICT",
            ].includes(error.code)
          )
            await d.repository.workerStopped(item, "authorization_changed");
          else throw new ApplicationError("PROVIDER_UNAVAILABLE");
        }
      }
      return { queued };
    },
  };
}
