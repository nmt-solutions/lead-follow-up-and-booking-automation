import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { RecoveryArchive } from "./postgres";
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
export async function writeRecoveryArchive(
  directory: string,
  archive: RecoveryArchive,
) {
  const id = safeId.parse(archive.manifest.id);
  await writeFile(
    join(directory, `${id}.json`),
    JSON.stringify({
      ...archive,
      ciphertext: archive.ciphertext.toString("base64"),
      iv: archive.iv.toString("base64"),
      tag: archive.tag.toString("base64"),
    }),
    { mode: 0o600, flag: "wx" },
  );
}
export async function readRecoveryArchive(
  directory: string,
  id: string,
  maxBytes: number,
): Promise<RecoveryArchive> {
  try {
    const path = join(directory, `${safeId.parse(id)}.json`);
    if ((await stat(path)).size > maxBytes * 2 + 10_000_000) throw Error();
    const bytes = await readFile(path);
    if (bytes.length > maxBytes * 2 + 10_000_000) throw Error();
    const parsed = z
      .object({
        manifest: z.unknown(),
        ciphertext: z.string().max(maxBytes * 2),
        iv: z.string(),
        tag: z.string(),
      })
      .parse(JSON.parse(bytes.toString()));
    // Manifest is authenticated and validated again by the native adapter before restore.
    const { parseRecoveryManifest } = await import("./postgres");
    return {
      manifest: parseRecoveryManifest(parsed.manifest),
      ciphertext: Buffer.from(parsed.ciphertext, "base64"),
      iv: Buffer.from(parsed.iv, "base64"),
      tag: Buffer.from(parsed.tag, "base64"),
    };
  } catch {
    throw new ApplicationError("SETUP_REQUIRED");
  }
}
