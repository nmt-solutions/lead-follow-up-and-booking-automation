import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eligibilityApplication } from "./support/email-eligibility";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createMicrosoftMailApplication } from "../src/application/microsoft-mail";
import { microsoftMailFixture } from "./support/microsoft-mail";
import {
  microsoftMailReadScope,
  microsoftMailSendScope,
} from "../src/models/microsoft-mail";
import { configuredMicrosoftMail } from "../src/microsoft-mail/configuration";
import { createMicrosoftMailHttpHandlers } from "../src/http/microsoft-mail";
import type { FailureDiagnostic } from "../src/http/respond";
import { createMicrosoftMailProvider } from "../src/microsoft-mail/provider";
import { createMicrosoftMailConnection } from "../src/microsoft-mail/connection";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createMailboxSendRecorder } from "../src/db/mailbox-send-recorder";

describe("Selected MicrosoftMail at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function setup() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(
      `microsoft-mail-${randomUUID()}@example.com`,
    );
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
        label: "MicrosoftMail sales",
        provider: "microsoft",
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
        scope: { kind: "folders", refs: ["sales"] },
        history: null,
        salesSubjectTerms: ["inquiry"],
      },
    });
    const graph = microsoftMailFixture(h.clock);
    const app = createMicrosoftMailApplication({
      access: h.access,
      connection: createMicrosoftMailConnection(database, {
        clock: h.clock,
        configuration: graph.configuration,
        fetch: graph.fetch,
      }),
    });
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      enqueue: async () => {},
      repository: createMailboxRepository(database, h.clock),
      provider: createMicrosoftMailProvider(
        createMicrosoftMailConnection(database, {
          clock: h.clock,
          configuration: graph.configuration,
          fetch: graph.fetch,
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
      graph,
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
    f.graph.identity.nonce =
      new URL(start.authorizationUrl).searchParams.get("nonce") ?? "";
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
      `openid email profile offline_access User.Read ${microsoftMailReadScope} MailboxSettings.Read`,
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    f.graph.identity.nonce = url.searchParams.get("nonce") ?? "";
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
      "select credentials from microsoft_mail_grant where business_id = $1",
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
  it("normalizes an explicit selected Outlook opt-out into suppression without qualification engagement or ownership changes", async () => {
    const f = await setup();
    await connect(f);
    const first = f.graph.add("m1"),
      stop = f.graph.add("m2", {
        reply: "<m1@example.com>",
        text: "Please stop emailing me.",
        at: "2026-11-05T09:01:30Z",
      });
    f.graph.pages.set("sales", {
      value: [first, stop],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=current",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const state = await eligibilityApplication(h).workspace(
      f.credentials,
      f.businessId,
    );
    expect(state.suppressions).toMatchObject([
      {
        recipient: "buyer@example.com",
        scope: "recipient_outreach",
        source: "incoming_opt_out",
      },
    ]);
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    expect(inbox.opportunities).toHaveLength(1);
    const conversation = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      inbox.conversations[0].id,
    );
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.opportunity.ownerId).toBeNull();
    expect(f.effects).toEqual([]);
  });

  it("filters new mail metadata before bodies and persists folder delta links without duplicate inbox effects", async () => {
    const f = await setup();
    await connect(f);
    const selected = f.graph.add("m1");
    const old = f.graph.add("old", { at: "2026-11-04T09:00:00Z" });
    const unrelated = f.graph.add("private", { subject: "Family photographs" });
    f.graph.pages.set("sales", {
      value: [selected, old, unrelated],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$skiptoken=page2",
    });
    f.graph.pages.set("page2", {
      value: [selected],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=current",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      captured: 1,
    });
    expect(f.graph.bodyReads).toEqual(["m1"]);
    const inbox = await f.inbox.workspace(f.credentials, f.businessId);
    expect(inbox.conversations).toHaveLength(1);
    f.graph.pages.set("current", {
      value: [selected],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=next",
    });
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      captured: 0,
      duplicates: 1,
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    expect(
      f.graph.calls
        .filter((c) => c.url.pathname.includes("/messages"))
        .every((c) =>
          c.headers.get("Prefer")?.includes('IdType="ImmutableId"'),
        ),
    ).toBe(true);
  });
  it("applies a reordered supported Outlook sent reply once through the Opportunity takeover control", async () => {
    const f = await setup();
    await connect(f);
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "folders", refs: ["sales", "sent"] },
      },
    });
    await connect(f);
    const inquiry = f.graph.add("received");
    const manual = f.graph.add("manual", {
      folder: "sent",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      reply: "<received@example.com>",
      at: "2026-11-05T09:02:00Z",
    });
    f.graph.pages.set("sales", {
      value: [inquiry],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=sales1",
    });
    f.graph.pages.set("sent", {
      value: [manual],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent1",
    });
    h.clock.set("2026-11-05T09:03:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      need = w.opportunities[0];
    expect(
      await f.control.read(f.credentials, f.businessId, need.id),
    ).toMatchObject({
      state: "human",
      history: [
        {
          after: {
            reason: "Manual Outlook reply observed in the selected mail",
          },
        },
      ],
    });
    const current = await f.control.read(f.credentials, f.businessId, need.id);
    await f.control.change(f.credentials, f.businessId, need.id, {
      command: "handback",
      expectedVersion: current.version,
      reason: "Reviewed",
      nextAction: "Continue",
    });
    f.graph.pages.set("sent1", {
      value: [manual],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent2",
    });
    await synchronize(f);
    expect(
      await f.control.read(f.credentials, f.businessId, need.id),
    ).toMatchObject({ state: "automation", version: 2 });
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          w.conversations[0].id,
        )
      ).manualReplies,
    ).toHaveLength(1);
    expect(f.effects).toEqual([]);
  });
  it("ends stale unanswered work at dispatch for the exact Opportunity while another need keeps its work", async () => {
    const f = await setup();
    await connect(f);
    const a = f.graph.add("need-a"),
      b = f.graph.add("need-b", { thread: "thread-2" });
    f.graph.pages.set("sales", {
      value: [a, b],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      first = w.conversations[0],
      second = w.conversations[1];
    const detail = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      first.id,
    );
    const action = await pending(f, first.id),
      other = await pending(f, second.id);
    const reply = f.graph.add("buyer-reply", {
      thread: detail.providerRef,
      reply: `<${detail.messages[0].messageRef}@example.com>`,
      at: "2026-11-05T09:03:00Z",
    });
    f.graph.pages.set("base", {
      value: [reply],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=replied",
    });
    h.clock.set("2026-11-05T09:04:00Z");
    await synchronize(f);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "buyer_replied" });
    const otherDetail = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      second.id,
    );
    expect(
      (
        await f.control.read(
          f.credentials,
          f.businessId,
          otherDetail.messages[0].opportunityId!,
        )
      ).actions,
    ).toContainEqual(
      expect.objectContaining({ id: other.id, state: "pending" }),
    );
    expect(
      (
        await f.inbox.conversation(f.credentials, f.businessId, first.id)
      ).messages.map((m) => m.opportunityId),
    ).toEqual([
      detail.messages[0].opportunityId,
      detail.messages[0].opportunityId,
    ]);
    expect(f.effects).toEqual([]);
  });
  it("excludes a recorded app send before bodies and follows its receipt to the current received-message Opportunity", async () => {
    const f = await setup();
    await connect(f);
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "folders", refs: ["sales", "sent"] },
      },
    });
    await connect(f);
    const inquiry = f.graph.add("source");
    f.graph.pages.set("sales", {
      value: [inquiry],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      detail = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        w.conversations[0].id,
      );
    const actor = await h.access.authenticateForWork(f.credentials);
    await createMailboxSendRecorder(f.database, h.clock).record(
      actor,
      f.businessId,
      {
        mailboxId: f.mailbox.id,
        messageRef: "app-send",
        internetMessageId: "<app-send@example.com>",
        replyToMessageId: detail.messages[0].id,
      },
    );
    const appSend = f.graph.add("app-send", {
      folder: "sent",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      reply: "<source@example.com>",
    });
    f.graph.pages.set("sent-steady", {
      value: [appSend],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent2",
    });
    const reply = f.graph.add("after-app", {
      reply: "<app-send@example.com>",
      at: "2026-11-05T09:03:00Z",
    });
    f.graph.pages.set("base", {
      value: [reply],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=next",
    });
    h.clock.set("2026-11-05T09:04:00Z");
    await synchronize(f);
    expect(f.graph.bodyReads).not.toContain("app-send");
    expect(
      (
        await f.control.read(
          f.credentials,
          f.businessId,
          detail.messages[0].opportunityId!,
        )
      ).history,
    ).toEqual([]);
    expect(
      (
        await f.inbox.conversation(f.credentials, f.businessId, detail.id)
      ).messages.map((m) => m.opportunityId),
    ).toEqual([
      detail.messages[0].opportunityId,
      detail.messages[0].opportunityId,
    ]);
  });
  it("retains a partial checkpoint through Graph throttling and does not call Graph again before the controlled retry time", async () => {
    const f = await setup();
    await connect(f);
    const inquiry = f.graph.add("throttled");
    f.graph.pages.set("sales", {
      value: [inquiry],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    f.graph.control.apiError = 429;
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    expect(await f.sync.execute(work)).toMatchObject({
      status: "partial",
      reason: "rate_limited",
      checkpoint: 0,
      retryAt: "2026-11-05T09:03:00.000Z",
    });
    const calls = f.graph.calls.length;
    expect(await f.sync.execute(work)).toMatchObject({
      reason: "rate_limited",
      checkpoint: 0,
    });
    expect(f.graph.calls).toHaveLength(calls);
    f.graph.control.apiError = 0;
    h.clock.set("2026-11-05T09:04:00Z");
    expect(await f.sync.execute(work)).toMatchObject({
      status: "completed",
      checkpoint: 1,
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("keeps opt-in history bounded across pages, retry and repeated requests with history off by default", async () => {
    const f = await setup();
    await connect(f);
    expect(f.mailbox.configuration.history).toBeNull();
    const first = f.graph.add("h1", { at: "2026-11-03T09:00:00Z" }),
      second = f.graph.add("h2", { at: "2026-11-03T10:00:00Z" }),
      third = f.graph.add("h3", { at: "2026-11-03T11:00:00Z" });
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        history: {
          from: "2026-11-03T00:00:00Z",
          to: "2026-11-04T00:00:00Z",
          maxMessages: 2,
        },
      },
    });
    f.graph.pages.set("sales", {
      value: [first],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages?$skiptoken=hpage2",
    });
    f.graph.pages.set("hpage2", {
      value: [second],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages?$skiptoken=hpage3",
    });
    f.graph.pages.set("hpage3", { value: [third] });
    expect(await synchronize(f, "history")).toMatchObject({
      status: "partial",
      reason: "limit_reached",
      captured: 2,
      considered: 2,
    });
    expect(await synchronize(f, "history")).toBeNull();
    expect(f.graph.bodyReads).toEqual(["h1", "h2"]);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    expect(
      f.graph.calls
        .filter(
          (c) =>
            c.url.pathname.endsWith("/messages") &&
            c.url.searchParams.has("$filter"),
        )
        .some(
          (c) =>
            c.url.searchParams.get("$filter") ===
            "receivedDateTime ge 2026-11-03T00:00:00Z and receivedDateTime lt 2026-11-04T00:00:00Z",
        ),
    ).toBe(true);
  });
  it("recovers expired folder deltas within the approved selection and preserves the visible gap and retained history", async () => {
    const f = await setup();
    await connect(f);
    const message = f.graph.add("retained");
    f.graph.pages.set("sales", {
      value: [message],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=expired",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    f.graph.pages.set("expired", "expired");
    f.graph.pages.set("sales", {
      value: [
        message,
        f.graph.add("not-opted-in", { at: "2026-11-02T09:00:00Z" }),
      ],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=recovered",
    });
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      reason: "history_gap",
    });
    const w = await f.sync.workspace(f.credentials, f.businessId);
    expect(w.mailboxes[0]).toMatchObject({ visibility: "limited" });
    expect(f.graph.bodyReads).not.toContain("not-opted-in");
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.sync.execute(work);
    expect(await f.sync.repeat(work)).not.toBeNull();
  });
  it.each([
    "https://evil.example/v1.0/me/mailFolders/sales/messages/delta?$skiptoken=secret",
    "https://graph.microsoft.com/v1.0/users/victim/mailFolders/sales/messages/delta?$skiptoken=secret",
    "https://graph.microsoft.com/v1.0/me/mailFolders/other/messages/delta?$skiptoken=secret",
    "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$expand=attachments",
    "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$select=body",
  ])(
    "rejects a continuation outside its saved resource/query before forwarding credentials: %s",
    async (next) => {
      const f = await setup();
      await connect(f);
      f.graph.pages.set("sales", {
        value: [f.graph.add("bad-link")],
        "@odata.nextLink": next,
      });
      h.clock.set("2026-11-05T09:02:00Z");
      expect(await synchronize(f)).toMatchObject({
        status: "blocked",
        reason: "invalid_provider_response",
        checkpoint: 0,
      });
      expect(f.graph.bodyReads).toEqual([]);
      expect(f.graph.calls.some((c) => c.url.toString() === next)).toBe(false);
      expect(
        (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
      ).toEqual([]);
    },
  );
  it.each(["personal", "work"])(
    "validates a supported %s primary global cloud mailbox and provides its real folder catalogue",
    async (kind) => {
      const f = await setup();
      if (kind === "work")
        f.graph.identity.tenant = "11111111-1111-4111-8111-111111111111";
      await connect(f);
      expect(
        await f.app.read(f.credentials, f.businessId, f.mailbox.id),
      ).toMatchObject({
        status: "connected",
        accountKind:
          kind === "personal" ? "microsoft_personal" : "microsoft_work",
      });
      expect(
        await f.app.folders(f.credentials, f.businessId, f.mailbox.id),
      ).toContainEqual({ id: "sales", label: "sales" });
      expect(f.graph.bodyReads).toEqual([]);
    },
  );
  it.each(["shared", "linked", "room", "equipment", "unknownFutureValue"])(
    "keeps an unsupported %s mailbox visibly unavailable without reading mail",
    async (purpose) => {
      const f = await setup();
      f.graph.control.purpose = purpose;
      await connect(f);
      expect(
        await f.app.read(f.credentials, f.businessId, f.mailbox.id),
      ).toMatchObject({
        status: "reconnect_required",
        reason: "unsupported_account",
        read: false,
      });
      expect(f.graph.bodyReads).toEqual([]);
    },
  );
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
    expect(f.graph.calls).toEqual([]);
  });
  it.each([
    "badSignature",
    "badIssuer",
    "wrongNonce",
    "expiredIdentity",
  ] as const)(
    "rejects signed identity failure %s without importing any mail",
    async (failure) => {
      const f = await setup();
      f.graph.identity[failure] = true;
      await connect(f);
      expect(
        await f.app.read(f.credentials, f.businessId, f.mailbox.id),
      ).toMatchObject({
        status: "reconnect_required",
        reason: "unsupported_account",
        read: false,
      });
      expect(f.graph.bodyReads).toEqual([]);
    },
  );
  it("consumes denial, rejects account substitution and a guest account, and never treats calendar or send grants as reading", async () => {
    const f = await setup();
    const start = await f.app.start(f.credentials, f.businessId, f.mailbox.id);
    const denied = {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      error: "access_denied",
    };
    await f.app.callback(f.credentials, f.businessId, f.mailbox.id, denied);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ reason: "consent_denied", read: false });
    await expect(
      f.app.callback(f.credentials, f.businessId, f.mailbox.id, denied),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    f.graph.identity.email = "other@example.com";
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ reason: "account_mismatch", read: false });
    f.graph.identity.email = "sales@supplier.example";
    f.graph.identity.tenant = "11111111-1111-4111-8111-111111111111";
    f.graph.control.userType = "Guest";
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ reason: "unsupported_account", read: false });
    f.graph.control.userType = "Member";
    f.graph.identity.scopes =
      "openid email profile offline_access User.Read MailboxSettings.Read Mail.Send Calendars.ReadWrite";
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "insufficient", read: false, send: false });
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: { ...f.mailbox.configuration, requestedSend: true },
    });
    const requested = await f.app.start(
      f.credentials,
      f.businessId,
      f.mailbox.id,
    );
    expect(
      new URL(requested.authorizationUrl).searchParams.get("scope"),
    ).toContain(microsoftMailSendScope);
    f.graph.identity.scopes =
      "openid email profile offline_access User.Read MailboxSettings.Read Mail.Read";
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({
      status: "connected",
      read: true,
      send: false,
      reason: "insufficient",
    });
    expect(
      f.graph.calls.some((c) =>
        /sendMail|revokeSignInSessions|oauth2PermissionGrants/.test(
          c.url.toString(),
        ),
      ),
    ).toBe(false);
  });
  it("refreshes encrypted tokens and prevents a concurrent local disconnect from being overwritten", async () => {
    const f = await setup();
    await connect(f);
    h.clock.set("2026-11-05T10:01:00Z");
    await synchronize(f);
    expect(f.graph.identity.refreshes).toBe(1);
    const before = await h.admin.query(
      "select credentials from microsoft_mail_grant where id=$1",
      [f.mailbox.id],
    );
    expect(before.rows[0].credentials).not.toMatch(
      /fixture-access|fixture-refresh/,
    );
    h.clock.set("2026-11-05T11:02:00Z");
    f.graph.identity.beforeRefresh = async () => {
      await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id);
    };
    await expect(synchronize(f)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({
      status: "disconnected",
      read: false,
      reason: "provider_consent_retained",
    });
    const after = await h.admin.query(
      "select credentials from microsoft_mail_grant where id=$1",
      [f.mailbox.id],
    );
    expect(after.rows[0].credentials).toBeNull();
    f.graph.identity.beforeRefresh = undefined;
    await connect(f);
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "connected", read: true });
  });
  it("fences scope and actor changes during body I/O before ingestion and prevents forged cross-Business worker reads", async () => {
    const f = await setup();
    await connect(f);
    f.graph.pages.set("sales", {
      value: [f.graph.add("stale")],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
        mode: "incremental",
      }),
      other = await setup();
    await expect(
      f.sync.execute({ ...work, businessId: other.businessId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.graph.control.beforeBody = async () => {
      f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
        id: f.mailbox.id,
        expectedVersion: f.mailbox.version,
        configuration: { ...f.mailbox.configuration, requestedRead: false },
      });
    };
    h.clock.set("2026-11-05T09:02:00Z");
    await expect(f.sync.execute(work)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toEqual([]);
    const g = await setup();
    await connect(g);
    h.clock.set("2026-11-05T09:02:00Z");
    g.graph.pages.set("sales", {
      value: [g.graph.add("removed-actor")],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    const actor = await h.authenticate(g.credentials);
    g.graph.control.beforeBody = async () => {
      await h.admin.query(
        "delete from membership where business_id=$1 and user_id=$2",
        [g.businessId, actor.userId],
      );
    };
    await expect(synchronize(g)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.admin.query(
      "insert into membership(business_id,user_id,role) values($1,$2,'owner')",
      [g.businessId, actor.userId],
    );
    expect(
      (await g.inbox.workspace(g.credentials, g.businessId)).conversations,
    ).toEqual([]);
  });
  it("validates HTTP/CSRF and provider data with safe diagnostics and refuses unapproved cloud activation", async () => {
    const f = await setup(),
      diagnostics: FailureDiagnostic[] = [];
    const http = createMicrosoftMailHttpHandlers({
      application: f.app,
      origin: f.graph.configuration.origin,
      reportFailure: (d) => diagnostics.push(d),
    });
    const headers = new Headers(f.credentials);
    headers.set("Content-Type", "application/json");
    headers.set("Origin", "https://evil.example");
    expect(
      (
        await http.start(
          new Request("http://localhost:3000/start", {
            method: "POST",
            headers,
            body: "{}",
          }),
          f.businessId,
          f.mailbox.id,
        )
      ).status,
    ).toBe(403);
    headers.set("Origin", f.graph.configuration.origin);
    expect(
      (
        await http.start(
          new Request("http://localhost:3000/start", {
            method: "POST",
            headers,
            body: '{"credentials":"private"}',
          }),
          f.businessId,
          f.mailbox.id,
        )
      ).status,
    ).toBe(400);
    await connect(f);
    const bad = f.graph.add("malformed");
    bad.internetMessageHeaders = [
      { name: "In-Reply-To", value: "\0private-token-payload" },
    ];
    f.graph.pages.set("sales", {
      value: [bad],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "blocked",
      reason: "invalid_provider_response",
      checkpoint: 0,
    });
    expect(f.graph.bodyReads).toEqual([]);
    expect(
      JSON.stringify(await f.sync.workspace(f.credentials, f.businessId)),
    ).not.toMatch(/private-token-payload|fixture-refresh|deltatoken/);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /private-token-payload|fixture-refresh/,
    );
    expect(configuredMicrosoftMail({})).toBeNull();
    const env = {
      BETTER_AUTH_URL: f.graph.configuration.origin,
      MICROSOFT_MAIL_CLIENT_ID: f.graph.configuration.clientId,
      MICROSOFT_MAIL_CLIENT_SECRET: f.graph.configuration.clientSecret,
      MICROSOFT_MAIL_TOKEN_KEY_ID: "fixture",
      MICROSOFT_MAIL_TOKEN_KEYS: JSON.stringify(f.graph.configuration.keys),
      MICROSOFT_MAIL_OAUTH_APPROVED: "true",
      MICROSOFT_MAIL_PRODUCTION_PREREQUISITES_CONFIRMED: "true",
    };
    expect(configuredMicrosoftMail(env)).not.toBeNull();
    expect(
      configuredMicrosoftMail({
        ...env,
        MICROSOFT_MAIL_OAUTH_APPROVED: "false",
      }),
    ).toBeNull();
    expect(
      configuredMicrosoftMail({ ...env, MICROSOFT_MAIL_CLOUD: "government" }),
    ).toBeNull();
  });
  it("pauses the exact shared email/WhatsApp need for an Outlook reply while an independent need keeps running", async () => {
    const f = await setup();
    await connect(f);
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "folders", refs: ["sales", "sent"] },
      },
    });
    await connect(f);
    f.graph.pages.set("sales", {
      value: [
        f.graph.add("shared"),
        f.graph.add("separate", { thread: "thread-2" }),
      ],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const initial = await f.inbox.workspace(f.credentials, f.businessId),
      details = await Promise.all(
        initial.conversations.map((c) =>
          f.inbox.conversation(f.credentials, f.businessId, c.id),
        ),
      );
    const email = details.find((c) => c.providerRef === "thread-1")!,
      other = details.find((c) => c.providerRef === "thread-2")!;
    const whatsapp = await f.inbox.addConnection(f.credentials, f.businessId, {
      label: "Verified WhatsApp",
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
      text: "Please quote",
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
      reason: "Human verified this buyer and need",
    });
    const action = await pending(f, wa.id),
      independent = await pending(f, other.id);
    const manual = f.graph.add("outlook-human", {
      folder: "sent",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      reply: "<shared@example.com>",
      at: "2026-11-05T09:03:00Z",
    });
    f.graph.pages.set("sent-steady", {
      value: [manual],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent2",
    });
    h.clock.set("2026-11-05T09:04:00Z");
    await synchronize(f);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "cancelled", reason: "control_changed" });
    expect(
      await f.control.read(
        f.credentials,
        f.businessId,
        email.messages[0].opportunityId!,
      ),
    ).toMatchObject({ state: "human" });
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
  it.each([401, 403, 429])(
    "pauses affected work and retains history after visibility failure %s",
    async (status) => {
      const f = await setup();
      await connect(f);
      f.graph.pages.set("sales", {
        value: [f.graph.add("visible")],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
      });
      h.clock.set("2026-11-05T09:02:00Z");
      await synchronize(f);
      const w = await f.inbox.workspace(f.credentials, f.businessId),
        action = await pending(f, w.conversations[0].id);
      f.graph.control.apiError = status;
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
  it("reads only new individually selected conversation messages and never broadens into old or other thread bodies", async () => {
    const f = await setup();
    const chosen = f.graph.add("selected-thread"),
      old = f.graph.add("past-thread", { at: "2026-11-04T09:00:00Z" }),
      outside = f.graph.add("other-thread", { thread: "thread-2" });
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "threads", refs: ["thread-1"] },
        salesSubjectTerms: [],
      },
    });
    await connect(f);
    f.graph.pages.set("sales", {
      value: [chosen, old, outside],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    expect(f.graph.bodyReads).toEqual(["selected-thread"]);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("retains immutable message identity after a folder move and fences future dispatch under its latest observed folder", async () => {
    const f = await setup();
    await connect(f);
    const message = f.graph.add("moved");
    f.graph.pages.set("sales", {
      value: [message],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      action = await pending(f, w.conversations[0].id);
    message.parentFolderId = "other";
    f.graph.pages.set("base", {
      value: [{ id: "moved", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=next",
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
          w.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(1);
    expect(f.graph.bodyReads).toEqual(["moved"]);
    f.graph.messages.delete("moved");
    f.graph.pages.set("next", {
      value: [{ id: "moved", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=deleted",
    });
    expect(await synchronize(f)).toMatchObject({ reason: "history_gap" });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("blocks a malformed body without retaining any page content, while allowing ordinary repeated transport headers", async () => {
    const f = await setup();
    await connect(f);
    const valid = f.graph.add("valid"),
      malformed = f.graph.add("html-only");
    valid.internetMessageHeaders = [
      { name: "Received", value: "hop one" },
      { name: "Received", value: "hop two" },
    ];
    malformed.body = {
      contentType: "html",
      content: "<script>private-token-payload</script>",
    };
    f.graph.pages.set("sales", {
      value: [valid, malformed],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "blocked",
      reason: "invalid_provider_response",
      checkpoint: 0,
      captured: 0,
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toEqual([]);
    malformed.body = { contentType: "text", content: "Need steel" };
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      captured: 2,
    });
  });
  it.each([
    [404, "MailboxNotEnabledForRESTAPI", "license_required"],
    [403, "consent_required", "approval_required"],
  ])(
    "shows account/licence/approval failure %s without treating it as an empty healthy mailbox",
    async (status, errorCode, reason) => {
      const f = await setup();
      f.graph.control.apiError = Number(status);
      f.graph.control.errorCode = String(errorCode);
      await connect(f);
      expect(
        await f.app.read(f.credentials, f.businessId, f.mailbox.id),
      ).toMatchObject({ reason, read: false });
      expect(f.graph.bodyReads).toEqual([]);
    },
  );
  it("retains encrypted grants, inbox history and forced scoped security across a populated additive schema reapply", async () => {
    const f = await setup();
    await connect(f);
    f.graph.pages.set("sales", {
      value: [f.graph.add("persisted")],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    await h.reapplySchema();
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({ status: "connected", read: true });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    const isolation = await h.runtime.query(
      "select count(*) as total from microsoft_mail_grant",
    );
    expect(Number(isolation.rows[0].total)).toBe(0);
    await expect(
      h.runtime.query("update microsoft_mail_grant set business_id=$1", [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    const security = await h.admin.query(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('microsoft_mail_grant','microsoft_mail_oauth','mailbox_app_message')",
    );
    expect(security.rows).toHaveLength(3);
    expect(
      security.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    ).toBe(true);
  });
  it("rejects a refresh that changes the stable mailbox owner even when its display address is unchanged", async () => {
    const f = await setup();
    await connect(f);
    h.clock.set("2026-11-05T10:01:00Z");
    f.graph.control.ownerId = "other-owner";
    expect(await synchronize(f)).toMatchObject({
      reason: "permission_required",
    });
    expect(
      await f.app.read(f.credentials, f.businessId, f.mailbox.id),
    ).toMatchObject({
      status: "insufficient",
      reason: "account_mismatch",
      read: false,
    });
    expect(f.graph.bodyReads).toEqual([]);
  });
  it("keeps every unfinished initial delta page unsafe until a completed baseline is persisted", async () => {
    const f = await setup();
    await connect(f);
    f.graph.pages.set("sales", {
      value: [],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$skiptoken=second",
    });
    f.graph.pages.set("second", {
      value: [],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$skiptoken=third",
    });
    f.graph.pages.set("third", {
      value: [],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=ready",
    });
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.sync.execute(work);
    await f.sync.execute(work);
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .visibility,
    ).toBe("recovering");
    await f.sync.execute(work);
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .visibility,
    ).toBe("current");
  });
  it("defers an incoming reference until its later Sent Items page resolves the exact non-default purchasing need", async () => {
    const f = await setup();
    f.mailbox = await f.mailboxes.save(f.credentials, f.businessId, {
      id: f.mailbox.id,
      expectedVersion: f.mailbox.version,
      configuration: {
        ...f.mailbox.configuration,
        scope: { kind: "folders", refs: ["sales", "sent"] },
      },
    });
    await connect(f);
    f.graph.pages.set("sales", {
      value: [f.graph.add("first-need"), f.graph.add("second-need")],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    await synchronize(f);
    const w = await f.inbox.workspace(f.credentials, f.businessId),
      detail = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        w.conversations[0].id,
      );
    const source = detail.messages.find((m) => m.messageRef === "second-need")!;
    await f.inbox.associate(f.credentials, f.businessId, detail.id, {
      expectedVersion: detail.association.version,
      buyerId: detail.buyer.id,
      messageIds: [source.id],
      allMessages: false,
      target: { kind: "new", title: "Independent second need" },
      future: "keep",
      reason: "Human verified a separate need",
    });
    const split = await f.inbox.conversation(
        f.credentials,
        f.businessId,
        detail.id,
      ),
      secondNeed = split.messages.find(
        (m) => m.id === source.id,
      )!.opportunityId!;
    const incoming = f.graph.add("reordered-incoming", {
      reply: "<late-sent@example.com>",
      at: "2026-11-05T09:05:00Z",
    });
    const sent = f.graph.add("late-sent", {
      folder: "sent",
      from: "sales@supplier.example",
      to: "buyer@example.com",
      reply: "<second-need@example.com>",
      at: "2026-11-05T09:04:00Z",
    });
    f.graph.pages.set("base", {
      value: [incoming],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=next",
    });
    f.graph.pages.set("sent-steady", {
      value: [sent],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent2",
    });
    h.clock.set("2026-11-05T09:06:00Z");
    const work = await f.sync.queue(f.credentials, f.businessId, f.mailbox.id, {
      mode: "incremental",
    });
    await f.sync.execute(work);
    expect(
      (
        await f.inbox.conversation(f.credentials, f.businessId, detail.id)
      ).messages.find((m) => m.messageRef === "reordered-incoming"),
    ).toBeUndefined();
    await f.sync.execute(work);
    expect(
      (
        await f.inbox.conversation(f.credentials, f.businessId, detail.id)
      ).messages.find((m) => m.messageRef === "reordered-incoming")
        ?.opportunityId,
    ).toBe(secondNeed);
    expect(
      (await f.control.read(f.credentials, f.businessId, secondNeed)).history,
    ).toContainEqual(expect.objectContaining({ command: "manual_reply" }));
    expect(
      (
        await f.control.read(
          f.credentials,
          f.businessId,
          detail.association.defaultOpportunityId!,
        )
      ).history,
    ).toEqual([]);
  });
  it("retains unmatched incoming content for scoped review without inventing a buyer or Opportunity, including after disconnect", async () => {
    const f = await setup();
    await connect(f);
    f.graph.pages.set("sales", {
      value: [
        f.graph.add("unmatched", {
          reply: "<not-approved@example.com>",
          text: "My selected reply is retained",
        }),
      ],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=base",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect(await synchronize(f)).toMatchObject({
      status: "completed",
      reason: "reply_association_review",
    });
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).opportunities,
    ).toEqual([]);
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0],
    ).toMatchObject({
      pendingIncomingReplies: 1,
      incomingReplyReview: [
        {
          text: "My selected reply is retained",
          inReplyTo: "<not-approved@example.com>",
        },
      ],
    });
    await f.app.disconnect(f.credentials, f.businessId, f.mailbox.id);
    expect(
      (await f.sync.workspace(f.credentials, f.businessId)).mailboxes[0]
        .incomingReplyReview[0].text,
    ).toBe("My selected reply is retained");
    const other = await setup();
    await expect(
      f.sync.workspace(other.credentials, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
