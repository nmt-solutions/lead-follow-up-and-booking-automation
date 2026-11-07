import type { createGoogleCalendarApplication } from "../../src/application/google-calendar";
import type { createMicrosoftCalendarApplication } from "../../src/application/microsoft-calendar";
import type { createMailboxApplication } from "../../src/application/mailboxes";
import type { createSenderApplication } from "../../src/application/senders";
import type { createEmailEligibilityApplication } from "../../src/application/email-eligibility";
import type { createCommercialAuthorityApplication } from "../../src/application/commercial-authority";
import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { nativePilotFixture } from "./native-pilot";
import { runtimeDatabase } from "../../src/db/runtime";
import { createPilotRepository } from "../../src/db/pilot-repository";
import { createPilotApplication } from "../../src/application/pilots";
import { createPilotInspector } from "../../src/pilots/preflight";
import { createDiscoveryApplication } from "../../src/application/discovery";
import { createDiscoveryRepository } from "../../src/db/discovery-repository";
import type { DiscoveryWork, SearchInput } from "../../src/models/discovery";
import { createDataGovernanceApplication } from "../../src/application/data-governance";
import { createDataGovernanceRepository } from "../../src/db/data-governance-repository";
import { createMemoryStorage } from "./storage";
import { createReportingRepository } from "../../src/db/reporting-repository";
import { createCostApplication } from "../../src/application/costs";
import { createCostRepository } from "../../src/db/cost-repository";
import type { PilotPlan } from "../../src/models/pilots";
export async function pilotFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  limits: Partial<
    Pick<PilotPlan, "cashLimitMinor" | "spendLimitMinor" | "timeLimitSeconds">
  > = {},
  bootstrap?: (s: Awaited<ReturnType<typeof nativePilotFixture>>) => Promise<{
    mailboxes?: ReturnType<typeof createMailboxApplication<Headers>>;
    senders?: ReturnType<typeof createSenderApplication<Headers>>;
    email?: ReturnType<typeof createEmailEligibilityApplication<Headers>>;
    authority?: ReturnType<
      typeof createCommercialAuthorityApplication<Headers>
    >;
    googleCalendar?: ReturnType<typeof createGoogleCalendarApplication>;
    microsoftCalendar?: ReturnType<typeof createMicrosoftCalendarApplication>;
    plan: Partial<PilotPlan>;
    setupCost?: {
      provider: string;
      category: "workers";
      micros: string;
      evidence: string;
    };
  }>,
) {
  const s = await nativePilotFixture(h),
    database = runtimeDatabase(h.runtime),
    actor = await h.authenticate(s.f.owner),
    bid = s.f.business.id;
  await h.admin.query(
    "INSERT INTO platform_operator(user_id,pilots,costs) VALUES($1,true,true) ON CONFLICT(user_id) DO UPDATE SET pilots=true,costs=true",
    [actor.userId],
  );
  await s.app.start(s.f.owner, bid, { actionId: s.action.id });
  s.capture();
  await s.app.refresh(s.f.owner, bid, { actionId: s.action.id });
  await h.application.saveConfiguration(s.f.owner, bid, {
    offering: "Steel",
    specifications: "Reviewed steel specification",
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
        label: "Fabricators",
        identity: "organization",
        use: "business_end_user",
        requiresBuyingRequest: false,
      },
    ],
    exclusions: [],
  });
  const policy = {
    adapterId: "pilot-external-fixture",
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
  };
  await h.admin.query(
    "INSERT INTO discovery_configuration(business_id,policy) VALUES($1,$2)",
    [bid, policy],
  );
  const queued: DiscoveryWork[] = [],
    searches: SearchInput[] = [];
  const discovery = createDiscoveryApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    authenticateWork: h.access.authenticateWork,
    repository: createDiscoveryRepository(database, h.clock),
    clock: h.clock,
    queue: {
      async enqueue(w) {
        queued.push(w);
      },
      async schedule() {},
    },
    provider: {
      id: policy.adapterId,
      async search(input) {
        searches.push(input);
        return [
          {
            name: "Pune fabrication",
            market: input.market,
            url: "https://fabricator.example/steel",
            excerpt: "We fabricate steel.",
          },
        ];
      },
      async review() {
        return {
          relevant: true,
          reason: "Fabricates steel",
          evidenceQuote: "fabricate steel",
          uncertainty: "Purchasing timing unknown",
          request: null,
        };
      },
    },
  });
  let retentionAvailable = true,
    retentionVersion = 1;
  const retentionBusinessIds = new Set([bid]);
  const data = createDataGovernanceApplication({
    authenticate: h.access.authenticatePrivileged,
    repository: createDataGovernanceRepository(database),
    clock: h.clock,
    storage: createMemoryStorage(),
    storageScope: "pilot-fixture-private",
    revoke: async () => "confirmed",
    policy: () =>
      retentionAvailable
        ? {
            id: "fixture-reviewed-retention",
            version: retentionVersion,
            businessIds: [...retentionBusinessIds],
            mode: "fixture",
            reviewedBy: "fixture-only rights reviewer",
            evidence: ["fixture:actual-contract-scope"],
            effectiveFrom: "2026-11-01T00:00:00.000Z",
            effectiveUntil: "2027-11-01T00:00:00.000Z",
            access: "owner_admin",
            afterCancellation: true,
            preserveFinancial: true,
            retention: {
              retainedRecords: "source_contract",
              financialEvidenceUntil: "2028-01-01T00:00:00.000Z",
              evidence: "fixture:financial-preservation",
            },
            exportSeconds: 3600,
            grantSeconds: 60,
            maxBytes: 2000000,
            maxRows: 200,
            storageScope: "pilot-fixture-private",
            sourceRights: [],
            deletion: null,
            nativeRevocation: true,
            maxAttempts: 3,
            retrySeconds: 1,
          }
        : null,
  });
  const priorSetup = await bootstrap?.(s);
  const costs = createCostApplication({
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createCostRepository(database),
    clock: h.clock,
  });
  const month = h.clock.now().toISOString().slice(0, 7);
  await costs.refresh(s.f.owner, { month, retentionSeconds: 86400 });
  const sourceCosts = await costs.workspace(s.f.owner, month);
  const storageIds = sourceCosts.history
    .filter((r) => r.sourceId.startsWith("native:file:"))
    .map((r) => r.sourceId);
  await costs.record(s.f.owner, {
    sourceId: "evidence:pilot-platform-baseline",
    expectedVersion: 0,
    reason: "Explicit synthetic statement allocation",
    retentionSeconds: 86400,
    source: {
      month,
      provider: "r2",
      coversSourceIds: storageIds,
      category: "hosting",
      kind: "commitment",
      funding: "cash",
      amount: { currency: "INR", micros: "10000" },
      quantity: 1,
      unit: "month",
      businessId: null,
      runId: null,
      allocation: "fixture:shared-platform",
      evidence: "fixture:recorded-platform-statement",
      observedAt: h.clock.now().toISOString(),
      freshUntil: new Date(h.clock.now().getTime() + 86400000).toISOString(),
      plan: "fixture-explicit-plan",
      status: "recorded",
      details: {},
    },
  });
  if (priorSetup?.setupCost) {
    const c = priorSetup.setupCost;
    await costs.record(s.f.owner, {
      sourceId: "evidence:prior-native-mailbox-setup",
      expectedVersion: 0,
      reason: c.evidence,
      retentionSeconds: 86400,
      source: {
        month,
        provider: c.provider,
        category: c.category,
        kind: "commitment",
        funding: "cash",
        amount: { currency: "INR", micros: c.micros },
        quantity: 1,
        unit: "statement",
        businessId: bid,
        runId: null,
        allocation: c.evidence,
        evidence: c.evidence,
        observedAt: h.clock.now().toISOString(),
        freshUntil: new Date(h.clock.now().getTime() + 86400000).toISOString(),
        plan: null,
        status: "recorded",
        details: {},
        coversSourceIds: sourceCosts.history
          .filter((r) => r.source.provider === c.provider)
          .map((r) => r.sourceId),
      },
    });
  }
  const setGlobal = (version: number, limitInrMicros: string) =>
    costs.setBudget(s.f.owner, {
      month,
      category: "global",
      expectedVersion: version,
      limitInrMicros,
      ownerId: actor.userId,
      email: false,
      forecastAlerts: false,
      thresholds: [80, 90, 100],
      retentionSeconds: 86400,
      note: "Explicit synthetic global budget",
    });
  await setGlobal(0, "100000000");
  const pilots = createPilotApplication({
    authenticate: h.access.authenticateForWork,
    repository: createPilotRepository(database, h.clock),
    clock: h.clock,
    reporting: createReportingRepository(database, h.clock),
    inspect: createPilotInspector({
      clock: h.clock,
      discovery,
      data,
      mailboxes: priorSetup?.mailboxes,
      senders: priorSetup?.senders,
      email: priorSetup?.email,
      authority: priorSetup?.authority,
      googleCalendar: priorSetup?.googleCalendar,
      microsoftCalendar: priorSetup?.microsoftCalendar,
    }),
  });
  const plan: PilotPlan = {
    paymentActionId: s.action.id,
    goal: "Qualified steel quotation requests",
    baseline: [
      {
        metric: "rfqs",
        value: 0,
        unit: "distinct purchasing needs",
        evidence: "fixture:baseline-register",
      },
    ],
    criteria: [
      {
        metric: "rfqs",
        comparison: "at_least",
        target: 1,
        unit: "distinct purchasing needs",
      },
    ],
    scope: "Pune public steel discovery",
    startsAt: h.clock.now().toISOString(),
    endsAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
    capabilities: ["discovery"],
    emailActions: [],
    senderId: null,
    mailboxId: null,
    whatsAppConnectionId: null,
    calendarId: null,
    calendarConnectionId: null,
    calendarProvider: null,
    currency: "INR",
    cashLimitMinor: "20",
    spendLimitMinor: "20",
    timeLimitSeconds: 60,
    ceilings: {
      discovery: {
        cashMinor: "10",
        spendMinor: "8",
        seconds: 30,
        globalSpendInrMicros: null,
        evidence: "fixture:approved-worst-case-provider-and-staff-bound",
      },
      automation: null,
      mailbox: null,
      calendar: null,
    },
    approvalEvidence: "fixture:actual-founder-input",
    ...limits,
    ...priorSetup?.plan,
  };
  const p = await pilots.prepare(s.f.owner, bid, {
    requestKey: randomUUID(),
    plan,
  });
  await pilots.approve(s.f.owner, bid, {
    pilotId: p.id,
    requestKey: randomUUID(),
  });
  return {
    ...s,
    pilots,
    plan,
    pilot: p,
    queued,
    searches,
    discovery,
    data,
    costs,
    setGlobal,
    addRetentionBusiness: (businessId: string) => {
      retentionBusinessIds.add(businessId);
      retentionVersion++;
    },
    withdrawRetention: () => {
      retentionAvailable = false;
    },
    request: () => ({
      markets: ["Pune"],
      publicOffering: "Steel",
      confirmPublicQuery: true,
      budget: 2,
      requestKey: randomUUID(),
    }),
  };
}
