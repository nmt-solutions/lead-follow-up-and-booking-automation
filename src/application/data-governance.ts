import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  dataPolicySchema,
  exportInputSchema,
  offboardInputSchema,
  samePolicy,
  dataPolicyViewSchema,
  recordDataEvidenceSchema,
  type DataPolicy,
  type DataWorkspace,
  type NativeCleanup,
  type RevocationOutcome,
} from "../models/data-governance";
import type { PrivateStorage } from "../models/files";
import {
  dataHash,
  dataExportKey,
  customerText,
  type DataGovernanceRepository,
} from "../db/data-governance-repository";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ApplicationError("INVALID_INPUT");
  return r.data;
}
export function createDataGovernanceApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<Actor>;
  repository: DataGovernanceRepository;
  clock: Clock;
  storage: PrivateStorage | null;
  storageScope?: string;
  policy: () => DataPolicy | null;
  revoke: (target: NativeCleanup) => Promise<RevocationOutcome>;
  cancel?: (
    credentials: Credentials,
    businessId: string,
    input: { actionId: string; requestKey: string },
  ) => Promise<unknown>;
  documents?: {
    createAccess(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
    ): Promise<{ token: string }>;
    download(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      token: unknown,
    ): Promise<{ bytes: Uint8Array; name: string; contentType: string }>;
  };
}) {
  async function context(credentials: Credentials, businessId: unknown) {
    const actor = await d.authenticate(credentials),
      id = parse(z.uuid(), businessId);
    await d.repository.access(actor, id, async () => {});
    return { actor, id };
  }
  function configured(id: string) {
    const p = dataPolicySchema.safeParse(d.policy());
    if (
      !p.success ||
      !p.data.businessIds.includes(id) ||
      new Date(p.data.effectiveFrom) > d.clock.now() ||
      new Date(p.data.effectiveUntil) <= d.clock.now()
    )
      throw new ApplicationError("DATA_POLICY_REQUIRED");
    return p.data;
  }
  function storage() {
    if (!d.storage) throw new ApplicationError("FILE_SETUP_REQUIRED");
    return d.storage;
  }
  const app = {
    async recordEvidence(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        value = parse(recordDataEvidenceSchema, input);
      await d.repository.recordEvidence(c.actor, c.id, value);
    },
    async workspace(
      credentials: Credentials,
      businessId: unknown,
    ): Promise<DataWorkspace> {
      const c = await context(credentials, businessId),
        r = await d.repository.workspace(c.actor, c.id);
      let policy: DataPolicy | null = null;
      try {
        policy = configured(c.id);
      } catch {
        /* Visible missing/withdrawn policy. */
      }
      return {
        policy: policy
          ? dataPolicyViewSchema.parse(
              customerText({
                ...policy,
                deletion: policy.deletion
                  ? {
                      ...policy.deletion,
                      holdCount: policy.deletion.holds.length,
                    }
                  : null,
              }),
            )
          : null,
        stopped: r.requests[0]?.kind === "offboard",
        exports: r.exports.map((e) => ({
          id: e.id,
          state: e.state,
          bytes: e.bytes,
          sha256: e.sha256,
          createdAt: e.createdAt.toISOString(),
          part: e.part,
          expiresAt: e.expiresAt.toISOString(),
          cleanupAttempts: e.cleanupAttempts,
          cleanupLimit: e.policy.maxAttempts,
          nextCleanupAt: e.cleanupDueAt.toISOString(),
        })),
        offboarding: r.requests.map((request) => ({
          id: request.id,
          kind: request.kind,
          policyId: request.policy.id,
          policyVersion: request.policy.version,
          createdAt: request.at.toISOString(),
          cancellation: request.input?.cancellation ?? null,
          steps: r.steps
            .filter((s) => s.requestId === request.id)
            .map((step) => ({
              id: step.id,
              kind: step.kind,
              targetId: step.targetId,
              state: step.state,
              attempts: step.attempts,
              outcome: step.outcome,
              tokenWiped: step.tokenWiped,
              history: r.events
                .filter((e) => e.stepId === step.id)
                .map((e) => ({
                  id: e.id,
                  at: e.at.toISOString(),
                  outcome: e.outcome,
                  actorId: e.actorId,
                  evidence: e.evidence,
                })),
              control:
                step.kind === "meta"
                  ? "Customer account and number remain in place. No transfer or customer payment-account closure performed."
                  : null,
            })),
        })),
      };
    },
    async offboard(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(offboardInputSchema, input),
        p = configured(c.id);
      if (
        v.policyId !== p.id ||
        v.policyVersion !== p.version ||
        (v.deleteGeneralFiles && (!p.deletion || !p.deletion.generalFiles))
      )
        throw new ApplicationError("DATA_POLICY_REQUIRED");
      if (v.cancellation && !d.cancel)
        throw new ApplicationError("DATA_POLICY_REQUIRED");
      const result = await d.repository.offboard(c.actor, c.id, v, p);
      // Local fencing commits before potentially slow native billing cancellation.
      // #46 owns immutable cancellation intent, policy and native reconciliation.
      if (result.cancellation)
        await d.cancel!(credentials, c.id, {
          actionId: result.cancellation.actionId,
          requestKey: result.cancellation.requestKey,
        });
      return { id: result.id };
    },
    async reopen(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        p = configured(c.id),
        v = parse(
          z.strictObject({
            requestKey: z.uuid(),
            policyId: z.string(),
            policyVersion: z.number().int(),
            confirm: z.literal(true),
          }),
          input,
        );
      if (v.policyId !== p.id || v.policyVersion !== p.version)
        throw new ApplicationError("DATA_POLICY_REQUIRED");
      await d.repository.reopen(c.actor, c.id, v.requestKey, p);
    },
    async cleanup() {
      const expiredSecrets = await d.repository.expireSecrets();
      const parsed = dataPolicySchema.safeParse(d.policy());
      const scope =
        d.storageScope ??
        (parsed.success ? parsed.data.storageScope : undefined);
      const exports =
        scope && d.storage ? await d.repository.claimExpiredExports(scope) : [];
      for (const target of exports) {
        let success = false;
        try {
          await storage().delete(dataExportKey(target.business_id, target.id));
          success = true;
        } catch {
          /* Accountable bounded retry, exact artifact key only. */
        }
        await d.repository.finishExpiredExport(
          target.id,
          target.lease,
          success,
        );
      }
      if (!parsed.success)
        return {
          attempted: 0,
          incomplete: 0,
          expiredSecrets,
          expiredExports: exports.length,
          policy: "missing",
        };
      const p = parsed.data,
        targets = await d.repository.claimCleanup(p);
      let incomplete = 0;
      for (const target of targets) {
        let outcome: RevocationOutcome = "unconfirmed";
        try {
          const currentPolicy = d.policy();
          if (!currentPolicy || !samePolicy(currentPolicy, p))
            outcome = "unconfirmed";
          else if (target.kind === "file" || target.kind === "artifact") {
            // Exact persisted key only. Seller-document namespaces are never targets.
            await storage().delete(
              target.kind === "file"
                ? `business-files/${target.businessId}/${parse(z.uuid(), target.targetId)}`
                : dataExportKey(
                    target.businessId,
                    parse(z.uuid(), target.targetId),
                  ),
            );
            outcome = "confirmed";
          } else if (target.details.shared === "true")
            outcome = "shared_identity";
          else if (!p.nativeRevocation) outcome = "manual_required";
          else
            outcome = parse(
              z.enum([
                "confirmed",
                "subscription_removed",
                "manual_required",
                "shared_identity",
                "unconfirmed",
              ]),
              await d.revoke(target),
            );
        } catch {
          /* No provider URL, token or private payload enters history. */
        }
        if (outcome !== "confirmed") incomplete++;
        await d.repository.finishCleanup(target, outcome);
      }
      return {
        attempted: targets.length,
        incomplete,
        expiredExports: exports.length,
        expiredSecrets,
        policy: "configured",
      };
    },
    async export(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(exportInputSchema, input),
        p = configured(c.id),
        s = storage();
      const request = await d.repository.beginExport(
        c.actor,
        c.id,
        v.requestKey,
        p,
        v.part,
      );
      if (request.state === "ready") return { id: request.id };
      if (request.state !== "pending")
        throw new ApplicationError("FILE_UNAVAILABLE");
      const bundle = await d.repository.collect(c.actor, c.id, p, v.part);
      const attachments: {
        documentId: string;
        sha256: string;
        name?: string;
        contentType?: string;
        base64?: string;
        omission?: string;
      }[] = [];
      let attachmentBytes = 0;
      let attachmentReads = 0;
      for (const value of bundle.records.seller_document) {
        const doc = parse(
          z.object({
            id: z.uuid(),
            bytes: z.number().int().positive(),
            sha256: z.string(),
            artifact_state: z.string(),
          }),
          value,
        );
        const attachment: {
          documentId: string;
          sha256: string;
          name?: string;
          contentType?: string;
          base64?: string;
          omission?: string;
        } = { documentId: doc.id, sha256: doc.sha256 };
        attachments.push(attachment);
        if (!d.documents || doc.artifact_state !== "ready") {
          attachment.omission =
            "Private issued artifact unavailable; immutable snapshot and original hash retained.";
          continue;
        }
        if (attachmentReads >= 10) {
          attachment.omission =
            "Attachment read bound (10) reached; use the authorized document download.";
          continue;
        }
        if (attachmentBytes + Math.ceil((doc.bytes * 4) / 3) > p.maxBytes) {
          attachment.omission =
            "Attachment exceeds approved bundle byte bound; use the authorized document download.";
          continue;
        }
        const grant = await d.documents.createAccess(credentials, c.id, doc.id);
        attachmentReads++;
        const content = await d.documents.download(
          credentials,
          c.id,
          doc.id,
          grant.token,
        );
        if (
          content.bytes.byteLength !== doc.bytes ||
          dataHash(content.bytes) !== doc.sha256
        )
          throw new ApplicationError("FILE_UNAVAILABLE");
        if (
          /https?:\/\/[^\s]+[?#]|\bBearer\s+|https?:\/\/[^\s]*(?:auth|callback|invite|magic|reset|verify|token|sign[-_]?in|login|recovery)|\b(?:password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]/i.test(
            new TextDecoder().decode(content.bytes),
          )
        ) {
          attachment.omission =
            "Original attachment contains a possible private URL or bearer value; retrieve through separately authorized document access.";
          continue;
        }
        attachment.base64 = Buffer.from(content.bytes).toString("base64");
        attachment.name = content.name;
        attachment.contentType = content.contentType;
        attachmentBytes += Math.ceil((doc.bytes * 4) / 3);
      }
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          ...bundle,
          manifest: {
            ...bundle.manifest,
            createdAt: request.createdAt.toISOString(),
          },
          attachments,
        }),
      );
      if (bytes.byteLength > p.maxBytes)
        throw new ApplicationError("EXPORT_LIMIT_REACHED");
      const beforePut = await context(credentials, businessId);
      if (
        beforePut.actor.userId !== c.actor.userId ||
        !samePolicy(configured(c.id), p)
      )
        throw new ApplicationError("FORBIDDEN");
      const frozen = await d.repository.freezeExport(
        beforePut.actor,
        c.id,
        request.id,
        bytes.byteLength,
        dataHash(bytes),
      );
      if (frozen.state === "ready") return { id: request.id };
      if (!frozen.bytes || !frozen.sha256 || frozen.bytes > p.maxBytes)
        throw new ApplicationError("FILE_UNAVAILABLE");
      try {
        if (
          frozen.sha256 !== dataHash(bytes) ||
          frozen.bytes !== bytes.byteLength
        )
          throw new Error("Reconcile original immutable package");
        await s.put(dataExportKey(c.id, request.id), {
          bytes,
          contentType: "application/json",
          metadata: {
            businessId: c.id,
            fileId: request.id,
            ownerId: c.actor.userId,
            sha256: frozen.sha256,
          },
        });
      } catch {
        let existing;
        try {
          existing = await s.get(dataExportKey(c.id, request.id), frozen.bytes);
        } catch {
          throw new ApplicationError("PROVIDER_UNAVAILABLE");
        }
        if (
          existing.bytes.byteLength !== frozen.bytes ||
          existing.contentType !== "application/json" ||
          existing.metadata.businessId !== c.id ||
          existing.metadata.fileId !== request.id ||
          existing.metadata.ownerId !== c.actor.userId ||
          existing.metadata.sha256 !== frozen.sha256 ||
          dataHash(existing.bytes) !== frozen.sha256
        )
          throw new ApplicationError("FILE_UNAVAILABLE");
      }
      const current = await context(credentials, businessId);
      if (
        current.actor.userId !== c.actor.userId ||
        !samePolicy(configured(c.id), p)
      )
        throw new ApplicationError("FORBIDDEN");
      await d.repository.finishExport(
        current.actor,
        c.id,
        request.id,
        frozen.bytes,
        frozen.sha256,
      );
      return { id: request.id };
    },
    async access(credentials: Credentials, businessId: unknown, id: unknown) {
      const c = await context(credentials, businessId),
        p = configured(c.id),
        key = parse(z.uuid(), id),
        token = randomBytes(32).toString("hex");
      const expiresAt = await d.repository.grant(
        c.actor,
        c.id,
        key,
        dataHash(token),
        p,
      );
      return { token, expiresAt: expiresAt.toISOString() };
    },
    async download(
      credentials: Credentials,
      businessId: unknown,
      id: unknown,
      token: unknown,
    ) {
      const c = await context(credentials, businessId),
        p = configured(c.id),
        key = parse(z.uuid(), id),
        t = parse(z.string().regex(/^[a-f0-9]{64}$/), token);
      const claim = await d.repository.claimDownload(
        c.actor,
        c.id,
        key,
        dataHash(t),
      );
      if (!samePolicy(claim.artifact.policy, p))
        throw new ApplicationError("FILE_UNAVAILABLE");
      if (!claim.artifact.bytes || claim.artifact.bytes > p.maxBytes)
        throw new ApplicationError("FILE_UNAVAILABLE");
      const object = await storage().get(
        dataExportKey(c.id, key),
        claim.artifact.bytes,
      );
      const current = await context(credentials, businessId),
        latest = await d.repository.readExport(current.actor, c.id, key);
      if (
        current.actor.userId !== c.actor.userId ||
        !samePolicy(configured(c.id), p) ||
        latest.state !== "ready" ||
        object.bytes.byteLength !== latest.bytes ||
        object.contentType !== "application/json" ||
        object.metadata.businessId !== c.id ||
        object.metadata.fileId !== key ||
        object.metadata.ownerId !== c.actor.userId ||
        object.metadata.sha256 !== latest.sha256 ||
        dataHash(object.bytes) !== latest.sha256
      )
        throw new ApplicationError("FILE_UNAVAILABLE");
      await d.repository.access(current.actor, c.id, async (tx) => {
        const { dataNow } = await import("../db/data-governance-repository");
        const at = await dataNow(tx);
        if (claim.expiresAt <= at || latest.expiresAt <= at)
          throw new ApplicationError("FILE_UNAVAILABLE");
      });
      return { bytes: object.bytes, name: `business-${c.id}-${key}.json` };
    },
  };
  return app;
}
