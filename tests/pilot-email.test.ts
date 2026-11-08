import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { configureEmailFixture } from "./support/email-eligibility";
import { readySender, fixtureMailBinding } from "./support/senders";

describe("Real approved inquiry email under a bounded pilot", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  it("dispatches the selected action once, fences another selected action at the approved time bound and rejects an unselected action without native I/O", async () => {
    const db = runtimeDatabase(h.runtime),
      calls: string[] = [],
      actions: string[] = [];
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(db),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(db),
      clock: h.clock,
    });
    const app = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(db, h.clock),
      clock: h.clock,
      provider: {
        emailIdentity: fixtureMailBinding,
        channels: ["email"],
        dispatch: async (a) => {
          calls.push(a.actionId);
        },
      },
    });
    const s = await pilotFixture(
      h,
      { cashLimitMinor: "10", spendLimitMinor: "10", timeLimitSeconds: 2 },
      async (native) => {
        const c = native.f.owner,
          b = native.f.business.id,
          actor = await h.authenticate(c);
        const connection = await inbox.addConnection(c, b, {
          label: "Selected imported inquiry",
          channel: "email",
          conversationRefs: [],
          manualRepliesObservable: true,
        });
        const sender = await readySender(h, c, b, connection.id, {
          origin: "customer_domain",
        });
        const policy = await authority.workspace(c, b);
        policy.policy.prices = {
          automationEnabled: true,
          approvalRequired: false,
          amountLimit: { currency: "INR", minor: "10000" },
          discountLimitBps: 0,
          escalationOwnerId: actor.userId,
        };
        await authority.save(c, b, {
          expectedVersion: policy.version,
          policy: policy.policy,
          note: "Explicit synthetic bounded inquiry price authority",
        });
        for (let i = 0; i < 3; i++) {
          await inbox.capture(c, b, connection.id, {
            eventId: `pilot-inquiry-${i}`,
            messageRef: `message-${i}`,
            conversationRef: `thread-${i}`,
            senderRef: "buyer@example.net",
            senderName: "Buyer",
            kind: "direct_inquiry",
            subject: "Steel " + i,
            text: "Please quote steel",
            occurredAt: h.clock.now().toISOString(),
          });
          const workspace = await inbox.workspace(c, b),
            conversation = workspace.conversations.find(
              (x) => x.subject === "Steel " + i,
            );
          if (!conversation) throw new Error("Fixture inquiry missing");
          const detail = await inbox.conversation(c, b, conversation.id),
            need = detail.messages[0].opportunityId;
          if (!need) throw new Error("Fixture purchasing need missing");
          await app.change(c, b, need, {
            command: "takeover",
            expectedVersion: 0,
            reason: "Explicit fixture owner assignment",
            nextAction: "Review inquiry",
          });
          await app.change(c, b, need, {
            command: "handback",
            expectedVersion: 1,
            reason: "Explicit fixture automation approval",
            nextAction: "Bounded inquiry response",
          });
          const email = await configureEmailFixture(h, c, b, need);
          const action = await app.queue(c, b, need, {
            messageId: detail.messages[0].id,
            evaluation: {
              action: "prices",
              amount: { currency: "INR", minor: "500" },
              discountBps: 0,
            },
            dueAt: h.clock.now().toISOString(),
          });
          actions.push(action.id);
          if (i === 2)
            return {
              senders: sender.app,
              email,
              authority,
              plan: {
                capabilities: ["inquiry_email"],
                senderId: sender.identity.id,
                mailboxId: connection.id,
                emailActions: actions
                  .slice(0, 2)
                  .map((id) => ({ kind: "opportunity", id })),
                ceilings: {
                  discovery: null,
                  mailbox: null,
                  calendar: null,
                  automation: {
                    cashMinor: "1",
                    spendMinor: "1",
                    seconds: 1,
                    globalSpendInrMicros: null,
                    evidence: "fixture:explicit-per-dispatch-upper-bound",
                  },
                },
              },
            };
        }
        throw new Error("Fixture action preparation incomplete");
      },
    );
    const b = s.f.business.id,
      c = s.f.owner;
    expect(
      (
        await s.pilots.preflight(c, b, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.filter((g) => !g.ready),
    ).toEqual([]);
    await s.pilots.activate(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    expect(await app.dispatch(c, b, actions[2])).toMatchObject({
      state: "cancelled",
      reason: "pilot_scope_changed",
    });
    expect((await s.pilots.workspace(c, b)).pilots[0].usage.seconds).toBe(0);
    expect(await app.dispatch(c, b, actions[0])).toMatchObject({
      state: "dispatched",
    });
    expect(calls).toEqual([actions[0]]);
    await s.pilots.effort(c, b, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
      kind: "support",
      seconds: 1,
      cashMinor: "0",
      spendMinor: "0",
      occurredAt: h.clock.now().toISOString(),
      evidence: "fixture:actual-follow-up-effort",
    });
    expect(await app.dispatch(c, b, actions[1])).toMatchObject({
      state: "cancelled",
      reason: "paid_automation_unavailable",
    });
    expect(calls).toEqual([actions[0]]);
    expect((await s.pilots.workspace(c, b)).pilots[0].usage.seconds).toBe(2);
  });
});
