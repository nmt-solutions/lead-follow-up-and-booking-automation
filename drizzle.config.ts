import { defineConfig } from "drizzle-kit";
import { databaseAdminUrl } from "./scripts/database-environment";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: databaseAdminUrl() },
  schemaFilter: ["public"],
  tablesFilter: [
    "user",
    "session",
    "account",
    "verification",
    "rate_limit",
    "business",
    "membership",
    "invitation",
    "team_audit",
    "platform_operator",
    "two_factor",
    "business_file",
    "file_access",
    "file_usage",
  ],
});
