import { defineConfig } from "drizzle-kit";

// Generation reads the source schema and snapshots, without loading credentials.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
