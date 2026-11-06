import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import type { OpportunityDispatch } from "../src/models/opportunity-control";
import { createOpportunityHttp } from "../src/http/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { readySender, fixtureMailBinding } from "./support/senders";
import { configureEmailFixture } from "./support/email-eligibility";

describe("Opportunity control at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let inbox: ReturnType<typeof createInboxApplication<Headers>>;
  let app: ReturnType<typeof createOpportunityApplication<Headers>>;
  let authority: ReturnType<
    typeof createCommercialAuthorityApplication<Headers>
  >;
  const outbound: OpportunityDispatch[] = [];
  let effect: (action: OpportunityDispatch) => Promise<void> = async (
    action,
  ) => {
    outbound.push(action);
  };
  beforeAll(async () => {
    h = await createHarness();
    const database = runtimeDatabase(h.runtime);
    authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(database),
      clock: h.clock,
    });
    inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    app = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(database, h.clock),
      clock: h.clock,
      provider: {
        emailIdentity: fixtureMailBinding,
        channels: ["email", "whatsapp"],
        dispatch: (action) => effect(action),
      },
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  async function setup(suffix: string, withSender = true) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`control-${suffix}@example.com`);
    const actor = await h.authenticate(credentials);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Selected email import",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    const sender = withSender
      ? await readySender(h, credentials, business.id, connection.id)
      : null;
    await inbox.capture(credentials, business.id, connection.id, {
      eventId: `in-${suffix}`,
      messageRef: `m-${suffix}`,
      conversationRef: `thread-${suffix}`,
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Steel",
      text: "Need steel",
      occurredAt: h.clock.now().toISOString(),
    });
    const workspace = await inbox.workspace(credentials, business.id);
    return {
      credentials,
      actor,
      businessId: business.id,
      connection,
      need: workspace.opportunities[0],
      conversationId: workspace.conversations[0].id,
      suffix,
      sender,
    };
  }

  it("persists attributed takeover and next action, then requires an explicit versioned handback without granting commercial authority", async () => {
    const f = await setup("control");
    const initial = await app.read(f.credentials, f.businessId, f.need.id);
    await app.change(f.credentials, f.businessId, f.need.id, {
      command: "takeover",
      expectedVersion: initial.version,
      reason: "Buyer asked for a person",
      nextAction: "Call buyer tomorrow",
    });
    const paused = await app.read(f.credentials, f.businessId, f.need.id);
    expect(paused).toMatchObject({
      state: "human",
      ownerId: f.actor.userId,
      reason: "Buyer asked for a person",
      nextAction: "Call buyer tomorrow",
      version: 1,
    });
    expect(paused.history).toMatchObject([
      {
        command: "takeover",
        actorId: f.actor.userId,
        after: { state: "human", nextAction: "Call buyer tomorrow" },
      },
    ]);
    await expect(
      app.change(f.credentials, f.businessId, f.need.id, {
        command: "handback",
        expectedVersion: 0,
        reason: "Done",
        nextAction: "Continue",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await app.change(f.credentials, f.businessId, f.need.id, {
      command: "handback",
      expectedVersion: 1,
      reason: "Exception resolved",
      nextAction: "Evaluate future actions under current policy",
    });
    const returned = await app.read(f.credentials, f.businessId, f.need.id);
    expect(returned).toMatchObject({
      state: "automation",
      version: 2,
      policyVersion: 0,
    });
    expect(returned.history[1]).toMatchObject({
      command: "handback",
      policy: { version: 0, decisions: { prices: "automation_disabled" } },
    });
    const reloaded = await inbox.workspace(f.credentials, f.businessId);
    expect(reloaded.opportunities[0]).toMatchObject({
      ownerId: f.actor.userId,
      handoffReason: "Exception resolved",
      nextAction: "Evaluate future actions under current policy",
    });
  });
  type Fixture = Awaited<ReturnType<typeof setup>>;
  const evaluation = {
    action: "prices",
    amount: { currency: "USD", minor: "500" },
    discountBps: 0,
  };
  const command = (
    command: "takeover" | "handback" | "update",
    expectedVersion: number,
  ) => ({
    command,
    expectedVersion,
    reason: "Sales exception resolved",
    nextAction: "Review the current need",
  });
  async function enable(f: Fixture) {
    const policy = await authority.workspace(f.credentials, f.businessId);
    policy.policy.prices = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 0,
      escalationOwnerId: f.actor.userId,
    };
    await authority.save(f.credentials, f.businessId, {
      expectedVersion: policy.version,
      policy: policy.policy,
      note: "Bounded prices approved",
    });
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("takeover", 0),
    );
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("handback", 1),
    );
  }
  async function queue(f: Fixture) {
    if (f.suffix !== "eligibility-required")
      await configureEmailFixture(h, f.credentials, f.businessId, f.need.id);
    const detail = await inbox.conversation(
      f.credentials,
      f.businessId,
      f.conversationId,
    );
    return app.queue(f.credentials, f.businessId, f.need.id, {
      messageId: detail.messages[0].id,
      evaluation,
      dueAt: h.clock.now().toISOString(),
    });
  }
  it("fails closed at actual dispatch when recipient market policy and evidence are missing despite a ready sender and approved authority", async () => {
    const f = await setup("eligibility-required");
    await enable(f);
    const action = await queue(f);
    const before = outbound.length;
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_unknown",
    });
    expect(outbound).toHaveLength(before);
  });
  it("blocks enabled email delivery without a ready persisted sender and explicit reply path", async () => {
    const f = await setup("sender-required", false);
    await enable(f);
    const action = await queue(f);
    const before = outbound.length;
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "sender_setup_required" });
    expect(outbound).toHaveLength(before);
  });
  it("rechecks sender proof at dispatch, includes truthful identity in effects, and blocks after reply capture is lost", async () => {
    const f = await setup("sender-health");
    await enable(f);
    const action = await queue(f);
    const before = outbound.length;
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "dispatched" });
    expect(outbound[before].sender).toMatchObject({
      fromAddress: "sales@supplier.example",
      fromName: "Sales team · Supplier",
      replyTo: "sales@supplier.example",
      platformDisclosure: "Sent through Business operations for Supplier",
      mode: "fixture",
    });
    const queued = await queue(f);
    if (!f.sender) throw new Error("Sender fixture missing");
    f.sender.fixture.changes.reply_capture = "unavailable";
    await f.sender.app.check(
      f.credentials,
      f.businessId,
      f.sender.identity.id,
      { expectedVersion: 1 },
    );
    expect(
      await app.dispatch(f.credentials, f.businessId, queued.id),
    ).toMatchObject({ state: "cancelled", reason: "sender_not_ready" });
    expect(outbound).toHaveLength(before + 1);
    expect(
      (await inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  const manual = (f: Fixture) => ({
    eventId: `manual-${f.suffix}`,
    messageRef: `sent-${f.suffix}`,
    conversationRef: `thread-${f.suffix}`,
    replyToMessageRef: `m-${f.suffix}`,
    occurredAt: h.clock.now().toISOString(),
    reason: "Replied personally in the supported channel",
    nextAction: "Call buyer",
  });
  async function waitForBlocked(count: number) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const result = await h.admin.query<{ count: string }>(
        "select count(*) from pg_locks where locktype='advisory' and not granted",
      );
      if (Number(result.rows[0].count) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Database concurrency barrier was not reached");
  }
  for (const kind of ["manual", "takeover"] as const) {
    it(`serializes a racing ${kind} before due dispatch through PostgreSQL and never calls the external adapter`, async () => {
      const f = await setup(`race-${kind}`);
      await enable(f);
      const action = await queue(f);
      const before = outbound.length;
      const barrier = await h.admin.connect();
      await barrier.query("BEGIN");
      await barrier.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [f.businessId],
      );
      const pause =
        kind === "manual"
          ? app.manualReply(
              f.credentials,
              f.businessId,
              f.connection.id,
              manual(f),
            )
          : app.change(
              f.credentials,
              f.businessId,
              f.need.id,
              command("takeover", 2),
            );
      try {
        await waitForBlocked(1);
        const dispatch = app.dispatch(f.credentials, f.businessId, action.id);
        await waitForBlocked(2);
        await barrier.query("COMMIT");
        await pause;
        expect(await dispatch).toMatchObject({
          state: "cancelled",
          reason: "control_changed",
        });
        expect(outbound).toHaveLength(before);
        expect(
          await app.read(f.credentials, f.businessId, f.need.id),
        ).toMatchObject({ state: "human", version: 3 });
      } finally {
        await barrier.query("ROLLBACK");
        barrier.release();
      }
    });
  }

  it("pauses the Opportunity shared by email and WhatsApp, keeps another need for the same buyer running, and treats event/message replay idempotently", async () => {
    const f = await setup("shared");
    await enable(f);
    const whatsapp = await inbox.addConnection(f.credentials, f.businessId, {
      label: "Supported WhatsApp import",
      channel: "whatsapp",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await inbox.capture(f.credentials, f.businessId, whatsapp.id, {
      eventId: "wa-in",
      messageRef: "wa-m",
      conversationRef: "wa-thread",
      senderRef: "wa-buyer",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Same need",
      text: "Following up",
      occurredAt: h.clock.now().toISOString(),
    });
    const waSummary = (
      await inbox.workspace(f.credentials, f.businessId)
    ).conversations.find((c) => c.channel === "whatsapp")!;
    const wa = await inbox.conversation(
      f.credentials,
      f.businessId,
      waSummary.id,
    );
    await inbox.associate(f.credentials, f.businessId, wa.id, {
      expectedVersion: wa.association.version,
      buyerId: f.need.buyerId,
      messageIds: [],
      allMessages: true,
      target: { kind: "existing", opportunityId: f.need.id },
      future: "target",
      reason: "Verified same buyer and purchasing need",
    });
    const waAction = await app.queue(f.credentials, f.businessId, f.need.id, {
      messageId: wa.messages[0].id,
      evaluation,
      dueAt: h.clock.now().toISOString(),
    });
    await inbox.capture(f.credentials, f.businessId, f.connection.id, {
      eventId: "second-in",
      messageRef: "second-m",
      conversationRef: "second-thread",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Separate need",
      text: "Another order",
      occurredAt: h.clock.now().toISOString(),
    });
    const second = (
      await inbox.workspace(f.credentials, f.businessId)
    ).opportunities.find(
      (n) =>
        n.buyerId === f.need.buyerId &&
        n.id !== f.need.id &&
        n.title === "Separate need",
    )!;
    await app.change(
      f.credentials,
      f.businessId,
      second.id,
      command("takeover", 0),
    );
    await app.change(
      f.credentials,
      f.businessId,
      second.id,
      command("handback", 1),
    );
    const secondThread = (
      await inbox.workspace(f.credentials, f.businessId)
    ).conversations.find((c) => c.subject === "Separate need")!;
    const secondMessage = (
      await inbox.conversation(f.credentials, f.businessId, secondThread.id)
    ).messages[0];
    const independent = await app.queue(
      f.credentials,
      f.businessId,
      second.id,
      {
        messageId: secondMessage.id,
        evaluation,
        dueAt: h.clock.now().toISOString(),
      },
    );
    await configureEmailFixture(h, f.credentials, f.businessId, second.id);
    expect(
      await app.manualReply(
        f.credentials,
        f.businessId,
        f.connection.id,
        manual(f),
      ),
    ).toMatchObject({ status: "captured", opportunityId: f.need.id });
    expect(
      await app.dispatch(f.credentials, f.businessId, waAction.id),
    ).toMatchObject({ state: "cancelled" });
    expect(
      await app.dispatch(f.credentials, f.businessId, independent.id),
    ).toMatchObject({ state: "dispatched" });
    expect(outbound.at(-1)).toMatchObject({
      opportunityId: second.id,
      channel: "email",
    });
    expect(
      (await inbox.workspace(f.credentials, f.businessId)).opportunities.find(
        (n) => n.id === f.need.id,
      ),
    ).toMatchObject({ ownerId: f.actor.userId });
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("handback", 3),
    );
    expect(
      await app.manualReply(
        f.credentials,
        f.businessId,
        f.connection.id,
        manual(f),
      ),
    ).toMatchObject({ status: "duplicate" });
    expect(
      await app.manualReply(f.credentials, f.businessId, f.connection.id, {
        ...manual(f),
        eventId: "alias-delivery",
      }),
    ).toMatchObject({ status: "duplicate" });
    expect(
      await app.read(f.credentials, f.businessId, f.need.id),
    ).toMatchObject({ state: "automation", version: 4 });
    await expect(
      app.manualReply(f.credentials, f.businessId, f.connection.id, {
        ...manual(f),
        nextAction: "Changed payload",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects stale policy and association generations, preserves new-policy handback evidence, and never revives old actions", async () => {
    const f = await setup("policy");
    await enable(f);
    const stalePolicy = await queue(f);
    const policy = await authority.workspace(f.credentials, f.businessId);
    policy.policy.prices.automationEnabled = false;
    policy.policy.prices.approvalRequired = true;
    await authority.save(f.credentials, f.businessId, {
      expectedVersion: 1,
      policy: policy.policy,
      note: "Authority revoked",
    });
    expect(
      await app.dispatch(f.credentials, f.businessId, stalePolicy.id),
    ).toMatchObject({ state: "cancelled", reason: "policy_changed" });
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("takeover", 2),
    );
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("handback", 3),
    );
    const returned = await app.read(f.credentials, f.businessId, f.need.id);
    expect(returned.history.at(-1)).toMatchObject({
      policy: { version: 2, decisions: { prices: "automation_disabled" } },
    });
    const blocked = await queue(f);
    expect(
      await app.dispatch(f.credentials, f.businessId, blocked.id),
    ).toMatchObject({ state: "cancelled", reason: "automation_disabled" });
    const staleLink = await queue(f);
    const detail = await inbox.conversation(
      f.credentials,
      f.businessId,
      f.conversationId,
    );
    await inbox.associate(f.credentials, f.businessId, detail.id, {
      expectedVersion: detail.association.version,
      buyerId: f.need.buyerId,
      allMessages: true,
      messageIds: [],
      target: { kind: "review" },
      future: "review",
      reason: "Wrong need",
    });
    expect(
      await app.dispatch(f.credentials, f.businessId, staleLink.id),
    ).toMatchObject({ state: "cancelled", reason: "association_changed" });
  });

  it("does not retry an ambiguous external effect or claim that takeover undoes an effect already started", async () => {
    const f = await setup("inflight");
    await enable(f);
    const action = await queue(f);
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    effect = async (value) => {
      outbound.push(value);
      entered();
      await gate;
      throw new Error("sensitive timeout after acceptance");
    };
    const dispatch = app.dispatch(f.credentials, f.businessId, action.id);
    const failure = expect(dispatch).rejects.toThrow(
      "sensitive timeout after acceptance",
    );
    await started;
    const pause = app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("takeover", 2),
    );
    await waitForBlocked(1);
    release();
    await failure;
    await pause;
    const count = outbound.length;
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "committed", reason: "dispatch_unconfirmed" });
    expect(outbound).toHaveLength(count);
    expect(
      (await app.read(f.credentials, f.businessId, f.need.id)).actions,
    ).toMatchObject([{ state: "committed" }]);
    effect = async (value) => {
      outbound.push(value);
    };
  });

  it("rechecks after durable commitment when a manual reply wins the final dispatch lock", async () => {
    const f = await setup("committed-race");
    await enable(f);
    const action = await queue(f);
    const gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(190019)");
    // Fixture-only PostgreSQL barrier, inside the real durable commitment. No application hook.
    await h.admin
      .query(`CREATE FUNCTION test_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(190019); RETURN NEW; END $$;
      CREATE TRIGGER test_commit_barrier BEFORE UPDATE ON opportunity_due_action FOR EACH ROW WHEN (NEW.state = 'committed' AND OLD.state = 'pending') EXECUTE FUNCTION test_commit_barrier()`);
    const before = outbound.length;
    const dispatch = app.dispatch(f.credentials, f.businessId, action.id);
    try {
      await waitForBlocked(1);
      const pause = app.manualReply(
        f.credentials,
        f.businessId,
        f.connection.id,
        manual(f),
      );
      await waitForBlocked(2);
      await gate.query("COMMIT");
      await pause;
      expect(await dispatch).toMatchObject({
        state: "cancelled",
        reason: "control_changed",
      });
      expect(outbound).toHaveLength(before);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await h.admin.query(
        "DROP TRIGGER test_commit_barrier ON opportunity_due_action; DROP FUNCTION test_commit_barrier()",
      );
    }
  });

  it("enforces HTTP origin, schema, Business, current membership/session/MFA, supported connection and safe diagnostics", async () => {
    const f = await setup("boundaries");
    const stranger = await h.signIn("control-stranger@example.com");
    const http = createOpportunityHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const request = (
      credentials: Headers,
      value: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request("http://localhost:3000/command", {
        method: "POST",
        headers: new Headers({
          cookie: credentials.get("cookie") ?? "",
          origin,
          "content-type": "application/json",
        }),
        body: JSON.stringify(value),
      });
    expect(
      (
        await http.change(
          request(
            f.credentials,
            command("takeover", 0),
            "https://other.example",
          ),
          f.businessId,
          f.need.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.change(
          request(f.credentials, {
            ...command("takeover", 0),
            actorId: f.actor.userId,
          }),
          f.businessId,
          f.need.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.read(
          new Request("http://localhost", { headers: stranger }),
          f.businessId,
          f.need.id,
        )
      ).status,
    ).toBe(404);
    const unsupported = await inbox.addConnection(f.credentials, f.businessId, {
      label: "No observable manual activity",
      channel: "whatsapp",
      conversationRefs: [],
    });
    await expect(
      app.manualReply(f.credentials, f.businessId, unsupported.id, manual(f)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app.manualReply(f.credentials, f.businessId, f.connection.id, {
        ...manual(f),
        actorId: f.actor.userId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      app.manualReply(f.credentials, f.businessId, f.connection.id, {
        ...manual(f),
        conversationRef: "unknown-thread",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      app.manualReply(f.credentials, f.businessId, f.connection.id, {
        ...manual(f),
        occurredAt: "2027-01-01T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await enable(f);
    const action = await queue(f);
    effect = async () => {
      throw new Error("private-provider-token-payload");
    };
    const response = await http.dispatch(
      request(f.credentials, {}),
      f.businessId,
      action.id,
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private-provider",
    );
    expect(JSON.stringify(h.diagnostics)).not.toContain("private-provider");
    effect = async (value) => {
      outbound.push(value);
    };
    const freshPrimaryOnly = await h.signIn(
      "control-boundaries@example.com",
      false,
    );
    await expect(
      app.change(
        freshPrimaryOnly,
        f.businessId,
        f.need.id,
        command("takeover", 2),
      ),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await h.signOut(f.credentials);
    await expect(
      app.change(
        f.credentials,
        f.businessId,
        f.need.id,
        command("handback", 2),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("allows Salespeople to take over but checks current owner/role and revoked membership, connection and original queued session", async () => {
    const f = await setup("revocations");
    async function join(email: string) {
      await h.team.invite(f.credentials, f.businessId, {
        email,
        role: "salesperson",
      });
      const notification = h.invitations.sent.at(-1)!;
      const credentials = await h.signIn(email, false);
      await h.team.accept(credentials, {
        token: new URLSearchParams(new URL(notification.url).hash.slice(1)).get(
          "token",
        ),
      });
      return credentials;
    }
    const sales = await join("control-sales@example.com");
    const other = await join("control-other-sales@example.com");
    await app.change(sales, f.businessId, f.need.id, command("takeover", 0));
    const salesperson = await h.authenticate(sales);
    expect(await app.read(sales, f.businessId, f.need.id)).toMatchObject({
      ownerId: salesperson.userId,
    });
    await expect(
      app.change(other, f.businessId, f.need.id, command("handback", 1)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app.change(other, f.businessId, f.need.id, command("update", 1)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.team.removeMember(f.credentials, f.businessId, {
      userId: salesperson.userId,
    });
    await expect(
      app.read(sales, f.businessId, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      app.manualReply(sales, f.businessId, f.connection.id, manual(f)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Owners can recover an assignment whose former owner lost membership.
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("takeover", 1),
    );
    const policy = await authority.workspace(f.credentials, f.businessId);
    policy.policy.prices = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 0,
      escalationOwnerId: f.actor.userId,
    };
    await authority.save(f.credentials, f.businessId, {
      expectedVersion: 0,
      policy: policy.policy,
      note: "Bounded authority",
    });
    await app.change(
      f.credentials,
      f.businessId,
      f.need.id,
      command("handback", 2),
    );
    const action = await queue(f);
    const before = outbound.length;
    await inbox.revokeConnection(f.credentials, f.businessId, f.connection.id);
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "connection_revoked" });
    await expect(
      app.manualReply(f.credentials, f.businessId, f.connection.id, manual(f)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(outbound).toHaveLength(before);
    const g = await setup("session-revocation");
    await enable(g);
    const queued = await queue(g);
    const replacementSession = await h.signIn(
      "control-session-revocation@example.com",
    );
    await h.signOut(g.credentials);
    await expect(
      app.dispatch(replacementSession, g.businessId, queued.id),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    h.clock.set("2026-11-05T22:00:00Z");
    await expect(
      app.change(
        replacementSession,
        g.businessId,
        g.need.id,
        command("handback", 2),
      ),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    h.clock.set("2026-11-05T09:00:00Z");
    expect(outbound).toHaveLength(before);
  });

  it("dispatches an allowed due action only once across concurrent invocations and later replay", async () => {
    const f = await setup("dispatch-once");
    await enable(f);
    const action = await queue(f);
    const before = outbound.length;
    await Promise.all([
      app.dispatch(f.credentials, f.businessId, action.id),
      app.dispatch(f.credentials, f.businessId, action.id),
    ]);
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "dispatched" });
    expect(outbound).toHaveLength(before + 1);
  });

  it("persists control, replay protection and queued state across schema reconciliation, and never resumes on a timer or new message", async () => {
    const f = await setup("reconcile");
    await enable(f);
    const action = await queue(f);
    const activity = manual(f);
    await app.manualReply(
      f.credentials,
      f.businessId,
      f.connection.id,
      activity,
    );
    const before = await app.read(f.credentials, f.businessId, f.need.id);
    await h.reapplySchema();
    expect(await app.read(f.credentials, f.businessId, f.need.id)).toEqual(
      before,
    );
    expect(
      await app.manualReply(
        f.credentials,
        f.businessId,
        f.connection.id,
        activity,
      ),
    ).toMatchObject({ status: "duplicate" });
    h.clock.set("2026-11-05T10:00:00Z");
    await inbox.capture(f.credentials, f.businessId, f.connection.id, {
      eventId: "later-inquiry",
      messageRef: "later-message",
      conversationRef: `thread-${f.suffix}`,
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Steel",
      text: "Another question",
      occurredAt: h.clock.now().toISOString(),
    });
    expect(
      await app.read(f.credentials, f.businessId, f.need.id),
    ).toMatchObject({ state: "human", version: 3 });
    expect(
      await app.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled" });
    const security = await h.admin.query(
      `select count(*)::int as protected from pg_class where relname in ('opportunity_control_history','opportunity_manual_event','opportunity_due_action') and relrowsecurity and relforcerowsecurity`,
    );
    expect(security.rows[0].protected).toBe(3);
    await expect(
      h.runtime.query(
        "update opportunity_control_history set command='handback'",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query("update opportunity_manual_event set actor_id='forged'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query(
        "update opportunity_due_action set evaluation='{}'::jsonb",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await h.runtime.query("select * from opportunity_control_history")).rows,
    ).toEqual([]);
    h.clock.set("2026-11-05T09:00:00Z");
  });
  it("rejects an invoking session revoked while dispatch waits, even when the queue's originating session remains valid", async () => {
    const f = await setup("invoking-session");
    await enable(f);
    const action = await queue(f);
    const invoking = await h.signIn("control-invoking-session@example.com");
    const gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      f.businessId,
    ]);
    const before = outbound.length;
    const dispatch = app.dispatch(invoking, f.businessId, action.id);
    const rejected = expect(dispatch).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    try {
      await waitForBlocked(1);
      await h.signOut(invoking);
      await gate.query("COMMIT");
      await rejected;
      expect(outbound).toHaveLength(before);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
    }
  });

  it("rechecks a waiting control read against current session and MFA", async () => {
    for (const mode of ["revoked", "mfa-expired"]) {
      const f = await setup(`read-${mode}`);
      const gate = await h.admin.connect();
      await gate.query("BEGIN");
      await gate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        f.businessId,
      ]);
      const read = app.read(f.credentials, f.businessId, f.need.id);
      const rejected = expect(read).rejects.toMatchObject({
        code: mode === "revoked" ? "UNAUTHENTICATED" : "MFA_REQUIRED",
      });
      try {
        await waitForBlocked(1);
        if (mode === "revoked") await h.signOut(f.credentials);
        else h.clock.set("2026-11-05T22:00:00Z");
        await gate.query("COMMIT");
        await rejected;
      } finally {
        await gate.query("ROLLBACK");
        gate.release();
        h.clock.set("2026-11-05T09:00:00Z");
      }
    }
  });

  it("persists a known authorization cancellation when the queued session is revoked after commitment validation", async () => {
    const f = await setup("postcommit-revoke");
    await enable(f);
    const action = await queue(f);
    const surviving = await h.signIn("control-postcommit-revoke@example.com");
    const gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(190020)");
    await h.admin
      .query(`CREATE FUNCTION test_auth_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(190020); RETURN NEW; END $$;
      CREATE TRIGGER test_auth_barrier BEFORE UPDATE ON opportunity_due_action FOR EACH ROW WHEN (NEW.state = 'committed' AND OLD.state = 'pending') EXECUTE FUNCTION test_auth_barrier()`);
    const before = outbound.length;
    const dispatch = app.dispatch(f.credentials, f.businessId, action.id);
    const failure = expect(dispatch).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    try {
      await waitForBlocked(1);
      await h.signOut(f.credentials);
      await gate.query("COMMIT");
      await failure;
      expect(
        (await app.read(surviving, f.businessId, f.need.id)).actions,
      ).toMatchObject([
        { state: "cancelled", reason: "authorization_revoked" },
      ]);
      expect(outbound).toHaveLength(before);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await h.admin.query(
        "DROP TRIGGER test_auth_barrier ON opportunity_due_action; DROP FUNCTION test_auth_barrier()",
      );
    }
  });
});
