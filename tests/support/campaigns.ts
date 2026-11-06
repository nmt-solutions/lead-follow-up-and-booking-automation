import type { createHarness } from "./harness";
import { createCampaignApplication } from "../../src/application/campaigns";
import { createCampaignRepository } from "../../src/db/campaign-repository";
import { createDiscoveryApplication } from "../../src/application/discovery";
import { createDiscoveryRepository } from "../../src/db/discovery-repository";
import { createInboxApplication } from "../../src/application/inbox";
import { createInboxRepository } from "../../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../../src/inbox/adapter";
import { runtimeDatabase } from "../../src/db/runtime";
import {
  mandatoryCampaignStops,
  type CampaignRevision,
} from "../../src/models/campaigns";
import {
  discoveryPolicySchema,
  type DiscoveryWork,
} from "../../src/models/discovery";
import { readySender } from "./senders";

export async function campaignFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  options: { multipleSources?: boolean; namedGeneral?: boolean } = {},
) {
  h.clock.set("2026-11-05T09:00:00Z");
  const owner = await h.signIn(`campaign-${crypto.randomUUID()}@example.com`);
  const business = await h.application.createBusiness(owner, {
    name: "Steel supplier",
    offering: "Steel",
    homeMarket: "",
    website: "",
  });
  await h.application.saveConfiguration(owner, business.id, {
    offering: "Galvanized steel",
    specifications: "ASTM A653",
    minimumOrder: "500 kg",
    deliveryConstraints: "150 miles",
    serviceConstraints: "Drawings for cutting",
    address: {
      street: "",
      locality: "Newark",
      region: "New Jersey",
      postalCode: "",
      country: "United States",
    },
    homeMarket: "New Jersey, United States",
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
  const policy = discoveryPolicySchema.parse({
    adapterId: "campaign-research-fixture",
    activeMarkets: ["New Jersey, United States"],
    coverage: [{ market: "New Jersey, United States", source: "public_web" }],
    allowanceUnit: "fixture units",
    maxRunBudget: 20,
    searchUnits: 1,
    reviewUnits: 1,
    concurrency: 1,
    maxResults: 3,
    deadlineMs: 10000,
    permissions: {
      retainEvidence: true,
      retainQueries: false,
      displayEvidence: true,
      exportEvidence: true,
      afterCancellation: true,
      privateAiContext: true,
    },
  });
  await h.admin.query(
    "insert into discovery_configuration(business_id,policy) values ($1,$2)",
    [business.id, policy],
  );
  const database = runtimeDatabase(h.runtime),
    queued: DiscoveryWork[] = [];
  let address = "purchasing@fabricator.example";
  const addresses = (url: string) =>
    options.multipleSources
      ? Array.from(
          { length: 3 },
          (_, i) => `${new URL(url).pathname.slice(1)}${i}@fabricator.example`,
        )
      : [address];
  const discovery = createDiscoveryApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    authenticateWork: h.access.authenticateWork,
    repository: createDiscoveryRepository(database, h.clock),
    clock: h.clock,
    queue: {
      async schedule() {
        throw new Error("Unexpected recurring research");
      },
      async enqueue(work) {
        queued.push(work);
      },
    },
    provider: {
      id: policy.adapterId,
      async search() {
        return (options.multipleSources ? ["about", "team"] : ["about"]).map(
          (path) => ({
            name: "Hudson Fabrication",
            market: "New Jersey, United States",
            url: `https://fabricator.example/${path}`,
            excerpt: `Hudson Fabrication: https://fabricator.example/. We fabricate galvanized steel. ${options.namedGeneral ? "Pat is owner. " : ""}${addresses(
              `https://fabricator.example/${path}`,
            )
              .map((a) => `Contact ${a}`)
              .join(". ")}`,
          }),
        );
      },
      async review(input) {
        return {
          relevant: true,
          reason: "Uses galvanized steel",
          evidenceQuote: "We fabricate galvanized steel",
          uncertainty: "Purchasing role and timing unconfirmed",
          company: options.multipleSources
            ? {
                name: "Hudson Fabrication",
                website: "https://fabricator.example/",
                quote: "Hudson Fabrication: https://fabricator.example/",
              }
            : null,
          request: null,
          contacts: addresses(input.source.url).map((address) => ({
            name: options.namedGeneral ? "Pat" : null,
            nameQuote: options.namedGeneral ? "Pat is owner" : null,
            roleEvidence: options.namedGeneral
              ? { role: "owner", quote: "Pat is owner" }
              : null,
            route: {
              kind: "email",
              value: address,
              quote: `Contact ${address}`,
            },
          })),
        };
      },
    },
  });
  async function discover(nextAddress = address) {
    address = nextAddress;
    await discovery.start(owner, business.id, {
      markets: ["New Jersey, United States"],
      publicOffering: "Galvanized steel",
      confirmPublicQuery: true,
      budget: 4,
      requestKey: crypto.randomUUID(),
    });
    await discovery.execute(queued.shift());
  }
  await discover();
  const inbox = createInboxApplication({
    authenticate: h.authenticate,
    repository: createInboxRepository(database),
    clock: h.clock,
    adapter: normalizedInquiryAdapter,
  });
  const connection = await inbox.addConnection(owner, business.id, {
    label: "Reply capture fixture",
    channel: "email",
    conversationRefs: [],
  });
  const sender = await readySender(h, owner, business.id, connection.id, {
    purpose: "dedicated_outreach",
    uses: ["first_contact"],
  });
  const newApplication = () =>
    createCampaignApplication({
      authenticate: h.access.authenticateForWork,
      repository: createCampaignRepository(database, h.clock),
    });
  const app = newApplication(),
    state = await app.workspace(owner, business.id);
  const campaignId = crypto.randomUUID();
  return {
    owner,
    business,
    app,
    newApplication,
    sender,
    queued,
    inbox,
    discover,
    ref: (r: CampaignRevision) => ({
      revisionId: r.id,
      payloadHash: r.payloadHash,
    }),
    draft: () => ({
      requestKey: crypto.randomUUID(),
      campaignId,
      expectedVersion: 0,
      name: "Fabricator introduction",
      channel: "email",
      senderIdentityId: sender.identity.id,
      senderVersion: sender.identity.version,
      recipients: state.candidates.map((c) => ({
        prospectId: c.prospectId,
        contactId: c.contactId,
        evidenceKey: c.evidenceKey,
      })),
      steps: [
        {
          subject: "Steel supply",
          body: "We supply galvanized steel. Is this relevant to your business?",
          delayMinutes: 0,
        },
        {
          subject: "Steel supply follow-up",
          body: "Would you like our product specification?",
          delayMinutes: 2880,
        },
      ],
      maxAttempts: 2,
      stopConditions: mandatoryCampaignStops,
      note: "Manual factual draft for review",
    }),
  };
}
