import type { Clock } from "../../src/models/business";
import type { MetaObservation } from "../../src/models/whatsapp";
import type { MetaProvider } from "../../src/whatsapp/provider";

export function metaFixture(clock: Clock) {
  const exchanges: string[] = [];
  const registrations: { phoneNumberId: string; pin: string }[] = [];
  const checks: MetaObservation["checks"] = {
    customer_ownership: "confirmed",
    business_verification: "confirmed",
    account_review: "confirmed",
    number_verified: "confirmed",
    number_registered: "confirmed",
    permissions: "confirmed",
    customer_payment_method: "confirmed",
    coexistence: "confirmed",
  };
  const state: {
    fail: boolean;
    failRegistration: boolean;
    inspect: null | (() => Promise<void>);
    raw: unknown;
  } = { fail: false, failRegistration: false, inspect: null, raw: null };
  const provider: MetaProvider = {
    key: "deterministic-direct-meta",
    setup: {
      configured: true,
      techProvider: true,
      businessVerification: true,
      appReview: true,
      liveApp: true,
      secureConfiguration: true,
      coexistence: true,
    },
    login: { appId: "900001", configId: "900002", graphVersion: "v25.0" },
    async subscribe() {},
    async exchange(code) {
      exchanges.push(code);
      return { accessToken: "secret-customer-token", expiresAt: null };
    },
    async inspect(_token, assets, configuration, coexistenceFinished) {
      await state.inspect?.();
      if (state.fail) throw new Error("provider-secret-payload");
      if (state.raw) return state.raw;
      return {
        ...assets,
        displayNumber: configuration.requestedNumber,
        checks: {
          ...checks,
          coexistence:
            configuration.numberSource === "business_app" &&
            !coexistenceFinished
              ? "unsupported"
              : checks.coexistence,
        },
        observedAt: clock.now().toISOString(),
        validUntil: new Date(clock.now().getTime() + 300000).toISOString(),
      };
    },
    async register(_token, assets, pin) {
      registrations.push({ phoneNumberId: assets.phoneNumberId, pin });
      if (state.failRegistration)
        throw new Error("uncertain-registration-secret");
      checks.number_registered = "confirmed";
    },
  };
  return { provider, exchanges, registrations, checks, state };
}
