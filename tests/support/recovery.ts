import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { createHarness } from "./harness";
import { startPostgres } from "./postgres";
import {
  archiveHash,
  captureRecoveryArchive,
  restoreRecoveryArchive,
  createPostgresRecoveryAdapter,
  provisionRecoveryTarget,
  recoveryDigest,
  type RecoveryArchive,
  type RecoveryControlEvidence,
} from "../../src/recovery/postgres";
import {
  recoveryPlanSchema,
  type RecoveryPlan,
} from "../../src/models/infrastructure-recovery";
import { recoverySchemaBundle } from "../../src/recovery/bundle";
import {
  encodeRecoveryArchive,
  decodeRecoveryArchive,
} from "../../src/recovery/archive-store";
import { prepareDatabaseRole } from "../../src/db/setup";
import { createRecoveryApplication } from "../../src/application/infrastructure-recovery";
import { createRecoveryRepository } from "../../src/db/recovery-repository";
import { runtimeDatabase } from "../../src/db/runtime";

export const pgTool = (name: string) =>
  process.env.RECOVERY_TEST_PG_BIN
    ? join(
        process.env.RECOVERY_TEST_PG_BIN,
        `${name}${process.platform === "win32" ? ".exe" : ""}`,
      )
    : name;
export async function recoveryFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  owner: Headers,
  businessId: string,
  retainedFiles: { id: string; bytes: Buffer; retained: boolean }[] = [],
) {
  const target = await startPostgres({ initializeSchema: false });
  try {
    const actor = await h.authenticate(owner);
    await h.admin.query(
      "INSERT INTO platform_operator(user_id,recovery) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET recovery=true",
      [actor.userId],
    );
    const source = {
      project: "source-project",
      branch: "source-branch",
      database: "postgres",
      host: `127.0.0.1:${h.nativeEnvironment.PGPORT}`,
      bucket: "source-bucket",
      worker: "source-worker",
      auth: "source-auth",
      webhook: "source-webhook",
    };
    const destination = {
      project: "target-project",
      branch: "target-branch",
      database: "postgres",
      host: `127.0.0.1:${target.nativeEnvironment.PGPORT}`,
      bucket: "target-bucket",
      worker: "target-worker",
      auth: "target-auth",
      webhook: "target-webhook",
      disposable: true as const,
      environment: "recovery" as const,
    };
    const nativeSource = {
        admin: h.admin,
        runtime: h.runtime,
        environment: h.nativeEnvironment,
      },
      nativeTarget = {
        admin: target.admin,
        runtime: target.runtime,
        environment: target.nativeEnvironment,
      };
    const key = randomBytes(32),
      schemaHash = (await recoverySchemaBundle()).hash,
      seal = randomUUID();
    await provisionRecoveryTarget(target.admin, seal);
    const archive = await captureRecoveryArchive({
      source: nativeSource,
      sourceIdentity: source,
      businessId,
      schemaHash,
      id: `backup-${randomUUID()}`,
      key,
      pgDump: pgTool("pg_dump"),
      maxBytes: 100000000,
    });
    const future = new Date(Date.now() + 86400000).toISOString();
    const plan = recoveryPlanSchema.parse({
      id: randomUUID(),
      businessId,
      mode: "fixture",
      reviewedId: "review-58",
      reviewedBy: "fixture-reviewer",
      schemaHash,
      inventoryHash: recoveryDigest("fixture-reviewed-inventory"),
      appliedSchemaHash: archive.manifest.nativeSchemaHash,
      backupId: archive.manifest.id,
      backupHash: archiveHash(archive),
      source,
      target: destination,
      cutoff: archive.manifest.cutoff,
      retainUntil: future,
      observationExpiresAt: future,
      objectives: {
        rpoSeconds: 3600,
        rtoSeconds: 600,
        backupRetentionSeconds: 86400,
        fileRetentionSeconds: 86400,
        review: "fixture-only",
      },
      limits: {
        backupBytes: 100000000,
        fileBytes: 1000000,
        totalFileBytes: 10000000,
      },
      regions: {
        vercel: "iad1",
        neon: "aws-us-east-1",
        trigger: "us-east-1",
        r2: "us",
        r2Hint: "enam",
      },
      files: retainedFiles.map((f) => ({
        id: f.id,
        hash: recoveryDigest(f.bytes),
        bytes: f.bytes.length,
        retained: f.retained,
      })),
      costs: [
        {
          id: `neon-${archive.manifest.id}`,
          provider: "neon",
          kind: "backup",
          basis: "observed_requests",
          observedAt: archive.manifest.cutoff,
          freshUntil: future,
          retentionSeconds: 86400,
          status: "unpriced",
          currency: "USD",
          micros: null,
          quantity: archive.ciphertext.length,
          unit: "bytes",
          evidence: "fixture-actual-bytes",
        },
      ],
    });
    const controls = {
      observedSource: source,
      observedTarget: destination,
      expiresAt: future,
      archive: (await decodeRecoveryArchive(
        encodeRecoveryArchive(archive),
        100000000,
      )) as RecoveryArchive,
      failSchema: false,
      schemaRunner: null as null | (() => Promise<void>),
      failAfterRestore: false,
      restoreCalls: 0,
      evidence: {
        complete: false,
        observedAt: archive.manifest.cutoff,
        expiresAt: future,
        unresolved: ["Current control-plane authorization unavailable"],
        native: [],
      } as RecoveryControlEvidence,
      files: new Map(
        retainedFiles.filter((f) => f.retained).map((f) => [f.id, f.bytes]),
      ),
      targetFiles: new Map<string, Buffer>(),
      async onObserve() {},
      reconcile: null as
        null | ((plan: RecoveryPlan) => Promise<RecoveryControlEvidence>),
    };
    const adapter = () =>
      createPostgresRecoveryAdapter({
        source: nativeSource,
        target: nativeTarget,
        sourceIdentity: source,
        targetIdentity: destination,
        targetSeal: seal,
        pgRestore: pgTool("pg_restore"),
        key,
        restoreArchive: async (path) => {
          controls.restoreCalls++;
          await restoreRecoveryArchive(
            pgTool("pg_restore"),
            path,
            "postgres",
            nativeTarget.environment,
          );
          if (controls.failAfterRestore) {
            controls.failAfterRestore = false;
            throw Error("lost native restore acknowledgement");
          }
        },
        archive: async () => controls.archive,
        reviewedSchema: {
          hash: schemaHash,
          apply: async (pool) => {
            if (controls.failSchema)
              throw Error("isolated schema runner unavailable");
            if (controls.schemaRunner) await controls.schemaRunner();
            else await prepareDatabaseRole(pool);
          },
        },
        observeIdentities: async () => {
          await controls.onObserve();
          return {
            source: controls.observedSource,
            target: controls.observedTarget,
            expiresAt: controls.expiresAt,
          };
        },
        files: {
          readRetained: async (id) => controls.files.get(id) ?? null,
          writeTarget: async (id, bytes) => {
            controls.targetFiles.set(id, Buffer.from(bytes));
          },
          readTarget: async (id) => controls.targetFiles.get(id) ?? null,
        },
        reconcile: async (p) =>
          controls.reconcile ? controls.reconcile(p) : controls.evidence,
      });
    const application = (plans: RecoveryPlan[] = [plan]) =>
      createRecoveryApplication({
        authenticate: h.access.authenticateForWork,
        repository: createRecoveryRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        plans,
        adapter: adapter(),
      });
    return {
      target,
      plan,
      archive,
      controls,
      application,
      adapter,
      async request() {
        return application().request(owner, {
          planId: plan.id,
          requestKey: randomUUID(),
        });
      },
      async advance(id: string, count: number) {
        let result;
        for (let i = 0; i < count; i++)
          result = await application().run(owner, {
            businessId,
            operationId: id,
          });
        return result;
      },
      close: () => target.close(),
    };
  } catch (error) {
    await target.close();
    throw error;
  }
}
