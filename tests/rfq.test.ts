import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readySender, fixtureMailBinding } from "./support/senders";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createKnowledgeApplication } from "../src/application/knowledge";
import { createKnowledgeRepository } from "../src/db/knowledge-repository";
import { createRfqApplication } from "../src/application/rfq";
import { createRfqRepository } from "../src/db/rfq-repository";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import type { OpportunityDispatch } from "../src/models/opportunity-control";
import { createRfqHttp } from "../src/http/rfq";

describe("Quotation requests through the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`rfq-${randomUUID()}@example.com`);
    const actor = await h.authenticate(credentials);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Products and services",
      homeMarket: "US",
      website: "",
    });
    const database = runtimeDatabase(h.runtime);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const knowledge = createKnowledgeApplication({
      authenticate: h.authenticate,
      repository: createKnowledgeRepository(database),
      clock: h.clock,
    });
    const configuration = {
      offerings: [{ name: "Steel", details: "Configured steel supply" }],
      answers: [],
      missingInformation: [],
      goal: "rfq" as const,
      qualification: [
        {
          key: "specification",
          label: "Specification",
          type: "text" as const,
          required: true,
        },
        {
          key: "quantity",
          label: "Quantity",
          type: "number" as const,
          required: true,
        },
        {
          key: "delivery",
          label: "Delivery constraint",
          type: "text" as const,
          required: true,
        },
      ],
      escalation: { name: "Sales owner", email: "sales@example.com" },
    };
    await knowledge.saveDraft(credentials, business.id, {
      expectedVersion: 0,
      configuration,
      note: "Configure requirements",
    });
    await knowledge.approve(credentials, business.id, {
      expectedVersion: 1,
      note: "Approved",
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Manual intake",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await readySender(h, credentials, business.id, connection.id);
    await inbox.capture(credentials, business.id, connection.id, {
      eventId: "first",
      messageRef: "first",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Steel purchase",
      text: "Specification: S1\nQuantity: 500",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const ws = await inbox.workspace(credentials, business.id);
    const need = ws.opportunities[0];
    const effects: OpportunityDispatch[] = [];
    const opportunities = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(database, h.clock),
      clock: h.clock,
      provider: {
        emailIdentity: fixtureMailBinding,
        channels: ["email"],
        async dispatch(action) {
          effects.push(action);
        },
      },
    });
    await opportunities.change(credentials, business.id, need.id, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Review requirements",
      nextAction: "Capture quotation request",
    });
    const conversation = await inbox.conversation(
      credentials,
      business.id,
      ws.conversations[0].id,
    );
    const application = createRfqApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createRfqRepository(database, h.clock),
    });
    const read = () => application.read(credentials, business.id, need.id);
    const input = {
      expectedVersion: 0,
      expectedKnowledgeVersion: 2,
      expectedControlVersion: 0,
      expectedContextKey: (await read()).contextKey,
      requestKey: randomUUID(),
      offering: "Steel",
      fields: [
        {
          key: "specification",
          value: "S1",
          messageId: conversation.messages[0].id,
          quote: "Specification: S1",
        },
      ],
      note: "Reviewed buyer requirements",
      nextAction: "Ask buyer for quantity and delivery constraint",
    };
    input.expectedControlVersion = 1;
    return {
      credentials,
      actor,
      business,
      inbox,
      knowledge,
      configuration,
      connection,
      need,
      conversation,
      application,
      read,
      input,
      opportunities,
      effects,
    };
  }
  it("persists an incomplete RFQ, reviews it to complete, and reloads identity and attributable history without commercial outcomes", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    expect(first.current).toMatchObject({
      version: 1,
      status: "incomplete",
      missing: ["quantity", "delivery"],
    });
    expect(first.ownerId).toBe(f.actor.userId);
    expect(first.nextAction).toBe(
      "Ask buyer for quantity and delivery constraint",
    );
    const next = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedVersion: 1,
        expectedControlVersion: first.controlVersion,
        expectedContextKey: first.contextKey,
        requestKey: randomUUID(),
        fields: [
          ...f.input.fields,
          {
            key: "quantity",
            value: "500",
            messageId: f.conversation.messages[0].id,
            quote: "Quantity: 500",
          },
          {
            key: "delivery",
            value: "Collection",
            messageId: null,
            quote: null,
          },
        ],
        nextAction: "Review request for quotation preparation",
      },
    );
    expect(next.current).toMatchObject({
      id: first.current!.id,
      version: 2,
      status: "complete",
      missing: [],
    });
    const reloaded = await f.read();
    expect(reloaded).toEqual(next);
    expect(reloaded.history.map((r) => [r.version, r.actorId, r.at])).toEqual([
      [1, f.actor.userId, "2026-11-05T09:00:00.000Z"],
      [2, f.actor.userId, "2026-11-05T09:00:00.000Z"],
    ]);
    const inbox = await f.inbox.workspace(f.credentials, f.business.id);
    expect(inbox.opportunities[0].stage).toBe("inquiry");
    expect(f.effects).toEqual([]);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .actions,
    ).toEqual([]);
  });
  it("serializes concurrent captures and updates, rejects changed replays and stale edits, and preserves every revision", async () => {
    const f = await fixture();
    const captures = await Promise.all([
      f.application.save(f.credentials, f.business.id, f.need.id, f.input),
      f.application.save(f.credentials, f.business.id, f.need.id, f.input),
    ]);
    expect(captures[0]).toEqual(captures[1]);
    expect(captures[0].history).toHaveLength(1);
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        note: "Changed replay",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const update = {
      ...f.input,
      expectedVersion: 1,
      expectedControlVersion: captures[0].controlVersion,
      expectedContextKey: captures[0].contextKey,
      requestKey: randomUUID(),
      note: "Still waiting for buyer",
    };
    const updates = await Promise.all([
      f.application.save(f.credentials, f.business.id, f.need.id, update),
      f.application.save(f.credentials, f.business.id, f.need.id, update),
    ]);
    expect(updates[0]).toEqual(updates[1]);
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...update,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.read()).history).toHaveLength(2);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .history,
    ).toHaveLength(3);
    expect(f.effects).toEqual([]);
  });
  it("serves the persisted HTTP contract and rejects unsafe origins, invalid requirements and private diagnostics", async () => {
    const f = await fixture();
    const http = createRfqHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const request = (input: unknown, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/rfq", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie")!,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const response = await http.save(
      request(f.input),
      f.business.id,
      f.need.id,
    );
    expect(response.status).toBe(200);
    const reload = await http.read(
      new Request("http://localhost:3000/api/rfq", { headers: f.credentials }),
      f.business.id,
      f.need.id,
    );
    expect(await reload.json()).toEqual(await response.json());
    expect(
      (
        await http.save(
          request(f.input, "https://attacker.example"),
          f.business.id,
          f.need.id,
        )
      ).status,
    ).toBe(403);
    const invalid = await http.save(
      request({
        ...f.input,
        fields: [
          {
            key: "quantity",
            value: "sensitive-invalid-number",
            messageId: null,
            quote: null,
          },
        ],
        requestKey: randomUUID(),
        expectedVersion: 1,
        expectedControlVersion: (await f.read()).controlVersion,
        expectedContextKey: (await f.read()).contextKey,
      }),
      f.business.id,
      f.need.id,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("sensitive-invalid-number");
    expect(JSON.stringify(h.diagnostics)).not.toContain(
      "sensitive-invalid-number",
    );
    expect((await f.read()).history).toHaveLength(1);
  });
  it("re-evaluates changed requirements and retired knowledge honestly, retaining the original review", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        fields: [
          { key: "specification", value: "S1", messageId: null, quote: null },
          { key: "quantity", value: "500", messageId: null, quote: null },
          {
            key: "delivery",
            value: "Collection",
            messageId: null,
            quote: null,
          },
        ],
      },
    );
    expect(first.current?.status).toBe("complete");
    await f.knowledge.saveDraft(f.credentials, f.business.id, {
      expectedVersion: 2,
      configuration: {
        ...f.configuration,
        qualification: [
          ...f.configuration.qualification,
          {
            key: "deadline",
            label: "Required by",
            type: "text",
            required: true,
          },
        ],
      },
      note: "New required constraint",
    });
    await f.knowledge.approve(f.credentials, f.business.id, {
      expectedVersion: 3,
      note: "Approved new requirements",
    });
    const changed = await f.read();
    expect(changed.current).toMatchObject({
      status: "review_required",
      missing: ["deadline"],
    });
    expect(changed.history[0].completeness).toBe("complete");
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedVersion: 1,
        expectedControlVersion: changed.controlVersion,
        expectedContextKey: changed.contextKey,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const reviewed = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedVersion: 1,
        expectedKnowledgeVersion: 4,
        expectedControlVersion: changed.controlVersion,
        expectedContextKey: changed.contextKey,
        fields: [
          ...first.current!.fields,
          {
            key: "deadline",
            value: "Buyer to confirm",
            messageId: null,
            quote: null,
          },
        ],
        requestKey: randomUUID(),
        note: "Reviewed changed requirements",
      },
    );
    expect(reviewed.current).toMatchObject({
      status: "complete",
      knowledgeVersion: 4,
    });
    await f.knowledge.retire(f.credentials, f.business.id, {
      expectedVersion: 4,
      note: "Knowledge withdrawn",
    });
    const retired = await f.read();
    expect(retired.current?.status).toBe("review_required");
    expect(retired.canSave).toBe(false);
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedVersion: 2,
        expectedKnowledgeVersion: 4,
        expectedControlVersion: retired.controlVersion,
        expectedContextKey: retired.contextKey,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(retired.history).toHaveLength(2);
  });
  it("uses configured service requirements without inventing product quantities or enabling booking", async () => {
    const f = await fixture();
    const sentBefore = h.mail.sent.length;
    await f.knowledge.saveDraft(f.credentials, f.business.id, {
      expectedVersion: 2,
      configuration: {
        ...f.configuration,
        offerings: [
          { name: "Inspection", details: "Configured inspection service" },
        ],
        qualification: [
          { key: "site", label: "Service site", type: "text", required: true },
          {
            key: "scope",
            label: "Inspection scope",
            type: "text",
            required: true,
          },
        ],
      },
      note: "Configure service workflow",
    });
    await f.knowledge.approve(f.credentials, f.business.id, {
      expectedVersion: 3,
      note: "Approved service requirements",
    });
    await f.inbox.revokeConnection(
      f.credentials,
      f.business.id,
      f.connection.id,
    );
    const saved = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedKnowledgeVersion: 4,
        expectedContextKey: (await f.read()).contextKey,
        offering: "Inspection",
        fields: [
          { key: "site", value: "Buyer site", messageId: null, quote: null },
        ],
        nextAction: "Ask buyer for inspection scope",
      },
    );
    expect(saved.current).toMatchObject({
      status: "incomplete",
      missing: ["scope"],
    });
    expect(saved.requirements.map((r) => r.key)).toEqual(["site", "scope"]);
    expect(f.effects).toEqual([]);
    expect(h.mail.sent).toHaveLength(sentBefore);
  });
  it("keeps two needs for the same buyer separate and detects moved evidence without erasing history", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    await f.inbox.capture(f.credentials, f.business.id, f.connection.id, {
      eventId: "repeat",
      messageRef: "repeat",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Steel purchase",
      text: "Quantity: 500",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const repeated = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      f.conversation.id,
    );
    expect((await f.read()).current).toMatchObject({
      id: first.current!.id,
      status: "incomplete",
      missing: ["quantity", "delivery"],
    });
    expect((await f.read()).history).toHaveLength(1);
    await f.inbox.associate(f.credentials, f.business.id, f.conversation.id, {
      expectedVersion: repeated.association.version,
      buyerId: f.conversation.buyer.id,
      messageIds: [f.conversation.messages[0].id],
      target: { kind: "new", title: "Separate steel purchase" },
      future: "keep",
      reason: "Buyer clarified distinct purchasing need",
    });
    const c = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      f.conversation.id,
    );
    const secondId = c.messages[0].opportunityId!;
    expect(secondId).not.toBe(f.need.id);
    expect((await f.read()).current).toMatchObject({
      id: first.current!.id,
      status: "review_required",
      missing: ["specification", "quantity", "delivery"],
    });
    expect((await f.read()).history[0].fields).toEqual(f.input.fields);
    await f.opportunities.change(f.credentials, f.business.id, secondId, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Own separate purchase",
      nextAction: "Capture distinct requirements",
    });
    const second = await f.application.save(
      f.credentials,
      f.business.id,
      secondId,
      {
        ...f.input,
        expectedContextKey: (
          await f.application.read(f.credentials, f.business.id, secondId)
        ).contextKey,
        requestKey: randomUUID(),
        fields: [
          { key: "specification", value: "S2", messageId: null, quote: null },
        ],
        nextAction: "Review second need",
      },
    );
    expect(second.current?.id).not.toBe(first.current!.id);
    expect(second.current?.fields[0].value).toBe("S2");
    const old = await f.read();
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedVersion: 1,
        expectedControlVersion: old.controlVersion,
        expectedContextKey: old.contextKey,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await f.read()).history).toHaveLength(1);
    expect(
      (await f.application.read(f.credentials, f.business.id, secondId))
        .history,
    ).toHaveLength(1);
  });
  it("rejects cross-Business records, non-owner edits, invalid evidence and injected authority without partial writes", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      f.application.read(other.credentials, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.read(f.credentials, f.business.id, other.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.save(other.credentials, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const input of [
      {
        ...f.input,
        fields: [
          {
            ...f.input.fields[0],
            messageId: other.conversation.messages[0].id,
          },
        ],
      },
      {
        ...f.input,
        fields: [{ ...f.input.fields[0], quote: "Unrelated evidence" }],
      },
      { ...f.input, fields: [{ ...f.input.fields[0], key: "unconfigured" }] },
      { ...f.input, fields: [...f.input.fields, ...f.input.fields] },
      {
        ...f.input,
        fields: [
          { key: "quantity", value: "5 boxes", messageId: null, quote: null },
        ],
      },
      { ...f.input, ownerId: other.actor.userId },
      { ...f.input, quoteIssued: true },
      { ...f.input, note: "bad\0note" },
    ])
      await expect(
        f.application.save(f.credentials, f.business.id, f.need.id, input),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await h.admin.query(
      "INSERT INTO membership (business_id, user_id, role) VALUES ($1, $2, 'salesperson')",
      [f.business.id, other.actor.userId],
    );
    expect(
      (await f.application.read(other.credentials, f.business.id, f.need.id))
        .canSave,
    ).toBe(false);
    await expect(
      f.application.save(other.credentials, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.read()).history).toEqual([]);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .history,
    ).toHaveLength(1);
  });
  it("enforces MFA and persisted session and membership revocation again at the transaction boundary", async () => {
    const f = await fixture();
    const primary = await h.signIn(
      (await h.auth.api.getSession({ headers: f.credentials }))!.user.email,
      false,
    );
    await expect(
      f.application.read(primary, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(
      f.application.save(primary, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const revoked = createRfqApplication({
      authenticate: h.authenticate,
      authenticateForWork: async (credentials: Headers) => {
        const identity = await h.access.authenticateForWork(credentials);
        await h.signOut(credentials);
        return identity;
      },
      repository: createRfqRepository(runtimeDatabase(h.runtime), h.clock),
    });
    await expect(
      revoked.save(f.credentials, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const restored = await h.signIn(
      (await h.auth.api.getSession({ headers: primary }))!.user.email,
    );
    expect(
      (await f.application.read(restored, f.business.id, f.need.id)).history,
    ).toEqual([]);
    const removed = createRfqApplication({
      authenticate: h.authenticate,
      authenticateForWork: async (credentials: Headers) => {
        const identity = await h.access.authenticateForWork(credentials);
        await h.admin.query(
          "DELETE FROM membership WHERE business_id=$1 AND user_id=$2",
          [f.business.id, identity.userId],
        );
        return identity;
      },
      repository: createRfqRepository(runtimeDatabase(h.runtime), h.clock),
    });
    await expect(
      removed.save(restored, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("allows an unenrolled salesperson owner to review, shows the actual owner to colleagues, and flags removed owners", async () => {
    const f = await fixture();
    const saved = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    const salesperson = await h.signIn(
      `rfq-sales-${randomUUID()}@example.com`,
      false,
    );
    const salesActor = await h.authenticate(salesperson);
    await h.admin.query(
      "INSERT INTO membership (business_id, user_id, role) VALUES ($1, $2, 'salesperson')",
      [f.business.id, salesActor.userId],
    );
    const colleague = await f.application.read(
      salesperson,
      f.business.id,
      f.need.id,
    );
    expect(colleague.current?.status).toBe("incomplete");
    expect(colleague.ownerId).toBe(f.actor.userId);
    expect(colleague.setupReason).toBeNull();
    await f.opportunities.change(salesperson, f.business.id, f.need.id, {
      command: "takeover",
      expectedVersion: saved.controlVersion,
      reason: "Salesperson owns review",
      nextAction: "Review delivery requirement",
    });
    const own = await f.application.read(salesperson, f.business.id, f.need.id);
    const reviewed = await f.application.save(
      salesperson,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedVersion: 1,
        expectedControlVersion: own.controlVersion,
        expectedContextKey: own.contextKey,
        requestKey: randomUUID(),
        note: "Salesperson reviewed buyer requirement",
      },
    );
    expect(reviewed.history[1].actorId).toBe(salesActor.userId);
    expect((await f.read()).ownerId).toBe(salesActor.userId);
    await h.admin.query(
      "DELETE FROM membership WHERE business_id=$1 AND user_id=$2",
      [f.business.id, salesActor.userId],
    );
    const removed = await f.read();
    expect(removed.current?.status).toBe("review_required");
    expect(removed.setupReason).toContain("Assign a current Business member");
    expect(removed.history).toHaveLength(2);
  });
  it("rejects a stale evidence context and a booking goal while preserving native RFQ progress", async () => {
    const f = await fixture();
    await f.inbox.associate(f.credentials, f.business.id, f.conversation.id, {
      expectedVersion: f.conversation.association.version,
      buyerId: f.conversation.buyer.id,
      messageIds: [f.conversation.messages[0].id],
      target: { kind: "existing", opportunityId: f.need.id },
      future: "keep",
      reason: "Reconfirmed purchasing need after correction",
    });
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const current = await f.read();
    const captured = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      { ...f.input, expectedContextKey: current.contextKey },
    );
    expect(captured.current?.status).toBe("incomplete");
    await f.knowledge.saveDraft(f.credentials, f.business.id, {
      expectedVersion: 2,
      configuration: { ...f.configuration, goal: "booking" },
      note: "Changed conversion goal",
    });
    await f.knowledge.approve(f.credentials, f.business.id, {
      expectedVersion: 3,
      note: "Approved booking goal",
    });
    const changed = await f.read();
    expect(changed.canSave).toBe(false);
    expect(changed.current?.status).toBe("review_required");
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedVersion: 1,
        expectedKnowledgeVersion: 4,
        expectedControlVersion: changed.controlVersion,
        expectedContextKey: changed.contextKey,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(changed.history).toHaveLength(1);
    expect(f.effects).toEqual([]);
  });
  it("retains RFQ records through schema reapplication with forced RLS and append-only runtime grants", async () => {
    const f = await fixture();
    const saved = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    await h.reapplySchema();
    expect(await f.read()).toEqual(saved);
    const security = await h.admin.query(
      "select relname, relrowsecurity, relforcerowsecurity, has_table_privilege('app_runtime', oid, 'SELECT') as readable, has_table_privilege('app_runtime', oid, 'INSERT') as insertable, has_table_privilege('app_runtime', oid, 'UPDATE') as mutable, has_table_privilege('app_runtime', oid, 'DELETE') as deletable from pg_class where relname in ('rfq_request', 'rfq_revision') order by relname",
    );
    expect(security.rows).toEqual([
      {
        relname: "rfq_request",
        relrowsecurity: true,
        relforcerowsecurity: true,
        readable: true,
        insertable: true,
        mutable: false,
        deletable: false,
      },
      {
        relname: "rfq_revision",
        relrowsecurity: true,
        relforcerowsecurity: true,
        readable: true,
        insertable: true,
        mutable: false,
        deletable: false,
      },
    ]);
  });
  it("completes the native manual path with all external HTTP unavailable and no calendar or outbound effects", async () => {
    const f = await fixture();
    const externalHttp = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("External providers unavailable"));
    const mailBefore = h.mail.sent.length;
    try {
      const saved = await f.application.save(
        f.credentials,
        f.business.id,
        f.need.id,
        {
          ...f.input,
          fields: [
            { key: "specification", value: "S1", messageId: null, quote: null },
            { key: "quantity", value: "500", messageId: null, quote: null },
            {
              key: "delivery",
              value: "Collection",
              messageId: null,
              quote: null,
            },
          ],
        },
      );
      expect((await f.read()).current).toMatchObject({
        id: saved.current!.id,
        status: "complete",
      });
      expect(externalHttp).not.toHaveBeenCalled();
      expect(f.effects).toEqual([]);
      expect(h.mail.sent).toHaveLength(mailBefore);
      expect(
        (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
          .actions,
      ).toEqual([]);
    } finally {
      externalHttp.mockRestore();
    }
  });
});
