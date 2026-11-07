import {
  prepareDiscoveryCapacity,
  secureDiscoveryCapacity,
} from "../src/db/discovery-capacity-security";
import { createDiscoveryCapacityHttp } from "../src/http/discovery-capacity";
import { scheduleWorkSchema } from "../src/models/discovery-schedules";
import { subscriptionFixture } from "./support/subscription";
import { deterministicPayments } from "./support/payment-gateway";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { createDiscoveryApplication } from "../src/application/discovery";
import { createDiscoveryRepository } from "../src/db/discovery-repository";
import { createCapacityDiscoveryQueue } from "../src/discovery/capacity";
import { configuredDiscoveryQueue } from "../src/discovery/configuration";
import { configure as configureTrigger } from "@trigger.dev/sdk";
import { createServer } from "node:http";
import { z } from "zod";
import {
  capacityDeclarationSchema,
  type CapacityPolicy,
} from "../src/models/discovery-capacity";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createDiscoveryCapacityApplication } from "../src/application/discovery-capacity";
import { createDiscoveryCapacityRepository } from "../src/db/discovery-capacity-repository";

describe("Discovery capacity at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    const now = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() now",
    );
    h.clock.set(now.rows[0].now.toISOString());
  });
  afterEach(async () => h?.close());
  function capacity() {
    return createDiscoveryCapacityApplication({
      authenticate: h.access.authenticateForWork,
      repository: createDiscoveryCapacityRepository(runtimeDatabase(h.runtime)),
    });
  }
  async function waitForDatabaseLock(table: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const waiting = await h.admin.query<{ waiting: boolean }>(
        "select exists(select 1 from pg_stat_activity where usename='app_runtime' and wait_event_type='Lock' and query ilike $1) waiting",
        [`%${table}%`],
      );
      if (waiting.rows[0].waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      "Expected restricted query to reach the held database lock",
    );
  }
  const policy = () => ({
    allocationKey: "56b966b7-0707-46ce-bdb8-7458d20c93ae",
    projectRef: "fixture-trigger-project",
    environmentId: "fixture-trigger-environment",
    deploymentRef: "fixture-reviewed-build",
    deploymentId: "fixture-reviewed-deployment",
    deploymentVersion: "20261107.1",
    providerEvidence: "fixture:approved-paid-environment-capacity",
    validUntil: new Date(h.clock.now().getTime() + 3600000).toISOString(),
    total: 3,
    pooled: 1,
    allocations: [],
    fallback: "wait",
    maxObservationAgeMs: 5000,
  });
  it("requires the discovery operator's current MFA and records finite attributable approval without activating defaults", async () => {
    const operator = await h.signIn("capacity-operator@example.com");
    const actor = await h.authenticate(operator);
    await expect(
      capacity().configure(operator, {
        requestKey: crypto.randomUUID(),
        expectedVersion: 0,
        policy: policy(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "insert into platform_operator(user_id,discovery) values($1,true)",
      [actor.userId],
    );
    const saved = await capacity().configure(operator, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      policy: policy(),
    });
    expect(saved).toMatchObject({
      version: 1,
      actorId: actor.userId,
      policy: { total: 3, pooled: 1, fallback: "wait" },
    });
    expect((await capacity().configuration(operator)).revisions).toHaveLength(
      1,
    );
    await verifyRuntimeRole(h.runtime);
    expect((await capacity().configuration(operator)).revisions[0].id).toBe(
      saved.id,
    );
  });
  async function purchased(
    reserved = true,
    capacityOptions: Partial<CapacityPolicy> = {},
    expiresAfterMs?: number,
    contractUnit = "concurrent discovery runs",
  ) {
    const f = await subscriptionFixture(h, {
      reservedCapacity: reserved
        ? {
            id: "reserved-one",
            label: "One concurrent discovery run",
            capacity: { quantity: 1, unit: contractUnit },
            prices: { INR: { monthlyMinor: 700, pilotMinor: 200 }, USD: null },
          }
        : undefined,
    });
    const actor = await h.authenticate(f.operator);
    await h.admin.query(
      "update platform_operator set discovery=true where user_id=$1",
      [actor.userId],
    );
    const trustedAt = await h.admin.query<{ at: Date }>(
      "select clock_timestamp() at",
    );
    const approved = await capacity().configure(f.operator, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      policy: {
        ...policy(),
        ...capacityOptions,
        ...(expiresAfterMs
          ? {
              validUntil: new Date(
                trustedAt.rows[0].at.getTime() + expiresAfterMs,
              ).toISOString(),
            }
          : {}),
        allocations: reserved
          ? [
              {
                businessId: f.business.id,
                offerId: "fixture",
                reservedCapacityId: "reserved-one",
                quantity: 1,
                unit: contractUnit,
                concurrentRuns: 1,
                mappingEvidence:
                  "fixture:approved-contract-to-concurrency-allocation",
              },
            ]
          : [],
      },
    });
    const gateway = deterministicPayments(h.clock);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway,
    });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: crypto.randomUUID(),
    });
    expect(
      (await payments.workspace(f.owner, f.business.id)).effectiveContract,
    ).toBeNull();
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    gateway.confirm(action.operationKey);
    await payments.recover();
    expect(
      (await payments.workspace(f.owner, f.business.id)).effectiveContract,
    ).toMatchObject({ reservedCapacityId: reserved ? "reserved-one" : null });
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
      "insert into discovery_configuration(business_id,policy) values($1,$2)",
      [
        f.business.id,
        {
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
        },
      ],
    );
    const behavior: {
      unknown: boolean;
      unavailable: boolean;
      total: number;
      baseTotal: number;
      paused: boolean;
      queuePaused: boolean;
      delayMs: number;
      afterObserve?: () => Promise<void>;
      afterSearch?: () => void;
      nativeDeploymentId: string;
    } = {
      unknown: false,
      unavailable: false,
      total: 3,
      baseTotal: 3,
      paused: false,
      queuePaused: false,
      delayMs: 0,
      nativeDeploymentId: "fixture-reviewed-deployment",
    };
    const accepted = new Map<string, string>();
    const queued: {
      task: string;
      work: unknown;
      options: { concurrency?: string[]; idempotencyKey?: string };
    }[] = [];
    const deployment = {
      policy: capacityDeclarationSchema.strip().parse(approved.policy),
    };
    const execution = {
      project: { ref: approved.policy.projectRef },
      environment: { id: approved.policy.environmentId },
      deployment: {
        id: approved.policy.deploymentId,
        version: approved.policy.deploymentVersion,
        externalId: approved.policy.deploymentRef,
      },
    };
    const queue = createCapacityDiscoveryQueue({
      deployment,
      execution,
      repository: createDiscoveryCapacityRepository(runtimeDatabase(h.runtime)),
      native: {
        key: async (value) => value,
        deployment: async () => ({
          id: behavior.nativeDeploymentId,
          version: "20261107.1",
          externalId: "fixture-reviewed-build",
          status: "DEPLOYED",
        }),
        queue: async () => ({
          name: "bounded-prospect-discovery",
          type: "task",
          version: "V2",
          concurrencyLimit: null,
          paused: behavior.queuePaused,
        }),
        retrieve: async (name) => {
          if (behavior.unavailable) throw new Error("private native failure");
          if (behavior.delayMs)
            await new Promise((resolve) =>
              setTimeout(resolve, behavior.delayMs),
            );
          await behavior.afterObserve?.();
          return {
            name,
            paused: behavior.paused,
            total: {
              current:
                name.includes("provider") ||
                name === "task/bounded-prospect-discovery"
                  ? behavior.total
                  : 1,
              base:
                name.includes("provider") ||
                name === "task/bounded-prospect-discovery"
                  ? behavior.baseTotal
                  : 1,
              override: null,
            },
            perKey: { current: null },
            running: 0,
            queued: 0,
          };
        },
        trigger: async (task, work, options) => {
          const key = options.idempotencyKey;
          const payload = JSON.stringify(work);
          if (accepted.has(key) && accepted.get(key) !== payload)
            throw new Error("Native idempotency payload changed");
          if (!accepted.has(key)) {
            accepted.set(key, payload);
            queued.push({ task, work, options });
          }
          if (behavior.unknown)
            throw new Error("Native timeout after acceptance");
        },
      },
    });
    const searches: string[] = [];
    const application = (
      queue: ReturnType<typeof createCapacityDiscoveryQueue>,
    ) =>
      createDiscoveryApplication({
        authenticate: h.authenticate,
        authenticateForWork: h.access.authenticateForWork,
        authenticateWork: h.access.authenticateWork,
        repository: createDiscoveryRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        clock: h.clock,
        queue,
        requireCapacity: true,
        provider: {
          id: "fixture",
          search: async (input) => {
            searches.push(input.runId);
            behavior.afterSearch?.();
            return [
              {
                name: "Pune Fabricator",
                market: "Pune",
                url: "https://fabricator.example/about",
                excerpt: "We fabricate steel",
              },
            ];
          },
          review: async () => ({
            relevant: true,
            reason: "Fabricates steel",
            evidenceQuote: "fabricate steel",
            uncertainty: "Purchase timing unknown",
            request: null,
          }),
        },
      });
    const app = application(queue);
    const request = () => ({
      markets: ["Pune"],
      publicOffering: "Steel",
      confirmPublicQuery: true,
      budget: 2,
      requestKey: crypto.randomUUID(),
    });
    return {
      ...f,
      approved,
      deployment,
      execution,
      gateway,
      payments,
      queue,
      app,
      application,
      queued,
      searches,
      behavior,
      request,
    };
  }
  it("routes only a confirmed purchased reservation through the real queue adapter and worker to sourced results", async () => {
    const { app, owner, business, approved, gateway, queued, searches } =
      await purchased();
    const request = {
      markets: ["Pune"],
      publicOffering: "Steel",
      confirmPublicQuery: true,
      budget: 2,
      requestKey: crypto.randomUUID(),
    };
    const run = await app.start(owner, business.id, request);
    await app.start(owner, business.id, request);
    expect(queued).toHaveLength(1);
    expect(queued[0].options.concurrency).toEqual([
      `discovery-provider-${approved.policy.allocationKey}`,
      `discovery-reserved-${approved.policy.allocationKey}-${business.id}`,
    ]);
    expect(queued[0].options.idempotencyKey).toMatch(
      new RegExp(`^discovery-${run.id}-`),
    );
    await app.execute(queued[0].work, {
      durable: { runId: "fixture-native-run", number: 1 },
    });
    const state = await app.workspace(owner, business.id);
    expect(state.capacity).toMatchObject({
      mode: "reserved",
      status: "available",
      slots: 1,
    });
    expect(state.runs[0]).toMatchObject({
      status: "completed",
      used: 2,
      prospects: [{ name: "Pune Fabricator" }],
    });
    await app.execute(queued[0].work, {
      durable: { runId: "fixture-native-run", number: 2 },
    });
    expect(searches).toEqual([run.id]);
    expect(gateway.created).toHaveLength(1);
  });

  it("uses pooled execution without a reservation charge and preserves the same evidence, budget and Business isolation", async () => {
    const f = await purchased(false);
    await f.app.start(f.owner, f.business.id, { ...f.request(), budget: 1 });
    expect(f.queued[0].options.concurrency).toEqual([
      `discovery-provider-${f.approved.policy.allocationKey}`,
      `discovery-pooled-${f.approved.policy.allocationKey}`,
    ]);
    await f.app.execute(f.queued[0].work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      stopReason: "budget_exhausted",
      used: 1,
      prospects: [],
    });
    const foreign = await h.signIn("foreign-capacity@example.com");
    await expect(f.app.workspace(foreign, f.business.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    expect(
      f.gateway.created[0].snapshot.quote.initial.lines.map((l) => l.kind),
    ).toEqual(["subscription"]);
  });
  it("keeps an ambiguously accepted enqueue on the original global identity and never repeats discovery spend", async () => {
    const f = await purchased();
    const request = f.request();
    f.behavior.unknown = true;
    await expect(
      f.app.start(f.owner, f.business.id, request),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({ status: "queued", queueState: "pending", used: 0 });
    f.behavior.unknown = false;
    await f.app.recoverDispatches();
    await f.app.start(f.owner, f.business.id, request);
    expect(f.queued).toHaveLength(1);
    await f.app.execute(f.queued[0].work, {
      durable: { runId: "unknown-native", number: 1 },
    });
    await f.app.execute(f.queued[0].work, {
      durable: { runId: "unknown-native", number: 2 },
    });
    expect(f.searches).toHaveLength(1);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({ status: "completed", used: 2 });
  });
  it("refuses unknown or overridden aggregate capacity and recovers pending work without granting a new lane", async () => {
    const f = await purchased();
    const request = f.request();
    f.behavior.total = 4;
    await expect(
      f.app.start(f.owner, f.business.id, request),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(f.queued).toHaveLength(0);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).capacity,
    ).toMatchObject({ mode: "reserved", status: "unavailable" });
    f.behavior.total = 3;
    f.behavior.unavailable = true;
    await f.app.recoverDispatches();
    expect(f.queued).toHaveLength(0);
    f.behavior.unavailable = false;
    await f.app.recoverDispatches();
    expect(f.queued).toHaveLength(1);
    f.behavior.unavailable = true;
    await expect(f.app.execute(f.queued[0].work)).rejects.toThrow(
      "capacity is unavailable",
    );
    expect((await f.app.workspace(f.owner, f.business.id)).runs[0].used).toBe(
      0,
    );
    f.behavior.unavailable = false;
    await f.app.execute(f.queued[0].work);
    expect(f.searches).toHaveLength(1);
  });
  it("stops accepted work when its approved allocation changes and never falls back to pooled spend", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    await capacity().configure(f.operator, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 1,
      policy: { ...policy(), allocations: [] },
    });
    expect(await f.app.execute(f.queued[0].work)).toEqual({
      outcome: "configuration_changed",
    });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      stopReason: "configuration_changed",
      used: 0,
    });
    expect(f.searches).toEqual([]);
    expect(f.queued).toHaveLength(1);
  });
  it.each([false, true])(
    "requires an explicit new execution after reapproval without reviving old delivery (replace session: %s)",
    async (replaceSession) => {
      const f = await purchased();
      const run = await f.app.start(f.owner, f.business.id, {
        ...f.request(),
        budget: replaceSession ? 2 : 1,
      });
      const oldWork = f.queued[0].work;
      if (!replaceSession) await f.app.execute(oldWork);
      const approved = await capacity().configure(f.operator, {
        requestKey: crypto.randomUUID(),
        expectedVersion: 1,
        policy: f.approved.policy,
      });
      expect(await f.app.execute(oldWork)).toEqual({
        outcome: "configuration_changed",
      });
      if (replaceSession) await h.signOut(f.owner);
      const owner = replaceSession
        ? await h.signIn("tax-owner@example.com")
        : f.owner;
      const stopped = (await f.app.workspace(owner, f.business.id)).runs[0];
      const used = replaceSession ? 0 : 1;
      expect(stopped).toMatchObject({ id: run.id, status: "stopped", used });
      if (!replaceSession)
        await expect(
          f.app.approveAllowance(owner, f.business.id, {
            runId: run.id,
            requestKey: crypto.randomUUID(),
            expectedBudget: 1,
            budget: 2,
            confirmExtraUsage: true,
          }),
        ).resolves.toMatchObject({ id: run.id, status: "stopped" });
      const resume = {
        runId: run.id,
        expectedAttempt: stopped.attempt,
        requestKey: crypto.randomUUID(),
        confirmResume: true,
      };
      await expect(
        f.app.resume(owner, f.business.id, resume),
      ).resolves.toMatchObject({ id: run.id, status: "queued" });
      expect(f.queued).toHaveLength(2);
      expect(f.queued[1].work).toMatchObject({ capacityPolicyId: approved.id });
      expect(f.queued[1].options.idempotencyKey).not.toBe(
        f.queued[0].options.idempotencyKey,
      );
      await f.app.execute(oldWork);
      expect(
        (await f.app.workspace(owner, f.business.id)).runs[0],
      ).toMatchObject({ status: "queued", used });
      await f.app.execute(f.queued[1].work);
      await f.app.resume(owner, f.business.id, resume);
      expect(f.queued).toHaveLength(2);
      expect(f.searches).toEqual([run.id]);
      expect(
        (await f.app.workspace(owner, f.business.id)).runs[0],
      ).toMatchObject({
        status: "completed",
        used: 2,
        budget: 2,
        executionCapacity: { policyVersion: 2 },
      });
      expect(f.gateway.created).toHaveLength(1);
    },
  );
  it("rechecks the original actor after native observation instead of spending under a replacement session", async () => {
    const f = await purchased();
    let revoked = false;
    f.behavior.afterObserve = async () => {
      if (!revoked) {
        revoked = true;
        await h.signOut(f.owner);
      }
    };
    const request = f.request();
    await f.app.start(f.owner, f.business.id, request);
    expect(f.queued).toHaveLength(0);
    expect(f.searches).toEqual([]);
    const newOwner = await h.signIn("tax-owner@example.com");
    expect(
      (await f.app.workspace(newOwner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      stopReason: "authorization_revoked",
      used: 0,
    });
    await expect(
      f.app.start(newOwner, f.business.id, request),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("shows a slow native observation as stale and leaves original work pending without spending", async () => {
    const f = await purchased(true, { maxObservationAgeMs: 100 });
    f.behavior.delayMs = 150;
    await expect(
      f.app.start(f.owner, f.business.id, f.request()),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(f.queued).toHaveLength(0);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.capacity).toMatchObject({
      status: "stale",
      running: null,
      queued: null,
    });
    expect(state.runs[0]).toMatchObject({
      status: "queued",
      queueState: "pending",
      used: 0,
    });
  });

  it("routes a due saved search through the purchased allowance once and keeps its schedule identity", async () => {
    const f = await purchased();
    const due = new Date(h.clock.now().getTime() + 60000);
    await f.app.saveSchedule(f.owner, f.business.id, {
      scheduleId: crypto.randomUUID(),
      expectedRevision: 0,
      name: "Reserved fabricators",
      timeZone: "UTC",
      localTime: due.toISOString().slice(11, 16),
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      missed: "skip",
      overlap: "skip",
      dst: "compatible",
      search: f.request(),
      confirmRecurring: true,
    });
    const event = f.queued.find(
      (q) => q.task === "scheduled-prospect-discovery",
    )!;
    const scheduled = scheduleWorkSchema.parse(event.work);
    h.clock.set(scheduled.dueAt);
    expect(await f.app.dispatchScheduled(event.work)).toMatchObject({
      outcome: "queued",
    });
    await f.app.dispatchScheduled(event.work);
    const work = f.queued.filter(
      (q) => q.task === "bounded-prospect-discovery",
    );
    expect(work).toHaveLength(1);
    expect(work[0].options.concurrency).toEqual([
      `discovery-provider-${f.approved.policy.allocationKey}`,
      `discovery-reserved-${f.approved.policy.allocationKey}-${f.business.id}`,
    ]);
    await f.app.execute(work[0].work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "completed",
      executionCapacity: { mode: "reserved", slots: 1 },
      scheduledFor: scheduled.dueAt,
      prospects: [{ name: "Pune Fabricator" }],
    });
  });
  it("classifies a discovery-only operator as MFA-required and rejects stale configuration after serialization", async () => {
    const primary = await h.signIn("capacity-primary-only@example.com", false);
    const session = await h.auth.api.getSession({ headers: primary });
    await h.admin.query(
      "insert into platform_operator(user_id,discovery) values($1,true)",
      [session!.user.id],
    );
    expect(await h.access.status(primary)).toMatchObject({
      operator: true,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(capacity().configuration(primary)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const headers = await h.signIn("capacity-current@example.com");
    const actor = await h.authenticate(headers);
    await h.admin.query(
      "insert into platform_operator(user_id,discovery) values($1,true)",
      [actor.userId],
    );
    const lock = await h.admin.connect();
    await lock.query("begin");
    await lock.query(
      "select pg_advisory_xact_lock(hashtextextended('discovery-capacity',0))",
    );
    const pending = capacity().configure(headers, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      policy: policy(),
    });
    await h.admin.query(
      "update session set mfa_verified_at=clock_timestamp()-interval '16 minutes' where user_id=$1",
      [actor.userId],
    );
    await lock.query("commit");
    lock.release();
    await expect(pending).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("enforces separate runtime SELECT and INSERT grants and reapplies security without granting defaults", async () => {
    for (const table of [
      "discovery_capacity_policy",
      "discovery_capacity_binding",
    ]) {
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(
          `revoke ${privilege} on public.${table} from app_runtime`,
        );
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow(
          "capacity database security is incomplete",
        );
        await h.admin.query(
          `grant ${privilege} on public.${table} to app_runtime`,
        );
      }
    }
    await verifyRuntimeRole(h.runtime);
    for (const unsafeDefault of [
      "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC",
      "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC",
    ]) {
      await h.admin.query(unsafeDefault);
      await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      await prepareDiscoveryCapacity(h.admin);
      await secureDiscoveryCapacity(h.admin);
      await verifyRuntimeRole(h.runtime);
    }
    await verifyRuntimeRole(h.runtime);
    const operator = await h.signIn("capacity-invalid@example.com");
    const actor = await h.authenticate(operator);
    await h.admin.query(
      "insert into platform_operator(user_id,discovery) values($1,true)",
      [actor.userId],
    );
    await expect(
      capacity().configure(operator, {
        requestKey: crypto.randomUUID(),
        expectedVersion: 0,
        policy: { ...policy(), pooled: 4 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await capacity().configuration(operator)).revisions).toEqual([]);
  });
  it("pauses every capacity helper and ledger during managed preparation", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    await prepareDiscoveryCapacity(h.admin);
    const privileges = await h.runtime.query<{ allowed: boolean }>(
      "select has_function_privilege(current_user,'public.discovery_capacity_route(uuid,jsonb)','EXECUTE') or has_function_privilege(current_user,'public.protect_discovery_capacity()','EXECUTE') or has_table_privilege(current_user,'public.discovery_capacity_policy','SELECT,INSERT') or has_table_privilege(current_user,'public.discovery_capacity_binding','SELECT,INSERT') allowed",
    );
    expect(privileges.rows[0].allowed).toBe(false);
    await expect(
      h.runtime.query("select public.discovery_capacity_route($1::uuid)", [
        f.business.id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await secureDiscoveryCapacity(h.admin);
    await verifyRuntimeRole(h.runtime);
    await f.app.execute(f.queued[0].work);
    expect(f.searches).toHaveLength(1);
  });
  it("rejects a deployment manifest that increases native capacity while reusing the approved revision identity", async () => {
    const f = await purchased();
    f.deployment.policy.total = 4;
    f.behavior.total = 4;
    f.behavior.baseTotal = 4;
    await expect(
      f.app.start(f.owner, f.business.id, f.request()),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(f.queued).toHaveLength(0);
    expect((await f.app.workspace(f.owner, f.business.id)).runs[0].used).toBe(
      0,
    );
  });
  it("refuses a different promoted native deployment even when queue names and all limits match", async () => {
    const f = await purchased();
    f.behavior.nativeDeploymentId = "unapproved-native-deployment";
    await expect(
      f.app.start(f.owner, f.business.id, f.request()),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(f.queued).toHaveLength(0);
    expect(f.searches).toEqual([]);
  });
  it("requires the actual worker project, environment and exact build identity before any provider operation", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    for (const [target, field] of [
      [f.execution.project, "ref"],
      [f.execution.environment, "id"],
      [f.execution.deployment, "id"],
      [f.execution.deployment, "version"],
      [f.execution.deployment, "externalId"],
    ] as const) {
      const original = Reflect.get(target, field);
      Reflect.set(target, field, "unapproved-worker-context");
      await expect(f.app.execute(f.queued[0].work)).rejects.toThrow(
        "capacity is unavailable",
      );
      expect(f.searches).toEqual([]);
      Reflect.set(target, field, original);
    }
    await f.app.execute(f.queued[0].work);
    expect(f.searches).toHaveLength(1);
  });
  it("keeps a standing approval valid after approval-session MFA expiry but stops old work when its operator withdraws", async () => {
    const f = await purchased();
    const actor = await h.authenticate(f.operator);
    await h.admin.query(
      "update session set mfa_verified_at=clock_timestamp()-interval '16 minutes' where user_id=$1",
      [actor.userId],
    );
    await expect(capacity().configuration(f.operator)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await f.app.start(f.owner, f.business.id, f.request());
    expect(f.queued).toHaveLength(1);
    await h.admin.query(
      "update platform_operator set discovery=false where user_id=$1",
      [actor.userId],
    );
    expect(await f.app.execute(f.queued[0].work)).toEqual({
      outcome: "configuration_changed",
    });
    await h.admin.query(
      "update platform_operator set discovery=true where user_id=$1",
      [actor.userId],
    );
    await f.app.execute(f.queued[0].work);
    expect(f.searches).toEqual([]);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      used: 0,
      stopReason: "configuration_changed",
    });
  });
  it("uses the installed native SDK HTTP shapes and pins one original dispatch to the approved deployed version", async () => {
    const f = await purchased();
    const posts: unknown[] = [];
    let promoted = f.approved.policy.deploymentId;
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const path = decodeURIComponent(request.url ?? "");
      requests.push(`${request.method} ${path}`);
      if (request.headers.authorization !== "Bearer fixture-trigger-secret") {
        response.writeHead(401).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      if (path === "/api/v1/deployments/current") {
        response.end(
          JSON.stringify({
            id: promoted,
            version: "20261107.1",
            externalId: "fixture-reviewed-build",
            status: "DEPLOYED",
            shortCode: "fixture",
            createdAt: h.clock.now(),
            runtime: "node",
            runtimeVersion: "22",
          }),
        );
      } else if (path.includes("/queues/")) {
        response.end(
          JSON.stringify({
            id: "queue_fixture",
            name: "bounded-prospect-discovery",
            type: "task",
            version: "V2",
            concurrencyLimit: null,
            paused: false,
            running: 0,
            queued: 0,
          }),
        );
      } else if (path.includes("/concurrency-limits/")) {
        const name = path.split("/concurrency-limits/")[1];
        const total =
          name.includes("provider") ||
          name === "task/bounded-prospect-discovery"
            ? 3
            : 1;
        response.end(
          JSON.stringify({
            id: `climit_${name}`,
            name,
            total: {
              current: total,
              base: total,
              override: null,
              overriddenAt: null,
            },
            perKey: {
              current: null,
              base: null,
              override: null,
              overriddenAt: null,
            },
            paused: false,
            running: 0,
            queued: 0,
          }),
        );
      } else if (
        request.method === "POST" &&
        path === "/api/v1/tasks/bounded-prospect-discovery/trigger"
      ) {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        posts.push(JSON.parse(body));
        response.end(JSON.stringify({ id: "run_fixture" }));
      } else
        response
          .writeHead(404)
          .end(JSON.stringify({ error: "unknown fixture endpoint" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Fixture address missing");
    configureTrigger({
      baseURL: `http://127.0.0.1:${address.port}`,
      accessToken: "fixture-trigger-secret",
    });
    try {
      const native = configuredDiscoveryQueue(
        {
          NODE_ENV: "test",
          DISCOVERY_CAPACITY_DEPLOYMENT_JSON: JSON.stringify(f.deployment),
          TRIGGER_PROJECT_REF: f.approved.policy.projectRef,
          TRIGGER_SECRET_KEY: "fixture-trigger-secret",
          TRIGGER_DISCOVERY_RECOVERY_CRON: "* * * * *",
          DISCOVERY_WORKER_DEPLOYMENT_CONFIRMED: "true",
        },
        createDiscoveryCapacityRepository(runtimeDatabase(h.runtime)),
      );
      if (!native) throw new Error("Native fixture setup missing");
      const app = f.application(native);
      const request = f.request();
      promoted = "wrong-environment-deployment";
      await expect(
        app.start(f.owner, f.business.id, request),
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(posts).toEqual([]);
      promoted = f.approved.policy.deploymentId;
      await app.recoverDispatches();
      expect(posts).toHaveLength(1);
      const dispatched = z
        .object({
          payload: z.unknown(),
          options: z.object({
            lockToVersion: z.string(),
            idempotencyKey: z.string(),
            idempotencyKeyTTL: z.string(),
            concurrency: z.array(z.string()),
          }),
        })
        .parse(posts[0]);
      expect(dispatched.options).toMatchObject({
        lockToVersion: "20261107.1",
        idempotencyKeyTTL: "30d",
        concurrency: [
          `discovery-provider-${f.approved.policy.allocationKey}`,
          `discovery-reserved-${f.approved.policy.allocationKey}-${f.business.id}`,
        ],
      });
      expect(requests).toContain("GET /api/v1/deployments/current");
      const envelope = z
        .object({ json: z.unknown() })
        .parse(
          typeof dispatched.payload === "string"
            ? JSON.parse(dispatched.payload)
            : dispatched.payload,
        );
      await app.execute(envelope.json);
      expect(f.searches).toHaveLength(1);
      expect(
        (await app.workspace(f.owner, f.business.id)).runs[0],
      ).toMatchObject({ status: "completed", used: 2 });
    } finally {
      configureTrigger({});
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  describe("full populated schema reapplication", () => {
    let f: Awaited<ReturnType<typeof purchased>>;
    let beforeFunctions: { signature: string; body: string }[];
    let beforeConstraints: { name: string; definition: string }[];
    beforeEach(async () => {
      f = await purchased();
      await f.app.start(f.owner, f.business.id, f.request());
      beforeFunctions = (
        await h.admin.query<{ signature: string; body: string }>(
          "select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1",
        )
      ).rows;
      beforeConstraints = (
        await h.admin.query<{ name: string; definition: string }>(
          "select conrelid::regclass::text||'.'||conname name,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by 1,2",
        )
      ).rows;
      await h.reapplySchema();
    });
    it("preserves paid contracts, immutable bindings, helper bodies and every existing constraint through prepare, push and secure", async () => {
      await verifyRuntimeRole(h.runtime);
      expect((await capacity().configuration(f.operator)).revisions[0].id).toBe(
        f.approved.id,
      );
      expect(
        (await f.app.workspace(f.owner, f.business.id)).runs[0],
      ).toMatchObject({
        status: "queued",
        executionCapacity: { mode: "reserved", slots: 1, policyVersion: 1 },
      });
      expect(
        (
          await h.admin.query(
            "select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1",
          )
        ).rows,
      ).toEqual(beforeFunctions);
      expect(
        (
          await h.admin.query(
            "select conrelid::regclass::text||'.'||conname name,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by 1,2",
          )
        ).rows,
      ).toEqual(beforeConstraints);
      await f.app.execute(f.queued[0].work);
      expect(
        (await f.app.workspace(f.owner, f.business.id)).runs[0],
      ).toMatchObject({
        status: "completed",
        used: 2,
        prospects: [{ name: "Pune Fabricator" }],
      });
    });
  });

  it("uses trusted database expiry even while the application clock has not advanced", async () => {
    const f = await purchased(true, {}, 3000);
    await f.app.start(f.owner, f.business.id, f.request());
    const frozen = h.clock.now().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(h.clock.now().toISOString()).toBe(frozen);
    expect(await f.app.execute(f.queued[0].work)).toEqual({
      outcome: "configuration_changed",
    });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      used: 0,
      stopReason: "configuration_changed",
    });
    expect(f.searches).toEqual([]);
  });

  it("uses an explicit operator mapping for a configured contract unit without inferring provider concurrency", async () => {
    const f = await purchased(true, {}, undefined, "contract capacity units");
    await f.app.start(f.owner, f.business.id, f.request());
    await f.app.execute(f.queued[0].work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "completed",
      executionCapacity: { mode: "reserved", slots: 1 },
      used: 2,
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).effectiveContract
        ?.reservedCapacity?.capacity,
    ).toEqual({ quantity: 1, unit: "contract capacity units" });
  });

  it("keeps paused native queues unavailable even when their declared concurrency bounds match", async () => {
    const f = await purchased();
    f.behavior.queuePaused = true;
    await expect(
      f.app.start(f.owner, f.business.id, f.request()),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(f.queued).toHaveLength(0);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).capacity,
    ).toMatchObject({ status: "unavailable" });
    f.behavior.queuePaused = false;
    await f.app.recoverDispatches();
    expect(f.queued).toHaveLength(1);
  });

  it("does not return retained private results after the original query session is revoked during availability I/O", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    await f.app.execute(f.queued[0].work);
    let revoked = false;
    f.behavior.afterObserve = async () => {
      if (!revoked) {
        revoked = true;
        await h.signOut(f.owner);
      }
    };
    await expect(f.app.workspace(f.owner, f.business.id)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
  });

  it("retains accounted search progress and stops before another provider effect when capacity becomes unknown mid-run", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    f.behavior.afterSearch = () => {
      f.behavior.unavailable = true;
    };
    expect(await f.app.execute(f.queued[0].work)).toEqual({
      outcome: "queue_unavailable",
    });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "stopped",
      stopReason: "queue_unavailable",
      used: 1,
    });
    f.behavior.unavailable = false;
    await f.app.execute(f.queued[0].work);
    expect(f.searches).toHaveLength(1);
  });
  it("rechecks trusted session expiry after budget serialization before starting the provider operation", async () => {
    const f = await purchased();
    await f.app.start(f.owner, f.business.id, f.request());
    const actor = await h.access.authenticateForWork(f.owner);
    const lock = await h.admin.connect();
    await lock.query("begin");
    await lock.query("lock table public.subscription_usage in share mode");
    const pending = f.app.execute(f.queued[0].work).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await waitForDatabaseLock("subscription_usage");
      await h.admin.query(
        "update session set expires_at=clock_timestamp()-interval '1 microsecond' where id=$1",
        [actor.sessionId],
      );
    } finally {
      await lock.query("rollback");
      lock.release();
    }
    expect(await pending).toEqual({
      value: { outcome: "authorization_revoked" },
    });
    expect(f.searches).toEqual([]);
    const viewer = await h.signIn("tax-owner@example.com");
    expect(
      (await f.app.workspace(viewer, f.business.id)).runs[0],
    ).toMatchObject({ status: "stopped", used: 0 });
  });
  it.each(["session", "membership"] as const)(
    "does not disclose retained discovery after %s revocation during the final private database read",
    async (revocation) => {
      const f = await purchased();
      await f.app.start(f.owner, f.business.id, f.request());
      await f.app.execute(f.queued[0].work);
      const actor = await h.authenticate(f.owner);
      const lock = await h.admin.connect();
      await lock.query("begin");
      const table =
        revocation === "session"
          ? "discovery_observation"
          : "discovery_schedule";
      await lock.query(`lock table public.${table} in access exclusive mode`);
      const pending = f.app.workspace(f.owner, f.business.id).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      try {
        await waitForDatabaseLock(table);
        if (revocation === "session") await h.signOut(f.owner);
        else
          await h.admin.query(
            "delete from membership where business_id=$1 and user_id=$2",
            [f.business.id, actor.userId],
          );
      } finally {
        await lock.query("rollback");
        lock.release();
      }
      expect(await pending).toMatchObject({
        error: {
          code: revocation === "session" ? "UNAUTHENTICATED" : "NOT_FOUND",
        },
      });
    },
  );
  it("validates attributable operator configuration through the real HTTP boundary and preserves the request on replay", async () => {
    const operator = await h.signIn("capacity-http@example.com");
    const actor = await h.authenticate(operator);
    await h.admin.query(
      "insert into platform_operator(user_id,discovery) values($1,true)",
      [actor.userId],
    );
    const http = createDiscoveryCapacityHttp({
      application: capacity(),
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const headers = new Headers(operator);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    const payload = {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      policy: policy(),
    };
    const post = (body: unknown) =>
      http.configure(
        new Request("http://localhost:3000/api/platform/discovery-capacity", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    const saved = await post(payload);
    expect(saved.status).toBe(200);
    expect((await saved.json()).data).toMatchObject({
      actorId: actor.userId,
      version: 1,
    });
    expect((await post(payload)).status).toBe(200);
    expect((await capacity().configuration(operator)).revisions).toHaveLength(
      1,
    );
    expect((await post({ ...payload, expectedVersion: 1 })).status).toBe(409);
    expect(
      (await post({ ...payload, operator: { userId: actor.userId } })).status,
    ).toBe(400);
    const foreign = await h.signIn("capacity-http-foreign@example.com");
    const denied = await http.get(
      new Request("http://localhost:3000/api/platform/discovery-capacity", {
        headers: foreign,
      }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("fixture-trigger-project");
  });
  it("executes a purchased reservation when capacity helpers and ledgers use a non-bypass schema owner", async () => {
    const f = await purchased();
    await h.admin
      .query(`CREATE ROLE capacity_test_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE,CREATE ON SCHEMA public TO capacity_test_owner;
      ALTER TABLE public.discovery_capacity_policy OWNER TO capacity_test_owner;
      ALTER TABLE public.discovery_capacity_binding OWNER TO capacity_test_owner;
      ALTER TABLE public.platform_operator OWNER TO capacity_test_owner;
      ALTER TABLE public.business OWNER TO capacity_test_owner;
      ALTER TABLE public.discovery_run OWNER TO capacity_test_owner;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO capacity_test_owner;
      ALTER FUNCTION public.protect_discovery_capacity() OWNER TO capacity_test_owner;
      ALTER FUNCTION public.discovery_capacity_route(uuid,jsonb) OWNER TO capacity_test_owner;
      GRANT EXECUTE ON FUNCTION public.current_business_role(),public.business_data_stopped(uuid),public.current_paid_contract(uuid,timestamptz) TO capacity_test_owner;
      ALTER DEFAULT PRIVILEGES FOR ROLE capacity_test_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);
    await verifyRuntimeRole(h.runtime);
    const ownerPolicies = await h.admin.query<{
      name: string;
      roles: string[];
      cmd: string;
      qual: string;
    }>(
      "select policyname name,roles::text[] roles,cmd,qual from pg_policies where schemaname='public' and policyname in ('business_owner_read','operator_owner_read','discovery_capacity_policy_owner_read','discovery_capacity_binding_owner_read') order by 1",
    );
    expect(ownerPolicies.rows).toHaveLength(4);
    for (const p of ownerPolicies.rows) {
      expect(p.roles).toEqual(["public"]);
      expect(p.cmd).toBe("SELECT");
      expect(p.qual).toContain("CURRENT_USER");
      expect(p.qual).toContain("relowner");
    }
    const own = await h.authenticate(f.owner);
    const foreign = await h.signIn("capacity-policy-foreign@example.com");
    const other = await h.application.createBusiness(foreign, {
      name: "Other Business",
      offering: "Private",
      homeMarket: "Pune",
      website: "",
    });
    const restricted = await h.runtime.connect();
    try {
      await restricted.query("begin");
      await restricted.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true)",
        [own.userId, f.business.id],
      );
      expect(
        (await restricted.query("select id from business order by id")).rows,
      ).toEqual([{ id: f.business.id }]);
      expect(
        (await restricted.query("select user_id from platform_operator")).rows,
      ).toEqual([]);
      await restricted.query(
        "select set_config('app.actor_id','capacity_test_owner',true),set_config('app.business_id',$1,true)",
        [other.id],
      );
      expect((await restricted.query("select id from business")).rows).toEqual(
        [],
      );
      expect(
        (await restricted.query("select user_id from platform_operator")).rows,
      ).toEqual([]);
      expect(
        (
          await restricted.query(
            "select pg_has_role(current_user,'capacity_test_owner','MEMBER') member",
          )
        ).rows[0].member,
      ).toBe(false);
      await restricted.query("rollback");
    } finally {
      restricted.release();
    }
    await f.app.start(f.owner, f.business.id, f.request());
    await f.app.execute(f.queued[0].work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0],
    ).toMatchObject({
      status: "completed",
      used: 2,
      executionCapacity: { mode: "reserved", slots: 1 },
    });
    expect(
      await capacity().configure(f.operator, {
        requestKey: crypto.randomUUID(),
        expectedVersion: 1,
        policy: f.approved.policy,
      }),
    ).toMatchObject({ version: 2 });
  });
});
