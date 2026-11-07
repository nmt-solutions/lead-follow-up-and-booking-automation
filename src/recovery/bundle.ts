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
    ...(await readdir(join(root, "src/db")))
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => `src/db/${f}`),
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
