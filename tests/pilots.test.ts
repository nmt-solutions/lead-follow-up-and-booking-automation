import { historicalPilot } from "./support/historical-pilot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { createPilotApplication } from "../src/application/pilots";
import { createPilotRepository } from "../src/db/pilot-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayFixture } from "./support/razorpay";
import { createReportingRepository } from "../src/db/reporting-repository";
import { pilotFixture } from "./support/pilot";
import { createPilotHttp } from "../src/http/pilots";

describe("Bounded paid pilot application", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  async function setup() {
    const f = await subscriptionFixture(h, { term: "paid_pilot" });
    const actor = await h.authenticate(f.owner);
    await h.admin.query(
      "INSERT INTO platform_operator(user_id,pilots) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET pilots=true",
      [actor.userId],
    );
    const database = runtimeDatabase(h.runtime),
      native = razorpayFixture(h.clock),
      gateway = configuredPayments(native.configuration);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(database),
      clock: h.clock,
      gateway,
    });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    const repository = createPilotRepository(database, h.clock);
    const app = createPilotApplication({
      authenticate: h.access.authenticateForWork,
      repository,
      clock: h.clock,
      reporting: createReportingRepository(database, h.clock),
      inspect: async () => [],
    });
    const plan = {
      paymentActionId: action.id,
      goal: "Qualified steel quotation requests",
      baseline: [
        {
          metric: "rfqs",
          value: 0,
          unit: "distinct needs",
          evidence: "fixture:prior-month-register",
        },
      ],
      criteria: [
        {
          metric: "rfqs",
          comparison: "at_least",
          target: 2,
          unit: "distinct needs",
        },
      ],
      scope: "Selected existing inquiry records",
      startsAt: h.clock.now().toISOString(),
      endsAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
      capabilities: ["inquiry_email"],
      emailActions: [],
      senderId: null,
      mailboxId: null,
      calendarId: null,
      calendarConnectionId: null,
      calendarProvider: null,
      whatsAppConnectionId: null,
      currency: "INR",
      cashLimitMinor: "100",
      spendLimitMinor: "80",
      timeLimitSeconds: 600,
      ceilings: {
        discovery: {
          cashMinor: "10",
          spendMinor: "8",
          seconds: 30,
          globalSpendInrMicros: null,
          evidence: "fixture:upper-bound-not-measured-actual",
        },
        automation: {
          cashMinor: "10",
          spendMinor: "8",
          seconds: 30,
          globalSpendInrMicros: null,
          evidence: "fixture:upper-bound-not-measured-actual",
        },
        mailbox: null,
        calendar: null,
      },
      approvalEvidence: "fixture:explicit-customer-and-founder-proposal",
    };
    return { f, app, plan, repository, actor };
  }
  it("retains actual commercial inputs and numeric criteria while exposing missing launch prerequisites independently", async () => {
    const s = await setup();
    const view = await s.app.prepare(s.f.owner, s.f.business.id, {
      requestKey: randomUUID(),
      plan: s.plan,
    });
    expect(view.business).toEqual({
      name: "Fixture Business",
      offering: "Steel",
    });
    expect(view.plan).toEqual(s.plan);
    expect(view.payment).toMatchObject({
      quote: {
        initial: { subtotalMinor: 1000, days: 14 },
        renewal: { subtotalMinor: 10005 },
      },
    });
    expect(view.payment.provider.review).toBeUndefined();
    expect(view.status).toBe("prepared");
    expect(view.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "payment", ready: false }),
        expect.objectContaining({ capability: "inquiry_email", ready: false }),
      ]),
    );
    const stranger = await h.signIn("foreign-pilot@example.com");
    await expect(
      s.app.workspace(stranger, s.f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).pilots,
    ).toHaveLength(1);
    const http = createPilotHttp({
      application: s.app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const request = (body: string, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/pilots", {
        method: "POST",
        headers: new Headers([
          ...s.f.owner.entries(),
          ["origin", origin],
          ["content-type", "application/json"],
        ]),
        body,
      });
    expect(
      (
        await http.get(
          new Request("http://localhost:3000/api/pilots", {
            headers: s.f.owner,
          }),
          s.f.business.id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await http.command(
          request("{}", "https://foreign.example"),
          s.f.business.id,
          "prepare",
        )
      ).status,
    ).toBe(403);
    expect(
      (await http.command(request("not JSON"), s.f.business.id, "prepare"))
        .status,
    ).toBe(400);
    expect(
      (
        await http.command(
          request(JSON.stringify({ payload: "x".repeat(65537) })),
          s.f.business.id,
          "prepare",
        )
      ).status,
    ).toBe(400);
    expect(
      (await http.command(request("{}"), s.f.business.id, "unknown")).status,
    ).toBe(404);
    expect(
      (await http.command(request("{}"), s.f.business.id, "activate")).status,
    ).toBe(400);
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).pilots[0].events,
    ).toHaveLength(1);
    await h.reapplySchema();
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).pilots[0].plan,
    ).toEqual(s.plan);
  });
  it("enforces approved time and spend on real discovery commands across worker restarts instead of treating the checklist as permission", async () => {
    const s = await pilotFixture(h);
    expect(
      (
        await s.pilots.preflight(s.f.owner, s.f.business.id, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.filter((g) => !g.ready),
    ).toEqual([]);
    const p = await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect(p.status).toBe("active");
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(1);
    const state = await s.pilots.workspace(s.f.owner, s.f.business.id);
    expect(state.pilots[0].usage).toMatchObject({
      cashMinor: "20",
      spendMinor: "16",
      seconds: 60,
    });
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(1);
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(1);
    expect(
      (await s.pilots.workspace(s.f.owner, s.f.business.id)).pilots[0].usage
        .seconds,
    ).toBe(60);
  });
  it("applies the current independent global cap without disclosing global costs or allowing a lower cap to be bypassed by a queued pilot run", async () => {
    const s = await pilotFixture(h, {
      cashLimitMinor: "1000",
      spendLimitMinor: "1000",
      timeLimitSeconds: 6000,
    });
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.setGlobal(1, "340000");
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(1);
    const state = await s.pilots.workspace(s.f.owner, s.f.business.id);
    expect(state.pilots[0].usage).toMatchObject({
      spendMinor: "8",
      seconds: 30,
    });
    expect(JSON.stringify(state)).not.toContain("fixture-hosting");
    expect(JSON.stringify(state)).not.toContain("pilot-platform-baseline");
    expect(JSON.stringify(state)).not.toContain("limitInrMicros");
  });
  it("rechecks retention and selected paths and cannot record a checklist renewal without measured results and a genuine post-pilot capture", async () => {
    const s = await pilotFixture(h);
    s.withdrawRetention();
    await expect(
      s.pilots.activate(s.f.owner, s.f.business.id, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await expect(
      s.pilots.renewal(s.f.owner, s.f.business.id, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await s.pilots.workspace(s.f.owner, s.f.business.id)
      ).pilots[0].events.map((e) => e.kind),
    ).toEqual(["prepared", "approved"]);
  });
  it("records canonical measured results, actual attributable effort and paid continuation before contrasting reuse, and retracts validation after cancellation", async () => {
    const s = await pilotFixture(h),
      first = await historicalPilot(h, s);
    await s.costs.refresh(s.f.owner, {
      month: h.clock.now().toISOString().slice(0, 7),
      retentionSeconds: 86400,
    });
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    const ref = { pilotId: first.pilotId, requestKey: randomUUID() };
    await expect(
      s.pilots.renewal(s.f.owner, first.business.id, ref),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await s.pilots.effort(s.f.owner, first.business.id, {
      ...ref,
      requestKey: randomUUID(),
      kind: "billing_tax",
      seconds: 123,
      cashMinor: "40",
      spendMinor: "50",
      occurredAt: first.end,
      evidence: "fixture:actual-recorded-billing-effort",
    });
    const measured = await s.pilots.results(s.f.owner, first.business.id, {
      ...ref,
      requestKey: randomUUID(),
      from: first.start,
      to: first.end,
      contribution: {
        revenueExcludingTaxMinor: "1000",
        providerExpenseMinor: "30",
        effortExpenseMinor: "50",
        customerPaidMetaMinor: null,
        evidence: ["fixture:attributed-actual-inputs"],
        complete: false,
      },
      assessment:
        "Canonical report has incomplete coverage; no pilot success claim.",
    });
    expect(measured.report?.metrics.length).toBeGreaterThan(5);
    expect(measured.usage.seconds).toBe(123);
    expect(
      measured.events.find((e) => e.kind === "results")?.data,
    ).toMatchObject({
      contribution: {
        netBeforeUnrecordedInputsMinor: "920",
        coverage: "Incomplete: no full contribution or margin conclusion.",
      },
      canonicalAccounting: {
        captures: [{ capturedMinor: "1100" }, { capturedMinor: "11006" }],
      },
    });
    const renewed = await s.pilots.renewal(s.f.owner, first.business.id, ref);
    expect(renewed.financialEvidence.renewal).toMatchObject({
      periodId: first.renewalPeriodId,
      paymentId: "pay_historicalMonthly",
      amountMinor: "11006",
    });
    const reused = await s.pilots.reuse(s.f.owner, first.business.id, {
      ...ref,
      requestKey: randomUUID(),
      secondBusinessId: s.f.business.id,
      secondPilotId: s.pilot.id,
      differentNeed:
        "Cleaning inquiry qualification versus steel prospect discovery",
      reusedConfiguration: [
        {
          first: "ceilings",
          second: "ceilings",
          evidence: "fixture:actual-reviewed-configuration-comparison",
        },
      ],
      adaptations: "Different offering, purpose and source scope reviewed.",
    });
    expect(reused.status).toBe("reuse_recorded");
    expect(reused.events.at(-1)?.data).toMatchObject({
      configuration: [{ equal: true }],
    });
    expect(JSON.stringify(reused.events.at(-1))).not.toContain(
      "spendLimitMinor",
    );
    await h.admin.query(
      "update subscription_payment set lifecycle=$2::jsonb where id=$1",
      [
        first.renewalId,
        JSON.stringify({
          state: "cancelled",
          accessState: "blocked",
          paidThrough: null,
          graceEnd: null,
          failedThrough: null,
          policy: null,
          provider: null,
          reason: "fixture:confirmed-native-cancellation",
          evaluatedAt: h.clock.now().toISOString(),
          cancellation: {
            requestKey: randomUUID(),
            requestedAt: h.clock.now().toISOString(),
            actorId: (await h.access.authenticateForWork(s.f.owner)).userId,
            timing: "immediate",
            access: "provider_end",
            paidThroughAtRequest: null,
            status: "confirmed",
            confirmedAt: h.clock.now().toISOString(),
            effectiveEnd: h.clock.now().toISOString(),
          },
        }),
      ],
    );
    const cancelled = (await s.pilots.workspace(s.f.owner, first.business.id))
      .pilots[0];
    expect(cancelled.financialEvidence.renewalPaid).toBe(false);
    expect(cancelled.events.some((e) => e.kind === "renewal")).toBe(true);
    await expect(
      s.pilots.reuse(s.f.owner, first.business.id, {
        ...ref,
        requestKey: randomUUID(),
        secondBusinessId: s.f.business.id,
        secondPilotId: s.pilot.id,
        differentNeed: "Different",
        reusedConfiguration: [
          { first: "scope", second: "scope", evidence: "fixture" },
        ],
        adaptations: "Actual",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not treat unknown costs or effort as free, excludes customer-paid Meta and fences an already queued run after actual effort exceeds approval", async () => {
    const s = await pilotFixture(h),
      businessId = s.f.business.id;
    const source = {
      month: h.clock.now().toISOString().slice(0, 7),
      provider: "meta",
      category: "integration",
      kind: "customer_paid_meta",
      funding: "customer_meta",
      amount: { currency: "INR", micros: "999999999999" },
      quantity: 1,
      unit: "statement",
      businessId,
      runId: null,
      allocation: "fixture:customer-owns-billing",
      evidence: "fixture:customer-paid-meta",
      observedAt: h.clock.now().toISOString(),
      freshUntil: new Date(h.clock.now().getTime() + 86400000).toISOString(),
      plan: null,
      status: "recorded",
      details: {},
    };
    await s.costs.record(s.f.owner, {
      sourceId: "evidence:meta-customer",
      expectedVersion: 0,
      reason: "Actual separate customer billing fixture",
      retentionSeconds: 86400,
      source,
    });
    expect(
      (
        await s.pilots.preflight(s.f.owner, businessId, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.find((g) => g.capability === "global_budget")?.ready,
    ).toBe(true);
    await s.costs.record(s.f.owner, {
      sourceId: "evidence:unpriced",
      expectedVersion: 0,
      reason: "Unknown operator invoice must block new work",
      retentionSeconds: 86400,
      source: {
        ...source,
        provider: "known-provider",
        funding: "cash",
        kind: "consumption",
        amount: null,
        status: "unpriced",
      },
    });
    await expect(
      s.pilots.activate(s.f.owner, businessId, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await s.costs.record(s.f.owner, {
      sourceId: "evidence:unpriced",
      expectedVersion: 1,
      reason: "Fixture actual statement resolves missing price",
      retentionSeconds: 86400,
      source: {
        ...source,
        provider: "known-provider",
        funding: "cash",
        kind: "consumption",
        amount: { currency: "INR", micros: "1" },
        status: "recorded",
      },
    });
    await s.pilots.activate(s.f.owner, businessId, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, businessId, s.request());
    const view = await s.pilots.effort(s.f.owner, businessId, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
      kind: "support",
      seconds: 61,
      cashMinor: "0",
      spendMinor: "0",
      occurredAt: h.clock.now().toISOString(),
      evidence: "fixture:actual-overrun-must-remain-truthful",
    });
    expect(view.usage.seconds).toBe(61);
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(0);
  });
  it("requires a new explicit bounded operating plan for an actual paid monthly continuation, preserving the original pilot instead of silently extending it", async () => {
    const s = await pilotFixture(h),
      first = await historicalPilot(h, s);
    const original = (await s.pilots.workspace(s.f.owner, first.business.id))
      .pilots[0];
    await s.pilots.stop(s.f.owner, first.business.id, {
      pilotId: first.pilotId,
      requestKey: randomUUID(),
    });
    const plan = {
      ...first.plan,
      paymentActionId: first.renewalId,
      scope: "Explicit monthly cleaning evaluation",
      startsAt: h.clock.now().toISOString(),
      endsAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
    };
    const next = await s.pilots.prepare(s.f.owner, first.business.id, {
      requestKey: randomUUID(),
      plan,
    });
    expect(next.payment.term.kind).toBe("calendar_month");
    await s.pilots.approve(s.f.owner, first.business.id, {
      pilotId: next.id,
      requestKey: randomUUID(),
    });
    const preflight = await s.pilots.preflight(s.f.owner, first.business.id, {
      pilotId: next.id,
      requestKey: randomUUID(),
    });
    expect(preflight.gates.filter((g) => !g.ready)).toEqual([]);
    expect(
      (
        await s.pilots.activate(s.f.owner, first.business.id, {
          pilotId: next.id,
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe("active");
    const records = (await s.pilots.workspace(s.f.owner, first.business.id))
      .pilots;
    expect(records[0].plan).toEqual(original.plan);
    expect(records[0].payment).toEqual(original.payment);
    expect(s.mutations).toHaveLength(1);
  });

  it("keeps recorded human expense subject to the independent global cap after current authorized native cost normalization", async () => {
    const s = await pilotFixture(h, {
        cashLimitMinor: "1000",
        spendLimitMinor: "1000",
        timeLimitSeconds: 6000,
      }),
      b = s.f.business.id;
    await s.pilots.activate(s.f.owner, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.setGlobal(1, "300000");
    await s.pilots.effort(s.f.owner, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
      kind: "support",
      seconds: 10,
      cashMinor: "10",
      spendMinor: "10",
      occurredAt: h.clock.now().toISOString(),
      evidence: "fixture:actual-separately-attributed-human-expense",
    });
    expect(
      (
        await s.pilots.preflight(s.f.owner, b, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.find((g) => g.capability === "global_budget")?.ready,
    ).toBe(false);
    await s.costs.refresh(s.f.owner, {
      month: h.clock.now().toISOString().slice(0, 7),
      retentionSeconds: 86400,
    });
    const costs = await s.costs.workspace(
      s.f.owner,
      h.clock.now().toISOString().slice(0, 7),
    );
    expect(
      costs.history.filter((r) => r.source.provider === "pilot_effort").at(-1)
        ?.source.amount,
    ).toEqual({ currency: "INR", micros: "100000" });
    await s.discovery.start(s.f.owner, b, s.request());
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(0);
  });
  it("rechecks the original persisted actor after the global cost serialization wait before real queued discovery I/O", async () => {
    const s = await pilotFixture(h),
      b = s.f.business.id,
      actor = await h.access.authenticateForWork(s.f.owner);
    await s.pilots.activate(s.f.owner, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, b, s.request());
    const blocker = await h.admin.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "select pg_advisory_xact_lock(hashtextextended('operator-costs',0))",
    );
    const execution = s.discovery.execute(s.queued.at(-1));
    try {
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (
          await h.admin.query(
            "select exists(select 1 from pg_locks l where l.locktype='advisory' and not l.granted and l.database=(select oid from pg_database where datname=current_database())) waiting",
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await h.admin.query("delete from session where id=$1", [actor.sessionId]);
      await blocker.query("ROLLBACK");
      await execution;
      expect(s.searches).toHaveLength(0);
      const current = await h.signIn("tax-owner@example.com");
      expect(
        (await s.pilots.workspace(current, b)).pilots[0].usage,
      ).toMatchObject({ cashMinor: "0", spendMinor: "0", seconds: 0 });
      const state = await s.discovery.workspace(current, b);
      expect(state.runs[0]).toMatchObject({ used: 0 });
      expect(state.prospects).toEqual([]);
      await s.discovery.start(current, b, s.request());
      await s.discovery.execute(s.queued.at(-1));
      expect(s.searches).toHaveLength(1);
      expect((await s.discovery.workspace(current, b)).prospects).toHaveLength(
        1,
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await execution.catch(() => {});
    }
  });
  it("lets the current owner withdraw an approved operating plan after the pilot recorder capability is revoked, fencing queued work", async () => {
    const s = await pilotFixture(h),
      b = s.f.business.id,
      actor = await h.authenticate(s.f.owner);
    await s.pilots.activate(s.f.owner, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, b, s.request());
    await h.admin.query(
      "update platform_operator set pilots=false where user_id=$1",
      [actor.userId],
    );
    expect((await s.pilots.workspace(s.f.owner, b)).canRecord).toBe(false);
    const stopped = await s.pilots.stop(s.f.owner, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect(stopped.status).toBe("stopped");
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(0);
  });
});
