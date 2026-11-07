import {
  configuredRecoveryPlans,
  configuredRecoveryInventories,
  observeRecoveryIdentities,
} from "../src/recovery/configuration";
import { recoveryDatabase } from "../src/recovery/native-configuration";
import {
  captureRecoveryArchive,
  archiveHash,
  provisionRecoveryTarget,
} from "../src/recovery/postgres";
import { writeRecoveryArchive } from "../src/recovery/archive-store";
import {
  requireRecoveryBundle,
  recoverySchemaBundle,
} from "../src/recovery/bundle";

// Owner-only local/worker tools. No HTTP argument can provide a URL, path, SQL or executable.
const env = process.env;
const required = (key: string) => {
  const value = env[key];
  if (!value) throw Error("Missing approved recovery configuration");
  return value;
};
try {
  const action = process.argv[2];
  if (action === "bundle")
    console.log(JSON.stringify(await recoverySchemaBundle()));
  else {
    const plan = configuredRecoveryPlans(env).find(
      (p) => p.id === required("RECOVERY_PLAN_ID"),
    );
    if (!plan || plan.mode !== "configured") throw Error();
    await requireRecoveryBundle(plan.schemaHash);
    const inventory = configuredRecoveryInventories(env).find(
      (i) => i.planId === plan.id,
    );
    if (!inventory) throw Error();
    await observeRecoveryIdentities({
      plan,
      inventory,
      token: required("RECOVERY_NEON_READ_TOKEN"),
      fetch,
      now: () => new Date(),
    });
    const source = recoveryDatabase(
      required("RECOVERY_SOURCE_ADMIN_URL"),
      required("DATABASE_URL"),
    );
    const target =
      action === "provision-target"
        ? recoveryDatabase(
            required("RECOVERY_TARGET_ADMIN_URL"),
            required("RECOVERY_TARGET_RUNTIME_URL"),
          )
        : null;
    try {
      if (action === "backup") {
        const archive = await captureRecoveryArchive({
          source,
          sourceIdentity: plan.source,
          businessId: plan.businessId,
          schemaHash: plan.schemaHash,
          id: plan.backupId,
          key: Buffer.from(required("RECOVERY_BACKUP_KEY"), "base64"),
          pgDump: required("RECOVERY_PG_DUMP"),
        });
        if (archive.ciphertext.length > plan.limits.backupBytes) throw Error();
        await writeRecoveryArchive(
          required("RECOVERY_ARCHIVE_DIRECTORY"),
          archive,
        );
        console.log(
          JSON.stringify({
            backupId: archive.manifest.id,
            backupHash: archiveHash(archive),
            cutoff: archive.manifest.cutoff,
            schemaHash: archive.manifest.schemaHash,
            bytes: archive.ciphertext.length,
            next: "Review the exact output and retained file manifest; freeze a new approved registry hash before requesting recovery.",
          }),
        );
      } else if (action === "provision-target" && target) {
        if (
          target.environment.PGHOST !== plan.target.host ||
          source.environment.PGHOST !== plan.source.host ||
          plan.source.project === plan.target.project ||
          plan.source.host === plan.target.host
        )
          throw Error();
        await provisionRecoveryTarget(
          target.admin,
          required("RECOVERY_TARGET_SEAL"),
        );
        console.log(
          "Disposable target quarantine provisioned. No data has been restored or verified.",
        );
      } else throw Error();
    } finally {
      await Promise.allSettled([
        source.admin.end(),
        source.runtime.end(),
        ...(target ? [target.admin.end(), target.runtime.end()] : []),
      ]);
    }
  }
} catch {
  console.error(
    "Recovery tooling is incomplete. Check the approved identities, bundle, private artifact store and required credentials; no verification is implied.",
  );
  process.exitCode = 1;
}
