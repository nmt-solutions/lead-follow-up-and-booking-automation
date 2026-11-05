import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { databaseConnectionUrl } from "../src/db/connection";

// Existing process variables win, then .env.local, then .env, matching Next.js.
export function databaseAdminUrl() {
  for (const path of [".env.local", ".env"]) {
    if (existsSync(path)) loadEnvFile(path);
  }
  const value = process.env.DATABASE_ADMIN_URL;
  if (!value)
    throw new Error(
      "Set DATABASE_ADMIN_URL to the database owner's connection.",
    );
  return databaseConnectionUrl(value, true);
}
