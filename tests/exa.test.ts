import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createHarness } from "./support/harness";
import { createDiscoveryApplication } from "../src/application/discovery";
import { createDiscoveryRepository } from "../src/db/discovery-repository";
import { runtimeDatabase } from "../src/db/runtime";
import {
  discoveryPolicySchema,
  discoveryWorkspaceSchema,
  type DiscoveryWork,
} from "../src/models/discovery";
import { createExaRetrieval } from "../src/discovery/exa";
import { configuredExaRetrieval } from "../src/discovery/configuration";
import { createDiscoveryHttp } from "../src/http/discovery";
import type { DiscoveryProvider, StopReason } from "../src/models/discovery";
import { createDiscoverySetup } from "../src/application/discovery-setup";

import {
  exaScope as scope,
  exaActivation as activation,
  exaPolicy as exa,
} from "./support/exa";
const policy = {
  adapterId: "exa-search-contents-v1",
  activeMarkets: ["New Jersey, United States"],
  coverage: [{ market: "New Jersey, United States", source: "public_web" }],
  allowanceUnit: "fixture units",
  maxRunBudget: 30,
  searchUnits: 2,
  reviewUnits: 1,
  concurrency: 2,
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
  exa,
};
const url = "https://fabricator.example/about";
const excerpt = "We fabricate galvanized steel sheet to ASTM A653.";

describe("Exa through the discovery application and real persistence", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  const outbound: { url: string; body: unknown }[] = [];
  const queued: DiscoveryWork[] = [];
  const failures: { code: StopReason }[] = [];
  let http: (
    endpoint: string,
    body: unknown,
    signal: AbortSignal,
  ) => Promise<Response>;
  const transport: typeof fetch = async (endpoint, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    outbound.push({ url: String(endpoint), body });
    if (!init?.signal) throw new Error("Missing cancellation");
    return http(String(endpoint), body, init.signal);
  };
  const review = async () => ({
    relevant: true,
    reason: "Fabricates the specified sheet",
    evidenceQuote: "fabricate galvanized steel sheet to ASTM A653",
    uncertainty: "Purchase timing and contact are unknown",
    contacts: [],
    company: null,
    request: null,
  });
  function app(
    retrieval = createExaRetrieval({
      activation,
      apiKey: "fixture-http-key",
      fetch: transport,
      clock: harness.clock,
    }),
    reviewer: DiscoveryProvider["review"] = review,
  ) {
    return createDiscoveryApplication({
      authenticate: harness.authenticate,
      authenticateForWork: harness.access.authenticateForWork,
      authenticateWork: harness.access.authenticateWork,
      repository: createDiscoveryRepository(
        runtimeDatabase(harness.runtime),
        harness.clock,
      ),
      clock: harness.clock,
      provider: { ...retrieval, review: reviewer },
      reportFailure: (diagnostic) => failures.push(diagnostic),
      queue: {
        async enqueue(work) {
          queued.push(work);
        },
      },
    });
  }
  beforeAll(async () => {
    harness = await createHarness();
  });
  afterAll(async () => {
    await harness?.close();
  });
  beforeEach(() => {
    queued.length = 0;
    outbound.length = 0;
    failures.length = 0;
    harness.clock.set("2026-11-06T09:00:00Z");
    http = async (endpoint) =>
      Response.json(
        endpoint.endsWith("/search")
          ? {
              results: [
                {
                  title: "Hudson Fabrication",
                  url,
                  publishedDate: "2026-11-01T00:00:00Z",
                  author: "discard-author",
                  entities: ["discard-enrichment"],
                },
              ],
            }
          : {
              results: [
                {
                  title: "Hudson Fabrication",
                  url,
                  text: excerpt,
                  publishedDate: "2026-11-01T00:00:00Z",
                  author: "discard-author",
                },
              ],
              statuses: [{ id: url, status: "success", source: "crawled" }],
            },
      );
  });
  async function setup(overrides: Partial<typeof exa> = {}) {
    const owner = await harness.signIn(
      `exa-${crypto.randomUUID()}@example.com`,
    );
    const business = await harness.application.createBusiness(owner, {
      name: "Steel",
      offering: "PRIVATE-CATALOGUE-PRICE-991",
      homeMarket: "",
      website: "",
    });
    const configuration = {
      offering: "PRIVATE-CATALOGUE-PRICE-991",
      specifications: "PRIVATE-MAIL-CANARY",
      minimumOrder: "PRIVATE-PRICE-CANARY",
      deliveryConstraints: "",
      serviceConstraints: "",
      address: {
        street: "PRIVATE-STREET",
        locality: "Newark",
        region: "New Jersey",
        postalCode: "",
        country: "United States",
      },
      homeMarket: policy.activeMarkets[0],
      homeMarketConfirmed: true,
      additionalMarkets: [],
      buyersReviewed: true,
      buyerCategories: [
        {
          label: "Fabricators",
          identity: "organization" as const,
          use: "business_end_user" as const,
          requiresBuyingRequest: false,
        },
      ],
      exclusions: ["PRIVATE-EXCLUSION"],
    };
    await harness.application.saveConfiguration(
      owner,
      business.id,
      configuration,
    );
    await harness.admin.query(
      "insert into discovery_configuration (business_id, policy) values ($1,$2)",
      [
        business.id,
        discoveryPolicySchema.parse({
          ...policy,
          exa: { ...exa, ...overrides },
        }),
      ],
    );
    return { owner, business, configuration };
  }
  const request = (budget = 8) => ({
    markets: policy.activeMarkets,
    publicOffering: exa.publicOfferings[0],
    confirmPublicQuery: true,
    budget,
    requestKey: crypto.randomUUID(),
  });
  it("uses Auto and shortlisted typed Contents, retains sourced evidence through the shared UI contract and excludes private query fields", async () => {
    const { owner, business } = await setup();
    const application = app();
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "completed",
    });
    const state = await application.workspace(owner, business.id);
    expect(discoveryWorkspaceSchema.safeParse(state).success).toBe(true);
    expect(outbound).toEqual([
      {
        url: "https://api.exa.ai/search",
        body: {
          query:
            "Galvanized steel sheets | Fabricators | New Jersey, United States",
          type: "auto",
          numResults: 3,
        },
      },
      {
        url: "https://api.exa.ai/contents",
        body: {
          urls: [url],
          text: { maxCharacters: 1000 },
          maxAgeHours: 0,
          livecrawlTimeout: 5000,
        },
      },
    ]);
    expect(JSON.stringify(outbound)).not.toMatch(
      /PRIVATE|discard|businessId|userId|sessionId/,
    );
    expect(
      state.runs[0].usage.map((u) => [u.kind, u.units, u.outcome]),
    ).toEqual([
      ["search", 2, "succeeded"],
      ["contents", 1, "succeeded"],
      ["review", 1, "succeeded"],
    ]);
    expect(state.prospects[0]).toMatchObject({
      relationship: "potential_buyer",
      evidence: [
        {
          url,
          checkedAt: "2026-11-06T09:00:00.000Z",
          retrieval: {
            provider: "exa",
            scopeRef: scope,
            contentType: "text",
            publishedAt: "2026-11-01T00:00:00Z",
            contentSource: "crawled",
          },
        },
      ],
    });
    expect(JSON.stringify(state.prospects)).not.toMatch(
      /discard|fixture-http-key/,
    );
    expect(harness.invitations.sent).toEqual([]);
  });
  it("rejects unapproved public phrases before queueing or spending and shows an actionable setup state for unapproved categories", async () => {
    const { owner, business } = await setup();
    const application = app();
    for (const publicOffering of [
      "PRIVATE-CATALOGUE-PRICE-991",
      "Mira Shah",
      "mira@fabricator.example",
    ]) {
      await expect(
        application.start(owner, business.id, { ...request(), publicOffering }),
      ).rejects.toMatchObject({ code: "DISCOVERY_SCOPE_INVALID" });
    }
    expect(queued).toEqual([]);
    expect(outbound).toEqual([]);
    expect((await application.workspace(owner, business.id)).runs).toEqual([]);
  });
  it("uses Lite only for an operator-focused domain lookup and requests only highlights on its shortlist", async () => {
    const { owner, business } = await setup({
      focusedDomains: ["fabricator.example"],
      contentsType: "highlights",
    });
    const normal = http;
    http = async (endpoint, body, signal) =>
      endpoint.endsWith("/search")
        ? normal(endpoint, body, signal)
        : Response.json({
            results: [
              {
                url,
                highlights: [excerpt],
                summary: "discard-summary",
                text: "discard-text",
              },
            ],
            statuses: [{ id: url, status: "success", source: "crawled" }],
          });
    const application = app();
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "completed",
    });
    expect(outbound.map((call) => call.body)).toEqual([
      {
        query:
          "Galvanized steel sheets | Fabricators | New Jersey, United States",
        type: "lite",
        numResults: 3,
        includeDomains: ["fabricator.example"],
      },
      {
        urls: [url],
        highlights: { maxCharacters: 1000 },
        maxAgeHours: 0,
        livecrawlTimeout: 5000,
      },
    ]);
    expect(
      (await application.workspace(owner, business.id)).prospects[0].evidence[0]
        .retrieval?.contentType,
    ).toBe("highlights");
  });
  it("never retrieves URLs outside the bounded shortlist, even when search returns more valid candidates", async () => {
    const { owner, business } = await setup();
    const normal = http;
    http = async (endpoint, body, signal) =>
      endpoint.endsWith("/search")
        ? Response.json({
            results: [
              { title: "Hudson Fabrication", url },
              { title: "Other", url: "https://other.example/" },
              { title: "Third", url: "https://third.example/" },
            ],
          })
        : normal(endpoint, body, signal);
    const application = app();
    await application.start(owner, business.id, request());
    await application.execute(queued[0]);
    const state = await application.workspace(owner, business.id);
    expect(outbound).toHaveLength(2);
    expect(state.prospects).toHaveLength(1);
    expect(state.runs[0].consolidation.rawResults).toBe(3);
    expect(state.runs[0].used).toBe(4);
  });
  it("keeps production gated for absent or insufficient executed scope, quote, credentials, capability limits and the live switch", async () => {
    const { owner, business } = await setup();
    for (const environment of [
      {},
      { EXA_LIVE_ENABLED: "true", OPERATOR_EXA_API_KEY: "sensitive-key" },
      {
        EXA_LIVE_ENABLED: "false",
        OPERATOR_EXA_API_KEY: "sensitive-key",
        EXA_ACTIVATION_JSON: JSON.stringify(activation),
      },
      ...[
        "executed",
        "quoteRef",
        "accountLimitsRef",
        "issue2CompletionRef",
      ].map((field) => ({
        EXA_LIVE_ENABLED: "true",
        OPERATOR_EXA_API_KEY: "sensitive-key",
        EXA_ACTIVATION_JSON: JSON.stringify({
          ...activation,
          [field]: undefined,
        }),
      })),
      {
        EXA_LIVE_ENABLED: "true",
        OPERATOR_EXA_API_KEY: "sensitive-key",
        EXA_ACTIVATION_JSON: JSON.stringify({
          ...activation,
          permissions: { ...activation.permissions, customerExport: false },
        }),
      },
    ]) {
      const application = app(
        configuredExaRetrieval({ NODE_ENV: "test", ...environment }),
      );
      expect(
        (await application.workspace(owner, business.id)).setup.join(" "),
      ).toContain("Exa is disabled");
      await expect(
        application.start(owner, business.id, request()),
      ).rejects.toMatchObject({ code: "DISCOVERY_SETUP_REQUIRED" });
    }
    expect(outbound).toEqual([]);
    expect(queued).toEqual([]);
  });
  it.each([
    [400, "provider_permission_denied"],
    [401, "provider_permission_denied"],
    [402, "provider_permission_denied"],
    [403, "provider_permission_denied"],
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
    [504, "provider_unavailable"],
  ])(
    "classifies HTTP %s without leaking provider errors or retrying automatically",
    async (status, outcome) => {
      const { owner, business } = await setup();
      http = async () =>
        Response.json(
          {
            error: "sensitive-key PRIVATE-MAIL-CANARY",
            requestId: "secret-provider-payload",
          },
          { status, headers: { "retry-after": "100" } },
        );
      const application = app();
      await application.start(owner, business.id, request());
      expect(await application.execute(queued[0])).toEqual({ outcome });
      const state = await application.workspace(owner, business.id);
      expect(state.runs[0]).toMatchObject({
        used: 2,
        consumed: 2,
        reserved: 0,
        prospects: [],
      });
      expect(outbound).toHaveLength(1);
      expect(JSON.stringify({ runs: state.runs, failures })).not.toMatch(
        /sensitive-key|secret-provider-payload/,
      );
    },
  );
  it.each([
    [
      "unsafe URL",
      { results: [{ title: "Unsafe", url: "https://127.0.0.1/private" }] },
    ],
    [
      "malformed date",
      { results: [{ title: "Bad date", url, publishedDate: "yesterday" }] },
    ],
    [
      "result cap",
      {
        results: Array.from({ length: 4 }, () => ({ title: "Overflow", url })),
      },
    ],
    ["malformed body", { results: "sensitive-invalid-data" }],
  ])(
    "rejects %s before content retrieval or persistence",
    async (_label, body) => {
      const { owner, business } = await setup();
      http = async () => Response.json(body);
      const application = app();
      await application.start(owner, business.id, request());
      expect(await application.execute(queued[0])).toEqual({
        outcome: "invalid_provider_response",
      });
      expect(outbound).toHaveLength(1);
      expect(
        (await application.workspace(owner, business.id)).prospects,
      ).toEqual([]);
    },
  );
  it.each([
    [
      "URL status error",
      {
        results: [],
        statuses: [
          { id: url, status: "error", error: { tag: "CRAWL_TIMEOUT" } },
        ],
      },
      "provider_unavailable",
    ],
    [
      "unrequested URL",
      {
        results: [{ url: "https://other.example/", text: excerpt }],
        statuses: [{ id: url, status: "success" }],
      },
      "invalid_provider_response",
    ],
    [
      "missing statuses",
      { results: [{ url, text: excerpt }] },
      "invalid_provider_response",
    ],
    [
      "oversized excerpt",
      {
        results: [{ url, text: "X".repeat(1001) }],
        statuses: [{ id: url, status: "success" }],
      },
      "invalid_provider_response",
    ],
  ])(
    "does not treat HTTP 200 Contents %s as usable evidence",
    async (_label, body, outcome) => {
      const { owner, business } = await setup();
      const normal = http;
      http = async (endpoint, request, signal) =>
        endpoint.endsWith("/contents")
          ? Response.json(body)
          : normal(endpoint, request, signal);
      const application = app();
      await application.start(owner, business.id, request());
      expect(await application.execute(queued[0])).toEqual({ outcome });
      const state = await application.workspace(owner, business.id);
      expect(state.prospects).toEqual([]);
      expect(state.runs[0].used).toBe(3);
      expect(outbound).toHaveLength(2);
    },
  );
  it("retains uncertain usage, reuses successful Search on explicit resume and enforces the total persisted retry cap", async () => {
    const { owner, business } = await setup();
    const normal = http;
    http = async (endpoint, body, signal) => {
      if (endpoint.endsWith("/contents"))
        throw new Error("sensitive-transport-timeout");
      return normal(endpoint, body, signal);
    };
    const application = app();
    const started = await application.start(owner, business.id, request(20));
    expect(await application.execute(queued[0])).toEqual({
      outcome: "provider_uncertain",
    });
    for (let attempt = 0; attempt <= 1; attempt++) {
      await application.resume(owner, business.id, {
        runId: started.id,
        expectedAttempt: attempt,
        requestKey: crypto.randomUUID(),
        confirmResume: true,
      });
      expect(await application.execute(queued.at(-1))).toEqual({
        outcome: attempt === 0 ? "provider_uncertain" : "budget_exhausted",
      });
    }
    const state = await application.workspace(owner, business.id);
    expect(state.runs[0]).toMatchObject({
      used: 4,
      consumed: 4,
      reserved: 0,
      attempt: 2,
    });
    expect(state.runs[0].usage.map((u) => u.outcome)).toEqual([
      "succeeded",
      "uncertain",
      "uncertain",
    ]);
    expect(outbound.map((call) => call.url)).toEqual([
      "https://api.exa.ai/search",
      "https://api.exa.ai/contents",
      "https://api.exa.ai/contents",
    ]);
    expect(await application.execute(queued[0])).toEqual({
      outcome: "authorization_revoked",
    });
    expect(outbound).toHaveLength(3);
  });
  it("shares the call cap across competing searches without overspending the run allowance", async () => {
    const { owner, business, configuration } = await setup({
      maxCalls: 1,
      buyerCategories: ["Fabricators", "Wholesalers"],
    });
    const application = app();
    await harness.application.saveConfiguration(owner, business.id, {
      ...configuration,
      buyerCategories: [
        ...configuration.buyerCategories,
        { ...configuration.buyerCategories[0], label: "Wholesalers" },
      ],
    });
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "budget_exhausted",
    });
    const state = await application.workspace(owner, business.id);
    expect(state.runs[0]).toMatchObject({
      used: 2,
      reserved: 0,
      prospects: [],
    });
    expect(outbound).toHaveLength(1);
  });
  it("aborts and joins accepted Contents on host interruption, retaining the reservation as uncertain", async () => {
    const { owner, business } = await setup();
    const normal = http;
    let accepted!: () => void;
    const arrived = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    let settled = false;
    http = async (endpoint, body, signal) => {
      if (endpoint.endsWith("/search")) return normal(endpoint, body, signal);
      accepted();
      try {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      } finally {
        settled = true;
      }
      return Response.json({});
    };
    const application = app();
    await application.start(owner, business.id, request());
    const controller = new AbortController();
    const running = application.execute(queued[0], {
      signal: controller.signal,
    });
    await arrived;
    controller.abort();
    expect(await running).toEqual({ outcome: "interrupted" });
    expect(settled).toBe(true);
    const state = await application.workspace(owner, business.id);
    expect(state.runs[0].usage.map((u) => u.outcome)).toEqual([
      "succeeded",
      "uncertain",
    ]);
    expect(state.runs[0]).toMatchObject({
      used: 3,
      reserved: 0,
      prospects: [],
    });
    expect(outbound).toHaveLength(2);
  });
  it("treats an adapter deadline as uncertain without retrying or inventing successful evidence", async () => {
    const { owner, business } = await setup({ requestTimeoutMs: 100 });
    http = async (_endpoint, _body, signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
      return Response.json({});
    };
    const application = app();
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "provider_uncertain",
    });
    const state = await application.workspace(owner, business.id);
    expect(state.runs[0]).toMatchObject({
      consumed: 2,
      reserved: 0,
      prospects: [],
    });
    expect(outbound).toHaveLength(1);
  });
  it("enforces Business, current session/MFA and persisted queued scope before outbound Exa calls", async () => {
    const first = await setup();
    const second = await setup();
    const application = app();
    const api = createDiscoveryHttp({
      application,
      origin: "http://localhost:3000",
      reportFailure: (diagnostic) => harness.diagnostics.push(diagnostic),
    });
    expect(
      (
        await api.get(
          new Request("http://localhost:3000/discovery", {
            headers: second.owner,
          }),
          first.business.id,
        )
      ).status,
    ).toBe(404);
    await application.start(first.owner, first.business.id, request());
    const work = queued[0];
    expect(
      await application.execute({ ...work, businessId: second.business.id }),
    ).toEqual({ outcome: "authorization_revoked" });
    await harness.signOut(first.owner);
    expect(await application.execute(work)).toEqual({
      outcome: "authorization_revoked",
    });
    await application.start(second.owner, second.business.id, request());
    harness.clock.set("2026-11-06T21:00:01Z");
    expect(await application.execute(queued.at(-1))).toEqual({
      outcome: "authorization_revoked",
    });
    expect(outbound).toEqual([]);
  });
  it("stops before Contents when the current session is revoked after Search was accepted", async () => {
    const { owner, business } = await setup();
    const application = app();
    const normal = http;
    http = async (endpoint, body, signal) => {
      const response = await normal(endpoint, body, signal);
      await harness.signOut(owner);
      return response;
    };
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "authorization_revoked",
    });
    expect(outbound).toHaveLength(1);
  });
  it("requires an explicit discovery operator grant, current recent MFA and Business integration authority to provision policy", async () => {
    const { owner, business } = await setup();
    const second = await setup();
    const operator = await harness.access.authenticateForWork(owner);
    const provision = createDiscoverySetup(
      runtimeDatabase(harness.admin),
      harness.clock,
    );
    const input = { businessId: business.id, operator, policy };
    await expect(provision(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await harness.admin.query(
      "insert into platform_operator (user_id, discovery) values ($1,true)",
      [operator.userId],
    );
    await expect(
      provision({ ...input, businessId: second.business.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      provision({
        ...input,
        operator: { ...operator, sessionId: "untrusted-session" },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const changed = { ...policy, exa: { ...exa, maxCalls: 5 } };
    await provision({ ...input, policy: changed });
    expect(
      (await app().workspace(owner, business.id)).policy?.exa?.maxCalls,
    ).toBe(5);
    harness.clock.set("2026-11-06T09:15:01Z");
    await expect(provision(input)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    expect(
      (await app().workspace(owner, business.id)).policy?.exa?.maxCalls,
    ).toBe(5);
  });
  it("does not establish an open buying request from cached excerpts even with a dated open marker", async () => {
    const { owner, business } = await setup({ maxAgeHours: -1 });
    const normal = http;
    http = async (endpoint, body, signal) =>
      endpoint.endsWith("/search")
        ? normal(endpoint, body, signal)
        : Response.json({
            results: [
              {
                url,
                text: "We need galvanized steel sheet. Posted 2026-11-01. Status: open.",
              },
            ],
            statuses: [{ id: url, status: "success", source: "cached" }],
          });
    const application = app(undefined, async () => ({
      relevant: true,
      reason: "Explicit sheet need",
      evidenceQuote: "We need galvanized steel sheet.",
      uncertainty: "Cached source; present status unverified",
      contacts: [],
      company: null,
      request: {
        quote: "We need galvanized steel sheet.",
        publishedAt: "2026-11-01",
        dateQuote: "Posted 2026-11-01",
        status: "open",
        statusQuote: "Status: open",
      },
    }));
    await application.start(owner, business.id, request());
    await application.execute(queued[0]);
    const state = await application.workspace(owner, business.id);
    expect(state.counts.openBuyingRequests).toBe(0);
    expect(state.prospects[0].requestState).toBe("uncertain");
    expect(state.prospects[0].evidence[0].retrieval?.contentSource).toBe(
      "cached",
    );
  });
  it("honors the absolute execution deadline at the next reservation using the controlled clock", async () => {
    const { owner, business } = await setup();
    const normal = http;
    http = async (endpoint, body, signal) => {
      const result = await normal(endpoint, body, signal);
      harness.clock.set("2026-11-06T09:00:11Z");
      return result;
    };
    const application = app();
    await application.start(owner, business.id, request());
    expect(await application.execute(queued[0])).toEqual({
      outcome: "interrupted",
    });
    expect(outbound).toHaveLength(1);
    expect(
      (await application.workspace(owner, business.id)).runs[0],
    ).toMatchObject({ consumed: 2, prospects: [] });
  });
  it.each(["identical", "different"])(
    "deduplicates shortlist URLs before the cap with %s metadata",
    async (metadata) => {
      const { owner, business } = await setup({ maxContentsPerSearch: 2 });
      http = async (endpoint, body) => {
        if (endpoint.endsWith("/search"))
          return Response.json({
            results: [
              { title: "Hudson Fabrication", url },
              {
                title:
                  metadata === "identical"
                    ? "Hudson Fabrication"
                    : "Different title for the same page",
                url,
                ...(metadata === "different"
                  ? { publishedDate: "2026-11-01T00:00:00Z" }
                  : {}),
              },
              { title: "Other fabricator", url: "https://other.example/about" },
            ],
          });
        const selected = z.object({ urls: z.array(z.string()) }).parse(body)
          .urls[0];
        return Response.json({
          results: [{ url: selected, text: excerpt }],
          statuses: [{ id: selected, status: "success", source: "crawled" }],
        });
      };
      const application = app();
      await application.start(owner, business.id, request());
      expect(await application.execute(queued[0])).toEqual({
        outcome: "completed",
      });
      expect(
        outbound
          .filter((call) => call.url.endsWith("/contents"))
          .map((call) => call.body),
      ).toEqual([
        {
          urls: [url],
          text: { maxCharacters: 1000 },
          maxAgeHours: 0,
          livecrawlTimeout: 5000,
        },
        {
          urls: ["https://other.example/about"],
          text: { maxCharacters: 1000 },
          maxAgeHours: 0,
          livecrawlTimeout: 5000,
        },
      ]);
      expect(
        (await application.workspace(owner, business.id)).prospects,
      ).toHaveLength(2);
    },
  );
});
