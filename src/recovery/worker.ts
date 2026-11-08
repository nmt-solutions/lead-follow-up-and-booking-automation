import { Pool } from "pg";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import {
  configuredRecoveryPlans,
  configuredRecoveryInventories,
} from "./configuration";
import { configuredRecoveryNative } from "./native-configuration";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createRecoveryRepository } from "../db/recovery-repository";
import { createRecoveryApplication } from "../application/infrastructure-recovery";

export async function recoverIsolatedBusiness(
  input: unknown,
  execution: {
    project: string;
    environment: string;
    worker: string;
    region: string | null;
    runId: string;
  },
) {
  const parsed = z
    .strictObject({ operationId: z.uuid().optional() })
    .safeParse(input);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
  });
  pool.on("error", () => {});
  try {
    await verifyRuntimeRole(pool);
    const repository = createRecoveryRepository(runtimeDatabase(pool), {
        now: () => new Date(),
      }),
      plans = configuredRecoveryPlans(process.env);
    const work = (await repository.work()).filter(
      (w) => !parsed.data.operationId || w.id === parsed.data.operationId,
    );
    let completed = 0;
    for (const saved of work) {
      const identity = { userId: saved.actor_id, sessionId: saved.session_id };
      await repository.authorize(identity, saved.business_id);
      const op = await repository.get(identity, saved.business_id, saved.id),
        plan = plans.find((p) => p.id === op.plan.id);
      if (!plan) throw new ApplicationError("SETUP_REQUIRED");
      const inventory = configuredRecoveryInventories(process.env).find(
        (i) => i.planId === plan.id,
      );
      if (
        !inventory ||
        execution.project !== inventory.trigger.project ||
        execution.environment !== inventory.trigger.environment ||
        execution.worker !== inventory.trigger.worker ||
        execution.region !== plan.regions.trigger
      )
        throw new ApplicationError("SETUP_REQUIRED");
      const native = await configuredRecoveryNative(
        process.env,
        plan,
        identity,
      );
      try {
        const app = createRecoveryApplication({
          authenticate: async () => identity,
          repository,
          plans,
          adapter: native.adapter,
          executionEvidence: execution,
        });
        for (let i = 0; i < 7; i++) {
          const result = await app.run(undefined, {
            businessId: saved.business_id,
            operationId: saved.id,
          });
          if (result.stage === "inspection_ready") {
            completed++;
            break;
          }
        }
      } finally {
        await native.close();
      }
    }
    return { completed };
  } finally {
    await pool.end();
  }
}
