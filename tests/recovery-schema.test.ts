import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { recoveryFixture } from "./support/recovery";
import { prepareDatabaseRole } from "../src/db/setup";
import { verifyRuntimeRole } from "../src/db/runtime";

describe("Populated managed recovery schema reapplication", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    f: Awaited<ReturnType<typeof recoveryFixture>>,
    owner: Headers,
    operationId: string;
  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    owner = await h.signIn(`recovery-schema-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(owner, {
      name: "Preserved recovery journal",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    f = await recoveryFixture(h, owner, business.id);
    const op = await f.request();
    operationId = op.id;
    await f.advance(op.id, 1);
  });
  afterAll(async () => {
    await f?.close();
    await h?.close();
  });
  it("preserves populated requests/history while owner replacement of the referenced UNIQUE and full Drizzle prepare/schema/secure restores exact scopes", async () => {
    const before = (await f.application().workspace(owner)).operations.find(
      (o) => o.id === operationId,
    )!;
    await prepareDatabaseRole(h.admin);
    await h.admin.query(
      "ALTER TABLE public.infrastructure_recovery DROP CONSTRAINT recovery_business_scope",
    );
    await h.admin.query(
      "ALTER TABLE public.infrastructure_recovery ADD CONSTRAINT recovery_business_scope UNIQUE(id,business_id)",
    );
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    const after = (await f.application().workspace(owner)).operations.find(
      (o) => o.id === operationId,
    )!;
    expect(after).toEqual(before);
    const scope = await h.admin.query(
      "SELECT convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='recovery_event_scope' AND conrelid='public.infrastructure_recovery_event'::regclass",
    );
    expect(scope.rows).toEqual([
      {
        convalidated: true,
        definition:
          "FOREIGN KEY (operation_id, business_id) REFERENCES infrastructure_recovery(id, business_id)",
      },
    ]);
    expect(
      (
        await h.runtime.query(
          "SELECT count(*)::int AS count FROM infrastructure_recovery",
        )
      ).rows[0].count,
    ).toBe(0);
    const client = await h.admin.connect();
    try {
      await client.query("BEGIN");
      await expect(
        client.query(
          "INSERT INTO infrastructure_recovery_event(id,business_id,operation_id,stage,outcome,evidence) VALUES($1,$2,$3,'requested','started','{}')",
          [randomUUID(), randomUUID(), operationId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const inventory = await h.admin.query(
      "SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,(SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace) AS constraints,(SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace) AS functions",
    );
    expect(inventory.rows[0].tables).toBeGreaterThanOrEqual(141);
    console.info("Disposable recovery schema inventory", inventory.rows[0]);
  });
  describe("Recovered target full managed application", () => {
    beforeAll(async () => {
      await f.advance(operationId, 1);
      f.controls.schemaRunner = () =>
        f.target.reapplySchema({ allowQuarantined: true });
    });
    it("applies the reviewed full schema through real Drizzle to the recovered backing store, then verifies actual restricted target records", async () => {
      await f.advance(operationId, 2);
      await verifyRuntimeRole(f.target.runtime, { allowQuarantined: true });
      const actual = await f
        .application()
        .inspect(owner, { businessId: f.plan.businessId, operationId });
      expect(actual.business.name).toBe("Preserved recovery journal");
      expect(actual.facts).toEqual(
        expect.arrayContaining(f.archive.manifest.facts),
      );
      await expect(verifyRuntimeRole(f.target.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    });
  });
});
