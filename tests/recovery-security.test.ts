import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { recoveryFixture, pgTool } from "./support/recovery";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";
import { recoveryFunctions, recoveryTables } from "../src/db/recovery-security";
import { createRecoveryApplication } from "../src/application/infrastructure-recovery";
import { createRecoveryRepository } from "../src/db/recovery-repository";
import { createRecoveryHttp } from "../src/http/infrastructure-recovery";
import { createCostApplication } from "../src/application/costs";
import { createCostRepository } from "../src/db/cost-repository";

describe("Recovery authority, replay and database security", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    const owner = await h.signIn(
        `recovery-security-${randomUUID()}@example.com`,
      ),
      business = await h.application.createBusiness(owner, {
        name: "Recovery isolation",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    return {
      owner,
      business,
      r: await recoveryFixture(h, owner, business.id, [
        {
          id: "held-tax-file",
          bytes: Buffer.from("Retained original tax evidence"),
          retained: true,
        },
      ]),
    };
  }
  it("binds the immutable reviewed request to its original actor and rejects foreign, arbitrary privileged input and cross-origin commands", async () => {
    const { owner, business, r } = await fixture();
    try {
      const stranger = await h.signIn(
          `recovery-foreign-${randomUUID()}@example.com`,
        ),
        app = r.application();
      await expect(
        app.request(stranger, { planId: r.plan.id, requestKey: randomUUID() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const request = { planId: r.plan.id, requestKey: randomUUID() },
        saved = await app.request(owner, request);
      const other = await h.signIn(
        `recovery-other-${randomUUID()}@example.com`,
      );
      await h.admin.query(
        "INSERT INTO platform_operator(user_id,recovery) VALUES($1,true)",
        [(await h.authenticate(other)).userId],
      );
      await expect(app.request(other, request)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        app.run(other, { businessId: business.id, operationId: saved.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        app.run(owner, { businessId: randomUUID(), operationId: saved.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const changed = structuredClone(r.plan);
      changed.objectives.rtoSeconds++;
      await expect(
        r
          .application([changed])
          .run(owner, { businessId: business.id, operationId: saved.id }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      const diagnostics: unknown[] = [],
        http = createRecoveryHttp({
          application: app,
          origin: "http://localhost:3000",
          reportFailure: (d) => diagnostics.push(d),
        });
      const headers = new Headers(owner);
      headers.set("content-type", "application/json");
      headers.set("origin", "https://hostile.example");
      expect(
        (
          await http.request(
            new Request("http://localhost:3000/api/platform/recovery/request", {
              method: "POST",
              headers,
              body: JSON.stringify(request),
            }),
          )
        ).status,
      ).toBe(403);
      headers.set("origin", "http://localhost:3000");
      const response = await http.request(
        new Request("http://localhost:3000/api/platform/recovery/request", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...request,
            databaseUrl: "postgresql://private-secret",
            sql: "DROP DATABASE source",
            callback: "https://hostile.example",
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(
        JSON.stringify(await response.json()) + JSON.stringify(diagnostics),
      ).not.toMatch(/private-secret|hostile\.example|DROP DATABASE/);
    } finally {
      await r.close();
    }
  });
  it("rechecks current recovery authority before returning sensitive workspace state", async () => {
    const { owner, r } = await fixture();
    try {
      const identity = await h.authenticate(owner);
      let calls = 0;
      const app = createRecoveryApplication({
        authenticate: async (credentials: Headers) => {
          calls++;
          if (calls === 2)
            await h.admin.query(
              "UPDATE platform_operator SET recovery=false WHERE user_id=$1",
              [identity.userId],
            );
          return h.access.authenticateForWork(credentials);
        },
        repository: createRecoveryRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        plans: [r.plan],
        adapter: r.adapter(),
      });
      await expect(app.workspace(owner)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await r.close();
    }
  });
  it("denies substituted source/target/production identities and stale observations without advancing verification, then restarts the same operation", async () => {
    const { owner, business, r } = await fixture();
    try {
      const op = await r.request();
      r.controls.observedTarget = {
        ...r.plan.target,
        project: r.plan.source.project,
      };
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      let saved = (await r.application().workspace(owner)).operations.find(
        (o) => o.id === op.id,
      )!;
      expect(saved).toMatchObject({
        stage: "requested",
        events: expect.arrayContaining([
          expect.objectContaining({ outcome: "ambiguous" }),
        ]),
      });
      r.controls.observedTarget = r.plan.target;
      r.controls.expiresAt = "2000-01-01T00:00:00Z";
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      r.controls.expiresAt = r.plan.observationExpiresAt;
      await r.advance(op.id, 1);
      saved = (await r.application().workspace(owner)).operations.find(
        (o) => o.id === op.id,
      )!;
      expect(saved.stage).toBe("target_verified");
      expect(
        saved.events.filter((e) => e.outcome === "ambiguous"),
      ).toHaveLength(2);
      expect(
        (
          await r
            .application()
            .request(owner, { planId: r.plan.id, requestKey: op.requestKey })
        ).id,
      ).toBe(op.id);
      const invalid = {
        ...r.plan,
        target: { ...r.plan.target, environment: "production" },
      };
      await expect(
        r.application().request(owner, {
          planId: r.plan.id,
          requestKey: randomUUID(),
          target: invalid.target,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        r
          .application()
          .inspect(owner, { businessId: business.id, operationId: op.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await r.close();
    }
  });
  it("reconciles a committed restore after lost acknowledgement without running pg_restore again", async () => {
    const { owner, business, r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 1);
      r.controls.failAfterRestore = true;
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      expect(r.controls.restoreCalls).toBe(1);
      expect(
        (await r.application().workspace(owner)).operations.find(
          (o) => o.id === op.id,
        )?.stage,
      ).toBe("target_verified");
      await r.advance(op.id, 6);
      expect(r.controls.restoreCalls).toBe(1);
      expect(
        (
          await r
            .application()
            .inspect(owner, { businessId: business.id, operationId: op.id })
        ).facts,
      ).toEqual(expect.arrayContaining(r.archive.manifest.facts));
    } finally {
      await r.close();
    }
  });
  it.each(["expired", "reclaimed", "missing"])(
    "leaves the disposable target untouched when its %s lease changes during native identity I/O",
    async (change) => {
      const { r } = await fixture();
      try {
        const op = await r.request();
        r.controls.onObserve = async () => {
          if (change === "expired")
            await h.admin.query(
              "UPDATE infrastructure_recovery SET lease_until=statement_timestamp()-interval '1 second' WHERE id=$1",
              [op.id],
            );
          else
            await h.admin.query(
              "UPDATE infrastructure_recovery SET lease=$2 WHERE id=$1",
              [op.id, change === "reclaimed" ? randomUUID() : null],
            );
        };
        await expect(r.advance(op.id, 1)).rejects.toBeDefined();
        expect(
          (
            await r.target.admin.query(
              "SELECT operation_id FROM recovery_quarantine.target WHERE singleton",
            )
          ).rows[0].operation_id,
        ).toBeNull();
        expect(r.controls.restoreCalls).toBe(0);
      } finally {
        await r.close();
      }
    },
  );
  it("refuses native restore when the lease is reclaimed during the final target identity read", async () => {
    const { r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 1);
      let reads = 0;
      r.controls.onObserve = async () => {
        if (++reads === 2)
          await h.admin.query(
            "UPDATE infrastructure_recovery SET lease=gen_random_uuid() WHERE id=$1",
            [op.id],
          );
      };
      await expect(r.advance(op.id, 1)).rejects.toBeDefined();
      expect(r.controls.restoreCalls).toBe(0);
    } finally {
      await r.close();
    }
  });
  it("retains verified incurred restore facts after session authority is lost without advancing or exposing inspection", async () => {
    const { owner, business, r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 1);
      const identity = await h.authenticate(owner);
      r.controls.onRestored = async () => {
        await h.admin.query(
          "UPDATE platform_operator SET recovery=false WHERE user_id=$1",
          [identity.userId],
        );
      };
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        r
          .application()
          .inspect(owner, { businessId: business.id, operationId: op.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await h.admin.query(
        "UPDATE platform_operator SET recovery=true WHERE user_id=$1",
        [identity.userId],
      );
      const saved = (await r.application().workspace(owner)).operations.find(
        (row) => row.id === op.id,
      )!;
      expect(saved.stage).toBe("target_verified");
      expect(saved.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcome: "ambiguous",
            evidence: expect.objectContaining({
              incurredStage: "restored",
              physicalTarget: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          }),
        ]),
      );
      r.controls.onRestored = async () => {};
      await r.advance(op.id, 1);
      expect(r.controls.restoreCalls).toBe(1);
    } finally {
      await r.close();
    }
  });
  it("does not start a second native restore while a previous expired attempt still owns the disposable target", async () => {
    const { r } = await fixture();
    const started = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let first: Promise<unknown> | undefined;
    try {
      const op = await r.request();
      await r.advance(op.id, 1);
      r.controls.onRestoreStarted = async () => {
        if (r.controls.restoreCalls === 1) {
          started.resolve();
          await release.promise;
        }
      };
      first = r.advance(op.id, 1).catch((error: unknown) => error);
      await started.promise;
      await h.admin.query(
        "UPDATE infrastructure_recovery SET lease_until=statement_timestamp()-interval '1 second' WHERE id=$1",
        [op.id],
      );
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(r.controls.restoreCalls).toBe(1);
    } finally {
      release.resolve();
      await first;
      await r.close();
    }
  });
  it("rejects an unreviewed target index instead of attesting the intended resulting schema", async () => {
    const { r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 3);
      await r.target.admin.query(
        "CREATE INDEX unreviewed_recovery_index ON public.business(name)",
      );
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    } finally {
      await r.close();
    }
  });
  it("refuses an incompatible configured native tool before binding or restoring the target", async () => {
    const { r } = await fixture();
    try {
      const op = await r.request();
      r.controls.pgRestore = pgTool("pg_dump");
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      expect(
        (
          await r.target.admin.query(
            "SELECT operation_id FROM recovery_quarantine.target WHERE singleton",
          )
        ).rows[0].operation_id,
      ).toBeNull();
      expect(r.controls.restoreCalls).toBe(0);
    } finally {
      await r.close();
    }
  });
  it("keeps unavailable storage unresolved instead of recording a missing retained file", async () => {
    const { owner, r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 4);
      r.controls.beforeFileRead = async () => {
        throw Error("fixture storage connection unavailable");
      };
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      expect(
        (await r.application().workspace(owner)).operations.find(
          (row) => row.id === op.id,
        )?.stage,
      ).toBe("verified");
      expect(r.controls.targetFiles.size).toBe(0);
    } finally {
      await r.close();
    }
  });
  it("refuses another restore while a surviving native backend still owns the target transaction guard", async () => {
    const { r } = await fixture();
    const backend = await r.target.admin.connect();
    try {
      const op = await r.request();
      await r.advance(op.id, 1);
      await backend.query("BEGIN");
      await backend.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('infrastructure-recovery-native',0))",
      );
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(r.controls.restoreCalls).toBe(0);
    } finally {
      await backend.query("ROLLBACK");
      backend.release();
      await r.close();
    }
  });
  it("refuses an insufficient reviewed restore size before executing target SQL", async () => {
    const { r } = await fixture();
    try {
      r.plan.limits.restoreSqlBytes = 1;
      const op = await r.request();
      await r.advance(op.id, 1);
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
      expect(
        (
          await r.target.admin.query(
            "SELECT count(*)::integer AS count FROM pg_tables WHERE schemaname='public'",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await r.close();
    }
  });
  it("rechecks the currently approved server registry after native I/O before binding a target", async () => {
    const { owner, business, r } = await fixture();
    try {
      const approved = [r.plan],
        app = r.application(approved);
      const op = await app.request(owner, {
        planId: r.plan.id,
        requestKey: randomUUID(),
      });
      r.controls.onObserve = async () => {
        approved.length = 0;
      };
      await expect(
        app.run(owner, { businessId: business.id, operationId: op.id }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      expect(
        (
          await r.target.admin.query(
            "SELECT operation_id FROM recovery_quarantine.target WHERE singleton",
          )
        ).rows[0].operation_id,
      ).toBeNull();
    } finally {
      await r.close();
    }
  });
  it("preserves a failed schema attempt, unchanged backup and original operation across a new application instance", async () => {
    const { owner, business, r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 2);
      r.controls.failSchema = true;
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
      const failed = (await r.application().workspace(owner)).operations.find(
        (o) => o.id === op.id,
      )!;
      expect(failed).toMatchObject({
        stage: "restored",
        planHash: op.planHash,
        events: expect.arrayContaining([
          expect.objectContaining({ stage: "restored", outcome: "ambiguous" }),
        ]),
      });
      r.controls.failSchema = false;
      await r.advance(op.id, 5);
      const result = await r
        .application()
        .inspect(owner, { businessId: business.id, operationId: op.id });
      expect(result.facts).toEqual(
        expect.arrayContaining(r.archive.manifest.facts),
      );
      expect(
        (await r.application().workspace(owner)).operations.find(
          (o) => o.id === op.id,
        )?.planHash,
      ).toBe(op.planHash);
    } finally {
      await r.close();
    }
  });
  it("keeps corrupt or absent file bytes explicit, retries retained copies safely and never turns unknown native outcomes into a resend", async () => {
    const { owner, business, r } = await fixture();
    try {
      const op = await r.request();
      await r.advance(op.id, 4);
      r.controls.files.set("held-tax-file", Buffer.from("corrupt"));
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      r.controls.files.delete("held-tax-file");
      await r.advance(op.id, 3);
      const saved = (await r.application().workspace(owner)).operations.find(
        (o) => o.id === op.id,
      )!;
      expect(saved.stage).toBe("inspection_ready");
      expect(
        saved.events.find(
          (e) => e.stage === "quarantined" && e.outcome === "completed",
        )?.evidence.files?.[0].status,
      ).toBe("omitted");
      expect(
        saved.events.find(
          (e) => e.stage === "reconciled" && e.outcome === "completed",
        )?.evidence.unresolved,
      ).toContain("Current control-plane authorization unavailable");
      expect(
        (
          await r
            .application()
            .inspect(owner, { businessId: business.id, operationId: op.id })
        ).quarantined,
      ).toBe(true);
      expect(r.controls.targetFiles.size).toBe(0);
    } finally {
      await r.close();
    }
  });
  it("rechecks current authority after external reads and retains the original attempted stage when the actor is revoked", async () => {
    const { owner, r } = await fixture();
    try {
      const op = await r.request(),
        actor = await h.authenticate(owner);
      r.controls.onObserve = async () => {
        await h.admin.query(
          "UPDATE platform_operator SET recovery=false WHERE user_id=$1",
          [actor.userId],
        );
      };
      await expect(r.advance(op.id, 1)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await h.admin.query(
        "UPDATE platform_operator SET recovery=true WHERE user_id=$1",
        [actor.userId],
      );
      const saved = (await r.application().workspace(owner)).operations.find(
        (o) => o.id === op.id,
      )!;
      expect(saved.stage).toBe("requested");
      expect(saved.events).toEqual([
        expect.objectContaining({ stage: "requested", outcome: "started" }),
      ]);
      r.controls.onObserve = async () => {};
      // A caller's future application clock cannot expire the DB-owned destructive lease.
      const before = r.controls.targetFiles.size;
      const identity = await h.access.authenticateForWork(owner),
        client = await h.runtime.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.actor_id',$1,true),set_config('app.recovery_session',$2,true),set_config('app.business_id',$3,true),set_config('app.at','2100-01-01T00:00:00Z',true)",
          [identity.userId, identity.sessionId, r.plan.businessId],
        );
        expect(
          (
            await client.query(
              "SELECT public.claim_infrastructure_recovery($1) AS lease",
              [op.id],
            )
          ).rows[0].lease,
        ).toBeNull();
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      await r.advance(op.id, 1);
      expect(r.controls.targetFiles.size).toBe(before);
    } finally {
      await r.close();
    }
  });
  it("records infrastructure cost evidence once through independent cost authority, retaining unpriced usage and original currency", async () => {
    const { owner, r } = await fixture();
    try {
      const costs = createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
      });
      const app = createRecoveryApplication({
        authenticate: h.access.authenticateForWork,
        repository: createRecoveryRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        plans: [r.plan],
        adapter: r.adapter(),
        costs,
      });
      await expect(
        app.reconcileCosts(owner, { planId: r.plan.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await h.admin.query(
        "UPDATE platform_operator SET costs=true WHERE user_id=$1",
        [(await h.authenticate(owner)).userId],
      );
      await app.reconcileCosts(owner, { planId: r.plan.id });
      await app.reconcileCosts(owner, { planId: r.plan.id });
      const rows = (
        await costs.workspace(owner, r.plan.cutoff.slice(0, 7))
      ).history.filter(
        (c) => c.sourceId === `evidence:recovery:${r.plan.costs[0].id}`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toMatchObject({
        provider: "neon",
        kind: "consumption",
        amount: null,
        status: "unpriced",
        quantity: r.archive.ciphertext.length,
        details: { basis: "observed_requests" },
      });
    } finally {
      await r.close();
    }
  });
  it.each(
    recoveryTables.flatMap((table) =>
      ["SELECT", "INSERT"].map((grant) => ({ table, grant })),
    ),
  )("requires $grant on $table independently", async ({ table, grant }) => {
    await h.admin.query(`REVOKE ${grant} ON public.${table} FROM app_runtime`);
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await secureDatabase(h.admin);
    }
  });
  it.each(recoveryFunctions)(
    "requires scoped execute and denies implicit default PUBLIC execution for %s",
    async (name) => {
      const signatures: Record<string, string> = {
        recovery_operator_authorized: "",
        claim_infrastructure_recovery: "uuid",
        finish_infrastructure_recovery: "uuid,uuid,text,text,jsonb",
        delegate_infrastructure_recovery: "uuid",
        pending_infrastructure_recovery: "",
      };
      const signature = `public.${name}(${signatures[name]})`;
      await h.admin.query(
        `REVOKE EXECUTE ON FUNCTION ${signature} FROM app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
      await h.admin.query(
        "UPDATE pg_proc SET proacl=NULL WHERE oid=$1::regprocedure",
        [signature],
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
    },
  );
});
