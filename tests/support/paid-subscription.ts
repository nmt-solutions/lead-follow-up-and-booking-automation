import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import {
  billingProfileRevision,
  billingProfileReview,
  subscriptionPricingRevision,
  subscriptionQuote,
  subscriptionPayment,
  subscriptionPeriod,
} from "../../src/db/schema";
import {
  paymentSnapshotSchema,
  periodEnd,
} from "../../src/models/subscription-payments";

/** Explicit persisted prerequisite for operational scenarios that begin AFTER purchase.
 * Only the disposable schema-owner fixture provisions it. No production branch, internal
 * billing mock or runtime bypass exists. Purchase integrity is exercised separately at
 * the public payment seam with actual reviewed evidence/tax and deterministic gateways. */
export async function persistPaidSubscription(
  h: Awaited<ReturnType<typeof createHarness>>,
  credentials: Headers,
  businessId: string,
  scope: {
    markets: string[];
    discovery: { quantity: number; unit: string };
    automation: { quantity: number; unit: string };
  },
) {
  const actor = await h.authenticate(credentials),
    at = h.clock.now(),
    stamp = at.toISOString();
  const profile = {
    id: randomUUID(),
    businessId,
    version: 1,
    profile: {
      legalName: "Synthetic prior purchaser",
      registrationNumber: "fixture-only",
      address: {
        line1: "Fixture",
        line2: "",
        city: "Fixture",
        region: "",
        postalCode: "",
        country: "IN",
      },
      invoiceContact: { name: "Fixture", email: "fixture@example.com" },
      businessStatus: "business",
      taxIdentifierStatus: "not_applicable",
      taxIdentifiers: [],
      evidence: [],
    },
    evidence: [],
    actorId: actor.userId,
    actorName: "Fixture",
    at: stamp,
    note: "Pre-existing paid scenario fixture",
  };
  const review = {
    id: randomUUID(),
    businessId,
    profileId: profile.id,
    profileVersion: 1,
    version: 1,
    outcome: "reviewed",
    findings: [],
    note: "Synthetic historical fixture",
    actorId: actor.userId,
    actorName: "Fixture",
    at: stamp,
  };
  const pricingId = randomUUID(),
    quoteId = randomUUID(),
    actionId = randomUUID();
  const offer = {
    id: "operational-fixture",
    label: "Explicit prior purchase fixture",
    markets: scope.markets,
    discovery: scope.discovery,
    automation: scope.automation,
    prices: { INR: { monthlyMinor: 100, pilotMinor: null }, USD: null },
    pilot: null,
    renewalTerms: "Synthetic fixture calendar month",
    reservedCapacity: [],
  };
  const lines = [
    { kind: "subscription", label: offer.label, amountMinor: 100 },
  ];
  const snapshot = paymentSnapshotSchema.parse({
    provider: {
      key: "prior-purchase-fixture",
      account: "disposable-fixture",
      mode: "fixture",
    },
    term: { kind: "calendar_month", timeZone: "UTC" },
    quote: {
      id: quoteId,
      businessId,
      selection: {
        requestKey: randomUUID(),
        offerId: offer.id,
        reservedCapacityId: null,
        term: "monthly",
        expectedCatalogVersion: 1,
        expectedBillingVersion: 1,
        expectedReviewVersion: 1,
      },
      currency: "INR",
      profile,
      billingReview: review,
      pricing: {
        id: pricingId,
        version: 1,
        effectiveFrom: stamp,
        offer,
        reservedCapacity: null,
      },
      initial: {
        kind: "monthly",
        days: null,
        lines,
        subtotalMinor: 100,
        discovery: scope.discovery,
        automation: scope.automation,
      },
      renewal: {
        interval: "month",
        lines,
        subtotalMinor: 100,
        discovery: scope.discovery,
        automation: scope.automation,
        terms: offer.renewalTerms,
      },
      meta: {
        payer: "business_direct",
        includedInPlatformSubtotal: false,
        prepaidCredit: false,
        guaranteedMessages: false,
      },
      tax: { status: "not_calculated", amountMinor: null, totalMinor: null },
      grantsEntitlements: false,
      actorId: actor.userId,
      actorName: "Fixture",
      at: stamp,
    },
    tax: {
      id: randomUUID(),
      version: 1,
      businessId,
      requestKey: randomUUID(),
      resolvesId: null,
      purpose: "tax_preview",
      mode: "fixture",
      currency: "INR",
      minorUnit: 2,
      input: {
        requestKey: randomUUID(),
        expectedProfileVersion: 1,
        expectedReviewVersion: 1,
        currency: "INR",
        lines: [
          {
            id: "subscription",
            productCode: "subscription",
            description: "Synthetic prior purchase",
            unitAmountMinor: "100",
            quantity: 1,
          },
        ],
        note: "Synthetic prior purchase fixture",
      },
      billing: {
        version: 1,
        current: profile,
        history: [profile],
        status: "reviewed",
        issues: [],
        currency: "INR",
        classification: "india",
        reviewVersion: 1,
        reviews: [review],
      },
      configuration: { revisions: [], decisions: [] },
      status: "calculated",
      reasons: [],
      lines: [],
      totals: { netMinor: "100", taxMinor: "0", totalMinor: "100" },
      actorId: actor.userId,
      actorName: "Fixture",
      at: stamp,
      note: "Synthetic prior purchase fixture",
    },
  });
  const admin = runtimeDatabase(h.admin);
  await admin.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('subscription-pricing',0))`,
    );
    const versionResult = await tx.execute<{ version: number }>(
      sql`select coalesce(max(version),0)+1 as version from subscription_pricing_revision`,
    );
    snapshot.quote.pricing.version = versionResult.rows[0].version;
    snapshot.quote.selection.expectedCatalogVersion =
      versionResult.rows[0].version;
    await tx
      .insert(billingProfileRevision)
      .values({ ...snapshot.quote.profile, at });
    await tx
      .insert(billingProfileReview)
      .values({ ...snapshot.quote.billingReview, at });
    await tx.insert(subscriptionPricingRevision).values({
      id: pricingId,
      version: versionResult.rows[0].version,
      effectiveFrom: at,
      offers: [snapshot.quote.pricing.offer],
      note: "Prior purchase fixture",
      actorId: actor.userId,
      actorName: "Fixture",
      at,
    });
    await tx.insert(subscriptionQuote).values({
      id: quoteId,
      businessId,
      requestKey: snapshot.quote.selection.requestKey,
      pricingId,
      profileId: profile.id,
      reviewId: review.id,
      snapshot: snapshot.quote,
      actorId: actor.userId,
      at,
    });
    await tx.insert(subscriptionPayment).values({
      id: actionId,
      businessId,
      requestKey: randomUUID(),
      operationKey: randomUUID(),
      recoveryKey: randomUUID(),
      quoteId,
      snapshot,
      actorId: actor.userId,
      at,
      state: "confirmed",
      started: true,
    });
    await tx.insert(subscriptionPeriod).values({
      id: randomUUID(),
      actionId,
      businessId,
      provider: snapshot.provider.key,
      account: snapshot.provider.account,
      paymentId: randomUUID(),
      start: at,
      end: new Date(periodEnd(stamp, snapshot.term)),
      snapshot,
    });
  });
}
