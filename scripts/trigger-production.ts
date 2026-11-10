import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { z } from "zod";
import {
  configure,
  deployments,
  envvars,
  runs,
  tasks,
  schedules,
} from "@trigger.dev/sdk";
import { databaseAdminUrl } from "./database-environment";
import { productionSubscriptionIssues } from "../src/production/subscriptions";
import type { productionReadiness } from "../src/trigger/production-readiness";

async function main() {
  databaseAdminUrl(); // Loads the approved local environment; the admin URL is never uploaded.
  const project = process.env.TRIGGER_PROJECT_REF;
  if (!project || !process.env.TRIGGER_SECRET_KEY?.startsWith("tr_prod_"))
    throw new Error("Production Trigger credentials required.");
  configure({ secretKey: process.env.TRIGGER_SECRET_KEY });
  const command = process.argv[2];
  if (command === "deploy") {
    const args = [
      "dlx",
      "trigger.dev@4.8.3",
      "deploy",
      "--env",
      "prod",
      "--env-file",
      ".env",
      "--skip-update-check",
      "--skip-telemetry",
    ];
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", `pnpm ${args.join(" ")}`], {
            windowsHide: true,
            env: {
              ...process.env,
              CI: "true",
              TRIGGER_ACCESS_TOKEN: process.env.TRIGGER_SECRET_KEY,
            },
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn("pnpm", args, {
            env: {
              ...process.env,
              CI: "true",
              TRIGGER_ACCESS_TOKEN: process.env.TRIGGER_SECRET_KEY,
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
    const write = (chunk: Buffer) => {
      let output = chunk.toString();
      if (process.env.TRIGGER_SECRET_KEY)
        output = output.replaceAll(
          process.env.TRIGGER_SECRET_KEY,
          "[redacted]",
        );
      process.stdout.write(output);
    };
    child.stdout?.on("data", write);
    child.stderr?.on("data", write);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) throw new Error("Trigger deployment failed.");
    return;
  }
  if (command === "sync") {
    const local = await readFile(".env", "utf8");
    const names = Array.from(
      local.matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
      (match) => match[1],
    );
    const allowed = (name: string) =>
      /^(AI_|OPERATOR_(?:OPENAI|AI_GATEWAY|EXA)_|EXA_|DISCOVERY_|MAILBOX_|EMAIL_SEQUENCE_|GMAIL_|GOOGLE_CALENDAR_|MICROSOFT_|META_|R2_|FILE_|NOTIFICATION_|RESEND_|SELLER_|TAX_|RAZORPAY_|SUBSCRIPTION_|OPERATIONS_|BUSINESS_DATA_|FINANCIAL_|COST_)/.test(
        name,
      ) ||
      name === "DATABASE_URL" ||
      name === "BETTER_AUTH_URL" ||
      name === "AUTH_EMAIL_FROM" ||
      name === "TRIGGER_PROJECT_REF" ||
      name === "TRIGGER_SECRET_KEY" ||
      /^TRIGGER_(?!INFRASTRUCTURE_).*_CRON$/.test(name);
    const variables = Object.fromEntries(
      names
        .filter((name) => allowed(name) && process.env[name])
        .map((name) => [name, process.env[name] ?? ""]),
    );
    if (
      Object.keys(variables).some(
        (name) =>
          /ADMIN_URL|RECOVERY_|BETTER_AUTH_SECRET/.test(name) &&
          !/^TRIGGER_.*_RECOVERY_CRON$/.test(name),
      )
    )
      throw new Error("Owner-only environment variable selected.");
    variables.NODE_ENV = "production";
    await envvars.upload(project, "prod", { variables, override: true });
    console.log(
      `Synchronized ${Object.keys(variables).length} worker settings. Values and owner credentials are not printed.`,
    );
    return;
  }
  if (command === "inspect") {
    const current = await deployments.retrieveCurrent();
    console.log(
      JSON.stringify({
        deployment: current.version,
        status: current.status,
        deployedAt: current.deployedAt,
      }),
    );
    const list = await schedules.list();
    console.log(
      JSON.stringify({
        schedules: list.data.map((item) => ({
          task: item.task,
          active: item.active,
          type: item.type,
        })),
      }),
    );
    console.log(
      JSON.stringify({
        subscriptionConfigurationIssues: productionSubscriptionIssues(),
      }),
    );
    return;
  }
  if (command === "probe") {
    const handle = await tasks.trigger<typeof productionReadiness>(
      "production-readiness",
      {},
      {
        idempotencyKey: `production-readiness:${process.argv[3] ?? "release"}`,
        idempotencyKeyTTL: "1h",
      },
    );
    console.log(`Read-only worker probe queued: ${handle.id}`);
    return;
  }
  if (command === "run" && process.argv[3]) {
    const run = await runs.retrieve(process.argv[3]);
    const probe = z
      .strictObject({
        database: z.literal("restricted_role_verified"),
        version: z.string(),
        environment: z.string(),
      })
      .safeParse(run.output);
    console.log(
      JSON.stringify({
        id: run.id,
        status: run.status,
        output: probe.success ? probe.data : null,
      }),
    );
    return;
  }
  throw new Error(
    "Use sync, deploy, inspect, probe <release>, or run <probe-id>.",
  );
}
main().catch(() => {
  console.error(
    "Trigger production operation failed. Check credentials, project access and deployment state. Secret values are suppressed.",
  );
  process.exitCode = 1;
});
