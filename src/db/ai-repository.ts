import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  unknownAiMetrics,
  type AiWorkspace,
  type AiProfile,
  type AiSample,
  type AiOutput,
  type AiFailure,
  type AiMetrics,
  type AiRoute,
  type AiTask,
  type AiConfiguration,
} from "../models/ai";
import type { Database } from "./runtime";
import {
  platformOperator,
  knowledgeRevision,
  aiProfile,
  aiActivation,
  aiActivationAudit,
  aiExecution,
  aiAttempt,
  aiReview,
} from "./schema";
import { requireCapability, scoped, type Transaction } from "./scope";
import { knowledgeState } from "../models/knowledge";

async function authorize(tx: Transaction, actor: Actor, businessId: string) {
  await requireCapability(tx, actor, businessId, "profile.manage");
  const [grant] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!grant?.ai) throw new ApplicationError("FORBIDDEN");
}
async function knowledge(tx: Transaction, businessId: string) {
  const rows = await tx
    .select()
    .from(knowledgeRevision)
    .where(eq(knowledgeRevision.businessId, businessId))
    .orderBy(asc(knowledgeRevision.version));
  return knowledgeState(
    rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    false,
  ).current;
}
async function activation(tx: Transaction) {
  const [row] = await tx
    .select()
    .from(aiActivation)
    .orderBy(desc(aiActivation.version))
    .limit(1);
  return { version: row?.version ?? 0, profileId: row?.profileId ?? null };
}
async function executions(tx: Transaction, businessId: string) {
  const rows = await tx
    .select({
      id: aiExecution.id,
      profileId: aiExecution.profileId,
      task: aiExecution.task,
      kind: aiExecution.kind,
      knowledgeVersion: aiExecution.knowledgeVersion,
      sample: aiExecution.sample,
      at: aiExecution.at,
      actorId: aiExecution.actorId,
      status: aiExecution.status,
      failure: aiExecution.failure,
      output: aiExecution.output,
    })
    .from(aiExecution)
    .where(eq(aiExecution.businessId, businessId))
    .orderBy(desc(aiExecution.at), desc(aiExecution.id));
  const attempts = await tx
    .select()
    .from(aiAttempt)
    .where(eq(aiAttempt.businessId, businessId))
    .orderBy(asc(aiAttempt.number));
  const reviews = await tx
    .select()
    .from(aiReview)
    .where(eq(aiReview.businessId, businessId));
  return rows.map((row) => {
    const review = reviews.find((value) => value.executionId === row.id);
    return {
      ...row,
      at: row.at.toISOString(),
      review: review
        ? {
            accepted: review.accepted,
            actorId: review.actorId,
            at: review.at.toISOString(),
            note: review.note,
          }
        : null,
      attempts: attempts
        .filter((value) => value.executionId === row.id)
        .map((attempt) => ({
          id: attempt.id,
          number: attempt.number,
          route: attempt.route,
          outcome: attempt.outcome,
          failure: attempt.failure,
          metrics: attempt.metrics,
          latencyMs: attempt.latencyMs,
          fundingSource: attempt.fundingSource,
          fundingReference: attempt.fundingReference,
          at: attempt.at.toISOString(),
        })),
    };
  });
}
async function lockProfiles(tx: Transaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('approved-ai-profiles', 0))`,
  );
}
async function profileById(tx: Transaction, id: string) {
  const [row] = await tx.select().from(aiProfile).where(eq(aiProfile.id, id));
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
export function createAiRepository(database: Database) {
  return {
    authorize(actor: Actor, businessId: string, mode: "preview" | AiTask) {
      return scoped(database, actor, businessId, async (tx) => {
        if (mode === "preview") await authorize(tx, actor, businessId);
        else
          await requireCapability(
            tx,
            actor,
            businessId,
            mode === "extraction" ? "profile.manage" : "sales.work",
          );
      });
    },
    workspace(actor: Actor, businessId: string): Promise<AiWorkspace> {
      return scoped(database, actor, businessId, async (tx) => {
        await authorize(tx, actor, businessId);
        const profiles = await tx
          .select()
          .from(aiProfile)
          .orderBy(asc(aiProfile.version));
        return {
          profiles: profiles.map((row) => ({
            ...row,
            at: row.at.toISOString(),
          })),
          executions: await executions(tx, businessId),
          activation: await activation(tx),
          activationHistory: (
            await tx
              .select({
                version: aiActivation.version,
                profileId: aiActivation.profileId,
                actorId: aiActivationAudit.actorId,
                at: aiActivationAudit.at,
                note: aiActivationAudit.note,
              })
              .from(aiActivationAudit)
              .innerJoin(
                aiActivation,
                eq(aiActivation.id, aiActivationAudit.id),
              )
              .where(eq(aiActivationAudit.businessId, businessId))
              .orderBy(asc(aiActivation.version))
          ).map((row) => ({ ...row, at: row.at.toISOString() })),
          setup: [],
          configuration: null,
          knowledgeVersion: (await knowledge(tx, businessId))?.version ?? null,
        };
      });
    },
    saveDraft(
      actor: Actor,
      businessId: string,
      input: { expectedVersion: number; profile: AiProfile; note: string },
      at: Date,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await authorize(tx, actor, businessId);
        await lockProfiles(tx);
        const [latest] = await tx
          .select()
          .from(aiProfile)
          .orderBy(desc(aiProfile.version))
          .limit(1);
        if ((latest?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        await tx.insert(aiProfile).values({
          id: randomUUID(),
          version: input.expectedVersion + 1,
          profile: input.profile,
          note: input.note,
          actorId: actor.userId,
          at,
        });
      });
    },
    activate(
      actor: Actor,
      businessId: string,
      input: {
        profileId: string;
        expectedActivationVersion: number;
        note: string;
      },
      at: Date,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await authorize(tx, actor, businessId);
        await lockProfiles(tx);
        await profileById(tx, input.profileId);
        if ((await activation(tx)).version !== input.expectedActivationVersion)
          throw new ApplicationError("CONFLICT");
        const current = await knowledge(tx, businessId);
        const validated = (await executions(tx, businessId)).filter(
          (row) =>
            row.profileId === input.profileId &&
            row.kind === "preview" &&
            row.status === "succeeded" &&
            row.review?.accepted &&
            row.knowledgeVersion === current?.version,
        );
        if (
          !["extraction", "drafting"].every((task) =>
            validated.some((row) => row.task === task),
          )
        )
          throw new ApplicationError("AI_VALIDATION_REQUIRED");
        const id = randomUUID();
        await tx.insert(aiActivation).values({
          id,
          version: input.expectedActivationVersion + 1,
          profileId: input.profileId,
        });
        await tx.insert(aiActivationAudit).values({
          id,
          businessId,
          actorId: actor.userId,
          at,
          note: input.note,
        });
      });
    },
    review(
      actor: Actor,
      businessId: string,
      input: { executionId: string; accepted: boolean; note: string },
      at: Date,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await authorize(tx, actor, businessId);
        await lockProfiles(tx);
        const [execution] = await tx
          .select()
          .from(aiExecution)
          .where(
            and(
              eq(aiExecution.id, input.executionId),
              eq(aiExecution.businessId, businessId),
            ),
          );
        if (!execution) throw new ApplicationError("NOT_FOUND");
        const [review] = await tx
          .select()
          .from(aiReview)
          .where(eq(aiReview.executionId, execution.id));
        if (
          review ||
          execution.kind !== "preview" ||
          execution.status !== "succeeded" ||
          execution.knowledgeVersion !==
            (await knowledge(tx, businessId))?.version
        )
          throw new ApplicationError("CONFLICT");
        await tx.insert(aiReview).values({
          id: randomUUID(),
          executionId: execution.id,
          businessId,
          accepted: input.accepted,
          note: input.note,
          actorId: actor.userId,
          at,
        });
      });
    },
    async current(actor: Actor, businessId: string) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        const active = await activation(tx);
        return active.profileId ? profileById(tx, active.profileId) : null;
      });
    },
    prepare(
      actor: Actor,
      businessId: string,
      input: {
        profileId?: string;
        kind: "preview" | "workflow";
        sample: AiSample;
        requestKey: string;
        expectedKnowledgeVersion?: number;
        context?: unknown;
      },
      at: Date,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        if (input.kind === "preview") await authorize(tx, actor, businessId);
        else
          await requireCapability(
            tx,
            actor,
            businessId,
            input.sample.task === "extraction"
              ? "profile.manage"
              : "sales.work",
          );
        await lockProfiles(tx);
        const selected = input.profileId ?? (await activation(tx)).profileId;
        if (!selected) throw new ApplicationError("AI_SETUP_REQUIRED");
        const profile = await profileById(tx, selected);
        const current = await knowledge(tx, businessId);
        if (
          !current ||
          (input.expectedKnowledgeVersion !== undefined &&
            current.version !== input.expectedKnowledgeVersion)
        )
          throw new ApplicationError("AI_SETUP_REQUIRED");
        const content = JSON.stringify({
          businessKnowledge: current.configuration,
          sample: input.sample,
          discoveryContext: input.context ?? null,
        });
        if (content.length > profile.profile.limits.maxInputChars)
          throw new ApplicationError("INVALID_INPUT");
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              profileId: profile.id,
              kind: input.kind,
              content,
            }),
          )
          .digest("hex");
        const [existing] = await tx
          .select()
          .from(aiExecution)
          .where(
            and(
              eq(aiExecution.businessId, businessId),
              eq(aiExecution.requestKey, input.requestKey),
            ),
          );
        if (existing) {
          if (
            existing.requestHash !== hash ||
            existing.actorId !== actor.userId
          )
            throw new ApplicationError("CONFLICT");
          return {
            execution: existing,
            profile,
            knowledge: current.configuration,
            fresh: false,
          };
        }
        const [execution] = await tx
          .insert(aiExecution)
          .values({
            id: randomUUID(),
            businessId,
            profileId: profile.id,
            requestKey: input.requestKey,
            requestHash: hash,
            task: input.sample.task,
            kind: input.kind,
            sample: input.sample,
            input: content,
            knowledgeVersion: current.version,
            actorId: actor.userId,
            at,
            status: "running",
          })
          .returning();
        return {
          execution,
          profile,
          knowledge: current.configuration,
          fresh: true,
        };
      });
    },
    reserve(
      actor: Actor,
      businessId: string,
      executionId: string,
      route: AiRoute,
      configuration: AiConfiguration,
      at: Date,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        await lockProfiles(tx);
        const [execution] = await tx
          .select()
          .from(aiExecution)
          .where(
            and(
              eq(aiExecution.id, executionId),
              eq(aiExecution.businessId, businessId),
            ),
          );
        if (!execution || execution.actorId !== actor.userId)
          throw new ApplicationError("NOT_FOUND");
        if (execution.kind === "preview")
          await authorize(tx, actor, businessId);
        else
          await requireCapability(
            tx,
            actor,
            businessId,
            execution.task === "extraction" ? "profile.manage" : "sales.work",
          );
        const profile = await profileById(tx, execution.profileId);
        if (
          execution.status !== "running" ||
          execution.knowledgeVersion !==
            (await knowledge(tx, businessId))?.version ||
          (execution.kind === "workflow" &&
            (await activation(tx)).profileId !== profile.id)
        )
          throw new ApplicationError("CONFLICT");
        const attempts = await tx
          .select()
          .from(aiAttempt)
          .where(eq(aiAttempt.executionId, executionId));
        const limits = profile.profile.limits;
        if (
          attempts.some((value) => value.outcome === "uncertain") ||
          attempts.length >= limits.maxAttempts ||
          profile.usedAttempts >= limits.allowanceAttempts ||
          (route === "gateway_system" &&
            (attempts.filter((value) => value.route === route).length >=
              limits.maxFallbackAttempts ||
              profile.usedFallbackAttempts >= limits.fallbackAllowanceAttempts))
        )
          throw new ApplicationError("AI_ALLOWANCE_EXHAUSTED");
        await tx
          .update(aiProfile)
          .set({
            usedAttempts: profile.usedAttempts + 1,
            usedFallbackAttempts:
              profile.usedFallbackAttempts + Number(route === "gateway_system"),
          })
          .where(eq(aiProfile.id, profile.id));
        const [attempt] = await tx
          .insert(aiAttempt)
          .values({
            id: randomUUID(),
            businessId,
            executionId,
            number: attempts.length + 1,
            route,
            outcome: "uncertain",
            metrics: unknownAiMetrics,
            at,
            fundingSource:
              route === "operator_byok"
                ? configuration.openaiFunding.source
                : "gateway_credits",
            fundingReference:
              route === "operator_byok"
                ? configuration.openaiFunding.reference
                : configuration.gatewayFunding.reference,
          })
          .returning();
        return attempt;
      });
    },
    finishAttempt(
      actor: Actor,
      businessId: string,
      id: string,
      outcome: "succeeded" | "failed" | "uncertain",
      failure: AiFailure | null,
      metrics: AiMetrics,
      latencyMs: number,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        await tx
          .update(aiAttempt)
          .set({ outcome, failure, metrics, latencyMs })
          .where(
            and(
              eq(aiAttempt.id, id),
              eq(aiAttempt.businessId, businessId),
              eq(aiAttempt.outcome, "uncertain"),
            ),
          );
      });
    },
    finish(
      actor: Actor,
      businessId: string,
      id: string,
      status: "succeeded" | "failed" | "uncertain" | "setup_required",
      output: AiOutput | null,
      failure: AiFailure | null,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        await tx
          .update(aiExecution)
          .set({ status, output, failure })
          .where(
            and(
              eq(aiExecution.id, id),
              eq(aiExecution.businessId, businessId),
              eq(aiExecution.status, "running"),
            ),
          );
      });
    },
    execution(actor: Actor, businessId: string, id: string) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "profile.read");
        const row = (await executions(tx, businessId)).find(
          (value) => value.id === id,
        );
        if (!row) throw new ApplicationError("NOT_FOUND");
        return row;
      });
    },
  };
}
