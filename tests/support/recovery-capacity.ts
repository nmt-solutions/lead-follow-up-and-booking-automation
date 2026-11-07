import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Pool } from "pg";
import type { createHarness } from "./harness";
import type { financialExportFixture } from "./governance-financial";
import { financialResearch } from "./financial-operational";
import {
  runtimeDatabase,
  verifyRuntimeRole,
  type Database,
} from "../../src/db/runtime";
import { createDiscoveryCapacityApplication } from "../../src/application/discovery-capacity";
import { createDiscoveryCapacityRepository } from "../../src/db/discovery-capacity-repository";
import { createDiscoveryApplication } from "../../src/application/discovery";
import { createDiscoveryRepository } from "../../src/db/discovery-repository";
import { createCapacityDiscoveryQueue } from "../../src/discovery/capacity";
import { capacityDeclarationSchema } from "../../src/models/discovery-capacity";
import type { DiscoveryWork } from "../../src/models/discovery";

/** Real canonical paid pooled work; reserved paid purchase is covered by the full capacity suite. */
export async function recoveryCapacityFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  f: Pick<Awaited<ReturnType<typeof financialExportFixture>>, "business">,
) {
  const owner = await h.signIn("tax-owner@example.com"),
    operator = await h.signIn("tax-operator@example.com");
  const actor = await h.authenticate(operator),
    businessActor = await h.authenticate(owner);
  await h.admin.query(
    "update platform_operator set discovery=true where user_id=$1",
    [actor.userId],
  );
  if (
    !(
      await h.admin.query(
        "select 1 from discovery_configuration where business_id=$1",
        [f.business.id],
      )
    ).rowCount
  )
    await financialResearch(h, { owner, business: f.business }, true);
  const sourceConfiguration = createDiscoveryCapacityApplication({
    authenticate: h.access.authenticateForWork,
    repository: createDiscoveryCapacityRepository(runtimeDatabase(h.runtime)),
  });
  const marker = `private-capacity-purchase-${randomUUID()}`;
  const policy = {
    allocationKey: randomUUID(),
    projectRef: "fixture-capacity-project",
    environmentId: "fixture-capacity-environment",
    deploymentRef: "fixture-capacity-build",
    deploymentId: "fixture-capacity-native-id",
    deploymentVersion: "20261107.1",
    providerEvidence: marker,
    validUntil: new Date(h.clock.now().getTime() + 3600000).toISOString(),
    total: 3,
    pooled: 1,
    allocations: [
      {
        businessId: f.business.id,
        offerId: "fixture",
        reservedCapacityId: "optional-not-purchased",
        quantity: 7,
        unit: "reviewed contract units",
        concurrentRuns: 1,
        mappingEvidence: `${marker}:explicit-mapping`,
      },
    ],
    fallback: "wait",
    maxObservationAgeMs: 30000,
  };
  await sourceConfiguration.configure(operator, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    policy,
  });
  const approved = await sourceConfiguration.configure(operator, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    policy: { ...policy, providerEvidence: `${marker}:reviewed-history` },
  });
  const declaration = {
    policy: capacityDeclarationSchema.strip().parse(approved.policy),
  };
  const enqueueAttempts: unknown[] = [],
    providerAttempts: string[] = [],
    queued: DiscoveryWork[] = [];
  const application = (database: Database) => {
    const queue = createCapacityDiscoveryQueue({
      deployment: declaration,
      repository: createDiscoveryCapacityRepository(database),
      native: {
        key: async (v) => v,
        deployment: async () => ({
          id: policy.deploymentId,
          version: policy.deploymentVersion,
          externalId: policy.deploymentRef,
          status: "DEPLOYED",
        }),
        queue: async () => ({
          name: "bounded-prospect-discovery",
          type: "task",
          version: "V2",
          concurrencyLimit: null,
          paused: false,
        }),
        retrieve: async (name) => ({
          name,
          paused: false,
          total: {
            current:
              name.includes("provider") ||
              name === "task/bounded-prospect-discovery"
                ? 3
                : 1,
            base:
              name.includes("provider") ||
              name === "task/bounded-prospect-discovery"
                ? 3
                : 1,
            override: null,
          },
          perKey: { current: null },
          running: 0,
          queued: 0,
        }),
        trigger: async (task, work, options) => {
          enqueueAttempts.push({ task, work, options }); // Count BEFORE any provider deduplication.
          if (task === "bounded-prospect-discovery") {
            const { workSchema } = await import("../../src/models/discovery");
            queued.push(workSchema.parse(work));
          }
        },
      },
    });
    return createDiscoveryApplication({
      authenticate: async (credentials: Headers) => {
        await h.team.requireBusinessCapability(
          credentials,
          f.business.id,
          "sales.work",
        );
        return h.authenticate(credentials);
      },
      authenticateForWork: h.access.authenticateForWork,
      authenticateWork: h.access.authenticateWork,
      repository: createDiscoveryRepository(database, h.clock),
      clock: h.clock,
      queue,
      requireCapacity: true,
      provider: {
        id: "fixture",
        search: async (input) => {
          providerAttempts.push(input.operationId);
          return [
            {
              name: "Recovery Fabricator",
              market: "Pune",
              url: "https://recovery-fabricator.example/about",
              excerpt: "We fabricate steel",
            },
          ];
        },
        review: async () => ({
          relevant: true,
          reason: "Fabricates steel",
          evidenceQuote: "fabricate steel",
          uncertainty: "Timing unknown",
          request: null,
        }),
      },
    });
  };
  const source = application(runtimeDatabase(h.runtime));
  const request = (budget: number) => ({
    markets: ["Pune"],
    publicOffering: "Steel",
    confirmPublicQuery: true,
    budget,
    requestKey: randomUUID(),
  });
  const partial = await source.start(owner, f.business.id, request(1));
  await source.execute(queued[0]);
  const pending = await source.start(owner, f.business.id, request(2));
  expect(
    (await source.workspace(owner, f.business.id)).runs.find(
      (r) => r.id === partial.id,
    ),
  ).toMatchObject({
    used: 1,
    status: "stopped",
    stopReason: "budget_exhausted",
    executionCapacity: { mode: "pooled", policyVersion: 2 },
  });
  const snapshot = async (pool: Pool) =>
    (
      await pool.query(
        "select * from (select 'policy' kind,to_jsonb(p) row from discovery_capacity_policy p union all select 'binding' kind,to_jsonb(b) row from discovery_capacity_binding b) s order by kind,row::text",
      )
    ).rows;
  const original = await snapshot(h.admin),
    attemptsBefore = {
      enqueue: enqueueAttempts.length,
      provider: providerAttempts.length,
    };
  return {
    marker,
    approved,
    partial,
    pending,
    attemptsBefore,
    async assertRestored(
      target: { admin: Pool; runtime: Pool },
      inspected: unknown,
    ) {
      expect(await snapshot(target.admin)).toEqual(original);
      const targetApp = application(runtimeDatabase(target.runtime));
      const state = await targetApp.workspace(owner, f.business.id);
      expect(state.runs.find((r) => r.id === partial.id)).toMatchObject({
        used: 1,
        budget: 1,
        status: "stopped",
        executionCapacity: { mode: "pooled", policyVersion: 2 },
      });
      expect(state.runs.find((r) => r.id === pending.id)).toMatchObject({
        used: 0,
        budget: 2,
        status: "queued",
        executionCapacity: { mode: "pooled", policyVersion: 2 },
      });
      const targetConfiguration = createDiscoveryCapacityApplication({
        authenticate: async (credentials: Headers) => {
          await sourceConfiguration.configuration(credentials);
          return h.access.authenticateForWork(credentials);
        },
        repository: createDiscoveryCapacityRepository(
          runtimeDatabase(target.runtime),
        ),
      });
      expect(
        (await targetConfiguration.configuration(operator)).revisions,
      ).toHaveLength(2);
      await h.admin.query(
        "update platform_operator set discovery=false where user_id=$1",
        [actor.userId],
      );
      try {
        await expect(
          targetConfiguration.configuration(operator),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await h.admin.query(
          "update platform_operator set discovery=true where user_id=$1",
          [actor.userId],
        );
      }
      const membership = (
        await h.admin.query(
          "select to_jsonb(m) row from membership m where business_id=$1 and user_id=$2",
          [f.business.id, businessActor.userId],
        )
      ).rows[0].row;
      await h.admin.query(
        "delete from membership where business_id=$1 and user_id=$2",
        [f.business.id, businessActor.userId],
      );
      try {
        await expect(
          targetApp.workspace(owner, f.business.id),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await h.admin.query(
          "insert into membership select * from jsonb_populate_record(null::membership,$1::jsonb)",
          [JSON.stringify(membership)],
        );
      }
      await expect(
        (async () => {
          await verifyRuntimeRole(target.runtime);
          await targetApp.recoverDispatches();
          await targetApp.execute(queued[1]);
        })(),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      expect(enqueueAttempts).toHaveLength(attemptsBefore.enqueue);
      expect(providerAttempts).toHaveLength(attemptsBefore.provider);
      expect(JSON.stringify(inspected)).not.toContain(marker);
      return {
        policyRevisions: 2,
        bindings: 2,
        originalExecutionAndPaidBudgetPreserved: true,
        currentSourceDiscoveryAndBusinessRevocationDenied: true,
        globalPurchaseProjectionExcluded: true,
        extraNativeEnqueueAttempts: 0,
        extraProviderAttempts: 0,
      };
    },
  };
}
