import { defineConfig } from "@trigger.dev/sdk";
import {
  additionalFiles,
  additionalPackages,
} from "@trigger.dev/build/extensions/core";
// Deploy separately. Only this project/environment receives administrative recovery credentials.
export default defineConfig({
  project: process.env.TRIGGER_RECOVERY_PROJECT_REF ?? "",
  dirs: ["./src/recovery-trigger"],
  runtime: "node",
  maxDuration: 1800,
  legacyDevProcessCwdBehaviour: false,
  build: {
    extensions: [
      additionalFiles({
        files: [
          "./src/**",
          "./scripts/database-*.ts",
          "./scripts/recovery-tools.ts",
          "./drizzle.config.ts",
          "./trigger.recovery.config.ts",
          "./tsconfig.json",
          "./recovery-tools/**",
        ],
      }),
      additionalPackages({
        packages: [
          "drizzle-kit@0.31.11",
          "drizzle-orm@0.45.4",
          "pg@8.23.1",
          "zod@4.6.7",
          "tsx@4.23.15",
        ],
      }),
    ],
  },
});
