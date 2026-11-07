import { createCostApplication } from "../src/application/costs";
import { createCostRepository } from "../src/db/cost-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { nativePilotFixture } from "./support/native-pilot";

describe("Native paid pilots through public application commands", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(
      new Date(Math.floor(vi.getRealSystemTime() / 1000) * 1000).toISOString(),
    );
  });
  afterEach(async () => h?.close());

  it("collects an exact native pilot order into the original fourteen-day canonical paid period", async () => {
    const s = await nativePilotFixture(h);
    expect(s.action.state).toBe("reviewed");
    const started = await s.app.start(s.f.owner, s.f.business.id, {
      actionId: s.action.id,
    });
    expect(started.checkout).toMatchObject({
      checkoutId: "order_pilot",
      customerId: "cust_pilot",
      subscriptionId: null,
      standard: { order_id: "order_pilot", amount: 1100, currency: "INR" },
    });
    expect(s.mutations).toHaveLength(1);
    expect(s.mutations[0]).toMatchObject({
      path: "/v1/orders",
      body: { amount: 1100, currency: "INR", partial_payment: false },
    });
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const workspace = await s.app.workspace(s.f.owner, s.f.business.id);
    expect(workspace.periods).toHaveLength(1);
    expect(JSON.stringify(workspace)).not.toMatch(
      /fixture-private-global-tax-marker|cust_privateOtherBusiness|fixture-private-customer-marker/,
    );
    const privateSource = (
      await h.admin.query(
        "select snapshot from subscription_period where business_id=$1",
        [s.f.business.id],
      )
    ).rows[0].snapshot;
    expect(JSON.stringify(privateSource)).toContain(
      "fixture-private-global-tax-marker",
    );
    expect(JSON.stringify(privateSource)).toContain(
      "cust_privateOtherBusiness",
    );
    expect(workspace.periods[0]).toMatchObject({
      paymentId: "pay_pilot",
      start: h.clock.now().toISOString(),
      end: new Date(h.clock.now().getTime() + 14 * 86400000).toISOString(),
      snapshot: {
        term: { kind: "days", days: 14 },
        quote: { renewal: { subtotalMinor: 10005 } },
      },
      charge: {
        charge: { invoiceId: null, orderId: "order_pilot", kind: "initial" },
      },
    });
    expect(workspace.allowances?.discovery.included).toBe(10);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    await s.app.recover();
    expect(s.mutations).toHaveLength(1);
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods,
    ).toHaveLength(1);
  });
  it("keeps the original pilot and obtains explicit separate future monthly approval before an actual paid renewal", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const period = (await s.app.workspace(s.f.owner, s.f.business.id))
      .periods[0];
    const renewal = await s.app.preparePilotRenewal(
      s.f.owner,
      s.f.business.id,
      {
        originalActionId: s.action.id,
        originalPeriodId: period.id,
        requestKey: randomUUID(),
        startAt: period.end,
        approvalExpiresAt: new Date(
          h.clock.now().getTime() + 600000,
        ).toISOString(),
        agreeSeparateMandate: true,
      },
    );
    expect(renewal.snapshot).toMatchObject({
      basis: { kind: "renewal", discovery: { quantity: 100 } },
      quote: {
        initial: { subtotalMinor: 1000 },
        renewal: { subtotalMinor: 10005 },
      },
      tax: { totals: { totalMinor: "11006" } },
      pilotContinuation: {
        customerId: "cust_pilot",
        originalEnd: period.end,
        startAt: period.end,
      },
    });
    await s.app.start(s.f.owner, s.f.business.id, { actionId: renewal.id });
    expect(s.mutations).toHaveLength(2);
    expect(s.mutations[1]).toMatchObject({
      path: "/v1/subscriptions",
      body: {
        start_at: Math.floor(new Date(period.end).getTime() / 1000),
        plan_id: "plan_fixtureINR",
        total_count: 12,
      },
    });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods,
    ).toHaveLength(1);
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [s.f.business.id],
    );
    h.clock.set(period.end);
    const end = new Date(period.end);
    end.setUTCMonth(end.getUTCMonth() + 1);
    s.native.charge("pay_monthly", period.end, end.toISOString());
    s.native.subscriptions.get("sub_fixture1")!.customer_id = "cust_pilot";
    s.native.payments.get("pay_monthly")!.customer_id = "cust_pilot";
    s.native.invoices[0].customer_id = "cust_pilot";
    const owner = await h.signIn("tax-owner@example.com");
    await s.app.refresh(owner, s.f.business.id, { actionId: renewal.id });
    const result = await s.app.workspace(owner, s.f.business.id);
    expect(result.periods).toHaveLength(2);
    expect(result.periods[0]).toEqual(period);
    expect(result.allowances?.discovery.included).toBe(100);
    expect(result.periods[1]).toMatchObject({
      paymentId: "pay_monthly",
      snapshot: {
        basis: { kind: "renewal" },
        quote: { initial: { subtotalMinor: 1000 } },
      },
    });
    h.clock.set(end.toISOString());
    const nextEnd = new Date(end);
    nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
    s.native.charge("pay_monthly2", end.toISOString(), nextEnd.toISOString());
    s.native.subscriptions.get("sub_fixture1")!.customer_id = "cust_pilot";
    s.native.payments.get("pay_monthly2")!.customer_id = "cust_pilot";
    s.native.invoices.at(-1)!.customer_id = "cust_pilot";
    const currentOwner = await h.signIn("tax-owner@example.com");
    await s.app.refresh(currentOwner, s.f.business.id, {
      actionId: renewal.id,
    });
    expect(
      (await s.app.workspace(currentOwner, s.f.business.id)).periods.map(
        (p) => p.paymentId,
      ),
    ).toEqual(["pay_pilot", "pay_monthly", "pay_monthly2"]);
    expect(s.mutations).toHaveLength(2);
    const originalPeriods = (
      await s.app.workspace(currentOwner, s.f.business.id)
    ).periods;
    const refunded = s.native.payments.get("pay_monthly2")!;
    refunded.status = "refunded";
    refunded.amount_refunded = refunded.amount;
    await s.app.refresh(currentOwner, s.f.business.id, {
      actionId: renewal.id,
    });
    const afterRefund = await s.app.workspace(currentOwner, s.f.business.id);
    expect(afterRefund.periods).toEqual(originalPeriods);
    expect(afterRefund.access.active).toBe(false);
    expect(
      afterRefund.actions.find((a) => a.id === renewal.id)?.observation?.charge
        ?.refundedMinor,
    ).toBe(String(refunded.amount));
  });
  it("reconciles the exact original unknown order without repeating any mutation, rejecting contains-only and duplicate receipts", async () => {
    const s = await nativePilotFixture(h);
    s.loseOrder();
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const order = s.orders.get("order_pilot")!;
    s.orderPage(() => ({
      count: 1,
      items: [
        {
          ...order,
          id: "order_contains",
          receipt: `prefix-${s.action.operationKey}`,
        },
      ],
    }));
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).actions[0].checkout,
    ).toBeNull();
    s.orderPage(() => ({
      count: 2,
      items: [order, { ...order, id: "order_duplicate" }],
    }));
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).actions[0].reason,
    ).toBe("creation_lookup_ambiguous");
    expect(s.mutations).toHaveLength(1);
    s.orderPage(() => ({ count: 1, items: [order] }));
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods,
    ).toHaveLength(1);
    expect(s.mutations).toHaveLength(1);
  });
  it("validates the server HMAC result and still requires exact native customer/card/capture evidence", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    s.capture();
    const proof = {
      actionId: s.action.id,
      orderId: "order_pilot",
      paymentId: "pay_pilot",
      signature: createHmac("sha256", "fixture-api-secret")
        .update("order_pilot|pay_pilot")
        .digest("hex"),
    };
    await expect(
      s.app.confirmPilotCheckout(s.f.owner, s.f.business.id, {
        ...proof,
        signature: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    s.native.payments.get("pay_pilot")!.customer_id = "cust_wrong";
    await s.app.confirmPilotCheckout(s.f.owner, s.f.business.id, proof);
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods,
    ).toHaveLength(0);
    s.native.payments.get("pay_pilot")!.customer_id = "cust_pilot";
    await s.app.confirmPilotCheckout(s.f.owner, s.f.business.id, proof);
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods,
    ).toHaveLength(1);
    expect(s.mutations).toHaveLength(1);
  });
  it("retains a captured pilot's original financial period after a native refund while current paid scope becomes unavailable", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const original = (await s.app.workspace(s.f.owner, s.f.business.id))
      .periods[0];
    s.native.payments.get("pay_pilot")!.amount_refunded = 1100;
    s.native.payments.get("pay_pilot")!.status = "refunded";
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const result = await s.app.workspace(s.f.owner, s.f.business.id);
    expect(result.periods).toEqual([original]);
    expect(result.access.active).toBe(false);
    expect(result.actions[0].observation?.charge?.refundedMinor).toBe("1100");
    expect(s.mutations).toHaveLength(1);
  });
  it("denies a new order after current membership is removed during native preflight without creating financial facts", async () => {
    const s = await nativePilotFixture(h),
      actor = await h.authenticate(s.f.owner);
    s.afterCustomer(async () => {
      await h.admin.query(
        "DELETE FROM membership WHERE business_id=$1 AND user_id=$2",
        [s.f.business.id, actor.userId],
      );
    });
    await expect(
      s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(s.mutations).toHaveLength(0);
  });
  it("rechecks original authority after waiting on the tax catalog lock before any native order mutation", async () => {
    const s = await nativePilotFixture(h),
      actor = await h.authenticate(s.f.owner),
      blocker = await h.admin.connect();
    let ready!: () => void;
    const customerChecked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    s.afterCustomer(async () => {
      await blocker.query("BEGIN");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0))",
      );
      ready();
    });
    const start = s.app.start(s.f.owner, s.f.business.id, {
      actionId: s.action.id,
    });
    try {
      await customerChecked;
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
      await h.admin.query(
        "delete from membership where business_id=$1 and user_id=$2",
        [s.f.business.id, actor.userId],
      );
      await blocker.query("ROLLBACK");
      await expect(start).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(s.mutations).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await start.catch(() => {});
    }
  });
  it("reconciles original captured facts after account review expiry without authorizing or repeating creation", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    h.clock.set("2027-12-01T09:00:00.000Z");
    s.capture();
    await s.app.recover();
    const owner = await h.signIn("tax-owner@example.com");
    const view = await s.app.workspace(owner, s.f.business.id);
    expect(view.periods).toHaveLength(1);
    expect(view.periods[0].snapshot.quote).toEqual(s.action.snapshot.quote);
    expect(view.periods[0].snapshot.term).toEqual({
      kind: "days",
      days: 14,
      timeZone: "UTC",
    });
    expect(s.mutations).toHaveLength(1);
  });

  it("normalizes later observed native pilot fees from immutable reconciliation history without rewriting the original capture or adding fee tax twice", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    s.capture();
    s.native.payments.get("pay_pilot")!.fee = null;
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const original = (await s.app.workspace(s.f.owner, s.f.business.id))
      .periods[0];
    const actor = await h.authenticate(s.f.owner);
    await h.admin.query(
      "insert into platform_operator(user_id,costs) values($1,true) on conflict(user_id) do update set costs=true",
      [actor.userId],
    );
    const costs = createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
      }),
      month = h.clock.now().toISOString().slice(0, 7);
    await costs.refresh(s.f.owner, { month, retentionSeconds: 86400 });
    expect(
      (await costs.workspace(s.f.owner, month)).history.find(
        (r) => r.sourceId === `native:payment:${original.id}`,
      )?.source.amount,
    ).toBeNull();
    s.native.payments.get("pay_pilot")!.fee = 25;
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    await costs.refresh(s.f.owner, { month, retentionSeconds: 86400 });
    expect(
      (await costs.workspace(s.f.owner, month)).history
        .filter((r) => r.sourceId === `native:payment:${original.id}`)
        .at(-1)?.source.amount,
    ).toEqual({ currency: "INR", micros: "250000" });
    expect((await s.app.workspace(s.f.owner, s.f.business.id)).periods).toEqual(
      [original],
    );
    expect(s.mutations).toHaveLength(1);
  });
});
