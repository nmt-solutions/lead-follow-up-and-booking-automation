import type { Actor, Clock } from "../models/business";
import {
  costMonthSchema,
  recordCostSchema,
  costPlanningSchema,
  costBudgetSchema,
  type CostWorkspace,
  type CostAuthority,
  type CostMailer,
} from "../models/costs";
import { projectCosts } from "../costs/projection";
import type { createCostRepository } from "../db/cost-repository";
import { ApplicationError } from "../models/application-error";
import { z } from "zod";

export function createCostApplication<Credentials>(dependencies: {
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: ReturnType<typeof createCostRepository>;
  clock: Clock;
  mailer?: CostMailer | null;
  scheduleConfigured?: boolean;
}) {
  const repository = dependencies.repository;
  async function workspace(
    actor: CostAuthority,
    month: string,
  ): Promise<CostWorkspace> {
    const state = await repository.records(actor, month);
    return {
      ...projectCosts(
        month,
        state.history,
        state.planningHistory,
        dependencies.clock.now(),
        state.nativeScanAt,
      ),
      operatorId: actor.userId,
      delivery: {
        emailConfigured: Boolean(dependencies.mailer),
        scheduleConfigured: dependencies.scheduleConfigured ?? false,
      },
      budgets: state.budgets,
      alerts: state.alerts,
    };
  }
  async function deliver(
    actor: CostAuthority,
    month: string,
    reauthorize?: () => Promise<Actor>,
  ) {
    if (!dependencies.mailer) return;
    const state = await workspace(actor, month);
    for (const alert of state.alerts) {
      if (actor.work && alert.budgetId !== actor.work.budgetId) continue;
      await reauthorize?.();
      const claim = await repository.claim(actor, alert.id);
      if (!claim) continue;
      try {
        await reauthorize?.();
        if (!(await repository.deliverable(actor, claim.id, claim.lease_key)))
          continue;
        const receipt = await dependencies.mailer.send({
          key: `operator-cost/${claim.id}`,
          email: claim.email,
          text: claim.summary,
          authority: {
            alertId: claim.id,
            lease: claim.lease_key,
            actorId: actor.userId,
          },
        });
        const parsed = z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,256}$/) })
          .safeParse(receipt);
        await repository.finish(
          claim.id,
          claim.lease_key,
          parsed.success ? parsed.data.id : null,
        );
      } catch {
        await repository.finish(claim.id, claim.lease_key, null);
      }
    }
  }
  return {
    async setBudget(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = costBudgetSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await repository.setBudget(actor, parsed.data);
    },
    async evaluate(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = costMonthSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await repository.evaluate(actor, await workspace(actor, parsed.data));
      await deliver(actor, parsed.data, () =>
        dependencies.authenticatePlatform(credentials),
      );
    },
    async acknowledge(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = z
        .strictObject({ id: z.uuid(), note: z.string().trim().min(1).max(300) })
        .safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await repository.acknowledge(actor, parsed.data.id, parsed.data.note);
    },
    // Trigger owns scheduling/retry; each persisted budget is an explicit, revocable delegation.
    async recoverPending() {
      const work = await repository.work();
      let evaluated = 0;
      const scanned = new Set<string>();
      for (const identity of work) {
        const actor: CostAuthority = {
          userId: identity.userId,
          work: identity,
        };
        try {
          const state = await workspace(actor, identity.month);
          const budget = state.budgets.find((b) => b.id === identity.budgetId);
          if (!budget) continue;
          if (!scanned.has(identity.month)) {
            await repository.refresh(
              actor,
              identity.month,
              Math.max(
                ...state.budgets
                  .filter((b) => b.automationActive)
                  .map((b) => b.retentionSeconds),
              ),
            );
            scanned.add(identity.month);
          }
          await repository.evaluate(
            actor,
            await workspace(actor, identity.month),
          );
          await deliver(actor, identity.month);
          evaluated++;
        } catch (error: unknown) {
          if (error instanceof ApplicationError && error.code === "FORBIDDEN")
            continue;
          throw error;
        }
      }
      return { evaluated };
    },
    async record(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = recordCostSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await dependencies.repository.record(actor, parsed.data);
    },
    async configure(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = costPlanningSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await dependencies.repository.configure(actor, parsed.data);
    },
    async refresh(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = z
        .strictObject({
          month: costMonthSchema,
          retentionSeconds: z.number().int().min(60).max(2147483647),
        })
        .safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await dependencies.repository.refresh(
        actor,
        parsed.data.month,
        parsed.data.retentionSeconds,
      );
    },
    async workspace(
      credentials: Credentials,
      value: unknown,
    ): Promise<CostWorkspace> {
      const actor = await dependencies.authenticatePlatform(credentials);
      const parsed = costMonthSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      return workspace(actor, parsed.data);
    },
  };
}
