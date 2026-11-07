import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { upiFixture, fundedUpiFixture, orderedUpiFixture } from "./support/upi";

import { createHarness } from "./support/harness";
import { subscriptionFixture } from "./support/subscription";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { createReachChangeApplication } from "../src/application/reach-changes";
import { createReachChangeRepository } from "../src/db/reach-change-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";
import { fixtureIssuer } from "./support/seller-issuer";
import { createMemoryStorage } from "./support/storage";
import { createReconciliationApplication } from "../src/application/reconciliation";
import { createReconciliationRepository } from "../src/db/reconciliation-repository";
import { razorpayAccountReviewSchema } from "../src/models/razorpay-account";
import { upiFixturePolicy } from "./support/upi";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { createDataGovernanceApplication } from "../src/application/data-governance";
import { createDataGovernanceRepository } from "../src/db/data-governance-repository";
import type { DataPolicy } from "../src/models/data-governance";

describe("Separate UPI AutoPay at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());

  const eligible = () => upiFixture(h);

  it("expires exact operator validation at the remaining MFA boundary using database time while the application clock is frozen", async () => {
    const f = await eligible(),
      c = await f.preview();
    const actor = await h.access.authenticatePlatformForWork(f.operator);
    await h.admin.query("UPDATE session SET mfa_verified_at=$1 WHERE id=$2", [
      new Date(h.clock.now().getTime() - 15 * 60 * 1000 + 200),
      actor.sessionId,
    ]);
    const validation = await f.changes.validateMethod(
      f.operator,
      f.business.id,
      { changeId: c.id, requestKey: randomUUID() },
    );
    await h.admin.query("SELECT pg_sleep(0.3)");
    await expect(
      f.changes.approve(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: validation.reviewHash,
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    expect(f.mutations).toEqual([]);
  });

  it("previews a separate UPI account and exact distinct native customer without changing the original card agreement", async () => {
    const f = await eligible();
    const change = await f.preview();
    expect(change.snapshot.path).toBe("replacement_mandate");
    expect(change.snapshot.target.upi).toMatchObject({
      originalAccount: "acc_fixture:test",
      originalCustomerId: "cust_fixture",
      account: "acc_upi:test",
      customerId: "cust_upi",
      method: "upi",
    });
    expect(change.snapshot.action.snapshot.provider.account).toBe(
      "acc_fixture:test",
    );
    expect(f.mutations).toEqual([]);
  });

  it("gates each unsupported account, method, MCC/PSP evidence, amount and identity configuration without broadening the card merchant", async () => {
    const f = await eligible();
    const original = razorpayAccountReviewSchema.parse(
      JSON.parse(f.env.RAZORPAY_UPI_ACCOUNT_REVIEW),
    );
    const variants = [
      { ...original, methods: { card: true, upi: true, emandate: false } },
      { ...original, account: f.card.review.account },
      { ...original, upiPath: { ...original.upiPath!, enabled: false } },
      { ...original, upiPath: { ...original.upiPath!, maximumMinor: "22010" } },
      { ...original, upiPath: { ...original.upiPath!, supportedHandles: [] } },
      {
        ...original,
        upiPath: { ...original.upiPath!, merchantCategoryCode: "unknown" },
      },
      { ...original, upiPath: { ...original.upiPath!, mappings: [] } },
    ];
    for (const review of variants) {
      const gateway = configuredPayments({
        ...f.configuration,
        env: { ...f.env, RAZORPAY_UPI_ACCOUNT_REVIEW: JSON.stringify(review) },
      });
      const app = createReachChangeApplication({
        authenticate: h.access.authenticateForWork,
        authenticatePlatform: h.access.authenticatePlatformForWork,
        repository: createReachChangeRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        gateway,
        policy: upiFixturePolicy,
        clock: h.clock,
      });
      await expect(
        app.preview(f.owner, f.business.id, {
          periodId: f.original.id,
          quoteId: f.target.id,
          requestKey: randomUUID(),
          paymentMethod: "upi",
        }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      expect(gateway.supports("INR")).toBe(true);
      expect(gateway.review?.methods).toEqual({
        card: true,
        upi: false,
        emandate: false,
      });
    }
    expect(f.mutations).toEqual([]);
  });

  it("reads distinct native sandbox capture/renewal/cancellation evidence before validation; a declaration or partial proof cannot enable the path", async () => {
    const f = await eligible();
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(f.env.RAZORPAY_UPI_ACCOUNT_REVIEW),
    );
    review.upiPath!.sandbox = {
      ...review.upiPath!.sandbox,
      kind: "native_sandbox",
      native: {
        subscriptionId: "sub_validation",
        planId: "plan_validation",
        customerId: "cust_validation",
        failedPaymentId: "pay_failedValidation",
        authorizationPaymentId: "pay_authValidation",
        initialPaymentId: "pay_initialValidation",
        renewalPaymentId: "pay_renewalValidation",
        amountMinor: "22011",
      },
    };
    const requests: string[] = [],
      control = { incomplete: true, quantity: 1, refundedAuthorization: 500 };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (
        new Headers(init?.headers).get("authorization") !==
        `Basic ${Buffer.from("rzp_test_validation:validation-secret").toString("base64")}`
      )
        return f.configuration.fetch(input, init);
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      expect(init?.method).toBe("GET");
      requests.push(url.pathname);
      if (url.pathname === "/v1/subscriptions/sub_validation")
        return Response.json({
          id: "sub_validation",
          plan_id: "plan_validation",
          customer_id: "cust_validation",
          status: "cancelled",
          quantity: control.quantity,
          start_at: 1757062800,
          ended_at: 1762333200,
        });
      if (url.pathname === "/v1/plans/plan_validation")
        return Response.json({
          id: "plan_validation",
          period: "monthly",
          interval: 1,
          item: { amount: 22011, currency: "INR" },
        });
      if (url.pathname.startsWith("/v1/payments/")) {
        const id = url.pathname.split("/").at(-1)!;
        const paid = id.includes("initial") || id.includes("renewal");
        return Response.json({
          id,
          customer_id: "cust_validation",
          method: "upi",
          international: false,
          vpa: "synthetic@fixture",
          currency: "INR",
          amount: paid ? 22011 : 500,
          status: id.includes("failed")
            ? "failed"
            : paid
              ? "captured"
              : "refunded",
          captured: !id.includes("failed"),
          amount_refunded: id.includes("failed")
            ? 0
            : paid
              ? 0
              : control.refundedAuthorization,
          invoice_id: paid
            ? id.includes("initial")
              ? "inv_initialValidation"
              : "inv_renewalValidation"
            : null,
          order_id: paid
            ? id.includes("initial")
              ? "order_initialValidation"
              : "order_renewalValidation"
            : null,
        });
      }
      const initial = url.pathname.includes("initial"),
        start = initial
          ? "2025-09-05T09:00:00.000Z"
          : "2025-10-05T09:00:00.000Z",
        end = initial ? "2025-10-05T09:00:00.000Z" : "2025-11-05T09:00:00.000Z";
      return Response.json({
        id: initial ? "inv_initialValidation" : "inv_renewalValidation",
        subscription_id: control.incomplete ? "sub_foreign" : "sub_validation",
        customer_id: "cust_validation",
        payment_id: initial ? "pay_initialValidation" : "pay_renewalValidation",
        order_id: initial
          ? "order_initialValidation"
          : "order_renewalValidation",
        status: "paid",
        amount: 22011,
        amount_paid: 22011,
        amount_due: 0,
        currency: "INR",
        billing_start: Date.parse(start) / 1000,
        billing_end: Date.parse(end) / 1000,
        paid_at: Date.parse(start) / 1000,
        line_items: [
          { type: "plan", quantity: 1, amount: 22011, currency: "INR" },
        ],
      });
    };
    const env = {
      ...f.env,
      RAZORPAY_UPI_ACCOUNT_REVIEW: JSON.stringify(review),
      RAZORPAY_UPI_SANDBOX_KEY_ID: "rzp_test_validation",
      RAZORPAY_UPI_SANDBOX_KEY_SECRET: "validation-secret",
    };
    const gateway = configuredPayments({ env, fetch, clock: h.clock });
    const app = createReachChangeApplication({
      authenticate: h.access.authenticateForWork,
      authenticatePlatform: h.access.authenticatePlatformForWork,
      repository: createReachChangeRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      gateway,
      policy: upiFixturePolicy,
      clock: h.clock,
    });
    const input = {
      periodId: f.original.id,
      quoteId: f.target.id,
      requestKey: randomUUID(),
      paymentMethod: "upi",
    };
    await expect(
      app.preview(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    control.incomplete = false;
    for (const invalid of ["quantity", "authorization_refund"] as const) {
      control.quantity = invalid === "quantity" ? 2 : 1;
      control.refundedAuthorization =
        invalid === "authorization_refund" ? 1 : 500;
      await expect(
        app.preview(f.owner, f.business.id, {
          ...input,
          requestKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    }
    control.refundedAuthorization = 500;
    const c = await app.preview(f.owner, f.business.id, {
      ...input,
      requestKey: randomUUID(),
    });
    const validation = await app.validateMethod(f.operator, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(validation.events.some((e) => e.fact.kind === "method_review")).toBe(
      true,
    );
    expect(requests).toContain("/v1/payments/pay_renewalValidation");
    expect(requests).toContain("/v1/invoices/inv_renewalValidation");
    expect(f.mutations).toEqual([]);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
  });

  it.each([
    "reviewer_revoked",
    "member_revoked_during_read",
    "reviewer_mfa_expires_during_read",
  ])(
    "rechecks current authority for %s before any native mutation",
    async (race) => {
      const f = await eligible(),
        c = await approve(f);
      if (race === "reviewer_revoked") {
        const actor = await h.authenticate(f.operator);
        await h.admin.query(
          "UPDATE platform_operator SET reconciliation=false WHERE user_id=$1",
          [actor.userId],
        );
      } else
        f.condition.beforeRead = async () => {
          if (race === "member_revoked_during_read") {
            const actor = await h.authenticate(f.owner);
            await h.admin.query(
              "UPDATE membership SET role='salesperson' WHERE business_id=$1 AND user_id=$2",
              [f.business.id, actor.userId],
            );
          } else h.clock.set("2026-11-05T09:16:00.000Z");
        };
      await expect(
        f.changes.execute(f.owner, f.business.id, {
          changeId: c.id,
          requestKey: randomUUID(),
        }),
      ).rejects.toMatchObject({
        code:
          race === "member_revoked_during_read"
            ? "FORBIDDEN"
            : "SETUP_REQUIRED",
      });
      expect(f.mutations).toEqual([]);
      expect(f.upi.subscriptions.size).toBe(0);
    },
  );

  it("requires a current privileged validation before exact customer approval and hides its session and merchant review", async () => {
    const f = await eligible(),
      c = await f.preview();
    await expect(
      f.changes.approve(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
        accept: true,
        reviewHash: c.reviewHash,
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await expect(
      f.changes.validateMethod(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reviewed = await f.changes.validateMethod(f.operator, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(reviewed.events.some((e) => e.fact.kind === "method_review")).toBe(
      true,
    );
    const approved = await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: reviewed.reviewHash,
    });
    expect(approved.state).toBe("approved");
    expect(JSON.stringify(approved)).not.toContain("sessionId");
    expect(JSON.stringify(approved)).not.toContain(
      "fixture account settings/MCC/PSP support",
    );
    expect(f.mutations).toEqual([]);
  });

  async function approve(f: Awaited<ReturnType<typeof eligible>>) {
    const c = await f.preview();
    const reviewed = await f.changes.validateMethod(f.operator, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    return f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: reviewed.reviewHash,
    });
  }
  it("binds a replacement reviewer to a new validation UUID and requires fresh exact customer approval", async () => {
    const f = await eligible(),
      c = await f.preview(),
      key = randomUUID();
    const first = await f.changes.validateMethod(f.operator, f.business.id, {
      changeId: c.id,
      requestKey: key,
    });
    await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: first.reviewHash,
    });
    const reviewer = await h.signIn("upi-replacement-reviewer@example.com");
    await h.provisionOperator(reviewer, { reconciliation: true, tax: false });
    await expect(
      f.changes.validateMethod(reviewer, f.business.id, {
        changeId: c.id,
        requestKey: key,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const fresh = await f.changes.validateMethod(reviewer, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(fresh.reviewHash).not.toBe(first.reviewHash);
    await expect(
      f.changes.execute(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.mutations).toEqual([]);
    await f.changes.approve(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
      accept: true,
      reviewHash: fresh.reviewHash,
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(f.mutations).toHaveLength(2);
  });

  it("retains an actual method-switched captured order under its original merchant without granting a paid period or repeating a mutation", async () => {
    const f = await orderedUpiFixture(h),
      amount = Number(f.change.snapshot.delta.tax.totals!.totalMinor);
    Object.assign(f.orders.get("order_upi")!, {
      status: "paid",
      amount_paid: amount,
      amount_due: 0,
    });
    f.upi.payments.set("pay_delta", {
      id: "pay_switched",
      customer_id: "cust_upi",
      invoice_id: null,
      order_id: "order_upi",
      status: "captured",
      captured: true,
      method: "card",
      international: false,
      amount,
      currency: "INR",
      amount_refunded: 0,
      created_at: 1793869200,
    });
    for (let i = 0; i < 2; i++)
      await f.changes.refresh(f.owner, f.business.id, {
        changeId: f.change.id,
        requestKey: randomUUID(),
      });
    const state = (await f.changes.workspace(f.owner, f.business.id))
      .changes[0];
    expect(state.state).not.toBe("applied");
    expect(state.events.filter((e) => e.fact.incurred)).toMatchObject([
      {
        fact: {
          kind: "review",
          reason: "captured_order_binding_mismatch",
          incurred: {
            account: "acc_upi:test",
            mode: "test",
            paymentId: "pay_switched",
            method: "card",
            amountMinor: String(amount),
            customerId: null,
          },
        },
      },
    ]);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    expect(f.mutations).toHaveLength(3);
  });
  it("retains a genuinely late UPI capture after offboarding without applying reach or starting another collector", async () => {
    const f = await orderedUpiFixture(h),
      amount = Number(f.change.snapshot.delta.tax.totals!.totalMinor);
    const policy: DataPolicy = {
      id: "upi-offboarding",
      version: 1,
      businessIds: [f.business.id],
      mode: "test",
      reviewedBy: "fixture legal reviewer",
      evidence: ["explicit fixture preservation"],
      effectiveFrom: "2026-11-01T00:00:00.000Z",
      effectiveUntil: "2027-11-01T00:00:00.000Z",
      access: "owner_admin",
      afterCancellation: true,
      preserveFinancial: true,
      retention: {
        retainedRecords: "source_contract",
        financialEvidenceUntil: "2027-11-01T00:00:00.000Z",
        evidence: "fixture",
      },
      exportSeconds: 3600,
      grantSeconds: 60,
      maxBytes: 2000000,
      maxRows: 200,
      storageScope: "fixture-private",
      sourceRights: [],
      deletion: null,
      nativeRevocation: false,
      maxAttempts: 3,
      retrySeconds: 1,
    };
    const data = createDataGovernanceApplication({
      authenticate: h.access.authenticatePrivileged,
      repository: createDataGovernanceRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage: createMemoryStorage(),
      storageScope: policy.storageScope,
      policy: () => policy,
      revoke: async () => "manual_required",
    });
    await data.offboard(f.owner, f.business.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    Object.assign(f.orders.get("order_upi")!, {
      status: "paid",
      amount_paid: amount,
      amount_due: 0,
    });
    f.upi.payments.set("pay_delta", {
      id: "pay_delta",
      customer_id: "cust_upi",
      invoice_id: null,
      order_id: "order_upi",
      status: "captured",
      captured: true,
      method: "upi",
      vpa: "synthetic@fixture",
      international: false,
      amount,
      currency: "INR",
      amount_refunded: 0,
      created_at: 1793869200,
    });
    await f.changes.recover();
    const payments = await f.payments.workspace(f.owner, f.business.id),
      changes = await f.changes.workspace(f.owner, f.business.id);
    expect(
      payments.periods.find((p) => p.paymentId === "pay_delta")?.charge
        ?.amountMinor,
    ).toBe(String(amount));
    expect(changes.stopped).toBe(true);
    expect(
      changes.changes[0].events.some((e) => e.fact.kind === "applied"),
    ).toBe(false);
    expect(payments.allowances?.discovery.included).toBe(100);
    expect(
      (
        await f.changes.execute(f.owner, f.business.id, {
          changeId: f.change.id,
          requestKey: randomUUID(),
        })
      ).state,
    ).toBe("review_required");
    expect(f.mutations).toHaveLength(3);
  });
  it.each(["failed", "card", "foreign_customer", "unsupported_handle"])(
    "recovers a %s authorization under the same original proof intent without another mandate or charge",
    async (failure) => {
      const f = await eligible(),
        c = await approve(f);
      await f.changes.execute(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      });
      const sub = f.upi.subscriptions.get("sub_fixture1")!;
      Object.assign(sub, {
        customer_id: "cust_upi",
        status: failure === "failed" ? "created" : "authenticated",
      });
      f.upi.payments.set("pay_recovery", {
        id: "pay_recovery",
        customer_id:
          failure === "foreign_customer" ? "cust_foreign" : "cust_upi",
        invoice_id: null,
        order_id: null,
        status: "refunded",
        captured: true,
        method: failure === "card" ? "card" : "upi",
        vpa:
          failure === "unsupported_handle"
            ? "synthetic@other"
            : "synthetic@fixture",
        international: false,
        amount: 500,
        currency: "INR",
        amount_refunded: 500,
      });
      const input = {
        actionId: c.snapshot.replacementActionId,
        requestKey: randomUUID(),
        paymentId: "pay_recovery",
        subscriptionId: "sub_fixture1",
        signature: createHmac("sha256", "upi-api-secret")
          .update("pay_recovery|sub_fixture1")
          .digest("hex"),
      };
      await expect(
        f.payments.confirmMandate(f.owner, f.business.id, input),
      ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
      Object.assign(sub, { status: "authenticated" });
      Object.assign(f.upi.payments.get("pay_recovery")!, {
        customer_id: "cust_upi",
        method: "upi",
        vpa: "synthetic@fixture",
      });
      await f.payments.confirmMandate(f.owner, f.business.id, input);
      await f.payments.confirmMandate(f.owner, f.business.id, input);
      const state = await f.changes.refresh(f.owner, f.business.id, {
        changeId: c.id,
        requestKey: randomUUID(),
      });
      expect(
        state.events.filter((e) => e.fact.native).at(-1)?.fact.native
          ?.mandateReady,
      ).toBe(true);
      expect(
        (await f.payments.workspace(f.owner, f.business.id)).periods,
      ).toHaveLength(1);
      expect(f.mutations).toHaveLength(2);
    },
  );
  it("keeps unknown old cancellation unresolved and never starts a conflicting collector or repeats cancellation", async () => {
    const f = await eligible(),
      c = await approve(f);
    f.condition.oldCancelUnknown = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(f.mutations.map((m) => [m.account, m.path])).toEqual([
      ["card", "/v1/subscriptions/sub_fixture1/cancel"],
    ]);
    expect(f.upi.subscriptions.size).toBe(0);
    const state = (await f.changes.workspace(f.owner, f.business.id))
      .changes[0];
    expect(
      state.events.filter((e) => e.fact.native).at(-1)?.fact.native?.oldStopped,
    ).toBe(false);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
  });
  it("rejects a foreign-account signature and conflicting receipt replay even when the payload claims the approved UPI account", async () => {
    const f = await eligible(),
      c = await approve(f);
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_upi",
        event: "subscription.authenticated",
        payload: {
          subscription: { entity: f.upi.subscriptions.get("sub_fixture1") },
          payment: { entity: { id: "pay_early" } },
        },
      }),
    );
    const headers = (secret: string) =>
      new Headers({
        "x-razorpay-event-id": "shared_event_identity",
        "x-razorpay-signature": createHmac("sha256", secret)
          .update(body)
          .digest("hex"),
      });
    await expect(
      f.payments.event(
        { body, headers: headers("fixture-webhook-secret") },
        "upi",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.payments.event({ body, headers: headers("upi-webhook") }, "upi");
    await f.payments.event({ body, headers: headers("upi-webhook") }, "upi");
    const changed = new TextEncoder().encode(
      new TextDecoder().decode(body).replace("pay_early", "pay_switched"),
    );
    await expect(
      f.payments.event(
        {
          body: changed,
          headers: new Headers({
            "x-razorpay-event-id": "shared_event_identity",
            "x-razorpay-signature": createHmac("sha256", "upi-webhook")
              .update(changed)
              .digest("hex"),
          }),
        },
        "upi",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    expect(f.mutations).toHaveLength(2);
  });
  it("binds a signed checkout proof to the original UPI action/account/customer and original actor payload without granting a paid period", async () => {
    const f = await eligible(),
      c = await approve(f);
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
      customer_id: "cust_upi",
      status: "authenticated",
    });
    f.upi.payments.set("pay_signed", {
      id: "pay_signed",
      customer_id: "cust_upi",
      invoice_id: null,
      order_id: null,
      status: "authorized",
      captured: false,
      method: "upi",
      vpa: "synthetic@fixture",
      international: false,
      amount: 500,
      currency: "INR",
      amount_refunded: 0,
    });
    const input = {
      actionId: c.snapshot.replacementActionId,
      requestKey: randomUUID(),
      paymentId: "pay_signed",
      subscriptionId: "sub_fixture1",
      signature: createHmac("sha256", "upi-api-secret")
        .update("pay_signed|sub_fixture1")
        .digest("hex"),
    };
    await expect(
      f.payments.confirmMandate(f.owner, f.business.id, {
        ...input,
        signature: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const signed = { ...input, requestKey: randomUUID() };
    let savedProof: unknown;
    f.condition.beforeRead = async () => {
      savedProof = (
        await h.admin.query(
          "SELECT detail->'checkoutProof' proof FROM subscription_payment_history WHERE id=$1",
          [signed.requestKey],
        )
      ).rows[0]?.proof;
      throw new Error("native read interrupted after persisted proof intent");
    };
    await expect(
      f.payments.confirmMandate(f.owner, f.business.id, signed),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(savedProof).toEqual(signed);
    f.condition.beforeRead = undefined;
    await f.payments.recover();
    const recovered = await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(
      recovered.events.filter((e) => e.fact.native).at(-1)?.fact.native
        ?.mandateReady,
    ).toBe(true);
    expect(
      JSON.stringify(await f.payments.workspace(f.owner, f.business.id)),
    ).not.toContain(signed.signature);
    await f.payments.confirmMandate(f.owner, f.business.id, signed);
    await f.payments.confirmMandate(f.owner, f.business.id, signed);
    await expect(
      f.payments.confirmMandate(f.owner, f.business.id, {
        ...signed,
        paymentId: "pay_other",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const change = await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(
      change.events.filter((e) => e.fact.native).at(-1)?.fact.native
        ?.mandateReady,
    ).toBe(true);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    expect(f.mutations).toHaveLength(2);
  });
  it("recovers the original ambiguous mandate, validates UPI authorization separately and grants expanded reach only on its exact captured order", async () => {
    const f = await eligible(),
      c = await approve(f);
    f.condition.loseCreate = true;
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(f.mutations.map((m) => [m.account, m.path])).toEqual([
      ["card", "/v1/subscriptions/sub_fixture1/cancel"],
      ["upi", "/v1/subscriptions"],
    ]);
    let observed = await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    const native = observed.events.filter((e) => e.fact.native).at(-1)!.fact
      .native!;
    expect(native).toMatchObject({
      oldStopped: true,
      subscriptionId: "sub_fixture1",
      customerId: "cust_upi",
      mandateReady: false,
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    const sub = f.upi.subscriptions.get("sub_fixture1")!;
    Object.assign(sub, { customer_id: "cust_upi", status: "authenticated" });
    f.upi.payments.set("pay_auth", {
      id: "pay_auth",
      customer_id: "cust_upi",
      invoice_id: null,
      order_id: null,
      status: "refunded",
      captured: true,
      method: "upi",
      vpa: "synthetic@fixture",
      international: false,
      amount: 500,
      currency: "INR",
      amount_refunded: 500,
    });
    const body = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_upi",
        event: "subscription.authenticated",
        payload: {
          subscription: { entity: sub },
          payment: { entity: { id: "pay_auth" } },
        },
      }),
    );
    await f.payments.event(
      {
        body,
        headers: new Headers({
          "x-razorpay-event-id": "upi-auth",
          "x-razorpay-signature": createHmac("sha256", "upi-webhook")
            .update(body)
            .digest("hex"),
        }),
      },
      "upi",
    );
    await f.changes.execute(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(f.mutations.at(-1)).toMatchObject({
      account: "upi",
      path: "/v1/orders",
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods,
    ).toHaveLength(1);
    const amount = Number(c.snapshot.delta.tax.totals!.totalMinor);
    Object.assign(f.orders.get("order_upi")!, {
      status: "paid",
      amount_paid: amount,
      amount_due: 0,
    });
    f.upi.payments.set("pay_delta", {
      id: "pay_delta",
      customer_id: "cust_upi",
      invoice_id: null,
      order_id: "order_upi",
      status: "captured",
      captured: true,
      method: "upi",
      vpa: "synthetic@fixture",
      international: false,
      amount,
      currency: "INR",
      amount_refunded: 0,
      created_at: 1793869200,
    });
    observed = await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    expect(observed.state).toBe("applied");
    await f.changes.refresh(f.owner, f.business.id, {
      changeId: c.id,
      requestKey: randomUUID(),
    });
    const workspace = await f.payments.workspace(f.owner, f.business.id);
    expect(workspace.periods).toHaveLength(2);
    expect(
      workspace.periods.find((p) => p.paymentId === "pay_delta")?.charge?.charge
        ?.method,
    ).toBe("upi");
    expect(workspace.effectiveScope?.markets).toContain("Canada");
    expect(workspace.periods.find((p) => p.id === f.original.id)).toEqual(
      f.original,
    );
    expect(f.mutations).toHaveLength(3);
    h.clock.set("2026-12-05T09:00:00.000Z");
    const owner = await h.signIn("tax-owner@example.com");
    Object.assign(f.card.subscriptions.get("sub_fixture1")!, {
      status: "cancelled",
      ended_at: 1796461200,
    });
    f.upi.charge(
      "pay_upiFirst",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
      customer_id: "cust_upi",
    });
    Object.assign(f.upi.invoices.at(-1)!, {
      customer_id: "cust_upi",
      amount: 22011,
      amount_paid: 22011,
      line_items: [
        { type: "plan", quantity: 1, amount: 22011, currency: "INR" },
      ],
    });
    Object.assign(f.upi.payments.get("pay_upiFirst")!, {
      customer_id: "cust_upi",
      method: "upi",
      vpa: "synthetic@fixture",
      amount: 22011,
    });
    await f.payments.recover();
    const renewed = await f.payments.workspace(owner, f.business.id);
    expect(renewed.periods).toHaveLength(3);
    expect(renewed.access.period?.paymentId).toBe("pay_upiFirst");
    expect(renewed.access.period?.snapshot.provider.account).toBe(
      "acc_upi:test",
    );
    Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
      status: "paused",
    });
    await f.payments.refresh(owner, f.business.id, {
      actionId: c.snapshot.replacementActionId,
    });
    expect(
      (await f.payments.workspace(owner, f.business.id)).actions.find(
        (a) => a.id === c.snapshot.replacementActionId,
      )?.lifecycle?.provider?.status,
    ).toBe("paused");
    await expect(
      f.payments.updatePayment(owner, f.business.id, {
        actionId: c.snapshot.replacementActionId,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    const replacementId = c.snapshot.replacementActionId;
    h.clock.set("2027-01-05T09:00:00.000Z");
    const renewalOwner = await h.signIn("tax-owner@example.com");
    f.upi.charge(
      "pay_upiRenewal",
      "2027-01-05T09:00:00.000Z",
      "2027-02-05T09:00:00.000Z",
    );
    Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
      customer_id: "cust_upi",
    });
    Object.assign(f.upi.invoices.at(-1)!, {
      customer_id: "cust_upi",
      amount: 22011,
      amount_paid: 22011,
      line_items: [
        { type: "plan", quantity: 1, amount: 22011, currency: "INR" },
      ],
    });
    Object.assign(f.upi.payments.get("pay_upiRenewal")!, {
      customer_id: "cust_upi",
      method: "upi",
      vpa: "synthetic@fixture",
      amount: 22011,
    });
    await f.payments.recover();
    const actualRenewal = (
      await f.payments.workspace(renewalOwner, f.business.id)
    ).access.period;
    expect(actualRenewal).toMatchObject({
      paymentId: "pay_upiRenewal",
      snapshot: {
        basis: { kind: "renewal" },
        provider: { account: "acc_upi:test" },
      },
      charge: { charge: { method: "upi" } },
    });
    const disabledReview = razorpayAccountReviewSchema.parse(
      JSON.parse(f.env.RAZORPAY_UPI_ACCOUNT_REVIEW),
    );
    disabledReview.upiPath!.enabled = false;
    const disabledPayments = createSubscriptionPaymentApplication({
      authenticate: h.access.authenticateForWork,
      authenticatePlatform: h.access.authenticatePlatformForWork,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: configuredPayments({
        ...f.configuration,
        env: {
          ...f.env,
          RAZORPAY_UPI_ACCOUNT_REVIEW: JSON.stringify(disabledReview),
        },
      }),
    });
    await disabledPayments.cancel(renewalOwner, f.business.id, {
      actionId: replacementId,
      requestKey: randomUUID(),
    });
    await disabledPayments.cancel(renewalOwner, f.business.id, {
      actionId: replacementId,
      requestKey: randomUUID(),
    });
    await f.payments.recover();
    expect(f.mutations.at(-1)).toMatchObject({
      account: "upi",
      path: "/v1/subscriptions/sub_fixture1/cancel",
    });
    expect(f.mutations).toHaveLength(4);
    expect(
      (await f.payments.workspace(renewalOwner, f.business.id)).actions.find(
        (a) => a.id === replacementId,
      )?.lifecycle?.state,
    ).toBe("cancelled");
    h.clock.set("2027-02-05T09:00:00.000Z");
    const lateOwner = await h.signIn("tax-owner@example.com");
    f.upi.charge(
      "pay_lateAfterCancel",
      "2027-02-05T09:00:00.000Z",
      "2027-03-05T09:00:00.000Z",
    );
    Object.assign(f.upi.subscriptions.get("sub_fixture1")!, {
      customer_id: "cust_upi",
    });
    Object.assign(f.upi.invoices.at(-1)!, {
      customer_id: "cust_upi",
      amount: 22011,
      amount_paid: 22011,
      line_items: [
        { type: "plan", quantity: 1, amount: 22011, currency: "INR" },
      ],
    });
    Object.assign(f.upi.payments.get("pay_lateAfterCancel")!, {
      customer_id: "cust_upi",
      method: "upi",
      vpa: "synthetic@fixture",
      amount: 22011,
    });
    await f.payments.recover();
    await f.payments.event(
      {
        body,
        headers: new Headers({
          "x-razorpay-event-id": "late_old_auth",
          "x-razorpay-signature": createHmac("sha256", "upi-webhook")
            .update(body)
            .digest("hex"),
        }),
      },
      "upi",
    );
    await f.payments.recover();
    const late = await f.payments.workspace(lateOwner, f.business.id);
    expect(
      late.periods.find((p) => p.paymentId === "pay_lateAfterCancel")?.snapshot
        .provider.account,
    ).toBe("acc_upi:test");
    expect(late.access.active).toBe(false);
    expect(late.effectiveContract).toBeNull();
    expect(
      late.actions.find((a) => a.id === replacementId)?.lifecycle?.state,
    ).toBe("cancelled");
    expect(f.mutations).toHaveLength(4);
  });

  it("keeps UPI unavailable without an explicit reviewed path and preserves cards-only configuration", async () => {
    const f = await subscriptionFixture(h);
    const changes = createReachChangeApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createReachChangeRepository(runtimeDatabase(h.runtime)),
      gateway: configuredPayments({ env: {}, clock: h.clock }),
      clock: h.clock,
    });
    await expect(
      changes.preview(f.owner, f.business.id, {
        periodId: randomUUID(),
        quoteId: f.quote.id,
        requestKey: randomUUID(),
        paymentMethod: "upi",
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    const workspace = await changes.workspace(f.owner, f.business.id);
    expect(workspace.upi).toEqual({
      available: false,
      reason: "reviewed_upi_path_required",
    });
  });

  describe("Original-account financial composition", () => {
    let f: Awaited<ReturnType<typeof fundedUpiFixture>>;
    let documents: ReturnType<typeof createSellerDocumentApplication<Headers>>;
    let adjustments: ReturnType<
      typeof createFinancialAdjustmentApplication<Headers>
    >;
    let invoice: Awaited<ReturnType<typeof documents.issue>>;
    beforeEach(async () => {
      f = await fundedUpiFixture(h);
      const actor = await h.authenticate(f.operator);
      await h.admin.query(
        "UPDATE platform_operator SET documents=true,refunds=true WHERE user_id=$1",
        [actor.userId],
      );
      documents = createSellerDocumentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        storage: createMemoryStorage(),
        mode: "fixture",
        policy: {
          accountScope: "upi-fixture",
          maxBytes: 1000000,
          accessTtlSeconds: 60,
          recoveryLeaseSeconds: 60,
        },
      });
      const catalog = await documents.saveIssuer(f.operator, {
        expectedVersion: 0,
        configuration: fixtureIssuer,
        note: "Fixture issuer",
      });
      await documents.decideIssuer(f.operator, {
        revisionId: catalog.revisions[0].id,
        expectedVersion: 0,
        outcome: "approved",
        note: "Fixture review",
      });
      invoice = await documents.issue(f.owner, f.business.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      });
      adjustments = createFinancialAdjustmentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createFinancialAdjustmentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredFinancialAdjustments({
          env: f.env,
          fetch: f.configuration.fetch,
          clock: h.clock,
        }),
        documents,
      });
    });
    it("retains actual UPI cash1100, original-tax credit1099 and residual1 using the frozen merchant after the default card configuration changes", async () => {
      const review = await adjustments.review(f.operator, f.business.id, {
        kind: "refund",
        invoiceId: invoice.id,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "1000" }],
        reason: "Reviewed partial refund",
        evidence: ["fixture customer request"],
      });
      const changedDefault = {
        ...f.env,
        RAZORPAY_ACCOUNT_REVIEW: JSON.stringify({
          ...f.card.review,
          account: "acc_replacementDefault",
        }),
        RAZORPAY_KEY_ID: "rzp_test_replacementDefault",
      };
      adjustments = createFinancialAdjustmentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createFinancialAdjustmentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredFinancialAdjustments({
          env: changedDefault,
          fetch: f.configuration.fetch,
          clock: h.clock,
        }),
        documents,
      });
      await adjustments.execute(f.operator, f.business.id, {
        caseId: review.id,
      });
      expect(f.upi.refundPosts).toHaveLength(1);
      expect(f.mutations.at(-1)).toMatchObject({
        account: "upi",
        path: "/v1/payments/pay_delta/refund",
      });
      Object.assign(f.upi.refunds[0], { status: "processed" });
      Object.assign(f.upi.payments.get("pay_delta")!, {
        amount_refunded: 1100,
      });
      await adjustments.refresh(f.operator, f.business.id, {
        caseId: review.id,
      });
      await adjustments.reviewCredit(f.operator, f.business.id, {
        caseId: review.id,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "999" }],
        reason: "Original component allocation",
        evidence: ["fixture explicit1099 basis and1 residual"],
      });
      const credit = await adjustments.credit(f.operator, f.business.id, {
        caseId: review.id,
      });
      expect(credit).toMatchObject({
        creditDocumentId: expect.any(String),
        creditAmountMinor: "1099",
        amountMinor: "1100",
      });
      const docs = await documents.workspace(f.owner, f.business.id);
      expect(
        docs.documents.find((d) => d.kind === "credit_note")?.snapshot.totals
          .totalMinor,
      ).toBe("1099");
      expect(docs.documents.find((d) => d.id === invoice.id)).toEqual(invoice);
      expect(JSON.stringify(docs)).not.toContain(
        "fixture account settings/MCC/PSP support",
      );
      const reconciliation = createReconciliationApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
      });
      const report = await reconciliation.workspace(f.operator, {
        from: "2026-11-01T00:00:00.000Z",
        until: "2026-12-01T00:00:00.000Z",
      });
      expect(
        report.sources.find((s) => s.periodId === f.period.id),
      ).toMatchObject({
        account: "acc_upi:test",
        customerId: "cust_upi",
        effects: [
          expect.objectContaining({
            actualMinor: "1100",
            approvedCredit: expect.objectContaining({
              uncreditedDifferenceMinor: "1",
              allocation: expect.objectContaining({
                totals: expect.objectContaining({ totalMinor: "1099" }),
              }),
            }),
          }),
        ],
      });
      expect(f.upi.refundPosts).toHaveLength(1);
    });
    it("routes dispute evidence, ambiguous submission recovery and authoritative loss to the original UPI merchant", async () => {
      f.upi.disputes.set("disp_upi", {
        id: "disp_upi",
        entity: "dispute",
        payment_id: "pay_delta",
        amount: 1100,
        currency: "INR",
        amount_deducted: 0,
        status: "open",
        phase: "chargeback",
        reason_code: "chargeback",
        respond_by: 1793955600,
        created_at: Math.floor(h.clock.now().getTime() / 1000),
        evidence: { submitted_at: null },
      });
      const review = await adjustments.review(f.operator, f.business.id, {
        kind: "dispute",
        disputeId: "disp_upi",
        invoiceId: invoice.id,
        requestKey: randomUUID(),
        lines: [{ lineId: "subscription", netMinor: "1000" }],
        reason: "Retain exact original UPI dispute",
        evidence: ["fixture native dispute"],
      });
      const bytes = new TextEncoder().encode(
        "%PDF-1.7\nSynthetic UPI evidence",
      );
      f.upi.documents.set("doc_upi", bytes);
      const evidence = {
        category: "proof_of_service",
        documentId: "doc_upi",
        sha256: (await import("node:crypto"))
          .createHash("sha256")
          .update(bytes)
          .digest("hex"),
      };
      await adjustments.dispute(f.operator, f.business.id, {
        caseId: review.id,
        requestKey: randomUUID(),
        action: "draft",
        summary: "Exact merchant evidence",
        documents: [evidence],
      });
      f.upi.loseDispute = true;
      await adjustments.dispute(f.operator, f.business.id, {
        caseId: review.id,
        requestKey: randomUUID(),
        action: "submit",
        summary: "Exact merchant evidence",
        documents: [evidence],
      });
      await adjustments.recover();
      expect(
        (await adjustments.workspace(f.operator, f.business.id, true)).cases[0],
      ).toMatchObject({ state: "under_review", creditDocumentId: null });
      expect(f.upi.disputePosts).toHaveLength(2);
      expect(
        f.mutations.filter((m) => m.path.includes("/disputes/")),
      ).toMatchObject([{ account: "upi" }, { account: "upi" }]);
      Object.assign(f.upi.disputes.get("disp_upi")!, {
        status: "lost",
        amount_deducted: 1100,
      });
      await adjustments.recover();
      const state = (
        await adjustments.workspace(f.operator, f.business.id, true)
      ).cases[0];
      expect(state).toMatchObject({
        state: "lost",
        amountMinor: "1100",
        creditDocumentId: null,
      });
      const report = await createReconciliationApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createReconciliationRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
      }).workspace(f.operator, {
        from: "2026-11-01T00:00:00.000Z",
        until: "2026-12-01T00:00:00.000Z",
      });
      expect(
        report.sources.find((s) => s.periodId === f.period.id),
      ).toMatchObject({
        account: "acc_upi:test",
        effects: [
          expect.objectContaining({
            source: "dispute",
            actualMinor: "1100",
            nativeId: "disp_upi",
          }),
        ],
      });
      expect(f.upi.disputePosts).toHaveLength(2);
    });
  });
});
