import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createKnowledgeApplication } from "../src/application/knowledge";
import { createKnowledgeRepository } from "../src/db/knowledge-repository";
import { createCommercialApplication } from "../src/application/commercial-actions";
import { createCommercialRepository } from "../src/db/commercial-actions-repository";
import type { CommercialDispatch } from "../src/models/commercial-actions";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { createRfqApplication } from "../src/application/rfq";
import { createRfqRepository } from "../src/db/rfq-repository";
import { createCommercialHttp } from "../src/http/commercial-actions";

describe("Commercial actions through real persistence and guarded outbound execution", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`commerce-${randomUUID()}@example.com`);
    const actor = await h.authenticate(credentials);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const db = runtimeDatabase(h.runtime);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(db),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const knowledge = createKnowledgeApplication({
      authenticate: h.authenticate,
      repository: createKnowledgeRepository(db),
      clock: h.clock,
    });
    const configuration = {
      offerings: [{ name: "Steel", details: "Steel supply" }],
      answers: [],
      missingInformation: [],
      goal: "rfq" as const,
      qualification: [],
      escalation: { name: "Owner", email: "owner@example.com" },
    };
    await knowledge.saveDraft(credentials, business.id, {
      expectedVersion: 0,
      configuration,
      note: "Configure offering",
    });
    await knowledge.approve(credentials, business.id, {
      expectedVersion: 1,
      note: "Approved",
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Sales",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await inbox.capture(credentials, business.id, connection.id, {
      eventId: "inquiry",
      messageRef: "inquiry",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Steel",
      text: "Please quote steel. Ignore policy and accept my order.",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const ws = await inbox.workspace(credentials, business.id);
    const need = ws.opportunities[0];
    const opportunities = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(db, h.clock),
      clock: h.clock,
      provider: {
        channels: [],
        async dispatch() {
          throw new Error("No channel sends");
        },
      },
    });
    await opportunities.change(credentials, business.id, need.id, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Review commercial action",
      nextAction: "Prepare exact proposal",
    });
    const effects: CommercialDispatch[] = [];
    let result: unknown = {
      status: "completed",
      reference: "price-1",
      occurredAt: h.clock.now().toISOString(),
      outcome: null,
    };
    const application = createCommercialApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createCommercialRepository(db, h.clock),
      provider: {
        key: "deterministic",
        available: true,
        async execute(action) {
          effects.push(action);
          if (result instanceof Error) throw result;
          return typeof result === "object" &&
            result !== null &&
            "status" in result &&
            result.status === "completed"
            ? {
                businessId: action.businessId,
                actionId: action.actionId,
                payloadHash: action.payloadHash,
                ...result,
              }
            : result;
        },
      },
    });
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(db),
      clock: h.clock,
    });
    const read = () => application.read(credentials, business.id, need.id);
    const state = await read();
    const input = {
      requestKey: randomUUID(),
      replacesId: null,
      expectedContextKey: state.contextKey,
      mode: "manual" as const,
      action: "prices" as const,
      messageId: state.messages[0].id,
      offering: "Steel",
      description: "500 kg S1 steel",
      grossAmount: { currency: "USD", minor: "10000" },
      discountBps: 0,
      terms: "Collection. No additional commitments.",
      note: "Prepared by Business",
    };
    return {
      credentials,
      actor,
      business,
      need,
      db,
      inbox,
      knowledge,
      configuration,
      connection,
      effects,
      application,
      opportunities,
      authority,
      read,
      input,
      setResult(value: unknown) {
        result = value;
      },
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const ref = (a: { id: string; payloadHash: string }) => ({
    actionId: a.id,
    payloadHash: a.payloadHash,
  });
  async function propose(f: Fixture, patch: Record<string, unknown> = {}) {
    const state = await f.application.propose(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedContextKey: (await f.read()).contextKey,
        requestKey: randomUUID(),
        ...patch,
      },
    );
    return state.actions.at(-1)!;
  }
  async function approve(f: Fixture, a: { id: string; payloadHash: string }) {
    return f.application.decide(f.credentials, f.business.id, f.need.id, {
      ...ref(a),
      decision: "approved",
      note: "Approve exact action",
    });
  }
  async function join(f: Fixture, role: "admin" | "salesperson") {
    const email = `commerce-${role}-${randomUUID()}@example.com`;
    await h.team.invite(f.credentials, f.business.id, { email, role });
    const mail = h.invitations.sent.at(-1)!;
    const credentials = await h.signIn(email, role === "admin");
    await h.team.accept(credentials, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    return { credentials, actor: await h.authenticate(credentials) };
  }
  it("requires an explicit immutable approval by default, deduplicates execution and never calls a price communication a sale", async () => {
    const f = await fixture();
    const proposed = await f.application.propose(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    const action = proposed.actions[0];
    expect(action.evaluation).toMatchObject({
      status: "approval_required",
      reason: "automation_disabled",
    });
    expect(action.decision).toBeNull();
    await expect(
      f.application.execute(f.credentials, f.business.id, f.need.id, {
        actionId: action.id,
        payloadHash: action.payloadHash,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.effects).toEqual([]);
    await f.application.decide(f.credentials, f.business.id, f.need.id, {
      actionId: action.id,
      payloadHash: action.payloadHash,
      decision: "approved",
      note: "Approve only this price",
    });
    await Promise.all(
      [1, 2].map(() =>
        f.application.execute(f.credentials, f.business.id, f.need.id, {
          actionId: action.id,
          payloadHash: action.payloadHash,
        }),
      ),
    );
    expect(f.effects).toHaveLength(1);
    expect(f.effects[0]).toMatchObject({
      businessId: f.business.id,
      actionId: action.id,
      payload: {
        action: "prices",
        netAmount: { currency: "USD", minor: "10000" },
        recipientRef: "buyer@example.net",
      },
    });
    const reloaded = await f.read();
    expect(reloaded.actions[0].execution).toMatchObject({
      state: "completed",
      reference: "price-1",
    });
    expect(reloaded.outcomes).toEqual([]);
  });
  it("never transfers a V1 approval to V2, retains rejection and deduplicates exact proposals and decisions", async () => {
    const f = await fixture();
    const a = (
      await f.application.propose(
        f.credentials,
        f.business.id,
        f.need.id,
        f.input,
      )
    ).actions[0];
    await f.application.propose(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    expect((await f.read()).actions).toHaveLength(1);
    await approve(f, a);
    await approve(f, a);
    const b = await propose(f, {
      replacesId: a.id,
      grossAmount: { currency: "USD", minor: "20000" },
    });
    expect(b.version).toBe(2);
    expect(b.decision).toBeNull();
    expect(b.seriesId).toBe(a.seriesId);
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    await expect(
      f.application.execute(f.credentials, f.business.id, f.need.id, ref(b)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.application.decide(f.credentials, f.business.id, f.need.id, {
        ...ref(b),
        payloadHash: a.payloadHash,
        decision: "approved",
        note: "Wrong payload",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.application.decide(f.credentials, f.business.id, f.need.id, {
      ...ref(b),
      decision: "rejected",
      note: "Amount incorrect",
    });
    await expect(approve(f, b)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(b),
    );
    expect(f.effects).toEqual([]);
    expect((await f.read()).actions.map((a) => a.execution?.reason)).toEqual([
      "proposal_replaced",
      "rejected",
    ]);
  });
  it("executes exact in-limit automation only when explicitly enabled, evaluates gross exposure and secondary discounts", async () => {
    const f = await fixture();
    const initial = await f.authority.workspace(f.credentials, f.business.id);
    const rule = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 500,
      escalationOwnerId: f.actor.userId,
    };
    await f.authority.save(f.credentials, f.business.id, {
      expectedVersion: 0,
      policy: { ...initial.policy, prices: rule, orders: rule },
      note: "Enable selected actions",
    });
    const control = await f.opportunities.read(
      f.credentials,
      f.business.id,
      f.need.id,
    );
    await f.opportunities.change(f.credentials, f.business.id, f.need.id, {
      command: "handback",
      expectedVersion: control.version,
      reason: "Return explicitly",
      nextAction: "Evaluate commercial actions",
    });
    const exact = await propose(f, { mode: "automation" });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(exact),
    );
    expect(f.effects).toHaveLength(1);
    const discounted = await propose(f, { discountBps: 500 });
    expect(discounted.evaluation).toMatchObject({
      status: "approval_required",
      checkedAction: "discounts",
    });
    await expect(
      f.application.execute(
        f.credentials,
        f.business.id,
        f.need.id,
        ref(discounted),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const policy = await f.authority.workspace(f.credentials, f.business.id);
    await f.authority.save(f.credentials, f.business.id, {
      expectedVersion: 1,
      policy: { ...policy.policy, discounts: rule },
      note: "Enable bounded discount",
    });
    const allowed = await propose(f, { mode: "automation", discountBps: 500 });
    expect(allowed.payload.netAmount).toEqual({
      currency: "USD",
      minor: "9500",
    });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(allowed),
    );
    for (const patch of [
      { grossAmount: { currency: "USD", minor: "10001" } },
      { grossAmount: { currency: "JPY", minor: "100" } },
      { discountBps: 501 },
    ]) {
      const a = await propose(f, patch);
      expect(a.evaluation.status).toBe("approval_required");
      await expect(
        f.application.execute(f.credentials, f.business.id, f.need.id, ref(a)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(f.effects).toHaveLength(2);
  });
  it("rejects malformed, unsafe, unknown and fractional-minor-unit money/discount inputs before any effect", async () => {
    const f = await fixture();
    for (const patch of [
      { discountBps: -1 },
      { discountBps: 10001 },
      { discountBps: 1.5 },
      { discountBps: 1, grossAmount: { currency: "USD", minor: "1" } },
      { grossAmount: { currency: "USD", minor: 100 } },
      { grossAmount: { currency: "USD", minor: "01" } },
      { grossAmount: { currency: "XXX", minor: "100" } },
      { grossAmount: { currency: "USD", minor: "1e6" } },
      { grossAmount: { currency: "USD", minor: "-1" } },
      { grossAmount: { currency: "USD", minor: "1".repeat(31) } },
      { recipientRef: "attacker@example.com" },
      { approved: true },
    ]) {
      await expect(
        f.application.propose(f.credentials, f.business.id, f.need.id, {
          ...f.input,
          ...patch,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const a = await propose(f, {
      grossAmount: { currency: "JPY", minor: "999999999999999999999999999999" },
    });
    await approve(f, a);
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    expect(f.effects[0].payload.netAmount.minor).toBe(
      "999999999999999999999999999999",
    );
  });
  it.each(["policy", "takeover", "knowledge", "connection"])(
    "blocks approved stale execution after a current %s change",
    async (change) => {
      const f = await fixture();
      const a = await propose(f);
      await approve(f, a);
      if (change === "policy") {
        const s = await f.authority.workspace(f.credentials, f.business.id);
        await f.authority.save(f.credentials, f.business.id, {
          expectedVersion: 0,
          policy: s.policy,
          note: "Revoke old approvals",
        });
      }
      if (change === "takeover")
        await f.opportunities.change(f.credentials, f.business.id, f.need.id, {
          command: "takeover",
          expectedVersion: 1,
          reason: "Handle manually",
          nextAction: "Review",
        });
      if (change === "knowledge") {
        await f.knowledge.saveDraft(f.credentials, f.business.id, {
          expectedVersion: 2,
          configuration: {
            ...f.configuration,
            offerings: [{ name: "Steel", details: "Changed specifications" }],
          },
          note: "Change offering",
        });
        await f.knowledge.approve(f.credentials, f.business.id, {
          expectedVersion: 3,
          note: "Approved",
        });
      }
      if (change === "connection")
        await f.inbox.revokeConnection(
          f.credentials,
          f.business.id,
          f.connection.id,
        );
      await f.application.execute(
        f.credentials,
        f.business.id,
        f.need.id,
        ref(a),
      );
      expect((await f.read()).actions[0].execution?.state).toBe("blocked");
      expect(f.effects).toEqual([]);
    },
  );
  it.each(["known failure", "throw", "invalid receipt", "false sale"])(
    "persists %s without blind replay or fabricated outcomes",
    async (kind) => {
      const f = await fixture();
      const a = await propose(f);
      await approve(f, a);
      f.setResult(
        kind === "known failure"
          ? { status: "failed", reason: "rejected" }
          : kind === "throw"
            ? new Error("secret-provider-payload")
            : kind === "false sale"
              ? {
                  status: "completed",
                  reference: "fake",
                  occurredAt: h.clock.now().toISOString(),
                  outcome: "confirmed_sale",
                }
              : { status: "completed", text: "Quote issued, sale confirmed" },
      );
      await f.application.execute(
        f.credentials,
        f.business.id,
        f.need.id,
        ref(a),
      );
      await f.application.execute(
        f.credentials,
        f.business.id,
        f.need.id,
        ref(a),
      );
      const state = await f.read();
      expect(state.actions[0].execution?.state).toBe(
        kind === "known failure" ? "failed" : "ambiguous",
      );
      expect(state.outcomes).toEqual([]);
      expect(f.effects).toHaveLength(1);
      expect(JSON.stringify(state)).not.toContain("secret-provider-payload");
    },
  );
  it("issues a quote only from exact scoped evidence, preserves RFQ provenance and the human pause, and records orders/sales separately", async () => {
    const f = await fixture();
    await expect(propose(f, { action: "quotations" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const rfqs = createRfqApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createRfqRepository(f.db, h.clock),
    });
    const before = await rfqs.read(f.credentials, f.business.id, f.need.id);
    const rfq = await rfqs.save(f.credentials, f.business.id, f.need.id, {
      expectedVersion: 0,
      expectedKnowledgeVersion: 2,
      expectedControlVersion: before.controlVersion,
      expectedContextKey: before.contextKey,
      requestKey: randomUUID(),
      offering: "Steel",
      fields: [],
      note: "Requirements reviewed",
      nextAction: "Prepare quote",
    });
    const q = await propose(f, { action: "quotations" });
    await approve(f, q);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .state,
    ).toBe("human");
    expect(q.payload.rfqRevisionId).toBe(rfq.current?.revisionId);
    f.setResult({
      status: "completed",
      reference: "Q-42",
      occurredAt: h.clock.now().toISOString(),
      outcome: "issued_quote",
    });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(q),
    );
    expect((await f.read()).outcomes.map((o) => o.kind)).toEqual([
      "issued_quote",
    ]);
    const order = await propose(f, { action: "orders" });
    await approve(f, order);
    const evidence = {
      ...ref(order),
      kind: "accepted_order",
      reference: "PO-22",
      occurredAt: h.clock.now().toISOString(),
      note: "Business verified buyer purchase order for the exact approved terms",
    };
    await expect(
      f.application.evidence(f.credentials, f.business.id, f.need.id, {
        ...evidence,
        kind: "confirmed_sale",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await f.application.evidence(
      f.credentials,
      f.business.id,
      f.need.id,
      evidence,
    );
    await f.application.evidence(
      f.credentials,
      f.business.id,
      f.need.id,
      evidence,
    );
    expect((await f.read()).outcomes.map((o) => o.kind).sort()).toEqual([
      "accepted_order",
      "issued_quote",
    ]);
    await f.application.evidence(f.credentials, f.business.id, f.need.id, {
      ...evidence,
      kind: "confirmed_sale",
      reference: "SALE-22",
      note: "Business verified completed sale separately",
    });
    const state = await f.read();
    expect(state.outcomes.map((o) => o.kind).sort()).toEqual([
      "accepted_order",
      "confirmed_sale",
      "issued_quote",
    ]);
    expect(f.effects).toHaveLength(1);
    expect(
      (await rfqs.read(f.credentials, f.business.id, f.need.id)).history,
    ).toEqual(rfq.history);
    expect(
      (await f.inbox.workspace(f.credentials, f.business.id)).opportunities[0]
        .stage,
    ).toBe("inquiry");
  });
  it("checks current approver membership/role, session MFA and assigned owner, including a salesperson's limited financial authority", async () => {
    const f = await fixture();
    const sales = await join(f, "salesperson");
    const admin = await join(f, "admin");
    await f.opportunities.change(sales.credentials, f.business.id, f.need.id, {
      command: "takeover",
      expectedVersion: 1,
      reason: "Assigned sales review",
      nextAction: "Propose order",
    });
    const current = await f.application.read(
      sales.credentials,
      f.business.id,
      f.need.id,
    );
    const a = (
      await f.application.propose(sales.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedContextKey: current.contextKey,
      })
    ).actions[0];
    await expect(
      f.application.decide(sales.credentials, f.business.id, f.need.id, {
        ...ref(a),
        decision: "approved",
        note: "I handle manually",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.application.execute(
        sales.credentials,
        f.business.id,
        f.need.id,
        ref(a),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.application.propose(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        requestKey: randomUUID(),
        expectedContextKey: current.contextKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.application.decide(admin.credentials, f.business.id, f.need.id, {
      ...ref(a),
      decision: "approved",
      note: "Approve exact exception",
    });
    await h.team.changeRole(f.credentials, f.business.id, {
      userId: admin.actor.userId,
      role: "salesperson",
    });
    await f.application.execute(
      sales.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    expect((await f.read()).actions[0].execution).toMatchObject({
      state: "blocked",
      reason: "approval_authority_revoked",
    });
    const unverified = await h.signIn(
      (await h.application.getProfile(f.credentials, f.business.id)).name +
        `-${randomUUID()}@example.com`,
      false,
    );
    await expect(
      f.application.read(unverified, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.team.removeMember(f.credentials, f.business.id, {
      userId: sales.actor.userId,
    });
    await expect(
      f.application.read(sales.credentials, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.effects).toEqual([]);
  });
  it("rejects cross-Business reads, decisions and evidence, forged HTTP commands and expired MFA with safe diagnostics", async () => {
    const f = await fixture();
    const other = await fixture();
    const a = await propose(f);
    await approve(f, a);
    for (const op of [
      () => f.application.read(other.credentials, f.business.id, f.need.id),
      () =>
        f.application.decide(other.credentials, f.business.id, f.need.id, {
          ...ref(a),
          decision: "approved",
          note: "Cross scope",
        }),
      () =>
        f.application.evidence(other.credentials, f.business.id, f.need.id, {
          ...ref(a),
          kind: "confirmed_sale",
          reference: "foreign",
          occurredAt: h.clock.now().toISOString(),
          note: "Foreign evidence",
        }),
    ])
      await expect(op()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.execute(
        f.credentials,
        other.business.id,
        other.need.id,
        ref(a),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const diagnostics: unknown[] = [];
    const http = createCommercialHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const request = (
      input: unknown,
      origin = "http://localhost:3000",
      headers = f.credentials,
    ) =>
      new Request("http://localhost:3000/commerce", {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers),
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    expect(
      (
        await http.propose(
          request(f.input, "https://attacker.example"),
          f.business.id,
          f.need.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.execute(
          request({ ...ref(a), payload: { amount: 0 }, approved: true }),
          f.business.id,
          f.need.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.read(
          new Request("http://localhost:3000/commerce"),
          f.business.id,
          f.need.id,
        )
      ).status,
    ).toBe(401);
    h.clock.set("2026-11-05T21:01:00Z");
    expect(
      (await http.execute(request(ref(a)), f.business.id, f.need.id)).status,
    ).toBe(403);
    expect(f.effects).toEqual([]);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /cookie|token|secret|attacker/i,
    );
  });
  it("keeps original queued-session revocation effective for a later verified session and preserves immutable records across security reapplication", async () => {
    const f = await fixture();
    const a = await propose(f);
    await approve(f, a);
    const identity = await h.admin.query(
      'select email from public."user" where id=$1',
      [f.actor.userId],
    );
    const surviving = await h.signIn(identity.rows[0].email);
    await h.signOut(f.credentials);
    await expect(
      f.application.execute(surviving, f.business.id, f.need.id, ref(a)),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.effects).toEqual([]);
    await h.reapplySchema();
    expect(
      (await f.application.read(surviving, f.business.id, f.need.id))
        .actions[0],
    ).toMatchObject({
      payloadHash: a.payloadHash,
      decision: { decision: "approved" },
      execution: null,
    });
    const tables = [
      "commercial_proposal",
      "commercial_decision",
      "commercial_execution",
      "commercial_outcome",
    ];
    const rls = await h.admin.query(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname=any($1)",
      [tables],
    );
    expect(rls.rows).toHaveLength(4);
    expect(
      rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    ).toBe(true);
    const grants = await h.admin.query(
      "select has_table_privilege('app_runtime','commercial_proposal','UPDATE') proposal_update, has_table_privilege('app_runtime','commercial_decision','DELETE') decision_delete, has_column_privilege('app_runtime','commercial_execution','provider','UPDATE') provider_update",
    );
    expect(grants.rows[0]).toEqual({
      proposal_update: false,
      decision_delete: false,
      provider_update: false,
    });
  });
  it("retains a durable unconfirmed claim when persistence fails after an external effect, with no replay", async () => {
    const f = await fixture();
    const a = await propose(f);
    await approve(f, a);
    await h.admin.query(
      "CREATE FUNCTION test_commercial_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated post-effect persistence failure'; END $$; CREATE TRIGGER test_commercial_write_failure BEFORE UPDATE ON commercial_execution FOR EACH ROW EXECUTE FUNCTION test_commercial_write_failure()",
    );
    try {
      await expect(
        f.application.execute(f.credentials, f.business.id, f.need.id, ref(a)),
      ).rejects.toBeDefined();
    } finally {
      await h.admin.query(
        "DROP TRIGGER test_commercial_write_failure ON commercial_execution; DROP FUNCTION test_commercial_write_failure()",
      );
    }
    expect(f.effects).toHaveLength(1);
    expect((await f.read()).actions[0].execution).toMatchObject({
      state: "committed",
      reason: "dispatch_unconfirmed",
      reference: null,
    });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    expect(f.effects).toHaveLength(1);
  });
  it("lets an MFA-verified Business approver attest an assigned salesperson's approved external order without taking over or sending", async () => {
    const f = await fixture();
    const sales = await join(f, "salesperson");
    await f.opportunities.change(sales.credentials, f.business.id, f.need.id, {
      command: "takeover",
      expectedVersion: 1,
      reason: "Handle assigned purchase",
      nextAction: "Request order approval",
    });
    const current = await f.application.read(
      sales.credentials,
      f.business.id,
      f.need.id,
    );
    const a = (
      await f.application.propose(sales.credentials, f.business.id, f.need.id, {
        ...f.input,
        action: "orders",
        expectedContextKey: current.contextKey,
      })
    ).actions[0];
    await approve(f, a);
    const evidence = {
      ...ref(a),
      kind: "accepted_order",
      reference: "PO-salesperson",
      occurredAt: h.clock.now().toISOString(),
      note: "Business verified this exact approved order was completed externally",
    };
    await expect(
      f.application.evidence(
        sales.credentials,
        f.business.id,
        f.need.id,
        evidence,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const state = await f.application.evidence(
      f.credentials,
      f.business.id,
      f.need.id,
      evidence,
    );
    expect(state.outcomes).toMatchObject([
      { kind: "accepted_order", source: "business", actorId: f.actor.userId },
    ]);
    const control = await f.opportunities.read(
      f.credentials,
      f.business.id,
      f.need.id,
    );
    expect(control).toMatchObject({
      ownerId: sales.actor.userId,
      state: "human",
      version: 2,
    });
    expect(f.effects).toEqual([]);
  });
  it("blocks approved execution when the retained message is reassociated to a separate purchasing need", async () => {
    const f = await fixture();
    const a = await propose(f);
    await approve(f, a);
    const ws = await f.inbox.workspace(f.credentials, f.business.id);
    const c = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      ws.conversations[0].id,
    );
    await f.inbox.associate(f.credentials, f.business.id, c.id, {
      expectedVersion: c.association.version,
      buyerId: c.buyer.id,
      messageIds: [a.payload.messageId],
      target: { kind: "new", title: "Distinct purchase" },
      future: "keep",
      reason: "Buyer clarified a separate need",
    });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    expect((await f.read()).actions[0].execution).toMatchObject({
      state: "blocked",
      reason: "context_changed",
    });
    expect(f.effects).toEqual([]);
  });
  it("does not claim success or fall back when live commercial execution is unconfigured", async () => {
    const f = await fixture();
    const a = await propose(f, { action: "orders" });
    await approve(f, a);
    let called = false;
    const application = createCommercialApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createCommercialRepository(f.db, h.clock),
      provider: {
        key: "unconfigured",
        available: false,
        async execute() {
          called = true;
          throw new Error("Must never be invoked");
        },
      },
    });
    expect(
      (await application.read(f.credentials, f.business.id, f.need.id))
        .providerAvailable,
    ).toBe(false);
    await expect(
      application.execute(f.credentials, f.business.id, f.need.id, ref(a)),
    ).rejects.toMatchObject({ code: "COMMERCIAL_SETUP_REQUIRED" });
    const state = await application.read(
      f.credentials,
      f.business.id,
      f.need.id,
    );
    expect(state.actions[0].execution).toBeNull();
    expect(state.outcomes).toEqual([]);
    expect(called).toBe(false);
  });
  it("allows an explicit new revision after a definitive failure and rejects mismatched scoped provider evidence", async () => {
    const f = await fixture();
    const a = await propose(f, { action: "discounts", discountBps: 1000 });
    await approve(f, a);
    f.setResult({ status: "failed", reason: "unavailable" });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(a),
    );
    const b = await propose(f, {
      replacesId: a.id,
      action: "discounts",
      discountBps: 1000,
    });
    await approve(f, b);
    expect(b.version).toBe(2);
    f.setResult({
      status: "completed",
      reference: "foreign",
      occurredAt: h.clock.now().toISOString(),
      outcome: null,
      businessId: randomUUID(),
    });
    await f.application.execute(
      f.credentials,
      f.business.id,
      f.need.id,
      ref(b),
    );
    expect((await f.read()).actions.at(-1)?.execution).toMatchObject({
      state: "ambiguous",
      reason: "receipt_mismatch",
    });
    expect(f.effects).toHaveLength(2);
    expect((await f.read()).outcomes).toEqual([]);
  });
  it.each(["policy change", "Business reconciliation"])(
    "rechecks a racing %s between durable claim and outbound dispatch",
    async (change) => {
      const f = await fixture();
      const a = await propose(f, { action: "orders" });
      await approve(f, a);
      async function waitForBlocked(count: number) {
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline) {
          const r = await h.admin.query(
            "select count(*) from pg_locks where locktype='advisory' and not granted",
          );
          if (Number(r.rows[0].count) >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("Database concurrency barrier was not reached");
      }
      const currentPolicy = (
        await f.authority.workspace(f.credentials, f.business.id)
      ).policy;
      const gate = await h.admin.connect();
      await gate.query("BEGIN");
      await gate.query("select pg_advisory_xact_lock(220020)");
      await h.admin.query(
        "CREATE FUNCTION test_commercial_claim_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(220020); RETURN NEW; END $$; CREATE TRIGGER test_commercial_claim_barrier BEFORE INSERT ON commercial_execution FOR EACH ROW WHEN (NEW.state = 'committed') EXECUTE FUNCTION test_commercial_claim_barrier()",
      );
      const dispatch = f.application.execute(
        f.credentials,
        f.business.id,
        f.need.id,
        ref(a),
      );
      try {
        await waitForBlocked(1);
        const changeWork =
          change === "policy change"
            ? f.authority.save(f.credentials, f.business.id, {
                expectedVersion: 0,
                policy: currentPolicy,
                note: "Changed before provider invocation",
              })
            : f.application.evidence(f.credentials, f.business.id, f.need.id, {
                ...ref(a),
                kind: "accepted_order",
                reference: "PO-race",
                occurredAt: h.clock.now().toISOString(),
                note: "Business verified externally completed exact order",
              });
        await waitForBlocked(2);
        await gate.query("COMMIT");
        await changeWork;
        await dispatch;
        expect(f.effects).toEqual([]);
        expect((await f.read()).actions[0].execution?.state).toBe(
          change === "policy change" ? "blocked" : "completed",
        );
      } finally {
        await gate.query("ROLLBACK");
        gate.release();
        await h.admin.query(
          "DROP TRIGGER test_commercial_claim_barrier ON commercial_execution; DROP FUNCTION test_commercial_claim_barrier()",
        );
      }
    },
  );
});
