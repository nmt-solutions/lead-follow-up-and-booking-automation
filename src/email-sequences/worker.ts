import { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createEmailSequenceRepository } from "../db/email-sequence-repository";
import { createEmailSequenceApplication } from "../application/email-sequences";
import { configuredSequenceQueue } from "./queue";
import { unavailableSequenceMail } from "./provider";

export async function withEmailSequenceWorker<T>(
  operation: (
    app: ReturnType<typeof createEmailSequenceApplication<void>>,
  ) => Promise<T>,
) {
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    console.error(JSON.stringify({ event: "sequence_database_unavailable" })),
  );
  try {
    await verifyRuntimeRole(pool);
    const clock = { now: () => new Date() };
    return await operation(
      createEmailSequenceApplication<void>({
        authenticate: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
        repository: createEmailSequenceRepository(runtimeDatabase(pool), clock),
        clock,
        provider: unavailableSequenceMail,
        queue: configuredSequenceQueue(process.env),
      }),
    );
  } finally {
    await pool.end();
  }
}
