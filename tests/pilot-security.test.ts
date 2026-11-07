import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { verifyRuntimeRole } from "../src/db/runtime";
import { prepareDatabaseRole } from "../src/db/setup";
import { pilotFunctions, pilotTables } from "../src/db/pilot-security";

describe("Pilot restricted-role authorization and populated reapplication", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    s: Awaited<ReturnType<typeof pilotFixture>>;
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
  });
  afterAll(async () => h?.close());
  it("classifies a pilots-only operator in public MFA status and rechecks current capability without granting Business access", async () => {
    const credentials = await h.signIn("pilot-only-operator@example.com"),
      actor = await h.access.authenticateForWork(credentials);
    await h.admin.query(
      "insert into platform_operator(user_id,pilots) values($1,true)",
      [actor.userId],
    );
    expect(await h.access.status(credentials)).toMatchObject({
      required: true,
      operator: true,
      operatorVerified: true,
      readiness: "mfa-satisfied",
    });
    await expect(
      h.team.requirePlatformCapability(credentials, "pilots.manage"),
    ).resolves.toEqual({ capability: "pilots.manage" });
    await expect(
      s.pilots.workspace(credentials, s.f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.admin.query(
      "update session set mfa_verified_at=mfa_verified_at-interval '16 minutes' where id=$1",
      [actor.sessionId],
    );
    expect(await h.access.status(credentials)).toMatchObject({
      required: true,
      operator: true,
      verified: true,
      operatorVerified: false,
      readiness: "mfa-incomplete",
    });
    await expect(
      h.team.requirePlatformCapability(credentials, "pilots.manage"),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await h.admin.query("update session set mfa_verified_at=$2 where id=$1", [
      actor.sessionId,
      h.clock.now(),
    ]);
    await h.admin.query(
      "update platform_operator set pilots=false where user_id=$1",
      [actor.userId],
    );
    expect(await h.access.status(credentials)).toMatchObject({
      required: false,
      operator: false,
    });
    await expect(
      h.team.requirePlatformCapability(credentials, "pilots.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("denies foreign scopes, helper cost inspection, direct effect insertion and stale current MFA", async () => {
    const stranger = await h.signIn("foreign-pilot-security@example.com"),
      foreign = await h.access.authenticateForWork(stranger);
    const client = await h.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true)",
        [foreign.userId, s.f.business.id, foreign.sessionId],
      );
      for (const table of pilotTables)
        expect(
          (await client.query(`select * from public.${table}`)).rows,
        ).toEqual([]);
      expect(
        (
          await client.query(
            "select public.reserve_pilot_effect($1,'discovery','forged',1) allowed,public.pilot_path_allowed($1,'mailbox','{}') path",
            [s.f.business.id],
          )
        ).rows,
      ).toEqual([{ allowed: false, path: false }]);
      for (const query of [
        "select public.pilot_global_room('INR',0)",
        "insert into pilot_effect(id,business_id,pilot_id,kind,operation_id,quantity,cash_minor,spend_minor,global_inr_micros,seconds) values(gen_random_uuid(),$1,$2,'discovery','forged',1,0,0,0,1)",
      ]) {
        await client.query("SAVEPOINT denied");
        await expect(
          client.query(
            query,
            query.includes("$1") ? [s.f.business.id, s.pilot.id] : [],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK TO SAVEPOINT denied");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const actor = await h.access.authenticateForWork(s.f.owner);
    await h.admin.query(
      "update session set mfa_verified_at=clock_timestamp()-interval '16 minutes' where id=$1",
      [actor.sessionId],
    );
    await expect(
      s.pilots.effort(s.f.owner, s.f.business.id, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
        kind: "support",
        seconds: 1,
        cashMinor: "0",
        spendMinor: "0",
        evidence: "fixture:actual-support",
        occurredAt: h.clock.now().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query("update session set mfa_verified_at=$2 where id=$1", [
      actor.sessionId,
      h.clock.now(),
    ]);
  });
  it("checks SELECT and INSERT grants independently at startup", async () => {
    for (const table of pilotTables) {
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(
          `REVOKE ${privilege} ON public.${table} FROM app_runtime`,
        );
        try {
          await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
        } finally {
          await h.admin.query(
            `GRANT ${privilege} ON public.${table} TO app_runtime`,
          );
        }
      }
    }
    await verifyRuntimeRole(h.runtime);
  });
  it("keeps every populated pilot row, all constraints and unaffected helper bodies through prepare/schema/secure; preparation denies helpers and writes", async () => {
    const before = await s.pilots.workspace(s.f.owner, s.f.business.id);
    async function content() {
      const tables = (
        await h.admin.query<{ name: string }>(
          "select tablename name from pg_tables where schemaname='public' order by tablename",
        )
      ).rows;
      const rows = [];
      for (const table of tables) {
        const identifier = '"' + table.name.replaceAll('"', '""') + '"';
        rows.push({
          table: table.name,
          ...(
            await h.admin.query(
              `select count(*)::text count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) fingerprint from public.${identifier} t`,
            )
          ).rows[0],
        });
      }
      return rows;
    }
    const originalContent = await content();
    const constraints = (
      await h.admin.query(
        "select conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by 1,2",
      )
    ).rows;
    const bodies = (
      await h.admin.query(
        "select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) fingerprint from pg_proc where pronamespace='public'::regnamespace order by 1",
      )
    ).rows;
    await h.admin.query(
      "grant select on public.pilot_record to PUBLIC; grant execute on function public.pilot_global_room(text,numeric,jsonb) to PUBLIC",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await prepareDatabaseRole(h.admin);
    const client = await h.runtime.connect();
    try {
      await client.query("BEGIN");
      for (const query of [
        ...pilotTables.map((t) => `select * from public.${t}`),
        ...pilotTables.map(
          (t) =>
            `insert into public.${t} select * from public.${t} where false`,
        ),
        ...pilotFunctions.map(
          (f) =>
            ({
              pilot_global_room: "select public.pilot_global_room('INR',0)",
              reserve_pilot_effect:
                "select public.reserve_pilot_effect(gen_random_uuid(),'discovery','x',1)",
              pilot_effect_current:
                "select public.pilot_effect_current(gen_random_uuid(),'discovery','x')",
              pilot_path_allowed:
                "select public.pilot_path_allowed(gen_random_uuid(),'discovery','{}')",
            })[f] ?? `select public.${f}()`,
        ),
      ]) {
        await client.query("SAVEPOINT paused");
        await expect(client.query(query)).rejects.toMatchObject({
          code: "42501",
        });
        await client.query("ROLLBACK TO SAVEPOINT paused");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(await content()).toEqual(originalContent);
    expect(await s.pilots.workspace(s.f.owner, s.f.business.id)).toEqual(
      before,
    );
    expect(
      (
        await h.admin.query(
          "select conrelid::regclass::text table_name,conname,pg_get_constraintdef(oid) definition from pg_constraint where connamespace='public'::regnamespace order by 1,2",
        )
      ).rows,
    ).toEqual(constraints);
    expect(
      (
        await h.admin.query(
          "select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) fingerprint from pg_proc where pronamespace='public'::regnamespace order by 1",
        )
      ).rows,
    ).toEqual(bodies);
    console.info("Pilot inventory", constraints.length, bodies.length);
    if (process.env.PILOT_TEST_EVIDENCE_FILE) {
      const catalog = (
        await h.admin.query(
          "select c.relname table_name,c.relrowsecurity,c.relforcerowsecurity,c.relacl,pg_get_userbyid(c.relowner) owner from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('pilot_record','pilot_event','pilot_effect') order by 1",
        )
      ).rows;
      const columns = (
        await h.admin.query(
          "select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and (table_name in ('pilot_record','pilot_event','pilot_effect') or table_name='platform_operator' and column_name='pilots') order by table_name,ordinal_position",
        )
      ).rows;
      const policies = (
        await h.admin.query(
          "select * from pg_policies where schemaname='public' and tablename in ('pilot_record','pilot_event','pilot_effect') order by tablename,policyname",
        )
      ).rows;
      const functions = (
        await h.admin.query(
          "select oid::regprocedure::text signature,prosecdef,proconfig,proacl,pg_get_userbyid(proowner) owner,md5(pg_get_functiondef(oid)) fingerprint from pg_proc where pronamespace='public'::regnamespace order by 1",
        )
      ).rows;
      const indexes = (
        await h.admin.query(
          "select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('pilot_record','pilot_event','pilot_effect') order by 1,2",
        )
      ).rows;
      const defaults = (
        await h.admin.query(
          "select defaclrole::regrole::text owner,defaclnamespace::regnamespace::text schema,defaclobjtype,defaclacl from pg_default_acl order by 1,2,3",
        )
      ).rows;
      await writeFile(
        process.env.PILOT_TEST_EVIDENCE_FILE,
        JSON.stringify(
          {
            isolated: true,
            actualTargetAccessed: false,
            postgresVersion: (await h.admin.query("show server_version"))
              .rows[0],
            contentPreserved: originalContent,
            constraintsPreserved: constraints,
            functionsPreserved: functions,
            tables: catalog,
            columns,
            policies,
            indexes,
            defaultACL: defaults,
          },
          null,
          2,
        ),
      );
    }
  });
});
