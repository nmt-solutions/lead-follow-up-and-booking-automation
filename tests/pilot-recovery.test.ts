import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createHarness } from "./support/harness";
import { pilotSetupFixture } from "./support/pilot-setup";
import { runtimeDatabase } from "../src/db/runtime";
import type { MailboxWork } from "../src/models/mailboxes";
import { recoveryFixture } from "./support/recovery";
import { recoverySchemaDefinitionHash } from "../src/recovery/postgres";
import { verifyRuntimeRole } from "../src/db/runtime";

describe("Populated pilot archive restore and reviewed schema repair", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    s: Awaited<ReturnType<typeof pilotSetupFixture>>,
    r: Awaited<ReturnType<typeof recoveryFixture>>,
    operationId: string,
    setupWork: MailboxWork,
    nativeReads: number;
  const ledgerRows = new Map<string, unknown[]>();
  async function evidence(mode: string) {
    if (!process.env.PILOT_RECOVERY_EVIDENCE_PATH) return;
    await writeFile(
      `${process.env.PILOT_RECOVERY_EVIDENCE_PATH}.${mode}.json`,
      JSON.stringify(
        {
          mode,
          bundleHash: r.archive.manifest.schemaHash,
          nativeSchemaHash: r.archive.manifest.nativeSchemaHash,
          archiveHash: createHash("sha256")
            .update(r.archive.ciphertext)
            .digest("hex"),
          ledgers: Object.fromEntries(
            [...ledgerRows].map(([table, rows]) => [
              table,
              {
                count: rows.length,
                sha256: createHash("sha256")
                  .update(JSON.stringify(rows))
                  .digest("hex"),
              },
            ]),
          ),
          restoreCalls: r.controls.restoreCalls,
          nativeMutations: s.mutations.length,
          nativeMailboxAttempts: nativeReads,
          populatedSetupAuthorization: true,
          ordinaryStartupRejected: true,
        },
        null,
        2,
      ),
    );
  }
  beforeAll(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    s = await pilotSetupFixture(h, true, true);
    const setupKey = randomUUID();
    await s.pilots.authorizeSetup(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: setupKey,
      mailboxId: s.mailboxId,
      maxNativeCalls: 30,
      durationSeconds: 300,
      evidence: "fixture:original-retained-setup-approval",
      acceptReadOnlySetup: true,
    });
    setupWork = await s.mailboxes.queue(
      s.f.owner,
      s.f.business.id,
      s.mailboxId,
      { mode: "incremental", pilotSetupRequestKey: setupKey },
    );
    let sync = await s.mailboxes.execute(setupWork);
    for (let page = 0; page < 6 && sync?.status === "partial"; page++)
      sync = await s.mailboxes.execute(setupWork);
    expect(sync?.status).toBe("completed");
    nativeReads = s.google.calls.length;
    await s.app.confirmPilotCheckout(s.f.owner, s.f.business.id, {
      actionId: s.action.id,
      orderId: "order_pilot",
      paymentId: "pay_pilot",
      signature: createHmac("sha256", "fixture-api-secret")
        .update("order_pilot|pay_pilot")
        .digest("hex"),
    });
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    await s.discovery.start(s.f.owner, s.f.business.id, s.request());
    await s.discovery.execute(s.queued.at(-1));
    // A second public approval deliberately remains queued with current source
    // authority before backup. Quarantine must fence this genuinely live intent.
    const pendingSetup = randomUUID();
    await s.pilots.authorizeSetup(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: pendingSetup,
      mailboxId: s.mailboxId,
      maxNativeCalls: 10,
      durationSeconds: 900,
      evidence: "fixture:retained-pending-repair",
      acceptReadOnlySetup: true,
    });
    setupWork = await s.mailboxes.queue(
      s.f.owner,
      s.f.business.id,
      s.mailboxId,
      { mode: "incremental", pilotSetupRequestKey: pendingSetup },
    );
    expect(setupWork.jobId).toBe(pendingSetup);
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
          Math.floor(h.clock.now().getTime() / 1000) * 1000 + 600000,
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
      "subscription_payment_history",
      "mailbox_job",
    ])
      ledgerRows.set(
        table,
        (
          await h.admin.query(
            `select to_jsonb(t) value from public.${table} t order by id`,
          )
        ).rows,
      );
    expect(
      JSON.stringify(ledgerRows.get("subscription_payment_history")),
    ).toContain(
      createHmac("sha256", "fixture-api-secret")
        .update("order_pilot|pay_pilot")
        .digest("hex"),
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
    await expect(
      s.mailboxesFor(runtimeDatabase(r.target.runtime)).execute(setupWork),
    ).rejects.toThrow();
    expect(s.google.calls).toHaveLength(nativeReads);
    expect(s.mutations).toHaveLength(2);
    await evidence("physical");
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
      await expect(
        s.mailboxesFor(runtimeDatabase(r.target.runtime)).execute(setupWork),
      ).rejects.toThrow();
      expect(s.google.calls).toHaveLength(nativeReads);
      await evidence("reviewed_schema_repair");
    });
  });
});
