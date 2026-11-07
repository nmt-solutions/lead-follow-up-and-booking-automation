import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { verifyRuntimeRole } from "../db/runtime";
import { secureDatabase } from "../db/setup";
import type {
  RecoveryAdapter,
  RecoveryPlan,
  RecoveryFacts,
  RecoveryEvidence,
} from "../models/infrastructure-recovery";

const run = promisify(execFile);
export const recoveryDigest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
const factSchema = z.array(
  z.object({ table: z.string(), id: z.string(), hash: z.string() }),
);
const manifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  cutoff: z.iso.datetime(),
  schemaHash: z.string(),
  nativeSchemaHash: z.string(),
  source: z.record(z.string(), z.string()),
  tables: z.array(
    z.object({ table: z.string(), count: z.string(), hash: z.string() }),
  ),
  facts: factSchema,
});
export type RecoveryManifest = z.infer<typeof manifestSchema>;
export const parseRecoveryManifest = (value: unknown) =>
  manifestSchema.parse(value);
export type RecoveryArchive = {
  manifest: RecoveryManifest;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};
export type NativeDatabase = {
  admin: Pool;
  runtime: Pool;
  environment: Record<string, string>;
};
const representative = [
  "business",
  "discovery_run",
  "discovery_dispatch",
  "discovery_prospect",
  "discovery_observation",
  "inbox_conversation",
  "inbox_message",
  "subscription_payment",
  "subscription_period",
  "seller_document",
  "financial_case",
  "financial_case_event",
  "financial_receipt",
  "opportunity_due_action",
  "email_sequence_action",
  "notification_notice",
  "notification_event",
  "business_data_request",
  "reach_change",
  "reach_change_event",
];
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
async function nativeSchemaHash(client: Pool | PoolClient) {
  const definitions = (
    await client.query<{
      kind: string;
      name: string;
      definition: string;
    }>(`SELECT 'constraint' AS kind,conrelid::regclass::text||'.'||conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace
    UNION ALL SELECT 'function',p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    UNION ALL SELECT 'column',c.table_name||'.'||c.column_name,c.data_type||coalesce(c.column_default,'')||c.is_nullable FROM information_schema.columns c WHERE c.table_schema='public' ORDER BY 1,2`)
  ).rows;
  return recoveryDigest(JSON.stringify(definitions));
}
async function inventory(client: Pool | PoolClient) {
  const tables = (
    await client.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
    )
  ).rows;
  const result = [];
  for (const { name } of tables) {
    const row = (
      await client.query<{ count: string; hash: string }>(
        `SELECT count(*)::text AS count,encode(sha256(convert_to(coalesce(string_agg(row_data,E'\n' ORDER BY row_data),''),'UTF8')),'hex') AS hash FROM (SELECT to_jsonb(r)::text AS row_data FROM public.${quoted(name)} r) rows`,
      )
    ).rows[0];
    result.push({ table: name, ...row });
  }
  return result;
}
async function facts(
  client: Pool | PoolClient,
  businessId: string,
): Promise<RecoveryFacts> {
  const available = new Set(
    (
      await client.query<{ name: string }>(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname='public'`,
      )
    ).rows.map((r) => r.name),
  );
  const result: RecoveryFacts = [];
  for (const table of representative) {
    if (!available.has(table)) continue;
    const columns = (
      await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [table],
      )
    ).rows.map((r) => r.column_name);
    const predicate =
      table === "business"
        ? "id=$1"
        : columns.includes("business_id")
          ? "business_id=$1"
          : table === "financial_receipt"
            ? "EXISTS(SELECT 1 FROM public.financial_case c WHERE c.business_id=$1 AND c.id::text=r.receipt->>'caseRef')"
            : null;
    if (!predicate || !columns.includes("id")) continue;
    result.push(
      ...(
        await client.query<{ id: string; hash: string }>(
          `SELECT id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM public.${quoted(table)} r WHERE ${predicate} ORDER BY id`,
          [businessId],
        )
      ).rows.map((r) => ({ table, ...r })),
    );
  }
  return result;
}
async function native(
  binary: string,
  args: string[],
  environment: Record<string, string>,
) {
  try {
    await run(binary, args, {
      env: { ...process.env, ...environment },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  }
}
export function restoreRecoveryArchive(
  binary: string,
  path: string,
  database: string,
  environment: Record<string, string>,
) {
  return native(
    binary,
    [
      "--no-owner",
      "--no-acl",
      "--single-transaction",
      `--dbname=${database}`,
      path,
    ],
    environment,
  );
}
export async function captureRecoveryArchive(d: {
  source: NativeDatabase;
  sourceIdentity: RecoveryPlan["source"];
  businessId: string;
  schemaHash: string;
  id: string;
  key: Buffer;
  pgDump: string;
}): Promise<RecoveryArchive> {
  if (d.key.length !== 32) throw new ApplicationError("SETUP_REQUIRED");
  const client = await d.source.admin.connect(),
    directory = await mkdtemp(join(tmpdir(), "recovery-backup-"));
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (
      await client.query<{ snapshot: string; cutoff: Date }>(
        "SELECT pg_export_snapshot() AS snapshot,transaction_timestamp() AS cutoff",
      )
    ).rows[0];
    const manifest: RecoveryManifest = {
      version: 1,
      id: d.id,
      cutoff: snapshot.cutoff.toISOString(),
      schemaHash: d.schemaHash,
      nativeSchemaHash: await nativeSchemaHash(client),
      source: d.sourceIdentity,
      tables: await inventory(client),
      facts: await facts(client, d.businessId),
    };
    const path = join(directory, "backup.dump");
    await native(
      d.pgDump,
      [
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-acl",
        `--snapshot=${snapshot.snapshot}`,
        `--file=${path}`,
      ],
      d.source.environment,
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", d.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(manifest)));
    const ciphertext = Buffer.concat([
      cipher.update(await readFile(path)),
      cipher.final(),
    ]);
    await client.query("COMMIT");
    return { manifest, ciphertext, iv, tag: cipher.getAuthTag() };
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await rm(directory, { recursive: true, force: true });
  }
}
export function archiveHash(archive: RecoveryArchive) {
  return recoveryDigest(
    Buffer.concat([
      Buffer.from(JSON.stringify(archive.manifest)),
      archive.iv,
      archive.tag,
      archive.ciphertext,
    ]),
  );
}
export type RecoveryControlEvidence = {
  complete: boolean;
  observedAt: string;
  expiresAt: string;
  unresolved: string[];
  native: NonNullable<RecoveryEvidence["native"]>;
};
export function createPostgresRecoveryAdapter(d: {
  source: NativeDatabase;
  target: NativeDatabase;
  sourceIdentity: RecoveryPlan["source"];
  targetIdentity: RecoveryPlan["target"];
  targetSeal: string;
  pgRestore: string;
  key: Buffer;
  archive(id: string): Promise<RecoveryArchive>;
  reviewedSchema: { hash: string; apply(target: Pool): Promise<void> };
  observeIdentities(): Promise<{
    source: RecoveryPlan["source"];
    target: RecoveryPlan["target"];
    expiresAt: string;
  }>;
  files: {
    readRetained(id: string): Promise<Buffer | null>;
    writeTarget(id: string, bytes: Buffer): Promise<void>;
    readTarget(id: string): Promise<Buffer | null>;
  };
  reconcile(plan: RecoveryPlan): Promise<RecoveryControlEvidence>;
  restoreArchive?(path: string): Promise<void>;
}): RecoveryAdapter {
  async function check(plan: RecoveryPlan) {
    const observation = await d.observeIdentities();
    const now = (
      await d.source.admin.query<{ at: Date }>(
        "SELECT statement_timestamp() AS at",
      )
    ).rows[0].at;
    if (
      JSON.stringify(observation.source) !== JSON.stringify(plan.source) ||
      JSON.stringify(observation.target) !== JSON.stringify(plan.target) ||
      new Date(observation.expiresAt) <= now ||
      new Date(plan.observationExpiresAt) <= now ||
      d.reviewedSchema.hash !== plan.schemaHash
    )
      throw new ApplicationError("SETUP_REQUIRED");
    if (
      JSON.stringify(d.sourceIdentity) !== JSON.stringify(plan.source) ||
      JSON.stringify(d.targetIdentity) !== JSON.stringify(plan.target) ||
      !plan.target.disposable ||
      plan.target.environment !== "recovery"
    )
      throw new ApplicationError("FORBIDDEN");
    for (const k of [
      "project",
      "branch",
      "host",
      "bucket",
      "worker",
      "auth",
      "webhook",
    ] as const)
      if (plan.source[k] === plan.target[k])
        throw new ApplicationError("FORBIDDEN");
    for (const database of [d.source, d.target]) {
      const configured = database.admin.options.connectionString
        ? new URL(database.admin.options.connectionString)
        : null;
      const host = configured?.hostname ?? database.admin.options.host,
        port = configured?.port || database.admin.options.port || 5432,
        name = configured
          ? decodeURIComponent(configured.pathname.slice(1))
          : database.admin.options.database;
      if (
        host !== database.environment.PGHOST ||
        String(port) !== database.environment.PGPORT ||
        name !== database.environment.PGDATABASE
      )
        throw new ApplicationError("FORBIDDEN");
    }
    for (const [database, identity] of [
      [d.source, plan.source],
      [d.target, plan.target],
    ] as const) {
      const actual = database.environment.PGHOST?.endsWith(".neon.tech")
        ? database.environment.PGHOST
        : `${database.environment.PGHOST}:${database.environment.PGPORT}`;
      if (actual !== identity.host) throw new ApplicationError("FORBIDDEN");
    }
    const source = (
      await d.source.admin.query<{
        database: string;
        address: string;
        port: number;
      }>(
        "SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port",
      )
    ).rows[0];
    const target = (
      await d.target.admin.query<{
        database: string;
        address: string;
        port: number;
      }>(
        "SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port",
      )
    ).rows[0];
    if (
      source.database !== plan.source.database ||
      target.database !== plan.target.database ||
      JSON.stringify(source) === JSON.stringify(target)
    )
      throw new ApplicationError("FORBIDDEN");
    const seal = (
      await d.target.admin.query<{ seal: string; environment: string }>(
        "SELECT seal,environment FROM recovery_quarantine.target WHERE singleton",
      )
    ).rows[0];
    if (seal?.seal !== d.targetSeal || seal.environment !== "recovery")
      throw new ApplicationError("FORBIDDEN");
    return recoveryDigest(JSON.stringify({ target, identity: plan.target }));
  }
  async function artifact(plan: RecoveryPlan) {
    const a = await d.archive(plan.backupId),
      m = manifestSchema.parse(a.manifest);
    if (
      a.ciphertext.length > plan.limits.backupBytes ||
      archiveHash(a) !== plan.backupHash ||
      m.id !== plan.backupId ||
      m.schemaHash !== plan.schemaHash ||
      m.cutoff !== plan.cutoff ||
      JSON.stringify(m.source) !== JSON.stringify(plan.source)
    )
      throw new ApplicationError("CONFLICT");
    return a;
  }
  async function targetState(id: string) {
    return (
      await d.target.admin.query<{
        operation_id: string | null;
        restored: boolean;
      }>(
        "SELECT operation_id,restored FROM recovery_quarantine.target WHERE singleton",
      )
    ).rows[0];
  }
  async function verify(plan: RecoveryPlan) {
    const a = await artifact(plan);
    // The source recovery journal advances AFTER the snapshot; compare against the frozen archive, not today's source.
    const found = await inventory(d.target.admin);
    if (
      JSON.stringify(found) !== JSON.stringify(a.manifest.tables) ||
      (await nativeSchemaHash(d.target.admin)) !== a.manifest.nativeSchemaHash
    )
      throw new ApplicationError("CONFLICT");
    return a;
  }
  async function secureInspection(plan: RecoveryPlan, id: string) {
    // Fixed, source-owned projection. Original private rows and all source credentials stay inaccessible to this function.
    const a = await artifact(plan),
      available = new Set(a.manifest.tables.map((t) => t.table));
    const selects = [];
    for (const table of representative) {
      if (!available.has(table)) continue;
      const columns = (
        await d.target.admin.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
          [table],
        )
      ).rows.map((r) => r.column_name);
      const column =
        table === "business"
          ? "id"
          : columns.includes("business_id")
            ? "business_id"
            : table === "financial_receipt"
              ? "receipt_case"
              : null;
      if (column && columns.includes("id"))
        selects.push(
          `SELECT '${table}'::text AS "table",id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash,jsonb_build_object('name',to_jsonb(r)->'name','offering',to_jsonb(r)->'offering','subject',to_jsonb(r)->'subject','text',CASE WHEN '${table}'='inbox_message' THEN to_jsonb(r)->'text' ELSE NULL END,'kind',to_jsonb(r)->'kind','status',to_jsonb(r)->'status','phase',to_jsonb(r)->'phase','paymentId',to_jsonb(r)->'payment_id','invoiceId',to_jsonb(r)->'invoice_id','periodId',to_jsonb(r)->'period_id') AS value FROM public.${quoted(table)} r WHERE ${column === "receipt_case" ? "EXISTS(SELECT 1 FROM public.financial_case c WHERE c.id::text=r.receipt->>'caseRef' AND c.business_id=(SELECT business_id FROM recovery_quarantine.target WHERE singleton AND operation_id=op))" : `${column}=(SELECT business_id FROM recovery_quarantine.target WHERE singleton AND operation_id=op)`}`,
        );
    }
    await d.target.admin
      .query(`CREATE OR REPLACE FUNCTION recovery_quarantine.records(op uuid) RETURNS TABLE("table" text,id text,hash text,value jsonb) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ ${selects.join(" UNION ALL ")} $$;
      REVOKE ALL ON FUNCTION recovery_quarantine.records(uuid) FROM PUBLIC; GRANT USAGE ON SCHEMA recovery_quarantine TO app_runtime; GRANT EXECUTE ON FUNCTION recovery_quarantine.records(uuid) TO app_runtime;`);
    await d.target.admin.query(
      "UPDATE recovery_quarantine.target SET business_id=$1,operation_id=$2 WHERE singleton",
      [plan.businessId, id],
    );
    const safety=await d.target.runtime.query<{safe:boolean}>(`SELECT current_setting('transaction_read_only')='on' AND NOT has_table_privilege(current_user,'recovery_quarantine.target','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='recovery_quarantine.records(uuid)'::regprocedure AND p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) AS safe`);
    if(safety.rows[0]?.safe!==true)throw new ApplicationError("SETUP_REQUIRED");
    const result = await d.target.runtime.query(
      "SELECT * FROM recovery_quarantine.records($1) ORDER BY 1,2",
      [id],
    );
    const observed = factSchema.parse(result.rows),
      expected = [...a.manifest.facts].sort(
        (x, y) => x.table.localeCompare(y.table) || x.id.localeCompare(y.id),
      );
    const canonical = (v: RecoveryFacts) =>
      JSON.stringify(
        [...v].sort(
          (x, y) => x.table.localeCompare(y.table) || x.id.localeCompare(y.id),
        ),
      );
    if (canonical(observed) !== canonical(expected))
      throw new ApplicationError("CONFLICT");
    return {
      facts: observed,
      records: z
        .array(
          z.object({
            table: z.string(),
            id: z.string(),
            value: z.record(z.string(), z.unknown()),
          }),
        )
        .parse(result.rows),
    };
  }
  return {
    async advance(plan, id, stage, authorize) {
      await authorize();
      const physicalTarget = await check(plan);
      await artifact(plan);
      await authorize();
      const state = await targetState(id);
      if (state.operation_id && state.operation_id !== id)
        throw new ApplicationError("CONFLICT");
      if (stage === "target_verified") {
        const tables = (
          await d.target.admin.query<{ count: string }>(
            "SELECT count(*)::text FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].count;
        if (tables !== "0" && !state.restored)
          throw new ApplicationError("CONFLICT");
        await d.target.admin.query(
          "UPDATE recovery_quarantine.target SET operation_id=$1,business_id=$2 WHERE singleton",
          [id, plan.businessId],
        );
        return { physicalTarget };
      }
      if (stage === "restored") {
        if (!state.restored) {
          // A prior uncertain commit is reconciled by exact complete inventory before any attempted restore.
          const tables = (
            await d.target.admin.query<{ count: string }>(
              "SELECT count(*)::text FROM pg_tables WHERE schemaname='public'",
            )
          ).rows[0].count;
          if (tables !== "0") await verify(plan);
          else {
            const a = await artifact(plan),
              decipher = createDecipheriv("aes-256-gcm", d.key, a.iv);
            decipher.setAAD(Buffer.from(JSON.stringify(a.manifest)));
            decipher.setAuthTag(a.tag);
            const bytes = Buffer.concat([
                decipher.update(a.ciphertext),
                decipher.final(),
              ]),
              directory = await mkdtemp(join(tmpdir(), "recovery-restore-"));
            try {
              const path = join(directory, "backup.dump");
              await writeFile(path, bytes, { mode: 0o600 });
              await authorize();
              await check(plan);
              if (d.restoreArchive) await d.restoreArchive(path);
              else
                await restoreRecoveryArchive(
                  d.pgRestore,
                  path,
                  plan.target.database,
                  d.target.environment,
                );
            } finally {
              await rm(directory, { recursive: true, force: true });
            }
            await verify(plan);
          }
          await d.target.admin.query(
            "UPDATE recovery_quarantine.target SET restored=true WHERE singleton",
          );
        }
        return { physicalTarget };
      }
      if (stage === "secured") {
        await verify(plan);
        await authorize();
        await d.reviewedSchema.apply(d.target.admin);
        await secureDatabase(d.target.admin, { allowQuarantined: true });
        await verifyRuntimeRole(d.target.runtime, { allowQuarantined: true });
        // Authentication keys, callbacks and workers are never copied into target configuration. All runtime writes are additionally fenced in PostgreSQL.
        await d.target.admin.query(
          "ALTER ROLE app_runtime SET default_transaction_read_only=on",
        );
        return { security: "restricted-verified", physicalTarget };
      }
      if (stage === "verified") {
        await verify(plan);
        await verifyRuntimeRole(d.target.runtime, { allowQuarantined: true });
        return {
          facts: (await secureInspection(plan, id)).facts,
          physicalTarget,
          security: "restricted-verified",
        };
      }
      if (stage === "quarantined") {
        const files: NonNullable<RecoveryEvidence["files"]> = [];
        if (
          plan.files.reduce((total, f) => total + f.bytes, 0) >
            plan.limits.totalFileBytes ||
          plan.files.some((f) => f.bytes > plan.limits.fileBytes)
        )
          throw new ApplicationError("SETUP_REQUIRED");
        for (const file of plan.files) {
          await authorize();
          await check(plan);
          const bytes = file.retained
            ? await d.files.readRetained(file.id)
            : null;
          if (!bytes) {
            files.push({
              id: file.id,
              hash: file.hash,
              bytes: file.bytes,
              status: "omitted",
            });
            continue;
          }
          if (
            bytes.length !== file.bytes ||
            recoveryDigest(bytes) !== file.hash
          )
            throw new ApplicationError("CONFLICT");
          const prior = await d.files.readTarget(file.id);
          if (prior && recoveryDigest(prior) !== file.hash)
            throw new ApplicationError("CONFLICT");
          if (!prior) {
            await authorize();
            await d.files.writeTarget(file.id, bytes);
          }
          const actual = await d.files.readTarget(file.id);
          if (!actual || recoveryDigest(actual) !== file.hash)
            throw new ApplicationError("CONFLICT");
          files.push({
            id: file.id,
            hash: file.hash,
            bytes: file.bytes,
            status: "restored",
          });
        }
        return {
          files,
          unresolved: [
            "Fresh target authorization and native outcome reconciliation required; external effects remain disabled.",
          ],
        };
      }
      if (stage === "reconciled") {
        const evidence = await d.reconcile(plan),
          now = (
            await d.source.admin.query<{ at: Date }>(
              "SELECT statement_timestamp() AS at",
            )
          ).rows[0].at;
        const parsed = z
          .object({
            complete: z.boolean(),
            observedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
            unresolved: z.array(z.string().max(300)).max(1000),
            native: z
              .array(
                z.object({
                  source: z.string().regex(/^[a-z_]{1,60}$/),
                  id: z.string().regex(/^[a-zA-Z0-9_:-]{1,150}$/),
                  nativeId: z
                    .string()
                    .regex(/^[a-zA-Z0-9_:-]{1,150}$/)
                    .nullable(),
                  outcome: z.enum(["accepted", "unknown", "stopped"]),
                  amountMinor: z.string().regex(/^\d+$/).nullable(),
                  currency: z.enum(["INR", "USD"]).nullable(),
                }),
              )
              .max(10000),
          })
          .parse(evidence);
        if (
          new Date(parsed.observedAt) > now ||
          new Date(parsed.expiresAt) <= now
        )
          throw new ApplicationError("SETUP_REQUIRED");
        // Reconciliation records facts only; no provider mutation or fresh idempotency key is issued.
        await d.target.admin.query(
          "UPDATE recovery_quarantine.target SET reconciliation=$1::jsonb WHERE singleton",
          [JSON.stringify(parsed)],
        );
        return {
          native: parsed.native,
          unresolved: parsed.complete
            ? parsed.unresolved
            : [
                ...parsed.unresolved,
                "Current control plane is unavailable; retain private quarantine.",
              ],
        };
      }
      if (stage === "inspection_ready") {
        await verifyRuntimeRole(d.target.runtime, { allowQuarantined: true });
        return {
          facts: (await secureInspection(plan, id)).facts,
          unresolved: [
            "Inspection only. Production activation requires fresh identities, memberships, grants, sender approvals and domain-specific reconciliation; restored queues remain disabled.",
          ],
        };
      }
      throw new ApplicationError("INVALID_INPUT");
    },
    async inspect(plan, id) {
      await check(plan);
      const inspection = await secureInspection(plan, id),
        f = inspection.facts;
      const business = f.find(
        (r) => r.table === "business" && r.id === plan.businessId,
      );
      if (!business) throw new ApplicationError("NOT_FOUND");
      return {
        business: {
          id: business.id,
          name: z
            .string()
            .parse(
              inspection.records.find(
                (r) => r.table === "business" && r.id === plan.businessId,
              )?.value.name,
            ),
        },
        facts: f,
        records: inspection.records,
        quarantined: true,
      };
    },
  };
}

// Run only through trusted owner provisioning on an expressly disposable, empty, isolated target.
export async function provisionRecoveryTarget(pool: Pool, seal: string) {
  const tables = (
    await pool.query<{ count: string }>(
      "SELECT count(*)::text FROM pg_tables WHERE schemaname='public'",
    )
  ).rows[0].count;
  if (tables !== "0") throw new ApplicationError("CONFLICT");
  await pool.query("DROP SCHEMA public");
  await pool.query(
    "ALTER ROLE app_runtime SET default_transaction_read_only=on",
  );
  await pool.query(`CREATE SCHEMA recovery_quarantine; REVOKE ALL ON SCHEMA recovery_quarantine FROM PUBLIC;
    CREATE TABLE recovery_quarantine.target(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),seal text NOT NULL,environment text NOT NULL CHECK(environment='recovery'),operation_id uuid,business_id uuid,restored boolean NOT NULL DEFAULT false,reconciliation jsonb);
    REVOKE ALL ON recovery_quarantine.target FROM PUBLIC;`);
  await pool.query(
    "INSERT INTO recovery_quarantine.target(seal,environment) VALUES($1,'recovery')",
    [seal],
  );
}
