import { execFile } from "node:child_process";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrateDatabase } from "../src/db/migrations";
import { verifyRuntimeRole } from "../src/db/runtime";
import { startPostgres } from "./support/postgres";

const run = promisify(execFile);
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const drizzleCli = join(
  dirname(createRequire(import.meta.url).resolve("drizzle-kit/api")),
  "bin.cjs",
);

const journalSchema = z.object({
  version: z.string(),
  dialect: z.literal("postgresql"),
  entries: z.array(
    z.object({
      idx: z.number(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});

describe("production database migrations", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let directory: string;
  let migrationsFolder: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "leadrelay-migrations-"));
    migrationsFolder = join(directory, "drizzle");
    await cp(resolve("drizzle"), migrationsFolder, { recursive: true });
    database = await startPostgres({ initializeSchema: false });
  });

  afterAll(async () => {
    if (database) await database.close();
    if (directory) {
      const target = resolve(directory);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith("leadrelay-migrations-")
      )
        throw new Error("Unexpected migration test directory.");
      await rm(target, { recursive: true, force: true });
    }
  });

  async function addMigration(name: string, sql: string) {
    const path = join(migrationsFolder, "meta", "_journal.json");
    const journal = journalSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    const previous = journal.entries.at(-1);
    if (!previous) throw new Error("Missing initial migration.");
    const index = previous.idx + 1;
    const tag = `${String(index).padStart(4, "0")}_${name}`;
    const sqlPath = join(migrationsFolder, `${tag}.sql`);
    journal.entries.push({
      idx: index,
      version: previous.version,
      when: previous.when + 1,
      tag,
      breakpoints: true,
    });
    await writeFile(sqlPath, sql);
    await writeFile(path, JSON.stringify(journal));
    return sqlPath;
  }

  it("rejects missing migration files without changing the database", async () => {
    await expect(
      migrateDatabase(database.admin, join(directory, "missing")),
    ).rejects.toThrow("Cannot read migrations");
    const tables = await database.admin.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    expect(tables.rowCount).toBe(0);
  });

  it("installs the initial schema, verifies runtime security and preserves data on rerun", async () => {
    const environment = database.nativeEnvironment;
    const result = await run(
      process.execPath,
      [tsxCli, resolve("scripts/database-migrate.ts")],
      {
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: `postgresql://${environment.PGUSER}:${environment.PGPASSWORD}@${environment.PGHOST}:${environment.PGPORT}/${environment.PGDATABASE}`,
        },
        windowsHide: true,
        timeout: 30000,
      },
    );
    expect(result.stdout).toContain(
      "Database migrations and runtime security verified.",
    );
    await verifyRuntimeRole(database.runtime);
    await database.admin.query(`INSERT INTO public."user" (id,name,email)
      VALUES ('migration-retained-user','Retained user','migration@example.test')`);

    await migrateDatabase(database.admin, migrationsFolder);
    await verifyRuntimeRole(database.runtime);
    const user = await database.admin.query(
      "SELECT name,email FROM public.\"user\" WHERE id='migration-retained-user'",
    );
    expect(user.rows).toEqual([
      { name: "Retained user", email: "migration@example.test" },
    ]);
    const history = await database.admin.query(
      "SELECT hash FROM drizzle.__drizzle_migrations",
    );
    expect(history.rows.map((row) => row.hash)).toEqual(
      readMigrationFiles({ migrationsFolder }).map(
        (migration) => migration.hash,
      ),
    );
  });

  it("applies a new migration without replaying the initial migration", async () => {
    await addMigration(
      "add_note",
      'ALTER TABLE public."user" ADD COLUMN migration_note text;',
    );
    await migrateDatabase(database.admin, migrationsFolder);
    await verifyRuntimeRole(database.runtime);
    const user = await database.admin.query(
      "SELECT migration_note FROM public.\"user\" WHERE id='migration-retained-user'",
    );
    expect(user.rows).toEqual([{ migration_note: null }]);
  });

  it("rolls back failed pending SQL and can retry without losing data", async () => {
    const sql = 'ALTER TABLE public."user" ADD COLUMN rollback_probe text;';
    const path = await addMigration(
      "retry",
      `${sql}\n--> statement-breakpoint\nSELECT missing_migration_function();`,
    );
    await expect(
      migrateDatabase(database.admin, migrationsFolder),
    ).rejects.toThrow("SQL migration");
    const column = await database.admin.query(`SELECT column_name
      FROM information_schema.columns WHERE table_schema='public'
      AND table_name='user' AND column_name='rollback_probe'`);
    expect(column.rowCount).toBe(0);
    const history = await database.admin.query(
      "SELECT hash FROM drizzle.__drizzle_migrations",
    );
    expect(history.rowCount).toBe(2);

    // Only the unapplied migration is repaired. Applied files remain immutable.
    await writeFile(path, sql);
    await migrateDatabase(database.admin, migrationsFolder);
    await verifyRuntimeRole(database.runtime);
    const user = await database.admin.query(
      "SELECT rollback_probe FROM public.\"user\" WHERE id='migration-retained-user'",
    );
    expect(user.rows).toEqual([{ rollback_probe: null }]);
  });

  it("rejects edited applied SQL before pausing runtime access", async () => {
    const path = join(migrationsFolder, "0000_initial.sql");
    const original = await readFile(path, "utf8");
    try {
      await appendFile(path, "\n-- An edit to applied history\n");
      await expect(
        migrateDatabase(database.admin, migrationsFolder),
      ).rejects.toThrow("Applied migration history differs");
      await verifyRuntimeRole(database.runtime);
    } finally {
      await writeFile(path, original);
    }
  });

  it("allows only one migration command at a time", async () => {
    const results = await Promise.allSettled([
      migrateDatabase(database.admin, migrationsFolder),
      migrateDatabase(database.admin, migrationsFolder),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({
          message:
            "Another database migration is running. Retry after it finishes.",
        });
    await verifyRuntimeRole(database.runtime);
  });

  it("preserves an existing schema without silently adopting a baseline", async () => {
    await database.admin.query("CREATE DATABASE migration_legacy");
    const legacy = new Pool({
      host: database.nativeEnvironment.PGHOST,
      port: Number(database.nativeEnvironment.PGPORT),
      user: database.nativeEnvironment.PGUSER,
      password: database.nativeEnvironment.PGPASSWORD,
      database: "migration_legacy",
    });
    try {
      await legacy.query("CREATE TABLE retained_data (value text)");
      await legacy.query("INSERT INTO retained_data VALUES ('keep me')");
      await expect(migrateDatabase(legacy, migrationsFolder)).rejects.toThrow(
        "no migration baseline",
      );
      expect(
        (await legacy.query("SELECT value FROM retained_data")).rows,
      ).toEqual([{ value: "keep me" }]);
      expect(
        (
          await legacy.query(
            "SELECT to_regclass('drizzle.__drizzle_migrations') AS history",
          )
        ).rows,
      ).toEqual([{ history: null }]);
      await legacy.query("CREATE SCHEMA recovery_quarantine");
      await expect(migrateDatabase(legacy, migrationsFolder)).rejects.toThrow(
        "quarantined recovery database",
      );
    } finally {
      await legacy.end();
    }
  });

  it("reports failed generation even when the pinned Drizzle CLI exits zero", async () => {
    const workspace = join(directory, "broken-generator");
    await mkdir(join(workspace, "drizzle", "meta"), { recursive: true });
    await writeFile(
      join(workspace, "drizzle.generate.config.ts"),
      `export default ${JSON.stringify({
        dialect: "postgresql",
        schema: resolve("src/db/schema.ts").replaceAll("\\", "/"),
        out: "./drizzle",
      })};`,
    );
    const options = {
      cwd: workspace,
      env: {
        ...process.env,
        DATABASE_ADMIN_URL:
          "postgresql://unused:unused@127.0.0.1:1/unavailable",
      },
      windowsHide: true,
      timeout: 10000,
    };
    const raw = await run(
      process.execPath,
      [drizzleCli, "generate", "--config=drizzle.generate.config.ts"],
      options,
    );
    expect(`${raw.stdout}${raw.stderr}`).toContain("_journal.json");
    await expect(
      run(
        process.execPath,
        [tsxCli, resolve("scripts/database-generate.ts")],
        options,
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Migration generation failed."),
    });
  });
});
