import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createSubscriptionQuoteApplication } from "../src/application/subscription-quotes";
import { createSubscriptionQuoteRepository } from "../src/db/subscription-quote-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { randomUUID } from "node:crypto";
import { createBillingApplication } from "../src/application/billing";
import { createBillingRepository } from "../src/db/billing-repository";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { createMemoryStorage } from "./support/storage";
import { verifyRuntimeRole } from "../src/db/runtime";
import { createSubscriptionQuoteHttp } from "../src/http/subscription-quotes";
import type { SubscriptionOffer } from "../src/models/subscription-quotes";

describe("Configured subscription quotes at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let app: ReturnType<typeof createSubscriptionQuoteApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    app = createSubscriptionQuoteApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionQuoteRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
  });
  afterEach(async () => h?.close());

  async function setup() {
    const owner = await h.signIn("quote-owner@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Quote Business",
      offering: "Steel",
      homeMarket: "United States",
      website: "",
    });
    return { owner, business };
  }

  // Explicit commercial fixtures, never production defaults.
  const offer = {
    id: "selected-reach",
    label: "Selected reach",
    markets: ["India", "United States"],
    discovery: { quantity: 120, unit: "research units" },
    automation: { quantity: 240, unit: "automation actions" },
    prices: {
      INR: { monthlyMinor: 123400, pilotMinor: 43200 },
      USD: { monthlyMinor: 2700, pilotMinor: 1100 },
    },
    pilot: {
      days: 14,
      discovery: { quantity: 30, unit: "research units" },
      automation: { quantity: 60, unit: "automation actions" },
    },
    renewalTerms:
      "Monthly renewal at the quoted monthly price; review before activation.",
    reservedCapacity: [
      {
        id: "reserved",
        label: "Reserved discovery",
        capacity: { quantity: 2, unit: "concurrent discovery slots" },
        prices: {
          INR: { monthlyMinor: 10000, pilotMinor: 4000 },
          USD: { monthlyMinor: 300, pilotMinor: 100 },
        },
      },
    ],
  };
  async function operator() {
    const headers = await h.signIn("quote-operator@example.com");
    await h.provisionOperator(headers, { tax: false, reconciliation: false });
    const actor = await h.authenticate(headers);
    await h.admin.query(
      "UPDATE platform_operator SET pricing = true WHERE user_id = $1",
      [actor.userId],
    );
    return headers;
  }
  async function reviewedBilling(
    owner: Headers,
    businessId: string,
    country = "IN",
  ) {
    const billing = createBillingApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createBillingRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage: createMemoryStorage(),
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: "quote-fixture",
      },
    });
    const upload = await files.beginUpload(owner, businessId, {
      name: "billing.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "billing",
    });
    await files.completeUpload(
      owner,
      businessId,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("legal"),
    );
    const previous = await billing.workspace(owner, businessId);
    await billing.save(owner, businessId, {
      expectedVersion: previous.version,
      note: "Fixture legal evidence",
      profile: {
        legalName: "Quote legal entity",
        registrationNumber: "fixture-registration",
        address: {
          line1: "1 Market Street",
          line2: "",
          city: "Pune",
          region: "MH",
          postalCode: "411001",
          country,
        },
        invoiceContact: { name: "Accounts", email: "accounts@example.com" },
        businessStatus: "business",
        taxIdentifierStatus: "not_applicable",
        taxIdentifiers: [],
        evidence: ["legal_identity", "billing_address", "business_status"].map(
          (kind) => ({ kind, fileId: upload.file.id, note: "Fixture claim" }),
        ),
      },
    });
    const reviewer = await h.signIn("quote-reviewer@example.com");
    await h.provisionOperator(reviewer, { tax: true, reconciliation: false });
    const state = await billing.review(reviewer, businessId, {
      expectedVersion: previous.version + 1,
      expectedReviewVersion: previous.reviewVersion,
      outcome: "reviewed",
      findings: [],
      note: "Reviewed fixture evidence",
    });
    return { billing, state, files, fileId: upload.file.id };
  }
  function request(
    state: { version: number; reviewVersion: number },
    extras = {},
  ) {
    return {
      expectedCatalogVersion: 1,
      expectedBillingVersion: state.version,
      expectedReviewVersion: state.reviewVersion,
      offerId: offer.id,
      reservedCapacityId: null,
      term: "monthly",
      requestKey: randomUUID(),
      ...extras,
    };
  }
  async function publish(
    op: Headers,
    configured: SubscriptionOffer = offer,
    expectedVersion = 0,
  ) {
    return app.configure(op, {
      expectedVersion,
      effectiveFrom: h.clock.now().toISOString(),
      note: "Explicit commercial fixture",
      offers: [configured],
    });
  }

  it("shows missing commercial setup without illustrative prices, FX or checkout", async () => {
    const { owner, business } = await setup();
    expect(await app.workspace(owner, business.id)).toMatchObject({
      currency: null,
      catalogVersion: 0,
      offers: [],
      quotes: [],
      issues: [
        "billing_review_required",
        "billing_currency_unknown",
        "pricing_configuration_missing",
      ],
      checkoutReady: false,
    });
  });

  it("publishes attributed effective catalog versions without changing earlier terms", async () => {
    const { owner, business } = await setup();
    const op = await operator();
    const first = await app.configure(op, {
      expectedVersion: 0,
      effectiveFrom: null,
      note: "Approved fixture costing",
      offers: [offer],
    });
    expect(first).toMatchObject({
      version: 1,
      current: {
        version: 1,
        offers: [offer],
        actorId: (await h.authenticate(op)).userId,
      },
    });
    await app.configure(op, {
      expectedVersion: 1,
      effectiveFrom: "2026-11-05T09:05:00.000Z",
      note: "Future fixture pricing",
      offers: [{ ...offer, label: "Future reach" }],
    });
    expect(await app.workspace(owner, business.id)).toMatchObject({
      catalogVersion: 1,
      offers: [offer],
    });
    h.clock.set("2026-11-05T09:05:00.000Z");
    const saved = await app.catalog(op);
    expect(saved).toMatchObject({
      version: 2,
      current: { version: 2, offers: [{ label: "Future reach" }] },
      history: [{ offers: [offer] }, { version: 2 }],
    });
    await expect(
      app.configure(op, {
        expectedVersion: 1,
        effectiveFrom: h.clock.now().toISOString(),
        note: "Stale",
        offers: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.configure(op, {
        expectedVersion: 2,
        effectiveFrom: "2026-11-05T09:00:00.000Z",
        note: "Backdated",
        offers: [],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("quotes selected reach and reserved capacity from reviewed INR details with separate Meta costs and bounded pilot renewal terms", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id);
    const op = await operator();
    await app.configure(op, {
      expectedVersion: 0,
      effectiveFrom: h.clock.now().toISOString(),
      note: "Fixture commercial terms",
      offers: [offer],
    });
    const input = {
      expectedCatalogVersion: 1,
      expectedBillingVersion: state.version,
      expectedReviewVersion: state.reviewVersion,
      offerId: offer.id,
      reservedCapacityId: "reserved",
      term: "paid_pilot",
      requestKey: randomUUID(),
    };
    const result = await app.createQuote(owner, business.id, input);
    expect(result).toMatchObject({
      commercialReady: true,
      checkoutReady: false,
      issues: [],
      launchGates: ["tax_calculation_required", "gateway_checkout_required"],
      snapshot: {
        businessId: business.id,
        currency: "INR",
        profile: { id: state.current!.id },
        billingReview: { profileId: state.current!.id, outcome: "reviewed" },
        pricing: {
          version: 1,
          offer,
          reservedCapacity: offer.reservedCapacity[0],
        },
        initial: {
          kind: "paid_pilot",
          days: 14,
          subtotalMinor: 47200,
          discovery: { quantity: 30, unit: "research units" },
          automation: { quantity: 60, unit: "automation actions" },
          lines: [
            { kind: "subscription", amountMinor: 43200 },
            { kind: "reserved_capacity", amountMinor: 4000 },
          ],
        },
        renewal: {
          interval: "month",
          subtotalMinor: 133400,
          terms: offer.renewalTerms,
          discovery: offer.discovery,
          automation: offer.automation,
          lines: [
            { kind: "subscription", amountMinor: 123400 },
            { kind: "reserved_capacity", amountMinor: 10000 },
          ],
        },
        meta: {
          payer: "business_direct",
          includedInPlatformSubtotal: false,
          prepaidCredit: false,
          guaranteedMessages: false,
        },
        tax: { status: "not_calculated", amountMinor: null, totalMinor: null },
        grantsEntitlements: false,
        at: "2026-11-05T09:00:00.000Z",
      },
    });
    expect(await app.createQuote(owner, business.id, input)).toEqual(result);
    await expect(
      app.createQuote(owner, business.id, {
        ...input,
        reservedCapacityId: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await app.workspace(owner, business.id)).quotes).toEqual([result]);
    expect(await app.quote(owner, business.id, result.snapshot.id)).toEqual(
      result,
    );
    expect(
      (await h.application.getProfile(owner, business.id)).homeMarket,
    ).toBe("United States");
  });

  it("fails startup closed when immutable commercial history has mutable runtime grants", async () => {
    await verifyRuntimeRole(h.runtime);
    await h.admin.query("GRANT UPDATE ON subscription_quote TO app_runtime");
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
  });

  it("protects commercial HTTP mutations and independently provisioned operator capabilities", async () => {
    const { owner, business } = await setup();
    const op = await operator();
    await expect(
      h.team.requirePlatformCapability(op, "pricing.manage"),
    ).resolves.toEqual({ capability: "pricing.manage" });
    const http = createSubscriptionQuoteHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: (diagnostic) => h.diagnostics.push(diagnostic),
    });
    const config = {
      expectedVersion: 0,
      effectiveFrom: h.clock.now().toISOString(),
      note: "Fixture",
      offers: [offer],
    };
    function post(
      headers: Headers,
      value: unknown,
      origin = "http://localhost:3000",
    ) {
      const next = new Headers(headers);
      next.set("origin", origin);
      next.set("content-type", "application/json");
      return new Request("http://localhost:3000/api/platform/pricing", {
        method: "POST",
        headers: next,
        body: JSON.stringify(value),
      });
    }
    expect((await http.configure(post(owner, config))).status).toBe(403);
    expect(
      (await http.configure(post(op, config, "https://foreign.example")))
        .status,
    ).toBe(403);
    expect(
      (await http.configure(post(op, { ...config, gatewayActivation: true })))
        .status,
    ).toBe(400);
    expect((await http.configure(post(op, config))).status).toBe(200);
    expect(
      (
        await http.create(
          post(owner, {
            ...request({ version: 1, reviewVersion: 1 }),
            currency: "USD",
            amountMinor: 1,
          }),
          business.id,
        )
      ).status,
    ).toBe(400);
    const result = await http.create(
      post(owner, request({ version: 1, reviewVersion: 1 })),
      business.id,
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "PRICING_SETUP_REQUIRED",
    });
    const actor = await h.authenticate(op);
    await h.admin.query(
      "UPDATE platform_operator SET pricing = false WHERE user_id=$1",
      [actor.userId],
    );
    expect(
      (
        await http.catalog(
          new Request("http://localhost:3000/api/platform/pricing", {
            headers: op,
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      h.diagnostics.every((d) =>
        Object.keys(d).every((key) => ["requestId", "code"].includes(key)),
      ),
    ).toBe(true);
  });

  it("uses explicit USD prices with pooled capacity and never converts INR or fills missing allowances", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id, "US");
    const op = await operator();
    await publish(op);
    const quote = await app.createQuote(owner, business.id, request(state));
    expect(quote.snapshot).toMatchObject({
      currency: "USD",
      pricing: { reservedCapacity: null },
      initial: {
        subtotalMinor: 2700,
        lines: [{ kind: "subscription", amountMinor: 2700 }],
      },
      renewal: { subtotalMinor: 2700 },
    });
    expect(quote.snapshot.initial.lines).toHaveLength(1);
    await app.configure(op, {
      expectedVersion: 1,
      effectiveFrom: null,
      note: "Missing international price and allowance fixture",
      offers: [
        { ...offer, discovery: null, prices: { ...offer.prices, USD: null } },
      ],
    });
    const missing = await app.workspace(owner, business.id);
    expect(missing.offers[0]).toMatchObject({
      discovery: null,
      prices: { USD: null },
    });
    await expect(
      app.createQuote(
        owner,
        business.id,
        request(state, { expectedCatalogVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: "PRICING_SETUP_REQUIRED" });
    expect(
      (await app.quote(owner, business.id, quote.snapshot.id)).snapshot,
    ).toEqual(quote.snapshot);
  });

  it("keeps quote history immutable while effective prices, reviewed billing details and live evidence become stale", async () => {
    const { owner, business } = await setup();
    const { state, billing, files, fileId } = await reviewedBilling(
      owner,
      business.id,
    );
    const op = await operator();
    await publish(op);
    const quote = await app.createQuote(owner, business.id, request(state));
    await app.configure(op, {
      expectedVersion: 1,
      effectiveFrom: "2026-11-05T09:05:00.000Z",
      note: "Future prices",
      offers: [
        {
          ...offer,
          prices: {
            ...offer.prices,
            INR: { monthlyMinor: 99999, pilotMinor: 10000 },
          },
        },
      ],
    });
    expect(
      (await app.quote(owner, business.id, quote.snapshot.id)).commercialReady,
    ).toBe(true);
    h.clock.set("2026-11-05T09:05:00.000Z");
    expect(
      await app.quote(owner, business.id, quote.snapshot.id),
    ).toMatchObject({
      snapshot: quote.snapshot,
      commercialReady: false,
      issues: ["pricing_changed"],
      checkoutReady: false,
    });
    await expect(
      app.createQuote(owner, business.id, request(state)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const current = await app.createQuote(
      owner,
      business.id,
      request(state, { expectedCatalogVersion: 2 }),
    );
    await billing.save(owner, business.id, {
      expectedVersion: state.version,
      note: "Changed legal identity",
      profile: { ...state.current!.profile, legalName: "Updated legal entity" },
    });
    expect(
      await app.quote(owner, business.id, current.snapshot.id),
    ).toMatchObject({
      snapshot: current.snapshot,
      commercialReady: false,
      issues: ["billing_review_required", "billing_changed"],
    });
    await expect(
      app.createQuote(
        owner,
        business.id,
        request(state, { expectedCatalogVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: "PRICING_SETUP_REQUIRED" });
    await expect(
      files.deleteFile(owner, business.id, fileId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.clock.set("2026-11-05T11:05:00.000Z");
    expect((await app.workspace(owner, business.id)).billing.issues).toContain(
      "evidence_unavailable",
    );
    expect(
      (await app.quote(owner, business.id, quote.snapshot.id)).snapshot,
    ).toEqual(quote.snapshot);
  });

  it("rejects unconfigured renewal, pilot and capacity combinations without saving or charging a quote", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id);
    const op = await operator();
    await publish(op, {
      ...offer,
      automation: null,
      prices: {
        ...offer.prices,
        INR: { monthlyMinor: null, pilotMinor: 43200 },
      },
    });
    await expect(
      app.createQuote(
        owner,
        business.id,
        request(state, { term: "paid_pilot" }),
      ),
    ).rejects.toMatchObject({ code: "PRICING_SETUP_REQUIRED" });
    await publish(op, { ...offer, pilot: null, reservedCapacity: [] }, 1);
    await expect(
      app.createQuote(
        owner,
        business.id,
        request(state, { expectedCatalogVersion: 2, term: "paid_pilot" }),
      ),
    ).rejects.toMatchObject({ code: "PRICING_SETUP_REQUIRED" });
    await expect(
      app.createQuote(
        owner,
        business.id,
        request(state, {
          expectedCatalogVersion: 2,
          reservedCapacityId: "reserved",
        }),
      ),
    ).rejects.toMatchObject({ code: "PRICING_SETUP_REQUIRED" });
    expect((await app.workspace(owner, business.id)).quotes).toEqual([]);
    const zeroAllowance = {
      ...offer,
      discovery: { quantity: 0, unit: "research units" },
    };
    await publish(op, zeroAllowance, 2);
    expect(
      (
        await app.createQuote(
          owner,
          business.id,
          request(state, { expectedCatalogVersion: 3 }),
        )
      ).snapshot.initial.discovery,
    ).toEqual({ quantity: 0, unit: "research units" });
  });

  it("isolates financial reads and idempotent writes from salespeople, foreign Businesses, pricing operators and revoked Admins", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id);
    const op = await operator();
    await publish(op);
    const input = request(state);
    const [first, replay] = await Promise.all([
      app.createQuote(owner, business.id, input),
      app.createQuote(owner, business.id, input),
    ]);
    expect(first).toEqual(replay);
    expect((await app.workspace(owner, business.id)).quotes).toHaveLength(1);
    const foreign = await h.signIn("quote-foreign@example.com");
    const other = await h.application.createBusiness(foreign, {
      name: "Other",
      offering: "Scissors",
      homeMarket: "India",
      website: "",
    });
    await expect(app.workspace(foreign, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      app.quote(foreign, other.id, first.snapshot.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(app.workspace(op, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const role of ["salesperson", "admin"] as const) {
      const email = `quote-${role}@example.com`;
      const member = await h.signIn(email);
      await h.team.invite(owner, business.id, { email, role });
      const message = h.invitations.sent.at(-1)!;
      await h.team.accept(member, {
        token: new URLSearchParams(new URL(message.url).hash.slice(1)).get(
          "token",
        ),
      });
      if (role === "salesperson") {
        await expect(app.workspace(member, business.id)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          app.createQuote(member, business.id, input),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } else {
        expect(await app.quote(member, business.id, first.snapshot.id)).toEqual(
          first,
        );
        await h.team.removeMember(owner, business.id, {
          userId: (await h.authenticate(member)).userId,
        });
        await expect(
          app.quote(member, business.id, first.snapshot.id),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          app.createQuote(member, business.id, input),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    }
  });

  it("rechecks operator MFA and grants and serializes conflicting catalog publications", async () => {
    const { owner } = await setup();
    const op = await operator();
    await expect(app.catalog(owner)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.provisionOperator(owner, { tax: true, reconciliation: true });
    await expect(app.catalog(owner)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const results = await Promise.allSettled([publish(op), publish(op)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.find((item) => item.status === "rejected")).toMatchObject({
      reason: { code: "CONFLICT" },
    });
    h.clock.set("2026-11-05T09:16:00.000Z");
    await expect(app.catalog(op)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await h.reverifyAuthenticator(op);
    expect((await app.catalog(op)).version).toBe(1);
    const actor = await h.authenticate(op);
    await h.admin.query(
      "UPDATE platform_operator SET pricing=false WHERE user_id=$1",
      [actor.userId],
    );
    await expect(publish(op, offer, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("reapplies schema and security without losing quotes and denies mutable or foreign runtime access", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id);
    const op = await operator();
    await publish(op);
    const quote = await app.createQuote(owner, business.id, request(state));
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(await app.quote(owner, business.id, quote.snapshot.id)).toEqual(
      quote,
    );
    await expect(
      h.runtime.query("UPDATE subscription_quote SET snapshot='{}'::jsonb"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query("DELETE FROM subscription_pricing_revision"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await h.runtime.query("SELECT id FROM subscription_quote")).rows,
    ).toEqual([]);
  });

  it("preserves exact integer subtotals at the supported base-plus-capacity amount boundary", async () => {
    const { owner, business } = await setup();
    const { state } = await reviewedBilling(owner, business.id);
    const op = await operator();
    const maximum = { monthlyMinor: 1_000_000_000_000, pilotMinor: null };
    await publish(op, {
      ...offer,
      prices: { INR: maximum, USD: null },
      reservedCapacity: [
        { ...offer.reservedCapacity[0], prices: { INR: maximum, USD: null } },
      ],
    });
    const quote = await app.createQuote(
      owner,
      business.id,
      request(state, { reservedCapacityId: "reserved" }),
    );
    expect(quote.snapshot.initial.subtotalMinor).toBe(2_000_000_000_000);
    expect(quote.snapshot.renewal.subtotalMinor).toBe(2_000_000_000_000);
  });
});
