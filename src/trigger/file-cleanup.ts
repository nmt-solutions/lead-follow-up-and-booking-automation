import { schedules } from "@trigger.dev/sdk";
import { Pool } from "pg";
import { createFileApplication } from "../application/files";
import { createFileRepository } from "../db/file-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { databaseConnectionUrl } from "../db/connection";
import { readFilesConfiguration } from "../storage/configuration";
import { ApplicationError } from "../models/application-error";

// Attach an explicit operator-chosen schedule after deployment. Payloads never
// select actors, keys, Businesses, policy, timestamps or deletion targets.
export const fileCleanup = schedules.task({
  id: "private-business-file-cleanup",
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
    randomize: true,
  },
  run: async () => {
    const configuration = readFilesConfiguration(process.env);
    if (!configuration.policy || !process.env.DATABASE_URL)
      throw new ApplicationError("FILE_SETUP_REQUIRED");
    const pool = new Pool({
      connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
      max: 1,
      connectionTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    try {
      await verifyRuntimeRole(pool);
      const application = createFileApplication<void>({
        ...configuration,
        repository: createFileRepository(runtimeDatabase(pool)),
        clock: { now: () => new Date() },
        authenticate: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
      });
      const result = await application.cleanup();
      if (result.failed) throw new ApplicationError("PROVIDER_UNAVAILABLE");
      return result;
    } catch {
      // Never let Trigger serialize a database/provider exception or credentials.
      throw new Error(
        "Private file cleanup could not complete. Inspect persisted cleanup state and retry.",
      );
    } finally {
      await pool.end();
    }
  },
});
