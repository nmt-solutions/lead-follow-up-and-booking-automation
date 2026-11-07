import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { businessFile, fileAccess, fileUsage } from "./schema";
import { requireBillingReviewer } from "./billing-access";
import type { BusinessRole } from "../models/team";

export type FileRecord = typeof businessFile.$inferSelect;
type FileChange = Partial<
  Pick<
    FileRecord,
    | "state"
    | "operationId"
    | "sha256"
    | "failure"
    | "cleanupAfter"
    | "completedAt"
  >
>;
async function getFile(tx: Transaction, id: string, lock?: "update") {
  const query = tx.select().from(businessFile).where(eq(businessFile.id, id));
  const [file] = await (lock ? query.for(lock) : query);
  if (!file) throw new ApplicationError("NOT_FOUND");
  return file;
}

export function createFileRepository(
  database: Database,
  options: { billingReview?: boolean } = {},
) {
  async function visibleFile(tx: Transaction, id: string, lock?: "update") {
    const file = await getFile(tx, id, lock);
    if (options.billingReview && file.purpose !== "billing")
      throw new ApplicationError("NOT_FOUND");
    return retainedFile(tx, file);
  }
  async function retainedFile(tx: Transaction, file: FileRecord) {
    const result = await tx.execute<{ until: string | null }>(
      sql`select public.business_file_retained_until(${file.id}::uuid,${file.businessId}::uuid)::text until`,
    );
    const until = result.rows[0]?.until;
    return until && new Date(until) > file.retentionUntil
      ? { ...file, retentionUntil: new Date(until) }
      : file;
  }
  function access<T>(
    actor: Actor,
    businessId: string,
    manage: boolean,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        let role: BusinessRole | null = null;
        if (options.billingReview) {
          if (manage) throw new ApplicationError("FORBIDDEN");
          await requireBillingReviewer(tx, actor);
        } else {
          role = await requireCapability(
            tx,
            actor,
            businessId,
            manage ? "files.manage" : "files.read",
          );
        }
        return operation(tx).then((data) => ({ data, role }));
      },
      { lock: true },
    );
  }
  return {
    async list(actor: Actor, businessId: string) {
      return access(actor, businessId, false, async (tx) => ({
        files: await Promise.all(
          (
            await tx
              .select()
              .from(businessFile)
              .where(
                options.billingReview
                  ? eq(businessFile.purpose, "billing")
                  : undefined,
              )
              .orderBy(businessFile.createdAt, businessFile.id)
          ).map((file) => retainedFile(tx, file)),
        ),
        usage: await tx
          .select()
          .from(fileUsage)
          .where(
            options.billingReview
              ? sql`exists (select 1 from public.business_file f where f.id = ${fileUsage.fileId} and f.business_id = ${fileUsage.businessId} and f.purpose = 'billing')`
              : undefined,
          ),
      }));
    },
    async create(actor: Actor, file: FileRecord) {
      await access(actor, file.businessId, true, async (tx) => {
        await tx.insert(businessFile).values(file);
      });
    },
    async read(actor: Actor, businessId: string, id: string) {
      return (
        await access(actor, businessId, false, (tx) => visibleFile(tx, id))
      ).data;
    },
    async change(
      actor: Actor,
      businessId: string,
      id: string,
      update: (file: FileRecord) => FileChange,
      usage?: { id: string; at: Date; action: "put" },
    ) {
      return (
        await access(actor, businessId, true, async (tx) => {
          // Cleanup claims rows without the Business advisory lock. Lock the
          // current row before validating a transition so neither can overwrite
          // the other's lease or lifecycle state.
          const previous = await visibleFile(tx, id, "update");
          const changes = update(previous);
          if (changes.state === "deleting") {
            const protectedFile = await tx.execute<{ protected: boolean }>(
              sql`select public.business_file_protected(${id}::uuid,${businessId}::uuid) protected`,
            );
            if (protectedFile.rows[0]?.protected)
              throw new ApplicationError("FORBIDDEN");
          }
          const [file] = await tx
            .update(businessFile)
            .set(changes)
            .where(eq(businessFile.id, id))
            .returning();
          if (usage)
            await tx.insert(fileUsage).values({
              ...usage,
              fileId: id,
              businessId,
              accountScope: previous.accountScope,
              outcome: "uncertain",
            });
          return file;
        })
      ).data;
    },
    async grant(
      actor: Actor,
      businessId: string,
      id: string,
      grant: { tokenHash: string; expiresAt: Date },
      check: (file: FileRecord) => void,
    ) {
      await access(actor, businessId, false, async (tx) => {
        check(await visibleFile(tx, id));
        await tx
          .insert(fileAccess)
          .values({ ...grant, fileId: id, businessId, actorId: actor.userId });
      });
    },
    async claimDownload(
      actor: Actor,
      businessId: string,
      id: string,
      tokenHash: string,
      at: Date,
      check: (file: FileRecord) => void,
    ) {
      return (
        await access(actor, businessId, false, async (tx) => {
          const file = await visibleFile(tx, id);
          check(file);
          const [grant] = await tx
            .select()
            .from(fileAccess)
            .where(
              and(
                eq(fileAccess.tokenHash, tokenHash),
                eq(fileAccess.fileId, id),
              ),
            );
          if (!grant || grant.expiresAt <= at)
            throw new ApplicationError("FILE_UNAVAILABLE");
          const operationId = randomUUID();
          await tx.insert(fileUsage).values({
            id: operationId,
            fileId: id,
            businessId,
            accountScope: file.accountScope,
            action: "get",
            at,
            outcome: "uncertain",
          });
          return { file, operationId, expiresAt: grant.expiresAt };
        })
      ).data;
    },
    async confirmUsage(actor: Actor, businessId: string, id: string) {
      await access(actor, businessId, false, async (tx) => {
        await tx
          .update(fileUsage)
          .set({ outcome: "succeeded" })
          .where(eq(fileUsage.id, id));
      });
    },
    // No user/Business identifiers are accepted from task payloads. These narrow
    // system functions select only persisted due cleanup work, with CAS leases.
    async claimCleanup(accountScope: string, at: Date, leaseSeconds: number) {
      const result = await database.execute<{
        id: string;
        business_id: string;
        operation_id: string;
      }>(
        sql`select * from public.claim_file_cleanup(${accountScope}, ${at.toISOString()}::timestamptz, ${leaseSeconds})`,
      );
      return result.rows;
    },
    async finishCleanup(
      id: string,
      operationId: string,
      at: Date,
      success: boolean,
    ) {
      await database.execute(
        sql`select public.finish_file_cleanup(${id}::uuid, ${operationId}::uuid, ${at.toISOString()}::timestamptz, ${success})`,
      );
    },
    async cleanupCurrent(
      id: string,
      operationId: string,
      accountScope: string,
    ) {
      const result = await database.execute<{ current: boolean }>(
        sql`select public.business_file_cleanup_current(${id}::uuid,${operationId}::uuid,${accountScope}) current`,
      );
      return result.rows[0]?.current === true;
    },
  };
}
export type FileRepository = ReturnType<typeof createFileRepository>;
