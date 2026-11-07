import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { escapeLiteral, type Pool, type PoolClient } from "pg";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { RecoveryIncurredError } from "../models/infrastructure-recovery";
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
  postgresMajor: z.number().int().min(14).max(99),
  snapshot: z.object({
    id: z.string(),
    transaction: z.string(),
    walLsn: z.string(),
  }),
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
  "business_file",
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
    UNION ALL SELECT 'column',c.relname||'.'||a.attname,concat_ws('|',format_type(a.atttypid,a.atttypmod),pg_get_expr(d.adbin,d.adrelid),a.attnotnull::text,a.attidentity,a.attgenerated,co.collname) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
    UNION ALL SELECT 'relation',c.relname,concat_ws('|',c.relkind,c.relpersistence,c.relrowsecurity::text,c.relforcerowsecurity::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
    UNION ALL SELECT 'index',c.relname,pg_get_indexdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='i'
    UNION ALL SELECT 'policy',p.polrelid::regclass::text||'.'||p.polname,concat_ws('|',p.polcmd,p.polpermissive::text,(SELECT string_agg(CASE WHEN role_id=0 THEN 'public' ELSE pg_get_userbyid(role_id) END,',' ORDER BY role_id) FROM unnest(p.polroles) role_id),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace
    UNION ALL SELECT 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,t.tgenabled::text||pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal
    ORDER BY 1,2`)
  ).rows;
  return recoveryDigest(JSON.stringify(definitions));
}
export const recoverySchemaDefinitionHash = nativeSchemaHash;
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
  expectedHash?: string,
) {
  if (expectedHash) {
    try {
      if (recoveryDigest(await readFile(binary)) !== expectedHash)
        throw Error();
    } catch {
      throw new ApplicationError("SETUP_REQUIRED");
    }
  }
  try {
    const result = await run(binary, args, {
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        Path: process.env.Path,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        ...environment,
      },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch {
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  }
}
export async function verifyRecoveryTool(
  binary: string,
  kind: "pg_dump" | "pg_restore" | "psql",
  database: NativeDatabase,
  expectedHash?: string,
) {
  const output = await native(
      binary,
      ["--version"],
      database.environment,
      expectedHash,
    ),
    version = new RegExp(`^${kind} \\(PostgreSQL\\) (\\d+)\\.`).exec(
      output.trim(),
    ),
    server = (
      await database.admin.query<{ version: string; encoding: string }>(
        "SELECT current_setting('server_version_num') AS version,current_setting('server_encoding') AS encoding",
      )
    ).rows[0],
    major = Math.floor(Number(server.version) / 10000);
  if (!version || Number(version[1]) !== major || server.encoding !== "UTF8")
    throw new ApplicationError("SETUP_REQUIRED");
  return major;
}
type RestoreGuard = { seal: string; operationId: string; businessId: string };
export async function restoreRecoveryArchive(
  binary: string,
  path: string,
  database: string,
  environment: Record<string, string>,
  tools: {
    psql: string;
    restoreSqlBytes: number;
    pgRestoreHash?: string;
    psqlHash?: string;
    authorize: () => Promise<void>;
    guard: RestoreGuard;
  },
) {
  const directory = await mkdtemp(join(tmpdir(), "recovery-native-sql-"));
  try {
    const sqlPath = join(directory, "restore.sql"),
      guardPath = join(directory, "guard.sql");
    // Native file output preserves original SQL-body line endings on Windows.
    await writeFile(sqlPath, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    await native(
      binary,
      ["--no-owner", "--no-acl", `--file=${sqlPath}`, path],
      environment,
      tools.pgRestoreHash,
    );
    if ((await stat(sqlPath)).size > tools.restoreSqlBytes)
      throw new ApplicationError("SETUP_REQUIRED");
    await writeFile(
      guardPath,
      `SELECT 1/((pg_try_advisory_xact_lock(hashtextextended('infrastructure-recovery-native',0)) AND current_database()=${escapeLiteral(database)} AND EXISTS(SELECT 1 FROM recovery_quarantine.target WHERE singleton AND environment='recovery' AND seal=${escapeLiteral(tools.guard.seal)} AND operation_id=${escapeLiteral(tools.guard.operationId)}::uuid AND business_id=${escapeLiteral(tools.guard.businessId)}::uuid AND NOT restored))::integer);`,
      { mode: 0o600, flag: "wx" },
    );
    // This lock belongs to the SAME native backend transaction as every restore
    // statement. It survives loss of the worker's separate admin connection.
    await tools.authorize();
    await native(
      tools.psql,
      [
        "--no-psqlrc",
        "--quiet",
        "--set=ON_ERROR_STOP=on",
        "--single-transaction",
        `--dbname=${database}`,
        `--file=${guardPath}`,
        `--file=${sqlPath}`,
      ],
      environment,
      tools.psqlHash,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function captureRecoveryArchive(d: {
  source: NativeDatabase;
  sourceIdentity: RecoveryPlan["source"];
  businessId: string;
  schemaHash: string;
  id: string;
  key: Buffer;
  pgDump: string;
  pgDumpHash?: string;
  maxBytes: number;
}): Promise<RecoveryArchive> {
  if (d.key.length !== 32) throw new ApplicationError("SETUP_REQUIRED");
  const configured = d.source.admin.options.connectionString
    ? new URL(d.source.admin.options.connectionString)
    : null;
  const host = configured?.hostname ?? d.source.admin.options.host,
    port = configured?.port || d.source.admin.options.port || 5432,
    name = configured
      ? decodeURIComponent(configured.pathname.slice(1))
      : d.source.admin.options.database;
  const nativeHost = d.source.environment.PGHOST?.endsWith(".neon.tech")
    ? d.source.environment.PGHOST
    : `${d.source.environment.PGHOST}:${d.source.environment.PGPORT}`;
  if (
    host !== d.source.environment.PGHOST ||
    String(port) !== d.source.environment.PGPORT ||
    name !== d.source.environment.PGDATABASE ||
    name !== d.sourceIdentity.database ||
    nativeHost !== d.sourceIdentity.host
  )
    throw new ApplicationError("FORBIDDEN");
  const postgresMajor = await verifyRecoveryTool(
    d.pgDump,
    "pg_dump",
    d.source,
    d.pgDumpHash,
  );
  const client = await d.source.admin.connect(),
    directory = await mkdtemp(join(tmpdir(), "recovery-backup-"));
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (
      await client.query<{
        snapshot: string;
        cutoff: Date;
        transaction: string;
        wal_lsn: string;
        database: string;
      }>(
        "SELECT pg_export_snapshot() AS snapshot,statement_timestamp() AS cutoff,pg_current_snapshot()::text AS transaction,pg_current_wal_lsn()::text AS wal_lsn,current_database() AS database",
      )
    ).rows[0];
    if (snapshot.database !== d.sourceIdentity.database)
      throw new ApplicationError("FORBIDDEN");
    const manifest: RecoveryManifest = {
      version: 1,
      id: d.id,
      cutoff: snapshot.cutoff.toISOString(),
      schemaHash: d.schemaHash,
      nativeSchemaHash: await nativeSchemaHash(client),
      postgresMajor,
      snapshot: {
        id: snapshot.snapshot,
        transaction: snapshot.transaction,
        walLsn: snapshot.wal_lsn,
      },
      source: d.sourceIdentity,
      tables: await inventory(client),
      facts: await facts(client, d.businessId),
    };
    const path = join(directory, "backup.dump");
    await writeFile(path, Buffer.alloc(0), { mode: 0o600, flag: "wx" });
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
      d.pgDumpHash,
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", d.key, iv);
    if ((await stat(path)).size > d.maxBytes)
      throw new ApplicationError("SETUP_REQUIRED");
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
  pgRestoreHash?: string;
  psql: string;
  psqlHash?: string;
  key: Buffer;
  archive(id: string): Promise<RecoveryArchive>;
  reviewedSchema: {
    hash: string;
    apply(target: Pool, authorize: () => Promise<void>): Promise<void>;
  };
  observeIdentities(): Promise<{
    source: RecoveryPlan["source"];
    target: RecoveryPlan["target"];
    expiresAt: string;
    nativeVerified?: boolean;
  }>;
  files: {
    readRetained(id: string): Promise<Buffer | null>;
    writeTarget(id: string, bytes: Buffer): Promise<void>;
    readTarget(id: string): Promise<Buffer | null>;
  };
  reconcile(plan: RecoveryPlan): Promise<RecoveryControlEvidence>;
  restoreArchive?(
    path: string,
    authorize: () => Promise<void>,
    guard: RestoreGuard,
  ): Promise<void>;
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
      (plan.mode === "configured" && observation.nativeVerified !== true) ||
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
      // Managed endpoints may reuse private socket addresses across projects.
      // Only authenticated native endpoint evidence can replace the local socket distinction.
      (JSON.stringify(source) === JSON.stringify(target) &&
        !(
          plan.mode === "configured" &&
          observation.nativeVerified === true &&
          plan.source.host.endsWith(".neon.tech") &&
          plan.target.host.endsWith(".neon.tech")
        ))
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
  async function targetState() {
    return (
      await d.target.admin.query<{
        operation_id: string | null;
        restored: boolean;
      }>(
        "SELECT operation_id,restored FROM recovery_quarantine.target WHERE singleton",
      )
    ).rows[0];
  }
  async function verify(
    plan: RecoveryPlan,
    shape: "snapshot" | "reviewed" | "records" = "snapshot",
  ) {
    const a = await artifact(plan);
    // The source recovery journal advances AFTER the snapshot; compare against the frozen archive, not today's source.
    const found = await inventory(d.target.admin);
    if (
      JSON.stringify(found) !== JSON.stringify(a.manifest.tables) ||
      (shape !== "records" &&
        (await nativeSchemaHash(d.target.admin)) !==
          (shape === "snapshot"
            ? a.manifest.nativeSchemaHash
            : plan.appliedSchemaHash))
    )
      throw new ApplicationError("CONFLICT");
    return a;
  }
  async function secureInspection(
    plan: RecoveryPlan,
    id: string,
    authorize: () => Promise<void>,
  ) {
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
          `SELECT '${table}'::text AS "table",id::text,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash,jsonb_build_object('name',to_jsonb(r)->'name','offering',to_jsonb(r)->'offering','subject',coalesce(to_jsonb(r)->'subject',to_jsonb(r)->'content'->'subject'),'text',CASE WHEN '${table}'='inbox_message' THEN to_jsonb(r)->'content'->'text' ELSE NULL END,'kind',to_jsonb(r)->'kind','status',to_jsonb(r)->'status','phase',to_jsonb(r)->'phase','paymentId',to_jsonb(r)->'payment_id','invoiceId',to_jsonb(r)->'invoice_id','periodId',to_jsonb(r)->'period_id','actualMinor',CASE WHEN '${table}'='financial_case_event' AND to_jsonb(r)->>'kind'='financial_effect' THEN to_jsonb(r)->'detail'->'actualMinor' ELSE NULL END,'nativeId',CASE WHEN '${table}'='financial_case_event' THEN to_jsonb(r)->'detail'->'nativeId' WHEN '${table}'='financial_receipt' THEN to_jsonb(r)->'receipt'->'nativeId' ELSE NULL END,'totalMinor',CASE WHEN '${table}'='seller_document' THEN to_jsonb(r)->'snapshot'->'totals'->'totalMinor' ELSE NULL END,'artifactHash',CASE WHEN '${table}'='seller_document' THEN to_jsonb(r)->'sha256' ELSE NULL END) AS value FROM public.${quoted(table)} r WHERE ${column === "receipt_case" ? "EXISTS(SELECT 1 FROM public.financial_case c WHERE c.id::text=r.receipt->>'caseRef' AND c.business_id=(SELECT business_id FROM recovery_quarantine.target WHERE singleton AND operation_id=op))" : `${column}=(SELECT business_id FROM recovery_quarantine.target WHERE singleton AND operation_id=op)`}`,
        );
    }
    await authorize();
    await d.target.admin
      .query(`CREATE OR REPLACE FUNCTION recovery_quarantine.records(op uuid) RETURNS TABLE("table" text,id text,hash text,value jsonb) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ ${selects.join(" UNION ALL ")} $$;
      REVOKE ALL ON FUNCTION recovery_quarantine.records(uuid) FROM PUBLIC; GRANT USAGE ON SCHEMA recovery_quarantine TO app_runtime; GRANT EXECUTE ON FUNCTION recovery_quarantine.records(uuid) TO app_runtime;`);
    await authorize();
    await d.target.admin.query(
      "UPDATE recovery_quarantine.target SET business_id=$1,operation_id=$2 WHERE singleton",
      [plan.businessId, id],
    );
    return readInspection(plan, id, a);
  }
  async function readInspection(
    plan: RecoveryPlan,
    id: string,
    archive?: RecoveryArchive,
  ) {
    const a = archive ?? (await artifact(plan));
    const safety = await d.target.runtime.query<{ safe: boolean }>(
      `SELECT current_setting('transaction_read_only')='on' AND NOT has_table_privilege(current_user,'recovery_quarantine.target','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='recovery_quarantine.records(uuid)'::regprocedure AND p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) AS safe`,
    );
    if (safety.rows[0]?.safe !== true)
      throw new ApplicationError("SETUP_REQUIRED");
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
      const archive = await artifact(plan);
      if (plan.mode === "configured" && (!d.pgRestoreHash || !d.psqlHash))
        throw new ApplicationError("SETUP_REQUIRED");
      if (stage === "target_verified" || stage === "restored") {
        const major = await verifyRecoveryTool(
          d.pgRestore,
          "pg_restore",
          d.target,
          d.pgRestoreHash,
        );
        if (major !== archive.manifest.postgresMajor)
          throw new ApplicationError("SETUP_REQUIRED");
        if (
          (await verifyRecoveryTool(d.psql, "psql", d.target, d.psqlHash)) !==
          major
        )
          throw new ApplicationError("SETUP_REQUIRED");
      }
      await authorize();
      const mutex = await d.target.admin.connect();
      let locked = false;
      let nativeProbeHeld = false;
      try {
        locked = (
          await mutex.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended('infrastructure-recovery-target',0)) AS locked",
          )
        ).rows[0].locked;
        if (!locked) throw new ApplicationError("CONFLICT");
        nativeProbeHeld = (
          await mutex.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended('infrastructure-recovery-native',0)) AS locked",
          )
        ).rows[0].locked;
        if (!nativeProbeHeld) throw new ApplicationError("CONFLICT");
        if (
          !(
            await mutex.query<{ unlocked: boolean }>(
              "SELECT pg_advisory_unlock(hashtextextended('infrastructure-recovery-native',0)) AS unlocked",
            )
          ).rows[0].unlocked
        )
          throw new ApplicationError("CONFLICT");
        nativeProbeHeld = false;
        await authorize();
        const state = await targetState();
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
          await authorize();
          await d.target.admin.query(
            "UPDATE recovery_quarantine.target SET operation_id=$1,business_id=$2 WHERE singleton",
            [id, plan.businessId],
          );
          return { physicalTarget };
        }
        if (stage === "restored") {
          let attempted = false;
          try {
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
                  directory = await mkdtemp(
                    join(tmpdir(), "recovery-restore-"),
                  );
                try {
                  const path = join(directory, "backup.dump");
                  await writeFile(path, bytes, { mode: 0o600 });
                  await authorize();
                  await check(plan);
                  await authorize();
                  attempted = true;
                  const guard = {
                    seal: d.targetSeal,
                    operationId: id,
                    businessId: plan.businessId,
                  };
                  const authorizeNative = async () => {
                    await check(plan);
                    await authorize();
                  };
                  if (d.restoreArchive)
                    await d.restoreArchive(path, authorizeNative, guard);
                  else
                    await restoreRecoveryArchive(
                      d.pgRestore,
                      path,
                      plan.target.database,
                      d.target.environment,
                      {
                        psql: d.psql,
                        pgRestoreHash: d.pgRestoreHash,
                        psqlHash: d.psqlHash,
                        restoreSqlBytes: plan.limits.restoreSqlBytes,
                        authorize: authorizeNative,
                        guard,
                      },
                    );
                } finally {
                  await rm(directory, { recursive: true, force: true });
                }
                await verify(plan);
              }
              await authorize();
              await d.target.admin.query(
                "UPDATE recovery_quarantine.target SET restored=true WHERE singleton",
              );
            }
            await verify(plan);
            return { physicalTarget };
          } catch (error: unknown) {
            if (attempted) {
              // Read-only verification can preserve an already committed effect;
              // it does not authorize a marker write, next stage or inspection.
              let verified = false;
              try {
                await verify(plan);
                verified = true;
              } catch {}
              if (verified)
                throw new RecoveryIncurredError(
                  { physicalTarget, incurredStage: "restored" },
                  error,
                );
            }
            throw error;
          }
        }
        if (stage === "secured") {
          // Restore already proved the snapshot shape. A restarted, reviewed schema
          // application may have committed DDL before its acknowledgement was lost.
          await verify(plan, "records");
          await authorize();
          await d.reviewedSchema.apply(d.target.admin, authorize);
          await authorize();
          await secureDatabase(d.target.admin, { allowQuarantined: true });
          await verify(plan, "reviewed");
          await verifyRuntimeRole(d.target.runtime, { allowQuarantined: true });
          // Authentication keys, callbacks and workers are never copied into target configuration. All runtime writes are additionally fenced in PostgreSQL.
          await authorize();
          await d.target.admin.query(
            "ALTER ROLE app_runtime SET default_transaction_read_only=on",
          );
          return { security: "restricted-verified", physicalTarget };
        }
        if (stage === "verified") {
          await verify(plan, "reviewed");
          await verifyRuntimeRole(d.target.runtime, { allowQuarantined: true });
          return {
            facts: (await secureInspection(plan, id, authorize)).facts,
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
              await check(plan);
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
                    status: z
                      .enum([
                        "pending",
                        "processed",
                        "failed",
                        "open",
                        "under_review",
                        "won",
                        "lost",
                        "closed",
                      ])
                      .nullable()
                      .optional(),
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
          await authorize();
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
            facts: (await readInspection(plan, id)).facts,
            unresolved: [
              "Inspection only. Production activation requires fresh identities, memberships, grants, sender approvals and domain-specific reconciliation; restored queues remain disabled.",
            ],
          };
        }
        throw new ApplicationError("INVALID_INPUT");
      } finally {
        let unlocked = !locked;
        if (locked) {
          try {
            unlocked = (
              await mutex.query<{ unlocked: boolean }>(
                "SELECT (CASE WHEN $1::boolean THEN pg_advisory_unlock(hashtextextended('infrastructure-recovery-native',0)) ELSE true END) AND pg_advisory_unlock(hashtextextended('infrastructure-recovery-target',0)) AS unlocked",
                [nativeProbeHeld],
              )
            ).rows[0].unlocked;
          } catch {}
        }
        mutex.release(!unlocked);
      }
    },
    async inspect(plan, id) {
      await check(plan);
      const inspection = await readInspection(plan, id),
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
