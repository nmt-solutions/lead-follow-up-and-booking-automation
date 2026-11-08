import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotSetupFixture } from "./support/pilot-setup";

describe("Explicit bounded pilot mailbox setup", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  const approval = (
    s: Awaited<ReturnType<typeof pilotSetupFixture>>,
    changes = {},
  ) => ({
    pilotId: s.pilot.id,
    requestKey: randomUUID(),
    mailboxId: s.mailboxId,
    maxNativeCalls: 30,
    durationSeconds: 300,
    evidence: "fixture:explicit-owner-read-only-repair",
    acceptReadOnlySetup: true,
    ...changes,
  });
  async function refreshCosts(
    s: Awaited<ReturnType<typeof pilotSetupFixture>>,
  ) {
    // New native refresh/job observations still need independent cost coverage.
    const month = h.clock.now().toISOString().slice(0, 7);
    await s.costs.refresh(s.f.owner, { month, retentionSeconds: 86400 });
    const costs = await s.costs.workspace(s.f.owner, month);
    const covered = new Set(
      costs.history.flatMap((record) => record.source.coversSourceIds ?? []),
    );
    await s.costs.record(s.f.owner, {
      sourceId: `evidence:setup-normalization:${randomUUID()}`,
      expectedVersion: 0,
      reason: "Synthetic observed worker statement",
      retentionSeconds: 86400,
      source: {
        month,
        provider: "mailbox_job",
        category: "workers",
        kind: "commitment",
        funding: "cash",
        amount: { currency: "INR", micros: "1000" },
        quantity: 1,
        unit: "statement",
        businessId: s.f.business.id,
        runId: null,
        allocation: "fixture:selected-setup",
        evidence: "fixture:measured-worker-statement",
        observedAt: h.clock.now().toISOString(),
        freshUntil: new Date(h.clock.now().getTime() + 86400000).toISOString(),
        plan: null,
        status: "recorded",
        details: {},
        coversSourceIds: [
          ...new Set(
            costs.history
              .filter(
                (record) =>
                  record.sourceId.startsWith("native:mailbox-job:") &&
                  !covered.has(record.sourceId),
              )
              .map((record) => record.sourceId),
          ),
        ],
      },
    });
  }

  it("repairs a paid prepared pilot whose selected native synchronization becomes stale before activation", async () => {
    const s = await pilotSetupFixture(h),
      b = s.f.business.id,
      c = s.f.owner;
    expect(
      (
        await s.pilots.preflight(c, b, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.find((gate) => gate.capability === "mailbox")?.ready,
    ).toBe(true);
    h.clock.set(new Date(h.clock.now().getTime() + 360000).toISOString());
    expect(
      (
        await s.pilots.preflight(c, b, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.find((gate) => gate.capability === "mailbox")?.ready,
    ).toBe(false);
    await expect(
      s.pilots.activate(c, b, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    const ordinary = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
    });
    await expect(s.mailboxes.execute(ordinary)).rejects.toMatchObject({
      code: "PAID_ACCESS_REQUIRED",
    });
    // The unpriced ordinary job remains a real cost input, even without native I/O.
    await refreshCosts(s);
    const requestKey = randomUUID();
    await s.pilots.authorizeSetup(c, b, {
      pilotId: s.pilot.id,
      requestKey,
      mailboxId: s.mailboxId,
      maxNativeCalls: 30,
      durationSeconds: 300,
      evidence: "fixture:explicit-owner-read-only-repair",
      acceptReadOnlySetup: true,
    });
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: requestKey,
    });
    let result = await s.mailboxes.execute(work);
    for (let page = 0; page < 6 && result?.status === "partial"; page++)
      result = await s.mailboxes.execute(work);
    expect(result).toMatchObject({ status: "completed" });
    const ready = await s.pilots.preflight(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect(ready.gates.filter((gate) => !gate.ready)).toEqual([]);
    expect(ready.status).toBe("approved");
    await s.pilots.activate(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect((await s.pilots.workspace(c, b)).pilots[0].status).toBe("active");
    expect(
      s.mutations.filter((mutation) => mutation.path === "/v1/orders"),
    ).toHaveLength(1);
  });
  it("requires a persisted explicit setup authorization even when ordinary active-pilot reads are allowed", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id;
    await s.pilots.activate(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    const calls = s.google.calls.length;
    await expect(
      s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "incremental",
        pilotSetupRequestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PAID_ACCESS_REQUIRED" });
    expect(s.google.calls).toHaveLength(calls);
    const ordinary = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
    });
    expect(await s.mailboxes.execute(ordinary)).toMatchObject({
      status: "completed",
    });
  });
  it("repairs genuinely incomplete selected input without another payment or automatic activation", async () => {
    const s = await pilotSetupFixture(h, false),
      b = s.f.business.id,
      c = s.f.owner,
      input = approval(s);
    await s.pilots.authorizeSetup(c, b, input);
    const first = (await s.pilots.workspace(c, b)).pilots[0].events.find(
      (event) => event.kind === "setup_authorized",
    )!;
    await s.pilots.authorizeSetup(c, b, input);
    expect(
      (await s.pilots.workspace(c, b)).pilots[0].events.filter(
        (event) => event.kind === "setup_authorized",
      ),
    ).toEqual([first]);
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: input.requestKey,
    });
    let result = await s.mailboxes.execute(work);
    for (let page = 0; page < 6 && result?.status === "partial"; page++)
      result = await s.mailboxes.execute(work);
    expect(result).toMatchObject({ status: "completed" });
    const calls = s.google.calls.length;
    expect(await s.mailboxes.execute(work)).toBeNull();
    expect(s.google.calls).toHaveLength(calls);
    expect((await s.pilots.workspace(c, b)).pilots[0].status).toBe("approved");
    const used = (await s.pilots.workspace(c, b)).pilots[0].usage;
    expect(Number(used.cashMinor)).toBeGreaterThan(0);
    await refreshCosts(s);
    const ready = await s.pilots.preflight(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect(ready.gates.filter((gate) => !gate.ready)).toEqual([]);
    await s.pilots.activate(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect((await s.pilots.workspace(c, b)).pilots[0].usage).toEqual(used);
    expect(
      s.mutations.filter((mutation) => mutation.path === "/v1/orders"),
    ).toHaveLength(1);
  });
  it("captures a selected incoming message body through the approved setup job before activation", async () => {
    const s = await pilotSetupFixture(h, false),
      c = s.f.owner,
      b = s.f.business.id,
      input = approval(s);
    s.google.add("a1", { at: h.clock.now().toISOString() });
    s.google.pages.set("Label_sales", {
      messages: [{ id: "a1", threadId: "abc123" }],
    });
    await s.pilots.authorizeSetup(c, b, input);
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: input.requestKey,
    });
    let result = await s.mailboxes.execute(work);
    for (let page = 0; page < 6 && result?.status === "partial"; page++)
      result = await s.mailboxes.execute(work);
    expect(result).toMatchObject({ status: "completed", captured: 1 });
    expect(s.google.bodyReads).toEqual(["a1"]);
    expect(s.google.sends).toEqual([]);
    expect((await s.pilots.workspace(c, b)).pilots[0].status).toBe("approved");
  });
  it("holds every native refresh and uncertain request against the same finite setup allowance", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id,
      input = approval(s, { maxNativeCalls: 3 });
    await s.pilots.authorizeSetup(c, b, input);
    // Crossing the native access-token deadline never creates a fresh allowance.
    h.clock.set(new Date(h.clock.now().getTime() + 3601000).toISOString());
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: input.requestKey,
    });
    const before = s.google.calls.length;
    await s.mailboxes.execute(work).catch(() => {});
    expect(s.google.control.refreshes).toBe(1);
    expect(s.google.calls.length - before).toBeLessThanOrEqual(2);
    expect((await s.pilots.workspace(c, b)).pilots[0].usage).toMatchObject({
      cashMinor: "3",
      spendMinor: "3",
      seconds: 3,
    });
    const used = s.google.calls.length;
    await s.mailboxes.execute(work).catch(() => {});
    expect(s.google.calls).toHaveLength(used);
    expect((await s.pilots.workspace(c, b)).pilots[0].status).toBe("approved");
  });
  it("expires the original setup lease on database time under a frozen application clock", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id,
      input = approval(s, { durationSeconds: 1 }),
      frozen = h.clock.now().toISOString();
    const approved = await s.pilots.authorizeSetup(c, b, input),
      original = approved.events.find(
        (event) => event.kind === "setup_authorized",
      )!;
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: input.requestKey,
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const before = s.google.calls.length;
    await expect(s.mailboxes.execute(work)).rejects.toMatchObject({
      code: "PAID_ACCESS_REQUIRED",
    });
    expect(s.google.calls).toHaveLength(before);
    expect(h.clock.now().toISOString()).toBe(frozen);
    const replay = await s.pilots.authorizeSetup(c, b, input);
    expect(
      replay.events.find((event) => event.kind === "setup_authorized"),
    ).toEqual(original);
    await expect(
      s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "incremental",
        pilotSetupRequestKey: input.requestKey,
      }),
    ).rejects.toMatchObject({ code: "PAID_ACCESS_REQUIRED" });
  });
  it("rejects unapproved, foreign, unselected, history and outbound use including restricted raw forged inputs", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id,
      input = approval(s),
      stranger = await h.signIn("foreign-setup@example.com");
    await expect(
      s.pilots.authorizeSetup(stranger, b, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      s.pilots.authorizeSetup(c, b, { ...input, mailboxId: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const unapproved = await s.pilots.prepare(c, b, {
      plan: s.plan,
      requestKey: randomUUID(),
    });
    await expect(
      s.pilots.authorizeSetup(c, b, { ...input, pilotId: unapproved.id }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await expect(
      s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "incremental",
        pilotSetupRequestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PAID_ACCESS_REQUIRED" });
    await s.pilots.authorizeSetup(c, b, input);
    await expect(
      s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "history",
        pilotSetupRequestKey: input.requestKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const actor = await h.access.authenticateForWork(c),
      client = await h.runtime.connect(),
      calls = s.google.calls.length;
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true),set_config('app.pilot_session',$3,true),set_config('app.at','2100-01-01',true)",
        [actor.userId, b, actor.sessionId],
      );
      for (const kind of ["discovery", "automation", "calendar"])
        expect(
          (
            await client.query(
              "select public.reserve_pilot_effect($1,$2,$3,1,$4) allowed",
              [
                b,
                kind,
                `${input.requestKey}:0:inspect:${randomUUID()}`,
                {
                  jobId: input.requestKey,
                  mailboxId: s.mailboxId,
                  phase: "inspect",
                },
              ],
            )
          ).rows[0].allowed,
        ).toBe(false);
      for (const intent of [
        { jobId: input.requestKey, mailboxId: s.mailboxId },
        { jobId: input.requestKey, mailboxId: randomUUID(), phase: "inspect" },
        { jobId: randomUUID(), mailboxId: s.mailboxId, phase: "inspect" },
      ])
        expect(
          (
            await client.query(
              "select public.reserve_pilot_effect($1,'mailbox',$2,1,$3) allowed",
              [b, `${input.requestKey}:0:inspect:${randomUUID()}`, intent],
            )
          ).rows[0].allowed,
        ).toBe(false);
      await client.query("savepoint private");
      await expect(
        client.query("select public.pilot_setup_current($1,$2,$3)", [
          b,
          input.requestKey,
          s.mailboxId,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback to savepoint private");
      for (const data of [
        null,
        {
          input,
          jobId: randomUUID(),
          mailboxId: s.mailboxId,
          maxNativeCalls: 30,
          durationSeconds: 300,
        },
        {
          input,
          jobId: input.requestKey,
          mailboxId: s.mailboxId,
          maxNativeCalls: 100001,
          durationSeconds: 300,
        },
      ]) {
        await client.query("savepoint forged");
        await expect(
          client.query(
            "insert into pilot_event(id,business_id,pilot_id,request_key,kind,actor_id,data) values($1,$2,$3,$4,'setup_authorized',$5,$6)",
            [randomUUID(), b, s.pilot.id, randomUUID(), actor.userId, data],
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback to savepoint forged");
      }
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(s.google.calls).toHaveLength(calls);
    expect((await s.pilots.workspace(c, b)).pilots[0].usage).toMatchObject({
      cashMinor: "0",
      spendMinor: "0",
      seconds: 0,
    });
  });
  it("requires an explicit new plan after operational expiry then repairs and activates within the same captured paid period", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id,
      stamp = (
        await h.admin.query<{ now: Date }>("select clock_timestamp() now")
      ).rows[0].now;
    h.clock.set(stamp.toISOString());
    const plan = {
      ...s.plan,
      startsAt: stamp.toISOString(),
      endsAt: new Date(stamp.getTime() + 1500).toISOString(),
    };
    const short = await s.pilots.prepare(c, b, {
      plan,
      requestKey: randomUUID(),
    });
    await s.pilots.approve(c, b, {
      pilotId: short.id,
      requestKey: randomUUID(),
    });
    await s.pilots.activate(c, b, {
      pilotId: short.id,
      requestKey: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const later = (
      await h.admin.query<{ now: Date }>("select clock_timestamp() now")
    ).rows[0].now;
    h.clock.set(later.toISOString());
    await expect(
      s.pilots.authorizeSetup(c, b, { ...approval(s), pilotId: short.id }),
    ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
    await s.pilots.stop(c, b, { pilotId: short.id, requestKey: randomUUID() });
    const replacement = await s.pilots.prepare(c, b, {
      requestKey: randomUUID(),
      plan: {
        ...s.plan,
        startsAt: later.toISOString(),
        endsAt: new Date(later.getTime() + 3600000).toISOString(),
      },
    });
    await s.pilots.approve(c, b, {
      pilotId: replacement.id,
      requestKey: randomUUID(),
    });
    const input = { ...approval(s), pilotId: replacement.id };
    await s.pilots.authorizeSetup(c, b, input);
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
      mode: "incremental",
      pilotSetupRequestKey: input.requestKey,
    });
    let result = await s.mailboxes.execute(work);
    for (let page = 0; page < 6 && result?.status === "partial"; page++)
      result = await s.mailboxes.execute(work);
    expect(result).toMatchObject({ status: "completed" });
    const before = await s.pilots.preflight(c, b, {
      pilotId: replacement.id,
      requestKey: randomUUID(),
    });
    expect(before.status).toBe("approved");
    expect(before.gates.filter((gate) => !gate.ready)).toEqual([]);
    await s.pilots.activate(c, b, {
      pilotId: replacement.id,
      requestKey: randomUUID(),
    });
    expect(
      (await s.pilots.workspace(c, b)).pilots.find(
        (p) => p.id === replacement.id,
      )?.status,
    ).toBe("active");
    expect(
      (await s.pilots.workspace(c, b)).pilots.find((p) => p.id === short.id)
        ?.status,
    ).toBe("stopped");
    expect(
      s.mutations.filter((mutation) => mutation.path === "/v1/orders"),
    ).toHaveLength(1);
  });
  it.each(["operator", "mfa", "stop", "refund"])(
    "fences the original queued setup job after current %s withdrawal before native I/O",
    async (boundary) => {
      const s = await pilotSetupFixture(h),
        c = s.f.owner,
        b = s.f.business.id,
        input = approval(s);
      await s.pilots.authorizeSetup(c, b, input);
      const work = await s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "incremental",
        pilotSetupRequestKey: input.requestKey,
      });
      const actor = await h.access.authenticateForWork(c);
      if (boundary === "operator")
        await h.admin.query(
          "update platform_operator set pilots=false where user_id=$1",
          [actor.userId],
        );
      if (boundary === "mfa")
        await h.admin.query(
          "update session set mfa_verified_at=clock_timestamp()-interval '16 minutes' where id=$1",
          [actor.sessionId],
        );
      if (boundary === "stop")
        await s.pilots.stop(c, b, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        });
      if (boundary === "refund") {
        Object.assign(s.native.payments.get("pay_pilot")!, {
          amount_refunded: 1100,
          status: "refunded",
        });
        await s.app.refresh(c, b, { actionId: s.action.id });
      }
      const before = s.google.calls.length;
      await expect(s.mailboxes.execute(work)).rejects.toMatchObject({
        code: "PAID_ACCESS_REQUIRED",
      });
      expect(s.google.calls).toHaveLength(before);
      expect(
        s.mutations.filter((mutation) => mutation.path === "/v1/orders"),
      ).toHaveLength(1);
    },
  );
  it("retains unknown native observations against the original call cap without blind retries or false readiness", async () => {
    const s = await pilotSetupFixture(h),
      c = s.f.owner,
      b = s.f.business.id,
      input = approval(s, { maxNativeCalls: 4 });
    await s.pilots.authorizeSetup(c, b, input);
    const work = await s.mailboxes.queue(c, b, s.mailboxId, {
        mode: "incremental",
        pilotSetupRequestKey: input.requestKey,
      }),
      before = s.google.calls.length;
    s.google.control.apiError = 503;
    for (let attempt = 0; attempt < 3; attempt++)
      await s.mailboxes.execute(work).catch(() => {});
    expect(s.google.calls.length - before).toBe(2);
    expect((await s.pilots.workspace(c, b)).pilots[0].usage).toMatchObject({
      cashMinor: "4",
      spendMinor: "4",
      seconds: 4,
    });
    s.google.control.apiError = 0;
    await s.mailboxes.execute(work).catch(() => {});
    expect(s.google.calls.length - before).toBe(2);
    expect((await s.pilots.workspace(c, b)).pilots[0].status).toBe("approved");
  });
});
