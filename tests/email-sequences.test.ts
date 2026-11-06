import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { sequenceWorkspaceSchema } from "../src/models/email-sequences";
import { createHarness } from "./support/harness";
import { campaignFixture } from "./support/campaigns";
import { eligibilityApplication } from "./support/email-eligibility";
import { runtimeDatabase } from "../src/db/runtime";
import { createEmailSequenceRepository } from "../src/db/email-sequence-repository";
import { createEmailSequenceApplication } from "../src/application/email-sequences";
import { deterministicSequenceMail } from "./support/sequence-mail";
import type {
  SequenceWork,
  SequenceTiming,
  SequenceMailProvider,
} from "../src/models/email-sequences";
import { createEmailSequenceHttp } from "../src/http/email-sequences";
import { unavailableSequenceMail } from "../src/email-sequences/provider";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createGmailConnection } from "../src/gmail/connection";
import { createGmailApplication } from "../src/application/gmail";
import { createGmailProvider } from "../src/gmail/provider";
import { gmailSendScope } from "../src/models/gmail";
import { gmailFixture } from "./support/gmail";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";

describe("Approved email sequences at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  async function setup(multiple = false, at?: string, timing?: SequenceTiming) {
    const f = await campaignFixture(h, { multipleSources: multiple, at });
    const draft = {
      ...f.draft(),
      timing: {
        timeZone: "America/New_York",
        weekdays: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        dst: "compatible",
        missed: "next_window",
      },
    };
    if (timing) draft.timing = timing;
    if (multiple) draft.recipients = draft.recipients.slice(0, 2);
    const revision = (await f.app.save(f.owner, f.business.id, draft))
      .campaigns[0].revisions[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(revision),
      decision: "approved",
      note: "Reviewed exact sequence and local timing",
    });
    const eligibility = eligibilityApplication(h);
    await h.admin.query(
      "insert into platform_operator(user_id,email_policy) values ($1,true) on conflict(user_id) do update set email_policy=true",
      [(await h.authenticate(f.owner)).userId],
    );
    for (const purpose of ["sales_outreach", "sales_follow_up"] as const) {
      const workspace = await eligibility.workspace(f.owner, f.business.id);
      const current = workspace.policies.find(
        (p) => p.policy.purpose === purpose,
      );
      if (!current || !current.policy.enabled)
        await eligibility.publishPolicy(f.owner, f.business.id, {
          expectedVersion: current?.version ?? 0,
          policy: {
            market: "US",
            recipientClass: "corporate",
            purpose,
            enabled: true,
            effectiveAt: "2026-11-01T00:00:00Z",
            validUntil: "2028-01-01T00:00:00Z",
            acceptedEvidence: ["consent"],
            requiredContent: [],
            incomingOptOutScope: "recipient_outreach",
            sources: ["https://policy.example/synthetic"],
            rationale: "Explicit synthetic policy, never production permission",
          },
        });
    }
    const policies = (await eligibility.workspace(f.owner, f.business.id))
      .policies;
    for (const recipient of revision.snapshot.recipients)
      await eligibility.saveRecipient(f.owner, f.business.id, {
        expectedVersion: 0,
        facts: {
          recipient: recipient.address,
          market: "US",
          recipientClass: "corporate",
          reference: "Synthetic fixture",
          effectiveAt: h.clock.now().toISOString(),
          validUntil: "2028-01-01T00:00:00Z",
          permissions: policies.map((p) => ({
            kind: "consent",
            purpose: p.policy.purpose,
            policyId: p.id,
            opportunityId: null,
            prospectId: recipient.prospectId,
            reference: "Explicit synthetic prospect permission",
            observedAt: h.clock.now().toISOString(),
            validUntil: "2028-01-01T00:00:00Z",
          })),
        },
      });
    const mail = deterministicSequenceMail(h.clock);
    const queued: { work: SequenceWork; dueAt: Date }[] = [];
    const queue = {
      fail: false,
      cancelFails: false,
      failAfterAccept: false,
      ids: new Map<string, string>(),
      async enqueue(work: SequenceWork, dueAt: Date) {
        if (this.fail) throw new Error("private-trigger-credential-error");
        const key = `${work.actionId}:${work.generation}`;
        let id = this.ids.get(key);
        if (!id) {
          id = `fixture-run-${this.ids.size + 1}`;
          this.ids.set(key, id);
          queued.push({ work, dueAt });
        }
        if (this.failAfterAccept)
          throw new Error("private-trigger-response-lost");
        return id;
      },
      async cancel() {
        if (this.cancelFails) throw new Error("private-cancellation-error");
      },
    };
    const newApp = (provider: SequenceMailProvider = mail.provider) =>
      createEmailSequenceApplication({
        authenticate: h.access.authenticateForWork,
        repository: createEmailSequenceRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        clock: h.clock,
        provider,
        queue,
      });
    const app = newApp();
    await app.configure(f.owner, f.business.id, {
      expectedVersion: 0,
      policy: {
        enabled: true,
        adapterKey: mail.provider.key,
        mode: "fixture",
        periodStart: "2026-11-01T00:00:00Z",
        periodEnd: "2028-01-01T00:00:00Z",
        maxProviderCalls: 10,
        minIntervalSeconds: 60,
        note: "Explicit fixture allowance and pacing",
      },
    });
    return { ...f, revision, mail, queued, app, newApp, eligibility, queue };
  }
  it("starts explicitly, retains jobs across restart and sends only the immutable approved messages within local timing", async () => {
    const f = await setup();
    expect(f.queued).toHaveLength(0);
    const http = createEmailSequenceHttp({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    const response = await http.post(
      new Request("http://localhost:3000/api/sequence", {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(f.owner),
          origin: "http://localhost:3000",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ command: "start", input: f.ref(f.revision) }),
      }),
      f.business.id,
    );
    expect(response.status).toBe(200);
    const raw: unknown = await response.json();
    const state = z
      .object({ success: z.literal(true), data: sequenceWorkspaceSchema })
      .parse(raw).data;
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "pending",
      dueAt: "2026-11-05T14:00:00.000Z",
      queueState: "enqueued",
    });
    expect(f.mail.effects).toHaveLength(0);
    const first = f.queued.shift()!;
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.newApp().execute(first.work);
    expect(f.mail.effects).toMatchObject([
      {
        recipient: "purchasing@fabricator.example",
        subject: "Steel supply",
        body: "We supply galvanized steel. Is this relevant to your business?",
      },
    ]);
    const after = await f.newApp().workspace(f.owner, f.business.id);
    expect(after.runs[0].recipients[0].actions[0].state).toBe("accepted");
    expect(after.runs[0].recipients[0].actions[1].dueAt).toBe(
      "2026-11-09T14:00:00.000Z",
    );
    await f.newApp().execute(first.work);
    expect(f.mail.effects).toHaveLength(1);
  });
  it("cancels unanswered reminders on an exact reply immediately before they fall due", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(f.queued.shift()!.work);
    const reminder = f.queued.shift()!;
    h.clock.set("2026-11-09T13:59:59Z");
    await h.reverifyAuthenticator(f.owner);
    const before = await f.app.workspace(f.owner, f.business.id),
      sent = before.runs[0].recipients[0].actions[0].receipt!;
    await f.inbox.capture(
      f.owner,
      f.business.id,
      f.sender.route.configuration.inboxConnectionId,
      {
        eventId: "sequence-reply",
        messageRef: "buyer-response",
        conversationRef: "reply-mailbox-local-thread",
        senderRef: sent.recipient,
        senderName: "Purchasing team",
        kind: "buying_interest_reply",
        replyToMessageRef: sent.messageRef,
        subject: "Re: Steel supply",
        text: "Yes, please share the product specification",
        occurredAt: h.clock.now().toISOString(),
      },
    );
    h.clock.set("2026-11-09T14:00:00Z");
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.newApp().execute(reminder.work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[1]).toMatchObject({
      state: "cancelled",
      reason: "buyer_replied",
    });
    expect(f.mail.effects).toHaveLength(1);
    const inbox = await f.inbox.workspace(f.owner, f.business.id);
    expect(inbox.opportunities).toHaveLength(1);
    expect(inbox.opportunities[0]).toMatchObject({
      id: before.runs[0].recipients[0].opportunityId,
      stage: "inquiry",
    });
  });
  it("honors an Opportunity-scoped opt-out at dispatch without treating approval as permission", async () => {
    const f = await setup(),
      state = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const r = state.runs[0].recipients[0];
    await f.eligibility.suppress(f.owner, f.business.id, {
      requestKey: crypto.randomUUID(),
      recipient: r.recipient,
      scope: "opportunity_outreach",
      opportunityId: r.opportunityId,
      effectiveAt: h.clock.now().toISOString(),
      reference: "Recipient opted out of this purchasing need",
    });
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(f.queued.shift()!.work);
    expect(f.mail.effects).toHaveLength(0);
  });
  it("pauses only the taken-over Opportunity, keeps another recipient running, and rechecks on explicit handback and resume", async () => {
    const f = await setup(true),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const control = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
      provider: {
        channels: [],
        async dispatch() {
          throw new Error("Unexpected control transport");
        },
      },
    });
    const recipient = started.runs[0].recipients[0];
    await control.change(f.owner, f.business.id, recipient.opportunityId, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Salesperson handling this need",
      nextAction: "Review with buyer",
    });
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "paused",
      reason: "human_control",
    });
    expect(state.runs[0].recipients[1].actions[0].state).toBe("pending");
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    for (const job of f.queued.splice(0)) await f.app.execute(job.work);
    expect(f.mail.effects.map((e) => e.recipient)).toEqual([
      state.runs[0].recipients[1].recipient,
    ]);
    await control.change(f.owner, f.business.id, recipient.opportunityId, {
      command: "handback",
      expectedVersion: 1,
      reason: "Reviewed and returning control",
      nextAction: "Resume approved sequence with current checks",
    });
    await f.app.command(f.owner, f.business.id, {
      runId: state.runs[0].id,
      expectedVersion: state.runs[0].version,
      command: "resume",
      note: "Explicitly resume after handback",
    });
    h.clock.set("2026-11-05T14:01:00Z");
    const resumed = f.queued.find(
      (j) => j.work.actionId === recipient.actions[0].id,
    )!;
    await f.newApp().execute(resumed.work);
    expect(f.mail.effects.map((e) => e.recipient)).toContain(
      recipient.recipient,
    );
  });
  it("allows one logical effect across concurrent workers and duplicate queued deliveries", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    const work = f.queued.shift()!.work;
    await Promise.all([
      f.app.execute(work),
      f.newApp().execute(work),
      f.newApp().execute(work),
    ]);
    expect(f.mail.effects).toHaveLength(1);
    expect((await f.app.workspace(f.owner, f.business.id)).usage.reserved).toBe(
      1,
    );
  });
  it("retains an unknown timeout and its allowance when reconciliation cannot prove non-acceptance", async () => {
    const f = await setup(),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    f.mail.outcome = "timeout";
    f.mail.reconciliation = "unknown";
    const work = f.queued.shift()!.work;
    await f.app.execute(work);
    await f.newApp().execute(work);
    await f.app.command(f.owner, f.business.id, {
      runId: started.runs[0].id,
      expectedVersion: 1,
      command: "resume",
      note: "Cannot silently retry an unknown call",
    });
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
    expect(state.usage.reserved).toBe(1);
    expect(f.mail.calls).toBe(1);
    expect(f.mail.effects).toHaveLength(0);
    expect(state.runs[0].recipients[0].actions[1].state).toBe("waiting");
  });
  it("persists throttling and retries no earlier than provider Retry-After without multiplying approved attempts", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    f.mail.outcome = "rate_limited";
    await f.app.execute(f.queued.shift()!.work);
    const retry = f.queued.shift()!;
    expect(retry.dueAt.toISOString()).toBe("2026-11-05T14:02:00.000Z");
    await f.app.execute(retry.work);
    expect(f.mail.calls).toBe(1);
    h.clock.set("2026-11-05T14:02:00Z");
    f.mail.outcome = "accepted";
    await f.app.execute(retry.work);
    expect(f.mail.effects).toHaveLength(1);
    const reminder = f.queued.shift()!;
    h.clock.set("2026-11-09T14:02:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(reminder.work);
    expect(f.mail.calls).toBe(2);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[1]).toMatchObject({
      state: "paused",
      reason: "attempt_cap",
    });
  });
  it.each([
    [
      "spring gap",
      "2027-03-13T12:00:00Z",
      "02:30",
      "04:00",
      "2027-03-14T07:30:00.000Z",
    ],
    [
      "fall repeated time",
      "2027-11-06T12:00:00Z",
      "01:30",
      "02:30",
      "2027-11-07T05:30:00.000Z",
    ],
  ])(
    "persists the approved local window through the %s",
    async (_name, at, startTime, endTime, expected) => {
      const f = await setup(false, at, {
        timeZone: "America/New_York",
        weekdays: [7],
        startTime,
        endTime,
        dst: "compatible",
        missed: "next_window",
      });
      await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      expect(f.queued[0].dueAt.toISOString()).toBe(expected);
      expect(
        (await f.newApp().workspace(f.owner, f.business.id)).runs[0]
          .recipients[0].actions[0].dueAt,
      ).toBe(expected);
    },
  );
  it("sends a full bounded sequence, schedules from actual acceptance and never catches up overdue steps in a burst", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const initial = f.queued.shift()!;
    h.clock.set("2026-11-06T23:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(initial.work);
    expect(f.mail.effects).toHaveLength(0);
    expect(f.queued[0].dueAt.toISOString()).toBe("2026-11-09T14:00:00.000Z");
    h.clock.set("2026-11-09T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(f.queued.shift()!.work);
    expect(f.mail.effects).toHaveLength(1);
    const reminder = f.queued.shift()!;
    expect(reminder.dueAt.toISOString()).toBe("2026-11-11T14:00:00.000Z");
    h.clock.set("2026-11-11T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.newApp().execute(reminder.work);
    expect(f.mail.effects.map((e) => e.subject)).toEqual([
      "Steel supply",
      "Steel supply follow-up",
    ]);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].state).toBe("completed");
    expect(state.usage.reserved).toBe(2);
    await f.app.execute(reminder.work);
    expect(f.mail.effects).toHaveLength(2);
  });
  it("recovers after provider acceptance followed by a failed database receipt commit", async () => {
    const f = await setup(),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    const work = f.queued.shift()!.work;
    await h.admin.query(
      `create function sequence_receipt_failure() returns trigger language plpgsql as $$ begin if NEW.kind='provider_accepted' then raise exception 'synthetic receipt commit failure'; end if; return NEW; end $$; create trigger sequence_receipt_failure before insert on email_sequence_event for each row execute function sequence_receipt_failure()`,
    );
    try {
      await expect(f.app.execute(work)).rejects.toThrow();
    } finally {
      await h.admin.query(
        "drop trigger sequence_receipt_failure on email_sequence_event; drop function sequence_receipt_failure()",
      );
    }
    expect(f.mail.effects).toHaveLength(1);
    const lost = await f.app.workspace(f.owner, f.business.id);
    expect(lost.runs[0].recipients[0].actions[0].state).toBe("committed");
    await f.newApp().execute(work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("accepted");
    expect(state.usage.reserved).toBe(1);
    expect(f.mail.effects).toHaveLength(1);
    expect(state.runs[0].id).toBe(started.runs[0].id);
  });
  it.each(["attempt_reserved", "dispatch_boundary"])(
    "keeps a crash at %s from causing a blind replay",
    async (kind) => {
      const f = await setup();
      await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      h.clock.set("2026-11-05T14:00:00Z");
      await h.reverifyAuthenticator(f.owner);
      await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
        expectedVersion: f.sender.identity.version,
      });
      const work = f.queued.shift()!.work;
      await h.admin.query(
        `create function sequence_crash() returns trigger language plpgsql as $$ begin if NEW.kind='${kind}' then raise exception 'synthetic worker crash'; end if; return NEW; end $$; create trigger sequence_crash before insert on email_sequence_event for each row execute function sequence_crash()`,
      );
      try {
        await expect(f.app.execute(work)).rejects.toThrow();
      } finally {
        await h.admin.query(
          "drop trigger sequence_crash on email_sequence_event; drop function sequence_crash()",
        );
      }
      expect(f.mail.calls).toBe(0);
      await f.newApp().execute(work);
      const state = await f.app.workspace(f.owner, f.business.id);
      if (kind === "attempt_reserved") {
        expect(f.mail.effects).toHaveLength(1);
        expect(state.usage.reserved).toBe(1);
      } else {
        expect(f.mail.effects).toHaveLength(0);
        expect(state.usage.reserved).toBe(1);
        expect(state.runs[0].recipients[0].actions[0].state).toBe("committed");
      }
    },
  );
  async function restrictionWins(
    f: Awaited<ReturnType<typeof setup>>,
    work: SequenceWork,
    restriction: () => Promise<unknown>,
  ) {
    const latch = await h.admin.connect();
    await latch.query("select pg_advisory_lock(340034)");
    await h.admin.query(
      "create function sequence_dispatch_barrier() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(340034); return NEW; end $$; create trigger sequence_dispatch_barrier before insert on email_sequence_event for each row when (NEW.kind='attempt_reserved') execute function sequence_dispatch_barrier()",
    );
    const worker = f
      .newApp()
      .execute(work)
      .then(
        () => null,
        (error) => error,
      );
    try {
      await vi.waitFor(async () =>
        expect(
          (
            await h.admin.query(
              "select count(*)::int n from pg_locks where locktype='advisory' and objid=340034 and not granted",
            )
          ).rows[0].n,
        ).toBe(1),
      );
      const restricting = restriction();
      await vi.waitFor(async () =>
        expect(
          (
            await h.admin.query(
              "select count(*)::int n from pg_locks where locktype='advisory' and objid<>340034 and not granted",
            )
          ).rows[0].n,
        ).toBeGreaterThan(0),
      );
      await latch.query("select pg_advisory_unlock(340034)");
      await restricting;
      const failure = await worker;
      if (failure) throw failure;
    } finally {
      await latch.query("select pg_advisory_unlock(340034)");
      latch.release();
      await h.admin.query(
        "drop trigger sequence_dispatch_barrier on email_sequence_event; drop function sequence_dispatch_barrier()",
      );
    }
  }
  it.each([
    "new suppression",
    "takeover",
    "sender health",
    "reply visibility",
    "market policy",
    "allowance revision",
    "authority revision",
    "reach change",
  ])(
    "makes a %s that wins after reservation fence the concrete provider boundary",
    async (kind) => {
      const f = await setup(),
        started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      h.clock.set("2026-11-05T14:00:00Z");
      await h.reverifyAuthenticator(f.owner);
      await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
        expectedVersion: f.sender.identity.version,
      });
      const policy =
        kind === "market policy"
          ? (
              await f.eligibility.workspace(f.owner, f.business.id)
            ).policies.find((p) => p.policy.purpose === "sales_outreach")!
          : null;
      const authority = createCommercialAuthorityApplication({
        authenticate: h.authenticate,
        authenticatePrivileged: h.access.authenticatePrivileged,
        repository: createCommercialAuthorityRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
      });
      const authorityState =
        kind === "authority revision"
          ? await authority.workspace(f.owner, f.business.id)
          : null;
      let releaseObservation: () => void = () => {};
      const observationBarrier = new Promise<void>((resolve) => {
        releaseObservation = resolve;
      });
      let inspected = false;
      let observation: Promise<unknown> | undefined;
      if (kind === "sender health" || kind === "reply visibility") {
        f.sender.fixture.changes[
          kind === "sender health" ? "health" : "reply_capture"
        ] = "revoked";
        f.sender.fixture.intercept = async () => {
          inspected = true;
          await observationBarrier;
        };
        observation = f.sender.app.check(
          f.owner,
          f.business.id,
          f.sender.identity.id,
          { expectedVersion: f.sender.identity.version },
        );
        await vi.waitFor(() => expect(inspected).toBe(true));
      }
      await restrictionWins(f, f.queued.shift()!.work, async () => {
        if (kind === "new suppression")
          return f.eligibility.suppress(f.owner, f.business.id, {
            requestKey: crypto.randomUUID(),
            recipient: started.runs[0].recipients[0].recipient,
            scope: "recipient_outreach",
            opportunityId: null,
            effectiveAt: h.clock.now().toISOString(),
            reference: "Opt-out arrived before dispatch",
          });
        if (kind === "takeover") {
          const control = createOpportunityApplication({
            authenticate: h.authenticate,
            authenticateForWork: h.access.authenticateForWork,
            repository: createOpportunityRepository(
              runtimeDatabase(h.runtime),
              h.clock,
            ),
            clock: h.clock,
            provider: { channels: [], async dispatch() {} },
          });
          return control.change(
            f.owner,
            f.business.id,
            started.runs[0].recipients[0].opportunityId,
            {
              command: "takeover",
              expectedVersion: 0,
              reason: "Manual handling wins before send",
              nextAction: "Review personally",
            },
          );
        }
        if (kind === "market policy") {
          const p = policy!;
          return f.eligibility.publishPolicy(f.owner, f.business.id, {
            expectedVersion: p.version,
            policy: {
              ...p.policy,
              enabled: false,
              rationale: "Synthetic market disabled before dispatch",
            },
          });
        }
        if (kind === "allowance revision")
          return f.app.configure(f.owner, f.business.id, {
            expectedVersion: 1,
            policy: {
              ...started.policy!.configuration,
              enabled: false,
              note: "Operator withdrew the allowance",
            },
          });
        if (kind === "authority revision")
          return authority.save(f.owner, f.business.id, {
            expectedVersion: authorityState!.version,
            policy: authorityState!.policy,
            note: "Commercial authority reviewed again before dispatch",
          });
        if (kind === "reach change") {
          const client = await h.admin.connect();
          try {
            await client.query("begin");
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1,0))",
              [f.business.id],
            );
            await client.query(
              "update discovery_configuration set policy=jsonb_set(policy,'{activeMarkets}','[]'::jsonb) where business_id=$1",
              [f.business.id],
            );
            await client.query("commit");
          } finally {
            client.release();
          }
          return;
        }
        releaseObservation();
        return observation;
      });
      expect(f.mail.calls).toBe(0);
      expect(f.mail.effects).toHaveLength(0);
      const state = await f.app.workspace(f.owner, f.business.id);
      expect(state.runs[0].recipients[0].actions[0].state).toBe(
        kind === "new suppression" ? "cancelled" : "paused",
      );
      expect(state.usage.reserved).toBe(1);
    },
  );
  it("stops a reminder when a non-engagement reply wins after its durable reservation", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.app.execute(f.queued.shift()!.work);
    const receipt = (await f.app.workspace(f.owner, f.business.id)).runs[0]
      .recipients[0].actions[0].receipt!;
    h.clock.set("2026-11-09T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await restrictionWins(f, f.queued.shift()!.work, () =>
      f.inbox.capture(
        f.owner,
        f.business.id,
        f.sender.route.configuration.inboxConnectionId,
        {
          eventId: "automatic-reply",
          messageRef: "automatic-reply",
          conversationRef: receipt.threadRef,
          senderRef: receipt.recipient,
          senderName: "Buyer",
          kind: "other_reply",
          replyToMessageRef: receipt.messageRef,
          subject: "Re: Steel supply",
          text: "Thank you. This is an automatic acknowledgement.",
          occurredAt: h.clock.now().toISOString(),
        },
      ),
    );
    expect(f.mail.calls).toBe(1);
    expect(f.mail.effects).toHaveLength(1);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[1],
    ).toMatchObject({ state: "cancelled", reason: "buyer_replied" });
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).buyers,
    ).toHaveLength(0);
  });
  it.each(["queue unavailable", "queue accepted but response lost"])(
    "recovers persisted work after %s without duplicate logical mail",
    async (failure) => {
      const f = await setup();
      f.queue.fail = failure === "queue unavailable";
      f.queue.failAfterAccept = failure !== "queue unavailable";
      const started = await f.app.start(
        f.owner,
        f.business.id,
        f.ref(f.revision),
      );
      expect(started.runs[0].recipients[0].actions[0]).toMatchObject({
        state: "pending",
        queueState: "failed",
        reason: "queue_unavailable",
      });
      f.queue.fail = false;
      f.queue.failAfterAccept = false;
      await f.newApp().recoverDue();
      expect(f.queued).toHaveLength(1);
      h.clock.set("2026-11-05T14:00:00Z");
      await h.reverifyAuthenticator(f.owner);
      await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
        expectedVersion: f.sender.identity.version,
      });
      await f.newApp().execute(f.queued.shift()!.work);
      expect(f.mail.effects).toHaveLength(1);
    },
  );
  it("keeps cancellation safe when the provider queue cannot cancel and retains sent history", async () => {
    const f = await setup(),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const work = f.queued.shift()!.work;
    f.queue.cancelFails = true;
    await f.app.command(f.owner, f.business.id, {
      runId: started.runs[0].id,
      expectedVersion: 1,
      command: "cancel",
      note: "Owner permanently stopped this campaign",
    });
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    await f.newApp().execute(work);
    expect(f.mail.effects).toHaveLength(0);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].state).toBe("cancelled");
    expect(
      state.runs[0].history.find((e) => e.kind === "cancelled")?.note,
    ).toBe("Owner permanently stopped this campaign");
    await expect(
      f.app.command(f.owner, f.business.id, {
        runId: started.runs[0].id,
        expectedVersion: 2,
        command: "resume",
        note: "Cannot revive cancelled work",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("validates queued capabilities and actor/Business scope and keeps HTTP diagnostics private", async () => {
    const f = await setup(),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision)),
      work = f.queued[0].work;
    const outsider = await h.signIn("sequence-outsider@example.com"),
      other = await h.application.createBusiness(outsider, {
        name: "Other Business",
        offering: "Tools",
        homeMarket: "",
        website: "",
      });
    await expect(
      f.app.workspace(outsider, f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.app.command(outsider, other.id, {
        runId: started.runs[0].id,
        expectedVersion: 1,
        command: "cancel",
        note: "Forged cross-Business run",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.app.execute({ ...work, businessId: other.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.app.execute({ ...work, key: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.app.execute({ ...work, recipient: "injected@example.com" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      f.app.configure(outsider, other.id, {
        expectedVersion: 0,
        policy: (await f.app.workspace(f.owner, f.business.id)).policy!
          .configuration,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const diagnostics: unknown[] = [];
    const http = createEmailSequenceHttp({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const response = await http.post(
      new Request("http://localhost:3000/api/sequence", {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(outsider),
          origin: "http://localhost:3000",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          command: "start",
          input: f.ref(f.revision),
          providerCredential: "private-marker",
        }),
      }),
      f.business.id,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private-marker");
    expect(JSON.stringify(diagnostics)).not.toContain("private-marker");
    expect(f.mail.effects).toHaveLength(0);
    await expect(
      f
        .newApp(unavailableSequenceMail)
        .start(f.owner, f.business.id, f.ref(f.revision)),
    ).rejects.toMatchObject({ code: "CHANNEL_SETUP_REQUIRED" });
  });
  it("pauses a queued action whose authorizing session was revoked and preserves reviewable history", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const email = (await h.access.primary(f.owner)).user.email;
    await h.signOut(f.owner);
    await expect(
      f.newApp().execute(f.queued.shift()!.work),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const current = await h.signIn(email);
    const state = await f.app.workspace(current, f.business.id);
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "paused",
      reason: "authorization_changed",
    });
    expect(f.mail.calls).toBe(0);
  });
  it.each([
    "Please stop emailing me",
    "Wrong person",
    "Could you send a quote for 500 kg?",
  ])(
    "retains exact native Sent-folder and reply observations for %s without inventing engagement",
    async (replyText) => {
      const f = await setup(),
        database = runtimeDatabase(h.runtime);
      h.clock.set("2026-11-05T14:00:00Z");
      await h.reverifyAuthenticator(f.owner);
      await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
        expectedVersion: f.sender.identity.version,
      });
      await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      f.mail.outcome = "accepted_timeout";
      f.mail.reconciliation = "unknown";
      await f.app.execute(f.queued.shift()!.work);
      const effect = f.mail.effects[0];
      const settings = createMailboxApplication({
        authenticate: h.access.authenticateForWork,
        repository: createMailboxRepository(database, h.clock),
        clock: h.clock,
        provider: unavailableMailboxProvider,
      });
      const mailbox = await settings.save(f.owner, f.business.id, {
        id: null,
        expectedVersion: 0,
        configuration: {
          connectionId: f.sender.connection.id,
          requestedRead: true,
          requestedSend: true,
          enabled: true,
          scope: { kind: "mailbox" },
          history: null,
          salesSubjectTerms: ["steel"],
        },
      });
      const google = gmailFixture();
      google.control.scopes += ` ${gmailSendScope}`;
      const connection = createGmailConnection(database, {
        clock: h.clock,
        configuration: google.configuration,
        fetch: google.fetch,
      });
      const auth = createGmailApplication({ access: h.access, connection });
      const oauth = await auth.start(f.owner, f.business.id, mailbox.id);
      await auth.callback(f.owner, f.business.id, mailbox.id, {
        state: new URL(oauth.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      const sync = createMailboxApplication({
        authenticate: h.access.authenticateForWork,
        repository: createMailboxRepository(database, h.clock),
        clock: h.clock,
        provider: createGmailProvider(connection, h.clock),
        enqueue: async () => {},
      });
      async function synchronize() {
        const work = await sync.queue(f.owner, f.business.id, mailbox.id, {
          mode: "incremental",
        });
        let state = await sync.execute(work);
        for (let i = 0; state?.status === "partial" && i < 10; i++)
          state = await sync.execute(work);
        return state;
      }
      h.clock.set("2026-11-05T14:00:00Z");
      await h.reverifyAuthenticator(f.owner);
      await synchronize();
      const sent = google.add("outgoing1", {
        at: "2026-11-05T14:00:00Z",
        from: effect.fromAddress,
        to: effect.recipient,
        text: effect.body,
        internetId: effect.internetMessageId,
        thread: `thread-${effect.opportunityId}`,
        labels: ["SENT"],
      });
      sent.payload.headers.find((h) => h.name === "Subject")!.value =
        effect.subject;
      google.add("optout1", {
        at: "2026-11-05T14:00:01Z",
        from: effect.recipient,
        to: effect.replyTo,
        reply: effect.internetMessageId,
        thread: "reply-mailbox-local-thread",
        text: replyText,
        labels: ["INBOX"],
      });
      google.histories.set("18446744073709551630", {
        historyId: "18446744073709551631",
        history: [
          {
            id: "18446744073709551631",
            messagesAdded: [
              {
                message: {
                  id: "outgoing1",
                  threadId: `thread-${effect.opportunityId}`,
                  labelIds: ["SENT"],
                },
              },
              {
                message: {
                  id: "optout1",
                  threadId: `thread-${effect.opportunityId}`,
                  labelIds: ["INBOX"],
                },
              },
            ],
          },
        ],
      });
      h.clock.set("2026-11-05T14:00:02Z");
      expect((await synchronize())?.status).toBe("completed");
      expect(google.bodyReads).toContain("outgoing1");
      const state = await f.app.workspace(f.owner, f.business.id);
      expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
      expect(
        state.runs[0].history.find((e) => e.kind === "sent_folder_observed")
          ?.source,
      ).toMatchObject({
        mailboxId: mailbox.id,
        connectionId: f.sender.connection.id,
        internetMessageId: effect.internetMessageId,
      });
      expect(
        state.runs[0].history.some((e) => e.kind === "provider_accepted"),
      ).toBe(false);
      expect(
        (await f.eligibility.workspace(f.owner, f.business.id)).suppressions,
      ).toHaveLength(replyText.startsWith("Please stop") ? 1 : 0);
      expect(
        (await f.inbox.workspace(f.owner, f.business.id)).buyers,
      ).toHaveLength(0);
      expect(state.runs[0].recipients[0].actions[1].state).toBe("cancelled");
      expect(f.mail.effects).toHaveLength(1);
      if (!replyText.startsWith("Please stop")) {
        const observation = state.runs[0].history.find(
          (e) => e.kind === "reply_observed",
        )!;
        expect(observation.reply?.text).toBe(replyText);
        expect(observation.reviewNeeded).toBe(true);
        const input = {
          runId: state.runs[0].id,
          observationId: observation.id,
          classification: replyText.startsWith("Could")
            ? "qualifying_inquiry"
            : "other_reply",
          note: "Owner reviewed the exact captured reply",
        };
        if (replyText.startsWith("Could")) {
          const outsider = await h.signIn(
            "sequence-classification-outsider@example.com",
          );
          await expect(
            f.app.classifyReply(outsider, f.business.id, input),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          const other = await h.application.createBusiness(f.owner, {
            name: "Classification scope fixture",
            offering: "Other offering",
            homeMarket: "",
            website: "",
          });
          await expect(
            f.app.classifyReply(f.owner, other.id, input),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
          await h.team.invite(f.owner, f.business.id, {
            email: "sequence-review-sales@example.com",
            role: "salesperson",
          });
          const invitation = h.invitations.sent.at(-1)!;
          const sales = await h.signIn("sequence-review-sales@example.com");
          await h.team.accept(sales, {
            token: new URLSearchParams(
              new URL(invitation.url).hash.slice(1),
            ).get("token"),
          });
          await expect(
            f.app.classifyReply(sales, f.business.id, input),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
        const classified = await f.app.classifyReply(
          f.owner,
          f.business.id,
          input,
        );
        expect(
          classified.runs[0].history.some((e) => e.kind === "reply_classified"),
        ).toBe(true);
        const replayed = await f
          .newApp()
          .classifyReply(f.owner, f.business.id, input);
        expect(
          replayed.runs[0].history.filter((e) => e.kind === "reply_classified"),
        ).toHaveLength(1);
        expect(
          replayed.runs[0].history.find((e) => e.kind === "reply_observed")
            ?.reviewNeeded,
        ).toBe(false);
        const inbox = await f.inbox.workspace(f.owner, f.business.id);
        expect(inbox.buyers).toHaveLength(
          replyText.startsWith("Could") ? 1 : 0,
        );
        if (replyText.startsWith("Could"))
          expect(inbox.opportunities[0]).toMatchObject({
            id: effect.opportunityId,
            stage: "inquiry",
          });
        expect(f.mail.effects).toHaveLength(1);
      }
    },
  );
  it("rechecks an effective suppression time that passes while the final dispatch boundary is persisted", async () => {
    const f = await setup();
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await f.eligibility.suppress(f.owner, f.business.id, {
      requestKey: crypto.randomUUID(),
      recipient: f.revision.snapshot.recipients[0].address,
      scope: "recipient_outreach",
      opportunityId: null,
      effectiveAt: "2026-11-05T14:00:01Z",
      reference: "Future effective opt-out fixture",
    });
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    const latch = await h.admin.connect();
    await latch.query("select pg_advisory_lock(340035)");
    await h.admin.query(
      "create function sequence_time_barrier() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(340035); return NEW; end $$; create trigger sequence_time_barrier before insert on email_sequence_event for each row when (NEW.kind='dispatch_boundary') execute function sequence_time_barrier()",
    );
    const worker = f.app.execute(f.queued.shift()!.work).then(
      () => null,
      (error) => error,
    );
    try {
      await vi.waitFor(async () =>
        expect(
          (
            await h.admin.query(
              "select count(*)::int n from pg_locks where locktype='advisory' and objid=340035 and not granted",
            )
          ).rows[0].n,
        ).toBe(1),
      );
      h.clock.set("2026-11-05T14:00:02Z");
      await latch.query("select pg_advisory_unlock(340035)");
      const failure = await worker;
      if (failure) throw failure;
    } finally {
      await latch.query("select pg_advisory_unlock(340035)");
      latch.release();
      await h.admin.query(
        "drop trigger sequence_time_barrier on email_sequence_event; drop function sequence_time_barrier()",
      );
    }
    expect(f.mail.calls).toBe(0);
    expect(f.mail.effects).toHaveLength(0);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0].state,
    ).toBe("cancelled");
  });
  it("keeps unrelated workers authorized when a different team member takes over and explicitly hands back one Opportunity", async () => {
    const f = await setup(true),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await h.team.invite(f.owner, f.business.id, {
      email: "sequence-human-owner@example.com",
      role: "admin",
    });
    const invitation = h.invitations.sent.at(-1)!;
    const admin = await h.signIn("sequence-human-owner@example.com");
    await h.team.accept(admin, {
      token: new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
        "token",
      ),
    });
    const control = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
      provider: { channels: [], async dispatch() {} },
    });
    const recipient = started.runs[0].recipients[0];
    await control.change(admin, f.business.id, recipient.opportunityId, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Admin handles only this need",
      nextAction: "Review this recipient",
    });
    await control.change(admin, f.business.id, recipient.opportunityId, {
      command: "handback",
      expectedVersion: 1,
      reason: "Explicit admin handback",
      nextAction: "Resume with fresh checks",
    });
    await f.app.command(admin, f.business.id, {
      runId: started.runs[0].id,
      expectedVersion: 1,
      command: "resume",
      note: "Resume the handed-back Opportunity",
    });
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await h.reverifyAuthenticator(admin);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    const old = f.queued.splice(0);
    const other = old.find(
      (j) => j.work.actionId === started.runs[0].recipients[1].actions[0].id,
    )!;
    await f.app.execute(other.work);
    const own = old
      .filter((j) => j.work.actionId === recipient.actions[0].id)
      .at(-1)!;
    h.clock.set("2026-11-05T14:01:00Z");
    await f.app.execute(own.work);
    const state = await f.app.workspace(admin, f.business.id);
    expect(f.mail.effects.map((e) => e.recipient)).toEqual([
      started.runs[0].recipients[1].recipient,
      recipient.recipient,
    ]);
    expect(state.runs[0].recipients[0].actions[1].state).toBe("pending");
    expect(state.runs[0].recipients[1].actions[1].state).toBe("pending");
  });
  it("requires authoritative non-acceptance before a fresh attempt and retains both reservations", async () => {
    const f = await setup(),
      started = await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    f.mail.outcome = "timeout";
    await f.app.execute(f.queued.shift()!.work);
    f.mail.reconciliation = "not_accepted";
    const recovered = await f.app.command(f.owner, f.business.id, {
      runId: started.runs[0].id,
      expectedVersion: 1,
      command: "recover",
      note: "Authoritative transport ledger confirms no acceptance",
    });
    expect(recovered.runs[0].recipients[0].actions[0].state).toBe("pending");
    expect(recovered.usage.reserved).toBe(1);
    h.clock.set("2026-11-05T14:02:00Z");
    f.mail.outcome = "accepted";
    await f.newApp().execute(f.queued.shift()!.work);
    expect(f.mail.calls).toBe(2);
    expect(f.mail.effects).toHaveLength(1);
    expect((await f.app.workspace(f.owner, f.business.id)).usage.reserved).toBe(
      2,
    );
  });
  it("reconciles acceptance after a timeout without repeating the transport effect or freeing its allowance", async () => {
    const f = await setup();
    const started = await f.app.start(
      f.owner,
      f.business.id,
      f.ref(f.revision),
    );
    h.clock.set("2026-11-05T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: f.sender.identity.version,
    });
    f.mail.outcome = "accepted_timeout";
    const job = f.queued.shift()!;
    await f.app.execute(job.work);
    let state = await f.newApp().workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
    expect(state.usage).toEqual({ reserved: 1, remaining: 9 });
    await f.newApp().execute(job.work);
    expect(f.mail.effects).toHaveLength(1);
    await f.newApp().command(f.owner, f.business.id, {
      runId: started.runs[0].id,
      expectedVersion: state.runs[0].version,
      command: "recover",
      note: "Reconcile uncertain acceptance",
    });
    state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("accepted");
    expect(state.usage.reserved).toBe(1);
    expect(f.mail.effects).toHaveLength(1);
    expect(f.mail.reconciliations).toBe(1);
  });
});
