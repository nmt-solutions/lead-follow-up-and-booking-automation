import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";

describe("Pilot review authority boundaries", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());

  it("does not execute a captured paid pilot before its first bounded operating plan exists", async () => {
    let observed = false;
    const s = await pilotFixture(h, {}, async (native) => ({
      plan: {},
      async beforePrepare(discovery, queued, searches, pilots) {
        observed = true;
        expect(
          (await pilots.workspace(native.f.owner, native.f.business.id)).pilots,
        ).toEqual([]);
        await discovery.start(native.f.owner, native.f.business.id, {
          markets: ["Pune"],
          publicOffering: "Steel",
          confirmPublicQuery: true,
          budget: 2,
          requestKey: randomUUID(),
        });
        await discovery.execute(queued.at(-1)).catch(() => {});
        expect(searches).toHaveLength(0);
        const visible = await discovery.workspace(
          native.f.owner,
          native.f.business.id,
        );
        expect(visible.runs).toHaveLength(1);
        expect(visible.runs[0]).toMatchObject({ used: 0 });
        expect(visible.prospects).toEqual([]);
      },
    }));
    expect(observed).toBe(true);
    expect(
      (await s.pilots.workspace(s.f.owner, s.f.business.id)).pilots[0].usage,
    ).toMatchObject({ cashMinor: "0", spendMinor: "0", seconds: 0 });
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.discovery.execute(s.queued.at(-1));
    expect(s.searches).toHaveLength(1);
    expect(
      (await s.discovery.workspace(s.f.owner, s.f.business.id)).prospects,
    ).toHaveLength(1);
  });

  it("refuses raw renewal and reuse milestones without measured results and an actual monthly capture", async () => {
    const s = await pilotFixture(h),
      actor = await h.access.authenticateForWork(s.f.owner),
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true)",
        [actor.userId, s.f.business.id, actor.sessionId],
      );
      for (const kind of ["renewal", "reuse"]) {
        await client.query("savepoint denied");
        await expect(
          client.query(
            "insert into pilot_event(id,business_id,pilot_id,request_key,kind,actor_id,data) values($1,$2,$3,$4,$5,$6,'{}')",
            [
              randomUUID(),
              s.f.business.id,
              s.pilot.id,
              randomUUID(),
              kind,
              actor.userId,
            ],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to savepoint denied");
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(
      (await s.pilots.workspace(s.f.owner, s.f.business.id)).pilots[0]
        .financialEvidence.renewalPaid,
    ).toBe(false);
  });

  it("binds a preparation request to its original actor while another current operator can prepare a distinct request", async () => {
    const s = await pilotFixture(h),
      input = { requestKey: randomUUID(), plan: s.plan },
      original = await s.pilots.prepare(s.f.owner, s.f.business.id, input),
      other = await h.signIn("second-pilot-reviewer@example.com"),
      actor = await h.access.authenticateForWork(other);
    await h.admin.query(
      "insert into membership(business_id,user_id,role) values($1,$2,'admin')",
      [s.f.business.id, actor.userId],
    );
    await h.admin.query(
      "insert into platform_operator(user_id,pilots) values($1,true)",
      [actor.userId],
    );
    await expect(
      s.pilots.prepare(other, s.f.business.id, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await s.pilots.prepare(s.f.owner, s.f.business.id, input),
    ).toMatchObject({ id: original.id });
    expect(
      await s.pilots.prepare(other, s.f.business.id, {
        ...input,
        requestKey: randomUUID(),
      }),
    ).not.toMatchObject({ id: original.id });
    const period = (await s.app.workspace(s.f.owner, s.f.business.id))
        .periods[0],
      monthlyInput = {
        originalActionId: s.action.id,
        originalPeriodId: period.id,
        requestKey: randomUUID(),
        startAt: period.end,
        approvalExpiresAt: new Date(
          Math.floor(h.clock.now().getTime() / 1000) * 1000 + 600000,
        ).toISOString(),
        agreeSeparateMandate: true,
      },
      monthly = await s.app.preparePilotRenewal(
        s.f.owner,
        s.f.business.id,
        monthlyInput,
      );
    await expect(
      s.app.preparePilotRenewal(other, s.f.business.id, monthlyInput),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await s.app.preparePilotRenewal(s.f.owner, s.f.business.id, monthlyInput),
    ).toMatchObject({ id: monthly.id });
  });

  it("refuses raw pilot plans with missing agreement evidence or nonnumeric baseline and criteria", async () => {
    const s = await pilotFixture(h),
      actor = await h.access.authenticateForWork(s.f.owner),
      snapshot = (
        await h.admin.query("select snapshot from pilot_record where id=$1", [
          s.pilot.id,
        ])
      ).rows[0].snapshot,
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true)",
        [actor.userId, s.f.business.id, actor.sessionId],
      );
      for (const change of [
        { approvalEvidence: "" },
        { goal: "" },
        { baseline: [{ ...snapshot.plan.baseline[0], value: "unmeasured" }] },
        { criteria: [{ ...snapshot.plan.criteria[0], target: null }] },
      ]) {
        await client.query("savepoint denied");
        await expect(
          client.query(
            "insert into pilot_record(id,business_id,request_key,actor_id,snapshot) values($1,$2,$3,$4,$5)",
            [
              randomUUID(),
              s.f.business.id,
              randomUUID(),
              actor.userId,
              { ...snapshot, plan: { ...snapshot.plan, ...change } },
            ],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to savepoint denied");
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("refuses raw negative or incomplete effort facts that would release approved cash, spend or time", async () => {
    const s = await pilotFixture(h),
      actor = await h.access.authenticateForWork(s.f.owner),
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true),set_config('app.at','2100-01-01T00:00:00Z',true)",
        [actor.userId, s.f.business.id, actor.sessionId],
      );
      const valid = {
        kind: "support",
        seconds: 1,
        cashMinor: "0",
        spendMinor: "0",
        evidence: "fixture:measured-original",
        occurredAt: h.clock.now().toISOString(),
        measurement: "attributed_actual_input",
      };
      for (const invalid of [
        { ...valid, seconds: -1000 },
        { ...valid, cashMinor: "-1000" },
        { ...valid, spendMinor: "-1000" },
        { ...valid, spendMinor: null },
        { ...valid, occurredAt: "2100-01-01T00:00:00Z" },
        {},
      ]) {
        await client.query("savepoint denied");
        await expect(
          client.query(
            "insert into pilot_event(id,business_id,pilot_id,request_key,kind,actor_id,data) values($1,$2,$3,$4,'effort',$5,$6)",
            [
              randomUUID(),
              s.f.business.id,
              s.pilot.id,
              randomUUID(),
              actor.userId,
              invalid,
            ],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to savepoint denied");
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(
      (await s.pilots.workspace(s.f.owner, s.f.business.id)).pilots[0].usage,
    ).toMatchObject({ cashMinor: "0", spendMinor: "0", seconds: 0 });
  });

  it("refuses raw activation without the separate original owner approval", async () => {
    const s = await pilotFixture(h),
      prepared = await s.pilots.prepare(s.f.owner, s.f.business.id, {
        requestKey: randomUUID(),
        plan: s.plan,
      }),
      actor = await h.access.authenticateForWork(s.f.owner),
      client = await h.runtime.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true)",
        [actor.userId, s.f.business.id, actor.sessionId],
      );
      await expect(
        client.query(
          "insert into pilot_event(id,business_id,pilot_id,request_key,kind,actor_id,data) values($1,$2,$3,$4,'activated',$5,$6)",
          [
            randomUUID(),
            s.f.business.id,
            prepared.id,
            randomUUID(),
            actor.userId,
            { gates: [] },
          ],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(
      (await s.pilots.workspace(s.f.owner, s.f.business.id)).pilots.find(
        (p) => p.id === prepared.id,
      )?.status,
    ).toBe("prepared");
  });
});
