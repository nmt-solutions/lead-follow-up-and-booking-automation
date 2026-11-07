import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { recoveryDigest } from "./postgres";
import { ApplicationError } from "../models/application-error";

// This is a source-owned bundle, never SQL, a command or a path supplied by an HTTP caller.
export async function recoverySchemaBundle(root = process.cwd()) {
  const files = [
    "drizzle.config.ts",
    "scripts/database-environment.ts",
    "scripts/database-security.ts",
    "scripts/recovery-tools.ts",
    "trigger.recovery.config.ts",
    "src/models/infrastructure-recovery.ts",
    "src/models/upi-autopay.ts",
    "src/models/public-financial.ts",
    "src/models/financial-adjustments.ts",
    "src/application/financial-adjustments.ts",
    "src/financial-adjustments/accounts.ts",
    "src/financial-adjustments/configuration.ts",
    "src/financial-adjustments/razorpay.ts",
    "src/models/razorpay-account.ts",
    "src/models/subscription-payments.ts",
    "src/models/reach-changes.ts",
    "src/subscription-payments/accounts.ts",
    "src/subscription-payments/configuration.ts",
    "src/subscription-payments/razorpay.ts",
    "src/subscription-payments/upi-sandbox.ts",
    "src/subscription-payments/reach-razorpay.ts",
    "src/application/reach-changes.ts",
    "src/application/subscription-payments.ts",
    "src/application/infrastructure-recovery.ts",
    "src/application/tax-filings.ts",
    "src/application/tax-periods.ts",
    "src/models/tax-filings.ts",
    "src/models/tax-periods.ts",
    "src/models/tax-filing-status.ts",
    "src/tax-filings/evidence.ts",
    "src/tax-periods/digest.ts",
    ...(await readdir(join(root, "src/db")))
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => `src/db/${f}`),
    ...(await readdir(join(root, "src/recovery")))
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => `src/recovery/${f}`),
    ...(await readdir(join(root, "src/recovery-trigger")))
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => `src/recovery-trigger/${f}`),
  ];
  const contents = [];
  for (const path of files)
    contents.push({
      path,
      hash: recoveryDigest(
        (await readFile(join(root, path), "utf8")).replaceAll("\r\n", "\n"),
      ),
    });
  return {
    id: "managed-drizzle-schema-v1",
    hash: recoveryDigest(JSON.stringify(contents)),
    files: contents,
  };
}
export async function requireRecoveryBundle(hash: string) {
  const bundle = await recoverySchemaBundle();
  if (bundle.hash !== hash) throw new ApplicationError("SETUP_REQUIRED");
  return bundle;
}
