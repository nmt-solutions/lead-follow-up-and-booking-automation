import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  reconciliationPeriodSchema,
  reconciliationEntrySchema,
  reconciliationEvidenceSchema,
  reconciliationReviewSchema,
} from "../models/reconciliation";
import {
  reconciliationHash,
  type createReconciliationRepository,
} from "../db/reconciliation-repository";
import { reconciliationReport } from "./reconciliation-report";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}

export function createReconciliationApplication<Credentials>(dependencies: {
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: ReturnType<typeof createReconciliationRepository>;
  clock: Clock;
}) {
  const { repository, clock } = dependencies;
  async function current(credentials: Credentials, previous?: Actor) {
    const actor = await dependencies.authenticatePlatform(credentials);
    if (previous && actor.userId !== previous.userId)
      throw new ApplicationError("FORBIDDEN");
    await repository.authorize(actor);
    return actor;
  }
  async function workspace(credentials: Credentials, input: unknown) {
    const period = parse(reconciliationPeriodSchema, input),
      actor = await current(credentials);
    const snapshot = await repository.snapshot(actor),
      report = reconciliationReport(snapshot, period);
    await current(credentials, actor);
    return report;
  }
  return {
    workspace,
    async recordEvidence(credentials: Credentials, input: unknown) {
      const data = parse(reconciliationEvidenceSchema, input),
        actor = await current(credentials);
      const bytes = Buffer.from(data.contentBase64, "base64");
      if (
        !bytes.length ||
        bytes.length > 262144 ||
        bytes.toString("base64") !== data.contentBase64 ||
        (data.contentType === "application/pdf" &&
          !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      )
        throw new ApplicationError("INVALID_INPUT");
      const result = await repository.recordEvidence(
        actor,
        data,
        reconciliationHash(bytes),
        bytes.length,
      );
      await current(credentials, actor);
      return result;
    },
    async record(credentials: Credentials, input: unknown) {
      const data = parse(reconciliationEntrySchema, input),
        actor = await current(credentials);
      if (
        new Date(data.observedAt) > clock.now() ||
        (data.kind === "settlement" &&
          data.transferAt &&
          data.transferAt > data.observedAt) ||
        (data.kind === "bank_receipt" && data.valueAt > data.observedAt)
      )
        throw new ApplicationError("INVALID_INPUT");
      if (
        data.kind === "settlement" &&
        data.lines.some(
          (l) => l.conversion && l.conversion.effectiveAt > data.observedAt,
        )
      )
        throw new ApplicationError("INVALID_INPUT");
      const saved = await repository.record(actor, data);
      await current(credentials, actor);
      return saved;
    },
    async review(credentials: Credentials, input: unknown) {
      const data = parse(reconciliationReviewSchema, input),
        actor = await current(credentials);
      const result = await repository.review(actor, data);
      await current(credentials, actor);
      return result;
    },
    async export(credentials: Credentials, input: unknown) {
      const actor = await current(credentials);
      const report = await workspace(credentials, input);
      const content = JSON.stringify(
        { ...report, generatedAt: clock.now().toISOString() },
        null,
        2,
      );
      await current(credentials, actor);
      return {
        name: "subscription-reconciliation.json",
        contentType: "application/json",
        content,
        sha256: reconciliationHash(content),
        coverage: report.coverage,
      };
    },
    async evidenceAccess(credentials: Credentials, input: unknown) {
      const data = parse(z.strictObject({ evidenceId: z.uuid() }), input),
        actor = await current(credentials);
      const result = await repository.grant(actor, data.evidenceId);
      await current(credentials, actor);
      return result;
    },
    async evidenceContent(credentials: Credentials, input: unknown) {
      const data = parse(
          z.strictObject({
            evidenceId: z.uuid(),
            token: z.string().regex(/^[a-f0-9]{64}$/),
          }),
          input,
        ),
        actor = await current(credentials);
      const evidence = await repository.content(
          actor,
          data.evidenceId,
          data.token,
        ),
        bytes = Buffer.from(evidence.contentBase64, "base64");
      if (
        reconciliationHash(bytes) !== evidence.sha256 ||
        bytes.length !== evidence.bytes
      )
        throw new ApplicationError("CONFLICT");
      await current(credentials, actor);
      await repository.checkAccess(actor, data.evidenceId, data.token);
      return {
        name: evidence.name,
        contentType: evidence.contentType,
        bytes: new Uint8Array(bytes),
        sha256: evidence.sha256,
      };
    },
  };
}
