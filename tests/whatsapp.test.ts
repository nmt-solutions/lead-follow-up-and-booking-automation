import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createWhatsAppApplication } from "../src/application/whatsapp";
import { createWhatsAppRepository } from "../src/db/whatsapp-repository";
import { unavailableMetaProvider } from "../src/whatsapp/provider";
import type { MetaProvider } from "../src/whatsapp/provider";
import { calendarCredentialVault } from "../src/appointments/credentials";
import { metaFixture } from "./support/whatsapp";
import { configuredMetaCloud } from "../src/whatsapp/configuration";
import { createWhatsAppHttp } from "../src/http/whatsapp";

describe("Customer-owned WhatsApp onboarding at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  const vault = calendarCredentialVault({
    activeKeyId: "test",
    keys: { test: "ab".repeat(32) },
  });
  function app(provider: MetaProvider = unavailableMetaProvider) {
    return createWhatsAppApplication({
      authenticate: h.access.authenticateForWork,
      repository: createWhatsAppRepository(runtimeDatabase(h.runtime), h.clock),
      provider,
      clock: h.clock,
      vault,
    });
  }
  async function setup(name: string) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`whatsapp-${name}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Customer Steel",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    return { credentials, businessId: business.id };
  }
  const configuration = {
    portfolioId: "100001",
    numberSource: "assisted_new",
    requestedNumber: "+14155550123",
    provisioningTerms:
      "The customer purchases the SIM and retains carrier access and the OTP. Transfer requires the customer's authorization and the carrier's release.",
    customerControlsAssets: true,
    customerPaysMeta: true,
    termsVersion: "direct_meta_v1",
  };
  it("persists assisted number control and transfer terms without turning partial setup into readiness", async () => {
    const f = await setup("terms");
    await app().save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const state = await app().workspace(f.credentials, f.businessId);
    expect(state.connection).toMatchObject({
      version: 1,
      configuration,
      status: "setup_required",
    });
    expect(state.readiness).toMatchObject({
      onboardingReady: false,
      automationReady: false,
    });
    expect(state.billing).toMatchObject({
      payer: "customer",
      provider: "meta",
      includedInSubscription: false,
      includedInOperatorSpend: false,
      platformCreditLine: false,
    });
    await expect(
      app().start(f.credentials, f.businessId, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CHANNEL_SETUP_REQUIRED" });
    await expect(
      app().save(f.credentials, f.businessId, {
        expectedVersion: 1,
        configuration: { ...configuration, ready: true },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("authorizes through one session-bound code exchange and verifies the customer assets without enabling messaging", async () => {
    const f = await setup("embedded");
    const exchanges: string[] = [];
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
      async exchange(code) {
        exchanges.push(code);
        return { accessToken: "secret-customer-token", expiresAt: null };
      },
      async inspect(_token, assets) {
        return {
          ...assets,
          displayNumber: "+1 415 555 0123",
          checks: {
            customer_ownership: "confirmed",
            business_verification: "confirmed",
            account_review: "confirmed",
            number_verified: "confirmed",
            number_registered: "confirmed",
            permissions: "confirmed",
            customer_payment_method: "confirmed",
            coexistence: "confirmed",
          },
          observedAt: h.clock.now().toISOString(),
          validUntil: new Date(h.clock.now().getTime() + 300000).toISOString(),
        };
      },
      async register() {
        throw new Error("Must not register an already registered number");
      },
    };
    const a = app(provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const complete = {
      state: start.state,
      code: "one-use-meta-code",
      event: "FINISH",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300001",
      },
    };
    await a.complete(f.credentials, f.businessId, complete);
    const state = await app(provider).workspace(f.credentials, f.businessId);
    expect(state.readiness).toMatchObject({
      onboardingReady: true,
      automationReady: false,
      issues: [],
    });
    expect(JSON.stringify(state)).not.toMatch(
      /secret-customer-token|one-use-meta-code/,
    );
    await expect(
      a.complete(f.credentials, f.businessId, complete),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(exchanges).toEqual(["one-use-meta-code"]);
    h.clock.set("2026-11-05T09:06:00Z");
    expect(
      (await a.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
  });
  it("checks Business App coexistence using its own completion path and removes stale positive proof after a failed refresh", async () => {
    const f = await setup("coexistence");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration: { ...configuration, numberSource: "business_app" },
    });
    const first = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const assets = {
      portfolioId: "100001",
      wabaId: "200001",
      phoneNumberId: "300002",
    };
    const blocked = await a.complete(f.credentials, f.businessId, {
      state: first.state,
      event: "FINISH",
      code: "wrong-path",
      assets,
    });
    expect(blocked.connection?.reason).toBe("unsupported_coexistence");
    expect(m.exchanges).toEqual([]);
    const second = await a.start(f.credentials, f.businessId, {
      expectedVersion: first.version,
    });
    const ready = await a.complete(f.credentials, f.businessId, {
      state: second.state,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      code: "coexistence-code",
      assets,
    });
    expect(ready.readiness.onboardingReady).toBe(true);
    m.state.fail = true;
    await a.refresh(f.credentials, f.businessId, {
      expectedVersion: second.version,
    });
    const failed = await a.workspace(f.credentials, f.businessId);
    expect(failed.connection).toMatchObject({
      reason: "provider_unavailable",
      observation: null,
    });
    expect(failed.readiness.onboardingReady).toBe(false);
    expect(m.registrations).toEqual([]);
    await a.disconnect(f.credentials, f.businessId, {
      expectedVersion: second.version,
    });
    expect(
      (await a.workspace(f.credentials, f.businessId)).connection,
    ).toMatchObject({ status: "disconnected", observation: null });
    await expect(
      a.refresh(f.credentials, f.businessId, {
        expectedVersion: second.version + 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("registers a verified customer number only on explicit request and reconciles ambiguous registration before retry", async () => {
    const f = await setup("registration");
    const m = metaFixture(h.clock);
    m.checks.number_registered = "missing";
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH",
      code: "register-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300003",
      },
    });
    expect(m.registrations).toEqual([]);
    m.state.failRegistration = true;
    await a.register(f.credentials, f.businessId, {
      expectedVersion: start.version,
      pin: "938271",
    });
    expect(
      (await a.workspace(f.credentials, f.businessId)).connection?.reason,
    ).toBe("registration_uncertain");
    await expect(
      a.register(f.credentials, f.businessId, {
        expectedVersion: start.version,
        pin: "938271",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.registrations).toEqual([
      { phoneNumberId: "300003", pin: "938271" },
    ]);
    m.checks.number_registered = "confirmed";
    await a.refresh(f.credentials, f.businessId, {
      expectedVersion: start.version,
    });
    expect(
      (await a.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(true);
    expect(
      JSON.stringify(await a.workspace(f.credentials, f.businessId)),
    ).not.toContain("938271");
  });
  it("uses direct Graph account/number proof and keeps payment ownership and unapproved production setup unresolved", async () => {
    const f = await setup("graph");
    const requests: { method: string; path: string }[] = [];
    let phoneStatus = "PENDING";
    const env = {
      META_APP_ID: "900001",
      META_APP_SECRET: "test-app-secret",
      META_LOGIN_CONFIG_ID: "900002",
      META_GRAPH_VERSION: "v25.0",
      META_TOKEN_KEY_ID: "test",
      META_TOKEN_KEYS: JSON.stringify({ test: "ab".repeat(32) }),
      META_TECH_PROVIDER_APPROVED: "true",
      META_BUSINESS_VERIFIED: "true",
      META_APP_REVIEW_APPROVED: "true",
      META_APP_LIVE: "true",
    };
    const fetcher: typeof fetch = async (url, init) => {
      const u = new URL(String(url));
      requests.push({ method: init?.method ?? "GET", path: u.pathname });
      if (u.pathname.endsWith("/oauth/access_token"))
        return Response.json({
          access_token: "graph-secret-token",
          token_type: "bearer",
        });
      if (u.pathname.endsWith("/debug_token"))
        return Response.json({
          data: {
            app_id: "900001",
            is_valid: true,
            scopes: [
              "business_management",
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            expires_at: 0,
            data_access_expires_at: 0,
          },
        });
      if (u.pathname.endsWith("/100001/owned_whatsapp_business_accounts"))
        return Response.json({
          data: [
            {
              id: "200001",
              business_verification_status: "verified",
              account_review_status: "APPROVED",
            },
          ],
        });
      if (u.pathname.endsWith("/200001/phone_numbers"))
        return Response.json({
          data: [
            {
              id: "300004",
              display_phone_number: "+1 415 555 0123",
              code_verification_status: "VERIFIED",
              status: phoneStatus,
              account_mode: "LIVE",
              is_on_biz_app: false,
            },
          ],
        });
      if (u.pathname.endsWith("/300004/register")) {
        phoneStatus = "CONNECTED";
        return Response.json({ success: true });
      }
      throw new Error("Unexpected request");
    };
    const disabled = configuredMetaCloud(
      { ...env, META_APP_REVIEW_APPROVED: "false" },
      fetcher,
      h.clock,
    );
    expect(disabled.provider.setup.configured).toBe(false);
    const configured = configuredMetaCloud(env, fetcher, h.clock);
    const a = app(configured.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const result = await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH",
      code: "graph-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300004",
      },
    });
    expect(result.connection?.observation?.checks).toMatchObject({
      customer_ownership: "confirmed",
      number_registered: "missing",
      customer_payment_method: "unknown",
    });
    expect(result.readiness).toMatchObject({
      onboardingReady: false,
      automationReady: false,
      issues: ["number_registered", "customer_payment_method"],
    });
    expect(requests.map((r) => r.path)).toContain(
      "/v25.0/100001/owned_whatsapp_business_accounts",
    );
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(
      /graph-secret-token|test-app-secret/,
    );
    const registered = await a.register(f.credentials, f.businessId, {
      expectedVersion: start.version,
      pin: "637291",
    });
    expect(registered.connection?.observation?.checks.number_registered).toBe(
      "confirmed",
    );
    expect(requests.filter((r) => r.method !== "GET")).toEqual([
      { method: "POST", path: "/v25.0/300004/register" },
    ]);
  });
  it("enforces current Business role, MFA, callback session, CSRF and safe HTTP failures", async () => {
    const f = await setup("scope");
    const other = await setup("other");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    await expect(
      a.workspace(other.credentials, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.save(other.credentials, f.businessId, {
        expectedVersion: 1,
        configuration,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const sales = await h.signIn("whatsapp-sales@example.com");
    await h.team.invite(f.credentials, f.businessId, {
      email: "whatsapp-sales@example.com",
      role: "salesperson",
    });
    const invitation = h.invitations.sent.at(-1);
    if (!invitation) throw new Error("Missing invitation");
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
        "token",
      ),
    });
    await expect(
      a.start(sales, f.businessId, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const noMfa = await h.signIn("whatsapp-scope@example.com", false);
    await expect(a.workspace(noMfa, f.businessId)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const anotherSession = await h.signIn("whatsapp-scope@example.com");
    const completion = {
      state: start.state,
      event: "FINISH",
      code: "secret-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300005",
      },
    };
    await expect(
      a.complete(anotherSession, f.businessId, completion),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const http = createWhatsAppHttp({
      application: a,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const request = (body: unknown, origin: string) =>
      new Request("http://localhost:3000/api/whatsapp", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie") ?? "",
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await http.command(
          request(
            { action: "complete", input: completion },
            "https://attacker.example",
          ),
          f.businessId,
        )
      ).status,
    ).toBe(403);
    expect(m.exchanges).toEqual([]);
    const invalid = await http.command(
      request(
        { action: "complete", input: { ...completion, ready: true } },
        "http://localhost:3000",
      ),
      f.businessId,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toMatch(
      /secret-code|secret-customer-token/,
    );
    await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "CANCEL",
    });
    expect(
      (await a.workspace(f.credentials, f.businessId)).connection?.reason,
    ).toBe("consent_cancelled");
  });
  it("never lets provider proof outlive the customer authorization token", async () => {
    const f = await setup("expiry");
    const m = metaFixture(h.clock);
    m.provider.exchange = async () => ({
      accessToken: "short-lived-token",
      expiresAt: "2026-11-05T09:01:00.000Z",
    });
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH",
      code: "expiry-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300006",
      },
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(
      (await a.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
  });
  it("requires the supported Graph Business App state and leaves unsupported coexistence visibly unavailable", async () => {
    const f = await setup("graph-coexistence");
    let onBizApp = false;
    const environment = {
      META_APP_ID: "900001",
      META_APP_SECRET: "app-secret",
      META_LOGIN_CONFIG_ID: "900002",
      META_GRAPH_VERSION: "v25.0",
      META_TOKEN_KEY_ID: "test",
      META_TOKEN_KEYS: JSON.stringify({ test: "ab".repeat(32) }),
      META_TECH_PROVIDER_APPROVED: "true",
      META_BUSINESS_VERIFIED: "true",
      META_APP_REVIEW_APPROVED: "true",
      META_APP_LIVE: "true",
      META_COEXISTENCE_ONBOARDING_APPROVED: "true",
    };
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/oauth/access_token"))
        return Response.json({ access_token: "coex-token" });
      if (path.endsWith("/debug_token"))
        return Response.json({
          data: {
            app_id: "900001",
            is_valid: true,
            scopes: [
              "business_management",
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
          },
        });
      if (path.endsWith("/owned_whatsapp_business_accounts"))
        return Response.json({
          data: [
            {
              id: "200001",
              business_verification_status: "verified",
              account_review_status: "APPROVED",
            },
          ],
        });
      if (path.endsWith("/phone_numbers"))
        return Response.json({
          data: [
            {
              id: "300007",
              display_phone_number: "+14155550123",
              status: "CONNECTED",
              account_mode: "LIVE",
              code_verification_status: "VERIFIED",
              is_on_biz_app: onBizApp,
            },
          ],
        });
      throw new Error("Unexpected outbound action");
    };
    const composition = configuredMetaCloud(environment, fetcher, h.clock);
    const a = app(composition.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration: { ...configuration, numberSource: "business_app" },
    });
    const unsupported = app(
      configuredMetaCloud(
        { ...environment, META_COEXISTENCE_ONBOARDING_APPROVED: "false" },
        fetcher,
        h.clock,
      ).provider,
    );
    await expect(
      unsupported.start(f.credentials, f.businessId, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CHANNEL_SETUP_REQUIRED" });
    expect(
      (await unsupported.workspace(f.credentials, f.businessId)).readiness
        .issues,
    ).toContain("unsupported_coexistence");
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const result = await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      code: "coex-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300007",
      },
    });
    expect(result.connection?.observation?.checks.coexistence).toBe(
      "unsupported",
    );
    onBizApp = true;
    const supported = await a.refresh(f.credentials, f.businessId, {
      expectedVersion: start.version,
    });
    expect(supported.connection?.observation?.checks.coexistence).toBe(
      "confirmed",
    );
    expect(supported.readiness).toMatchObject({
      onboardingReady: false,
      automationReady: false,
      issues: ["customer_payment_method"],
    });
    await expect(
      a.register(f.credentials, f.businessId, {
        expectedVersion: start.version,
        pin: "123456",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("does not exchange codes for partial, expired or superseded signup sessions", async () => {
    const f = await setup("partial");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const first = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const partial = await a.complete(f.credentials, f.businessId, {
      state: first.state,
      event: "FINISH_ONLY_WABA",
      code: "partial-code",
    });
    expect(partial.connection?.reason).toBe("incomplete_setup");
    const second = await a.start(f.credentials, f.businessId, {
      expectedVersion: first.version,
    });
    const third = await a.start(f.credentials, f.businessId, {
      expectedVersion: second.version,
    });
    const input = {
      event: "FINISH",
      code: "expired-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300008",
      },
    };
    await expect(
      a.complete(f.credentials, f.businessId, {
        ...input,
        state: second.state,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    h.clock.set("2026-11-05T09:11:00Z");
    await h.reverifyAuthenticator(f.credentials);
    await expect(
      a.complete(f.credentials, f.businessId, { ...input, state: third.state }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(m.exchanges).toEqual([]);
    expect(
      (await a.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
  });
  it("rejects stale provider proof and an in-flight check after the customer changes the number", async () => {
    const f = await setup("inflight");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    const ready = await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH",
      code: "inflight-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300009",
      },
    });
    m.state.raw = ready.connection?.observation;
    h.clock.set("2026-11-05T09:01:00Z");
    const stale = await a.refresh(f.credentials, f.businessId, {
      expectedVersion: start.version,
    });
    expect(stale.connection).toMatchObject({
      reason: "invalid_response",
      observation: null,
    });
    m.state.raw = null;
    m.state.inspect = async () => {
      m.state.inspect = null;
      await a.save(f.credentials, f.businessId, {
        expectedVersion: start.version,
        configuration: { ...configuration, requestedNumber: "+14155550124" },
      });
    };
    await expect(
      a.refresh(f.credentials, f.businessId, {
        expectedVersion: start.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await a.workspace(f.credentials, f.businessId)).connection,
    ).toMatchObject({
      configuration: { requestedNumber: "+14155550124" },
      status: "setup_required",
      observation: null,
    });
  });
  it("rechecks the actor's current role after provider I/O before storing any authorization", async () => {
    const f = await setup("role-race");
    const admin = await h.signIn("whatsapp-admin@example.com");
    await h.team.invite(f.credentials, f.businessId, {
      email: "whatsapp-admin@example.com",
      role: "admin",
    });
    const invitation = h.invitations.sent.at(-1);
    if (!invitation) throw new Error("Missing invitation");
    await h.team.accept(admin, {
      token: new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
        "token",
      ),
    });
    const actor = await h.authenticate(admin);
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(admin, f.businessId, { expectedVersion: 0, configuration });
    const start = await a.start(admin, f.businessId, { expectedVersion: 1 });
    m.state.inspect = async () => {
      await h.team.changeRole(f.credentials, f.businessId, {
        userId: actor.userId,
        role: "salesperson",
      });
    };
    await expect(
      a.complete(admin, f.businessId, {
        state: start.state,
        event: "FINISH",
        code: "role-race-code",
        assets: {
          portfolioId: "100001",
          wabaId: "200001",
          phoneNumberId: "300010",
        },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await a.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
    expect(m.registrations).toEqual([]);
  });
  it("preserves terms and encrypted grants across schema reapplication with non-bypassed RLS and immutable scope", async () => {
    const f = await setup("schema");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    await a.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const start = await a.start(f.credentials, f.businessId, {
      expectedVersion: 1,
    });
    await a.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH",
      code: "schema-secret-code",
      assets: {
        portfolioId: "100001",
        wabaId: "200001",
        phoneNumberId: "300011",
      },
    });
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(
      (await app(m.provider).workspace(f.credentials, f.businessId)).connection,
    ).toMatchObject({ configuration, status: "connected" });
    const stored = await h.admin.query<{ credentials: string }>(
      "select credentials from whatsapp_connection where business_id=$1",
      [f.businessId],
    );
    expect(stored.rows[0].credentials).not.toContain("secret-customer-token");
    const unscoped = await h.runtime.query(
      "select id from whatsapp_connection",
    );
    expect(unscoped.rows).toEqual([]);
    await expect(
      h.runtime.query("update whatsapp_connection set business_id=business_id"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query("delete from whatsapp_event"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(JSON.stringify(h.diagnostics)).not.toMatch(
      /schema-secret-code|secret-customer-token|provider-secret-payload/,
    );
  });
  it("does not let an unverified browser asset hint reserve another Business's number", async () => {
    const first = await setup("unverified-hint");
    const second = await setup("verified-binding");
    const m = metaFixture(h.clock);
    const a = app(m.provider);
    const assets = {
      portfolioId: "100001",
      wabaId: "200001",
      phoneNumberId: "300012",
    };
    await a.save(first.credentials, first.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const s1 = await a.start(first.credentials, first.businessId, {
      expectedVersion: 1,
    });
    m.state.fail = true;
    await a.complete(first.credentials, first.businessId, {
      state: s1.state,
      event: "FINISH",
      code: "unverified-code",
      assets,
    });
    m.state.fail = false;
    await a.save(second.credentials, second.businessId, {
      expectedVersion: 0,
      configuration,
    });
    const s2 = await a.start(second.credentials, second.businessId, {
      expectedVersion: 1,
    });
    const ready = await a.complete(second.credentials, second.businessId, {
      state: s2.state,
      event: "FINISH",
      code: "verified-code",
      assets,
    });
    expect(ready.readiness.onboardingReady).toBe(true);
    expect(
      (await a.workspace(first.credentials, first.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
  });
});
