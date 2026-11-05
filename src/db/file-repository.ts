import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { businessFile, fileAccess, fileUsage } from "./schema";

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

export function createFileRepository(database: Database) {
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
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          manage ? "files.manage" : "files.read",
        );
        return operation(tx).then((data) => ({ data, role }));
      },
      { lock: true },
    );
  }
  return {
    async list(actor: Actor, businessId: string) {
      return access(actor, businessId, false, async (tx) => ({
        files: await tx
          .select()
          .from(businessFile)
          .orderBy(businessFile.createdAt, businessFile.id),
        usage: await tx.select().from(fileUsage),
      }));
    },
    async create(actor: Actor, file: FileRecord) {
      await access(actor, file.businessId, true, async (tx) => {
        await tx.insert(businessFile).values(file);
      });
    },
    async read(actor: Actor, businessId: string, id: string) {
      return (await access(actor, businessId, false, (tx) => getFile(tx, id)))
        .data;
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
          const previous = await getFile(tx, id, "update");
          const changes = update(previous);
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
        check(await getFile(tx, id));
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
          const file = await getFile(tx, id);
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
  };
}
export type FileRepository = ReturnType<typeof createFileRepository>;
