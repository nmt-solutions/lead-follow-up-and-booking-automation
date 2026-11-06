import { z } from "zod";

export const supportedFileTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
] as const;
const filePolicyFields = z.strictObject({
  maxBytes: z.number().int().positive().safe(),
  allowedTypes: z.array(z.enum(supportedFileTypes)).min(1),
  uploadTtlSeconds: z.number().int().positive().max(2147483647),
  accessTtlSeconds: z.number().int().positive().max(2147483647),
  retentionSeconds: z.number().int().positive().max(2147483647),
  recordRetentionSeconds: z.number().int().positive().max(2147483647),
  operationTimeoutSeconds: z.number().int().positive().max(2147483),
  cleanupGraceSeconds: z.number().int().positive().max(2147483647),
  accountScope: z.string().min(1).max(128),
});
export const filePolicySchema = filePolicyFields.refine(
  (p) =>
    p.cleanupGraceSeconds > p.operationTimeoutSeconds &&
    p.operationTimeoutSeconds + p.cleanupGraceSeconds <= 2147483647 &&
    p.accessTtlSeconds < p.retentionSeconds &&
    p.uploadTtlSeconds < p.retentionSeconds,
);
export type FilePolicy = z.infer<typeof filePolicySchema>;
export const uploadInputSchema = z.strictObject({
  purpose: z.enum(["general", "billing"]).default("general"),
  name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((n) => !/[\x00-\x1f\x7f/\\]/.test(n)),
  contentType: z.enum(supportedFileTypes),
  size: z.number().int().positive().safe(),
});
export const fileStateSchema = z.enum([
  "pending",
  "uploading",
  "ready",
  "failed",
  "deleting",
  "deleted",
]);
export type FileState = z.infer<typeof fileStateSchema>;
export const fileViewSchema = z.object({
  purpose: z.enum(["general", "billing"]),
  id: z.uuid(),
  businessId: z.uuid(),
  ownerId: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
  state: fileStateSchema,
  accessAvailable: z.boolean(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  uploadExpiresAt: z.iso.datetime(),
  retentionUntil: z.iso.datetime(),
  cleanupAfter: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  failure: z.string().nullable(),
});
export type FileView = z.infer<typeof fileViewSchema>;
export const fileListingSchema = z.object({
  files: z.array(fileViewSchema),
  canManage: z.boolean(),
  readiness: z.enum(["configured", "setup_required"]),
  policy: filePolicyFields.omit({ accountScope: true }).nullable(),
  usage: z.object({
    storedBytes: z.number(),
    putAttempts: z.number(),
    getAttempts: z.number(),
    deleteAttempts: z.number(),
    uncertainAttempts: z.number(),
  }),
});
export type FileListing = z.infer<typeof fileListingSchema>;
export const fileGrantSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
});
export const uploadGrantSchema = fileGrantSchema.extend({
  file: fileViewSchema,
});
export type StorageObject = {
  bytes: Uint8Array;
  contentType: string;
  metadata: {
    businessId: string;
    fileId: string;
    ownerId: string;
    sha256: string;
  };
};
export type PrivateStorage = {
  put(key: string, object: StorageObject): Promise<void>;
  get(key: string, maxBytes: number): Promise<StorageObject>;
  delete(key: string): Promise<void>;
};
