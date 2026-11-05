import { createHash } from "node:crypto";
import { z } from "zod";
import { filePolicySchema } from "../models/files";
import { createR2Storage } from "./r2";

const storageEnvironment = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
  R2_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_PRIVATE_US_CONFIRMED: z.literal("true"),
  FILE_CLEANUP_SCHEDULE_CONFIRMED: z.literal("true"),
  FILE_POLICY_JSON: z.string().min(1),
  TRIGGER_PROJECT_REF: z.string().min(1),
  TRIGGER_SECRET_KEY: z.string().min(1),
});
export function readFilesConfiguration(
  environment: Record<string, string | undefined>,
) {
  const parsed = storageEnvironment.safeParse(environment);
  if (!parsed.success) return { policy: null, storage: null };
  const env = parsed.data;
  try {
    const input: unknown = JSON.parse(env.FILE_POLICY_JSON);
    if (!input || typeof input !== "object" || Array.isArray(input))
      return { policy: null, storage: null };
    const policy = filePolicySchema.parse({
      ...input,
      accountScope: createHash("sha256")
        .update(`${env.R2_ACCOUNT_ID}:${env.R2_BUCKET}:us`)
        .digest("hex"),
    });
    return {
      policy,
      storage: createR2Storage({
        accountId: env.R2_ACCOUNT_ID,
        bucket: env.R2_BUCKET,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        timeoutSeconds: policy.operationTimeoutSeconds,
      }),
    };
  } catch {
    return { policy: null, storage: null };
  }
}
