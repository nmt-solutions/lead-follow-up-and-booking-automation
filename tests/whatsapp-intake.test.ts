import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createWhatsAppApplication } from "../src/application/whatsapp";
import { createWhatsAppRepository } from "../src/db/whatsapp-repository";
import { calendarCredentialVault } from "../src/appointments/credentials";
import { metaFixture } from "./support/whatsapp";
import { createWhatsAppIntakeApplication } from "../src/application/whatsapp-intake";
import { createWhatsAppIntakeRepository } from "../src/db/whatsapp-intake-repository";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createKnowledgeApplication } from "../src/application/knowledge";
import { createKnowledgeRepository } from "../src/db/knowledge-repository";
import { bookingInquiry } from "./support/booking-inquiry";
import { createWhatsAppIntakeHttp } from "../src/http/whatsapp-intake";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import type { OpportunityDispatch } from "../src/models/opportunity-control";

describe("Signed Meta intake through real restricted persistence", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  const secret = "deterministic-meta-app-secret";
  const vault = calendarCredentialVault({
    activeKeyId: "test",
    keys: { test: "ab".repeat(32) },
  });
  let number = 810000;
  async function fixture(
    name: string,
    activationTime = "2026-11-05T09:00:00Z",
    allowDispatch = false,
    retention = 86400,
  ) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`meta-intake-${name}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const database = runtimeDatabase(h.runtime);
    const meta = metaFixture(h.clock);
    meta.checks.customer_payment_method = "unknown";
    const onboarding = createWhatsAppApplication({
      authenticate: h.access.authenticateForWork,
      repository: createWhatsAppRepository(database, h.clock),
      provider: meta.provider,
      clock: h.clock,
      vault,
    });
    await onboarding.save(credentials, business.id, {
      expectedVersion: 0,
      configuration: {
        portfolioId: "100001",
        numberSource: "business_app",
        requestedNumber: "+14155550123",
        provisioningTerms:
          "Customer controls the number and Meta account and retains carrier and transfer rights.",
        customerControlsAssets: true,
        customerPaysMeta: true,
        termsVersion: "direct_meta_v1",
      },
    });
    const start = await onboarding.start(credentials, business.id, {
      expectedVersion: 1,
    });
    const assets = {
      portfolioId: "100001",
      wabaId: "200001",
      phoneNumberId: String(++number),
    };
    await onboarding.complete(credentials, business.id, {
      state: start.state,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      code: "fixture-code",
      assets,
    });
    const options = {
      authenticate: h.access.authenticateForWork,
      repository: createWhatsAppIntakeRepository(database, h.clock),
      provider: meta.provider,
      clock: h.clock,
      vault,
      configuration: {
        appSecret: secret,
        verifyToken: "fixture-verification",
        workerConfigured: true,
      },
    };
    const app = createWhatsAppIntakeApplication(options);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    h.clock.set(activationTime);
    await app.enable(credentials, business.id, {
      expectedVersion: 2,
      receiptRetentionSeconds: retention,
    });
    const outbound: OpportunityDispatch[] = [];
    const control = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(database, h.clock),
      clock: h.clock,
      provider: {
        channels: ["email", "whatsapp"],
        async dispatch(action) {
          if (!allowDispatch)
            throw new Error("No outbound authorized by intake");
          outbound.push(action);
        },
      },
    });
    return {
      credentials,
      businessId: business.id,
      assets,
      app,
      inbox,
      control,
      onboarding,
      meta,
      outbound,
      restart: () => createWhatsAppIntakeApplication(options),
    };
  }
  function payload(
    phone: string,
    id = "wamid.incoming-1",
    text = "Quantity: 500",
    parent?: string,
  ) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "200001",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  phone_number_id: phone,
                  display_phone_number: "14155550123",
                },
                contacts: [
                  { wa_id: "919876543210", profile: { name: "Buyer" } },
                ],
                messages: [
                  {
                    id,
                    from: "919876543210",
                    timestamp: "1793869200",
                    type: "text",
                    text: { body: text },
                    ...(parent ? { context: { id: parent } } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }
  it("preserves account-scoped deduplication and buyer/message identity across reauthorization, including whole-second events", async () => {
    const f = await fixture("reconnect", "2026-11-05T09:00:00.500Z");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    const before = await f.inbox.workspace(f.credentials, f.businessId);
    expect(before.conversations).toHaveLength(1);
    await deliver(
      f.app,
      payload(f.assets.phoneNumberId, "wamid.expired-old-generation"),
    );
    h.clock.set("2026-11-07T09:00:00Z");
    await f.restart().drain();
    h.clock.set("2026-11-05T09:00:00.500Z");
    const start = await f.onboarding.start(f.credentials, f.businessId, {
      expectedVersion: 2,
    });
    await f.onboarding.complete(f.credentials, f.businessId, {
      state: start.state,
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      code: "reauthorize-code",
      assets: f.assets,
    });
    await f.app.enable(f.credentials, f.businessId, {
      expectedVersion: start.version,
      receiptRetentionSeconds: 86400,
    });
    expect((await f.app.workspace(f.credentials, f.businessId)).gap).toBeNull();
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.restart().drain();
    const after = await f.inbox.workspace(f.credentials, f.businessId);
    expect(
      after.conversations.map((c) => ({ id: c.id, buyerId: c.buyerId })),
    ).toEqual(
      before.conversations.map((c) => ({ id: c.id, buyerId: c.buyerId })),
    );
    expect(
      (
        await f.inbox.conversation(
          f.credentials,
          f.businessId,
          after.conversations[0].id,
        )
      ).messages,
    ).toHaveLength(1);
  });
  async function deliver(
    app: ReturnType<typeof createWhatsAppIntakeApplication<Headers>>,
    body: unknown,
  ) {
    const raw = Buffer.from(JSON.stringify(body));
    return app.accept(
      raw,
      `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    );
  }
  it("durably accepts, deduplicates and recovers without requiring outbound payment proof or geographic reach", async () => {
    const f = await fixture("durable");
    const body = payload(f.assets.phoneNumberId);
    const http = createWhatsAppIntakeHttp({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const raw = Buffer.from(
      JSON.stringify({
        ...body,
        businessId: "a94a301d-12bc-44e0-9b20-188f1b29c799",
      }),
    );
    const accepted = await http.receive(
      new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        body: raw,
        headers: {
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
        },
      }),
    );
    expect(accepted.status).toBe(200);
    const verification = await http.verify(
      new Request(
        "http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=fixture-verification&hub.challenge=12345",
      ),
    );
    expect(await verification.text()).toBe("12345");
    await deliver(f.app, body);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(0);
    await f.restart().drain();
    const workspace = await f.inbox.workspace(f.credentials, f.businessId);
    expect(workspace.conversations).toHaveLength(1);
    const conversation = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      workspace.conversations[0].id,
    );
    expect(conversation.messages).toMatchObject([
      {
        messageRef: "wamid.incoming-1",
        senderRef: "919876543210",
        text: "Quantity: 500",
      },
    ]);
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).inboundObserved,
    ).toBe(true);
    expect(
      (await f.onboarding.workspace(f.credentials, f.businessId)).readiness
        .onboardingReady,
    ).toBe(false);
    await f.restart().drain();
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, conversation.id))
        .messages,
    ).toHaveLength(1);
  });
  it("rejects forged bytes and wrong selected accounts, and isolates Business reads and queued work", async () => {
    const f = await fixture("scope");
    const other = await fixture("other");
    const raw = Buffer.from(JSON.stringify(payload(f.assets.phoneNumberId)));
    const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    await expect(
      f.app.accept(Buffer.concat([raw, Buffer.from(" ")]), signature),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      f.app.accept(raw, "sha256=" + "00".repeat(32)),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const wrong = payload(f.assets.phoneNumberId);
    wrong.entry[0].id = "999999";
    await expect(deliver(f.app, wrong)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      f.app.workspace(other.credentials, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    expect(
      (await other.inbox.workspace(other.credentials, other.businessId))
        .conversations,
    ).toHaveLength(0);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
    await deliver(
      f.app,
      payload(
        f.assets.phoneNumberId,
        "wamid.incoming-1",
        "Conflicting content under the same provider identity",
      ),
    );
    expect((await f.app.workspace(f.credentials, f.businessId)).gap).toBe(
      "conflicting_provider_identity",
    );
  });
  it("retains repeated replies with their need and leaves an unrelated unquoted request for explicit association", async () => {
    const f = await fixture("needs");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    await deliver(
      f.app,
      payload(
        f.assets.phoneNumberId,
        "wamid.reply",
        "Quantity: 600",
        "wamid.incoming-1",
      ),
    );
    await deliver(
      f.app,
      payload(
        f.assets.phoneNumberId,
        "wamid.distinct",
        "A separate order for another factory",
      ),
    );
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    expect(
      c.messages.find((m) => m.messageRef === "wamid.reply")?.opportunityId,
    ).toBe(
      c.messages.find((m) => m.messageRef === "wamid.incoming-1")
        ?.opportunityId,
    );
    expect(
      c.messages.find((m) => m.messageRef === "wamid.distinct")?.opportunityId,
    ).toBeNull();
    expect(c.association.reviewReason).toBeTruthy();
  });
  function echo(phone: string, id = "wamid.manual", parent?: string) {
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "200001",
          changes: [
            {
              field: "smb_message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: phone },
                message_echoes: [
                  {
                    id,
                    from: "14155550123",
                    to: "919876543210",
                    timestamp: "1793869260",
                    type: "text",
                    text: { body: "A salesperson is helping you" },
                    ...(parent ? { context: { id: parent } } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  }
  async function handback(f: Awaited<ReturnType<typeof fixture>>, id: string) {
    const before = await f.control.read(f.credentials, f.businessId, id);
    if (!before.ownerId)
      await f.control.change(f.credentials, f.businessId, id, {
        command: "takeover",
        expectedVersion: before.version,
        reason: "Review",
        nextAction: "Review need",
      });
    const owned = await f.control.read(f.credentials, f.businessId, id);
    await f.control.change(f.credentials, f.businessId, id, {
      command: "handback",
      expectedVersion: owned.version,
      reason: "Review complete",
      nextAction: "Continue under current rules",
    });
  }
  it("takes over the matching Opportunity across channels and preserves handback against reordered duplicate manual events", async () => {
    const f = await fixture("manual");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const id = ws.opportunities[0].id;
    await handback(f, id);
    const emailConnection = await f.inbox.addConnection(
      f.credentials,
      f.businessId,
      {
        label: "Related email sales conversation",
        channel: "email",
        conversationRefs: [],
        manualRepliesObservable: true,
      },
    );
    const emailCapture = await f.inbox.capture(
      f.credentials,
      f.businessId,
      emailConnection.id,
      {
        eventId: "email-related",
        messageRef: "email-related",
        conversationRef: "email-related",
        senderRef: "buyer@example.net",
        senderName: "Buyer",
        kind: "direct_inquiry",
        subject: "Same order",
        text: "Same purchasing need confirmed by salesperson",
        occurredAt: h.clock.now().toISOString(),
      },
    );
    const email = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      emailCapture.conversationId!,
    );
    const native = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    await f.inbox.associate(f.credentials, f.businessId, email.id, {
      expectedVersion: email.association.version,
      buyerId: native.buyer.id,
      messageIds: [email.messages[0].id],
      allMessages: false,
      target: { kind: "existing", opportunityId: id },
      future: "target",
      reason: "Salesperson confirmed same purchasing need across channels",
    });
    const queued = await f.control.queue(f.credentials, f.businessId, id, {
      messageId: email.messages[0].id,
      dueAt: h.clock.now().toISOString(),
      evaluation: { action: "prices", amount: null, discountBps: null },
    });
    h.clock.set("2026-11-05T09:01:00Z");
    await deliver(f.app, echo(f.assets.phoneNumberId));
    await f.restart().drain();
    const paused = await f.control.read(f.credentials, f.businessId, id);
    expect(paused.state).toBe("human");
    expect(paused.reason).toContain("Business App");
    expect(
      await f.control.dispatch(f.credentials, f.businessId, queued.id),
    ).toMatchObject({ state: "cancelled", reason: "control_changed" });
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    expect(c.manualReplies).toMatchObject([
      { text: "A salesperson is helping you", opportunityId: id },
    ]);
    h.clock.set("2026-11-05T09:02:00Z");
    await handback(f, id);
    await deliver(f.app, echo(f.assets.phoneNumberId));
    await f.restart().drain();
    expect((await f.control.read(f.credentials, f.businessId, id)).state).toBe(
      "automation",
    );
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).replyVisibility,
    ).toBe("supported_app_events");
    await deliver(f.app, echo(f.assets.phoneNumberId, "wamid.late-old-manual"));
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).receipts.find(
        (r) => r.messageRef === "wamid.late-old-manual",
      )?.state,
    ).toBe("historical");
    expect((await f.control.read(f.credentials, f.businessId, id)).state).toBe(
      "automation",
    );
  });
  it("uses real shared approved knowledge, qualification and the RFQ goal for a captured WhatsApp inquiry", async () => {
    const f = await fixture("qualification");
    const db = runtimeDatabase(h.runtime);
    const knowledge = createKnowledgeApplication({
      authenticate: h.authenticate,
      repository: createKnowledgeRepository(db),
      clock: h.clock,
    });
    await knowledge.saveDraft(f.credentials, f.businessId, {
      expectedVersion: 0,
      note: "Reviewed context",
      configuration: {
        offerings: [
          {
            name: "Steel",
            details: "Collection only.",
            inquiryReply: "informational",
          },
        ],
        answers: [],
        missingInformation: [],
        goal: "rfq",
        qualification: [
          {
            key: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
          },
        ],
        escalation: {
          name: "Sales owner",
          email: "meta-intake-qualification@example.com",
        },
      },
    });
    await knowledge.approve(f.credentials, f.businessId, {
      expectedVersion: 1,
      note: "Approved",
    });
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    const id = ws.opportunities[0].id;
    await handback(f, id);
    const inquiry = await bookingInquiry(
      h,
      db,
      f.credentials,
      f.businessId,
      f.control,
    );
    const result = await inquiry.process(f.credentials, f.businessId, id, {
      messageId: c.messages[0].id,
    });
    expect(result).toMatchObject({
      status: "ready",
      qualification: "qualified",
      goal: "rfq",
      knowledgeVersion: 2,
      facts: [{ key: "quantity", value: "500" }],
    });
    expect(result.body).toContain("quotation-request review");
    expect(result.reply.recipient).toBe("919876543210");
  });
  it("retains reordered replies until their parent arrives and keeps signed provider statuses separate from manual origin", async () => {
    const f = await fixture("reordered");
    await deliver(
      f.app,
      payload(
        f.assets.phoneNumberId,
        "wamid.child",
        "Quantity: 600",
        "wamid.parent",
      ),
    );
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).receipts[0].state,
    ).toBe("review");
    await deliver(f.app, payload(f.assets.phoneNumberId, "wamid.parent"));
    await f.app.drain();
    await f.restart().drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    expect(c.messages).toHaveLength(2);
    expect(new Set(c.messages.map((m) => m.opportunityId)).size).toBe(1);
    const status = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "200001",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: f.assets.phoneNumberId },
                statuses: [
                  {
                    id: "wamid.outbound",
                    recipient_id: "919876543210",
                    timestamp: "1793869200",
                    status: "delivered",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    await deliver(f.app, status);
    await deliver(f.app, status);
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).receipts.filter(
        (r) => r.kind === "status",
      ),
    ).toMatchObject([{ messageRef: "wamid.outbound", status: "delivered" }]);
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).manualObserved,
    ).toBe(false);
  });
  it("pauses dispatch for unsupported or pending visibility and keeps stored incoming work readable", async () => {
    const f = await fixture("visibility");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const id = ws.opportunities[0].id;
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    await handback(f, id);
    const action = await f.control.queue(f.credentials, f.businessId, id, {
      messageId: c.messages[0].id,
      dueAt: h.clock.now().toISOString(),
      evaluation: { action: "prices", amount: null, discountBps: null },
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "reply_visibility_unavailable",
    });
    const unknown = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "200001",
          changes: [
            {
              field: "message_echoes",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: f.assets.phoneNumberId },
              },
            },
          ],
        },
      ],
    };
    await deliver(f.app, unknown);
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).replyVisibility,
    ).toBe("gap");
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).manualObserved,
    ).toBe(false);
    h.clock.set("2026-11-05T09:01:00Z");
    const unverified = echo(f.assets.phoneNumberId, "wamid.wrong-origin");
    unverified.entry[0].changes[0].value.message_echoes[0].from = "14155550999";
    await deliver(f.app, unverified);
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).receipts.find(
        (r) => r.messageRef === "wamid.wrong-origin",
      ),
    ).toMatchObject({ kind: "gap", status: "unverified_outgoing_origin" });
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, c.id)).messages,
    ).toHaveLength(1);
    const diagnostics: unknown[] = [];
    const http = createWhatsAppIntakeHttp({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const response = await http.receive(
      new Request("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        body: "private-invalid-payload",
        headers: { "x-hub-signature-256": "bad" },
      }),
    );
    expect(response.status).toBe(401);
    expect(JSON.stringify(diagnostics)).not.toContain(
      "private-invalid-payload",
    );
    expect(await response.text()).not.toContain("private-invalid-payload");
  });
  it("reapplies schema/security without losing intake evidence and expires private staging content using the selected policy", async () => {
    const f = await fixture("retention");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    await h.reapplySchema();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).inboundObserved,
    ).toBe(true);
    await deliver(f.app, payload(f.assets.phoneNumberId, "wamid.awaiting"));
    h.clock.set("2026-11-07T09:00:00Z");
    await f.restart().drain();
    const renewed = await h.signIn("meta-intake-retention@example.com");
    const view = await f.app.workspace(renewed, f.businessId);
    expect(view.gap).toBe("unprocessed_event_expired");
    expect(
      view.receipts.find((r) => r.messageRef === "wamid.awaiting")?.state,
    ).toBe("expired");
    expect(
      (await f.inbox.workspace(renewed, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("requires read and append grants separately for Meta staging", async () => {
    await h.admin.query("REVOKE INSERT ON whatsapp_receipt FROM app_runtime");
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await h.admin.query("GRANT INSERT ON whatsapp_receipt TO app_runtime");
    }
    await h.admin.query("REVOKE SELECT ON whatsapp_intake FROM app_runtime");
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await h.admin.query("GRANT SELECT ON whatsapp_intake TO app_runtime");
    }
    await verifyRuntimeRole(h.runtime);
  });
  it("rechecks current provider permissions for intake and recovery while retaining captured work", async () => {
    const f = await fixture("permission-revoked");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    await deliver(
      f.app,
      payload(f.assets.phoneNumberId, "wamid.permission-pending"),
    );
    f.meta.checks.permissions = "missing";
    await f.onboarding.refresh(f.credentials, f.businessId, {
      expectedVersion: 2,
    });
    expect((await f.app.workspace(f.credentials, f.businessId)).enabled).toBe(
      false,
    );
    await expect(
      deliver(
        f.app,
        payload(f.assets.phoneNumberId, "wamid.after-permission-revoked"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.restart().drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    const c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    expect(c.messages.map((message) => message.messageRef)).toEqual([
      "wamid.incoming-1",
    ]);
  });
  it("does not let a future worker clock erase staging before its actual database expiry", async () => {
    const f = await fixture("purge-bound", undefined, false, 315360000);
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    h.clock.set("2026-11-05T09:01:00Z");
    await deliver(f.app, echo(f.assets.phoneNumberId));
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    h.clock.set("2040-11-05T09:01:00Z");
    await f.restart().drain();
    h.clock.set("2026-11-05T09:01:00Z");
    const history = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    expect(history.manualReplies).toMatchObject([
      { text: "A salesperson is helping you" },
    ]);
  });
  it("does not invent manual origin from unfamiliar app metadata or hide altered evidence under a known event identity", async () => {
    const f = await fixture("origin-evidence");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    h.clock.set("2026-11-05T09:01:00Z");
    const original = echo(f.assets.phoneNumberId, "wamid.origin-evidence");
    const altered = {
      ...original,
      entry: original.entry.map((entry) => ({
        ...entry,
        changes: entry.changes.map((change) => ({
          ...change,
          value: {
            ...change.value,
            message_echoes: change.value.message_echoes.map((message) => ({
              ...message,
              origin: "cloud_api",
            })),
          },
        })),
      })),
    };
    await deliver(f.app, altered);
    await f.app.drain();
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).receipts.find(
        (r) => r.messageRef === "wamid.origin-evidence",
      ),
    ).toMatchObject({ kind: "gap" });
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).manualObserved,
    ).toBe(false);
    const second = echo(f.assets.phoneNumberId, "wamid.changed-native-fields");
    await deliver(f.app, second);
    await f.app.drain();
    const changed = {
      ...second,
      entry: second.entry.map((entry) => ({
        ...entry,
        changes: entry.changes.map((change) => ({
          ...change,
          value: {
            ...change.value,
            message_echoes: change.value.message_echoes.map((message) => ({
              ...message,
              origin: "unknown_device",
            })),
          },
        })),
      })),
    };
    await deliver(f.app, changed);
    expect((await f.app.workspace(f.credentials, f.businessId)).gap).toBe(
      "conflicting_provider_identity",
    );
  });
  it("fences pending exact activity only for its need and ambiguous activity only for its peer while unrelated dispatch continues", async () => {
    const f = await fixture("dispatch-scope", undefined, true);
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    await deliver(f.app, payload(f.assets.phoneNumberId, "wamid.scope-second"));
    await f.app.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId);
    let c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    const second = c.messages.find(
      (m) => m.messageRef === "wamid.scope-second",
    )!;
    await f.inbox.associate(f.credentials, f.businessId, c.id, {
      expectedVersion: c.association.version,
      buyerId: c.buyer.id,
      messageIds: [second.id],
      allMessages: false,
      target: { kind: "new", title: "Independent order" },
      future: "review",
      reason: "Separate need",
    });
    const other = payload(f.assets.phoneNumberId, "wamid.other-peer");
    other.entry[0].changes[0].value.messages[0].from = "919876543211";
    other.entry[0].changes[0].value.contacts[0].wa_id = "919876543211";
    await deliver(f.app, other);
    await f.app.drain();
    c = await f.inbox.conversation(f.credentials, f.businessId, c.id);
    const first = c.messages.find((m) => m.messageRef === "wamid.incoming-1")!;
    const secondCurrent = c.messages.find((m) => m.id === second.id)!;
    const otherWs = await f.inbox.workspace(f.credentials, f.businessId);
    const otherConversation = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      otherWs.conversations.find((item) => item.id !== c.id)!.id,
    );
    const third = otherConversation.messages[0];
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
    });
    const policy = await authority.workspace(f.credentials, f.businessId);
    const actor = await h.authenticate(f.credentials);
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
      note: "Approved bounded action",
    });
    h.clock.set("2026-11-05T09:01:00Z");
    await deliver(
      f.app,
      echo(f.assets.phoneNumberId, "wamid.coverage", "wamid.incoming-1"),
    );
    await f.app.drain();
    h.clock.set("2026-11-05T09:02:00Z");
    for (const message of [first, secondCurrent, third])
      await handback(f, message.opportunityId!);
    const queue = (message: typeof first) =>
      f.control.queue(f.credentials, f.businessId, message.opportunityId!, {
        messageId: message.id,
        dueAt: h.clock.now().toISOString(),
        evaluation: {
          action: "prices",
          amount: { currency: "USD", minor: "500" },
          discountBps: 0,
        },
      });
    const affected = await queue(first);
    const independent = await queue(secondCurrent);
    const pending = echo(
      f.assets.phoneNumberId,
      "wamid.pending-exact",
      "wamid.incoming-1",
    );
    pending.entry[0].changes[0].value.message_echoes[0].timestamp =
      "1793869380";
    h.clock.set("2026-11-05T09:03:00Z");
    await deliver(f.app, pending);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, affected.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "reply_visibility_unavailable",
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, independent.id),
    ).toMatchObject({ state: "dispatched" });
    await f.app.drain();
    const ambiguous = echo(f.assets.phoneNumberId, "wamid.pending-ambiguous");
    ambiguous.entry[0].changes[0].value.message_echoes[0].timestamp =
      "1793869380";
    await deliver(f.app, ambiguous);
    await f.app.drain();
    const blocked = await queue(secondCurrent);
    const unrelated = await queue(third);
    await deliver(f.app, {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "200001",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: f.assets.phoneNumberId },
                statuses: [
                  {
                    id: "wamid.status-only",
                    status: "delivered",
                    timestamp: "1793869380",
                    recipient_id: "919876543211",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, blocked.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "reply_visibility_unavailable",
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, unrelated.id),
    ).toMatchObject({ state: "dispatched" });
    const ambiguousReceipt = (
      await f.app.workspace(f.credentials, f.businessId)
    ).receipts.find((r) => r.messageRef === "wamid.pending-ambiguous")!;
    await f.app.associate(f.credentials, f.businessId, {
      receiptId: ambiguousReceipt.id,
      messageId: secondCurrent.id,
    });
    await handback(f, secondCurrent.opportunityId!);
    const gap = echo(
      f.assets.phoneNumberId,
      "wamid.unsupported-known-peer",
      "wamid.incoming-1",
    );
    gap.entry[0].changes[0].value.message_echoes[0].type = "image";
    await deliver(f.app, gap);
    await f.app.drain();
    const afterGap = await queue(third);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, afterGap.id),
    ).toMatchObject({ state: "dispatched" });
    h.clock.set("2026-11-07T09:03:00Z");
    await f.restart().drain();
    h.clock.set("2026-11-05T09:03:00Z");
    const samePeerAfterPurge = await queue(secondCurrent);
    expect(
      await f.control.dispatch(
        f.credentials,
        f.businessId,
        samePeerAfterPurge.id,
      ),
    ).toMatchObject({ state: "dispatched" });
    expect(f.outbound.map((action) => action.actionId)).toEqual([
      independent.id,
      unrelated.id,
      afterGap.id,
      samePeerAfterPurge.id,
    ]);
  });
  it("keeps separate purchasing needs independent and lets an accountable review resolve ambiguous manual activity", async () => {
    const f = await fixture("manual-needs");
    await deliver(f.app, payload(f.assets.phoneNumberId));
    await f.app.drain();
    await deliver(
      f.app,
      payload(
        f.assets.phoneNumberId,
        "wamid.second-need",
        "Need steel for a different site",
      ),
    );
    await f.app.drain();
    let ws = await f.inbox.workspace(f.credentials, f.businessId);
    let c = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      ws.conversations[0].id,
    );
    const second = c.messages.find(
      (m) => m.messageRef === "wamid.second-need",
    )!;
    await f.inbox.associate(f.credentials, f.businessId, c.id, {
      expectedVersion: c.association.version,
      buyerId: c.buyer.id,
      messageIds: [second.id],
      allMessages: false,
      target: { kind: "new", title: "Different site order" },
      future: "review",
      reason: "Distinct purchasing need",
    });
    ws = await f.inbox.workspace(f.credentials, f.businessId);
    c = await f.inbox.conversation(f.credentials, f.businessId, c.id);
    const firstId = c.messages.find(
      (m) => m.messageRef === "wamid.incoming-1",
    )!.opportunityId!;
    const secondId = c.messages.find(
      (m) => m.messageRef === "wamid.second-need",
    )!.opportunityId!;
    await handback(f, firstId);
    await handback(f, secondId);
    h.clock.set("2026-11-05T09:01:00Z");
    await deliver(
      f.app,
      echo(f.assets.phoneNumberId, "wamid.exact-manual", "wamid.incoming-1"),
    );
    await f.app.drain();
    expect(
      (await f.control.read(f.credentials, f.businessId, firstId)).state,
    ).toBe("human");
    expect(
      (await f.control.read(f.credentials, f.businessId, secondId)).state,
    ).toBe("automation");
    await deliver(f.app, echo(f.assets.phoneNumberId, "wamid.ambiguous"));
    await f.app.drain();
    const view = await f.app.workspace(f.credentials, f.businessId);
    const receipt = view.receipts.find(
      (r) => r.messageRef === "wamid.ambiguous",
    )!;
    expect(receipt.state).toBe("review");
    const version = (
      await f.control.read(f.credentials, f.businessId, secondId)
    ).version;
    await f.restart().drain();
    expect(
      (await f.control.read(f.credentials, f.businessId, secondId)).version,
    ).toBe(version);
    await f.app.associate(f.credentials, f.businessId, {
      receiptId: receipt.id,
      messageId: second.id,
    });
    expect(
      (await f.control.read(f.credentials, f.businessId, secondId)).state,
    ).toBe("human");
    expect((await f.app.workspace(f.credentials, f.businessId)).gap).toBeNull();
  });
});
