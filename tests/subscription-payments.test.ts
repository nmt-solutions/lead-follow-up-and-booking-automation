import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { deterministicPayments } from "./support/payment-gateway";
import { createDiscoveryApplication } from "../src/application/discovery";
import { createDiscoveryRepository } from "../src/db/discovery-repository";
import type { DiscoveryWork } from "../src/models/discovery";
import type { ScheduleWork } from "../src/models/discovery-schedules";
import { createSubscriptionPaymentHttp } from "../src/http/subscription-payments";
import { verifyRuntimeRole } from "../src/db/runtime";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";

describe("Subscription purchase at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  function compose(gateway = deterministicPayments(h.clock)) {
    const app = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway,
    });
    return { app, gateway };
  }
  async function research(f: Awaited<ReturnType<typeof subscriptionFixture>>) {
    await h.application.saveConfiguration(f.owner, f.business.id, {
      offering: "Steel",
      specifications: "",
      minimumOrder: "",
      deliveryConstraints: "",
      serviceConstraints: "",
      address: {
        street: "",
        locality: "Pune",
        region: "MH",
        postalCode: "",
        country: "India",
      },
      homeMarket: "Pune",
      homeMarketConfirmed: true,
      additionalMarkets: [],
      buyerCategories: [
        {
          label: "Fabricators",
          identity: "organization",
          use: "business_end_user",
          requiresBuyingRequest: false,
        },
      ],
      buyersReviewed: true,
      exclusions: [],
    });
    await h.admin.query(
      "INSERT INTO discovery_configuration(business_id,policy) VALUES($1,$2)",
      [
        f.business.id,
        JSON.stringify({
          adapterId: "fixture",
          activeMarkets: ["Pune"],
          coverage: [{ market: "Pune", source: "public_web" }],
          allowanceUnit: "research units",
          maxRunBudget: 10,
          searchUnits: 1,
          reviewUnits: 1,
          concurrency: 1,
          maxResults: 1,
          deadlineMs: 10000,
          permissions: {
            retainEvidence: true,
            retainQueries: false,
            displayEvidence: true,
            exportEvidence: true,
            afterCancellation: true,
            privateAiContext: true,
          },
        }),
      ],
    );
    const queued: DiscoveryWork[] = [],
      scheduled: ScheduleWork[] = [],
      searches: string[] = [];
    const app = createDiscoveryApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      authenticateWork: h.access.authenticateWork,
      repository: createDiscoveryRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
      queue: {
        enqueue: async (w) => {
          queued.push(w);
        },
        schedule: async (w) => {
          scheduled.push(w);
        },
      },
      provider: {
        id: "fixture",
        search: async (input) => {
          searches.push(input.offering);
          return [];
        },
        review: async () => null,
      },
    });
    const request = () => ({
      markets: ["Pune"],
      publicOffering: "Steel",
      confirmPublicQuery: true,
      budget: 1,
      requestKey: randomUUID(),
    });
    return { app, queued, scheduled, searches, request };
  }
  it("derives reviewed tax and payable amounts from the trusted quote without granting access", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(action).toMatchObject({
      state: "reviewed",
      snapshot: {
        quote: { id: f.quote.id, currency: "INR" },
        tax: {
          status: "calculated",
          totals: { netMinor: "10005", taxMinor: "1001", totalMinor: "11006" },
        },
        term: { kind: "calendar_month", timeZone: "UTC" },
      },
    });
    expect((await app.workspace(f.owner, f.business.id)).access).toMatchObject({
      active: false,
      paidThrough: null,
    });
    expect(gateway.created).toHaveLength(0);
    await expect(
      app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
        amountMinor: "1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("keeps checkout pending and grants exactly one calendar period only after authoritative reconciliation, even after purchaser sign-out", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    const reviewed = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    const checkout = await app.start(f.owner, f.business.id, {
      actionId: reviewed.id,
    });
    expect(checkout.state).toBe("checkout");
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    await h.signOut(f.owner);
    gateway.confirm(reviewed.operationKey);
    // A fresh application instance represents a restarted worker; no purchaser session is passed.
    const restarted = compose(gateway).app;
    await restarted.recover();
    await restarted.recover();
    const owner = await h.signIn("tax-owner@example.com");
    const state = await restarted.workspace(owner, f.business.id);
    expect(state.actions[0].state).toBe("confirmed");
    expect(state.periods).toHaveLength(1);
    expect(state.access).toMatchObject({
      active: true,
      paidThrough: "2026-12-05T09:00:00.000Z",
    });
    expect(gateway.created).toHaveLength(1);
  });
  it("hides unpaid acquisition markets despite configured operational coverage and retains stored work", async () => {
    const f = await subscriptionFixture(h);
    await h.application.saveConfiguration(f.owner, f.business.id, {
      offering: "Steel",
      specifications: "",
      minimumOrder: "",
      deliveryConstraints: "",
      serviceConstraints: "",
      address: {
        street: "",
        locality: "Pune",
        region: "MH",
        postalCode: "",
        country: "India",
      },
      homeMarket: "Pune",
      homeMarketConfirmed: true,
      additionalMarkets: [],
      buyerCategories: [
        {
          label: "Fabricators",
          identity: "organization",
          use: "business_end_user",
          requiresBuyingRequest: false,
        },
      ],
      buyersReviewed: true,
      exclusions: [],
    });
    const discovery = createDiscoveryApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      authenticateWork: h.access.authenticateWork,
      repository: createDiscoveryRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
      queue: { enqueue: async () => {}, schedule: async () => {} },
      provider: {
        id: "fixture",
        search: async () => [],
        review: async () => null,
      },
    });
    await h.admin.query(
      "INSERT INTO discovery_configuration(business_id,policy) VALUES($1,$2)",
      [
        f.business.id,
        JSON.stringify({
          adapterId: "fixture",
          activeMarkets: ["Pune"],
          coverage: [{ market: "Pune", source: "public_web" }],
          allowanceUnit: "research units",
          maxRunBudget: 10,
          searchUnits: 1,
          reviewUnits: 1,
          concurrency: 1,
          maxResults: 1,
          deadlineMs: 10000,
          permissions: {
            retainEvidence: true,
            retainQueries: false,
            displayEvidence: true,
            exportEvidence: true,
            afterCancellation: true,
            privateAiContext: true,
          },
        }),
      ],
    );
    expect(
      (await discovery.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual([]);
  });
  it("does not repeat an ambiguous create on retries or worker restart", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    gateway.ambiguous = true;
    const input = { quoteId: f.quote.id, requestKey: randomUUID() };
    const [a, b] = await Promise.all([
      app.prepare(f.owner, f.business.id, input),
      app.prepare(f.owner, f.business.id, input),
    ]);
    expect(a.id).toBe(b.id);
    await Promise.all([
      app.start(f.owner, f.business.id, { actionId: a.id }),
      app.start(f.owner, f.business.id, { actionId: a.id }),
    ]);
    await app.recover();
    expect(gateway.created).toHaveLength(1);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    gateway.confirm(a.operationKey);
    await compose(gateway).app.recover();
    expect((await app.workspace(f.owner, f.business.id)).periods).toHaveLength(
      1,
    );
  });
  it("rejects forged events and conflicting event replays, deduplicates distinct events for one payment and never regresses confirmation", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    gateway.confirm(a.operationKey);
    const observation = gateway.observations.get(a.operationKey)!;
    const event = (eventId: string, o = observation, valid = true) =>
      app.event({
        body: new TextEncoder().encode(
          JSON.stringify({ eventId, observation: o }),
        ),
        headers: new Headers({
          "x-fixture-signature": valid ? "valid" : "forged",
        }),
      });
    await expect(event("forged", observation, false)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    await Promise.all([event("event-1"), event("event-1"), event("event-2")]);
    await expect(
      event("event-1", { ...observation, status: "failed" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    gateway.observations.set(a.operationKey, {
      ...observation,
      status: "pending",
    });
    await event("older-pending");
    const state = await app.workspace(f.owner, f.business.id);
    expect(state.actions[0].state).toBe("confirmed");
    expect(state.periods).toHaveLength(1);
  });
  it("retains mismatch and failure states without granting a period and can reconcile corrected provider evidence", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    gateway.confirm(a.operationKey);
    const valid = gateway.observations.get(a.operationKey)!;
    gateway.observations.set(a.operationKey, { ...valid, amountMinor: "1" });
    expect(
      await app.refresh(f.owner, f.business.id, { actionId: a.id }),
    ).toMatchObject({
      state: "review_required",
      reason: "provider_binding_mismatch",
    });
    expect((await app.workspace(f.owner, f.business.id)).periods).toHaveLength(
      0,
    );
    gateway.observations.set(a.operationKey, { ...valid, status: "failed" });
    expect(
      (await app.refresh(f.owner, f.business.id, { actionId: a.id })).state,
    ).toBe("failed");
    gateway.observations.set(a.operationKey, valid);
    expect(
      (await app.operatorRefresh(f.operator, f.business.id, { actionId: a.id }))
        .state,
    ).toBe("confirmed");
  });
  it("rechecks reviewed evidence and approved rules before outbound I/O while retaining the immutable snapshot", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await f.tax.decideRule(f.operator, {
      revisionId: f.rules.revisions[0].id,
      expectedDecisionVersion: 1,
      outcome: "withdrawn",
      note: "Fixture withdrawal",
    });
    const result = await app.start(f.owner, f.business.id, { actionId: a.id });
    expect(result).toMatchObject({
      state: "review_required",
      reason: "financial_inputs_changed",
      snapshot: a.snapshot,
    });
    expect(gateway.created).toHaveLength(0);
  });
  it("preserves tax review requests with no total and enforces billing/operator tenant boundaries", async () => {
    const f = await subscriptionFixture(h);
    const { app, gateway } = compose();
    await f.tax.decideRule(f.operator, {
      revisionId: f.rules.revisions[0].id,
      expectedDecisionVersion: 1,
      outcome: "withdrawn",
      note: "Fixture withdrawal",
    });
    const a = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(a).toMatchObject({
      state: "review_required",
      snapshot: { tax: { totals: null } },
    });
    await app.start(f.owner, f.business.id, { actionId: a.id });
    expect(gateway.created).toHaveLength(0);
    const stranger = await h.signIn("stranger@example.com");
    await expect(app.workspace(stranger, f.business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(app.operatorQueue(f.owner)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await app.operatorQueue(f.operator))[0].id).toBe(a.id);
  });
  it("atomically bounds concurrent discovery runs by paid units and preserves completed work after exhaustion", async () => {
    const f = await subscriptionFixture(h, { discovery: 2 }),
      p = compose(),
      r = await research(f);
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual(["Pune"]);
    await Promise.all([
      r.app.start(f.owner, f.business.id, r.request()),
      r.app.start(f.owner, f.business.id, r.request()),
    ]);
    await Promise.all(r.queued.map((w) => r.app.execute(w)));
    expect(r.searches).toHaveLength(2);
    await expect(
      r.app.start(f.owner, f.business.id, r.request()),
    ).rejects.toMatchObject({ code: "PAID_ACCESS_REQUIRED" });
    expect((await r.app.workspace(f.owner, f.business.id)).runs).toHaveLength(
      2,
    );
  });
  it("fences saved schedules and queued reservations at paid-through while keeping their records available", async () => {
    let f = await subscriptionFixture(h);
    const p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    h.clock.set("2026-12-05T08:59:00Z");
    f = { ...f, owner: await h.signIn("tax-owner@example.com") };
    const r = await research(f);
    await r.app.saveSchedule(f.owner, f.business.id, {
      scheduleId: randomUUID(),
      expectedRevision: 0,
      name: "Paid boundary",
      timeZone: "UTC",
      localTime: "09:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      missed: "skip",
      overlap: "skip",
      dst: "compatible",
      search: r.request(),
      confirmRecurring: true,
    });
    await r.app.start(f.owner, f.business.id, r.request());
    h.clock.set("2026-12-05T09:00:00Z");
    await r.app.execute(r.queued[0]);
    await r.app.dispatchScheduled(r.scheduled[0]);
    const state = await r.app.workspace(f.owner, f.business.id);
    expect(state.availableMarkets).toEqual([]);
    expect(state.runs).toHaveLength(1);
    expect(state.schedules).toHaveLength(1);
    expect(r.searches).toHaveLength(0);
  });
  it.each([
    {
      country: "IN",
      term: "monthly" as const,
      total: "11006",
      end: "2027-02-28T09:00:00.000Z",
    },
    {
      country: "US",
      term: "monthly" as const,
      total: "2750",
      end: "2027-02-28T09:00:00.000Z",
    },
    {
      country: "IN",
      term: "paid_pilot" as const,
      total: "1100",
      end: "2027-02-14T09:00:00.000Z",
    },
  ])(
    "uses explicit $country $term amounts and term boundaries without 30-day assumptions",
    async ({ country, term, total, end }) => {
      h.clock.set("2027-01-31T09:00:00Z");
      const f = await subscriptionFixture(h, { country, term }),
        p = compose();
      const a = await p.app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      });
      expect(a.snapshot.tax.totals?.totalMinor).toBe(total);
      await p.app.start(f.owner, f.business.id, { actionId: a.id });
      p.gateway.confirm(a.operationKey);
      await p.app.recover();
      expect(
        (await p.app.workspace(f.owner, f.business.id)).access.paidThrough,
      ).toBe(end);
    },
  );
  it("keeps explicit zero allowances at zero after payment confirmation", async () => {
    const f = await subscriptionFixture(h, { discovery: 0, automation: 0 }),
      p = compose(),
      r = await research(f);
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    expect(
      (await p.app.workspace(f.owner, f.business.id)).access,
    ).toMatchObject({
      active: true,
      period: {
        snapshot: {
          quote: {
            initial: {
              discovery: { quantity: 0 },
              automation: { quantity: 0 },
            },
          },
        },
      },
    });
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual([]);
    await expect(
      r.app.start(f.owner, f.business.id, r.request()),
    ).rejects.toMatchObject({ code: "DISCOVERY_SETUP_REQUIRED" });
    expect(r.searches).toHaveLength(0);
  });
  it("requires explicit supported automation units before charging rather than inventing a conversion", async () => {
    const f = await subscriptionFixture(h, {
        automationUnit: "unmapped commercial actions",
      }),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(a).toMatchObject({
      state: "review_required",
      reason: "allowance_units_unavailable",
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    expect(p.gateway.created).toHaveLength(0);
  });
  it("runs the live composition contract with explicitly approved live-mode synthetic inputs and no fixture-only activation gate", async () => {
    const f = await subscriptionFixture(h, { mode: "live" }),
      p = compose(deterministicPayments(h.clock, "live"));
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    expect(a).toMatchObject({
      state: "reviewed",
      snapshot: {
        provider: { mode: "live" },
        tax: { mode: "live", status: "calculated" },
      },
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    expect((await p.app.workspace(f.owner, f.business.id)).access.active).toBe(
      true,
    );
  });
  it("honors the authoritative initial period when capture follows its start, without moving paid-through to capture time", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    const observation = p.gateway.observations.get(a.operationKey)!;
    h.clock.set("2026-11-05T09:01:00Z");
    p.gateway.observations.set(a.operationKey, {
      ...observation,
      paidAt: h.clock.now().toISOString(),
    });
    await p.app.recover();
    expect(
      (await p.app.workspace(f.owner, f.business.id)).access,
    ).toMatchObject({ active: true, paidThrough: "2026-12-05T09:00:00.000Z" });
  });
  it("durably retains authenticated unknown operations for the operator without inventing Business ownership", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    const observation = {
      ...p.gateway.observations.get(a.operationKey)!,
      operationKey: randomUUID(),
    };
    const incoming = {
      body: new TextEncoder().encode(
        JSON.stringify({ eventId: "unknown-operation", observation }),
      ),
      headers: new Headers({ "x-fixture-signature": "valid" }),
    };
    await p.app.event(incoming);
    await p.app.event(incoming);
    expect(await p.app.unmatchedEvents(f.operator)).toMatchObject([
      { actionId: null, businessId: null, eventId: "unknown-operation" },
    ]);
    expect(
      (await p.app.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(0);
  });
  it("recovers a receipt committed for a formerly failed action while the original event handler is lost before reconciliation", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.observations.set(a.operationKey, {
      ...p.gateway.observations.get(a.operationKey)!,
      status: "failed",
    });
    await p.app.refresh(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    let release = () => {},
      entered = () => {};
    const hold = new Promise<void>((r) => {
        release = r;
      }),
      waiting = new Promise<void>((r) => {
        entered = r;
      });
    const original = p.gateway.reconcile;
    let block = true;
    p.gateway.reconcile = async (input) => {
      if (block) {
        block = false;
        entered();
        await hold;
      }
      return original(input);
    };
    const event = p.app.event({
      body: new TextEncoder().encode(
        JSON.stringify({
          eventId: "late-confirmation",
          observation: p.gateway.observations.get(a.operationKey),
        }),
      ),
      headers: new Headers({ "x-fixture-signature": "valid" }),
    });
    let recovered = false;
    try {
      await waiting;
      await compose(p.gateway).app.recover();
      recovered = (await p.app.workspace(f.owner, f.business.id)).access.active;
    } finally {
      release();
      await event;
    }
    expect(recovered).toBe(true);
    expect(
      (await p.app.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
  });
  it("keeps an authenticated confirmation hint under review while authoritative provider state disagrees", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    const confirmation = p.gateway.observations.get(a.operationKey)!;
    p.gateway.observations.set(a.operationKey, {
      ...confirmation,
      status: "failed",
    });
    await p.app.event({
      body: new TextEncoder().encode(
        JSON.stringify({
          eventId: "not-yet-reconciled",
          observation: confirmation,
        }),
      ),
      headers: new Headers({ "x-fixture-signature": "valid" }),
    });
    expect(
      (await p.app.workspace(f.owner, f.business.id)).actions[0],
    ).toMatchObject({
      state: "review_required",
      reason: "provider_event_conflict",
    });
    expect((await p.app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    p.gateway.observations.set(a.operationKey, confirmation);
    await compose(p.gateway).app.recover();
    expect(
      (await p.app.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
  });
  it("deduplicates payment identity across different business operations and rejects reusing an event for another operation", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const first = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: first.id });
    p.gateway.observations.set(first.operationKey, {
      ...p.gateway.observations.get(first.operationKey)!,
      status: "failed",
    });
    await p.app.refresh(f.owner, f.business.id, { actionId: first.id });
    const second = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: second.id });
    p.gateway.confirm(first.operationKey);
    p.gateway.confirm(second.operationKey);
    const original = p.gateway.observations.get(first.operationKey)!,
      duplicate = {
        ...p.gateway.observations.get(second.operationKey)!,
        paymentId: original.paymentId,
      };
    p.gateway.observations.set(second.operationKey, duplicate);
    const receipt = (observation: typeof original) => ({
      body: new TextEncoder().encode(
        JSON.stringify({ eventId: "shared-event-identity", observation }),
      ),
      headers: new Headers({ "x-fixture-signature": "valid" }),
    });
    await p.app.event(receipt(original));
    await expect(p.app.event(receipt(duplicate))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await p.app.refresh(f.owner, f.business.id, { actionId: second.id });
    const state = await p.app.workspace(f.owner, f.business.id);
    expect(state.periods).toHaveLength(1);
    expect(state.actions.find((a) => a.id === second.id)).toMatchObject({
      state: "review_required",
      reason: "payment_or_period_already_allocated",
    });
  });
  it("allows staff to use only the scoped entitlement projection and denies financial detail and revoked operators", async () => {
    const f = await subscriptionFixture(h),
      p = compose(),
      r = await research(f);
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    await h.team.invite(f.owner, f.business.id, {
      email: "paid-staff@example.com",
      role: "salesperson",
    });
    const staff = await h.signIn("paid-staff@example.com");
    const mail = h.invitations.sent.at(-1)!;
    await h.team.accept(staff, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    expect(
      (await r.app.workspace(staff, f.business.id)).availableMarkets,
    ).toEqual(["Pune"]);
    await expect(p.app.workspace(staff, f.business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      p.app.prepare(staff, f.business.id, {
        quoteId: f.quote.id,
        requestKey: a.requestKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "UPDATE platform_operator SET reconciliation=false WHERE user_id=$1",
      [(await h.authenticate(f.operator)).userId],
    );
    await expect(p.app.operatorQueue(f.operator)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("uses bounded same-origin commands and treats a forged redirect as a status query only", async () => {
    const f = await subscriptionFixture(h),
      p = compose(),
      http = createSubscriptionPaymentHttp({
        application: p.app,
        origin: "http://localhost:3000",
        reportFailure: () => {},
      });
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    const forged = await http.start(
      new Request("http://localhost:3000/pay", {
        method: "POST",
        headers: {
          cookie: f.owner.get("cookie")!,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ actionId: a.id }),
      }),
      f.business.id,
    );
    expect(forged.status).toBe(403);
    expect(
      (
        await http.workspace(
          new Request("http://localhost:3000/pay?status=paid&payment=forged", {
            headers: f.owner,
          }),
          f.business.id,
        )
      ).status,
    ).toBe(200);
    expect((await p.app.workspace(f.owner, f.business.id)).access.active).toBe(
      false,
    );
    expect(p.gateway.created).toHaveLength(0);
  });
  it("keeps financial records hidden when unscoped and immutable across security/schema reapplication", async () => {
    const f = await subscriptionFixture(h),
      p = compose();
    const a = await p.app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await p.app.start(f.owner, f.business.id, { actionId: a.id });
    p.gateway.confirm(a.operationKey);
    await p.app.recover();
    expect(
      (await h.runtime.query("SELECT * FROM subscription_period")).rows,
    ).toEqual([]);
    await expect(
      h.runtime.query("UPDATE subscription_period SET payment_id='forged'"),
    ).rejects.toMatchObject({ code: "42501" });
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(
      (await p.app.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    await h.admin.query(
      "GRANT UPDATE (snapshot) ON subscription_payment TO app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toBeDefined();
    await secureDatabase(h.admin);
    await verifyRuntimeRole(h.runtime);
  });
  it("requires read and append grants separately for every financial ledger", async () => {
    for (const table of [
      "subscription_payment",
      "subscription_payment_event",
      "subscription_payment_history",
      "subscription_period",
      "subscription_usage",
    ]) {
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(`REVOKE ${privilege} ON ${table} FROM app_runtime`);
        try {
          await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
            code: "SETUP_REQUIRED",
          });
        } finally {
          await secureDatabase(h.admin);
        }
        await verifyRuntimeRole(h.runtime);
      }
    }
  });
  it("requires every restricted payment recovery function before accepting runtime setup", async () => {
    for (const signature of [
      "payment_worker_authorized(uuid,uuid)",
      "pending_subscription_payments(text,text)",
      "subscription_payment_target(text,text,uuid)",
      "subscription_payment_allocated(text,text,text,uuid)",
      "current_paid_scope(uuid,timestamptz)",
      "payment_event_identity(text,text,text,text,uuid)",
      "capture_unmatched_payment_event(jsonb,timestamptz)",
    ]) {
      await h.admin.query(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await prepareDatabaseRole(h.admin);
        await secureDatabase(h.admin);
      }
      await verifyRuntimeRole(h.runtime);
    }
  });
});
