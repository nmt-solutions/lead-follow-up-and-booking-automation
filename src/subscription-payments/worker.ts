import { Pool } from "pg";
import { databaseConnectionUrl } from "../db/connection";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createSubscriptionPaymentRepository } from "../db/subscription-payment-repository";
import { createSubscriptionPaymentApplication } from "../application/subscription-payments";
import { configuredPayments, configuredReachPolicy } from "./configuration";
import { createReachChangeApplication } from "../application/reach-changes";
import { createReachChangeRepository } from "../db/reach-change-repository";
import { ApplicationError } from "../models/application-error";

export async function recoverSubscriptionPayments() {
  if (!process.env.DATABASE_URL) throw new ApplicationError("SETUP_REQUIRED");
  const pool = new Pool({
    connectionString: databaseConnectionUrl(process.env.DATABASE_URL),
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  pool.on("error", () => {});
  try {
    await verifyRuntimeRole(pool);
    const denied = async () => {
      throw new ApplicationError("FORBIDDEN");
    };
    const gateway = configuredPayments(),
      clock = { now: () => new Date() },
      database = runtimeDatabase(pool);
    const reach = createReachChangeApplication({
      authenticate: denied,
      authenticatePlatform: denied,
      repository: createReachChangeRepository(database),
      gateway,
      policy: configuredReachPolicy(),
      clock,
    });
    const before = await reach.recover();
    const payments = await createSubscriptionPaymentApplication({
      authenticate: denied,
      authenticatePlatform: denied,
      repository: createSubscriptionPaymentRepository(runtimeDatabase(pool), {
        requireServiceSetup: process.env.NODE_ENV === "production",
      }),
      clock: { now: () => new Date() },
      gateway,
    }).recover();
    return {
      payments,
      reach: before,
      reachAfterPayments: await reach.recover(),
    };
  } finally {
    await pool.end();
  }
}
