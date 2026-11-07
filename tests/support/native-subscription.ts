import { subscriptionFixture } from "./subscription";

/** Native creation checks trusted DB time independently of the historical test clock. */
export function nativeSubscriptionFixture(
  h: Parameters<typeof subscriptionFixture>[0],
  options: Parameters<typeof subscriptionFixture>[1] = {},
) {
  return subscriptionFixture(h, {
    ...options,
    // Explicit fixture consent covers native creation at the real DB clock.
    // Generic short-retention fixtures and expiry regressions stay independent.
    billingEvidenceRetentionSeconds: 365 * 86400,
  });
}
