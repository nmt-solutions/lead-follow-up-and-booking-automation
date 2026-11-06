import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  filePolicySchema,
  uploadInputSchema,
  type FilePolicy,
  type FileView,
  type FileListing,
  type PrivateStorage,
} from "../models/files";
import type { FileRepository, FileRecord } from "../db/file-repository";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
function isAvailable(
  file: FileRecord,
  at: Date,
  accountScope: string | undefined,
) {
  return (
    file.state === "ready" &&
    file.retentionUntil > at &&
    file.accountScope === accountScope
  );
}
function view(
  file: FileRecord,
  at: Date,
  accountScope: string | undefined,
): FileView {
  return {
    id: file.id,
    purpose: file.purpose,
    businessId: file.businessId,
    ownerId: file.ownerId,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    state: file.state,
    accessAvailable: isAvailable(file, at, accountScope),
    createdAt: file.createdAt.toISOString(),
    completedAt: file.completedAt?.toISOString() ?? null,
    uploadExpiresAt: file.uploadExpiresAt.toISOString(),
    retentionUntil: file.retentionUntil.toISOString(),
    cleanupAfter: file.cleanupAfter?.toISOString() ?? null,
    deletedAt: file.deletedAt?.toISOString() ?? null,
    failure: file.failure,
  };
}
function validContents(type: string, bytes: Uint8Array) {
  const prefix = Buffer.from(bytes.subarray(0, 8));
  if (type === "application/pdf")
    return prefix.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/png")
    return prefix.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type !== "text/plain" || bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
export const fileObjectKey = (businessId: string, id: string) =>
  `business-files/${businessId}/${id}`;

export function createFileApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  repository: FileRepository;
  storage: PrivateStorage | null;
  policy: FilePolicy | null;
  clock: Clock;
}) {
  const { repository, clock } = dependencies;
  const policy = dependencies.policy
    ? parse(filePolicySchema, dependencies.policy)
    : null;
  const fileView = (file: FileRecord) =>
    view(file, clock.now(), policy?.accountScope);
  function configured() {
    if (!policy || !dependencies.storage)
      throw new ApplicationError("FILE_SETUP_REQUIRED");
    return { policy, storage: dependencies.storage };
  }
  async function context(
    credentials: Credentials,
    businessId: unknown,
    id?: unknown,
  ) {
    return {
      actor: await dependencies.authenticate(credentials),
      businessId: parse(businessIdSchema, businessId),
      id: id === undefined ? "" : parse(z.uuid(), id),
    };
  }
  function available(file: FileRecord) {
    const { policy } = configured();
    if (!isAvailable(file, clock.now(), policy.accountScope))
      throw new ApplicationError("FILE_UNAVAILABLE");
  }
  return {
    async list(
      credentials: Credentials,
      businessId: unknown,
    ): Promise<FileListing> {
      const ctx = await context(credentials, businessId);
      const result = await repository.list(ctx.actor, ctx.businessId);
      return {
        files: result.data.files.map(fileView),
        canManage: result.role === "owner" || result.role === "admin",
        readiness:
          policy && dependencies.storage ? "configured" : "setup_required",
        policy: policy
          ? {
              maxBytes: policy.maxBytes,
              allowedTypes: policy.allowedTypes,
              uploadTtlSeconds: policy.uploadTtlSeconds,
              accessTtlSeconds: policy.accessTtlSeconds,
              retentionSeconds: policy.retentionSeconds,
              recordRetentionSeconds: policy.recordRetentionSeconds,
              operationTimeoutSeconds: policy.operationTimeoutSeconds,
              cleanupGraceSeconds: policy.cleanupGraceSeconds,
            }
          : null,
        usage: {
          storedBytes: result.data.files
            .filter((f) => f.state !== "deleted" && f.state !== "pending")
            .reduce((n, f) => n + f.size, 0),
          putAttempts: result.data.usage.filter((u) => u.action === "put")
            .length,
          getAttempts: result.data.usage.filter((u) => u.action === "get")
            .length,
          deleteAttempts: result.data.usage.filter((u) => u.action === "delete")
            .length,
          uncertainAttempts: result.data.usage.filter(
            (u) => u.outcome === "uncertain",
          ).length,
        },
      };
    },
    async beginUpload(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const ctx = await context(credentials, businessId);
      const { policy } = configured();
      const data = parse(uploadInputSchema, input);
      if (
        data.size > policy.maxBytes ||
        !policy.allowedTypes.includes(data.contentType)
      )
        throw new ApplicationError("FILE_DISALLOWED");
      const at = clock.now(),
        token = randomBytes(32).toString("hex");
      const expiresAt = new Date(at.getTime() + policy.uploadTtlSeconds * 1000);
      const file: FileRecord = {
        ...data,
        id: randomUUID(),
        businessId: ctx.businessId,
        ownerId: ctx.actor.userId,
        accountScope: policy.accountScope,
        state: "pending",
        uploadHash: hash(token),
        uploadExpiresAt: expiresAt,
        createdAt: at,
        completedAt: null,
        retentionUntil: new Date(at.getTime() + policy.retentionSeconds * 1000),
        recordRetentionSeconds: policy.recordRetentionSeconds,
        cleanupAfter: expiresAt,
        purgeAfter: null,
        deletedAt: null,
        operationId: null,
        sha256: null,
        failure: null,
      };
      await repository.create(ctx.actor, file);
      return {
        file: fileView(file),
        token,
        expiresAt: expiresAt.toISOString(),
      };
    },
    async completeUpload(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      token: unknown,
      bytes: Uint8Array,
    ) {
      const ctx = await context(credentials, businessId, id);
      const { policy, storage } = configured();
      const tokenHash = hash(parse(tokenSchema, token));
      const operationId = randomUUID(),
        at = clock.now();
      const file = await repository.change(
        ctx.actor,
        ctx.businessId,
        ctx.id,
        (file) => {
          if (
            file.ownerId !== ctx.actor.userId ||
            file.uploadHash !== tokenHash ||
            file.uploadExpiresAt <= at ||
            file.retentionUntil <= at ||
            file.state !== "pending" ||
            file.accountScope !== policy.accountScope
          )
            throw new ApplicationError("FILE_UNAVAILABLE");
          if (
            bytes.byteLength !== file.size ||
            bytes.byteLength > policy.maxBytes ||
            !policy.allowedTypes.includes(
              parse(uploadInputSchema.shape.contentType, file.contentType),
            ) ||
            !validContents(file.contentType, bytes)
          )
            throw new ApplicationError("FILE_DISALLOWED");
          return {
            state: "uploading",
            operationId,
            sha256: hash(bytes),
            cleanupAfter: new Date(
              at.getTime() +
                (policy.operationTimeoutSeconds + policy.cleanupGraceSeconds) *
                  1000,
            ),
          };
        },
        { id: operationId, at, action: "put" },
      );
      try {
        await storage.put(fileObjectKey(ctx.businessId, ctx.id), {
          bytes,
          contentType: file.contentType,
          metadata: {
            businessId: ctx.businessId,
            fileId: ctx.id,
            ownerId: file.ownerId,
            sha256: hash(bytes),
          },
        });
      } catch {
        await repository.change(ctx.actor, ctx.businessId, ctx.id, (current) =>
          current.operationId === operationId && current.state === "uploading"
            ? { state: "failed", failure: "UPLOAD_UNCONFIRMED" }
            : { failure: current.failure },
        );
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
      await dependencies.authenticate(credentials);
      await repository.confirmUsage(ctx.actor, ctx.businessId, operationId);
      const completed = await repository.change(
        ctx.actor,
        ctx.businessId,
        ctx.id,
        (current) => {
          if (
            current.operationId !== operationId ||
            current.state !== "uploading" ||
            !current.cleanupAfter ||
            current.cleanupAfter <= clock.now() ||
            current.uploadExpiresAt <= clock.now() ||
            current.retentionUntil <= clock.now()
          )
            throw new ApplicationError("FILE_UNAVAILABLE");
          return {
            state: "ready",
            completedAt: clock.now(),
            cleanupAfter: current.retentionUntil,
            failure: null,
          };
        },
      );
      return fileView(completed);
    },
    async createAccess(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
    ) {
      const ctx = await context(credentials, businessId, id);
      const { policy } = configured();
      const token = randomBytes(32).toString("hex"),
        file = await repository.read(ctx.actor, ctx.businessId, ctx.id);
      available(file);
      const expiresAt = new Date(
        Math.min(
          clock.now().getTime() + policy.accessTtlSeconds * 1000,
          file.retentionUntil.getTime(),
        ),
      );
      await repository.grant(
        ctx.actor,
        ctx.businessId,
        ctx.id,
        { tokenHash: hash(token), expiresAt },
        available,
      );
      return { token, expiresAt: expiresAt.toISOString() };
    },
    async download(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      token: unknown,
    ) {
      const ctx = await context(credentials, businessId, id);
      const { storage } = configured();
      const { file, operationId, expiresAt } = await repository.claimDownload(
        ctx.actor,
        ctx.businessId,
        ctx.id,
        hash(parse(tokenSchema, token)),
        clock.now(),
        available,
      );
      let object;
      try {
        object = await storage.get(
          fileObjectKey(ctx.businessId, ctx.id),
          file.size,
        );
      } catch {
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
      if (
        object.bytes.byteLength !== file.size ||
        object.contentType !== file.contentType ||
        object.metadata.fileId !== file.id ||
        object.metadata.businessId !== file.businessId ||
        object.metadata.ownerId !== file.ownerId ||
        object.metadata.sha256 !== file.sha256 ||
        hash(object.bytes) !== file.sha256
      )
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      await repository.confirmUsage(ctx.actor, ctx.businessId, operationId);
      // Recheck current membership/MFA/state after external I/O, before releasing bytes.
      const current = await context(credentials, businessId, id);
      const latest = await repository.read(
        current.actor,
        current.businessId,
        current.id,
      );
      available(latest);
      if (expiresAt <= clock.now())
        throw new ApplicationError("FILE_UNAVAILABLE");
      return { bytes: object.bytes, file: fileView(latest) };
    },
    async deleteFile(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
    ) {
      const ctx = await context(credentials, businessId, id);
      configured();
      return fileView(
        await repository.change(ctx.actor, ctx.businessId, ctx.id, (file) => {
          if (file.state === "deleted" || file.state === "deleting")
            return { state: file.state };
          return {
            state: "deleting",
            cleanupAfter:
              file.state === "uploading" || file.state === "failed"
                ? file.cleanupAfter
                : clock.now(),
          };
        }),
      );
    },
    async cleanup() {
      const { policy, storage } = configured();
      const targets = await repository.claimCleanup(
        policy.accountScope,
        clock.now(),
        policy.operationTimeoutSeconds + policy.cleanupGraceSeconds,
      );
      let failed = 0;
      for (const target of targets) {
        let success = true;
        try {
          await storage.delete(fileObjectKey(target.business_id, target.id));
        } catch {
          success = false;
          failed++;
        }
        await repository.finishCleanup(
          target.id,
          target.operation_id,
          clock.now(),
          success,
        );
      }
      return { attempted: targets.length, failed };
    },
  };
}
