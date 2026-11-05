import { Pool } from "pg";
import { createDiscoveryApplication } from "../application/discovery";
import { createDiscoveryRepository } from "../db/discovery-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { databaseConnectionUrl } from "../db/connection";
import { ApplicationError } from "../models/application-error";
import { authenticateQueuedActor } from "../auth/access";
import { configuredDiscoveryProvider } from "./configuration";

export async function withDiscoveryWorker<T>(
  operation: (
    application: ReturnType<typeof createDiscoveryApplication<void>>,
  ) => Promise<T>,
) {
  if (!process.env.DATABASE_URL)
    throw new Error("Discovery database configuration is missing");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 5,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    console.error(JSON.stringify({ event: "discovery_database_unavailable" })),
  );
  try {
    await verifyRuntimeRole(pool);
    const database = runtimeDatabase(pool);
    const clock = { now: () => new Date() };
    return await operation(
      createDiscoveryApplication<void>({
        authenticate: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
        authenticateForWork: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
        authenticateWork: (identity) =>
          authenticateQueuedActor(database, clock, identity),
        repository: createDiscoveryRepository(database, clock),
        clock,
        provider: configuredDiscoveryProvider(),
        queue: null,
        reportFailure: (diagnostic) =>
          console.error(
            JSON.stringify({ event: "discovery_failed", ...diagnostic }),
          ),
      }),
    );
  } finally {
    await pool.end();
  }
}
