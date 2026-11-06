import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";
import { createOperationsApplication } from "../src/application/operations";
import { createOperationsRepository } from "../src/db/operations-repository";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { mailboxFixture } from "./support/mailboxes";
import { createOperationsHttp } from "../src/http/operations";
import { configuredOperationLogs } from "../src/operations/configuration";

describe("Operations at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("classifies an operations-only operator as privileged and requires current platform MFA", async () => {
    const primary = await h.signIn("operations-only@example.com", false);
    const actor = await h.access.primary(primary);
    await h.admin.query(
      "insert into platform_operator(user_id,operations) values($1,true)",
      [actor.user.id],
    );
    expect(await h.access.status(primary)).toMatchObject({
      operator: true,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(h.authenticate(primary)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const verified = await h.signIn("operations-only@example.com");
    await h.team.requirePlatformCapability(verified, "operations.manage");
    expect(await h.access.status(verified)).toMatchObject({
      operator: true,
      operatorVerified: true,
      readiness: "mfa-satisfied",
    });
    h.clock.set("2026-11-05T09:16:00Z");
    expect(await h.access.status(verified)).toMatchObject({
      readiness: "mfa-incomplete",
      operatorVerified: false,
    });
    await expect(h.access.authenticatePlatform(verified)).rejects.toMatchObject(
      { code: "MFA_REQUIRED" },
    );
    h.clock.set("2026-11-05T09:00:00Z");
  });

  it("isolates Business history and HTTP controls and exposes only configured provider resource links", async () => {
    h.clock.set("2026-11-05T09:00:00Z");
    const owner = await h.signIn("operations-http@example.com"),
      stranger = await h.signIn("operations-stranger@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Scoped operations",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const actor = await h.authenticate(owner);
    await h.admin.query(
      "insert into platform_operator(user_id,operations) values($1,true)",
      [actor.userId],
    );
    const operations = createOperationsApplication({
      authenticate: h.access.authenticateForWork,
      repository: createOperationsRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      commands: {},
      logs: configuredOperationLogs({
        OPERATIONS_TRIGGER_LOG_URL:
          "https://cloud.trigger.dev/orgs/fixture/projects/fixture/runs",
        OPERATIONS_VERCEL_LOG_URL:
          "https://vercel.com/fixture/project/logs?token=private-token",
        OPERATIONS_NEON_LOG_URL:
          "https://console.neon.tech.evil.example/app/projects/p/monitoring",
      }),
    });
    const diagnostics: unknown[] = [];
    const http = createOperationsHttp({
      application: operations,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    expect(
      (
        await http.get(
          new Request("http://localhost:3000/history", { headers: stranger }),
          business.id,
        )
      ).status,
    ).toBe(404);
    const op = await operations.workspace(owner, null, true);
    expect(op.providerLogs).toEqual([
      {
        label: "Trigger run logs",
        url: "https://cloud.trigger.dev/orgs/fixture/projects/fixture/runs",
      },
    ]);
    expect(JSON.stringify(op)).not.toMatch(/private-token|evil\.example/);
    const headers = new Headers(owner);
    headers.set("content-type", "application/json");
    headers.set("origin", "https://untrusted.example");
    const command = {
      source: "mailbox",
      targetId: crypto.randomUUID(),
      action: "retry",
      requestKey: crypto.randomUUID(),
    };
    expect(
      (
        await http.command(
          new Request("http://localhost:3000/history", {
            method: "POST",
            headers,
            body: JSON.stringify(command),
          }),
          business.id,
        )
      ).status,
    ).toBe(403);
    headers.set("origin", "http://localhost:3000");
    expect(
      (
        await http.command(
          new Request("http://localhost:3000/history", {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...command,
              identity: { userId: actor.userId, sessionId: "forged" },
              providerPayload: "private-token",
            }),
          }),
          business.id,
        )
      ).status,
    ).toBe(400);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /private-token|forged|untrusted/,
    );
    await h.admin.query(
      "update platform_operator set operations=false where user_id=$1",
      [actor.userId],
    );
    await expect(operations.workspace(owner, null, true)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });
  it("requires each ledger read/append and narrow helper grant independently and survives managed reapplication", async () => {
    for (const table of ["operation_event", "operation_retention"])
      for (const grant of ["SELECT", "INSERT"]) {
        await h.admin.query(`revoke ${grant} on ${table} from app_runtime`);
        await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
        await secureDatabase(h.admin);
        await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
      }
    for (const signature of [
      "operations_operator_authorized()",
      "operation_mailbox_work(uuid,uuid)",
      "record_operation_detail(uuid,text,uuid,text)",
      "prune_operation_details()",
      "maintain_operation_retention()",
    ]) {
      await h.admin.query(
        `revoke execute on function public.${signature} from app_runtime`,
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
      await secureDatabase(h.admin);
    }
    await h.admin.query("drop trigger capture_operation on mailbox_job");
    await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow();
    await secureDatabase(h.admin);
    await h.reapplySchema();
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
  });

  it("recovers the same failed connection after restart, retains progress and assigns a real in-app alert", async () => {
    const owner = await h.signIn("operations-connection@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const database = runtimeDatabase(h.runtime);
    const senders = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(database, h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    });
    const sender = await senders.saveConnection(owner, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Sales",
        provider: "gmail",
        account: "sales@supplier.example",
        enabled: true,
      },
    });
    const provider = mailboxFixture(h.clock);
    const queued: unknown[] = [];
    const mailbox = () =>
      createMailboxApplication({
        authenticate: h.access.authenticateForWork,
        repository: createMailboxRepository(database, h.clock),
        provider,
        clock: h.clock,
        enqueue: async (work) => {
          queued.push(work);
        },
      });
    const app = mailbox();
    function operations() {
      return createOperationsApplication({
        authenticate: h.access.authenticateForWork,
        repository: createOperationsRepository(database, h.clock),
        commands: { mailbox: mailbox() },
      });
    }
    const policy = await app.save(owner, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: sender.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["sales"] },
        history: null,
      },
    });
    expect(
      (await operations().workspace(owner, business.id)).resources.find(
        (r) => r.source === "mailbox_scope" && r.id === policy.id,
      ),
    ).toMatchObject({
      status: "unsafe",
      context: { readRequested: true, sendRequested: false, permission: null },
    });
    provider.add("first", "2026-11-05T09:01:00Z");
    provider.add("second", "2026-11-05T09:01:00Z");
    provider.pageSize = 1;
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await app.queue(owner, business.id, policy.id, {
      mode: "incremental",
    });
    await app.execute(work);
    provider.failure = true;
    await app.execute(work);
    const failed = await operations().workspace(owner, business.id);
    expect(failed.resources.find((r) => r.id === work.jobId)).toMatchObject({
      status: "partial",
      reason: "provider_unavailable",
      context: { checkpoint: 1, captured: 1, mailboxId: policy.id },
    });
    const alert = failed.notifications.find((a) => a.targetId === work.jobId);
    expect(alert).toMatchObject({
      delivery: "available_in_app",
      responsibleUserId: (await h.authenticate(owner)).userId,
      resolved: false,
    });
    await operations().acknowledge(owner, business.id, {
      eventId: alert!.id,
      requestKey: crypto.randomUUID(),
    });
    expect(
      (await operations().workspace(owner, business.id)).notifications.find(
        (a) => a.id === alert!.id,
      ),
    ).toMatchObject({ delivery: "acknowledged_in_app", resolved: false });
    expect(JSON.stringify(failed)).not.toMatch(
      /cursor-secret|sensitive-provider|Need steel/,
    );
    provider.failure = false;
    const command = {
      source: "mailbox",
      targetId: work.jobId,
      action: "retry",
      requestKey: crypto.randomUUID(),
    };
    const recovered = await operations().recover(owner, business.id, command);
    expect(recovered.outcome).toBe("queued");
    await mailbox().execute(queued.at(-1));
    const state = await operations().workspace(owner, business.id);
    expect(state.resources.find((r) => r.id === work.jobId)).toMatchObject({
      status: "completed",
      context: { captured: 2, checkpoint: 2 },
    });
    expect(state.notifications.find((a) => a.id === alert?.id)).toMatchObject({
      resolved: true,
      delivery: "acknowledged_in_app",
    });
    expect(
      state.history.some(
        (e) => e.targetId === work.jobId && e.reason === "provider_unavailable",
      ),
    ).toBe(true);
    await operations().recover(owner, business.id, command);
    expect(queued).toHaveLength(2);
  });

  it("lets a current operations operator requeue only original authorized connection work without becoming its customer", async () => {
    h.clock.set("2026-11-05T09:00:00Z");
    const owner = await h.signIn("maintenance-owner@example.com");
    const op = await h.signIn("maintenance-operator@example.com");
    const opActor = await h.authenticate(op);
    await h.admin.query(
      "insert into platform_operator(user_id,operations) values($1,true)",
      [opActor.userId],
    );
    const business = await h.application.createBusiness(owner, {
      name: "Maintenance",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const database = runtimeDatabase(h.runtime);
    const senders = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(database, h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    });
    const sender = await senders.saveConnection(owner, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Sales",
        provider: "gmail",
        account: "sales@maintenance.example",
        enabled: true,
      },
    });
    const provider = mailboxFixture(h.clock);
    provider.failure = true;
    const queued: unknown[] = [];
    const mailbox = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider,
      clock: h.clock,
      enqueue: async (work) => {
        queued.push(work);
      },
    });
    const policy = await mailbox.save(owner, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: sender.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["sales"] },
        history: null,
      },
    });
    const work = await mailbox.queue(owner, business.id, policy.id, {
      mode: "incremental",
    });
    await mailbox.execute(work);
    const operations = createOperationsApplication({
      authenticate: h.access.authenticateForWork,
      repository: createOperationsRepository(database, h.clock),
      commands: { mailbox },
    });
    await expect(operations.workspace(op, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (await operations.workspace(op, null, true)).resources.find(
        (r) => r.id === work.jobId,
      ),
    ).toMatchObject({
      responsibleUserId: work.identity.userId,
      context: { captured: 0 },
    });
    const cmd = {
      source: "mailbox",
      targetId: work.jobId,
      action: "retry",
      requestKey: crypto.randomUUID(),
    };
    expect(await operations.recover(op, business.id, cmd, true)).toEqual({
      outcome: "queued",
    });
    expect(queued.at(-1)).toEqual(work);
    expect(
      (await operations.workspace(op, null, true)).history.find(
        (e) => e.requestKey === cmd.requestKey && e.outcome === "queued",
      ),
    ).toMatchObject({
      actorId: opActor.userId,
      context: {
        recoveryAuthority: "operations.manage",
        recoveryRole: "operations",
        recoveryMfaAt: "2026-11-05T09:00:00.000Z",
      },
    });
    expect(
      JSON.stringify(await operations.workspace(op, null, true)),
    ).not.toContain(work.identity.sessionId);
    await h.signOut(owner);
    await expect(
      operations.recover(
        op,
        business.id,
        { ...cmd, requestKey: crypto.randomUUID() },
        true,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(queued).toHaveLength(2);
    const retention = {
      expectedVersion: 0,
      diagnosticSeconds: 120,
      auditDetailSeconds: 600,
      evidenceRef: crypto.randomUUID(),
      confirmPolicy: true,
    };
    await operations.saveRetention(op, retention);
    await operations.recover(
      op,
      business.id,
      { ...cmd, action: "escalate", requestKey: crypto.randomUUID() },
      true,
    );
    const details = await operations.diagnostics(op);
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((d) => d.code === "RECOVERY_ESCALATED")).toBe(true);
    // A controlled future application clock must not authorize early deletion.
    h.clock.set("2027-11-05T09:00:00Z");
    const futureOp = await h.signIn("maintenance-operator@example.com");
    expect(await operations.maintainRetention()).toEqual({ deleted: 0 });
    expect(await operations.prune(futureOp)).toEqual({ deleted: 0 });
    expect(await operations.diagnostics(futureOp)).toHaveLength(details.length);
    h.clock.set("2026-11-05T09:00:00Z");
    // Only disposable fixture administration advances persisted expiry.
    await h.admin.query(
      "update operation_detail set expires_at=statement_timestamp()-interval '1 second'",
    );
    await h.admin.query(
      "update platform_operator set operations=false where user_id=$1",
      [opActor.userId],
    );
    expect(await operations.maintainRetention()).toEqual({ deleted: 0 });
    await h.admin.query(
      "update platform_operator set operations=true where user_id=$1",
      [opActor.userId],
    );
    expect(await operations.maintainRetention()).toEqual({
      deleted: details.length,
    });
    expect(await operations.prune(op)).toEqual({ deleted: 0 });
    expect(
      (await operations.workspace(op, null, true)).history.some(
        (e) => e.outcome === "escalated",
      ),
    ).toBe(true);
    expect(
      (await operations.workspace(op, null, true)).history.some(
        (e) => e.targetId === work.jobId && e.reason === "provider_unavailable",
      ),
    ).toBe(true);
  });
});
