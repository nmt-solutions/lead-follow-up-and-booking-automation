import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import {
  configureEmailFixture,
  eligibilityApplication,
} from "./support/email-eligibility";
import { readySender, fixtureMailBinding } from "./support/senders";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import type { OpportunityDispatch } from "../src/models/opportunity-control";
import { createEmailEligibilityHttp } from "../src/http/email-eligibility";
import { emailEligibilityWorkspaceSchema } from "../src/models/email-eligibility";

describe("Email eligibility through persisted application and actual dispatch", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture(configured = true) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(
      `eligibility-${randomUUID()}@example.com`,
    );
    const actor = await h.authenticate(credentials);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Steel",
      homeMarket: "IN",
      website: "",
    });
    const db = runtimeDatabase(h.runtime);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(db),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Selected sales import",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await inbox.capture(credentials, business.id, connection.id, {
      eventId: "inquiry",
      messageRef: "inquiry",
      conversationRef: "thread",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      geography: "public US",
      kind: "direct_inquiry",
      subject: "Steel",
      text: "Need steel",
      occurredAt: h.clock.now().toISOString(),
    });
    const ws = await inbox.workspace(credentials, business.id);
    const need = ws.opportunities[0];
    const detail = await inbox.conversation(
      credentials,
      business.id,
      ws.conversations[0].id,
    );
    await readySender(h, credentials, business.id, connection.id);
    const effects: OpportunityDispatch[] = [];
    let effect = async (a: OpportunityDispatch) => {
      effects.push(a);
    };
    const control = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(db, h.clock),
      clock: h.clock,
      provider: {
        channels: ["email"],
        emailIdentity: fixtureMailBinding,
        dispatch: (a) => effect(a),
      },
    });
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(db),
      clock: h.clock,
    });
    const policy = await authority.workspace(credentials, business.id);
    policy.policy.prices = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 0,
      escalationOwnerId: actor.userId,
    };
    await authority.save(credentials, business.id, {
      expectedVersion: policy.version,
      policy: policy.policy,
      note: "Bounded authority",
    });
    for (const [command, expectedVersion] of [
      ["takeover", 0],
      ["handback", 1],
    ] as const)
      await control.change(credentials, business.id, need.id, {
        command,
        expectedVersion,
        reason: "Reviewed",
        nextAction: "Evaluate current policy",
      });
    const eligibility = configured
      ? await configureEmailFixture(h, credentials, business.id, need.id)
      : eligibilityApplication(h);
    const queue = () =>
      control.queue(credentials, business.id, need.id, {
        messageId: detail.messages[0].id,
        dueAt: h.clock.now().toISOString(),
        evaluation: {
          action: "prices",
          amount: { currency: "USD", minor: "100" },
          discountBps: 0,
        },
      });
    return {
      credentials,
      actor,
      businessId: business.id,
      need,
      connection,
      inbox,
      control,
      eligibility,
      queue,
      effects,
      detail,
      setEffect: (fn: typeof effect) => {
        effect = fn;
      },
    };
  }
  it("persists an explainable UNKNOWN independently of public geography, direct inquiry, approval and ready sender; explicit evidence and configured policy can allow only the bound action", async () => {
    const f = await fixture(false),
      a = await f.queue();
    const unknown = await f.eligibility.evaluate(f.credentials, f.businessId, {
      kind: "opportunity",
      id: a.id,
    });
    expect(unknown).toMatchObject({
      status: "unknown",
      purpose: "sales_follow_up",
      evidence: [],
    });
    expect(unknown.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "sender", status: "allowed" }),
        expect.objectContaining({ code: "market_policy", status: "unknown" }),
      ]),
    );
    await configureEmailFixture(h, f.credentials, f.businessId, f.need.id);
    expect(
      await f.eligibility.evaluate(f.credentials, f.businessId, {
        kind: "opportunity",
        id: a.id,
      }),
    ).toMatchObject({ status: "allowed", recipient: "buyer@example.net" });
    expect(
      (await f.eligibility.workspace(f.credentials, f.businessId)).evaluations,
    ).toHaveLength(2);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({ state: "dispatched" });
    expect(f.effects).toHaveLength(1);
  });
  it("records an exact normalized opt-out without engagement or handback; duplicate delivery is idempotent and later queued outreach cannot dispatch", async () => {
    const f = await fixture(),
      a = await f.queue();
    const event = {
      eventId: "optout",
      messageRef: "optout-message",
      conversationRef: "thread",
      replyToMessageRef: "inquiry",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "opt_out",
      subject: "Stop",
      text: "Unsubscribe",
      occurredAt: h.clock.now().toISOString(),
    };
    await f.inbox.capture(f.credentials, f.businessId, f.connection.id, event);
    expect(
      await f.inbox.capture(
        f.credentials,
        f.businessId,
        f.connection.id,
        event,
      ),
    ).toMatchObject({ status: "duplicate" });
    expect(
      (await f.eligibility.workspace(f.credentials, f.businessId)).suppressions,
    ).toMatchObject([
      { scope: "recipient_outreach", source: "incoming_opt_out" },
    ]);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_blocked",
    });
    expect(f.effects).toHaveLength(0);
    expect(
      await f.control.read(f.credentials, f.businessId, f.need.id),
    ).toMatchObject({
      state: "automation",
      ownerId: f.actor.userId,
      version: 2,
    });
    expect(
      (await f.inbox.conversation(f.credentials, f.businessId, f.detail.id))
        .messages,
    ).toHaveLength(1);
  });
  it("retains eligibility evidence and policy history through schema security reapplication", async () => {
    const f = await fixture();
    await h.reapplySchema();
    expect(
      (await f.eligibility.workspace(f.credentials, f.businessId)).recipients,
    ).toHaveLength(1);
  });
  it("deduplicates the same opt-out message under a new delivery event without broadening its scope after policy changes", async () => {
    const f = await fixture();
    const event = {
      eventId: "original-optout",
      messageRef: "optout",
      conversationRef: "thread",
      replyToMessageRef: "inquiry",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "opt_out",
      subject: "Stop",
      text: "Unsubscribe",
      occurredAt: h.clock.now().toISOString(),
    };
    await f.inbox.capture(f.credentials, f.businessId, f.connection.id, event);
    const p = (
      await f.eligibility.workspace(f.credentials, f.businessId)
    ).policies.find((p) => p.policy.purpose === "sales_follow_up")!;
    try {
      await f.eligibility.publishPolicy(f.credentials, f.businessId, {
        expectedVersion: p.version,
        policy: { ...p.policy, incomingOptOutScope: "recipient_email" },
      });
      expect(
        await f.inbox.capture(f.credentials, f.businessId, f.connection.id, {
          ...event,
          eventId: "redelivery",
        }),
      ).toMatchObject({ status: "duplicate" });
      expect(
        (await f.eligibility.workspace(f.credentials, f.businessId))
          .suppressions,
      ).toMatchObject([{ scope: "recipient_outreach" }]);
      await expect(
        f.inbox.capture(f.credentials, f.businessId, f.connection.id, {
          ...event,
          eventId: "mutated-redelivery",
          text: "Different instruction",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      const latest = (
        await f.eligibility.workspace(f.credentials, f.businessId)
      ).policies.find((p) => p.policy.purpose === "sales_follow_up")!;
      await f.eligibility.publishPolicy(f.credentials, f.businessId, {
        expectedVersion: latest.version,
        policy: { ...latest.policy, incomingOptOutScope: "recipient_outreach" },
      });
    }
  });
  const stop = (
    f: Awaited<ReturnType<typeof fixture>>,
    extra: Record<string, unknown> = {},
  ) => ({
    requestKey: randomUUID(),
    recipient: "buyer@example.net",
    scope: "recipient_outreach",
    opportunityId: null,
    effectiveAt: h.clock.now().toISOString(),
    reference: "Recipient requested no further outreach; owner reviews scope",
    ...extra,
  });
  it("lets a current Salesperson record a restriction while denying permission/content grants, then denies removed members without losing history", async () => {
    const f = await fixture(),
      email = `eligibility-sales-${randomUUID()}@example.com`;
    await h.team.invite(f.credentials, f.businessId, {
      email,
      role: "salesperson",
    });
    const notification = h.invitations.sent.at(-1)!;
    const sales = await h.signIn(email, false);
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(notification.url).hash.slice(1)).get(
        "token",
      ),
    });
    const ws = await f.eligibility.workspace(sales, f.businessId),
      a = await f.queue();
    expect(ws.canManage).toBe(false);
    await expect(
      f.eligibility.saveRecipient(sales, f.businessId, {
        expectedVersion: 1,
        facts: ws.recipients[0].facts,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.eligibility.reviewContent(sales, f.businessId, {
        action: { kind: "opportunity", id: a.id },
        requirements: ["purpose_review"],
        reference: "A salesperson cannot self-grant content review",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.eligibility.suppress(sales, f.businessId, stop(f));
    const actor = await h.authenticate(sales);
    expect(
      (await f.eligibility.workspace(f.credentials, f.businessId))
        .suppressions[0].actorId,
    ).toBe(actor.userId);
    await h.team.removeMember(f.credentials, f.businessId, {
      userId: actor.userId,
    });
    await expect(
      f.eligibility.workspace(sales, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await f.eligibility.workspace(f.credentials, f.businessId)).suppressions,
    ).toHaveLength(1);
  });
  it("rechecks current MFA after an eligibility write waits on the Business lock", async () => {
    const f = await fixture(),
      gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      f.businessId,
    ]);
    const rejected = expect(
      f.eligibility.suppress(f.credentials, f.businessId, stop(f)),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    try {
      await waitForBlocked(1);
      h.clock.set("2026-11-05T22:00:00Z");
      await gate.query("COMMIT");
      await rejected;
      h.clock.set("2026-11-05T09:00:00Z");
      expect(
        (await f.eligibility.workspace(f.credentials, f.businessId))
          .suppressions,
      ).toHaveLength(0);
    } finally {
      h.clock.set("2026-11-05T09:00:00Z");
      await gate.query("ROLLBACK");
      gate.release();
    }
  });
  it("does not dispatch if a future suppression becomes effective while the allowed decision is being persisted", async () => {
    const f = await fixture(),
      a = await f.queue();
    await f.eligibility.suppress(
      f.credentials,
      f.businessId,
      stop(f, { effectiveAt: "2026-11-05T09:01:00Z" }),
    );
    const gate = await h.admin.connect();
    await gate.query("BEGIN");
    await gate.query("select pg_advisory_xact_lock(310032)");
    await h.admin.query(
      "CREATE FUNCTION test_eligibility_time_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(310032); RETURN NEW; END $$; CREATE TRIGGER test_eligibility_time_barrier BEFORE INSERT ON email_eligibility_evaluation FOR EACH ROW WHEN (NEW.result->>'status'='allowed') EXECUTE FUNCTION test_eligibility_time_barrier()",
    );
    const dispatch = f.control.dispatch(f.credentials, f.businessId, a.id);
    try {
      await waitForBlocked(1);
      h.clock.set("2026-11-05T09:01:00Z");
      await gate.query("COMMIT");
      expect(await dispatch).toMatchObject({
        state: "cancelled",
        reason: "email_eligibility_unknown",
      });
      expect(f.effects).toHaveLength(0);
      expect(
        (await f.eligibility.workspace(f.credentials, f.businessId))
          .evaluations[0],
      ).toMatchObject({
        status: "unknown",
        checks: expect.arrayContaining([
          expect.objectContaining({ code: "effective_time_changed" }),
        ]),
      });
    } finally {
      await gate.query("ROLLBACK");
      gate.release();
      await h.admin.query(
        "DROP TRIGGER test_eligibility_time_barrier ON email_eligibility_evaluation; DROP FUNCTION test_eligibility_time_barrier()",
      );
    }
  });
  it("keeps ambiguous or unsupported recipient evidence UNKNOWN and never accepts public availability as permission", async () => {
    const f = await fixture(),
      a = await f.queue(),
      ws = await f.eligibility.workspace(f.credentials, f.businessId),
      facts = ws.recipients[0].facts;
    await f.eligibility.saveRecipient(f.credentials, f.businessId, {
      expectedVersion: 1,
      facts: {
        ...facts,
        market: null,
        recipientClass: "unknown",
        permissions: [],
        reference:
          "Buyer category and public web page do not establish country or legal class",
      },
    });
    const unknown = await f.eligibility.evaluate(f.credentials, f.businessId, {
      kind: "opportunity",
      id: a.id,
    });
    expect(unknown).toMatchObject({
      status: "unknown",
      evidence: [],
      policyId: null,
    });
    expect(
      unknown.checks
        .filter((c) =>
          ["destination", "recipient_class", "permission"].includes(c.code),
        )
        .every((c) => c.status === "unknown"),
    ).toBe(true);
    await expect(
      f.eligibility.saveRecipient(f.credentials, f.businessId, {
        expectedVersion: 2,
        facts: {
          ...facts,
          permissions: [{ ...facts.permissions[0], kind: "public_address" }],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      f.eligibility.publishPolicy(f.credentials, f.businessId, {
        expectedVersion: 0,
        policy: {
          ...ws.policies[0].policy,
          purpose: "sales_outreach",
          acceptedEvidence: ["direct_inquiry"],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("isolates an Opportunity opt-out from another purchasing need for the same email recipient and honors Business-recipient outreach scope across needs", async () => {
    const f = await fixture();
    await f.inbox.capture(f.credentials, f.businessId, f.connection.id, {
      eventId: "other-need",
      messageRef: "other-need",
      conversationRef: "other-need",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Another need",
      text: "Need a separate supply",
      occurredAt: h.clock.now().toISOString(),
    });
    const ws = await f.inbox.workspace(f.credentials, f.businessId),
      need = ws.opportunities.find((n) => n.id !== f.need.id)!;
    const conversation = ws.conversations.find(
      (c) => c.opportunityId === need.id,
    )!;
    const detail = await f.inbox.conversation(
      f.credentials,
      f.businessId,
      conversation.id,
    );
    for (const [command, expectedVersion] of [
      ["takeover", 0],
      ["handback", 1],
    ] as const)
      await f.control.change(f.credentials, f.businessId, need.id, {
        command,
        expectedVersion,
        reason: "Separate purchasing need",
        nextAction: "Apply current policy",
      });
    await configureEmailFixture(h, f.credentials, f.businessId, need.id);
    const queueOther = () =>
      f.control.queue(f.credentials, f.businessId, need.id, {
        messageId: detail.messages[0].id,
        dueAt: h.clock.now().toISOString(),
        evaluation: {
          action: "prices",
          amount: { currency: "USD", minor: "100" },
          discountBps: 0,
        },
      });
    await f.eligibility.suppress(
      f.credentials,
      f.businessId,
      stop(f, { scope: "opportunity_outreach", opportunityId: f.need.id }),
    );
    const other = await queueOther();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, other.id),
    ).toMatchObject({ state: "dispatched" });
    const first = await f.queue();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, first.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_blocked",
    });
    await f.eligibility.suppress(f.credentials, f.businessId, stop(f));
    const later = await queueOther();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, later.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_blocked",
    });
    expect(f.effects).toHaveLength(1);
  });
  async function waitForBlocked(count: number) {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const r = await h.admin.query<{ count: string }>(
        "select count(*) from pg_locks where locktype='advisory' and not granted",
      );
      if (Number(r.rows[0].count) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("PostgreSQL concurrency barrier not reached");
  }
  for (const restriction of [
    "first_opt_out",
    "evidence_withdrawal",
    "market_policy",
  ] as const)
    it(`applies ${restriction} inserted after durable commitment before the actual provider boundary`, async () => {
      const f = await fixture(),
        a = await f.queue();
      expect(
        await f.eligibility.evaluate(f.credentials, f.businessId, {
          kind: "opportunity",
          id: a.id,
        }),
      ).toMatchObject({ status: "allowed" });
      const gate = await h.admin.connect();
      await gate.query("BEGIN");
      await gate.query("select pg_advisory_xact_lock(310031)");
      await h.admin.query(
        "CREATE FUNCTION test_eligibility_commit_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(310031); RETURN NEW; END $$; CREATE TRIGGER test_eligibility_commit_barrier BEFORE UPDATE ON opportunity_due_action FOR EACH ROW WHEN (NEW.state='committed' AND OLD.state='pending') EXECUTE FUNCTION test_eligibility_commit_barrier()",
      );
      const dispatch = f.control.dispatch(f.credentials, f.businessId, a.id);
      try {
        await waitForBlocked(1);
        let changed: Promise<unknown>;
        if (restriction === "first_opt_out")
          changed = f.eligibility.suppress(
            f.credentials,
            f.businessId,
            stop(f),
          );
        else if (restriction === "evidence_withdrawal") {
          // Read the immutable revision using the public seam before the dispatch barrier to avoid a lock-taking workspace read.
          const permissions = {
            recipient: "buyer@example.net",
            market: "US",
            recipientClass: "corporate",
            reference: "Consent withdrawn after action commitment",
            effectiveAt: h.clock.now().toISOString(),
            validUntil: "2027-01-01T00:00:00Z",
            permissions: [],
          };
          changed = f.eligibility.saveRecipient(f.credentials, f.businessId, {
            expectedVersion: 1,
            facts: permissions,
          });
        } else {
          const other = await h.application.createBusiness(f.credentials, {
            name: "Operator review",
            offering: "Policy",
            homeMarket: "US",
            website: "",
          });
          const ws = await f.eligibility.workspace(f.credentials, other.id),
            p = ws.policies.find(
              (p) => p.policy.purpose === "sales_follow_up",
            )!;
          // Publication for another Business shares the global policy lock, without needing the blocked Business lock.
          await f.eligibility.publishPolicy(f.credentials, other.id, {
            expectedVersion: p.version,
            policy: {
              ...p.policy,
              enabled: false,
              rationale: "Policy restricted before external dispatch",
            },
          });
          changed = Promise.resolve();
        }
        if (restriction !== "market_policy") await waitForBlocked(2);
        await gate.query("COMMIT");
        await changed;
        expect(await dispatch).toMatchObject({
          state: "cancelled",
          reason:
            restriction === "evidence_withdrawal"
              ? "email_eligibility_unknown"
              : "email_eligibility_blocked",
        });
        expect(f.effects).toHaveLength(0);
        const state = await f.eligibility.workspace(
          f.credentials,
          f.businessId,
        );
        expect(
          state.evaluations.some(
            (e) => e.action.id === a.id && e.status !== "allowed",
          ),
        ).toBe(true);
        expect(
          await f.control.read(f.credentials, f.businessId, f.need.id),
        ).toMatchObject({
          state: "automation",
          ownerId: f.actor.userId,
          version: 2,
        });
      } finally {
        await gate.query("ROLLBACK");
        gate.release();
        await h.admin.query(
          "DROP TRIGGER test_eligibility_commit_barrier ON opportunity_due_action; DROP FUNCTION test_eligibility_commit_barrier()",
        );
        if (restriction === "market_policy") {
          const ws = await f.eligibility.workspace(f.credentials, f.businessId),
            p = ws.policies.find(
              (p) => p.policy.purpose === "sales_follow_up",
            )!;
          await f.eligibility.publishPolicy(f.credentials, f.businessId, {
            expectedVersion: p.version,
            policy: {
              ...p.policy,
              enabled: true,
              rationale:
                "Restore synthetic test policy after restriction scenario",
            },
          });
        }
      }
    });
  it("honors inclusive effective time, preserves prior started effects, and applies only the configured recipient/Opportunity scope", async () => {
    const f = await fixture();
    const stopAt = "2026-11-05T09:05:00Z";
    await f.eligibility.suppress(
      f.credentials,
      f.businessId,
      stop(f, {
        scope: "opportunity_outreach",
        opportunityId: f.need.id,
        effectiveAt: stopAt,
      }),
    );
    h.clock.set("2026-11-05T09:04:59Z");
    const before = await f.queue();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, before.id),
    ).toMatchObject({ state: "dispatched" });
    const queued = await f.queue();
    h.clock.set(stopAt);
    expect(
      await f.control.dispatch(f.credentials, f.businessId, queued.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_blocked",
    });
    expect(f.effects).toHaveLength(1);
    const other = await fixture();
    const a = await other.queue();
    expect(
      await other.control.dispatch(other.credentials, other.businessId, a.id),
    ).toMatchObject({ state: "dispatched" });
  });
  it("waits for a legitimately started external effect before committing a new opt-out, then blocks later sends without replay", async () => {
    const f = await fixture(),
      a = await f.queue();
    let started!: () => void, finish!: () => void;
    const ready = new Promise<void>((r) => {
        started = r;
      }),
      done = new Promise<void>((r) => {
        finish = r;
      });
    f.setEffect(async (action) => {
      f.effects.push(action);
      started();
      await done;
    });
    const sending = f.control.dispatch(f.credentials, f.businessId, a.id);
    await ready;
    const restriction = f.eligibility.suppress(
      f.credentials,
      f.businessId,
      stop(f),
    );
    try {
      await waitForBlocked(1);
    } finally {
      finish();
    }
    expect(await sending).toMatchObject({ state: "dispatched" });
    await restriction;
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({ state: "dispatched" });
    const next = await f.queue();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, next.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "email_eligibility_blocked",
    });
    expect(f.effects).toHaveLength(1);
  });
  it("rejects purpose/allow overrides, foreign actors/actions/evidence, unsafe opt-out identity and policy edits by ordinary Business owners; HTTP diagnostics stay safe", async () => {
    const f = await fixture(),
      other = await fixture(false),
      a = await f.queue();
    await expect(
      other.eligibility.evaluate(other.credentials, other.businessId, {
        kind: "opportunity",
        id: a.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.eligibility.workspace(other.credentials, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.eligibility.evaluate(f.credentials, f.businessId, {
        kind: "opportunity",
        id: a.id,
        allow: true,
        purpose: "inquiry_response",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const ws = await f.eligibility.workspace(f.credentials, f.businessId),
      policy = ws.policies[0].policy;
    await expect(
      other.eligibility.publishPolicy(other.credentials, other.businessId, {
        expectedVersion: 0,
        policy,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.eligibility.saveRecipient(f.credentials, f.businessId, {
        expectedVersion: 1,
        facts: {
          ...ws.recipients[0].facts,
          permissions: [
            {
              kind: "consent",
              purpose: "sales_follow_up",
              policyId: ws.policies.find(
                (p) => p.policy.purpose === "sales_follow_up",
              )!.id,
              opportunityId: other.need.id,
              reference: "Foreign evidence",
              observedAt: h.clock.now().toISOString(),
              validUntil: "2027-01-01T00:00:00Z",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.inbox.capture(f.credentials, f.businessId, f.connection.id, {
        eventId: "spoof",
        messageRef: "spoof",
        conversationRef: "thread",
        replyToMessageRef: "inquiry",
        senderRef: "foreign@example.net",
        senderName: "Buyer",
        kind: "opt_out",
        subject: "Stop",
        text: "Unsubscribe",
        occurredAt: h.clock.now().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const diagnostics: unknown[] = [];
    const http = createEmailEligibilityHttp({
      application: f.eligibility,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const headers = new Headers(f.credentials);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    const response = await http.post(
      new Request("http://localhost:3000/api", {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: "evaluate",
          input: {
            kind: "opportunity",
            id: a.id,
            allow: true,
            secret: "sensitive-provider-token",
          },
        }),
      }),
      f.businessId,
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(
      "sensitive-provider-token",
    );
    expect(JSON.stringify(diagnostics)).not.toContain(
      "sensitive-provider-token",
    );
    const accepted = await http.post(
      new Request("http://localhost:3000/api", {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: "evaluate",
          input: { kind: "opportunity", id: a.id },
        }),
      }),
      f.businessId,
    );
    expect(accepted.status).toBe(200);
    const body: unknown = await accepted.json();
    const envelope = await http.get(
      new Request("http://localhost:3000/api", { headers: f.credentials }),
      f.businessId,
    );
    expect(envelope.status).toBe(200);
    const data: unknown = await envelope.json();
    expect(
      z.object({ data: emailEligibilityWorkspaceSchema }).safeParse(data)
        .success,
    ).toBe(true);
    expect(JSON.stringify(body)).toContain('"status":"allowed"');
    const replay = stop(f);
    const id = await f.eligibility.suppress(
      f.credentials,
      f.businessId,
      replay,
    );
    expect(
      await f.eligibility.suppress(f.credentials, f.businessId, replay),
    ).toBe(id);
    await expect(
      f.eligibility.suppress(f.credentials, f.businessId, {
        ...replay,
        scope: "recipient_email",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
