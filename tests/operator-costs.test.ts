import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createCostRepository } from "../src/db/cost-repository";
import { createCostApplication } from "../src/application/costs";
import type { CostSource } from "../src/models/costs";
import { secureDatabase } from "../src/db/setup";
import { createCostHttp } from "../src/http/costs";

describe("Operator costs at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  const app = () =>
    createCostApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createCostRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
  async function operator(
    email: string,
    mfa = true,
    at = "2026-11-05T09:00:00Z",
  ) {
    h.clock.set(at);
    const headers = await h.signIn(email, mfa);
    const identity = await h.access.primary(headers);
    await h.admin.query(
      "insert into platform_operator(user_id,costs) values($1,true)",
      [identity.user.id],
    );
    return { headers, id: identity.user.id };
  }

  it("classifies a costs-only operator centrally and requires current MFA and current capability", async () => {
    const f = await operator("cost-only@example.com", false);
    expect(await h.access.status(f.headers)).toMatchObject({
      required: true,
      operator: true,
      readiness: "mfa-incomplete",
    });
    await expect(h.authenticate(f.headers)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await expect(app().workspace(f.headers, "2026-11")).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const verified = await operator("cost-verified@example.com");
    await expect(
      h.team.requirePlatformCapability(verified.headers, "costs.manage"),
    ).resolves.toEqual({ capability: "costs.manage" });
    expect(await app().workspace(verified.headers, "2026-11")).toMatchObject({
      month: "2026-11",
      totals: { operatorMicros: "0", unpriced: 0 },
    });
    await h.admin.query(
      "update platform_operator set costs=false where user_id=$1",
      [verified.id],
    );
    await expect(
      app().workspace(verified.headers, "2026-11"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await verifyRuntimeRole(h.runtime);
  });

  it("keeps prepaid cash, linked credits, subscription allocation and Meta separate with versioned corrections and explicit INR planning", async () => {
    const f = await operator("cost-evidence@example.com");
    const source: CostSource = {
      month: "2026-11",
      provider: "gateway",
      category: "ai",
      kind: "consumption",
      funding: "gateway_prepaid",
      amount: { currency: "USD", micros: "2000000" },
      quantity: 1,
      unit: "statement",
      businessId: null,
      runId: null,
      allocation: "Operator platform usage only",
      evidence: "fixture-statement-1",
      observedAt: "2026-11-01T00:00:00Z",
      freshUntil: "2026-12-01T00:00:00Z",
      plan: null,
      status: "recorded",
      details: {},
    };
    const record = (id: string, change: Partial<CostSource>) =>
      app().record(f.headers, {
        sourceId: `evidence:${id}`,
        expectedVersion: 0,
        source: { ...source, ...change },
        reason: "Reviewed fixture statement",
        retentionSeconds: 3600,
      });
    await record("consumed", {});
    await record("topup", {
      kind: "cash_topup",
      amount: { currency: "USD", micros: "10000000" },
    });
    await record("included", {
      funding: "openai_linked_credits",
      amount: { currency: "USD", micros: "3000000" },
    });
    await record("subscription", {
      kind: "commitment",
      funding: "cash",
      amount: { currency: "INR", micros: "100000000" },
    });
    await record("allocation", {
      kind: "subscription_allocation",
      funding: "existing_subscription",
      amount: { currency: "INR", micros: "100000000" },
    });
    await record("meta", {
      kind: "customer_paid_meta",
      funding: "customer_meta",
      provider: "meta",
      category: "messaging",
      amount: { currency: "USD", micros: "8000000" },
    });
    const before = await app().workspace(f.headers, "2026-11");
    expect(before.totals).toMatchObject({
      operatorMicros: "100000000",
      unconverted: 1,
      cashTopups: { USD: "10000000" },
      customerPaid: { USD: "8000000" },
    });
    await app().configure(f.headers, {
      month: "2026-11",
      expectedVersion: 0,
      usdToInr: "80",
      conversionEvidence: "Explicit hypothetical planning FX fixture",
      conversionObservedAt: "2026-11-01T00:00:00Z",
      forecast: "linear_elapsed_utc",
      assumptions:
        "Uniform variable usage; full monthly fixed commitments; missing rates excluded",
      rates: [],
      retentionSeconds: 3600,
    });
    expect((await app().workspace(f.headers, "2026-11")).totals).toMatchObject({
      operatorMicros: "260000000",
      unconverted: 0,
    });
    await app().record(f.headers, {
      sourceId: "evidence:consumed",
      expectedVersion: 1,
      source: { ...source, amount: { currency: "USD", micros: "1000000" } },
      reason: "Corrected statement",
      retentionSeconds: 3600,
    });
    const corrected = await app().workspace(f.headers, "2026-11");
    expect(corrected.totals.operatorMicros).toBe("180000000");
    expect(
      corrected.history.filter((r) => r.sourceId === "evidence:consumed"),
    ).toHaveLength(2);
    expect(corrected.planning?.usdToInr).toBe("80");
    expect(corrected.forecast).toMatchObject({
      basis: "linear_elapsed_utc",
      knownOnly: true,
    });
    await h.reapplySchema();
    expect(
      (await app().workspace(f.headers, "2026-11")).totals.operatorMicros,
    ).toBe("180000000");
  });

  it("durably notifies default global/category thresholds once across evaluation and worker restarts", async () => {
    const f = await operator("cost-alert@example.com");
    const delivered = new Map<string, string>();
    const mailer = {
      async send(message: { key: string; email: string; text: string }) {
        delivered.set(message.key, message.text);
        return { id: `receipt-${message.key}` };
      },
    };
    const costs = () =>
      createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        mailer,
      });
    const base: CostSource = {
      month: "2026-10",
      provider: "neon",
      category: "database",
      kind: "consumption",
      funding: "cash",
      amount: { currency: "INR", micros: "85000000" },
      quantity: 1,
      unit: "statement",
      businessId: null,
      runId: null,
      allocation: "Platform",
      evidence: "Fixture usage statement",
      observedAt: "2026-10-01T00:00:00Z",
      freshUntil: "2026-11-01T00:00:00Z",
      plan: null,
      status: "recorded",
      details: {},
    };
    await costs().record(f.headers, {
      sourceId: "evidence:october-usage",
      expectedVersion: 0,
      source: base,
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    await costs().setBudget(f.headers, {
      month: "2026-10",
      category: "global",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Accountable owner",
    });
    await costs().setBudget(f.headers, {
      month: "2026-10",
      category: "database",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Database owner",
    });
    await costs().evaluate(f.headers, "2026-10");
    const initial = await costs().workspace(f.headers, "2026-10");
    expect(initial.budgets.map((b) => b.thresholds)).toEqual([
      [80, 90, 100],
      [80, 90, 100],
    ]);
    expect(initial.alerts).toHaveLength(2);
    expect(initial.alerts.map((a) => a.threshold)).toEqual([80, 80]);
    expect(initial.alerts.map((a) => a.emailState)).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(delivered.size).toBe(2);
    await costs().evaluate(f.headers, "2026-10");
    await costs().recoverPending();
    expect((await costs().workspace(f.headers, "2026-10")).alerts).toHaveLength(
      2,
    );
    expect(delivered.size).toBe(2);
    await h.admin.query(
      "update platform_operator set costs=false where user_id=$1",
      [f.id],
    );
    await costs().recoverPending();
    expect(delivered.size).toBe(2);
  });

  it("projects controlled UTC time, explicit rates, unpriced usage and selected-plan changes without charging a planned change twice", async () => {
    const f = await operator(
      "cost-forecast@example.com",
      true,
      "2026-09-11T00:00:00Z",
    );
    const source: CostSource = {
      month: "2026-09",
      provider: "neon",
      category: "database",
      kind: "consumption",
      funding: "cash",
      amount: { currency: "INR", micros: "90000000" },
      quantity: 1,
      unit: "statement",
      businessId: null,
      runId: null,
      allocation: "Platform",
      evidence: "Worked fixture",
      observedAt: "2026-09-01T00:00:00Z",
      freshUntil: "2026-10-01T00:00:00Z",
      plan: null,
      status: "recorded",
      details: {},
    };
    const record = (id: string, extra: Partial<CostSource>) =>
      app().record(f.headers, {
        sourceId: `evidence:${id}`,
        expectedVersion: 0,
        source: { ...source, ...extra },
        reason: "Worked source fixture",
        retentionSeconds: 3600,
      });
    await record("forecast-variable", {});
    await record("forecast-fixed", {
      kind: "commitment",
      amount: { currency: "INR", micros: "30000000" },
    });
    await record("forecast-change", {
      kind: "plan_change",
      plan: "Explicit future incremental selected-plan delta",
      observedAt: "2026-09-15T00:00:00Z",
      amount: { currency: "INR", micros: "10000000" },
    });
    await record("forecast-unknown", {
      provider: "exa",
      category: "search",
      amount: null,
      quantity: 2,
      unit: "search",
      status: "unpriced",
    });
    const planning = {
      month: "2026-09",
      expectedVersion: 0,
      usdToInr: null,
      conversionEvidence: null,
      conversionObservedAt: null,
      forecast: "linear_elapsed_utc",
      assumptions:
        "Uniform variable usage across 30 UTC days, plus complete monthly commitments. Missing sources excluded.",
      rates: [],
      retentionSeconds: 3600,
    };
    await app().configure(f.headers, planning);
    const first = await app().workspace(f.headers, "2026-09");
    expect(first.totals).toMatchObject({
      operatorMicros: "120000000",
      unpriced: 1,
    });
    expect(first.forecast).toMatchObject({
      operatorMicros: "310000000",
      elapsedSeconds: 864000,
      monthSeconds: 2592000,
      knownOnly: true,
    });
    h.clock.set("2026-09-16T00:00:00Z");
    await h.reverifyAuthenticator(f.headers);
    await record("forecast-effective", {
      kind: "commitment",
      amount: { currency: "INR", micros: "10000000" },
      observedAt: "2026-09-15T00:00:00Z",
      coversSourceIds: ["evidence:forecast-change"],
    });
    expect(
      (await app().workspace(f.headers, "2026-09")).forecast.operatorMicros,
    ).toBe("220000000");
    await app().configure(f.headers, {
      ...planning,
      expectedVersion: 1,
      rates: [
        {
          provider: "exa",
          unit: "search",
          model: null,
          pricePerUnit: { currency: "INR", micros: "5000000" },
          inputPerMillion: null,
          outputPerMillion: null,
          effectiveAt: "2026-09-01T00:00:00Z",
          freshUntil: "2026-10-01T00:00:00Z",
          evidence: "Explicit fixture order rate, no free band",
        },
      ],
    });
    const priced = await app().workspace(f.headers, "2026-09");
    expect(priced.totals).toMatchObject({
      operatorMicros: "140000000",
      unpriced: 0,
    });
    expect(priced.forecast.operatorMicros).toBe("240000000");
    expect(
      priced.sources.find((r) => r.sourceId === "evidence:forecast-unknown")
        ?.pricing,
    ).toContain("Estimated with planning version 2");
    await record("forecast-reduction", {
      kind: "plan_change",
      plan: "Explicit future cost reduction",
      observedAt: "2026-09-20T00:00:00Z",
      amount: { currency: "INR", micros: "-10000000" },
    });
    expect(
      (await app().workspace(f.headers, "2026-09")).forecast.operatorMicros,
    ).toBe("230000000");
    await record("forecast-current-instant", {
      observedAt: "2026-09-16T00:00:00Z",
      amount: { currency: "INR", micros: "5000000" },
    });
    expect(
      (await app().workspace(f.headers, "2026-09")).totals.operatorMicros,
    ).toBe("145000000");
  });

  it("denies customer/global and forged attribution scopes and keeps unscoped reads empty", async () => {
    const f = await operator("cost-scope@example.com");
    const ordinary = await h.signIn("cost-business-owner@example.com");
    const business = await h.application.createBusiness(ordinary, {
      name: "Cost privacy",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    await expect(app().workspace(ordinary, "2026-11")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const source: CostSource = {
      month: "2026-11",
      provider: "support",
      category: "support",
      kind: "consumption",
      funding: "cash",
      amount: null,
      quantity: 30,
      unit: "minutes",
      businessId: crypto.randomUUID(),
      runId: null,
      allocation: "Specific Business",
      evidence: "Attributable operator time entry",
      observedAt: "2026-11-01T00:00:00Z",
      freshUntil: "2026-12-01T00:00:00Z",
      plan: null,
      status: "unpriced",
      details: {},
    };
    await expect(
      app().record(f.headers, {
        sourceId: "evidence:forged-tenant",
        expectedVersion: 0,
        source,
        reason: "Fixture",
        retentionSeconds: 3600,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await app().setBudget(f.headers, {
      month: "2026-04",
      category: "global",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: false,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "A real delegation must remain private in Business scope",
    });
    const client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true)",
        [f.id, business.id],
      );
      expect(
        (await client.query("select id from operator_cost_record")).rows,
      ).toEqual([]);
      expect(
        (await client.query("select * from operator_cost_native('2026-11')"))
          .rows,
      ).toEqual([]);
      expect(
        (await client.query("select * from operator_cost_work()")).rows,
      ).toEqual([]);
    } finally {
      await client.query("rollback");
      client.release();
      await h.admin.query(
        "update platform_operator set costs=false where user_id=$1",
        [f.id],
      );
    }
  });

  it("recovers an ambiguous email with its immutable identity and holds it after the trusted provider window", async () => {
    const f = await operator("cost-uncertain@example.com");
    const sent = new Map<string, string>();
    let lose = true;
    const costs = () =>
      createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        mailer: {
          async send(m) {
            const existing = sent.get(m.key);
            if (existing && existing !== m.text)
              throw new Error("Idempotent payload changed");
            sent.set(m.key, m.text);
            if (lose) throw new Error("secret-provider-body-after-acceptance");
            return { id: "receipt-1" };
          },
        },
      });
    await costs().record(f.headers, {
      sourceId: "evidence:uncertain-usage",
      expectedVersion: 0,
      source: {
        month: "2026-08",
        provider: "vercel",
        category: "hosting",
        kind: "consumption",
        funding: "cash",
        amount: { currency: "INR", micros: "85000000" },
        quantity: 1,
        unit: "statement",
        businessId: null,
        runId: null,
        allocation: "Platform",
        evidence: "Fixture",
        observedAt: "2026-08-01T00:00:00Z",
        freshUntil: "2026-09-01T00:00:00Z",
        plan: null,
        status: "recorded",
        details: {},
      },
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    await costs().setBudget(f.headers, {
      month: "2026-08",
      category: "hosting",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Responsible operator",
    });
    await costs().evaluate(f.headers, "2026-08");
    expect(
      (await costs().workspace(f.headers, "2026-08")).alerts[0].emailState,
    ).toBe("uncertain");
    lose = false;
    expect(await costs().recoverPending()).toEqual({ evaluated: 1 });
    expect(sent.size).toBe(1);
    const confirmed = (await costs().workspace(f.headers, "2026-08")).alerts[0];
    expect(confirmed.emailState).toBe("accepted");
    await costs().acknowledge(f.headers, {
      id: confirmed.id,
      note: "Reviewed known-source costs",
    });
    expect(
      (await costs().workspace(f.headers, "2026-08")).alerts[0].acknowledged,
    ).toBe(true);
    // Simulate a process lost after I/O, beyond Resend's 24-hour external guarantee.
    await h.admin.query(
      "update operator_cost_alert set email_state='uncertain',first_attempt_at=statement_timestamp()-interval '25 hours',lease_until=statement_timestamp() where id=$1",
      [confirmed.id],
    );
    await costs().recoverPending();
    expect(
      (await costs().workspace(f.headers, "2026-08")).alerts[0].emailState,
    ).toBe("held");
    expect(sent.size).toBe(1);
  });

  it("requires SELECT and INSERT independently and restores all new append-only ledgers on reapplication", async () => {
    const tables = [
      "operator_cost_record",
      "operator_cost_planning",
      "operator_cost_scan",
      "operator_cost_budget",
      "operator_cost_alert",
      "operator_cost_notification_event",
    ];
    for (const table of tables) {
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(
          `revoke ${privilege} on public.${table} from app_runtime`,
        );
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
        await h.admin.query(
          `grant ${privilege} on public.${table} to app_runtime`,
        );
      }
    }
    await secureDatabase(h.admin);
    await h.admin.query(
      "revoke execute on function public.operator_cost_native(text) from app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.admin.query(
      "grant execute on function public.operator_cost_native(text) to app_runtime",
    );
    await verifyRuntimeRole(h.runtime);
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
  });

  it("validates same-origin cost commands and redacts errors and private source state from foreign actors", async () => {
    const f = await operator("cost-http@example.com");
    const diagnostics: unknown[] = [];
    const http = createCostHttp({
      application: app(),
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const headers = new Headers(f.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Origin", "https://foreign.example");
    const denied = await http.command(
      new Request("http://localhost:3000/api/platform/costs", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "evaluate", input: "2026-11" }),
      }),
    );
    expect(denied.status).toBe(403);
    const customer = await h.signIn("foreign-cost-http@example.com");
    const hidden = await http.workspace(
      new Request("http://localhost:3000/api/platform/costs?month=2026-11", {
        headers: customer,
      }),
    );
    expect(hidden.status).toBe(403);
    expect(JSON.stringify(await hidden.json())).not.toMatch(
      /evidence:|operator_cost_record|select|insert|secret/,
    );
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /cookie|secret|select|insert/i,
    );
  });
  it("uses an evidenced model-specific token rate before a generic provider rate", async () => {
    const f = await operator("cost-model-rate@example.com");
    await app().record(f.headers, {
      sourceId: "evidence:model-rate",
      expectedVersion: 0,
      source: {
        month: "2026-06",
        provider: "openai",
        category: "ai",
        kind: "consumption",
        funding: "byok",
        amount: null,
        quantity: 1,
        unit: "attempt",
        businessId: null,
        runId: null,
        allocation: "Attributable API usage",
        evidence: "Explicit model meter fixture",
        observedAt: "2026-06-10T00:00:00Z",
        freshUntil: "2026-07-01T00:00:00Z",
        plan: null,
        status: "unpriced",
        details: {
          model: "openai/cost-model",
          inputTokens: 1000000,
          outputTokens: 1000000,
        },
      },
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    const common = {
      provider: "openai",
      unit: "attempt",
      effectiveAt: "2026-06-01T00:00:00Z",
      freshUntil: "2026-07-01T00:00:00Z",
      evidence: "Explicit effective fixture rate",
    };
    await app().configure(f.headers, {
      month: "2026-06",
      expectedVersion: 0,
      usdToInr: null,
      conversionEvidence: null,
      conversionObservedAt: null,
      forecast: "none",
      assumptions: "No forecast; explicit worked fixture prices",
      retentionSeconds: 3600,
      rates: [
        {
          ...common,
          model: null,
          pricePerUnit: { currency: "INR", micros: "100000000" },
          inputPerMillion: null,
          outputPerMillion: null,
        },
        {
          ...common,
          model: "openai/cost-model",
          pricePerUnit: null,
          inputPerMillion: { currency: "INR", micros: "1000000" },
          outputPerMillion: { currency: "INR", micros: "2000000" },
        },
      ],
    });
    expect(
      (await app().workspace(f.headers, "2026-06")).totals.operatorMicros,
    ).toBe("3000000");
  });

  it("values usage with the model rate effective at each observation across a mid-month price change", async () => {
    const f = await operator("cost-effective-rates@example.com");
    for (const day of ["03", "20"]) {
      await app().record(f.headers, {
        sourceId: `evidence:effective-rate-${day}`,
        expectedVersion: 0,
        source: {
          month: "2026-04",
          provider: "openai",
          category: "ai",
          kind: "consumption",
          funding: "byok",
          amount: null,
          quantity: 1,
          unit: "attempt",
          businessId: null,
          runId: null,
          allocation: "Platform AI usage",
          evidence: `Reviewed usage on April ${day}`,
          observedAt: `2026-04-${day}T00:00:00Z`,
          freshUntil: "2026-05-01T00:00:00Z",
          plan: null,
          status: "unpriced",
          details: {
            model: "openai/cost-model",
            inputTokens: 1000000,
            outputTokens: 0,
          },
        },
        reason: "Effective-rate regression fixture",
        retentionSeconds: 3600,
      });
    }
    const common = {
      provider: "openai",
      unit: "attempt",
      model: "openai/cost-model",
      pricePerUnit: null,
      outputPerMillion: { currency: "INR", micros: "0" },
      freshUntil: "2026-05-01T00:00:00Z",
      evidence: "Reviewed effective price fixture",
    };
    await app().configure(f.headers, {
      month: "2026-04",
      expectedVersion: 0,
      usdToInr: null,
      conversionEvidence: null,
      conversionObservedAt: null,
      forecast: "none",
      assumptions: "Only observed usage at its effective model price",
      retentionSeconds: 3600,
      rates: [
        {
          ...common,
          effectiveAt: "2026-04-01T00:00:00Z",
          inputPerMillion: { currency: "INR", micros: "2000000" },
        },
        {
          ...common,
          effectiveAt: "2026-04-15T00:00:00Z",
          inputPerMillion: { currency: "INR", micros: "3000000" },
        },
      ],
    });
    const state = await app().workspace(f.headers, "2026-04");
    expect(state.sources.map((r) => r.valuedAmount?.micros).sort()).toEqual([
      "2000000",
      "3000000",
    ]);
    expect(state.totals.operatorMicros).toBe("5000000");
    await h.reapplySchema();
    expect(
      (await app().workspace(f.headers, "2026-04")).totals.operatorMicros,
    ).toBe("5000000");
  });

  it("uses trusted database expiry for durable owner delegation despite a caller clock jump", async () => {
    const f = await operator("cost-expiry@example.com");
    let effects = 0;
    const costs = () =>
      createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        mailer: {
          async send() {
            effects++;
            return { id: "expiry-receipt" };
          },
        },
      });
    await costs().record(f.headers, {
      sourceId: "evidence:expiry",
      expectedVersion: 0,
      source: {
        month: "2026-07",
        provider: "support",
        category: "support",
        kind: "consumption",
        funding: "cash",
        amount: { currency: "INR", micros: "85000000" },
        quantity: 30,
        unit: "minutes",
        businessId: null,
        runId: null,
        allocation: "Shared platform support",
        evidence: "Reviewed time fixture",
        observedAt: "2026-07-01T00:00:00Z",
        freshUntil: "2026-08-01T00:00:00Z",
        plan: null,
        status: "recorded",
        details: {},
      },
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    const budget = {
      month: "2026-07",
      category: "support",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Explicit durable authorization",
    };
    await costs().setBudget(f.headers, budget);
    h.clock.set("2099-01-01T00:00:00Z");
    await costs().recoverPending();
    expect(effects).toBe(1);
    h.clock.set("2026-11-05T09:00:00Z");
    await costs().setBudget(f.headers, {
      ...budget,
      expectedVersion: 1,
      limitInrMicros: "50000000",
    });
    await h.admin.query(
      "update operator_cost_budget set at=statement_timestamp()-interval '2 hours',retain_until=statement_timestamp()-interval '1 hour' where month='2026-07' and version=2",
    );
    await costs().recoverPending();
    await costs().evaluate(f.headers, "2026-07");
    expect(effects).toBe(1);
    const state = await costs().workspace(f.headers, "2026-07");
    expect(state.budgets[0].automationActive).toBe(false);
    expect(state.alerts).toHaveLength(1);
  });

  it("rechecks a superseded budget immediately before a claimed notification effect", async () => {
    const f = await operator("cost-superseded@example.com");
    await app().record(f.headers, {
      sourceId: "evidence:superseded",
      expectedVersion: 0,
      source: {
        month: "2026-05",
        provider: "neon",
        category: "database",
        kind: "consumption",
        funding: "cash",
        amount: { currency: "INR", micros: "85000000" },
        quantity: 1,
        unit: "statement",
        businessId: null,
        runId: null,
        allocation: "Platform database",
        evidence: "Reviewed usage fixture",
        observedAt: "2026-05-01T00:00:00Z",
        freshUntil: "2026-06-01T00:00:00Z",
        plan: null,
        status: "recorded",
        details: {},
      },
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    const budget = {
      month: "2026-05",
      category: "database",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: f.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Responsible operator",
    };
    await app().setBudget(f.headers, budget);
    let authentications = 0;
    let effects = 0;
    const costs = createCostApplication({
      async authenticatePlatform(headers: Headers) {
        const actor = await h.access.authenticatePlatform(headers);
        // The public configuration command races after claim and before provider I/O.
        if (++authentications === 3)
          await app().setBudget(f.headers, {
            ...budget,
            expectedVersion: 1,
            email: false,
          });
        return actor;
      },
      repository: createCostRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      mailer: {
        async send() {
          effects++;
          return { id: "superseded-receipt" };
        },
      },
    });
    await costs.evaluate(f.headers, "2026-05");
    expect(authentications).toBe(3);
    expect(effects).toBe(0);
    const state = await costs.workspace(f.headers, "2026-05");
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].emailState).toBe("held");
    await costs.recoverPending();
    expect(effects).toBe(0);
  });
});
