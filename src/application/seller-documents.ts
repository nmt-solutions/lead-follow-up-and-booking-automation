import type { Actor, Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  saveIssuerSchema,
  decideIssuerSchema,
  issueDocumentSchema,
  recoverDocumentSchema,
  adjustDocumentSchema,
  sellerDocumentSchema,
  documentWorkspaceSchema,
} from "../models/seller-documents";
import { publicFinancialValue } from "../models/public-financial";
import { renderSellerDocument } from "./seller-document-artifact";
import { createHash, randomBytes } from "node:crypto";
import type { StorageObject } from "../models/files";
import type { PrivateStorage } from "../models/files";
import type { createSellerDocumentRepository } from "../db/seller-document-repository";
import type {
  DocumentWork,
  DocumentIdentity,
} from "../db/seller-document-repository";
import { z } from "zod";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const key = (businessId: string, id: string) =>
  `seller-documents/${businessId}/${id}`;
function matches(
  object: StorageObject,
  row: {
    id: string;
    businessId: string;
    actorId: string;
    sha256: string;
    bytes: number;
  },
) {
  return (
    object.contentType === "text/plain" &&
    object.bytes.byteLength === row.bytes &&
    hash(object.bytes) === row.sha256 &&
    object.metadata.sha256 === row.sha256 &&
    object.metadata.businessId === row.businessId &&
    object.metadata.fileId === row.id &&
    object.metadata.ownerId === row.actorId
  );
}
export function createSellerDocumentApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: ReturnType<typeof createSellerDocumentRepository>;
  clock: Clock;
  mode: "fixture" | "live";
  storage: PrivateStorage | null;
  policy: {
    accountScope: string;
    maxBytes: number;
    accessTtlSeconds: number;
    recoveryLeaseSeconds: number;
  } | null;
}) {
  const { repository, clock } = dependencies;
  async function context(
    credentials: Credentials,
    businessId: unknown,
    operator = false,
  ) {
    return {
      actor: await (operator
        ? dependencies.authenticatePlatform(credentials)
        : dependencies.authenticate(credentials)),
      businessId: parse(z.uuid(), businessId),
    };
  }
  function storageSetup() {
    if (!dependencies.storage || !dependencies.policy)
      throw new ApplicationError("FILE_SETUP_REQUIRED");
    return { storage: dependencies.storage, policy: dependencies.policy };
  }
  async function materialize(
    target:
      | { credentials: Credentials; businessId: unknown; operator: boolean }
      | { work: DocumentWork },
    id: string,
  ) {
    const operator = "work" in target ? false : target.operator;
    const currentContext = async (): Promise<{
      actor: DocumentIdentity;
      businessId: string;
    }> =>
      "work" in target
        ? {
            actor: { userId: "", work: target.work },
            businessId: target.work.business_id,
          }
        : context(target.credentials, target.businessId, target.operator);
    const ctx = await currentContext(),
      { storage, policy } = storageSetup();
    const row = await repository.read(ctx.actor, ctx.businessId, id, operator);
    if (row.accountScope !== policy.accountScope)
      throw new ApplicationError("FILE_SETUP_REQUIRED");
    if (row.artifactState === "ready")
      return repository.artifact(
        ctx.actor,
        ctx.businessId,
        id,
        "ready",
        operator,
      );
    const bytes = renderSellerDocument({ ...row, at: row.at.toISOString() });
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256)
      throw new ApplicationError("CONFLICT");
    const attempt = await repository.storageIntent(
      ctx.actor,
      ctx.businessId,
      id,
      "put",
      clock.now(),
      operator,
    );
    let confirmed = false,
      reconciled: string | null = null;
    try {
      await storage.put(key(ctx.businessId, id), {
        bytes,
        contentType: "text/plain",
        metadata: {
          businessId: ctx.businessId,
          fileId: id,
          ownerId: row.actorId,
          sha256: row.sha256,
        },
      });
      confirmed = true;
    } catch {
      // Conditional writes cannot overwrite an issued object. Resolve a lost acknowledgement
      // or precondition conflict by retrieving and checking the complete persisted identity/hash.
      reconciled = await repository.storageIntent(
        ctx.actor,
        ctx.businessId,
        id,
        "get",
        clock.now(),
        operator,
      );
      try {
        confirmed = matches(
          await storage.get(key(ctx.businessId, id), row.bytes),
          row,
        );
      } catch {
        /* Preserve the numbered intent for recovery. */
      }
    }
    const current = await currentContext();
    if (confirmed) {
      if (reconciled)
        await repository.confirmStorage(
          current.actor,
          current.businessId,
          reconciled,
          operator,
        );
      await repository.confirmStorage(
        current.actor,
        current.businessId,
        attempt,
        operator,
      );
    }
    return repository.artifact(
      current.actor,
      current.businessId,
      id,
      confirmed ? "ready" : "failed",
      operator,
    );
  }
  const application = {
    queue: async (credentials: Credentials) =>
      repository.queue(await dependencies.authenticatePlatform(credentials)),
    async workspace(
      credentials: Credentials,
      businessId: unknown,
      operator = false,
    ) {
      const ctx = await context(credentials, businessId, operator);
      return {
        ...(await repository.workspace(ctx.actor, ctx.businessId, operator)),
        storageReady: !!dependencies.storage && !!dependencies.policy,
      };
    },
    async issue(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
      operator = false,
    ) {
      const ctx = await context(credentials, businessId, operator),
        data = parse(issueDocumentSchema, input),
        { policy } = storageSetup();
      const document = await repository.issue(
        ctx.actor,
        ctx.businessId,
        data,
        clock.now(),
        dependencies.mode,
        policy,
        operator,
      );
      await materialize({ credentials, businessId, operator }, document.id);
      const state = await repository.workspace(
        ctx.actor,
        ctx.businessId,
        operator,
      );
      return state.documents.find((d) => d.id === document.id)!;
    },
    async recover(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
      operator = false,
    ) {
      const data = parse(recoverDocumentSchema, input);
      return materialize(
        { credentials, businessId, operator },
        data.documentId,
      );
    },
    async adjust(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const ctx = await context(credentials, businessId, true),
        data = parse(adjustDocumentSchema, input),
        { policy } = storageSetup();
      const document = await repository.adjust(
        ctx.actor,
        ctx.businessId,
        data,
        clock.now(),
        dependencies.mode,
        policy,
      );
      return materialize(
        { credentials, businessId, operator: true },
        document.id,
      );
    },
    async recoverPending() {
      const { policy } = storageSetup(),
        work = await repository.pending(
          policy.accountScope,
          policy.recoveryLeaseSeconds,
        );
      let failed = 0;
      for (const target of work) {
        try {
          if (
            (await materialize({ work: target }, target.id)).artifact.state !==
            "ready"
          )
            failed++;
        } catch {
          failed++;
        }
      }
      return { attempted: work.length, failed };
    },
    async createAccess(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      operator = false,
    ) {
      const ctx = await context(credentials, businessId, operator),
        documentId = parse(z.uuid(), id),
        { policy } = storageSetup();
      const row = await repository.read(
        ctx.actor,
        ctx.businessId,
        documentId,
        operator,
      );
      if (row.accountScope !== policy.accountScope)
        throw new ApplicationError("FILE_SETUP_REQUIRED");
      const token = randomBytes(32).toString("hex"),
        expiresAt = new Date(
          clock.now().getTime() + policy.accessTtlSeconds * 1000,
        );
      await repository.grant(
        ctx.actor,
        ctx.businessId,
        documentId,
        hash(token),
        expiresAt,
        operator,
      );
      return { token, expiresAt: expiresAt.toISOString() };
    },
    async download(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      token: unknown,
      operator = false,
    ) {
      const ctx = await context(credentials, businessId, operator),
        documentId = parse(z.uuid(), id),
        tokenHash = hash(parse(z.string().regex(/^[a-f0-9]{64}$/), token)),
        { storage, policy } = storageSetup();
      const row = await repository.checkGrant(
        ctx.actor,
        ctx.businessId,
        documentId,
        tokenHash,
        clock.now(),
        operator,
      );
      if (row.accountScope !== policy.accountScope)
        throw new ApplicationError("FILE_SETUP_REQUIRED");
      const attempt = await repository.storageIntent(
        ctx.actor,
        ctx.businessId,
        documentId,
        "get",
        clock.now(),
        operator,
      );
      let object: StorageObject;
      try {
        object = await storage.get(key(ctx.businessId, documentId), row.bytes);
      } catch {
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
      if (!matches(object, row))
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      const current = await context(credentials, businessId, operator);
      await repository.checkGrant(
        current.actor,
        current.businessId,
        documentId,
        tokenHash,
        clock.now(),
        operator,
      );
      await repository.confirmStorage(
        current.actor,
        current.businessId,
        attempt,
        operator,
      );
      return {
        bytes: object.bytes,
        name: `${row.number}.txt`,
        contentType: "text/plain",
      };
    },
    catalog: async (credentials: Credentials) =>
      repository.catalog(await dependencies.authenticatePlatform(credentials)),
    async saveIssuer(credentials: Credentials, input: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials),
        data = parse(saveIssuerSchema, input);
      if (
        data.configuration.evidence.some(
          (e) => new Date(e.checkedAt) > clock.now(),
        )
      )
        throw new ApplicationError("INVALID_INPUT");
      return repository.saveIssuer(actor, data, clock.now());
    },
    decideIssuer: async (credentials: Credentials, input: unknown) =>
      repository.decideIssuer(
        await dependencies.authenticatePlatform(credentials),
        parse(decideIssuerSchema, input),
        clock.now(),
      ),
  };
  return {
    ...application,
    workspace: async (...args: Parameters<typeof application.workspace>) =>
      documentWorkspaceSchema.parse(
        publicFinancialValue(await application.workspace(...args)),
      ),
    issue: async (...args: Parameters<typeof application.issue>) =>
      sellerDocumentSchema.parse(
        publicFinancialValue(await application.issue(...args)),
      ),
    adjust: async (...args: Parameters<typeof application.adjust>) =>
      sellerDocumentSchema.parse(
        publicFinancialValue(await application.adjust(...args)),
      ),
    recover: async (...args: Parameters<typeof application.recover>) =>
      sellerDocumentSchema.parse(
        publicFinancialValue(await application.recover(...args)),
      ),
  };
}
