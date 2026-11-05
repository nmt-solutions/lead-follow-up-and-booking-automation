import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { prepareDatabaseRole, secureDatabase } from "../../src/db/setup";

const run = promisify(execFile);
const drizzleCli = join(
  dirname(createRequire(import.meta.url).resolve("drizzle-kit/api")),
  "bin.cjs",
);

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test database port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

export async function startPostgres() {
  const directory = await mkdtemp(join(tmpdir(), "business-postgres-"));
  const port = await availablePort();
  const password = randomBytes(24).toString("hex");
  const postgres = new EmbeddedPostgres({
    databaseDir: directory,
    port,
    user: "postgres",
    password,
    persistent: false,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  const admin = new Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "postgres",
  });
  const runtime = new Pool({
    host: "127.0.0.1",
    port,
    user: "app_runtime",
    password,
    database: "postgres",
    max: 2,
  });
  async function reapplySchema() {
    await prepareDatabaseRole(admin);
    await run(process.execPath, [drizzleCli, "push"], {
      env: {
        ...process.env,
        DATABASE_ADMIN_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
      },
      windowsHide: true,
      timeout: 30000,
    });
    await secureDatabase(admin);
  }
  try {
    await postgres.initialise();
    await postgres.start();
    await reapplySchema();
    // A random hex password in an isolated, disposable local cluster, never a production credential.
    await admin.query(`ALTER ROLE app_runtime LOGIN PASSWORD '${password}'`);
    return {
      admin,
      runtime,
      reapplySchema,
      async close() {
        await runtime.end();
        await admin.end();
        await postgres.stop();
      },
    };
  } catch (error) {
    await runtime.end();
    await admin.end();
    await postgres.stop();
    throw error;
  }
}
