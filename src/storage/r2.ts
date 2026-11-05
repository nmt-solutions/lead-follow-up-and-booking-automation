import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type { PrivateStorage } from "../models/files";

const metadataSchema = z.object({
  businessid: z.uuid(),
  fileid: z.uuid(),
  ownerid: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function createR2Storage(options: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  timeoutSeconds: number;
}): PrivateStorage {
  const client = new S3Client({
    endpoint: `https://${options.accountId}.us.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const signal = () => AbortSignal.timeout(options.timeoutSeconds * 1000);
  return {
    async put(key, object) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: object.bytes,
          ContentLength: object.bytes.byteLength,
          ContentType: object.contentType,
          CacheControl: "private, no-store",
          IfNoneMatch: "*",
          Metadata: {
            businessid: object.metadata.businessId,
            fileid: object.metadata.fileId,
            ownerid: object.metadata.ownerId,
            sha256: object.metadata.sha256,
          },
        }),
        { abortSignal: signal() },
      );
    },
    async get(key, maxBytes) {
      const abort = signal();
      const result = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        { abortSignal: abort },
      );
      if (!result.Body) throw new Error("Invalid storage response");
      const reader = result.Body.transformToWebStream().getReader();
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      abort.addEventListener("abort", cancel, { once: true });
      try {
        const metadata = metadataSchema.parse(result.Metadata);
        if (result.ContentLength !== maxBytes || !result.ContentType)
          throw new Error("Invalid storage metadata");
        let size = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
          abort.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes)
            throw new Error("Storage response exceeds expected size");
          chunks.push(chunk.value);
        }
        abort.throwIfAborted();
        return {
          bytes: Buffer.concat(chunks),
          contentType: result.ContentType,
          metadata: {
            businessId: metadata.businessid,
            fileId: metadata.fileid,
            ownerId: metadata.ownerid,
            sha256: metadata.sha256,
          },
        };
      } finally {
        abort.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
        { abortSignal: signal() },
      );
    },
  };
}
