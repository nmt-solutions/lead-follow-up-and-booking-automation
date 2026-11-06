import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  permissionAllows,
  type MailboxRepository,
  type MailboxView,
  type MailboxWork,
  type MailboxJobState,
} from "../models/mailboxes";
import { captureInboxInquiry } from "./inbox-repository";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  inboxConnection,
  mailboxPolicy,
  mailboxJob,
  senderConnection,
  senderReplyRoute,
} from "./schema";

type Policy = typeof mailboxPolicy.$inferSelect;

async function policyAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(eq(mailboxPolicy.id, id), eq(mailboxPolicy.businessId, businessId)),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
async function connectionAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.id, id),
        eq(senderConnection.businessId, businessId),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
async function invalidateReplies(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
  at: Date,
) {
  const routes = await tx
    .select()
    .from(senderReplyRoute)
    .where(
      and(
        eq(senderReplyRoute.businessId, businessId),
        eq(senderReplyRoute.inboxConnectionId, mailboxId),
      ),
    );
  for (const route of routes)
    await tx
      .update(senderReplyRoute)
      .set({ version: route.version + 1, updatedAt: at })
      .where(eq(senderReplyRoute.id, route.id));
}
async function view(
  tx: Transaction,
  row: Policy,
  at: Date,
  canManage: boolean,
): Promise<MailboxView> {
  const jobs = await tx
    .select()
    .from(mailboxJob)
    .where(
      and(
        eq(mailboxJob.businessId, row.businessId),
        eq(mailboxJob.mailboxId, row.id),
      ),
    )
    .orderBy(desc(mailboxJob.createdAt), desc(mailboxJob.id))
    .limit(30);
  const [connection] = await tx
    .select()
    .from(senderConnection)
    .where(
      and(
        eq(senderConnection.businessId, row.businessId),
        eq(senderConnection.id, row.connectionId),
      ),
    );
  for (const job of jobs) {
    if (job.state.status === "completed" || job.state.status === "blocked")
      continue;
    let reason: MailboxJobState["reason"] = null;
    if (
      job.policyVersion !== row.version ||
      !connection ||
      connection.version !== row.connectionVersion ||
      !connection.configuration.enabled ||
      !row.configuration.enabled ||
      !row.configuration.requestedRead
    )
      reason = "scope_changed";
    else {
      try {
        const role = await requireCapability(
          tx,
          job.identity,
          row.businessId,
          "integrations.manage",
        );
        await requireSalesSession(tx, job.identity, at, role);
      } catch (error: unknown) {
        if (!(error instanceof ApplicationError)) throw error;
        reason = "authorization_required";
      }
    }
    if (reason) {
      job.state = { ...job.state, status: "blocked", reason };
      // A currently verified manager may reconcile terminal work. An expired queued identity never gains write access.
      if (canManage)
        await tx
          .update(mailboxJob)
          .set({ state: job.state })
          .where(eq(mailboxJob.id, job.id));
    }
  }
  const grant = row.grant;
  return {
    id: row.id,
    inboxConnectionId: row.id,
    version: row.version,
    account: row.account,
    provider: row.provider,
    configuration: row.configuration,
    incrementalSince: row.incrementalSince.toISOString(),
    grant: grant
      ? {
          read: grant.read,
          send: grant.send,
          observedAt: grant.observedAt,
          validUntil: grant.validUntil,
          folders: grant.folders,
          threads: grant.threads,
        }
      : null,
    jobs: jobs.map((job) => job.state),
  };
}
export function createMailboxRepository(
  database: Database,
  clock: Clock,
): MailboxRepository {
  function access<T>(
    identity: WorkIdentity,
    businessId: string,
    manage: boolean,
    run: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      identity,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          identity,
          businessId,
          manage ? "integrations.manage" : "sales.work",
        );
        await requireSalesSession(tx, identity, clock.now(), role);
        return run(tx);
      },
      { lock: true },
    );
  }
  async function loadWork(tx: Transaction, work: MailboxWork) {
    const policy = await policyAt(tx, work.businessId, work.mailboxId);
    const [job] = await tx
      .select()
      .from(mailboxJob)
      .where(
        and(
          eq(mailboxJob.id, work.jobId),
          eq(mailboxJob.businessId, work.businessId),
          eq(mailboxJob.mailboxId, work.mailboxId),
        ),
      );
    if (!job) throw new ApplicationError("NOT_FOUND");
    if (!isDeepStrictEqual(job.identity, work.identity))
      throw new ApplicationError("FORBIDDEN");
    if (
      job.policyVersion !== work.policyVersion ||
      policy.version !== work.policyVersion
    )
      throw new ApplicationError("CONFLICT");
    const connection = await connectionAt(
      tx,
      work.businessId,
      policy.connectionId,
    );
    const [inbox] = await tx
      .select()
      .from(inboxConnection)
      .where(
        and(
          eq(inboxConnection.id, policy.id),
          eq(inboxConnection.businessId, work.businessId),
        ),
      );
    if (
      !inbox?.active ||
      !policy.configuration.enabled ||
      !policy.configuration.requestedRead ||
      !connection.configuration.enabled
    )
      throw new ApplicationError("FORBIDDEN");
    if (
      connection.version !== policy.connectionVersion ||
      connection.configuration.account !== policy.account ||
      connection.configuration.provider !== policy.provider
    )
      throw new ApplicationError("CONFLICT");
    return { policy, job };
  }
  return {
    workspace(identity, businessId) {
      return access(identity, businessId, false, async (tx) => {
        const role = await requireCapability(
          tx,
          identity,
          businessId,
          "sales.work",
        );
        const connections = await tx
          .select()
          .from(senderConnection)
          .where(eq(senderConnection.businessId, businessId))
          .orderBy(asc(senderConnection.id));
        const rows = await tx
          .select()
          .from(mailboxPolicy)
          .where(eq(mailboxPolicy.businessId, businessId))
          .orderBy(asc(mailboxPolicy.id));
        return {
          canManage: role !== "salesperson",
          connections: connections.flatMap((row) => {
            const c = row.configuration;
            return c.provider === "gmail" || c.provider === "microsoft"
              ? [
                  {
                    id: row.id,
                    label: c.label,
                    provider: c.provider,
                    account: c.account,
                  },
                ]
              : [];
          }),
          mailboxes: await Promise.all(
            rows.map((row) =>
              view(tx, row, clock.now(), role !== "salesperson"),
            ),
          ),
        };
      });
    },
    save(identity, businessId, input) {
      return access(identity, businessId, true, async (tx) => {
        const at = clock.now();
        const config = input.configuration;
        if (config.history && new Date(config.history.to) > at)
          throw new ApplicationError("INVALID_INPUT");
        const connection = await connectionAt(
          tx,
          businessId,
          config.connectionId,
        );
        const provider = connection.configuration.provider;
        if (provider !== "gmail" && provider !== "microsoft")
          throw new ApplicationError("INVALID_INPUT");
        const existing = input.id
          ? await policyAt(tx, businessId, input.id)
          : null;
        if (existing && existing.version !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        // A mailbox's identity is immutable; a different account needs its own inbox and cursors.
        if (
          existing &&
          (existing.connectionId !== config.connectionId ||
            existing.account !== connection.configuration.account ||
            existing.provider !== connection.configuration.provider)
        )
          throw new ApplicationError("INVALID_INPUT");
        const [used] = await tx
          .select()
          .from(mailboxPolicy)
          .where(eq(mailboxPolicy.connectionId, config.connectionId));
        if (!existing && used) throw new ApplicationError("CONFLICT");
        const id = existing?.id ?? randomUUID();
        if (!existing)
          await tx.insert(inboxConnection).values({
            id,
            businessId,
            label: connection.configuration.label,
            channel: "email",
            conversationRefs: [],
            active: config.enabled,
            mode: "mailbox",
            createdBy: identity.userId,
            createdAt: at,
          });
        const readingChanged =
          !existing ||
          existing.connectionVersion !== connection.version ||
          existing.configuration.enabled !== config.enabled ||
          existing.configuration.requestedRead !== config.requestedRead ||
          !isDeepStrictEqual(existing.configuration.scope, config.scope);
        const data = {
          version: (existing?.version ?? 0) + 1,
          connectionVersion: connection.version,
          configuration: config,
          incrementalSince: readingChanged ? at : existing.incrementalSince,
          cursor: readingChanged ? null : existing.cursor,
          grant: null,
          updatedAt: at,
        };
        if (existing) {
          await tx
            .update(mailboxPolicy)
            .set(data)
            .where(eq(mailboxPolicy.id, id));
          await tx
            .update(inboxConnection)
            .set({ active: config.enabled })
            .where(eq(inboxConnection.id, id));
          const jobs = await tx
            .select()
            .from(mailboxJob)
            .where(
              and(
                eq(mailboxJob.businessId, businessId),
                eq(mailboxJob.mailboxId, id),
              ),
            );
          for (const job of jobs)
            if (job.state.status !== "completed")
              await tx
                .update(mailboxJob)
                .set({
                  state: {
                    ...job.state,
                    status: "blocked",
                    reason: "scope_changed",
                  },
                })
                .where(eq(mailboxJob.id, job.id));
          await invalidateReplies(tx, businessId, id, at);
        } else
          await tx.insert(mailboxPolicy).values({
            ...data,
            id,
            businessId,
            connectionId: config.connectionId,
            provider,
            account: connection.configuration.account,
            createdBy: identity.userId,
          });
        return view(tx, await policyAt(tx, businessId, id), at, true);
      });
    },
    queue(identity, businessId, mailboxId, mode) {
      return access(identity, businessId, true, async (tx) => {
        const policy = await policyAt(tx, businessId, mailboxId);
        if (
          !policy.configuration.enabled ||
          !policy.configuration.requestedRead ||
          (mode === "history" && !policy.configuration.history)
        )
          throw new ApplicationError("FORBIDDEN");
        const jobs = await tx
          .select()
          .from(mailboxJob)
          .where(
            and(
              eq(mailboxJob.businessId, businessId),
              eq(mailboxJob.mailboxId, mailboxId),
              eq(mailboxJob.policyVersion, policy.version),
            ),
          )
          .orderBy(desc(mailboxJob.createdAt));
        const existing = jobs.find(
          (job) =>
            job.state.mode === mode &&
            (mode === "history" || job.state.status !== "completed"),
        );
        if (existing) {
          if (!isDeepStrictEqual(existing.identity, identity)) {
            // Explicit resume transfers work to the currently verified manager without resetting bounds/checkpoints.
            await tx
              .update(mailboxJob)
              .set({ identity })
              .where(eq(mailboxJob.id, existing.id));
          }
          return {
            businessId,
            mailboxId,
            jobId: existing.id,
            policyVersion: policy.version,
            identity,
          };
        }
        const id = randomUUID();
        const state: MailboxJobState = {
          id,
          mode,
          policyVersion: policy.version,
          status: "queued",
          reason: null,
          checkpoint: 0,
          considered: 0,
          captured: 0,
          duplicates: 0,
          excluded: 0,
        };
        await tx.insert(mailboxJob).values({
          id,
          businessId,
          mailboxId,
          policyVersion: policy.version,
          identity,
          state,
          cursor: mode === "incremental" ? policy.cursor : null,
          seen: [],
          createdBy: identity.userId,
          createdAt: clock.now(),
        });
        return {
          businessId,
          mailboxId,
          jobId: id,
          policyVersion: policy.version,
          identity,
        };
      });
    },
    prepare(work) {
      return access(work.identity, work.businessId, true, async (tx) => {
        const { policy, job } = await loadWork(tx, work);
        if (job.state.status === "completed") return null;
        if (job.state.reason === "limit_reached") return null;
        await tx
          .update(mailboxJob)
          .set({ state: { ...job.state, status: "running", reason: null } })
          .where(eq(mailboxJob.id, job.id));
        return {
          work,
          configuration: policy.configuration,
          inboxConnectionId: policy.id,
          provider: policy.provider,
          account: policy.account,
          connectionVersion: policy.connectionVersion,
          incrementalSince: policy.incrementalSince.toISOString(),
          cursor: job.cursor,
          checkpoint: job.state.checkpoint,
          permissionObservation: policy.grant,
          mode: job.state.mode,
          limit:
            job.state.mode === "history"
              ? Math.min(
                  100,
                  policy.configuration.history!.maxMessages -
                    job.state.considered,
                )
              : 100,
          considered: job.state.considered,
          seen: job.seen,
        };
      });
    },
    commit(batch) {
      const { snapshot, grant, page } = batch;
      const work = snapshot.work;
      return access(work.identity, work.businessId, true, async (tx) => {
        const { policy, job } = await loadWork(tx, work);
        if (
          job.state.checkpoint !== snapshot.checkpoint ||
          !isDeepStrictEqual(policy.grant, snapshot.permissionObservation) ||
          job.cursor !== snapshot.cursor ||
          job.state.status === "completed"
        )
          throw new ApplicationError("CONFLICT");
        if (!permissionAllows(policy.configuration, grant, clock.now()))
          throw new ApplicationError("FORBIDDEN");
        let captured = 0,
          duplicates = 0;
        for (const { event, metadata } of batch.selected) {
          const result = await captureInboxInquiry(
            tx,
            work.identity,
            work.businessId,
            policy.id,
            event,
            clock.now(),
            {
              since: new Date(
                job.state.mode === "history"
                  ? policy.configuration.history!.from
                  : policy.incrementalSince,
              ),
              metadata,
            },
          );
          if (result.status === "captured") captured++;
          else if (result.status === "duplicate") duplicates++;
        }
        const considered = job.state.considered + batch.selected.length;
        const bounded =
          job.state.mode === "history" &&
          considered >= policy.configuration.history!.maxMessages;
        const status = page.hasMore ? "partial" : "completed";
        const state: MailboxJobState = {
          ...job.state,
          status,
          reason: bounded && page.hasMore ? "limit_reached" : null,
          checkpoint: job.state.checkpoint + 1,
          considered,
          captured: job.state.captured + captured,
          duplicates: job.state.duplicates + duplicates,
          excluded: job.state.excluded + batch.excluded,
        };
        await tx
          .update(mailboxJob)
          .set({ state, cursor: page.nextCursor, seen: batch.seen })
          .where(eq(mailboxJob.id, job.id));
        await tx
          .update(mailboxPolicy)
          .set({
            grant,
            ...(job.state.mode === "incremental"
              ? { cursor: page.nextCursor }
              : {}),
          })
          .where(eq(mailboxPolicy.id, policy.id));
        return state;
      });
    },
    stop(snapshot, reason) {
      const { work } = snapshot;
      // Trusted worker acknowledgement can only block its exact unfinished checkpoint.
      // Current Business role/RLS still apply; this cannot read mail, change grants, advance cursors or resume work.
      return scoped(
        database,
        work.identity,
        work.businessId,
        async (tx) => {
          await requireCapability(
            tx,
            work.identity,
            work.businessId,
            "integrations.manage",
          );
          const [job] = await tx
            .select()
            .from(mailboxJob)
            .where(
              and(
                eq(mailboxJob.id, work.jobId),
                eq(mailboxJob.businessId, work.businessId),
                eq(mailboxJob.mailboxId, work.mailboxId),
              ),
            );
          if (
            !job ||
            !isDeepStrictEqual(job.identity, work.identity) ||
            job.policyVersion !== work.policyVersion ||
            job.state.checkpoint !== snapshot.checkpoint ||
            job.cursor !== snapshot.cursor ||
            job.state.status === "completed" ||
            job.state.reason === "scope_changed"
          )
            return;
          await tx
            .update(mailboxJob)
            .set({ state: { ...job.state, status: "blocked", reason } })
            .where(eq(mailboxJob.id, job.id));
        },
        { lock: true },
      );
    },
    fail(snapshot, reason, grant) {
      const { work, checkpoint } = snapshot;
      return access(work.identity, work.businessId, true, async (tx) => {
        const { policy, job } = await loadWork(tx, work);
        if (
          job.state.checkpoint !== checkpoint ||
          (!isDeepStrictEqual(policy.grant, snapshot.permissionObservation) &&
            !(
              reason === "permission_required" &&
              grant &&
              grant.read !== "granted"
            )) ||
          job.state.status === "completed"
        )
          throw new ApplicationError("CONFLICT");
        const state: MailboxJobState = {
          ...job.state,
          status: reason === "provider_unavailable" ? "partial" : "blocked",
          reason,
        };
        await tx
          .update(mailboxJob)
          .set({ state })
          .where(eq(mailboxJob.id, job.id));
        await tx
          .update(mailboxPolicy)
          .set({ grant: grant ?? null })
          .where(eq(mailboxPolicy.id, policy.id));
        await invalidateReplies(tx, work.businessId, policy.id, clock.now());
        return state;
      });
    },
  };
}
