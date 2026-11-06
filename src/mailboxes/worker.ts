import { Pool } from "pg";
import { createMailboxApplication } from "../application/mailboxes";
import { createMailboxRepository } from "../db/mailbox-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { databaseConnectionUrl } from "../db/connection";
import { ApplicationError } from "../models/application-error";
import { configuredGmail } from "../gmail/configuration";
import { createGmailConnection } from "../gmail/connection";
import { createGmailProvider } from "../gmail/provider";

export async function withMailboxWorker<T>(
  operation: (
    app: ReturnType<typeof createMailboxApplication<void>>,
  ) => Promise<T>,
) {
  if (!process.env.DATABASE_URL)
    throw new Error("Mailbox database setup is missing");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    console.error(JSON.stringify({ event: "mailbox_database_unavailable" })),
  );
  try {
    await verifyRuntimeRole(pool);
    const database = runtimeDatabase(pool);
    const clock = { now: () => new Date() };
    return await operation(
      createMailboxApplication<void>({
        authenticate: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
        repository: createMailboxRepository(database, clock),
        provider: createGmailProvider(
          createGmailConnection(database, {
            clock,
            configuration: configuredGmail(process.env),
            fetch,
          }),
          clock,
        ),
        clock,
      }),
    );
  } finally {
    await pool.end();
  }
}
