import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { razorpayFixture } from "./support/razorpay";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { createDiscoveryApplication } from "../src/application/discovery";
import { createDiscoveryRepository } from "../src/db/discovery-repository";
import type { DiscoveryWork } from "../src/models/discovery";
import type { ScheduleWork } from "../src/models/discovery-schedules";
import { verifyRuntimeRole } from "../src/db/runtime";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";
import { runtimeDatabase } from "../src/db/runtime";

const policy = {
  id: "synthetic-lifecycle-policy",
  version: 1,
  mode: "test",
  reviewedBy: "deployment-operator",
  checkedAt: "2026-11-01T00:00:00.000Z",
  effectiveFrom: "2026-11-01T00:00:00.000Z",
  effectiveUntil: "2028-01-01T00:00:00.000Z",
  evidence: ["fixture:reviewed-customer-terms"],
  graceSeconds: 86400,
  graceAccess: "remaining_allowance",
  cancellationTiming: "cycle_end",
  cancellationAccess: "paid_through",
  preserveRecords: true,
};

describe("Subscription lifecycle at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  function compose(
    native: ReturnType<typeof razorpayFixture>,
    configuredPolicy = policy,
  ) {
    return createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      gateway: configuredPayments({
        ...native.configuration,
        env: {
          ...native.configuration.env,
          SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify(configuredPolicy),
        },
      }),
      clock: h.clock,
    });
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
  function signed(
    native: ReturnType<typeof razorpayFixture>,
    eventId: string,
    status: string,
    operationKey: string,
    subscriptionId = "sub_fixture1",
  ) {
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: native.review.account,
        event: `subscription.${status}`,
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        payload: {
          subscription: {
            entity: {
              id: subscriptionId,
              status,
              notes: { operation_key: operationKey },
            },
          },
        },
      }),
    );
    return {
      body,
      headers: new Headers({
        "x-razorpay-event-id": eventId,
        "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
          .update(body)
          .digest("hex"),
      }),
    };
  }
  it("fences failed-renewal grace at the exact boundary and restores access only from a captured original-basis renewal after restart", async () => {
    const f = await subscriptionFixture(h);
    const native = razorpayFixture(h.clock);
    let app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const initial = (await app.workspace(f.owner, f.business.id)).periods[0];
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.subscriptions.get("sub_fixture1")!.status = "pending";
    await app.recover();
    let owner = await h.signIn("tax-owner@example.com");
    let state = await app.workspace(owner, f.business.id);
    expect(state.actions[0].lifecycle).toMatchObject({
      state: "past_due",
      paidThrough: "2026-12-05T09:00:00.000Z",
      graceEnd: "2026-12-06T09:00:00.000Z",
    });
    expect(state.access.active).toBe(true);
    expect(state.periods).toHaveLength(1);
    h.clock.set("2026-12-06T09:00:00.000Z");
    owner = await h.signIn("tax-owner@example.com");
    expect((await app.workspace(owner, f.business.id)).access.active).toBe(
      false,
    );
    expect(
      (
        await app.workspace(owner, f.business.id)
      ).actions[0].lifecycleEvents.filter(
        (e) => e.notice?.kind === "access_ended",
      ),
    ).toHaveLength(1);
    native.subscriptions.get("sub_fixture1")!.status = "active";
    await app.recover();
    expect((await app.workspace(owner, f.business.id)).access.active).toBe(
      false,
    );
    native.charge(
      "pay_recovered",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    app = compose(native);
    await app.recover();
    await app.recover();
    state = await app.workspace(owner, f.business.id);
    expect(state.access.active).toBe(true);
    expect(state.actions[0].lifecycle?.state).toBe("active");
    expect(state.periods).toHaveLength(2);
    expect(state.periods[0]).toEqual(initial);
    expect(state.periods[1].snapshot.basis?.kind).toBe("renewal");
    expect(
      state.actions[0].lifecycleEvents?.filter(
        (e) => e.notice?.kind === "payment_recovered",
      ),
    ).toHaveLength(1);
    expect(native.creations).toHaveLength(1);
    native.subscriptions.get("sub_fixture1")!.status = "pending";
    native.subscriptions.get("sub_fixture1")!.current_end = Math.floor(
      new Date("2026-12-05T09:00:00.000Z").getTime() / 1000,
    );
    await app.recover();
    expect(
      (await app.workspace(owner, f.business.id)).actions[0].lifecycle?.state,
    ).toBe("active");
  });
  it("persists ambiguous cancellation before I/O, never repeats it after restart, and reconciles provider-confirmed end without losing a racing capture", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    let app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const original = (await app.workspace(f.owner, f.business.id)).periods[0];
    native.loseCancellation = true;
    const command = { actionId: action.id, requestKey: randomUUID() };
    const result = await app.cancel(f.owner, f.business.id, command);
    expect(result.lifecycle?.cancellation?.status).toBe("requested");
    app = compose(native);
    await app.cancel(f.owner, f.business.id, command);
    await app.recover();
    expect(
      native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(1);
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      true,
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.subscriptions.get("sub_fixture1")!.status = "pending";
    await app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    expect((await app.workspace(owner, f.business.id)).access.active).toBe(
      true,
    );
    // An unconfirmed request does not prematurely withdraw an approved grace period.
    native.subscriptions.get("sub_fixture1")!.status = "cancelled";
    native.subscriptions.get("sub_fixture1")!.ended_at = Math.floor(
      new Date("2026-12-05T09:00:00.000Z").getTime() / 1000,
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    await app.recover();
    const state = await app.workspace(owner, f.business.id);
    expect(state.actions[0].lifecycle).toMatchObject({
      state: "cancelled",
      cancellation: {
        status: "confirmed",
        effectiveEnd: "2026-12-05T09:00:00.000Z",
      },
    });
    expect(state.access.active).toBe(false);
    expect(state.periods[0]).toEqual(original);
    expect(
      state.actions[0].lifecycleEvents.filter(
        (e) => e.notice?.kind === "cancellation_requested",
      ),
    ).toHaveLength(1);
  });
  it("offers genuine bound native card-change input with current authority and records in-app availability without claiming delivered email", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const command = { actionId: action.id, requestKey: randomUUID() };
    expect(await app.updatePayment(f.owner, f.business.id, command)).toEqual({
      script: "https://checkout.razorpay.com/v1/checkout.js",
      key: "rzp_test_fixture",
      subscription_id: "sub_fixture1",
      subscription_card_change: true,
    });
    await app.updatePayment(f.owner, f.business.id, command);
    const state = await app.workspace(f.owner, f.business.id);
    expect(
      state.actions[0].lifecycleEvents.filter(
        (e) => e.kind === "payment_method_prepared",
      ),
    ).toHaveLength(1);
    expect(
      state.actions[0].lifecycleEvents.every(
        (e) =>
          !e.notice ||
          (e.notice.channel === "in_app" && e.notice.status === "available"),
      ),
    ).toBe(true);
    const foreign = await h.application.createBusiness(f.owner, {
      name: "Another Business",
      offering: "Steel",
      homeMarket: "Pune",
      website: "",
    });
    await expect(
      app.updatePayment(f.owner, foreign.id, command),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(native.creations).toHaveLength(1);
  });
  it("retains exact signed lifecycle hints without letting duplicated, unconfirmed, wrong-subscription or older events grant access", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    const active = signed(native, "evt_active", "active", action.operationKey);
    await app.event(active);
    await app.event(active);
    let state = await app.workspace(f.owner, f.business.id);
    expect(state.actions[0].events).toHaveLength(1);
    expect(state.actions[0].events[0].observation.native).toMatchObject({
      event: "subscription.active",
      status: "active",
      occurredAt: "2026-11-05T09:00:00.000Z",
    });
    expect(state.access.active).toBe(false);
    await expect(
      app.event(signed(native, "evt_active", "halted", action.operationKey)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await app.event(
      signed(
        native,
        "evt_foreign",
        "cancelled",
        action.operationKey,
        "sub_other",
      ),
    );
    await app.recover();
    state = await app.workspace(f.owner, f.business.id);
    expect(state.actions[0].lifecycle?.state).toBe("pending");
    expect(state.access.active).toBe(false);
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    await app.event(
      signed(native, "evt_old_pending", "pending", action.operationKey),
    );
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].lifecycle?.state,
    ).toBe("active");
    // Schema-owner prerequisite represents the original pre-#46 receipt format.
    await h.admin.query(
      "UPDATE subscription_payment_event SET observation=observation-'native' WHERE action_id=$1 AND event_id='evt_active'",
      [action.id],
    );
    await app.event(active);
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].events.find(
        (e) => e.eventId === "evt_active",
      )?.observation.native,
    ).toBeUndefined();
  });
  it("requires an actual effective reviewed policy for grace and cancellation while retaining captured history and supporting configuration repair", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    const without = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      gateway: configuredPayments(native.configuration),
      clock: h.clock,
    });
    const action = await without.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await without.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await without.recover();
    await expect(
      without.cancel(f.owner, f.business.id, {
        actionId: action.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.subscriptions.get("sub_fixture1")!.status = "pending";
    await without.recover();
    const owner = await h.signIn("tax-owner@example.com");
    expect((await without.workspace(owner, f.business.id)).access.active).toBe(
      false,
    );
    const configured = compose(native);
    await configured.recover();
    expect(
      (await configured.workspace(owner, f.business.id)).access.active,
    ).toBe(true);
    expect(
      native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(0);
    expect(
      (await configured.workspace(owner, f.business.id)).periods,
    ).toHaveLength(1);
    await without.workspace(owner, f.business.id);
    await expect(
      compose(native, { ...policy, graceSeconds: 60 }).recover(),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("confirms scheduled cancellation separately from paid-through and retains an end-racing captured invoice without reviving access", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const result = await app.cancel(f.owner, f.business.id, {
      actionId: action.id,
      requestKey: randomUUID(),
    });
    expect(result.lifecycle).toMatchObject({
      state: "active",
      cancellation: {
        status: "confirmed",
        effectiveEnd: "2026-12-05T09:00:00.000Z",
      },
    });
    expect((await app.workspace(f.owner, f.business.id)).access.active).toBe(
      true,
    );
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.charge(
      "pay_race",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    await app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    const state = await app.workspace(owner, f.business.id);
    expect(state.periods).toHaveLength(2);
    expect(state.access).toMatchObject({
      active: false,
      paidThrough: "2027-01-05T09:00:00.000Z",
    });
    expect(state.actions[0].lifecycle).toMatchObject({
      state: "cancelled",
      accessState: "blocked",
    });
    await expect(
      app.updatePayment(owner, f.business.id, {
        actionId: action.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(1);
  });
  it("applies grace to actual acquisition and saved-schedule consumers and never revives an expired queued run on recovery", async () => {
    let f = await subscriptionFixture(h);
    const native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.subscriptions.get("sub_fixture1")!.status = "pending";
    await app.recover();
    f = { ...f, owner: await h.signIn("tax-owner@example.com") };
    const r = await research(f);
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual(["Pune"]);
    await r.app.saveSchedule(f.owner, f.business.id, {
      scheduleId: randomUUID(),
      expectedRevision: 0,
      name: "Lifecycle boundary",
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
    h.clock.set("2026-12-06T09:00:00.000Z");
    await r.app.execute(r.queued[0]);
    await r.app.dispatchScheduled(r.scheduled[0]);
    f = { ...f, owner: await h.signIn("tax-owner@example.com") };
    expect(
      (await r.app.workspace(f.owner, f.business.id)).availableMarkets,
    ).toEqual([]);
    native.charge(
      "pay_recovery",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    await app.recover();
    await r.app.execute(r.queued[0]);
    const state = await r.app.workspace(f.owner, f.business.id);
    expect(state.availableMarkets).toEqual(["Pune"]);
    expect(state.runs).toHaveLength(1);
    expect(state.schedules).toHaveLength(1);
    expect(r.searches).toHaveLength(0);
  });
  it("retains immutable scoped lifecycle history through managed unique/FK replacement and checks read and append grants separately", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    const events = (await app.workspace(f.owner, f.business.id)).actions[0]
      .lifecycleEvents;
    expect(
      (await h.runtime.query("SELECT * FROM subscription_lifecycle_event"))
        .rows,
    ).toHaveLength(0);
    await expect(
      h.runtime.query("UPDATE subscription_lifecycle_event SET kind='forged'"),
    ).rejects.toMatchObject({ code: "42501" });
    await h.reapplySchema();
    await prepareDatabaseRole(h.admin);
    try {
      await h.admin.query(
        "ALTER TABLE subscription_payment DROP CONSTRAINT subscription_payment_scope; ALTER TABLE subscription_payment ADD CONSTRAINT subscription_payment_scope UNIQUE(id,business_id)",
      );
      await expect(
        h.runtime.query("SELECT * FROM subscription_lifecycle_event"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await secureDatabase(h.admin);
    }
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].lifecycleEvents,
    ).toEqual(events);
    for (const privilege of ["SELECT", "INSERT"]) {
      await h.admin.query(
        `REVOKE ${privilege} ON subscription_lifecycle_event FROM app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
      await verifyRuntimeRole(h.runtime);
    }
  });
  it("rechecks current Business authority and operator MFA/capability for lifecycle commands and the notification seam", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    const operator = await h.signIn("lifecycle-operator@example.com");
    await h.provisionOperator(operator, { tax: false, reconciliation: true });
    expect(await h.access.status(operator)).toMatchObject({
      required: true,
      operator: true,
      readiness: "mfa-satisfied",
    });
    await app.workspace(f.owner, f.business.id);
    expect((await app.notificationFeed(operator)).length).toBeGreaterThan(0);
    h.clock.set("2026-11-05T09:15:00.000Z");
    await expect(app.notificationFeed(operator)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await h.reverifyAuthenticator(operator);
    await h.admin.query(
      "UPDATE platform_operator SET reconciliation=false WHERE user_id=$1",
      [(await h.authenticate(operator)).userId],
    );
    await expect(app.notificationFeed(operator)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.admin.query(
      "UPDATE membership SET role='salesperson' WHERE business_id=$1 AND user_id=$2",
      [f.business.id, (await h.authenticate(f.owner)).userId],
    );
    await expect(
      app.cancel(f.owner, f.business.id, {
        actionId: action.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app.updatePayment(f.owner, f.business.id, {
        actionId: action.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      native.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/cancel"),
      ),
    ).toHaveLength(0);
  });
  it("enriches a terminal observation with its later authoritative end time and never restarts a cancelled subscription", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      app = compose(native);
    const action = await app.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await app.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await app.recover();
    native.subscriptions.get("sub_fixture1")!.status = "cancelled";
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].lifecycle
        ?.cancellation,
    ).toBeNull();
    native.subscriptions.get("sub_fixture1")!.ended_at = Math.floor(
      h.clock.now().getTime() / 1000,
    );
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].lifecycle
        ?.cancellation,
    ).toMatchObject({
      status: "confirmed",
      effectiveEnd: "2026-11-05T09:00:00.000Z",
    });
    native.subscriptions.get("sub_fixture1")!.status = "active";
    await app.recover();
    expect(
      (await app.workspace(f.owner, f.business.id)).actions[0].lifecycle?.state,
    ).toBe("cancelled");
  });
  it.each(["paid_through", "provider_end"])(
    "uses the explicitly reviewed %s access boundary for immediate cancellation even in the capture's timestamp",
    async (cancellationAccess) => {
      const f = await subscriptionFixture(h),
        native = razorpayFixture(h.clock),
        app = compose(native, {
          ...policy,
          cancellationTiming: "immediate",
          cancellationAccess,
        });
      const action = await app.prepare(f.owner, f.business.id, {
        quoteId: f.quote.id,
        requestKey: randomUUID(),
      });
      await app.start(f.owner, f.business.id, { actionId: action.id });
      native.charge(
        "pay_initial",
        "2026-11-05T09:00:00.000Z",
        "2026-12-05T09:00:00.000Z",
      );
      await app.recover();
      // Historical positive periods before per-charge native evidence remain valid financial authority.
      await h.admin.query(
        "UPDATE subscription_period SET charge=NULL WHERE action_id=$1",
        [action.id],
      );
      await app.cancel(f.owner, f.business.id, {
        actionId: action.id,
        requestKey: randomUUID(),
      });
      const state = await app.workspace(f.owner, f.business.id);
      expect(state.actions[0].lifecycle?.state).toBe("cancelled");
      expect(state.periods).toHaveLength(1);
      expect(state.access.active).toBe(cancellationAccess === "paid_through");
    },
  );
});
