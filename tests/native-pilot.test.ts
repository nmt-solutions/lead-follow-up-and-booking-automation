import { createCostApplication } from "../src/application/costs";
import { createCostRepository } from "../src/db/cost-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { nativePilotFixture } from "./support/native-pilot";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayAccountReviewSchema } from "../src/models/razorpay-account";

describe("Native paid pilots through public application commands", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(
      new Date(Math.floor(vi.getRealSystemTime() / 1000) * 1000).toISOString(),
    );
  });
  afterEach(async () => h?.close());

  it("holds every malformed captured entry in the native order payment list instead of discarding conflicting unknown money", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    s.native.payments.set("pay_partial_unknown", {
      id: "pay_partial_unknown",
      captured: true,
      status: "captured",
    });
    await s.app.refresh(c, b, { actionId: s.action.id });
    expect((await s.app.workspace(c, b)).periods).toHaveLength(0);
    s.native.payments.delete("pay_partial_unknown");
    s.native.payments.set("pay_failed", {
      id: "pay_failed",
      captured: false,
      status: "failed",
    });
    await s.app.refresh(c, b, { actionId: s.action.id });
    expect(
      (await s.app.workspace(c, b)).periods.map((p) => p.paymentId),
    ).toEqual(["pay_pilot"]);
    expect(s.mutations).toHaveLength(1);
  });

  it("privately retains the original signed pilot proof before any native read and recovers the same capture after interruption", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    const proof = {
      actionId: s.action.id,
      orderId: "order_pilot",
      paymentId: "pay_pilot",
      signature: createHmac("sha256", "fixture-api-secret")
        .update("order_pilot|pay_pilot")
        .digest("hex"),
    };
    let inspected = false;
    s.beforeRead(async () => {
      inspected = true;
      const rows = (
        await h.admin.query(
          "select detail->'checkoutProof' proof from subscription_payment_history where action_id=$1 and kind like 'pilot_checkout_proof:%'",
          [s.action.id],
        )
      ).rows;
      expect(rows).toEqual([{ proof }]);
      throw Error(
        "Controlled native interruption after durable original proof",
      );
    });
    await s.app.confirmPilotCheckout(c, b, proof);
    expect(inspected).toBe(true);
    expect(
      (
        await h.admin.query(
          "select count(*)::int count from subscription_payment_history where action_id=$1 and kind like 'pilot_checkout_proof:%'",
          [s.action.id],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    s.beforeRead();
    await s.app.recover();
    const view = await s.app.workspace(c, b);
    expect(view.periods.map((p) => p.paymentId)).toEqual(["pay_pilot"]);
    expect(JSON.stringify(view)).not.toContain(proof.signature);
    await s.app.confirmPilotCheckout(c, b, proof);
    expect(
      (
        await h.admin.query(
          "select count(*)::int count from subscription_payment_history where action_id=$1 and kind like 'pilot_checkout_proof:%'",
          [s.action.id],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    expect(s.mutations).toHaveLength(1);
  });

  it("denies native creation when the original billing evidence expires during the final billing read even with a frozen application clock", async () => {
    const s = await nativePilotFixture(h);
    await h.admin
      .query(`create function public.pilot_review_billing_wait() returns boolean language plpgsql volatile security definer set search_path='' as $$
      declare reads integer:=coalesce(nullif(current_setting('app.pilot_review_reads',true),''),'0')::integer+1;
      begin perform set_config('app.pilot_review_reads',reads::text,true);
        if reads=3 then perform pg_sleep(0.4); end if; return true; end $$;
      grant execute on function public.pilot_review_billing_wait() to app_runtime;
      create policy pilot_review_wait on public.billing_profile_revision as restrictive for select to app_runtime using(public.pilot_review_billing_wait());`);
    s.afterCustomer(async () => {
      await h.admin.query(
        "update business_file set retention_until=clock_timestamp()+interval '250 milliseconds' where id=$1",
        [s.f.fileId],
      );
    });
    await s.app
      .start(s.f.owner, s.f.business.id, { actionId: s.action.id })
      .catch(() => {});
    expect(s.mutations).toHaveLength(0);
  });

  it("denies native creation when the original MFA expires during the final billing read even with a frozen application clock", async () => {
    const s = await nativePilotFixture(h),
      actor = await h.access.authenticateForWork(s.f.owner);
    await h.admin
      .query(`create function public.pilot_review_billing_wait() returns boolean language plpgsql volatile security definer set search_path='' as $$
      declare reads integer:=coalesce(nullif(current_setting('app.pilot_review_reads',true),''),'0')::integer+1;
      begin perform set_config('app.pilot_review_reads',reads::text,true);
        if reads=3 then perform pg_sleep(0.4); end if; return true; end $$;
      grant execute on function public.pilot_review_billing_wait() to app_runtime;
      create policy pilot_review_wait on public.billing_profile_revision as restrictive for select to app_runtime using(public.pilot_review_billing_wait());`);
    s.afterCustomer(async () => {
      await h.admin.query(
        "update session set mfa_verified_at=clock_timestamp()-interval '12 hours'+interval '250 milliseconds' where id=$1",
        [actor.sessionId],
      );
    });
    await s.app
      .start(s.f.owner, s.f.business.id, { actionId: s.action.id })
      .catch(() => {});
    expect(s.mutations).toHaveLength(0);
  });

  it("does not accept a forged no-attempt history fact after the original monthly mandate creation boundary", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(c, b, { actionId: s.action.id });
    const period = (await s.app.workspace(c, b)).periods[0],
      input = {
        originalActionId: s.action.id,
        originalPeriodId: period.id,
        requestKey: randomUUID(),
        startAt: period.end,
        approvalExpiresAt: new Date(
          h.clock.now().getTime() + 600000,
        ).toISOString(),
        agreeSeparateMandate: true,
      },
      monthly = await s.app.preparePilotRenewal(c, b, input);
    s.native.loseCreation = true;
    await s.app.start(c, b, { actionId: monthly.id });
    const actor = await h.access.authenticateForWork(c),
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      const target = (
        await client.query(
          "select * from public.subscription_payment_target('razorpay',$1,$2::uuid)",
          [monthly.snapshot.provider.account, monthly.operationKey],
        )
      ).rows[0];
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.payment_action',$3,true),set_config('app.payment_capability',$4,true)",
        [actor.userId, b, monthly.id, target.recovery_key],
      );
      await client.query(
        "update subscription_payment set state='failed',reason='native_preflight_rejected',checkout=null,observation=null,reconciliation_pending=false where id=$1",
        [monthly.id],
      );
      await client.query("savepoint forged_history");
      await expect(
        client.query(
          "insert into subscription_payment_history(id,business_id,action_id,kind,actor_id,detail,at) values($1,$2,$3,'creation_not_attempted',$4,$5,clock_timestamp())",
          [
            randomUUID(),
            b,
            monthly.id,
            actor.userId,
            {
              state: "failed",
              reason: "native_preflight_rejected",
              observation: null,
            },
          ],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint forged_history");
      await client.query("commit");
    } finally {
      await client.query("rollback");
      client.release();
    }
    // Even an administratively imported old false assertion cannot erase the
    // retained original creation boundary at the public command.
    await h.admin.query(
      "insert into subscription_payment_history(id,business_id,action_id,kind,actor_id,detail,at) values($1,$2,$3,'creation_not_attempted',$4,$5,clock_timestamp())",
      [
        randomUUID(),
        b,
        monthly.id,
        actor.userId,
        {
          state: "failed",
          reason: "native_preflight_rejected",
          observation: null,
        },
      ],
    );
    await expect(
      s.app.preparePilotRenewal(c, b, { ...input, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(s.mutations).toHaveLength(2);
  });

  it.each(["account", "plan"] as const)(
    "refuses a separate monthly approval that silently changes the original native %s",
    async (change) => {
      const s = await nativePilotFixture(h),
        b = s.f.business.id,
        c = s.f.owner;
      await s.app.start(c, b, { actionId: s.action.id });
      s.capture();
      await s.app.refresh(c, b, { actionId: s.action.id });
      const period = (await s.app.workspace(c, b)).periods[0];
      const retained = (
        await h.admin.query(
          "select snapshot from subscription_payment where id=$1",
          [s.action.id],
        )
      ).rows[0].snapshot;
      const review = razorpayAccountReviewSchema.parse(
        retained.provider.review,
      );
      if (change === "account") review.account = "acc_other";
      else
        review.plans = review.plans.map((p) => ({
          ...p,
          planId: "plan_changed",
          totalCount: p.totalCount + 1,
        }));
      const app = createSubscriptionPaymentApplication({
        authenticate: h.access.authenticateForWork,
        authenticateForWork: h.access.authenticateForWork,
        authenticatePlatform: h.access.authenticatePlatformForWork,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredPayments({
          ...s.native.configuration,
          env: {
            ...s.native.configuration.env,
            RAZORPAY_ACCOUNT_REVIEW: JSON.stringify(review),
          },
        }),
      });
      await expect(
        app.preparePilotRenewal(c, b, {
          originalActionId: s.action.id,
          originalPeriodId: period.id,
          requestKey: randomUUID(),
          startAt: period.end,
          approvalExpiresAt: new Date(
            h.clock.now().getTime() + 600000,
          ).toISOString(),
          agreeSeparateMandate: true,
        }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      expect(s.mutations).toHaveLength(1);
      expect(
        (
          await h.admin.query(
            "select count(*)::int count from subscription_payment where business_id=$1",
            [b],
          )
        ).rows,
      ).toEqual([{ count: 1 }]);
    },
  );

  it("permits a new explicit frozen-price monthly approval only after server-proven preflight rejection without a native mutation", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(c, b, { actionId: s.action.id });
    const period = (await s.app.workspace(c, b)).periods[0];
    const input = {
      originalActionId: s.action.id,
      originalPeriodId: period.id,
      requestKey: randomUUID(),
      startAt: period.end,
      approvalExpiresAt: new Date(
        h.clock.now().getTime() + 600000,
      ).toISOString(),
      agreeSeparateMandate: true,
    };
    const first = await s.app.preparePilotRenewal(c, b, input);
    const originalFetch = s.native.configuration.fetch;
    s.native.configuration.fetch = async (input, init) => {
      if (String(input).includes("/plans/"))
        throw Error("Controlled native plan preflight outage");
      return originalFetch(input, init);
    };
    expect(await s.app.start(c, b, { actionId: first.id })).toMatchObject({
      state: "failed",
      reason: "native_preflight_rejected",
    });
    expect(s.mutations).toHaveLength(1);
    s.native.configuration.fetch = originalFetch;
    const nextStart = new Date(
      new Date(period.end).getTime() + 86400000,
    ).toISOString();
    const next = await s.app.preparePilotRenewal(c, b, {
      ...input,
      requestKey: randomUUID(),
      startAt: nextStart,
    });
    expect(next.id).not.toBe(first.id);
    expect(next.snapshot.pilotContinuation?.startAt).toBe(nextStart);
    expect(next.snapshot.quote).toEqual(first.snapshot.quote);
    expect(
      (await s.app.workspace(c, b)).actions.find((a) => a.id === first.id)
        ?.snapshot.pilotContinuation?.startAt,
    ).toBe(period.end);
    await s.app.start(c, b, { actionId: next.id });
    expect(s.mutations).toHaveLength(2);
    expect(s.mutations[1]).toMatchObject({
      path: "/v1/subscriptions",
      body: {
        start_at: Date.parse(nextStart) / 1000,
        plan_id: "plan_fixtureINR",
        total_count: 12,
      },
    });
  });

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
    expect(started.snapshot.collection).toBeUndefined();
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
      collection: { method: "card", planId: "plan_fixtureINR", totalCount: 12 },
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
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).actions.find(
        (a) => a.id === renewal.id,
      )?.checkout?.mandate,
    ).toEqual({
      script: "https://checkout.razorpay.com/v1/checkout.js",
      key: "rzp_test_fixture",
      customer_id: "cust_pilot",
      subscription_id: "sub_fixture1",
    });
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
  it("requires exhaustive bounded receipt pagination before accepting one exact original order and never retries an uncertain POST on partial lookup", async () => {
    const s = await nativePilotFixture(h);
    s.loseOrder();
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    const original = s.orders.get("order_pilot")!;
    const noise = (n: number) => ({
      ...original,
      id: `order_noise${n}`,
      receipt: `prefix-${s.action.operationKey}`,
    });
    s.orderPage((skip) => ({
      count: 100,
      items: Array.from({ length: 100 }, (_, i) =>
        skip === 0 && i === 0 ? original : noise(skip + i + 1),
      ),
    }));
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).actions[0].checkout,
    ).toBeNull();
    expect(s.mutations).toHaveLength(1);
    s.orderPage((skip) =>
      skip === 0
        ? { count: 100, items: Array.from({ length: 100 }, (_, i) => noise(i)) }
        : { count: 1, items: [original] },
    );
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect(
      (await s.app.workspace(s.f.owner, s.f.business.id)).periods.map(
        (p) => p.paymentId,
      ),
    ).toEqual(["pay_pilot"]);
    expect(s.mutations).toHaveLength(1);
  });
  it("holds a native order whose partial-payment configuration no longer matches the original one-time approval", async () => {
    const s = await nativePilotFixture(h);
    await s.app.start(s.f.owner, s.f.business.id, { actionId: s.action.id });
    s.orders.get("order_pilot")!.partial_payment = true;
    s.capture();
    await s.app.refresh(s.f.owner, s.f.business.id, { actionId: s.action.id });
    expect((await s.app.workspace(s.f.owner, s.f.business.id)).periods).toEqual(
      [],
    );
    expect(s.mutations).toHaveLength(1);
  });
  it("reconciles the original uncertain monthly mandate into the same exact customer-bound Checkout without a second subscription POST", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(c, b, { actionId: s.action.id });
    const initial = (await s.app.workspace(c, b)).periods[0];
    const renewal = await s.app.preparePilotRenewal(c, b, {
      originalActionId: s.action.id,
      originalPeriodId: initial.id,
      requestKey: randomUUID(),
      startAt: initial.end,
      approvalExpiresAt: new Date(
        h.clock.now().getTime() + 600000,
      ).toISOString(),
      agreeSeparateMandate: true,
    });
    s.native.loseCreation = true;
    await s.app.start(c, b, { actionId: renewal.id });
    expect(s.mutations).toHaveLength(2);
    await expect(
      s.app.preparePilotRenewal(c, b, {
        originalActionId: s.action.id,
        originalPeriodId: initial.id,
        requestKey: randomUUID(),
        startAt: initial.end,
        approvalExpiresAt: new Date(
          h.clock.now().getTime() + 600000,
        ).toISOString(),
        agreeSeparateMandate: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await s.app.start(c, b, { actionId: renewal.id });
    expect(s.mutations).toHaveLength(2);
    await s.app.refresh(c, b, { actionId: renewal.id });
    const workspace = await s.app.workspace(c, b);
    expect(
      workspace.actions.find((a) => a.id === renewal.id)?.checkout?.mandate,
    ).toMatchObject({
      subscription_id: "sub_fixture1",
      customer_id: "cust_pilot",
    });
    expect(workspace.periods).toEqual([initial]);
    expect(s.mutations).toHaveLength(2);
  });
  it("rejects monthly approval timestamps that native Unix-second fields cannot represent exactly instead of silently shifting the schedule", async () => {
    const s = await nativePilotFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    await s.app.start(c, b, { actionId: s.action.id });
    s.capture();
    await s.app.refresh(c, b, { actionId: s.action.id });
    const period = (await s.app.workspace(c, b)).periods[0],
      expiry = new Date(h.clock.now().getTime() + 600000).toISOString();
    const input = {
      originalActionId: s.action.id,
      originalPeriodId: period.id,
      requestKey: randomUUID(),
      startAt: period.end,
      approvalExpiresAt: expiry,
      agreeSeparateMandate: true,
    };
    await expect(
      s.app.preparePilotRenewal(c, b, {
        ...input,
        startAt: new Date(Date.parse(period.end) + 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      s.app.preparePilotRenewal(c, b, {
        ...input,
        approvalExpiresAt: new Date(Date.parse(expiry) + 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await s.app.workspace(c, b)).actions).toHaveLength(1);
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
