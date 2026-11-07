import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { recoveryFixture } from "./support/recovery";
import { createRecoveryRepository } from "../src/db/recovery-repository";
import { createRecoveryApplication } from "../src/application/infrastructure-recovery";

describe("Isolated infrastructure recovery at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  it("requires a default-false recovery capability and current platform MFA, including central authentication", async () => {
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    const primary = await h.signIn("recovery-only@example.com", false);
    const identity = await h.access.primary(primary);
    await h.admin.query(
      "insert into platform_operator(user_id,recovery) values($1,true)",
      [identity.user.id],
    );
    expect(await h.access.status(primary)).toMatchObject({
      operator: true,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(h.authenticate(primary)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const headers = await h.signIn("recovery-only@example.com");
    await h.team.requirePlatformCapability(headers, "recovery.manage");
    const app = createRecoveryApplication({
      authenticate: h.access.authenticateForWork,
      repository: createRecoveryRepository(runtimeDatabase(h.runtime), h.clock),
      plans: [],
      adapter: null,
    });
    expect(await app.workspace(headers)).toMatchObject({
      configured: false,
      productionVerified: false,
      operations: [],
    });
    await expect(
      app.request(headers, { planId: randomUUID(), requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await h.admin.query(
      "update platform_operator set recovery=false where user_id=$1",
      [identity.user.id],
    );
    await expect(app.workspace(headers)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("restores actual application records into a physically distinct restricted target and keeps stale runtime capabilities quarantined", async () => {
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    const owner = await h.signIn("recovery-drill@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Actual restored Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const f = await recoveryFixture(h, owner, business.id);
    try {
      const app = f.application(),
        request = { planId: f.plan.id, requestKey: randomUUID() };
      const op = await app.request(owner, request);
      expect(JSON.stringify(op)).not.toMatch(
        /sessionId|recovery_session|lease/,
      );
      expect((await app.request(owner, request)).id).toBe(op.id);
      await f.advance(op.id, 7);
      const recovered = await app.inspect(owner, {
        businessId: business.id,
        operationId: op.id,
      });
      expect(recovered).toMatchObject({
        business: { id: business.id, name: "Actual restored Business" },
        quarantined: true,
      });
      expect(recovered.facts).toContainEqual(
        f.archive.manifest.facts.find((f) => f.table === "business"),
      );
      expect(
        (await app.workspace(owner)).operations.find((r) => r.id === op.id),
      ).toMatchObject({
        stage: "inspection_ready",
        events: expect.arrayContaining([
          expect.objectContaining({
            stage: "reconciled",
            evidence: {
              native: [],
              unresolved: expect.arrayContaining([
                "Current control-plane authorization unavailable",
              ]),
            },
          }),
        ]),
      });
      await expect(verifyRuntimeRole(f.target.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      await verifyRuntimeRole(f.target.runtime, { allowQuarantined: true });
    } finally {
      await f.close();
    }
  });
});
