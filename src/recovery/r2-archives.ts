import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { archiveHash, type RecoveryArchive } from "./postgres";
import { encodeRecoveryArchive, decodeRecoveryArchive } from "./archive-store";
export function createRecoveryArchiveStorage(d: {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  maxBytes: number;
}) {
  const client = new S3Client({
    endpoint: `https://${d.accountId}.us.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: {
      accessKeyId: d.accessKeyId,
      secretAccessKey: d.secretAccessKey,
    },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = (id: string) =>
    `infrastructure-backups/${z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,150}$/)
      .parse(id)}.json`;
  return {
    async put(archive: RecoveryArchive) {
      const bytes = encodeRecoveryArchive(archive);
      if (archive.ciphertext.length > d.maxBytes)
        throw new ApplicationError("SETUP_REQUIRED");
      await client.send(
        new PutObjectCommand({
          Bucket: d.bucket,
          Key: key(archive.manifest.id),
          Body: bytes,
          ContentLength: bytes.length,
          ContentType: "application/json",
          CacheControl: "private, no-store",
          IfNoneMatch: "*",
          Metadata: {
            backupid: archive.manifest.id,
            sha256: archiveHash(archive),
          },
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
    },
    async get(id: string) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: d.bucket, Key: key(id) }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      if (!result.Body || result.ContentType !== "application/json")
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const reader = result.Body.transformToWebStream().getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > d.maxBytes * 2 + 10_000_000)
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return decodeRecoveryArchive(Buffer.concat(chunks), d.maxBytes);
    },
  };
}
