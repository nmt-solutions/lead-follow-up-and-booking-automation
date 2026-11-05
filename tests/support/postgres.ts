import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

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
  try {
    await postgres.initialise();
    await postgres.start();
    await migrate(drizzle(admin), { migrationsFolder: "./drizzle" });
    // A random hex password in an isolated, disposable local cluster, never a production credential.
    await admin.query(`ALTER ROLE app_runtime LOGIN PASSWORD '${password}'`);
    return {
      admin,
      runtime,
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
