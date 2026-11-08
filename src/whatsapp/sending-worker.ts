import { Pool } from "pg";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createWhatsAppSendingRepository } from "../db/whatsapp-sending-repository";
import { createOpportunityRepository } from "../db/opportunity-control-repository";
import { createWhatsAppSendingApplication } from "../application/whatsapp-sending";
import { configuredMetaCloud } from "./configuration";
import { createMetaTransport } from "./transport";
import { ApplicationError } from "../models/application-error";

export async function recoverMetaSends() {
  if (
    !process.env.DATABASE_URL ||
    process.env.META_OUTBOUND_WORKER_DEPLOYMENT_CONFIRMED !== "true"
  )
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    console.error(
      JSON.stringify({ event: "whatsapp_outbound_database_unavailable" }),
    ),
  );
  try {
    await verifyRuntimeRole(pool);
    const clock = { now: () => new Date() },
      db = runtimeDatabase(pool),
      meta = configuredMetaCloud(process.env, fetch, clock);
    const repository = createWhatsAppSendingRepository(db, clock, {
      ...meta,
      transport:
        meta.vault && process.env.META_GRAPH_VERSION
          ? createMetaTransport({
              graphVersion: process.env.META_GRAPH_VERSION,
              fetch,
            })
          : null,
      workerReady: true,
    });
    const app = createWhatsAppSendingApplication<void>({
      authenticate: async () => {
        throw new ApplicationError("FORBIDDEN");
      },
      repository,
      opportunities: createOpportunityRepository(db, clock, repository),
      clock,
    });
    return await app.recoverDue();
  } finally {
    await pool.end();
  }
}
