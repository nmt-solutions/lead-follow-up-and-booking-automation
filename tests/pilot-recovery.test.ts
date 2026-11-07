import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { recoveryFixture } from "./support/recovery";
import { recoverySchemaDefinitionHash } from "../src/recovery/postgres";
import { verifyRuntimeRole } from "../src/db/runtime";

describe("Populated pilot archive restore and reviewed schema repair", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    s: Awaited<ReturnType<typeof pilotFixture>>,
    r: Awaited<ReturnType<typeof recoveryFixture>>,
    operationId: string;
  const ledgerRows = new Map<string, unknown[]>();
  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    s = await pilotFixture(h);
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.discovery.execute(s.queued.at(-1));
    const period = (await s.app.workspace(s.f.owner, s.f.business.id))
      .periods[0];
    const renewal = await s.app.preparePilotRenewal(
      s.f.owner,
      s.f.business.id,
      {
        originalActionId: s.action.id,
        originalPeriodId: period.id,
        requestKey: randomUUID(),
        startAt: period.end,
        approvalExpiresAt: new Date(
          h.clock.now().getTime() + 600000,
        ).toISOString(),
        agreeSeparateMandate: true,
      },
    );
    s.native.loseCreation = true;
    await s.app.start(s.f.owner, s.f.business.id, { actionId: renewal.id });
    expect(s.mutations).toHaveLength(2);
    for (const table of [
      "pilot_record",
      "pilot_event",
      "pilot_effect",
      "subscription_payment",
      "subscription_period",
    ])
      ledgerRows.set(
        table,
        (
          await h.admin.query(
            `select to_jsonb(t) value from public.${table} t order by id`,
          )
        ).rows,
      );
    const reviewedDefinition = await recoverySchemaDefinitionHash(h.admin);
    await h.admin.query(
      "alter table public.business drop constraint business_name_length",
    );
    r = await recoveryFixture(h, s.f.owner, s.f.business.id);
    r.plan.appliedSchemaHash = reviewedDefinition;
    operationId = (await r.request()).id;
  });
  afterAll(async () => {
    await r?.close();
    await h?.close();
  });
  it("archives all private pilot ledgers and the uncertain original mandate without making another native mutation", () => {
    for (const table of ["pilot_record", "pilot_event", "pilot_effect"])
      expect(
        Number(r.archive.manifest.tables.find((t) => t.table === table)?.count),
      ).toBeGreaterThan(0);
    expect(s.mutations).toHaveLength(2);
  });
  it("restores the actual populated archive into a separate disposable quarantined PostgreSQL target", async () => {
    await r.advance(operationId, 2);
    expect(r.controls.restoreCalls).toBe(1);
    for (const [table, rows] of ledgerRows)
      expect(
        (
          await r.target.admin.query(
            `select to_jsonb(t) value from public.${table} t order by id`,
          )
        ).rows,
        table,
      ).toEqual(rows);
    await expect(verifyRuntimeRole(r.target.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    expect(s.mutations).toHaveLength(2);
  });
  describe("reviewed full schema repair", () => {
    beforeAll(async () => {
      r.controls.schemaRunner = () =>
        r.target.reapplySchema({ allowQuarantined: true });
      await r.advance(operationId, 2);
    });
    it("runs the full managed schema against that restored database, preserves all pilot facts and rejects ordinary worker startup", async () => {
      await verifyRuntimeRole(r.target.runtime, { allowQuarantined: true });
      for (const [table, rows] of ledgerRows)
        expect(
          (
            await r.target.admin.query(
              `select to_jsonb(t) value from public.${table} t order by id`,
            )
          ).rows,
          table,
        ).toEqual(rows);
      expect(
        (
          await r.target.admin.query(
            "select convalidated from pg_constraint where conname='business_name_length' and conrelid='business'::regclass",
          )
        ).rows,
      ).toEqual([{ convalidated: true }]);
      const selected = await r
        .application()
        .inspect(s.f.owner, { businessId: s.f.business.id, operationId });
      expect(selected.business.id).toBe(s.f.business.id);
      expect(JSON.stringify(selected)).not.toContain("pilotOrders");
      expect(JSON.stringify(selected)).not.toContain(
        "fixture:approved-worst-case-provider-and-staff-bound",
      );
      await expect(verifyRuntimeRole(r.target.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      expect(s.mutations).toHaveLength(2);
    });
  });
});
