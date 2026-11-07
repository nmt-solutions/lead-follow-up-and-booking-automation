import { periodEnd } from "../../src/models/subscription-payments";
import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import type { pilotFixture } from "./pilot";
/** Explicit historical canonical prerequisites, provisioned only by the disposable
 * schema owner. This arrangement tests present-day validation, never the native
 * collector's historical authorization chronology. The collector has separate
 * real-PG/production-adapter tests. Billing/files/tax and current source setup
 * below use actual public commands; no internal behavior is mocked. */
export async function historicalPilot(
  h: Awaited<ReturnType<typeof createHarness>>,
  s: Awaited<ReturnType<typeof pilotFixture>>,
) {
  const b = await h.application.createBusiness(s.f.owner, {
      name: "Historical cleaning pilot",
      offering: "Cleaning services",
      homeMarket: "Pune",
      website: "",
    }),
    actor = await h.authenticate(s.f.owner);
  s.addRetentionBusiness(b.id);
  const now = Math.floor(h.clock.now().getTime() / 1000) * 1000,
    start = new Date(now - 15 * 86400000).toISOString(),
    end = new Date(now - 86400000).toISOString(),
    monthlyEnd = periodEnd(end, { kind: "calendar_month", timeZone: "UTC" });
  const upload = await s.f.files.beginUpload(s.f.owner, b.id, {
    name: "historical-fixture-identity.txt",
    contentType: "text/plain",
    size: 5,
    purpose: "billing",
  });
  await s.f.files.completeUpload(
    s.f.owner,
    b.id,
    upload.file.id,
    upload.token,
    new TextEncoder().encode("legal"),
  );
  await s.f.billing.save(s.f.owner, b.id, {
    expectedVersion: 0,
    note: "Synthetic current identity for prior purchaser",
    profile: {
      ...s.f.quote.profile.profile,
      evidence: s.f.quote.profile.profile.evidence.map((e) => ({
        ...e,
        fileId: upload.file.id,
      })),
    },
  });
  await s.f.billing.review(s.f.operator, b.id, {
    expectedVersion: 1,
    expectedReviewVersion: 0,
    outcome: "reviewed",
    findings: [],
    note: "Synthetic current review only; no actual legal approval claim",
  });
  const billing = await s.f.billing.workspace(s.f.owner, b.id);
  const quote = (
      await h.admin.query("select * from subscription_quote where id=$1", [
        s.f.quote.id,
      ])
    ).rows[0],
    original = (
      await h.admin.query("select * from subscription_payment where id=$1", [
        s.action.id,
      ])
    ).rows[0],
    period = (
      await h.admin.query(
        "select * from subscription_period where action_id=$1",
        [s.action.id],
      )
    ).rows[0];
  const quoteId = randomUUID(),
    actionId = randomUUID(),
    periodId = randomUUID(),
    renewalId = randomUUID(),
    renewalPeriodId = randomUUID(),
    pilotId = randomUUID();
  const snapshot = structuredClone(original.snapshot);
  snapshot.quote = {
    ...snapshot.quote,
    id: quoteId,
    businessId: b.id,
    profile: billing.current,
    billingReview: billing.reviews.at(-1),
  };
  async function tax(
    lines: { kind: string; label: string; amountMinor: number }[],
  ) {
    return s.f.tax.calculate(s.f.owner, b.id, {
      requestKey: randomUUID(),
      expectedProfileVersion: 1,
      expectedReviewVersion: 1,
      currency: "INR",
      lines: lines.map((line) => ({
        id: line.kind,
        productCode: line.kind,
        description: line.label,
        quantity: 1,
        unitAmountMinor: String(line.amountMinor),
      })),
      note: "Synthetic historical financial prerequisite calculation",
    });
  }
  snapshot.tax = await tax(snapshot.quote.initial.lines);
  const initialCharge = {
    ...period.charge,
    operationKey: randomUUID(),
    paymentId: "pay_historicalPilot",
    paidAt: start,
    periodStart: start,
    periodEnd: end,
    checkoutId: "order_historical",
    customerId: "cust_historical",
    charge: {
      ...period.charge.charge,
      orderId: "order_historical",
      subscriptionStart: start,
    },
  };
  const continuation = {
    ...snapshot,
    term: { kind: "calendar_month", timeZone: "UTC" },
    basis: {
      kind: "renewal",
      discovery: snapshot.quote.renewal.discovery,
      automation: snapshot.quote.renewal.automation,
    },
    pilotContinuation: {
      originalActionId: actionId,
      originalPeriodId: periodId,
      customerId: "cust_historical",
      originalEnd: end,
      startAt: end,
      approvalExpiresAt: new Date(now - 2 * 86400000).toISOString(),
      disclosure: "Fixture: separate explicitly approved monthly mandate",
    },
    tax: await tax(snapshot.quote.renewal.lines),
  };
  const monthlyCharge = {
    ...initialCharge,
    operationKey: randomUUID(),
    checkoutId: "sub_historical",
    subscriptionId: "sub_historical",
    paymentId: "pay_historicalMonthly",
    amountMinor: continuation.tax.totals!.totalMinor,
    paidAt: end,
    periodStart: end,
    periodEnd: monthlyEnd,
    charge: {
      ...initialCharge.charge,
      subscriptionStart: end,
      invoiceId: "inv_historical",
      orderId: "order_historicalMonthly",
    },
  };
  async function insert(
    table:
      "subscription_quote" | "subscription_payment" | "subscription_period",
    row: Record<string, unknown>,
  ) {
    await h.admin.query(
      `insert into public.${table} select (jsonb_populate_record(null::public.${table},$1::jsonb)).*`,
      [JSON.stringify(row)],
    );
  }
  await insert("subscription_quote", {
    ...quote,
    id: quoteId,
    business_id: b.id,
    request_key: randomUUID(),
    profile_id: billing.current!.id,
    review_id: billing.reviews.at(-1)!.id,
    snapshot: snapshot.quote,
  });
  await insert("subscription_payment", {
    ...original,
    id: actionId,
    business_id: b.id,
    request_key: randomUUID(),
    operation_key: initialCharge.operationKey,
    recovery_key: randomUUID(),
    quote_id: quoteId,
    snapshot,
    at: start,
    observation: initialCharge,
    checkout: {
      ...original.checkout,
      customerId: "cust_historical",
      checkoutId: "order_historical",
    },
  });
  await insert("subscription_period", {
    ...period,
    id: periodId,
    business_id: b.id,
    action_id: actionId,
    payment_id: initialCharge.paymentId,
    start,
    end,
    snapshot,
    charge: initialCharge,
  });
  await insert("subscription_payment", {
    ...original,
    id: renewalId,
    business_id: b.id,
    request_key: randomUUID(),
    operation_key: monthlyCharge.operationKey,
    recovery_key: randomUUID(),
    quote_id: quoteId,
    snapshot: continuation,
    at: end,
    observation: monthlyCharge,
    checkout: {
      customerId: "cust_historical",
      checkoutId: "sub_historical",
      subscriptionId: "sub_historical",
      planId: original.checkout.planId,
      url: "https://rzp.io/i/historical",
    },
  });
  await insert("subscription_period", {
    ...period,
    id: renewalPeriodId,
    business_id: b.id,
    action_id: renewalId,
    payment_id: monthlyCharge.paymentId,
    start: end,
    end: monthlyEnd,
    snapshot: continuation,
    charge: monthlyCharge,
  });
  const plan = {
    ...s.plan,
    paymentActionId: actionId,
    goal: "Qualify cleaning inquiries",
    scope: "Historical agreed cleaning inquiry evaluation",
    startsAt: start,
    endsAt: end,
  };
  await h.admin.query(
    "insert into pilot_record(id,business_id,request_key,actor_id,snapshot,at) values($1,$2,$3,$4,$5,$6)",
    [
      pilotId,
      b.id,
      randomUUID(),
      actor.userId,
      JSON.stringify({
        business: { name: b.name, offering: b.offering },
        plan,
        payment: {
          ...snapshot,
          provider: {
            key: snapshot.provider.key,
            account: snapshot.provider.account,
            mode: snapshot.provider.mode,
          },
        },
      }),
      start,
    ],
  );
  for (const kind of ["prepared", "approved", "activated"])
    await h.admin.query(
      "insert into pilot_event(id,business_id,pilot_id,request_key,kind,actor_id,data,at) values($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        b.id,
        pilotId,
        randomUUID(),
        kind,
        actor.userId,
        JSON.stringify({ historicalFixture: true }),
        start,
      ],
    );
  await h.application.saveConfiguration(s.f.owner, b.id, {
    offering: b.offering,
    specifications: "Agreed commercial cleaning scope",
    minimumOrder: "",
    deliveryConstraints: "Pune",
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
    buyersReviewed: true,
    buyerCategories: [
      {
        label: "Facilities managers",
        identity: "organization",
        use: "business_end_user",
        requiresBuyingRequest: false,
      },
    ],
    exclusions: [],
  });
  await h.admin.query(
    "insert into discovery_configuration(business_id,policy) select $1,policy from discovery_configuration where business_id=$2",
    [b.id, s.f.business.id],
  );
  await s.costs.refresh(s.f.owner, {
    month: h.clock.now().toISOString().slice(0, 7),
    retentionSeconds: 86400,
  });
  const costs = await s.costs.workspace(
      s.f.owner,
      h.clock.now().toISOString().slice(0, 7),
    ),
    baseline = costs.history
      .filter((r) => r.sourceId === "evidence:pilot-platform-baseline")
      .at(-1)!;
  await s.costs.record(s.f.owner, {
    sourceId: baseline.sourceId,
    expectedVersion: baseline.version,
    reason:
      "Fixture shared statement explicitly covers both synthetic legal-evidence uploads",
    retentionSeconds: 86400,
    source: {
      ...baseline.source,
      coversSourceIds: costs.history
        .filter((r) => r.sourceId.startsWith("native:file:"))
        .map((r) => r.sourceId),
    },
  });
  return {
    business: b,
    pilotId,
    plan,
    renewalId,
    renewalPeriodId,
    start,
    end,
    monthlyEnd,
  };
}
