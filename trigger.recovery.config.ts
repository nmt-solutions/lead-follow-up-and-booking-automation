import { defineConfig } from "@trigger.dev/sdk";
// Deploy separately. Only this project/environment receives administrative recovery credentials.
export default defineConfig({
  project: process.env.TRIGGER_RECOVERY_PROJECT_REF ?? "",
  dirs: ["./src/recovery-trigger"],
  runtime: "node",
  maxDuration: 1800,
});
