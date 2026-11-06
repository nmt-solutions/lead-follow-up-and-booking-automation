import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createGmailApplication } from "../src/application/gmail";
import { gmailFixture } from "./support/gmail";
import { gmailReadScope, gmailSendScope } from "../src/models/gmail";
import { configuredGmail } from "../src/gmail/configuration";
import { createGmailHttpHandlers } from "../src/http/gmail";
import type { FailureDiagnostic } from "../src/http/respond";
import { createGmailProvider } from "../src/gmail/provider";
import { createGmailConnection } from "../src/gmail/connection";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";

describe("Selected Gmail at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function setup() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`gmail-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Steel",
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
    const connection = await senders.saveConnection(credentials, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Gmail sales",
        provider: "gmail",
        account: "sales@supplier.example",
        enabled: true,
      },
    });
    const mailboxes = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const mailbox = await mailboxes.save(credentials, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: connection.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["Label_sales"] },
        history: null,
        salesSubjectTerms: ["inquiry"],
      },
    });
    const google = gmailFixture();
    const app = createGmailApplication({
      access: h.access,
      connection: createGmailConnection(database, {
        clock: h.clock,
        configuration: google.configuration,
        fetch: google.fetch,
      }),
    });
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      enqueue: async () => {},
      repository: createMailboxRepository(database, h.clock),
      provider: createGmailProvider(
        createGmailConnection(database, {
          clock: h.clock,
          configuration: google.configuration,
          fetch: google.fetch,
        }),
        h.clock,
      ),
      clock: h.clock,
    });
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const effects: unknown[] = [];
    const transport = { failAfterAccept: false };
    const control = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(database, h.clock),
      clock: h.clock,
      provider: {
        channels: ["email", "whatsapp"],
        async dispatch(action) {
          effects.push(action);
          if (transport.failAfterAccept)
            throw new Error("fixture provider acceptance is uncertain");
        },
      },
    });
    return {
      credentials,
      businessId: business.id,
      mailbox,
      app,
      google,
      database,
      mailboxes,
      sync,
      inbox,
      control,
      effects,
      transport,
    };
  }
  async function connect(f: Awaited<ReturnType<typeof setup>>) {
    const start = await f.app.start(f.credentials, f.businessId, f.mailbox.id);
    const input = {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    };
    await f.app.callback(f.credentials, f.businessId, f.mailbox.id, input);
    return input;
  }
  async function synchronize(
    f: Awaited<ReturnType<typeof setup>>,
    mode: "history" | "incremental" = "incremental",
  ) {
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode,
    });
    let result = await f.sync.execute(work);
    for (
      let i = 0;
      result?.status === "partial" &&
      !result.reason?.includes("limit") &&
      i < 10;
      i++
    )
      result = await f.sync.execute(work);
    return result;
  }
  async function pending(
    f: Awaited<ReturnType<typeof setup>>,
    conversationId: string,
    messageIndex = 0,
  ) {
    const detail = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      conversationId,
    );
    const needId = detail.messages[messageIndex].opportunityId!;
    const before = await f.control.read(f.credentials, f.businessId, needId);
    await f.control.change(f.credentials, f.businessId, needId, {
      command: "takeover",
      expectedVersion: before.version,
      reason: "Review",
      nextAction: "Evaluate",
    });
    await f.control.change(f.credentials, f.businessId, needId, {
      command: "handback",
      expectedVersion: before.version + 1,
      reason: "Reviewed",
      nextAction: "Evaluate under current policy",
    });
    return f.control.queue(f.credentials, f.businessId, needId, {
      messageId: detail.messages[messageIndex].id,
      dueAt: h.clock.now().toISOString(),
      evaluation: {
        action: "prices",
        amount: { currency: "USD", minor: "1000" },
        discountBps: 0,
      },
    });
  }
  it("binds separate read consent to the current Business/mailbox/session, encrypts tokens and rejects replay", async () => {
    const f = await setup();
    const start = await f.app.start(f.credentials, f.businessId, f.mailbox.id);
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get("scope")).toBe(
      `openid email ${gmailReadScope}`,
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const input = {
      state: url.searchParams.get("state"),
      code: "fixture-code",
    };
    await f.app.callback(f.credentials, f.businessId, f.mailbox.id, input);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "connected", read: true, send: false });
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const stored = await h.admin.query(
      "select credentials from gmail_grant where business_id = $1",
      [f.businessId],
    );
    expect(stored.rows[0].credentials).not.toMatch(
      /fixture-access|fixture-refresh/,
    );
    expect(
      JSON.stringify(
        await f.app.read(f.credentials, f.businessId, f.mailbox.id),
      ),
    ).not.toMatch(/fixture-access|fixture-refresh|client_secret/);
  });
  it("imports only selected new per-message content, persists a large history cursor, then deduplicates incremental replies", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("a1");
    f.google.add("a2", { at: "2026-11-04T09:00:00Z" });
    f.google.add("a3", { labels: ["INBOX"] });
    f.google.pages.set("Label_sales", {
      messages: [
        { id: "a1", threadId: "abc123" },
        { id: "a2", threadId: "abc123" },
        { id: "a3", threadId: "abc123" },
      ],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(f.database, h.clock),
      provider: createGmailProvider(
        createGmailConnection(f.database, {
          clock: h.clock,
          configuration: f.google.configuration,
          fetch: f.google.fetch,
        }),
        h.clock,
      ),
      clock: h.clock,
    });
    const work = await sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    let result = await sync.execute(work);
    for (let i = 0; result?.status === "partial" && i < 5; i++)
      result = await sync.execute(work);
    expect(result).toMatchObject({
      status: "completed",
      captured: 1,
      excluded: 2,
    });
    expect(f.google.bodyReads).toEqual(["a1"]);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(f.database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const visible = await inbox.workspace(f.credentials, f.businessId);
    expect(visible.conversations).toHaveLength(1);
    expect(
      (
        await inbox.conversation(
          f.credentials,
          f.businessId,
          visible.conversations[0].id,
        )
      ).messages[0].text,
    ).toBe("Need steel please");
    const next = await sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await sync.execute(next);
    expect(
      f.google.calls
        .find((c) => c.url.pathname.endsWith("/history"))
        ?.url.searchParams.get("startHistoryId"),
    ).toBe("18446744073709551629");
    expect(
      (await inbox.workspace(f.credentials, f.businessId)).opportunities,
    ).toHaveLength(1);
  });
  it("applies an authenticated manual Gmail reply through the shared Opportunity takeover exactly once, including reordered pages", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("b1");
    f.google.add("b2", {
      at: "2026-11-05T09:02:00Z",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<b1@example.com>",
      text: "I will handle your quote",
    });
    f.google.pages.set("Label_sales", {
      messages: [{ id: "b2", threadId: "abc123" }],
      nextPageToken: "older-page",
    });
    f.google.pages.set("older-page", {
      messages: [{ id: "b1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:03:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      captured: 2,
    });
    const workspace = await f.inbox.workspace(f.credentials, f.businessId);
    const need = workspace.opportunities[0];
    expect(
      await f.control.read(f.credentials, f.businessId, need.id),
    ).toMatchObject({ state: "human", history: [{ command: "manual_reply" }] });
    const conversation = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      workspace.conversations[0].id,
    );
    expect(conversation.manualReplies).toMatchObject([
      {
        text: "I will handle your quote",
        state: "applied",
        opportunityId: need.id,
      },
    ]);
    const paused = await f.control.read(f.credentials, f.businessId, need.id);
    await f.control.change(f.credentials, f.businessId, need.id, {
      command: "handback",
      expectedVersion: paused.version,
      reason: "Resolved",
      nextAction: "Evaluate new work",
    });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "b2" } }],
        },
      ],
    });
    await synchronize(f);
    expect(
      await f.control.read(f.credentials, f.businessId, need.id),
    ).toMatchObject({ state: "automation", version: 2 });
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, conversation.id))
        .manualReplies,
    ).toHaveLength(1);
    expect(f.effects).toEqual([]);
  });
  it("ends the same Opportunity's unanswered actions at the actual dispatch seam when an incoming reply arrives", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("c1");
    f.google.add("c2", { thread: "def456" });
    f.google.pages.set("Label_sales", {
      messages: [
        { id: "c1", threadId: "abc123" },
        { id: "c2", threadId: "def456" },
      ],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const workspace = await f.inbox.workspace(f.credentials, f.businessId);
    const first = workspace.conversations.find((c) => c.id)!;
    const original = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      first.id,
    );
    const second = workspace.conversations.find((c) => c.id !== first.id)!;
    const action = await pending(f, first.id),
      other = await pending(f, second.id);
    f.google.add("c3", {
      at: "2026-11-05T09:03:00Z",
      thread: original.providerRef,
      reply: `<${original.messages[0].messageRef}@example.com>`,
    });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "c3" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T09:04:00Z");
    await synchronize(f);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "buyer_replied" });
    const otherNeed = (
      await f.inbox.conversation(f.credentials, f.businessId, second.id)
    ).messages[0].opportunityId!;
    expect(
      (await f.control.read(f.credentials, f.businessId, otherNeed)).actions,
    ).toContainEqual(
      expect.objectContaining({ id: other.id, state: "pending" }),
    );
    expect(f.effects).toEqual([]);
  });
  it("uses OR label selection with provider IDs, resumes long page tokens and keeps one bounded history allowance", async () => {
    const f = await setup();
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "folders", refs: ["Label_sales", "Label_quotes"] },
        history: {
          from: "2026-11-01T00:00:00Z",
          to: "2026-11-05T09:00:00Z",
          maxMessages: 2,
        },
      },
    });
    await connect(f);
    f.google.add("d1", { at: "2026-11-02T00:00:00Z" });
    f.google.add("d2", {
      at: "2026-11-03T00:00:00Z",
      labels: ["Label_quotes"],
      thread: "fed123",
    });
    f.google.add("d3", {
      at: "2026-11-04T00:00:00Z",
      labels: ["Label_quotes"],
    });
    const token = "long-page-token-".repeat(80);
    f.google.pages.set("Label_sales", {
      messages: [{ id: "d1", threadId: "abc123" }],
      nextPageToken: token,
    });
    f.google.pages.set(token, { messages: [] });
    f.google.pages.set("Label_quotes", {
      messages: [{ id: "d2", threadId: "fed123" }],
      nextPageToken: "beyond-limit",
    });
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "history",
    });
    expect(await f.sync.execute(work)).toMatchObject({
      captured: 1,
      status: "partial",
    });
    f.google.control.apiError = 429;
    expect(await f.sync.execute(work)).toMatchObject({
      reason: "rate_limited",
      checkpoint: 1,
    });
    f.google.control.apiError = 0;
    await f.sync.execute(work);
    expect(await f.sync.execute(work)).toMatchObject({
      captured: 2,
      reason: "limit_reached",
    });
    expect(await f.sync.execute(work)).toBeNull();
    const lists = f.google.calls.filter((c) =>
      c.url.pathname.endsWith("/messages"),
    );
    expect(lists.map((c) => c.url.searchParams.getAll("labelIds"))).toEqual([
      ["Label_sales"],
      ["Label_sales"],
      ["Label_quotes"],
    ]);
    expect(lists[1].url.searchParams.get("pageToken")).toBe(token);
    expect(f.google.bodyReads).toEqual(["d1", "d2"]);
    expect(
      JSON.stringify(await f.sync.workspace(f.credentials, f.businessId)),
    ).not.toContain(token);
  });
  it("reads only individually approved messages of an exact thread, with history off and unknown mail excluded", async () => {
    const f = await setup();
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "threads", refs: ["abc123"] },
        salesSubjectTerms: [],
      },
    });
    await connect(f);
    f.google.add("e1");
    f.google.add("e2", { at: "2026-11-04T00:00:00Z" });
    f.google.add("e3", { labels: ["SPAM"] });
    f.google.add("e4", { thread: "fed123" });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      captured: 1,
      status: "completed",
    });
    expect(f.google.bodyReads).toEqual(["e1"]);
    expect(
      f.google.calls
        .filter((c) => c.url.pathname.includes("/threads/"))
        .every((c) => c.url.searchParams.get("format") !== "full"),
    ).toBe(true);
  });
  it("recovers an expired history cursor only within approved new-mail bounds and retains the incomplete-history pause", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("f1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "f1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const workspace = await f.inbox.workspace(f.credentials, f.businessId),
      action = await pending(f, workspace.conversations[0].id);
    f.google.histories.set("18446744073709551630", "expired");
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    expect(await f.sync.execute(work)).toMatchObject({
      status: "partial",
      reason: "cursor_recovery",
    });
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .visibility,
    ).toBe("recovering");
    await f.sync.execute(work);
    expect(await f.sync.execute(work)).toMatchObject({
      status: "completed",
      reason: "history_gap",
      duplicates: 1,
    });
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .visibility,
    ).toBe("limited");
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled" });
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          workspace.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(1);
    expect(
      f.google.calls
        .filter((c) => c.url.pathname.endsWith("/messages"))
        .every((c) => c.url.searchParams.get("q") === "after:1793869199"),
    ).toBe(true);
    expect(f.effects).toEqual([]);
  });
  it.each([429, 403, 401])(
    "pauses affected follow-ups after Gmail visibility fails (%s) and retains inbox/history",
    async (status) => {
      const f = await setup();
      await connect(f);
      f.google.add("g1");
      f.google.pages.set("Label_sales", {
        messages: [{ id: "g1", threadId: "abc123" }],
      });
      h.clock.set("2026-11-05T09:02:00Z");
      await synchronize(f);
      const workspace = await f.inbox.workspace(f.credentials, f.businessId),
        action = await pending(f, workspace.conversations[0].id);
      f.google.control.apiError = status;
      const work = await f.sync.queue(
        f.credentials,
        f.businessId,
        f.mailbox.id,
        { mode: "incremental" },
      );
      expect(await f.sync.execute(work)).toMatchObject({
        reason: status === 429 ? "rate_limited" : "permission_required",
      });
      expect(
        (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
          .visibility,
      ).toBe("unsafe");
      expect(
        await f.control.dispatch(f.credentials, f.businessId, action.id),
      ).toMatchObject({
        state: "cancelled",
        reason: "reply_visibility_unavailable",
      });
      expect(
        (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
      ).toHaveLength(1);
      expect(f.effects).toEqual([]);
    },
  );
  it("keeps send-only and calendar-only consent separate from Gmail reading and requested permission", async () => {
    const f = await setup();
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        requestedRead: false,
        requestedSend: true,
      },
    });
    f.google.control.scopes = `openid email ${gmailSendScope}`;
    const start = await f.app.start(f.credentials, f.businessId, f.mailbox.id);
    expect(new URL(start.authorizationUrl).searchParams.get("scope")).toBe(
      `openid email ${gmailSendScope}`,
    );
    await f.app.callback(f.credentials, f.businessId, f.mailbox.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "connected", read: false, send: true });
    await expect(
      f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
        mode: "incremental",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await setup();
    other.google.control.scopes =
      "openid email https://www.googleapis.com/auth/calendar.events";
    await connect(other);
    expect(
      await other.app.read(
        other.credentials,
        other.businessId,
        other.mailbox.id,
      ),
    ).toMatchObject({ status: "insufficient", read: false, send: false });
    expect(await synchronize(other)).toMatchObject({
      status: "blocked",
      reason: "permission_required",
    });
    expect(
      other.google.calls.some((c) => c.url.hostname === "gmail.googleapis.com"),
    ).toBe(false);
  });
  it("refreshes encrypted Gmail tokens, fences a concurrent disconnect, and keeps failed remote revocation locally disabled", async () => {
    const f = await setup();
    await connect(f);
    h.clock.set("2026-11-05T10:01:00Z");
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    let release!: () => void, started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
      }),
      barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
    f.google.control.beforeRefresh = async () => {
      started();
      await barrier;
    };
    const running = f.sync.execute(work).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await start;
    f.google.control.revokeError = 503;
    expect(
      await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "revocation_pending", read: false });
    release();
    expect(await running).toMatchObject({ error: { code: "CONFLICT" } });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "revocation_pending", read: false });
    f.google.control.revokeError = 0;
    expect(
      await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "disconnected", read: false });
    await connect(f);
    h.clock.set("2026-11-05T11:02:00Z");
    f.google.control.beforeRefresh = undefined;
    expect(await synchronize(f)).toMatchObject({ status: "completed" });
    expect(f.google.control.refreshes).toBe(2);
    const encrypted = await h.admin.query(
      "select credentials from gmail_grant where business_id=$1",
      [f.businessId],
    );
    expect(encrypted.rows[0].credentials).not.toMatch(
      /fixture-access|fixture-refresh/,
    );
  });
  it("rejects scope and actor changes during provider I/O before inbox ingestion", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("race1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "race1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    f.google.control.beforeBody = async () => {
      f.google.control.beforeBody = undefined;
      f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
        id: f.mailbox.id,
        expectedVersion: f.mailbox.version,
        configuration: { ...f.mailbox.configuration, requestedRead: false },
      });
    };
    await expect(synchronize(f)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toEqual([]);
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0],
    ).toMatchObject({ visibility: "unsafe", grant: null });
    const g = await setup();
    await connect(g);
    g.google.add("race2");
    g.google.pages.set("Label_sales", {
      messages: [{ id: "race2", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    g.google.control.beforeBody = async () => {
      const actor = await h.authenticate(g.credentials);
      await h.admin.query(
        "update membership set role='salesperson' where business_id=$1 and user_id=$2",
        [g.businessId, actor.userId],
      );
    };
    await expect(synchronize(g)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await g.inbox.workspace(g.credentials, g.businessId)).conversations,
    ).toEqual([]);
  });
  it("denies wrong Business, role, session, superseded/expired state and missing MFA without code exchange", async () => {
    const f = await setup(),
      other = await setup();
    const start = await f.app.start(f.credentials, f.businessId, f.mailbox.id),
      input = {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      };
    await expect(
      f.app.callback(other.credentials, f.businessId, f.mailbox.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.app.callback(f.credentials, other.businessId, other.mailbox.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const session = await h.auth.api.getSession({ headers: f.credentials });
    const otherSession = await h.signIn(session!.user.email);
    await expect(
      f.app.callback(otherSession, f.businessId, f.mailbox.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const actor = await h.authenticate(f.credentials);
    await h.admin.query(
      "update membership set role='salesperson' where business_id=$1 and user_id=$2",
      [f.businessId, actor.userId],
    );
    await expect(
      f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.app.disconnect(f.credentials, f.businessId, f.mailbox.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "update membership set role='owner' where business_id=$1 and user_id=$2",
      [f.businessId, actor.userId],
    );
    const fresh = await f.app.start(f.credentials, f.businessId, f.mailbox.id);
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    h.clock.set("2026-11-05T09:11:00Z");
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, {
        state: new URL(fresh.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    h.clock.set("2026-11-05T22:00:00Z");
    await expect(
      f.app.start(f.credentials, f.businessId, f.mailbox.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.google.calls).toEqual([]);
  });
  it("consumes denied and failed callbacks, quarantines account substitutions and revokes only by explicit action", async () => {
    const f = await setup();
    const denied = await f.app.start(f.credentials, f.businessId, f.mailbox.id),
      deniedInput = {
        state: new URL(denied.authorizationUrl).searchParams.get("state"),
        error: "private-provider-payload",
      };
    await f.app.callback(
      f.credentials,
      f.businessId,
      f.mailbox.id,
      deniedInput,
    );
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, deniedInput),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ reason: "consent_denied", read: false });
    f.google.control.email = "other-private@example.com";
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ reason: "account_mismatch", read: false });
    const quarantined = await h.admin.query(
      "select credentials,rejected_credentials from gmail_grant where business_id=$1",
      [f.businessId],
    );
    expect(quarantined.rows[0].credentials).toBeNull();
    expect(quarantined.rows[0].rejected_credentials).not.toContain(
      "fixture-refresh",
    );
    expect(f.google.calls.some((c) => c.url.pathname === "/revoke")).toBe(
      false,
    );
    expect(
      await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "disconnected" });
    expect(
      f.google.calls.find((c) => c.url.pathname === "/revoke")?.body.token,
    ).toBe("fixture-refresh");
    f.google.control.email = "sales@supplier.example";
    f.google.control.tokenError = 400;
    const failed = await connect(f);
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, failed),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ read: false });
  });
  it("validates HTTP payloads/CSRF, hides private diagnostics, and refuses unconfigured production activation", async () => {
    const f = await setup(),
      diagnostics: FailureDiagnostic[] = [];
    const http = createGmailHttpHandlers({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const request = (origin: string, body: string) =>
      new Request("http://localhost:3000/api/gmail", {
        method: "POST",
        headers: {
          ...Object.fromEntries(f.credentials),
          origin,
          "Content-Type": "application/json",
        },
        body,
      });
    expect(
      (
        await http.start(
          request("https://evil.example", "{}"),
          f.businessId,
          f.mailbox.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.start(
          request("http://localhost:3000", '{"tokens":"private-secret"}'),
          f.businessId,
          f.mailbox.id,
        )
      ).status,
    ).toBe(400);
    const callback = new Request(
      "http://localhost:3000/callback?state=a&state=b&code=private-secret",
      { headers: f.credentials },
    );
    const response = await http.callback(callback, f.businessId, f.mailbox.id);
    expect(response.status).toBe(400);
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(
      JSON.stringify({ diagnostics, response: await response.json() }),
    ).not.toMatch(/private-secret|fixture-secret|code=|stack/);
    expect(
      configuredGmail({
        GOOGLE_CALENDAR_APPROVED: "true",
        GOOGLE_CALENDAR_CLIENT_ID: "calendar",
        GMAIL_OAUTH_APPROVED: "true",
      }),
    ).toBeNull();
    expect(f.google.calls).toEqual([]);
  });
  it("validates malformed nested MIME/headers without retaining a partial page or private provider error", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("bad1", { text: "\0private-body-instructions" });
    f.google.pages.set("Label_sales", {
      messages: [{ id: "bad1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "blocked",
      reason: "invalid_provider_response",
      captured: 0,
      checkpoint: 0,
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toEqual([]);
    expect(
      JSON.stringify(await f.sync.workspace(f.credentials, f.businessId)),
    ).not.toContain("private-body-instructions");
    const good = f.google.add("bad1");
    good.payload.headers.push({ name: "From", value: "forged@example.com" });
    f.google.bodyReads.length = 0;
    expect(await synchronize(f)).toMatchObject({
      reason: "invalid_provider_response",
    });
    expect(f.google.bodyReads).toEqual([]);
  });
  it("does not silently claim safe reply visibility when a new reply disappears before its body can be observed", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("lost1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "lost1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "lost2" } }],
          messagesDeleted: [
            {
              message: {
                id: "lost2",
                threadId: "abc123",
                labelIds: ["Label_sales"],
              },
            },
          ],
        },
      ],
    });
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      reason: "history_gap",
    });
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .visibility,
    ).toBe("limited");
  });
  it("resumes the same delayed poll after enqueue loss and denies forged/replayed/concurrent worker effects", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("j1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "j1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    const concurrent = await Promise.allSettled([
      f.sync.execute(work),
      f.sync.execute(work),
    ]);
    expect(concurrent.some((r) => r.status === "fulfilled")).toBe(true);
    await f.sync.execute(work);
    h.clock.set("2026-11-05T09:03:00Z");
    const next = await f.sync.repeat(work);
    expect(next).not.toBeNull();
    expect(await f.sync.repeat(work)).toEqual(next);
    await f.sync.execute(next);
    expect(await f.sync.execute(next)).toBeNull();
    const visible = await f.inbox.workspace(f.credentials, f.businessId);
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          visible.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(1);
    const other = await setup();
    await expect(
      f.sync.execute({ ...work, businessId: other.businessId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherIdentity = await h.access.authenticateForWork(other.credentials);
    await expect(
      f.sync.execute({ ...work, identity: otherIdentity }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.effects).toEqual([]);
  });
  it("keeps unknown subjects/identities and unsupported manual mail outside body reads and retains unmatched approved replies", async () => {
    const f = await setup();
    await connect(f);
    const personal = f.google.add("k1");
    personal.payload.headers.find((v) => v.name === "Subject")!.value =
      "Family holiday";
    f.google.add("k2", {
      from: "someone@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<missing@example.com>",
    });
    f.google.add("k3", {
      from: "sales@supplier.example",
      to: "buyer@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<missing@example.com>",
    });
    f.google.add("k4", { to: "unknown@example.com" });
    f.google.pages.set("Label_sales", {
      messages: ["k1", "k2", "k3", "k4"].map((id) => ({
        id,
        threadId: "abc123",
      })),
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      reason: "manual_reply_review",
      captured: 1,
      excluded: 3,
    });
    expect(f.google.bodyReads).toEqual(["k3"]);
    const state = (await f.sync.workspace(f.credentials, f.businessId))
      .mailboxes[0];
    expect(state).toMatchObject({
      pendingManualReplies: 1,
      visibility: "limited",
      manualReplyReview: [{ inReplyTo: "<missing@example.com>" }],
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).opportunities,
    ).toEqual([]);
  });
  it("preserves encrypted grants, correspondence and forced tenant security across a populated additive schema reapply", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("l1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "l1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const before = await f.sync.workspace(f.credentials, f.businessId);
    await h.reapplySchema();
    expect(await f.sync.workspace(f.credentials, f.businessId)).toEqual(before);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "connected", read: true });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    const security = await h.admin.query(
      "select c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('app_runtime',c.oid,'DELETE') as can_delete from pg_class c where c.relname in ('gmail_grant','gmail_oauth','gmail_manual_message')",
    );
    expect(security.rows).toHaveLength(3);
    for (const row of security.rows)
      expect(row).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        can_delete: false,
      });
    expect((await h.runtime.query("select id from gmail_grant")).rows).toEqual(
      [],
    );
  });
  it("pauses a shared email/WhatsApp Opportunity for a Gmail manual reply while another need keeps its queued work", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("m1");
    f.google.add("m2", { thread: "fed123" });
    f.google.pages.set("Label_sales", {
      messages: [
        { id: "m1", threadId: "abc123" },
        { id: "m2", threadId: "fed123" },
      ],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const initial = await f.inbox.workspace(f.credentials, f.businessId);
    const details = await Promise.all(
      initial.conversations.map((c) =>
        f.inbox.conversation(f.credentials, f.businessId, c.id),
      ),
    );
    const email = details.find((c) => c.providerRef === "abc123")!,
      other = details.find((c) => c.providerRef === "fed123")!;
    const whatsapp = await f.inbox.addConnection(f.credentials, f.businessId, {
      label: "Verified WhatsApp activity",
      channel: "whatsapp",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await f.inbox.capture(f.credentials, f.businessId, whatsapp.id, {
      eventId: "wa",
      messageRef: "wa1",
      conversationRef: "wa-thread",
      senderRef: "+12025550100",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Same steel need",
      text: "Following up by WhatsApp",
      occurredAt: h.clock.now().toISOString(),
    });
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      wa = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        w.conversations.find((c) => c.channel === "whatsapp")!.id,
      );
    await f.inbox.associate(f.credentials, f.businessId, wa.id, {
      expectedVersion: wa.association.version,
      buyerId: email.buyer.id,
      messageIds: [],
      allMessages: true,
      target: {
        kind: "existing",
        opportunityId: email.messages[0].opportunityId,
      },
      future: "target",
      reason: "Human verified the same buyer and purchasing need",
    });
    const shared = await pending(f, wa.id),
      independent = await pending(f, other.id);
    f.google.add("m3", {
      at: "2026-11-05T09:03:00Z",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<m1@example.com>",
    });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "m3" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T09:04:00Z");
    await synchronize(f);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, shared.id),
    ).toMatchObject({ state: "cancelled", reason: "control_changed" });
    expect(
      await f.control.read(
        f.credentials,
        f.businessId,
        email.messages[0].opportunityId!,
      ),
    ).toMatchObject({
      state: "human",
      history: expect.arrayContaining([
        expect.objectContaining({ command: "manual_reply" }),
      ]),
    });
    expect(
      (
        await f.control.read(
          f.credentials,
          f.businessId,
          other.messages[0].opportunityId!,
        )
      ).actions,
    ).toContainEqual(
      expect.objectContaining({ id: independent.id, state: "pending" }),
    );
    expect(f.effects).toEqual([]);
  });
  it("honors provider label removal at subsequent action dispatch while retaining the originally authorized message", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("n1");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "n1", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const state = await f.inbox.workspace(f.credentials, f.businessId),
      action = await pending(f, state.conversations[0].id);
    f.google.add("n1", { labels: ["INBOX"] });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          labelsRemoved: [{ message: { id: "n1" } }],
        },
      ],
    });
    await synchronize(f);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "connection_revoked" });
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          state.conversations[0].id,
        )
      ).messages[0].text,
    ).toBe("Need steel please");
    expect(f.google.bodyReads).toEqual(["n1"]);
    expect(f.effects).toEqual([]);
  });
  it("surfaces missing durable worker setup instead of presenting OAuth as active synchronization", async () => {
    const f = await setup();
    await connect(f);
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(f.database, h.clock),
      provider: createGmailProvider(
        createGmailConnection(f.database, {
          clock: h.clock,
          configuration: f.google.configuration,
          fetch: f.google.fetch,
        }),
        h.clock,
      ),
      clock: h.clock,
    });
    await sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    expect(
      (await sync.workspace(f.credentials, f.businessId)).mailboxes[0],
    ).toMatchObject({
      visibility: "unsafe",
      jobs: [{ status: "blocked", reason: "worker_required" }],
    });
    expect(f.google.bodyReads).toEqual([]);
  });
  it("follows a received → manual → buyer/manual reply chain to the current need instead of the thread default", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("chain1");
    f.google.add("chain2", { at: "2026-11-05T09:02:00Z" });
    f.google.pages.set("Label_sales", {
      messages: [
        { id: "chain1", threadId: "abc123" },
        { id: "chain2", threadId: "abc123" },
      ],
    });
    h.clock.set("2026-11-05T09:03:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      conversation = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        w.conversations[0].id,
      );
    await f.inbox.associate(f.credentials, f.businessId, conversation.id, {
      expectedVersion: conversation.association.version,
      buyerId: conversation.buyer.id,
      messageIds: [conversation.messages[1].id],
      allMessages: false,
      target: { kind: "new", title: "Second need in the same thread" },
      future: "keep",
      reason: "Human verified two independent purchasing needs",
    });
    const split = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        conversation.id,
      ),
      secondNeed = split.messages[1].opportunityId!;
    f.google.add("chains1", {
      at: "2026-11-05T09:04:00Z",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<chain2@example.com>",
    });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "chains1" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T09:05:00Z");
    await synchronize(f);
    const action = await pending(f, conversation.id, 1),
      independent = await pending(f, conversation.id, 0);
    f.google.add("chain3", {
      at: "2026-11-05T09:06:00Z",
      reply: "<chains1@example.com>",
    });
    f.google.histories.set("18446744073709551631", {
      historyId: "18446744073709551632",
      history: [
        {
          id: "18446744073709551632",
          messagesAdded: [{ message: { id: "chain3" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T09:07:00Z");
    await synchronize(f);
    const answered = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      conversation.id,
    );
    expect(answered.messages.at(-1)?.opportunityId).toBe(secondNeed);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "buyer_replied" });
    expect(
      (
        await f.control.read(
          f.credentials,
          f.businessId,
          split.messages[0].opportunityId!,
        )
      ).actions,
    ).toContainEqual(
      expect.objectContaining({ id: independent.id, state: "pending" }),
    );
    f.google.add("chains2", {
      at: "2026-11-05T09:08:00Z",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      labels: ["Label_sales", "SENT"],
      reply: "<chains1@example.com>",
    });
    f.google.histories.set("18446744073709551632", {
      historyId: "18446744073709551633",
      history: [
        {
          id: "18446744073709551633",
          messagesAdded: [{ message: { id: "chains2" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T09:09:00Z");
    await synchronize(f);
    expect(
      await f.control.read(f.credentials, f.businessId, secondNeed),
    ).toMatchObject({ state: "human" });
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, conversation.id))
        .manualReplies,
    ).toHaveLength(2);
  });
  it("checkpoints and resumes a dense valid history page without producing an unreadable pending-ID cursor", async () => {
    const f = await setup();
    await connect(f);
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const history = Array.from({ length: 10 }, (_, group) => {
      const additions = Array.from(
          { length: 100 },
          (_, n) => `densea${group}_${n}`,
        ),
        labels = Array.from({ length: 100 }, (_, n) => `denseb${group}_${n}`);
      for (const id of [...additions, ...labels])
        f.google.add(id, { labels: ["INBOX"] });
      return {
        id: `184467440737095516${40 + group}`,
        messagesAdded: additions.map((id) => ({ message: { id } })),
        labelsAdded: labels.map((id) => ({ message: { id } })),
      };
    });
    f.google.histories.set("18446744073709551630", {
      historyId: "18446744073709551699",
      history,
    });
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    let result = await f.sync.execute(work);
    expect(result).toMatchObject({ status: "partial", excluded: 100 });
    f.google.control.apiError = 429;
    expect(await f.sync.execute(work)).toMatchObject({
      reason: "rate_limited",
      checkpoint: 1,
    });
    f.google.control.apiError = 0;
    for (let page = 0; result?.status === "partial" && page < 25; page++)
      result = await f.sync.execute(work);
    expect(result).toMatchObject({
      status: "completed",
      reason: null,
      excluded: 2000,
      captured: 0,
    });
    expect(f.google.bodyReads).toEqual([]);
  });
  it("fences a committed cross-channel reminder when incoming engagement wins the final dispatch lock", async () => {
    const f = await setup();
    await connect(f);
    f.google.add("raceorigin");
    f.google.pages.set("Label_sales", {
      messages: [{ id: "raceorigin", threadId: "abc123" }],
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const workspace = await f.inbox.workspace(f.credentials, f.businessId),
      native = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        workspace.conversations[0].id,
      ),
      needId = native.messages[0].opportunityId!;
    const conversationIds: Record<string, string> = {};
    for (const channel of ["email", "whatsapp"] as const) {
      const connection = await f.inbox.addConnection(
        f.credentials,
        f.businessId,
        { label: `Verified ${channel}`, channel, conversationRefs: [] },
      );
      await f.inbox.capture(f.credentials, f.businessId, connection.id, {
        eventId: channel,
        messageRef: `${channel}-original`,
        conversationRef: `${channel}-thread`,
        senderRef: channel === "email" ? "buyer@example.com" : "+12025550100",
        senderName: "Buyer",
        kind: "direct_inquiry",
        subject: "Same need",
        text: "Same purchasing need",
        occurredAt: h.clock.now().toISOString(),
      });
      const w = await f.inbox.workspace(f.credentials, f.businessId),
        detail = await f.inbox.conversation(
          f.credentials,
          f.businessId,
          w.conversations.find(
            (c) => c.subject === "Same need" && c.channel === channel,
          )!.id,
        );
      await f.inbox.associate(f.credentials, f.businessId, detail.id, {
        expectedVersion: detail.association.version,
        buyerId: native.buyer.id,
        messageIds: [],
        allMessages: true,
        target: { kind: "existing", opportunityId: needId },
        future: "target",
        reason: "Human verified both channels and this purchasing need",
      });
      conversationIds[channel] = detail.id;
    }
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(f.database),
      clock: h.clock,
    });
    const policy = await authority.workspace(f.credentials, f.businessId),
      actor = await h.authenticate(f.credentials);
    policy.policy.prices = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 0,
      escalationOwnerId: actor.userId,
    };
    await authority.save(f.credentials, f.businessId, {
      expectedVersion: policy.version,
      policy: policy.policy,
      note: "Bounded fixture price authority",
    });
    const baseline = await pending(f, conversationIds.whatsapp);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, baseline.id),
    ).toMatchObject({ state: "dispatched" });
    expect(f.effects).toHaveLength(1);
    const wa = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        conversationIds.whatsapp,
      ),
      email = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        conversationIds.email,
      );
    const action = await f.control.queue(f.credentials, f.businessId, needId, {
      messageId: wa.messages[0].id,
      dueAt: h.clock.now().toISOString(),
      evaluation: {
        action: "prices",
        amount: { currency: "USD", minor: "1000" },
        discountBps: 0,
      },
    });
    const gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(190029)");
    await h.admin.query(
      "CREATE FUNCTION test_gmail_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(190029); RETURN NEW; END $$; CREATE TRIGGER test_gmail_commit_barrier BEFORE UPDATE ON opportunity_due_action FOR EACH ROW WHEN (NEW.state='committed' AND OLD.state='pending') EXECUTE FUNCTION test_gmail_commit_barrier()",
    );
    const waitForBlocked = async (count: number) => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const result = await h.admin.query(
          "select count(*) from pg_locks where locktype='advisory' and not granted",
        );
        if (Number(result.rows[0].count) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Dispatch barrier was not reached");
    };
    const dispatch = f.control.dispatch(f.credentials, f.businessId, action.id);
    try {
      await waitForBlocked(1);
      h.clock.set("2026-11-05T09:03:00Z");
      const incoming = f.inbox.capture(
        f.credentials,
        f.businessId,
        email.connection.id,
        {
          eventId: "race-reply",
          messageRef: "race-reply",
          conversationRef: "email-thread",
          senderRef: "buyer@example.com",
          senderName: "Buyer",
          kind: "buying_interest_reply",
          replyToMessageRef: "email-original",
          subject: "Need confirmed",
          text: "I am replying before the reminder",
          occurredAt: h.clock.now().toISOString(),
        },
      );
      await waitForBlocked(2);
      await gate.query("COMMIT");
      await incoming;
      expect(await dispatch).toMatchObject({
        state: "cancelled",
        reason: "buyer_replied",
      });
      expect(f.effects).toHaveLength(1);
      f.transport.failAfterAccept = true;
      const uncertain = await f.control.queue(
        f.credentials,
        f.businessId,
        needId,
        {
          messageId: wa.messages[0].id,
          dueAt: h.clock.now().toISOString(),
          evaluation: {
            action: "prices",
            amount: { currency: "USD", minor: "1000" },
            discountBps: 0,
          },
        },
      );
      await expect(
        f.control.dispatch(f.credentials, f.businessId, uncertain.id),
      ).rejects.toThrow();
      expect(f.effects).toHaveLength(2);
      h.clock.set("2026-11-05T09:04:00Z");
      await f.inbox.capture(f.credentials, f.businessId, email.connection.id, {
        eventId: "after-uncertain",
        messageRef: "after-uncertain",
        conversationRef: "email-thread",
        senderRef: "buyer@example.com",
        senderName: "Buyer",
        kind: "buying_interest_reply",
        replyToMessageRef: "race-reply",
        subject: "Reply after uncertain dispatch",
        text: "Keep the uncertainty; do not resend",
        occurredAt: h.clock.now().toISOString(),
      });
      expect(
        await f.control.dispatch(f.credentials, f.businessId, uncertain.id),
      ).toMatchObject({
        state: "committed",
        reason: "buyer_replied_dispatch_unconfirmed",
      });
      expect(f.effects).toHaveLength(2);
      await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id);
      const blocked = await f.control.queue(
        f.credentials,
        f.businessId,
        needId,
        {
          messageId: wa.messages[0].id,
          dueAt: h.clock.now().toISOString(),
          evaluation: {
            action: "prices",
            amount: { currency: "USD", minor: "1000" },
            discountBps: 0,
          },
        },
      );
      expect(
        await f.control.dispatch(f.credentials, f.businessId, blocked.id),
      ).toMatchObject({
        state: "cancelled",
        reason: "reply_visibility_unavailable",
      });
      expect(f.effects).toHaveLength(2);
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await h.admin.query(
        "DROP TRIGGER test_gmail_commit_barrier ON opportunity_due_action; DROP FUNCTION test_gmail_commit_barrier()",
      );
    }
  });
});
