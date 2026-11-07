import type { Actor, Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  filingExportSchema,
  saveFilingPolicySchema,
  decideFilingPolicySchema,
  prepareFilingSchema,
  filingActionSchema,
  storeFilingEvidenceSchema,
  remittanceReconciliationSchema,
  filingExpenseSchema,
} from "../models/tax-filings";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { createTaxFilingRepository } from "../db/tax-filing-repository";
import type { createTaxPeriodApplication } from "./tax-periods";

export function createTaxFilingApplication<Credentials>(d: {
  authenticatePlatform(
    credentials: Credentials,
  ): Promise<Actor & { sessionId: string }>;
  repository: ReturnType<typeof createTaxFilingRepository>;
  periods: Pick<
    ReturnType<typeof createTaxPeriodApplication<Credentials>>,
    "report" | "workspace"
  >;
  clock: Clock;
}) {
  async function authorized<T>(
    credentials: Credentials,
    operation: (actor: Actor) => Promise<T>,
  ) {
    const actor = await d.authenticatePlatform(credentials);
    const result = await operation(actor);
    const current = await d.authenticatePlatform(credentials);
    if (actor.userId !== current.userId)
      throw new ApplicationError("FORBIDDEN");
    await d.repository.authorize(current);
    return result;
  }
  return {
    recordExpense: (credentials: Credentials, value: unknown) => {
      const input = parse(filingExpenseSchema, value);
      return authorized(credentials, (actor) =>
        d.repository.recordExpense(actor, input),
      );
    },
    reconcileRemittance: async (credentials: Credentials, value: unknown) => {
      const input = parse(remittanceReconciliationSchema, value);
      await d.periods.report(credentials, input.reportId);
      return authorized(credentials, (actor) =>
        d.repository.reconcileRemittance(actor, input, d.clock.now()),
      );
    },
    storeEvidence: (credentials: Credentials, value: unknown) => {
      const input = parse(storeFilingEvidenceSchema, value);
      return authorized(credentials, (actor) =>
        d.repository.storeEvidence(actor, input, d.clock.now()),
      );
    },
    downloadEvidence: (credentials: Credentials, value: unknown) => {
      const input = parse(z.strictObject({ evidenceId: z.uuid() }), value);
      return authorized(credentials, async (actor) => {
        const grant = await d.repository.openEvidence(actor, input.evidenceId);
        const bytes = await d.repository.readEvidence(actor, grant);
        const current = await d.authenticatePlatform(credentials);
        if (current.userId !== actor.userId)
          throw new ApplicationError("FORBIDDEN");
        const verified = await d.repository.readEvidence(current, grant);
        if (
          !bytes.equals(verified) ||
          createHash("sha256").update(bytes).digest("hex") !==
            grant.evidence.sha256
        )
          throw new ApplicationError("CONFLICT");
        return {
          bytes: new Uint8Array(bytes),
          name: grant.evidence.name,
          contentType: grant.evidence.contentType,
          sha256: grant.evidence.sha256,
        };
      });
    },
    savePolicy: (credentials: Credentials, value: unknown) => {
      const input = parse(saveFilingPolicySchema, value);
      return authorized(credentials, (actor) =>
        d.repository.savePolicy(actor, input, d.clock.now()),
      );
    },
    decidePolicy: (credentials: Credentials, value: unknown) => {
      const input = parse(decideFilingPolicySchema, value);
      return authorized(credentials, (actor) =>
        d.repository.decidePolicy(actor, input, d.clock.now()),
      );
    },
    prepare: async (credentials: Credentials, value: unknown) => {
      const input = parse(prepareFilingSchema, value);
      await d.periods.report(credentials, input.reportId);
      return authorized(credentials, (actor) =>
        d.repository.prepare(actor, input, d.clock.now()),
      );
    },
    act: (credentials: Credentials, value: unknown) => {
      const input = parse(filingActionSchema, value);
      return authorized(credentials, (actor) =>
        d.repository.act(actor, input, d.clock.now()),
      );
    },
    exportReport: async (credentials: Credentials, value: unknown) => {
      const input = filingExportSchema.safeParse(value);
      if (!input.success) throw new ApplicationError("INVALID_INPUT");
      await d.periods.report(credentials, input.data.reportId);
      return authorized(credentials, (actor) =>
        d.repository.exportReport(actor, input.data, d.clock.now()),
      );
    },
    workspace: (credentials: Credentials) =>
      authorized(credentials, async (actor) => {
        const filings = await d.repository.workspace(actor);
        const workspace = await d.periods.workspace(credentials);
        return {
          ...workspace,
          ...filings,
          periods: workspace.periods.map((p) => ({
            ...p,
            ...p.confirmation,
            readiness: p.confirmation.configured
              ? ("configured" as const)
              : ("setup_required" as const),
          })),
        };
      }),
  };
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const input = schema.safeParse(value);
  if (!input.success) throw new ApplicationError("INVALID_INPUT");
  return input.data;
}
