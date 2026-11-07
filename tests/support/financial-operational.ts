import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import type { subscriptionFixture } from "./subscription";
import { runtimeDatabase } from "../../src/db/runtime";
import { createDiscoveryApplication } from "../../src/application/discovery";
import { createDiscoveryRepository } from "../../src/db/discovery-repository";
import type { DiscoveryWork } from "../../src/models/discovery";
import type { ScheduleWork } from "../../src/models/discovery-schedules";
export async function financialResearch(
  h: Awaited<ReturnType<typeof createHarness>>,
  f: Awaited<ReturnType<typeof subscriptionFixture>>,
) {
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
    repository: createDiscoveryRepository(runtimeDatabase(h.runtime), h.clock),
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
