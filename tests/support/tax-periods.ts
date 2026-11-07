import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { subscriptionFixture } from "./subscription";
import { financialNativeFixture } from "./financial-native";
import { configuredPayments } from "../../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../../src/db/runtime";

/** Genuine native confirmed capture, deliberately not yet numbered as a seller invoice. */
export async function taxCaptureFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  const f = await subscriptionFixture(h),
    native = financialNativeFixture(h.clock);
  const gateway = configuredPayments({
    ...native.configuration,
    env: {
      ...native.configuration.env,
      SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
        id: "fixture-tax-cancel",
        version: 1,
        mode: "test",
        reviewedBy: "fixture operator",
        checkedAt: "2026-11-01T00:00:00Z",
        effectiveFrom: "2026-11-01T00:00:00Z",
        effectiveUntil: "2027-11-01T00:00:00Z",
        evidence: ["fixture reviewed cancellation terms"],
        graceSeconds: 0,
        graceAccess: "none",
        cancellationTiming: "immediate",
        cancellationAccess: "provider_end",
        preserveRecords: true,
      }),
    },
  });
  const payments = createSubscriptionPaymentApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createSubscriptionPaymentRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
    gateway,
  });
  const action = await payments.prepare(f.owner, f.business.id, {
    quoteId: f.quote.id,
    requestKey: randomUUID(),
  });
  await payments.start(f.owner, f.business.id, { actionId: action.id });
  native.charge(
    "pay_taxunissued",
    "2026-11-05T09:00:00Z",
    "2026-12-05T09:00:00Z",
  );
  await payments.recover();
  const period = (await payments.workspace(f.owner, f.business.id)).periods[0];
  if (!period) throw Error("Expected a genuine captured period");
  return { ...f, native, payments, period };
}
