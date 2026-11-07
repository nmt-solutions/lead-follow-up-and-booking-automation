import { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { RecoveryPlan } from "../models/infrastructure-recovery";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { prepareDatabaseRole } from "../db/setup";
import { createRecoveryRepository } from "../db/recovery-repository";
import { createFinancialAdjustmentRepository } from "../db/financial-adjustment-repository";
import { createFinancialAdjustmentApplication } from "../application/financial-adjustments";
import { configuredFinancialAdjustments } from "../financial-adjustments/configuration";
import { createR2Storage } from "../storage/r2";
import {
  configuredRecoveryInventories,
  observeRecoveryIdentities,
} from "./configuration";
import { createPostgresRecoveryAdapter, type NativeDatabase } from "./postgres";
import { readRecoveryArchive } from "./archive-store";
import { requireRecoveryBundle } from "./bundle";
import { createRecoveryReconciler } from "./reconciliation";

const run = promisify(execFile);
const required = (env: Record<string, string | undefined>, key: string) => {
  const value = env[key];
  if (!value) throw new ApplicationError("SETUP_REQUIRED");
  return value;
};
export function recoveryDatabase(
  adminValue: string,
  runtimeValue: string,
): NativeDatabase {
  try {
    const admin = new URL(databaseConnectionUrl(adminValue)),
      runtime = new URL(databaseConnectionUrl(runtimeValue));
    if (
      !admin.hostname.endsWith(".neon.tech") ||
      admin.hostname.includes("-pooler.") ||
      !runtime.hostname.includes("-pooler.") ||
      runtime.hostname.replace("-pooler.", ".") !== admin.hostname ||
      runtime.pathname !== admin.pathname ||
      decodeURIComponent(runtime.username) !== "app_runtime" ||
      decodeURIComponent(admin.username) === "app_runtime"
    )
      throw Error();
    const make = (url: URL) => {
      const p = new Pool({
        connectionString: url.toString(),
        max: 2,
        connectionTimeoutMillis: 10000,
        statement_timeout: 120000,
      });
      p.on("error", () => {});
      return p;
    };
    return {
      admin: make(admin),
      runtime: make(runtime),
      environment: {
        PGHOST: admin.hostname,
        PGPORT: admin.port || "5432",
        PGDATABASE: decodeURIComponent(admin.pathname.slice(1)),
        PGUSER: decodeURIComponent(admin.username),
        PGPASSWORD: decodeURIComponent(admin.password),
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "system",
      },
    };
  } catch {
    throw new ApplicationError("SETUP_REQUIRED");
  }
}
export async function configuredRecoveryNative(
  env: Record<string, string | undefined>,
  plan: RecoveryPlan,
  identity: WorkIdentity,
) {
  if (plan.mode !== "configured") throw new ApplicationError("SETUP_REQUIRED");
  await requireRecoveryBundle(plan.schemaHash);
  const inventory = configuredRecoveryInventories(env).find(
    (i) => i.planId === plan.id,
  );
  if (!inventory) throw new ApplicationError("SETUP_REQUIRED");
  const source = recoveryDatabase(
      required(env, "RECOVERY_SOURCE_ADMIN_URL"),
      required(env, "DATABASE_URL"),
    ),
    target = recoveryDatabase(
      required(env, "RECOVERY_TARGET_ADMIN_URL"),
      required(env, "RECOVERY_TARGET_RUNTIME_URL"),
    );
  async function close() {
    await Promise.allSettled([
      source.admin.end(),
      source.runtime.end(),
      target.admin.end(),
      target.runtime.end(),
    ]);
  }
  try {
    await verifyRuntimeRole(source.runtime);
    const repository = createRecoveryRepository(
      runtimeDatabase(source.runtime),
      { now: () => new Date() },
    );
    await repository.authorize(identity, plan.businessId);
    const observe = () =>
      observeRecoveryIdentities({
        plan,
        inventory,
        token: required(env, "RECOVERY_NEON_READ_TOKEN"),
        fetch,
        now: () => new Date(),
      });
    await observe();
    const key = Buffer.from(required(env, "RECOVERY_BACKUP_KEY"), "base64");
    if (key.length !== 32) throw new ApplicationError("SETUP_REQUIRED");
    const objectSchema = z
      .array(
        z.strictObject({
          id: z.string(),
          key: z.string().min(1).max(1024),
          contentType: z.string().min(1),
          metadata: z.strictObject({
            businessId: z.uuid(),
            fileId: z.uuid(),
            ownerId: z.string().min(1),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        }),
      )
      .max(10000);
    const objects = objectSchema.parse(
      JSON.parse(env.RECOVERY_RETAINED_OBJECTS ?? "[]"),
    );
    const storage = (bucket: string, prefix: string) =>
      createR2Storage({
        accountId: inventory.storage.account,
        bucket,
        accessKeyId: required(env, `${prefix}_ACCESS_KEY_ID`),
        secretAccessKey: required(env, `${prefix}_SECRET_ACCESS_KEY`),
        timeoutSeconds: 30,
      });
    const backupStorage = storage(
        inventory.storage.backupBucket,
        "RECOVERY_RETAINED_R2",
      ),
      targetStorage = storage(
        inventory.storage.targetBucket,
        "RECOVERY_TARGET_R2",
      );
    const object = (id: string) => {
      const f = plan.files.find((f) => f.id === id),
        m = objects.find((o) => o.id === id);
      if (
        !f ||
        !m ||
        m.metadata.businessId !== plan.businessId ||
        m.metadata.sha256 !== f.hash
      )
        throw new ApplicationError("SETUP_REQUIRED");
      return { f, m };
    };
    const financial = createFinancialAdjustmentApplication({
      authenticate: async () => identity,
      authenticatePlatform: async () => {
        await repository.authorize(identity, plan.businessId);
        return identity;
      },
      repository: createFinancialAdjustmentRepository(
        runtimeDatabase(source.runtime),
      ),
      clock: { now: () => new Date() },
      gateway: configuredFinancialAdjustments({ env }),
      documents: null,
    });
    const directTarget = required(env, "RECOVERY_TARGET_ADMIN_URL");
    return {
      source,
      target,
      close,
      observe,
      adapter: createPostgresRecoveryAdapter({
        source,
        target,
        sourceIdentity: plan.source,
        targetIdentity: plan.target,
        targetSeal: required(env, "RECOVERY_TARGET_SEAL"),
        pgRestore: required(env, "RECOVERY_PG_RESTORE"),
        key,
        archive: (id) =>
          readRecoveryArchive(
            required(env, "RECOVERY_ARCHIVE_DIRECTORY"),
            id,
            plan.limits.backupBytes,
          ),
        reviewedSchema: {
          hash: plan.schemaHash,
          async apply(pool) {
            await requireRecoveryBundle(plan.schemaHash);
            await observe();
            await prepareDatabaseRole(pool);
            const cli = join(
              dirname(
                createRequire(import.meta.url).resolve("drizzle-kit/api"),
              ),
              "bin.cjs",
            );
            try {
              const result = await run(process.execPath, [cli, "push"], {
                env: { ...process.env, DATABASE_ADMIN_URL: directTarget },
                windowsHide: true,
                timeout: 120000,
                maxBuffer: 4_000_000,
              });
              if (
                /^(?:error|Error):/m.test(
                  `${result.stdout}\n${result.stderr}`,
                ) ||
                !/(Changes applied|No changes detected)/.test(result.stdout)
              )
                throw Error();
            } catch {
              throw new ApplicationError("PROVIDER_UNAVAILABLE");
            }
            await requireRecoveryBundle(plan.schemaHash);
          },
        },
        observeIdentities: observe,
        files: {
          async readRetained(id) {
            const { f, m } = object(id);
            try {
              return Buffer.from(
                (await backupStorage.get(m.key, f.bytes)).bytes,
              );
            } catch {
              return null;
            }
          },
          async readTarget(id) {
            const { f, m } = object(id);
            try {
              return Buffer.from(
                (await targetStorage.get(m.key, f.bytes)).bytes,
              );
            } catch {
              return null;
            }
          },
          async writeTarget(id, bytes) {
            const { m } = object(id);
            await targetStorage.put(m.key, {
              bytes,
              metadata: m.metadata,
              contentType: m.contentType,
            });
          },
        },
        reconcile: createRecoveryReconciler({
          financial,
          credentials: undefined,
          now: () => new Date(),
          freshSeconds: 60,
        }),
      }),
    };
  } catch (error) {
    await close();
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("SETUP_REQUIRED");
  }
}
