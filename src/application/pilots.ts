import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  pilotPrepareSchema,
  pilotRefSchema,
  pilotEffortSchema,
  pilotResultSchema,
  pilotReuseSchema,
  pilotGateSchema,
  pilotViewSchema,
  type PilotPlan,
  type PilotGate,
} from "../models/pilots";
import type { createPilotRepository } from "../db/pilot-repository";
import type { createReportingRepository } from "../db/reporting-repository";
function parse<T>(s: z.ZodType<T>, v: unknown) {
  const result = s.safeParse(v);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
export function createPilotApplication<C>(d: {
  authenticate(credentials: C): Promise<WorkIdentity>;
  repository: ReturnType<typeof createPilotRepository>;
  reporting: ReturnType<typeof createReportingRepository>;
  clock: Clock;
  inspect(
    credentials: C,
    businessId: string,
    plan: PilotPlan,
  ): Promise<PilotGate[]>;
}) {
  async function context(c: C, b: unknown) {
    return { actor: await d.authenticate(c), id: parse(z.uuid(), b) };
  }
  async function view(c: C, businessId: string, pilotId: string) {
    const actor = await d.authenticate(c),
      rows = await d.repository.read(actor, businessId),
      p = rows.find((p) => p.id === pilotId);
    if (!p) throw new ApplicationError("NOT_FOUND");
    const canRecord = await d.repository.canRecord(actor, businessId);
    const base = await d.repository.baseGates(actor, businessId, pilotId),
      checks = parse(
        z.array(pilotGateSchema),
        await d.inspect(c, businessId, p.plan),
      );
    const required = ["retention", ...p.plan.capabilities];
    const gates = [
      ...base,
      ...required.map(
        (capability) =>
          checks.find((g) => g.capability === capability) ?? {
            capability,
            ready: false,
            reasons: [
              `Configure and verify the selected ${capability.replaceAll("_", " ")} path; credentials alone do not establish rights or usable access.`,
            ],
            destination: `/businesses/${businessId}`,
            checkedAt: d.clock.now().toISOString(),
          },
      ),
    ];
    const kinds = p.events.map((e) => e.kind),
      status = kinds.includes("stopped")
        ? "stopped"
        : kinds.includes("reuse")
          ? "reuse_recorded"
          : kinds.includes("renewal")
            ? "renewed"
            : kinds.includes("results")
              ? "measured"
              : kinds.includes("activated")
                ? new Date(p.plan.endsAt) <= d.clock.now()
                  ? "expired"
                  : gates.some((g) => !g.ready)
                    ? "paused"
                    : "active"
                : kinds.includes("approved")
                  ? "approved"
                  : "prepared";
    await d.repository.authorize(await d.authenticate(c), businessId);
    const financial = await d.repository.financial(
      await d.authenticate(c),
      businessId,
      pilotId,
    );
    return pilotViewSchema.parse({
      ...p,
      canRecord,
      gates,
      status,
      financialEvidence: {
        accounting: financial.accounting,
        pilotPaid: !!financial.initial,
        renewalPaid: !!financial.renewal,
        renewal: financial.renewal
          ? {
              periodId: financial.renewal.id,
              paymentId: financial.renewal.paymentId,
              amountMinor: financial.renewal.charge!.amountMinor!,
              paidAt: financial.renewal.charge!.paidAt!,
            }
          : null,
        reasons: [
          ...(!financial.initial
            ? [
                "Original pilot capture is unavailable or currently refunded/disputed.",
              ]
            : []),
          ...(!financial.renewal
            ? [
                "No eligible actual paid monthly continuation. Authorization, cancelled mandates, refunded or disputed payments do not validate renewal.",
              ]
            : []),
        ],
      },
      report:
        p.events.filter((e) => e.kind === "results").at(-1)?.data.report ??
        null,
    });
  }
  return {
    async prepare(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotPrepareSchema, v);
      return view(
        c,
        id,
        await d.repository.prepare(actor, id, input.requestKey, input.plan),
      );
    },
    async workspace(c: C, b: unknown) {
      const { actor, id } = await context(c, b),
        rows = await d.repository.read(actor, id);
      const pilots = [];
      for (const p of rows) pilots.push(await view(c, id, p.id));
      return {
        canRecord: await d.repository.canRecord(await d.authenticate(c), id),
        pilots,
        claims:
          "Software records do not establish a real pilot, provider approval, legal review or paid renewal. Native captures and current evidence are required." as const,
      };
    },
    async preflight(c: C, b: unknown, v: unknown) {
      const { id } = await context(c, b),
        input = parse(pilotRefSchema, v);
      return view(c, id, input.pilotId);
    },
    async approve(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotRefSchema, v);
      await d.repository.event(
        actor,
        id,
        input.pilotId,
        "approved",
        input.requestKey,
        { approvedExactFrozenPlan: true },
      );
      return view(c, id, input.pilotId);
    },
    async activate(c: C, b: unknown, v: unknown) {
      const { id } = await context(c, b),
        input = parse(pilotRefSchema, v),
        state = await view(c, id, input.pilotId);
      if (
        state.gates.some((g) => !g.ready) ||
        new Date(state.plan.startsAt) > d.clock.now() ||
        new Date(state.plan.endsAt) <= d.clock.now()
      )
        throw new ApplicationError("SETUP_REQUIRED");
      await d.repository.event(
        await d.authenticate(c),
        id,
        input.pilotId,
        "activated",
        input.requestKey,
        { gates: state.gates, softwareDoesNotProveLiveAcceptance: true },
      );
      return view(c, id, input.pilotId);
    },
    async stop(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotRefSchema, v);
      await d.repository.event(
        actor,
        id,
        input.pilotId,
        "stopped",
        input.requestKey,
        { stopped: true },
      );
      return view(c, id, input.pilotId);
    },
    async effort(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotEffortSchema, v);
      if (new Date(input.occurredAt) > d.clock.now())
        throw new ApplicationError("INVALID_INPUT");
      await d.repository.event(
        actor,
        id,
        input.pilotId,
        "effort",
        input.requestKey,
        {
          kind: input.kind,
          seconds: input.seconds,
          cashMinor: input.cashMinor,
          spendMinor: input.spendMinor,
          evidence: input.evidence,
          occurredAt: input.occurredAt,
          measurement: "attributed_actual_input",
        },
      );
      return view(c, id, input.pilotId);
    },
    async results(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotResultSchema, v),
        state = await view(c, id, input.pilotId);
      if (
        !state.events.some((e) => e.kind === "activated") ||
        new Date(input.from) < new Date(state.plan.startsAt) ||
        new Date(input.to) > d.clock.now() ||
        new Date(input.to) > new Date(state.plan.endsAt) ||
        new Date(input.from) >= new Date(input.to)
      )
        throw new ApplicationError("INVALID_INPUT");
      const report = await d.reporting.read(actor, id, {
        from: input.from,
        to: input.to,
        category: "all",
        offset: 0,
        limit: 50,
      });
      const criteria = state.plan.criteria.map((criterion) => {
        const m = report.metrics.find(
          (m) => m.id === criterion.metric && m.unit === criterion.unit,
        );
        return {
          ...criterion,
          observed: m?.value ?? null,
          denominator: m?.denominator ?? null,
          status: m?.status ?? "unavailable",
          definition:
            m?.definition ?? "No canonical measurement for this criterion.",
          met:
            m?.status === "recorded" && m.value !== null
              ? criterion.comparison === "at_least"
                ? m.value >= criterion.target
                : m.value <= criterion.target
              : null,
        };
      });
      const financial = await d.repository.financial(
        await d.authenticate(c),
        id,
        input.pilotId,
      );
      await d.repository.event(
        await d.authenticate(c),
        id,
        input.pilotId,
        "results",
        input.requestKey,
        {
          report,
          criteria,
          canonicalAccounting: financial.accounting,
          contribution: {
            ...input.contribution,
            classification:
              "Attributable operator-recorded inputs; external statement verification remains separate. Customer-paid Meta is separate.",
            netBeforeUnrecordedInputsMinor: String(
              BigInt(input.contribution.revenueExcludingTaxMinor) -
                BigInt(input.contribution.providerExpenseMinor) -
                BigInt(input.contribution.effortExpenseMinor),
            ),
            coverage: input.contribution.complete
              ? "Attributable input coverage declared complete by recorder; no automated verification of external statements."
              : "Incomplete: no full contribution or margin conclusion.",
          },
          assessment: input.assessment,
        },
      );
      return view(c, id, input.pilotId);
    },
    async renewal(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotRefSchema, v);
      await d.repository.event(
        actor,
        id,
        input.pilotId,
        "renewal",
        input.requestKey,
        {},
      );
      return view(c, id, input.pilotId);
    },
    async reuse(c: C, b: unknown, v: unknown) {
      const { actor, id } = await context(c, b),
        input = parse(pilotReuseSchema, v),
        first = await d.repository.financial(actor, id, input.pilotId),
        second = await view(c, input.secondBusinessId, input.secondPilotId);
      if (
        !first.renewal ||
        !first.p.events.some((e) => e.kind === "results") ||
        !first.p.events.some((e) => e.kind === "renewal") ||
        input.secondBusinessId === id ||
        (first.p.business.offering === second.business.offering &&
          first.p.plan.goal === second.plan.goal) ||
        !second.events.some((e) => e.kind === "activated") ||
        new Date(second.events.find((e) => e.kind === "prepared")!.at) <
          new Date(first.renewal.charge!.paidAt!)
      )
        throw new ApplicationError("CONFLICT");
      const field = z.enum([
        "scope",
        "goal",
        "capabilities",
        "criteria",
        "ceilings",
      ]);
      const reuse = input.reusedConfiguration.map((r) => {
        const a = first.p.plan[parse(field, r.first)],
          s = second.plan[parse(field, r.second)];
        const digest = (v: unknown) =>
          createHash("sha256").update(JSON.stringify(v)).digest("hex");
        return {
          ...r,
          originalHash: digest(a),
          secondHash: digest(s),
          equal: JSON.stringify(a) === JSON.stringify(s),
        };
      });
      await d.repository.event(
        await d.authenticate(c),
        id,
        input.pilotId,
        "reuse",
        input.requestKey,
        {
          secondBusinessId: input.secondBusinessId,
          secondPilotId: input.secondPilotId,
          differentNeed: input.differentNeed,
          materialDifferenceVerifiedFromAuthorizedCurrentRecords: true,
          configuration: reuse,
          adaptations: input.adaptations,
        },
      );
      return view(c, id, input.pilotId);
    },
  };
}
