import { Pool } from "pg";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createSellerDocumentRepository } from "../db/seller-document-repository";
import { createSellerDocumentApplication } from "../application/seller-documents";
import { ApplicationError } from "../models/application-error";
import { configuredSellerDocumentStorage } from "./configuration";

export async function recoverSellerDocuments() {
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {});
  try {
    await verifyRuntimeRole(pool);
    const denied = async () => {
      throw new ApplicationError("FORBIDDEN");
    };
    return await createSellerDocumentApplication({
      authenticate: denied,
      authenticatePlatform: denied,
      repository: createSellerDocumentRepository(runtimeDatabase(pool)),
      clock: { now: () => new Date() },
      mode: "live",
      ...configuredSellerDocumentStorage(process.env),
    }).recoverPending();
  } finally {
    await pool.end();
  }
}
