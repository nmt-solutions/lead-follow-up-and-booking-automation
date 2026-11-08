import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  saveObligationSchema,
  decideObligationSchema,
  openTaxPeriodSchema,
  prepareTaxReportSchema,
  taxReportActionSchema,
  type SaveObligation,
  type DecideObligation,
  type OpenTaxPeriod,
  type PrepareTaxReport,
  type TaxReportActionInput,
  type ObligationRevision,
  type ObligationDecision,
  type ReportingPeriod,
  type LiabilityReport,
  type TaxPeriodWorkspace,
} from "../models/tax-periods";

export type TaxPeriodRepository = {
  saveObligation(
    actor: Actor,
    input: SaveObligation,
    at: Date,
  ): Promise<ObligationRevision>;
  decideObligation(
    actor: Actor,
    input: DecideObligation,
    at: Date,
  ): Promise<ObligationDecision>;
  openPeriod(
    actor: Actor,
    input: OpenTaxPeriod,
    at: Date,
  ): Promise<ReportingPeriod>;
  prepare(
    actor: Actor,
    input: PrepareTaxReport,
    at: Date,
  ): Promise<LiabilityReport>;
  act(
    actor: Actor,
    input: TaxReportActionInput,
    at: Date,
  ): Promise<LiabilityReport>;
  workspace(actor: Actor, at: Date): Promise<TaxPeriodWorkspace>;
  report(actor: Actor, id: string): Promise<LiabilityReport>;
  evaluateReminders(actor: Actor, at: Date): Promise<{ created: number }>;
  authorize(actor: Actor): Promise<void>;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
/** Platform-only commands. An approved report records review, never filing or payment. */
export function createTaxPeriodApplication<Credentials>(dependencies: {
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: TaxPeriodRepository;
  clock: Clock;
}) {
  const { repository, clock, authenticatePlatform } = dependencies;
  async function authorized<T>(
    credentials: Credentials,
    operation: (actor: Actor) => Promise<T>,
  ) {
    const actor = await authenticatePlatform(credentials);
    const result = await operation(actor);
    const current = await authenticatePlatform(credentials);
    if (current.userId !== actor.userId)
      throw new ApplicationError("FORBIDDEN");
    await repository.authorize(current);
    return result;
  }
  return {
    async saveObligation(credentials: Credentials, value: unknown) {
      const input = parse(saveObligationSchema, value);
      return authorized(credentials, (actor) =>
        repository.saveObligation(actor, input, clock.now()),
      );
    },
    async decideObligation(credentials: Credentials, value: unknown) {
      const input = parse(decideObligationSchema, value);
      return authorized(credentials, (actor) =>
        repository.decideObligation(actor, input, clock.now()),
      );
    },
    async openPeriod(credentials: Credentials, value: unknown) {
      const input = parse(openTaxPeriodSchema, value);
      return authorized(credentials, (actor) =>
        repository.openPeriod(actor, input, clock.now()),
      );
    },
    async prepare(credentials: Credentials, value: unknown) {
      const input = parse(prepareTaxReportSchema, value);
      return authorized(credentials, (actor) =>
        repository.prepare(actor, input, clock.now()),
      );
    },
    async act(credentials: Credentials, value: unknown) {
      const input = parse(taxReportActionSchema, value);
      return authorized(credentials, (actor) =>
        repository.act(actor, input, clock.now()),
      );
    },
    async workspace(credentials: Credentials) {
      return authorized(credentials, (actor) =>
        repository.workspace(actor, clock.now()),
      );
    },
    async evaluateReminders(credentials: Credentials) {
      return authorized(credentials, (actor) =>
        repository.evaluateReminders(actor, clock.now()),
      );
    },
    async report(credentials: Credentials, id: unknown) {
      const reportId = parse(z.uuid(), id);
      return authorized(credentials, (actor) =>
        repository.report(actor, reportId),
      );
    },
    async exportReport(credentials: Credentials, value: unknown) {
      const input = parse(
        z.strictObject({
          reportId: z.uuid(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        }),
        value,
      );
      const actor = await authenticatePlatform(credentials);
      const report = await repository.report(actor, input.reportId);
      if (
        report.digest !== input.digest ||
        report.status !== "approved" ||
        !report.current
      )
        throw new ApplicationError("CONFLICT");
      // Recheck the live session/MFA and current tax grant after reading sensitive sources.
      const currentActor = await authenticatePlatform(credentials);
      const current = await repository.report(currentActor, input.reportId);
      if (
        current.status !== "approved" ||
        !current.current ||
        current.digest !== report.digest
      )
        throw new ApplicationError("CONFLICT");
      await repository.authorize(await authenticatePlatform(credentials));
      return {
        format: "tax_liability_v1" as const,
        report: current,
        filed: false as const,
        paid: false as const,
      };
    },
  };
}
