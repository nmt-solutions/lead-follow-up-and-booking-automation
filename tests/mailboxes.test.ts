import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { mailboxFixture } from "./support/mailboxes";
import { senderFixture } from "./support/senders";
import { randomUUID } from "node:crypto";
import { createInquiryApplication } from "../src/application/inquiries";
import { createInquiryRepository } from "../src/db/inquiry-repository";
import { createMailboxHttp } from "../src/http/mailboxes";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";

describe("Mailbox processing at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function setup(
    suffix: string,
    mailProvider: "gmail" | "microsoft" = "gmail",
  ) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`mailbox-${suffix}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Steel supplier",
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
    const sender = await senders.saveConnection(credentials, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Sales",
        provider: mailProvider,
        account: "sales@supplier.example",
        enabled: true,
      },
    });
    const provider = mailboxFixture(h.clock);
    const app = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider,
      clock: h.clock,
    });
    const mailbox = await app.save(credentials, business.id, {
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
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    return {
      credentials,
      businessId: business.id,
      app,
      provider,
      mailbox,
      inbox,
      senders,
      sender,
    };
  }
  it("persists independent requests with history off and captures only new selected sales mail", async () => {
    const f = await setup("incremental");
    f.provider.add("new", "2026-11-05T09:01:00Z");
    f.provider.add("old", "2026-11-04T09:00:00Z");
    f.provider.add("personal", "2026-11-05T09:01:00Z", {
      folderRefs: ["personal"],
    });
    f.provider.add("unrelated", "2026-11-05T09:01:00Z", {
      relevance: "unrelated",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.app.execute(work);
    const state = await f.app.workspace(f.credentials, f.businessId);
    expect(state.mailboxes[0]).toMatchObject({
      configuration: {
        requestedRead: true,
        requestedSend: false,
        history: null,
      },
      grant: { read: "granted", send: "missing" },
      jobs: [{ status: "completed", captured: 1, excluded: 3, checkpoint: 1 }],
    });
    expect(f.provider.bodyReads).toEqual(["new"]);
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    expect(inbox.conversations).toHaveLength(1);
    expect(inbox.opportunities).toHaveLength(1);
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          inbox.conversations[0].id,
        )
      ).messages[0].text,
    ).toBe("Need steel new");
    expect(JSON.stringify(state)).not.toContain("cursor-secret");
  });
  it("keeps one history allowance across pages, retry and repeated queue requests", async () => {
    const f = await setup("history");
    await expect(
      f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
        mode: "history",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 1,
      configuration: {
        ...f.mailbox.configuration,
        history: {
          from: "2026-11-01T00:00:00Z",
          to: "2026-11-05T09:00:00Z",
          maxMessages: 2,
        },
      },
    });
    f.provider.pageSize = 1;
    f.provider.add("history-1", "2026-11-02T00:00:00Z");
    f.provider.add("history-2", "2026-11-03T00:00:00Z");
    f.provider.add("history-3", "2026-11-04T00:00:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "history",
    });
    expect(await f.app.execute(work)).toMatchObject({
      status: "partial",
      captured: 1,
      checkpoint: 1,
    });
    f.provider.failure = true;
    expect(await f.app.execute(work)).toMatchObject({
      status: "partial",
      reason: "provider_unavailable",
      captured: 1,
      checkpoint: 1,
    });
    f.provider.failure = false;
    expect(await f.app.execute(work)).toMatchObject({
      status: "partial",
      reason: "limit_reached",
      captured: 2,
      checkpoint: 2,
    });
    const replay = await f.app.queue(
      f.credentials,
      f.businessId,
      f.mailbox.id,
      { mode: "history" },
    );
    expect(replay).toEqual(work);
    expect(await f.app.execute(replay)).toBeNull();
    expect(f.provider.bodyReads).toEqual(["history-1", "history-2"]);
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    expect(inbox.conversations).toHaveLength(1);
    expect(inbox.opportunities).toHaveLength(1);
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          inbox.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(2);
  });
  it("invalidates reply proof when scope narrows and cannot claim full reply capture outside the selection", async () => {
    const f = await setup("reply-scope");
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 1,
      configuration: { ...f.mailbox.configuration, scope: { kind: "mailbox" } },
    });
    const sender = senderFixture(h);
    const route = await sender.app.saveReplyRoute(f.credentials, f.businessId, {
      id: null,
      expectedVersion: 0,
      configuration: {
        address: f.sender.configuration.account,
        connectionId: f.sender.id,
        inboxConnectionId: f.mailbox.id,
        enabled: true,
      },
    });
    const identity = await sender.app.saveIdentity(
      f.credentials,
      f.businessId,
      {
        id: null,
        expectedVersion: 0,
        configuration: {
          origin: "customer_mailbox",
          purpose: "ordinary_sales",
          fromAddress: f.sender.configuration.account,
          displayName: "Sales",
          uses: ["inbound", "existing_conversation"],
          connectionId: f.sender.id,
          replyRouteId: route.id,
          enabled: true,
        },
      },
    );
    await sender.app.check(f.credentials, f.businessId, identity.id, {
      expectedVersion: identity.version,
    });
    // Provider read permission does not authorize sending, even with independent sender proof.
    expect(
      (await sender.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 2,
      configuration: { ...f.mailbox.configuration, requestedSend: true },
    });
    f.provider.changes = { send: "granted" };
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.app.execute(work);
    await sender.app.check(f.credentials, f.businessId, identity.id, {
      expectedVersion: identity.version,
    });
    expect(
      (await sender.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(true);
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 3,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "threads", refs: ["sales-thread"] },
      },
    });
    let state = await sender.app.workspace(f.credentials, f.businessId);
    expect(state.identities[0].readiness.ready).toBe(false);
    await sender.app.check(f.credentials, f.businessId, identity.id, {
      expectedVersion: identity.version,
    });
    state = await sender.app.workspace(f.credentials, f.businessId);
    expect(state.identities[0].readiness.ready).toBe(false);
  });
  it("stops stale work after a policy change between fetch and commit and keeps authorized history readable", async () => {
    const f = await setup("scope-race");
    f.provider.add("retained", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const first = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.app.execute(first);
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    const conversation = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      inbox.conversations[0].id,
    );
    f.provider.add("stale", "2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    f.provider.beforeRead = async () => {
      f.provider.beforeRead = null;
      f.mailbox = await f.app.save(f.credentials, f.businessId, {
        id: f.mailbox.id,
        expectedVersion: 1,
        configuration: {
          ...f.mailbox.configuration,
          scope: { kind: "folders", refs: ["other"] },
        },
      });
    };
    await expect(f.app.execute(work)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, conversation.id))
        .messages,
    ).toHaveLength(1);
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).mailboxes[0].jobs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: work.jobId,
          status: "blocked",
          reason: "scope_changed",
          checkpoint: 0,
        }),
      ]),
    );
    let modelCalls = 0;
    const inquiry = createInquiryApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createInquiryRepository(runtimeDatabase(h.runtime), h.clock),
      clock: h.clock,
      ai: {
        async executeWorkflow() {
          modelCalls++;
          throw new Error("Unexpected model use");
        },
      },
      opportunityRepository: createOpportunityRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      provider: {
        channels: [],
        async dispatch() {
          throw new Error("Unexpected send");
        },
      },
    });
    expect(
      (
        await inquiry.read(
          f.credentials,
          f.businessId,
          inbox.opportunities[0].id,
        )
      ).latestMessageId,
    ).toBeNull();
    await expect(
      inquiry.process(f.credentials, f.businessId, inbox.opportunities[0].id, {
        messageId: conversation.messages[0].id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(modelCalls).toBe(0);
    await expect(
      f.inbox.capture(
        f.credentials,
        f.businessId,
        f.mailbox.inboxConnectionId,
        conversation.messages[0],
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("checks provider revocation after body fetch and does not persist the stale body or cursor", async () => {
    const f = await setup("grant-race");
    f.provider.add("revoked", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    f.provider.beforeRead = async () => {
      f.provider.changes = { revision: "grant-revoked", read: "revoked" };
    };
    expect(await f.app.execute(work)).toMatchObject({
      status: "blocked",
      reason: "permission_required",
      checkpoint: 0,
      captured: 0,
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(0);
    f.provider.beforeRead = null;
    f.provider.changes = {};
    expect(await f.app.execute(work)).toMatchObject({
      status: "completed",
      checkpoint: 1,
      captured: 1,
    });
  });
  it("rejects cross-Business/mailbox/job ownership, forged actors and invalid settings", async () => {
    const a = await setup("scope-a"),
      b = await setup("scope-b");
    const work = await a.app.queue(a.credentials, a.businessId, a.mailbox.id, {
      mode: "incremental",
    });
    await expect(
      b.app.workspace(b.credentials, a.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.app.execute({ ...work, businessId: b.businessId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.app.execute({ ...work, mailboxId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.app.execute({
        ...work,
        identity: await h.access.authenticateForWork(b.credentials),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.app.save(a.credentials, a.businessId, {
        id: null,
        expectedVersion: 0,
        configuration: {
          ...a.mailbox.configuration,
          connectionId: b.sender.id,
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const configuration of [
      { ...a.mailbox.configuration, ready: true },
      { ...a.mailbox.configuration, scope: { kind: "folders", refs: [] } },
      {
        ...a.mailbox.configuration,
        history: {
          from: "2026-11-07T00:00:00Z",
          to: "2026-11-08T00:00:00Z",
          maxMessages: 10,
        },
      },
    ]) {
      await expect(
        a.app.save(a.credentials, a.businessId, {
          id: a.mailbox.id,
          expectedVersion: 1,
          configuration,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
  it("does not treat send permission as read permission or broader OAuth as processing consent", async () => {
    const f = await setup("permissions");
    f.provider.add("selected", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    f.provider.changes = { read: "missing", send: "granted" };
    expect(await f.app.execute(work)).toMatchObject({
      status: "blocked",
      reason: "permission_required",
    });
    expect(f.provider.bodyReads).toEqual([]);
    f.provider.changes = { read: "granted", folders: ["personal"] };
    expect(await f.app.execute(work)).toMatchObject({
      status: "blocked",
      reason: "permission_required",
    });
    expect(f.provider.bodyReads).toEqual([]);
  });
  for (const mode of ["sign-out", "mfa-expired", "connection-changed"] as const)
    it(`rechecks ${mode} during provider fetch`, async () => {
      const f = await setup(mode);
      f.provider.add("race", "2026-11-05T09:01:00Z");
      h.clock.set("2026-11-05T09:02:00Z");
      const work = await f.app.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "incremental" },
      );
      f.provider.beforeRead = async () => {
        if (mode === "sign-out") await h.signOut(f.credentials);
        else if (mode === "mfa-expired") h.clock.set("2026-11-05T22:00:00Z");
        else
          await f.senders.saveConnection(f.credentials, f.businessId, {
            id: f.sender.id,
            expectedVersion: 1,
            configuration: { ...f.sender.configuration, enabled: false },
          });
      };
      await expect(f.app.execute(work)).rejects.toMatchObject({
        code:
          mode === "sign-out"
            ? "UNAUTHENTICATED"
            : mode === "mfa-expired"
              ? "MFA_REQUIRED"
              : "FORBIDDEN",
      });
      h.clock.set("2026-11-05T09:02:00Z");
      const credentials =
        mode === "sign-out"
          ? await h.signIn(`mailbox-${mode}@example.com`)
          : f.credentials;
      expect(
        (await f.inbox.workspace(credentials, f.businessId)).conversations,
      ).toHaveLength(0);
      expect(
        (await f.app.workspace(credentials, f.businessId)).mailboxes[0].jobs[0],
      ).toMatchObject({
        status: "blocked",
        reason:
          mode === "connection-changed"
            ? "scope_changed"
            : "authorization_required",
        checkpoint: 0,
      });
    });
  it("serializes concurrent/replayed batches and deduplicates a later authorized history import", async () => {
    const f = await setup("dedup");
    f.provider.add("same-message", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    let entered = 0;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.provider.beforeRead = async () => {
      if (++entered === 2) release();
      await barrier;
    };
    const results = await Promise.allSettled([
      f.app.execute(work),
      f.app.execute(work),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await f.app.execute(work)).toBeNull();
    f.provider.beforeRead = null;
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 1,
      configuration: {
        ...f.mailbox.configuration,
        history: {
          from: "2026-11-05T00:00:00Z",
          to: "2026-11-05T09:02:00Z",
          maxMessages: 10,
        },
      },
    });
    const history = await f.app.queue(
      f.credentials,
      f.businessId,
      f.mailbox.id,
      { mode: "history" },
    );
    expect(await f.app.execute(history)).toMatchObject({
      status: "completed",
      captured: 0,
      duplicates: 1,
      considered: 1,
    });
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    expect(inbox.opportunities).toHaveLength(1);
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          inbox.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(1);
  });
  it("revokes a queued admin's authority after metadata listing and before reading content", async () => {
    const f = await setup("membership");
    await h.team.invite(f.credentials, f.businessId, {
      email: "mailbox-admin@example.com",
      role: "admin",
    });
    const notification = h.invitations.sent.at(-1)!;
    const credentials = await h.signIn("mailbox-admin@example.com");
    await h.team.accept(credentials, {
      token: new URLSearchParams(new URL(notification.url).hash.slice(1)).get(
        "token",
      ),
    });
    const identity = await h.access.authenticateForWork(credentials);
    f.provider.add("forbidden", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    f.provider.beforeList = async () => {
      await h.team.removeMember(f.credentials, f.businessId, {
        userId: identity.userId,
      });
    };
    await expect(f.app.execute(work)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(f.provider.bodyReads).toEqual([]);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(0);
  });
  it("validates API writes, keeps diagnostics safe and reports unconfigured integration without fake grants", async () => {
    const f = await setup("http");
    const app = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(runtimeDatabase(h.runtime), h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const diagnostics: unknown[] = [];
    const http = createMailboxHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: (failure) => diagnostics.push(failure),
    });
    const request = (value: unknown, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/mailboxes", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie")!,
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify(value),
      });
    expect(
      (
        await http.save(
          request({ ...f.mailbox, privateToken: "secret" }),
          f.businessId,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.queue(
          request({ mode: "incremental" }, "https://other.example"),
          f.businessId,
          f.mailbox.id,
        )
      ).status,
    ).toBe(403);
    const response = await http.queue(
      request({ mode: "incremental" }),
      f.businessId,
      f.mailbox.id,
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toEqual({ jobId: expect.any(String) });
    expect(JSON.stringify(json)).not.toContain("sessionId");
    const state = await app.workspace(f.credentials, f.businessId);
    expect(state).toMatchObject({
      providerMode: "unconfigured",
      mailboxes: [
        {
          grant: null,
          jobs: [{ status: "blocked", reason: "setup_required", captured: 0 }],
        },
      ],
    });
    expect(JSON.stringify(diagnostics)).not.toContain("privateToken");
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });
  it("continues under an explicitly reauthorized session without resetting a partial history allowance", async () => {
    const f = await setup("resume-session");
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 1,
      configuration: {
        ...f.mailbox.configuration,
        history: {
          from: "2026-11-01T00:00:00Z",
          to: "2026-11-05T09:00:00Z",
          maxMessages: 2,
        },
      },
    });
    f.provider.pageSize = 1;
    f.provider.add("first", "2026-11-02T00:00:00Z");
    f.provider.add("second", "2026-11-03T00:00:00Z");
    f.provider.add("third", "2026-11-04T00:00:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "history",
    });
    await f.app.execute(work);
    await h.signOut(f.credentials);
    const credentials = await h.signIn("mailbox-resume-session@example.com");
    const resumed = await f.app.queue(credentials, f.businessId, f.mailbox.id, {
      mode: "history",
    });
    expect(resumed.jobId).toBe(work.jobId);
    await expect(f.app.execute(work)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await f.app.execute(resumed)).toMatchObject({
      captured: 2,
      considered: 2,
      reason: "limit_reached",
      checkpoint: 2,
    });
    expect(f.provider.bodyReads).toEqual(["first", "second"]);
  });
  it("blocks another mailbox's folder/thread IDs even under broad provider read permission", async () => {
    const f = await setup("unknown-scope");
    for (const kind of ["folders", "threads"] as const) {
      f.mailbox = await f.app.save(f.credentials, f.businessId, {
        id: f.mailbox.id,
        expectedVersion: f.mailbox.version,
        configuration: {
          ...f.mailbox.configuration,
          scope: { kind, refs: ["other-mailbox-private-id"] },
        },
      });
      const work = await f.app.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "incremental" },
      );
      expect(await f.app.execute(work)).toMatchObject({
        status: "blocked",
        reason: "permission_required",
        checkpoint: 0,
      });
    }
    expect(f.provider.bodyReads).toEqual([]);
  });
  it("preserves records/checkpoints and forced RLS/restricted grants when the additive schema is reapplied", async () => {
    const f = await setup("schema");
    f.provider.add("persisted", "2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.app.execute(work);
    await h.reapplySchema();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).mailboxes[0].jobs[0],
    ).toMatchObject({ checkpoint: 1, captured: 1, status: "completed" });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    expect(
      (await h.runtime.query("select id from mailbox_policy")).rows,
    ).toEqual([]);
    const security = await h.admin.query(
      "select relname,relforcerowsecurity from pg_class where relname in ('mailbox_policy','mailbox_job') order by relname",
    );
    expect(security.rows).toEqual([
      { relname: "mailbox_job", relforcerowsecurity: true },
      { relname: "mailbox_policy", relforcerowsecurity: true },
    ]);
    expect(
      (
        await h.admin.query(
          "select has_table_privilege('app_runtime','mailbox_policy','DELETE') as can_delete",
        )
      ).rows[0].can_delete,
    ).toBe(false);
  });
  for (const ending of ["commit", "failure"] as const)
    it(`never overwrites a concurrent revocation with a stale history ${ending}`, async () => {
      const f = await setup(`permission-order-${ending}`);
      f.mailbox = await f.app.save(f.credentials, f.businessId, {
        id: f.mailbox.id,
        expectedVersion: 1,
        configuration: {
          ...f.mailbox.configuration,
          history: {
            from: "2026-11-01T00:00:00Z",
            to: "2026-11-05T09:00:00Z",
            maxMessages: 2,
          },
        },
      });
      f.provider.add("private-history", "2026-11-02T00:00:00Z");
      const history = await f.app.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "history" },
      );
      const incremental = await f.app.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "incremental" },
      );
      let inspections = 0;
      let observed = () => {};
      let release = () => {};
      const observedGate = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const releaseGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.provider.afterInspect = async (context) => {
        if (context.work.jobId === history.jobId && ++inspections === 2) {
          observed();
          await releaseGate;
          if (ending === "failure") throw new Error("private-provider-error");
        }
      };
      const running = f.app.execute(history);
      const rejected = expect(running).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await observedGate;
      f.provider.changes = { read: "revoked", revision: "revoked-2" };
      expect(await f.app.execute(incremental)).toMatchObject({
        status: "blocked",
        reason: "permission_required",
      });
      release();
      await rejected;
      const state = await f.app.workspace(f.credentials, f.businessId);
      expect(state.mailboxes[0].grant?.read).toBe("revoked");
      expect(
        state.mailboxes[0].jobs.find((job) => job.id === history.jobId)
          ?.checkpoint,
      ).toBe(0);
      expect(
        (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
      ).toHaveLength(0);
    });
  it("persists interruption distinctly without retrying it as a provider outage", async () => {
    const f = await setup("interrupt");
    const work = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    const controller = new AbortController();
    controller.abort();
    expect(await f.app.execute(work, controller.signal)).toMatchObject({
      status: "blocked",
      reason: "interrupted",
      checkpoint: 0,
    });
    expect(f.provider.bodyReads).toEqual([]);
  });
  it("rejects a reply route that borrows another native mailbox's sync or account", async () => {
    const f = await setup("reply-binding");
    const other = await f.senders.saveConnection(f.credentials, f.businessId, {
      id: null,
      expectedVersion: 0,
      configuration: {
        ...f.sender.configuration,
        account: "other@supplier.example",
      },
    });
    await expect(
      f.senders.saveReplyRoute(f.credentials, f.businessId, {
        id: null,
        expectedVersion: 0,
        configuration: {
          address: other.configuration.account,
          connectionId: other.id,
          inboxConnectionId: f.mailbox.id,
          enabled: true,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("handles Microsoft thread scope and reordered/replayed messages without duplicating purchasing needs", async () => {
    const f = await setup("microsoft-events", "microsoft");
    f.mailbox = await f.app.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: 1,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "threads", refs: ["sales-thread"] },
      },
    });
    f.provider.add("message-1", "2026-11-05T09:01:00Z");
    f.provider.add("message-2", "2026-11-05T09:01:30Z");
    f.provider.add("other-thread", "2026-11-05T09:01:00Z", {
      conversationRef: "other-thread",
    });
    f.provider.reverse();
    h.clock.set("2026-11-05T09:02:00Z");
    const first = await f.app.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    expect(await f.app.execute(first)).toMatchObject({
      captured: 2,
      excluded: 1,
      status: "completed",
    });
    f.provider.reverse();
    f.provider.replayFromStart = true;
    const replay = await f.app.queue(
      f.credentials,
      f.businessId,
      f.mailbox.id,
      { mode: "incremental" },
    );
    expect(await f.app.execute(replay)).toMatchObject({
      captured: 0,
      duplicates: 2,
      status: "completed",
    });
    const state = await f.inbox.workspace(f.credentials, f.businessId);
    expect(state.opportunities).toHaveLength(1);
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          state.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(2);
    expect(f.provider.bodyReads).not.toContain("other-thread");
  });
  it("rejects another provider/account observation without retaining its grants or reading bodies", async () => {
    const f = await setup("invalid-provider");
    for (const changes of [
      { provider: "microsoft" as const },
      { account: "private@another.example" },
    ]) {
      f.provider.changes = changes;
      const work = await f.app.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "incremental" },
      );
      expect(await f.app.execute(work)).toMatchObject({
        status: "blocked",
        reason: "invalid_provider_response",
        checkpoint: 0,
      });
      expect(
        (await f.app.workspace(f.credentials, f.businessId)).mailboxes[0].grant,
      ).toBeNull();
    }
    expect(f.provider.bodyReads).toEqual([]);
  });
});
