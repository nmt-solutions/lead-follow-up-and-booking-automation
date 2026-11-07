import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { fundedUpiFixture } from "./support/upi";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";
import { verifyRuntimeRole } from "../src/db/runtime";
import { runtimeDatabase } from "../src/db/runtime";
import { createReachChangeApplication } from "../src/application/reach-changes";
import { createReachChangeRepository } from "../src/db/reach-change-repository";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { upiFixturePolicy } from "./support/upi";

describe("UPI immutable persistence and restricted runtime", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let f: Awaited<ReturnType<typeof fundedUpiFixture>>;
  beforeEach(async () => {
    h = await createHarness();
    f = await fundedUpiFixture(h);
  });
  afterEach(async () => h?.close());
  it.each(["reach", "payment"])(
    "refuses %s private reads after genuine session expiry during database serialization even with a frozen application clock",
    async (surface) => {
      let authenticated!: () => void;
      const arrived = new Promise<void>((resolve) => {
        authenticated = resolve;
      });
      const authenticate = async (credentials: Headers) => {
        const actor = await h.access.authenticateForWork(credentials);
        await h.admin.query(
          "UPDATE session SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
          [actor.sessionId],
        );
        authenticated();
        return actor;
      };
      const database = runtimeDatabase(h.runtime),
        deps = {
          authenticate,
          authenticatePlatform: h.access.authenticatePlatformForWork,
          gateway: f.gateway,
          clock: h.clock,
        };
      const app =
        surface === "reach"
          ? createReachChangeApplication({
              ...deps,
              repository: createReachChangeRepository(database, h.clock),
              policy: upiFixturePolicy,
            })
          : createSubscriptionPaymentApplication({
              ...deps,
              repository: createSubscriptionPaymentRepository(database),
            });
      const blocker = await h.admin.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [f.business.id],
        );
        const read = app.workspace(f.owner, f.business.id);
        await arrived;
        await blocker.query("SELECT pg_sleep(0.25)");
        await blocker.query("COMMIT");
        await expect(read).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      expect(f.mutations).toHaveLength(3);
    },
  );
  it("rejects a raw customer validation, forged worker proof and unscoped private history", async () => {
    const actor = await h.access.authenticateForWork(f.owner),
      client = await h.runtime.connect();
    try {
      await client.query("BEGIN");
      expect(
        (await client.query("SELECT * FROM reach_change_event")).rows,
      ).toEqual([]);
      await client.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.upi_at',$3,true)",
        [actor.userId, f.business.id, h.clock.now().toISOString()],
      );
      expect(
        (
          await client.query(
            "SELECT public.upi_review_current($1,$2,$3) allowed",
            [f.change.id, f.business.id, h.clock.now().toISOString()],
          )
        ).rows[0].allowed,
      ).toBe(true);
      await expect(
        client.query(
          "INSERT INTO reach_change_event(id,business_id,change_id,key,actor_id,at,fact) VALUES(gen_random_uuid(),$1,$2,'forged-review',$3,clock_timestamp(),'{\"kind\":\"method_review\"}')",
          [f.business.id, f.change.id, actor.userId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.actor_id','',true),set_config('app.business_id',$1,true),set_config('app.reach_change',$2,true),set_config('app.reach_capability','00000000-0000-0000-0000-000000000000',true)",
        [f.business.id, f.change.id],
      );
      expect(
        (
          await client.query(
            "SELECT public.upi_review_current($1,$2,$3) allowed",
            [f.change.id, f.business.id, h.clock.now().toISOString()],
          )
        ).rows[0].allowed,
      ).toBe(false);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(f.mutations).toHaveLength(3);
  });
  it.each(["SELECT", "INSERT"])(
    "requires %s independently on every touched reach ledger",
    async (privilege) => {
      for (const table of ["reach_change", "reach_change_event"]) {
        await h.admin.query(
          `REVOKE ${privilege} ON public.${table} FROM app_runtime`,
        );
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
        await secureDatabase(h.admin);
        await verifyRuntimeRole(h.runtime);
      }
      expect(f.mutations).toHaveLength(3);
    },
  );
  it.each([
    "protect_upi_reach_event()",
    "upi_review_current(uuid,uuid,timestamptz)",
  ])(
    "rejects implicit PUBLIC/default execution on %s and restores exact private/runtime ACLs",
    async (signature) => {
      await h.admin.query(
        "UPDATE pg_proc SET proacl=NULL WHERE oid=$1::regprocedure",
        [`public.${signature}`],
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      await secureDatabase(h.admin);
      await verifyRuntimeRole(h.runtime);
      expect(
        (
          await h.runtime.query(
            "SELECT has_function_privilege(current_user,'public.protect_upi_reach_event()','EXECUTE') private,has_function_privilege(current_user,'public.upi_review_current(uuid,uuid,timestamptz)','EXECUTE') operational",
          )
        ).rows[0],
      ).toEqual({ private: false, operational: true });
    },
  );
  describe("populated managed reapplication", () => {
    let rows: unknown[],
      functions: unknown[],
      constraints: unknown[],
      columns: unknown[];
    const inventory = async () => ({
      rows: (
        await h.admin.query(
          "SELECT c.table_name,(SELECT '') padding FROM information_schema.tables c WHERE c.table_schema='public' ORDER BY c.table_name",
        )
      ).rows,
      functions: (
        await h.admin.query(
          "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.pronamespace='public'::regnamespace ORDER BY 1",
        )
      ).rows,
      constraints: (
        await h.admin.query(
          "SELECT conrelid::regclass::text relation,conname,pg_get_constraintdef(oid) definition,convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2",
        )
      ).rows,
      columns: (
        await h.admin.query(
          "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
        )
      ).rows,
    });
    let fingerprints: unknown[];
    const facts = async () => {
      const names = (
        await h.admin.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows;
      const result = [];
      for (const { tablename } of names) {
        const quoted = `"${tablename.replaceAll('"', '""')}"`;
        const value = (
          await h.admin.query(
            `SELECT count(*)::text count,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) digest FROM public.${quoted} r`,
          )
        ).rows[0];
        result.push({ table: tablename, ...value });
      }
      return result;
    };
    beforeEach(async () => {
      const actor = await h.access.authenticateForWork(f.owner);
      ({ rows, functions, constraints, columns } = await inventory());
      fingerprints = await facts();
      await prepareDatabaseRole(h.admin);
      const client = await h.runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.upi_actor_session',$3,true)",
          [actor.userId, f.business.id, actor.sessionId],
        );
        for (const query of [
          "SELECT * FROM reach_change",
          "SELECT * FROM reach_change_event",
          "INSERT INTO reach_change SELECT * FROM reach_change",
          "INSERT INTO reach_change_event SELECT * FROM reach_change_event",
          "SELECT public.upi_review_current($1,$2,clock_timestamp())",
          "SELECT public.protect_upi_reach_event()",
        ]) {
          await client.query("SAVEPOINT paused");
          await expect(
            client.query(
              query,
              query.includes("$1") ? [f.change.id, f.business.id] : [],
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("ROLLBACK TO SAVEPOINT paused");
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      await h.admin.query(
        "ALTER TABLE reach_change DROP CONSTRAINT reach_change_scope",
      );
      await h.admin.query(
        "ALTER TABLE reach_change ADD CONSTRAINT reach_change_scope UNIQUE(id,business_id)",
      );
    });
    it("preserves all populated UPI facts, every old column/constraint/function and restores paused scopes through full Drizzle prepare/schema/secure", async () => {
      await h.reapplySchema();
      await verifyRuntimeRole(h.runtime);
      expect(await facts()).toEqual(fingerprints);
      expect(await inventory()).toEqual({
        rows,
        functions,
        constraints,
        columns,
      });
      expect(f.mutations).toHaveLength(3);
    });
  });
});
