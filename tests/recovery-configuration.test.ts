import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { recoveryFixture } from "./support/recovery";
import {
  configuredRecoveryPlans,
  recoveryConfigurationHash,
  recoveryInventorySchema,
  observeRecoveryIdentities,
  recoveryReadiness,
} from "../src/recovery/configuration";
import {
  captureRecoveryArchive,
  recoveryDigest,
} from "../src/recovery/postgres";
import { recoveryPlanSchema } from "../src/models/infrastructure-recovery";
import { recoveryDatabase } from "../src/recovery/native-configuration";

describe("Configured native recovery contracts", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    f: Awaited<ReturnType<typeof recoveryFixture>>;
  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    const owner = await h.signIn(
        `recovery-configuration-${randomUUID()}@example.com`,
      ),
      b = await h.application.createBusiness(owner, {
        name: "Configuration contracts",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    f = await recoveryFixture(h, owner, b.id);
  });
  afterAll(async () => {
    await f?.close();
    await h?.close();
  });
  function inventory() {
    const result = recoveryInventorySchema.parse({
      planId: f.plan.id,
      configurationHash: recoveryConfigurationHash(f.plan),
      expiresAt: f.plan.observationExpiresAt,
      vercel: {
        project: "prj_fixture",
        environment: "preview",
        deployment: "dpl_fixture",
        region: "iad1",
      },
      trigger: {
        project: "proj_recovery",
        environment: "dev",
        worker: "worker_fixture",
        selectedRegion: "us-east-1",
        observedRun: null,
        observedRegion: null,
        evidence: "fixture:selected-region",
      },
      storage: {
        account: "a".repeat(32),
        sourceBucket: f.plan.source.bucket,
        targetBucket: f.plan.target.bucket,
        backupBucket: "separate-retained-copies",
        jurisdiction: "us",
        private: true,
        retainedCopies: true,
        evidence: "fixture:private-jurisdiction",
      },
      isolationEvidence: "fixture:separate-auth-webhooks-keys",
      commercialApproval: "fixture:actual-terms-required",
    });
    f.plan.inventoryHash = recoveryDigest(JSON.stringify(result));
    return result;
  }
  it("requires the immutable server registry and refuses production, same-source or arbitrary privileged substitutions", () => {
    const raw = JSON.stringify([f.plan]);
    expect(
      configuredRecoveryPlans({
        RECOVERY_APPROVED_PLANS: raw,
        RECOVERY_APPROVED_PLANS_HASH: recoveryDigest(raw),
      }),
    ).toEqual([f.plan]);
    expect(() =>
      configuredRecoveryPlans({
        RECOVERY_APPROVED_PLANS: raw,
        RECOVERY_APPROVED_PLANS_HASH: "0".repeat(64),
      }),
    ).toThrowError("SETUP_REQUIRED");
    expect(
      recoveryPlanSchema.safeParse({
        ...f.plan,
        target: { ...f.plan.target, environment: "production" },
      }).success,
    ).toBe(false);
    expect(
      recoveryPlanSchema.safeParse({
        ...f.plan,
        target: { ...f.plan.target, host: f.plan.source.host },
      }).success,
    ).toBe(false);
    expect(
      recoveryPlanSchema.safeParse({
        ...f.plan,
        sql: "arbitrary SQL",
        databaseUrl: "postgresql://private",
      }).success,
    ).toBe(false);
  });
  it("uses bounded fixed-host authenticated native Neon reads for both exact branch endpoints and regions", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://console.neon.tech");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer fixture-read-token",
      );
      requests.push(url.pathname);
      const identity = url.pathname.includes(f.plan.source.project)
        ? f.plan.source
        : f.plan.target;
      return url.pathname.endsWith("/endpoints")
        ? Response.json({
            endpoints: [
              {
                host: identity.host,
                region_id: "aws-us-east-1",
                branch_id: identity.branch,
                project_id: identity.project,
                type: "read_write",
              },
            ],
          })
        : Response.json({
            project: { id: identity.project, region_id: "aws-us-east-1" },
          });
    };
    expect(
      await observeRecoveryIdentities({
        plan: f.plan,
        inventory: inventory(),
        token: "fixture-read-token",
        fetch: fetcher,
        now: h.clock.now,
      }),
    ).toEqual({
      source: f.plan.source,
      target: f.plan.target,
      expiresAt: f.plan.observationExpiresAt,
      nativeVerified: true,
    });
    expect(requests).toHaveLength(4);
    const wrongRegion: typeof fetch = async () =>
      Response.json({
        project: { id: f.plan.source.project, region_id: "aws-eu-central-1" },
        endpoints: [],
      });
    await expect(
      observeRecoveryIdentities({
        plan: f.plan,
        inventory: inventory(),
        token: "fixture-read-token",
        fetch: wrongRegion,
        now: h.clock.now,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stale = inventory();
    stale.expiresAt = "2000-01-01T00:00:00Z";
    await expect(
      observeRecoveryIdentities({
        plan: f.plan,
        inventory: stale,
        token: "fixture-read-token",
        fetch: fetcher,
        now: h.clock.now,
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    expect(requests).toHaveLength(4);
  });
  it("distinguishes selected/attested region and storage evidence from native runtime and deployed verification", () => {
    const i = inventory(),
      unverified = recoveryReadiness([f.plan], [i], {}, h.clock.now())[0];
    expect(unverified).toMatchObject({
      vercel: { status: "unverified" },
      trigger: { status: "selected" },
      r2: { status: "attested_private_us" },
      neon: { status: "requires_native_read" },
    });
    expect(unverified.launchGates).toContain(
      "Verify actual commercial plans and retention windows",
    );
    const observed = recoveryReadiness(
      [f.plan],
      [i],
      {
        VERCEL_PROJECT_ID: i.vercel.project,
        VERCEL_ENV: i.vercel.environment,
        VERCEL_DEPLOYMENT_ID: i.vercel.deployment,
        VERCEL_REGION: "iad1",
      },
      h.clock.now(),
    )[0];
    expect(observed.vercel.status).toBe("native_runtime_observed");
    expect(observed.r2.next).toContain(
      "no Virginia or S3 versioning guarantee",
    );
    const stale = recoveryReadiness(
      [f.plan],
      [i],
      {},
      new Date("2100-01-01T00:00:00Z"),
    )[0];
    expect(stale.fresh).toBe(false);
  });
  it("refuses pooled administration and owner-backed runtime configuration before opening a provider connection", () => {
    const owner =
      "postgresql://owner:fixture-password@ep-source.us-east-1.aws.neon.tech/neondb?sslmode=verify-full";
    const pooledOwner = owner.replace("ep-source.", "ep-source-pooler.");
    expect(() => recoveryDatabase(pooledOwner, pooledOwner)).toThrowError(
      "SETUP_REQUIRED",
    );
    expect(() => recoveryDatabase(owner, pooledOwner)).toThrowError(
      "SETUP_REQUIRED",
    );
    expect(() =>
      recoveryDatabase(
        owner,
        "postgresql://app_runtime:fixture-password@ep-other-pooler.us-east-1.aws.neon.tech/neondb",
      ),
    ).toThrowError("SETUP_REQUIRED");
  });
  it("refuses to label bytes from a foreign real source as the approved backup provenance", async () => {
    await expect(
      captureRecoveryArchive({
        source: {
          admin: h.admin,
          runtime: h.runtime,
          environment: h.nativeEnvironment,
        },
        sourceIdentity: f.plan.target,
        businessId: f.plan.businessId,
        schemaHash: f.plan.schemaHash,
        id: "foreign-provenance",
        key: Buffer.alloc(32, 1),
        pgDump: "must-not-launch-a-native-export",
        maxBytes: 100000000,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
