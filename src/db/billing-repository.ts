import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { BillingRepository } from "../application/billing";
import { ApplicationError } from "../models/application-error";
import { billingState, declarationReviewNote } from "../models/billing";
import type { Database } from "./runtime";
import {
  billingProfileRevision,
  billingProfileReview,
  businessFile,
  user,
} from "./schema";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireBillingReviewer } from "./billing-access";

export async function readBillingWorkspace(
  tx: Transaction,
  businessId: string,
  at: Date,
) {
  const rows = await tx
    .select()
    .from(billingProfileRevision)
    .where(eq(billingProfileRevision.businessId, businessId))
    .orderBy(asc(billingProfileRevision.version));
  const reviews = await tx
    .select()
    .from(billingProfileReview)
    .where(eq(billingProfileReview.businessId, businessId))
    .orderBy(asc(billingProfileReview.version));
  const state = billingState(
    rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    reviews.map((row) => ({ ...row, at: row.at.toISOString() })),
  );
  for (const evidence of state.current?.evidence ?? []) {
    const [file] = await tx
      .select()
      .from(businessFile)
      .where(eq(businessFile.id, evidence.fileId));
    if (
      !file ||
      file.state !== "ready" ||
      file.retentionUntil <= at ||
      file.sha256 !== evidence.sha256
    ) {
      if (!state.issues.includes("evidence_unavailable"))
        state.issues.push("evidence_unavailable");
      if (state.status !== "conflicting") state.status = "missing";
    }
  }
  return state;
}
const read = readBillingWorkspace;
async function actorName(tx: Transaction, actorId: string) {
  const [identity] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, actorId));
  if (!identity) throw new ApplicationError("UNAUTHENTICATED");
  return identity.name;
}
export function createBillingRepository(database: Database): BillingRepository {
  return {
    confirm(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          const state = await read(tx, businessId, at);
          if (
            state.version !== input.expectedVersion ||
            state.reviewVersion !== input.expectedReviewVersion ||
            state.reviews.some((review) => review.outcome !== "reviewed")
          )
            throw new ApplicationError("CONFLICT");
          const profileId = randomUUID();
          const name = await actorName(tx, actor.userId);
          await tx.insert(billingProfileRevision).values({
            id: profileId,
            businessId,
            version: state.version + 1,
            profile: {
              ...input.profile,
              evidence: [],
              declaration: {
                version: "2026-11-10",
                actorId: actor.userId,
                at: at.toISOString(),
                acceptedTerms: true,
              },
            },
            evidence: [],
            actorId: actor.userId,
            actorName: name,
            at,
            note: declarationReviewNote,
          });
          await tx.insert(billingProfileReview).values({
            id: randomUUID(),
            businessId,
            profileId,
            profileVersion: state.version + 1,
            version: state.reviewVersion + 1,
            outcome: "reviewed",
            findings: [],
            note: declarationReviewNote,
            actorId: actor.userId,
            actorName: name,
            at,
          });
          return read(tx, businessId, at);
        },
        { lock: true },
      );
    },
    reviewQueue(actor, at) {
      return scoped(database, actor, "", async (tx) => {
        await requireBillingReviewer(tx, actor);
        const ids = await tx
          .selectDistinct({ businessId: billingProfileRevision.businessId })
          .from(billingProfileRevision)
          .orderBy(asc(billingProfileRevision.businessId));
        const queue = [];
        for (const { businessId } of ids) {
          await tx.execute(
            sql`select set_config('app.business_id', ${businessId}, true)`,
          );
          const workspace = await read(tx, businessId, at);
          if (workspace.status !== "reviewed")
            queue.push({ businessId, workspace, status: workspace.status });
        }
        return queue;
      });
    },
    reviewWorkspace(actor, businessId, at) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireBillingReviewer(tx, actor);
        const state = await read(tx, businessId, at);
        if (!state.current) throw new ApplicationError("NOT_FOUND");
        return state;
      });
    },
    review(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireBillingReviewer(tx, actor);
          const state = await read(tx, businessId, at);
          if (!state.current) throw new ApplicationError("NOT_FOUND");
          if (
            state.version !== input.expectedVersion ||
            state.reviewVersion !== input.expectedReviewVersion
          )
            throw new ApplicationError("CONFLICT");
          // Ignore prior review findings when checking whether a new review can resolve them.
          const intrinsic = billingState(state.history);
          if (
            input.outcome === "reviewed" &&
            (intrinsic.issues.length ||
              state.issues.includes("evidence_unavailable"))
          )
            throw new ApplicationError("CONFLICT");
          await tx.insert(billingProfileReview).values({
            id: randomUUID(),
            businessId,
            profileId: state.current.id,
            profileVersion: state.version,
            version: state.reviewVersion + 1,
            outcome: input.outcome,
            findings: input.findings,
            note: input.note,
            actorId: actor.userId,
            actorName: await actorName(tx, actor.userId),
            at,
          });
          return read(tx, businessId, at);
        },
        { lock: true },
      );
    },
    workspace(actor, businessId, at) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.read");
        return read(tx, businessId, at);
      });
    },
    save(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          const state = await read(tx, businessId, at);
          if (state.version !== input.expectedVersion)
            throw new ApplicationError("CONFLICT");
          const name = await actorName(tx, actor.userId);
          const evidence = [];
          for (const fileId of new Set(
            input.profile.evidence.map((entry) => entry.fileId),
          )) {
            const [file] = await tx
              .select()
              .from(businessFile)
              .where(eq(businessFile.id, fileId))
              .for("share");
            if (!file || file.businessId !== businessId)
              throw new ApplicationError("NOT_FOUND");
            if (
              file.purpose !== "billing" ||
              file.state !== "ready" ||
              !file.sha256 ||
              file.retentionUntil <= at
            )
              throw new ApplicationError("FILE_UNAVAILABLE");
            evidence.push({
              fileId,
              name: file.name,
              sha256: file.sha256,
              retentionUntil: file.retentionUntil.toISOString(),
            });
          }
          await tx.insert(billingProfileRevision).values({
            id: randomUUID(),
            businessId,
            version: state.version + 1,
            profile: input.profile,
            evidence,
            actorId: actor.userId,
            actorName: name,
            note: input.note,
            at,
          });
          return read(tx, businessId, at);
        },
        { lock: true },
      );
    },
  };
}
