import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { recoveryFixture } from "./support/recovery";
import { prepareDatabaseRole } from "../src/db/setup";
import { verifyRuntimeRole } from "../src/db/runtime";
import { recoverySchemaDefinitionHash } from "../src/recovery/postgres";
import { financialExportFixture } from "./support/governance-financial";
import { createMemoryStorage } from "./support/storage";
import { recoveryTaxFilingFixture } from "./support/recovery-tax-filings";
import { runtimeDatabase } from "../src/db/runtime";

describe("Populated managed recovery schema reapplication", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    f: Awaited<ReturnType<typeof recoveryFixture>>,
    owner: Headers,
    operationId: string,
    filings: Awaited<ReturnType<typeof recoveryTaxFilingFixture>>;
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
    const storage = createMemoryStorage();
    h.clock.set("2026-11-05T09:00:00Z");
    const financial = await financialExportFixture(
      h,
      storage,
      "fixture:recovery-schema-tax-files",
      true,
    );
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    filings = await recoveryTaxFilingFixture(h, financial);
    const reviewedDefinition = await recoverySchemaDefinitionHash(h.admin);
    // A genuine legacy schema snapshot, with existing public records, predates this reviewed constraint repair.
    await h.admin.query(
      "ALTER TABLE public.business DROP CONSTRAINT business_name_length",
    );
    f = await recoveryFixture(
      h,
      owner,
      business.id,
      [...storage.objects.values()].map((object) => ({
        id: object.metadata.fileId,
        bytes: Buffer.from(object.bytes),
        retained: true,
      })),
    );
    Object.assign(f.plan, { appliedSchemaHash: reviewedDefinition });
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
    const actor = await h.access.authenticateForWork(owner);
    await prepareDatabaseRole(h.admin);
    const paused = await h.runtime.connect();
    try {
      await paused.query("BEGIN");
      await paused.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.recovery_session',$2,true),set_config('app.business_id',$3,true)",
        [actor.userId, actor.sessionId, f.plan.businessId],
      );
      const denied = [
        "SELECT public.recovery_operator_authorized()",
        "SELECT public.claim_infrastructure_recovery($1::uuid)",
        "SELECT public.finish_infrastructure_recovery($1::uuid,gen_random_uuid(),'target_verified','completed','{}'::jsonb)",
        "SELECT public.delegate_infrastructure_recovery($1::uuid)",
        "SELECT * FROM public.pending_infrastructure_recovery()",
        "SELECT * FROM public.infrastructure_recovery",
        "SELECT * FROM public.infrastructure_recovery_event",
        "INSERT INTO public.infrastructure_recovery SELECT * FROM public.infrastructure_recovery WHERE id=$1::uuid",
        "INSERT INTO public.infrastructure_recovery_event(id,business_id,operation_id,stage,outcome,evidence) VALUES(gen_random_uuid(),current_setting('app.business_id')::uuid,$1::uuid,'requested','started','{}')",
      ];
      for (const query of denied) {
        await paused.query("SAVEPOINT denied_recovery");
        await expect(
          paused.query(query, query.includes("$1") ? [operationId] : []),
        ).rejects.toMatchObject({ code: "42501" });
        await paused.query("ROLLBACK TO SAVEPOINT denied_recovery");
      }
    } finally {
      await paused.query("ROLLBACK");
      paused.release();
    }
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
      expect(
        (
          await f.target.admin.query(
            "SELECT count(*)::int AS count FROM pg_constraint WHERE conname='business_name_length' AND conrelid='public.business'::regclass",
          )
        ).rows[0].count,
      ).toBe(0);
      await f.advance(operationId, 2);
      await verifyRuntimeRole(f.target.runtime, { allowQuarantined: true });
      const actual = await f
        .application()
        .inspect(owner, { businessId: f.plan.businessId, operationId });
      expect(actual.business.name).toBe("Preserved recovery journal");
      expect(
        (
          await f.target.admin.query(
            "SELECT convalidated FROM pg_constraint WHERE conname='business_name_length' AND conrelid='public.business'::regclass",
          )
        ).rows,
      ).toEqual([{ convalidated: true }]);
      expect(actual.facts).toEqual(
        expect.arrayContaining(f.archive.manifest.facts),
      );
      for (const table of [
        "tax_filing_export",
        "tax_filing_policy",
        "tax_filing_policy_decision",
        "tax_filing_intent",
        "tax_filing_event",
        "tax_filing_evidence",
        "tax_filing_bytes",
        "tax_filing_access",
        "tax_remittance_allocation",
        "tax_remittance_review",
      ])
        expect(
          BigInt(
            f.archive.manifest.tables.find((row) => row.table === table)!.count,
          ),
          table,
        ).toBeGreaterThan(0n);
      const targetFilings = filings.application(
        runtimeDatabase(f.target.runtime),
      ).filings;
      const retained = await targetFilings.workspace(filings.operator);
      expect(
        retained.intents.find((i) => i.id === filings.filing.intent.id)?.report,
      ).toEqual(filings.originalReport);
      expect(retained.allocationReviews).toHaveLength(2);
      expect(
        retained.intents.some(
          (i) => i.amendmentOf === filings.filing.intent.id && i.filed,
        ),
      ).toBe(true);
      expect(retained.periods[0]).toMatchObject({
        filed: true,
        paid: true,
        fulfilled: false,
        unconfirmedWorkCount: 1,
      });
      const original = (
        await f.target.admin.query<{ body: string }>(
          "SELECT body FROM tax_filing_bytes WHERE id=$1",
          [filings.filing.artifact.id],
        )
      ).rows[0].body;
      expect(Buffer.from(original, "base64")).toEqual(filings.filing.bytes);
      await expect(
        filings.readExpiredOriginal(runtimeDatabase(f.target.runtime)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(JSON.stringify(actual)).not.toContain(filings.marker);
      await h.admin.query(
        "UPDATE platform_operator SET tax=false WHERE user_id=$1",
        [filings.actor.userId],
      );
      await expect(
        targetFilings.workspace(filings.operator),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await h.admin.query(
        "UPDATE platform_operator SET tax=true WHERE user_id=$1",
        [filings.actor.userId],
      );
      await expect(verifyRuntimeRole(f.target.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    });
  });
});
