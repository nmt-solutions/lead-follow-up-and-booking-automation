import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createOperationsApplication } from "../src/application/operations";
import { createOperationsRepository } from "../src/db/operations-repository";
import { sequenceWorkspaceSchema } from "../src/models/email-sequences";
import { createHarness } from "./support/harness";
import { campaignFixture } from "./support/campaigns";
import { eligibilityApplication } from "./support/email-eligibility";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createEmailSequenceRepository } from "../src/db/email-sequence-repository";
import { createEmailSequenceApplication } from "../src/application/email-sequences";
import { deterministicSequenceMail } from "./support/sequence-mail";
import type {
  SequenceWork,
  SequenceTiming,
  SequenceMailProvider,
} from "../src/models/email-sequences";
import { createEmailSequenceHttp } from "../src/http/email-sequences";
import {
  routeSequenceMail,
  unavailableSequenceMail,
} from "../src/email-sequences/provider";
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
import { createGmailSequenceMail } from "../src/gmail/sequence-mail";
import { routeSenderAdapters } from "../src/senders/adapter";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { createGmailSenderAdapter } from "../src/gmail/sender";
import { microsoftMailFixture } from "./support/microsoft-mail";
import { createMicrosoftMailApplication } from "../src/application/microsoft-mail";
import { createMicrosoftMailConnection } from "../src/microsoft-mail/connection";
import { createMicrosoftMailProvider } from "../src/microsoft-mail/provider";
import { createMicrosoftSequenceMail } from "../src/microsoft-mail/sequence-mail";
import { createMicrosoftSenderAdapter } from "../src/microsoft-mail/sender";
import { reviewedSenderHealth } from "./support/sender-health";

describe("Approved email sequences at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  async function setup(
    multiple = false,
    at?: string,
    timing?: SequenceTiming,
    google?: ReturnType<typeof gmailFixture>,
    message?: { subject: string; body: string },
    microsoft?: ReturnType<typeof microsoftMailFixture>,
    paidAutomation = 10000,
  ) {
    const f = await campaignFixture(h, {
      multipleSources: multiple,
      at,
      mailboxProvider: microsoft ? "microsoft" : "gmail",
      automationQuantity: paidAutomation,
    });
    let health: Awaited<ReturnType<typeof reviewedSenderHealth>> | undefined;
    let native:
      { mailboxId: string; synchronize(): Promise<unknown> } | undefined;
    if (google || microsoft) {
      const database = runtimeDatabase(h.runtime);
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
      const nativeServices = microsoft
        ? (() => {
            const connection = createMicrosoftMailConnection(database, {
              clock: h.clock,
              configuration: microsoft.configuration,
              fetch: microsoft.fetch,
            });
            return {
              auth: createMicrosoftMailApplication({
                access: h.access,
                connection,
              }),
              provider: createMicrosoftMailProvider(connection, h.clock),
            };
          })()
        : (() => {
            const connection = createGmailConnection(database, {
              clock: h.clock,
              configuration: google!.configuration,
              fetch: google!.fetch,
            });
            return {
              auth: createGmailApplication({ access: h.access, connection }),
              provider: createGmailProvider(connection, h.clock),
            };
          })();
      const auth = nativeServices.auth;
      const oauth = await auth.start(f.owner, f.business.id, mailbox.id);
      if (microsoft)
        microsoft.identity.nonce = new URL(
          oauth.authorizationUrl,
        ).searchParams.get("nonce")!;
      await auth.callback(f.owner, f.business.id, mailbox.id, {
        state: new URL(oauth.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      const sync = createMailboxApplication({
        authenticate: h.access.authenticateForWork,
        repository: createMailboxRepository(database, h.clock),
        clock: h.clock,
        provider: nativeServices.provider,
        enqueue: async () => {},
      });
      native = {
        mailboxId: mailbox.id,
        async synchronize() {
          const work = await sync.queue(f.owner, f.business.id, mailbox.id, {
            mode: "incremental",
          });
          let state = await sync.execute(work);
          for (let i = 0; state?.status === "partial" && i < 10; i++)
            state = await sync.execute(work);
          return state;
        },
      };
      await native.synchronize();
      f.sender.route = await f.sender.app.saveReplyRoute(
        f.owner,
        f.business.id,
        {
          id: f.sender.route.id,
          expectedVersion: f.sender.route.version,
          configuration: {
            ...f.sender.route.configuration,
            inboxConnectionId: mailbox.id,
          },
        },
      );
      f.sender.adapter.key = microsoft
        ? "microsoft-mail-send-v1"
        : "gmail-sequence-v1";
      f.sender.adapter.mode = "live";
      f.sender.adapter.inspect = (
        microsoft
          ? createMicrosoftSenderAdapter({ clock: h.clock })
          : createGmailSenderAdapter({ clock: h.clock, evidence: [] })
      ).inspect;
      health = await reviewedSenderHealth(
        h,
        f.business.id,
        f.sender.identity.id,
      );
      await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
        expectedVersion: f.sender.identity.version,
      });
    }
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
    if (message) draft.steps[0] = { ...draft.steps[0], ...message };
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
    const gmailProvider = microsoft
      ? createMicrosoftSequenceMail({
          configuration: microsoft.configuration,
          fetch: microsoft.fetch,
          clock: h.clock,
        })
      : google
        ? createGmailSequenceMail({
            configuration: google.configuration,
            fetch: google.fetch,
            clock: h.clock,
          })
        : null;
    const newApp = (
      provider: SequenceMailProvider = gmailProvider ?? mail.provider,
    ) =>
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
        adapterKey: gmailProvider?.key ?? mail.provider.key,
        mode: gmailProvider ? "live" : "fixture",
        periodStart: "2026-11-01T00:00:00Z",
        periodEnd: "2028-01-01T00:00:00Z",
        maxProviderCalls: 10,
        minIntervalSeconds: 60,
        note: "Explicit fixture allowance and pacing",
      },
    });
    return {
      ...f,
      revision,
      mail,
      queued,
      app,
      newApp,
      eligibility,
      queue,
      native,
      health,
    };
  }
  it("stops new sequence attempts when paid automation is exhausted despite a larger operational allowance", async () => {
    const f = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      undefined,
      1,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const first = f.queued.shift()!;
    await f.app.execute(first.work);
    expect(f.mail.effects).toHaveLength(1);
    const next = f.queued.shift()!;
    h.clock.set(next.dueAt.toISOString());
    await h.reverifyAuthenticator(f.owner);
    await f.app.execute(next.work);
    expect(f.mail.effects).toHaveLength(1);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.usage.remaining).toBe(0);
    expect(state.runs[0].recipients[0].actions[1].state).toBe("paused");
  });
  it("records Microsoft sequence processing acceptance and reserves follow-up until exact Sent identity is known", async () => {
    const graph = microsoftMailFixture(h.clock);
    graph.identity.scopes += " Mail.Send";
    const f = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      graph,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await f.app.execute(f.queued[0].work);
    const state = await f.app.workspace(f.owner, f.business.id),
      action = state.runs[0].recipients[0].actions[0];
    expect(action).toMatchObject({
      state: "committed",
      reason: "provider_accepted_identity_pending",
      receipt: null,
      processingAcceptance: { provider: "microsoft" },
    });
    expect(state.runs[0].recipients[0].actions[1].state).toBe("waiting");
    await f.newApp().execute(f.queued[0].work);
    expect(graph.sends).toHaveLength(1);
  });
  it("routes concurrent Gmail and Microsoft Businesses by exact selected native connection and persisted adapter", async () => {
    const graph = microsoftMailFixture(h.clock);
    graph.identity.scopes += " Mail.Send";
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const m = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      graph,
    );
    const g = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    const router = routeSequenceMail([
      createMicrosoftSequenceMail({
        configuration: graph.configuration,
        fetch: graph.fetch,
        clock: h.clock,
      }),
      createGmailSequenceMail({
        configuration: google.configuration,
        fetch: google.fetch,
        clock: h.clock,
      }),
    ]);
    const ma = m.newApp(router),
      ga = g.newApp(router);
    const senders = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(runtimeDatabase(h.runtime), h.clock),
      clock: h.clock,
      adapter: routeSenderAdapters({
        gmail: createGmailSenderAdapter({ clock: h.clock, evidence: [] }),
        microsoft: createMicrosoftSenderAdapter({ clock: h.clock }),
      }),
    });
    expect(
      (
        await senders.check(m.owner, m.business.id, m.sender.identity.id, {
          expectedVersion: m.sender.identity.version,
        })
      ).evidence?.adapterKey,
    ).toBe("microsoft-mail-send-v1");
    expect(
      (
        await senders.check(g.owner, g.business.id, g.sender.identity.id, {
          expectedVersion: g.sender.identity.version,
        })
      ).evidence?.adapterKey,
    ).toBe("gmail-sequence-v1");
    await ma.configure(m.owner, m.business.id, {
      expectedVersion: 1,
      policy: {
        ...(await ma.workspace(m.owner, m.business.id)).policy!.configuration,
        adapterKey: "native-mail-v1",
        adapterKeys: ["microsoft-mail-send-v1", "gmail-sequence-v1"],
        note: "Explicit reviewed providers sharing the same Business cap",
      },
    });

    await ma.start(m.owner, m.business.id, m.ref(m.revision));
    await ga.start(g.owner, g.business.id, g.ref(g.revision));
    await Promise.all([
      ma.execute(m.queued[0].work),
      ga.execute(g.queued[0].work),
    ]);
    expect(graph.sends).toHaveLength(1);
    expect(google.sends).toHaveLength(1);
    await ma.execute(m.queued[0].work);
    await ga.execute(g.queued[0].work);
    expect(graph.sends).toHaveLength(1);
    expect(google.sends).toHaveLength(1);
  });
  it("resolves Microsoft sequence acceptance only from exact authorized Sent evidence and sends the next approved follow-up once", async () => {
    const graph = microsoftMailFixture(h.clock);
    graph.identity.scopes += " Mail.Send";
    const f = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      graph,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await f.app.execute(f.queued[0].work);
    const approved = f.revision.snapshot.steps[0],
      recipient = f.revision.snapshot.recipients[0].address;
    const rfc = /^Message-ID: (.+)$/m.exec(graph.sends[0])![1].trim();
    const sent = graph.add("sequence-sent", {
      folder: "sent",
      from: "sales@supplier.example",
      to: recipient,
      at: h.clock.now().toISOString(),
      subject: approved.subject,
      text: approved.body,
    });
    sent.internetMessageId = rfc;
    Object.assign(sent, {
      replyTo: [{ emailAddress: { address: "sales@supplier.example" } }],
    });
    graph.pages.set("sent-steady", {
      value: [{ id: "sequence-sent" }],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent-next",
    });
    await f.native!.synchronize();
    const before = (await f.app.workspace(f.owner, f.business.id)).runs[0];
    const recovered = await f.app.command(f.owner, f.business.id, {
      runId: before.id,
      expectedVersion: before.version,
      command: "recover",
      note: "Review exact current Sent evidence",
    });
    expect(recovered.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "accepted",
      receipt: { messageRef: "sequence-sent", evidence: "sent_folder" },
      processingAcceptance: { provider: "microsoft" },
    });
    const next = f.queued.find(
      (q) => q.work.actionId === recovered.runs[0].recipients[0].actions[1].id,
    )!;
    h.clock.set(next.dueAt.toISOString());
    await h.reverifyAuthenticator(f.owner);
    // Current reply visibility must be refreshed after the controlled clock advances.
    await f.native!.synchronize();
    const refreshed = (await f.app.workspace(f.owner, f.business.id)).runs[0];
    await f.app.command(f.owner, f.business.id, {
      runId: refreshed.id,
      expectedVersion: refreshed.version,
      command: "resume",
      note: "Review current visibility after credential refresh",
    });
    await f.app.execute(f.queued.at(-1)!.work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[1],
    ).toMatchObject({
      state: "committed",
      reason: "provider_accepted_identity_pending",
    });
    expect(graph.sends).toHaveLength(2);
    expect(graph.sends[1]).toContain(`In-Reply-To: ${rfc}`);
  });
  it.each(["lost", "malformed", "server"] as const)(
    "does not repeat a Microsoft sequence after %s acceptance",
    async (mode) => {
      const graph = microsoftMailFixture(h.clock);
      graph.identity.scopes += " Mail.Send";
      const f = await setup(
        false,
        "2026-11-05T14:00:00Z",
        undefined,
        undefined,
        undefined,
        graph,
      );
      await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      graph.control.sendLost = mode === "lost";
      graph.control.sendMalformed = mode === "malformed";
      graph.control.sendError = mode === "server" ? 503 : 0;
      await f.app.execute(f.queued[0].work);
      await f.newApp().execute(f.queued[0].work);
      const state = await f.app.workspace(f.owner, f.business.id);
      expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
        state: "unknown",
        receipt: null,
      });
      expect(state.runs[0].recipients[0].actions[1].state).toBe("waiting");
      expect(graph.sends).toHaveLength(1);
    },
  );
  it("honors Microsoft Retry-After with a fresh reserved attempt and no provider fallback", async () => {
    const graph = microsoftMailFixture(h.clock);
    graph.identity.scopes += " Mail.Send";
    const f = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      graph,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    graph.control.sendError = 429;
    graph.control.retryAfter = "120";
    await f.app.execute(f.queued[0].work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "pending",
      dueAt: "2026-11-05T14:02:00.000Z",
      attempts: 1,
    });
    expect(state.runs[0].history).toContainEqual(
      expect.objectContaining({ kind: "not_accepted", reason: "rate_limited" }),
    );
    const retry = f.queued.at(-1)!;
    await f.app.execute(retry.work);
    expect(graph.sends).toHaveLength(1);
    h.clock.set(retry.dueAt.toISOString());
    graph.control.sendError = 0;
    await f.app.execute(retry.work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0],
    ).toMatchObject({
      state: "committed",
      processingAcceptance: { provider: "microsoft" },
      attempts: 2,
    });
    expect(graph.sends).toHaveLength(2);
  });
  it("retains the Microsoft sequence reservation across a result write failure and validates the new restricted grant", async () => {
    const graph = microsoftMailFixture(h.clock);
    graph.identity.scopes += " Mail.Send";
    const f = await setup(
      false,
      "2026-11-05T14:00:00Z",
      undefined,
      undefined,
      undefined,
      graph,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await h.admin.query(
      `CREATE FUNCTION fail_ms_sequence_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${f.queued[0].work.actionId}' AND NEW.processing_acceptance IS NOT NULL THEN RAISE EXCEPTION 'synthetic result persistence failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_ms_sequence_result BEFORE UPDATE ON email_sequence_action FOR EACH ROW EXECUTE FUNCTION fail_ms_sequence_result()`,
    );
    try {
      await expect(f.app.execute(f.queued[0].work)).rejects.toBeDefined();
    } finally {
      await h.admin.query(
        "DROP TRIGGER fail_ms_sequence_result ON email_sequence_action; DROP FUNCTION fail_ms_sequence_result()",
      );
    }
    await f.newApp().execute(f.queued[0].work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0],
    ).toMatchObject({
      state: "committed",
      receipt: null,
      processingAcceptance: null,
      attempts: 1,
    });
    expect(graph.sends).toHaveLength(1);
    await h.admin.query(
      "REVOKE UPDATE(processing_acceptance) ON email_sequence_action FROM app_runtime",
    );
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await h.admin.query(
        "GRANT UPDATE(processing_acceptance) ON email_sequence_action TO app_runtime",
      );
    }
    await verifyRuntimeRole(h.runtime);
  });
  it("sends an approved Gmail action exactly once with native identity and separate acceptance evidence", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    const started = await f.app.start(
      f.owner,
      f.business.id,
      f.ref(f.revision),
    );
    const job = f.queued.shift()!;
    await f.app.execute(job.work);
    await f.newApp().execute(job.work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "accepted",
      attempts: 1,
      receipt: {
        businessId: f.business.id,
        actionId: started.runs[0].recipients[0].actions[0].id,
        connectionId: f.sender.connection.id,
        messageRef: "gmail-sent-1",
        threadRef: "gmail-thread-1",
        evidence: "provider_response",
      },
    });
    expect(
      google.calls.filter((c) => c.url.pathname.endsWith("/messages/send")),
    ).toHaveLength(1);
    expect(
      state.runs[0].history.some((e) => e.kind === "sent_folder_observed"),
    ).toBe(false);
    expect(google.sends[0]).toContain("To: purchasing@fabricator.example\r\n");
    expect(google.sends[0]).toContain("Reply-To: sales@supplier.example\r\n");
    expect(google.sends[0]).toContain("X-Platform-Disclosure:");
    google.add("native-buyer-reply", {
      at: "2026-11-05T14:00:01Z",
      from: "purchasing@fabricator.example",
      reply: state.runs[0].recipients[0].actions[0].receipt!.internetMessageId,
      thread: "gmail-thread-1",
      text: "Could you share specifications?",
      labels: ["INBOX"],
    });
    google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [
            { message: { id: "gmail-sent-1" } },
            { message: { id: "native-buyer-reply" } },
          ],
        },
      ],
    });
    h.clock.set("2026-11-05T14:00:02Z");
    await f.native!.synchronize();
    const observed = await f.app.workspace(f.owner, f.business.id);
    expect(observed.runs[0].recipients[0].actions[1].state).toBe("cancelled");
    expect(
      observed.runs[0].history.find((e) => e.kind === "reply_observed")?.reply
        ?.text,
    ).toBe("Could you share specifications?");
    expect(
      observed.runs[0].history.filter((e) => e.kind === "sent_folder_observed"),
    ).toHaveLength(1);
    expect(google.sends).toHaveLength(1);
  });
  it.each([401, 403, 429, 503])(
    "accounts for Gmail HTTP %s without retrying a message implicitly",
    async (status) => {
      const google = gmailFixture();
      google.control.scopes += ` ${gmailSendScope}`;
      const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
      await f.app.start(f.owner, f.business.id, f.ref(f.revision));
      google.control.apiError = status;
      const job = f.queued.shift()!;
      await f.app.execute(job.work);
      await f.newApp().execute(job.work);
      const state = await f.app.workspace(f.owner, f.business.id);
      expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
        state: status === 503 ? "unknown" : "failed",
        reason:
          status === 503
            ? "acceptance_unknown"
            : status === 429
              ? "rate_limited"
              : "rejected",
        receipt: null,
        attempts: 1,
      });
      expect(
        google.calls.filter((c) => c.url.pathname.endsWith("/messages/send")),
      ).toHaveLength(1);
      expect(JSON.stringify(state)).not.toMatch(
        /fixture-access|fixture-refresh|private-gmail/,
      );
      if (status === 403) {
        const authorization = createGmailApplication({
          access: h.access,
          connection: createGmailConnection(runtimeDatabase(h.runtime), {
            clock: h.clock,
            configuration: google.configuration,
            fetch: google.fetch,
          }),
        });
        expect(
          await authorization.read(f.owner, f.business.id, f.native!.mailboxId),
        ).toMatchObject({ read: true, send: false });
      }
    },
  );
  it("requires a separate send grant and current attributable sender proof", async () => {
    const google = gmailFixture();
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await expect(
      f.app.start(f.owner, f.business.id, f.ref(f.revision)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(google.sends).toHaveLength(0);
    expect(
      new URL(google.calls.find((c) => c.url.pathname.endsWith("/token"))!.url)
        .hostname,
    ).toBe("oauth2.googleapis.com");
    f.sender.adapter.inspect = createGmailSenderAdapter({
      clock: h.clock,
      evidence: [],
    }).inspect;
    const identity = await f.sender.app.check(
      f.owner,
      f.business.id,
      f.sender.identity.id,
      { expectedVersion: f.sender.identity.version },
    );
    expect(identity.readiness.ready).toBe(false);
    expect(identity.evidence?.checks.spf).toBe("unknown");
  });
  it("blocks a separately revoked Gmail sending selection after enqueue", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const settings = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(runtimeDatabase(h.runtime), h.clock),
      clock: h.clock,
      provider: unavailableMailboxProvider,
    });
    const mailbox = (await settings.workspace(f.owner, f.business.id))
      .mailboxes[0];
    await settings.save(f.owner, f.business.id, {
      id: mailbox.id,
      expectedVersion: mailbox.version,
      configuration: { ...mailbox.configuration, requestedSend: false },
    });
    await f.app.execute(f.queued.shift()!.work);
    expect(google.sends).toHaveLength(0);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0].state,
    ).toBe("paused");
  });
  it("refreshes Gmail credentials under the dispatch lock and stops on token loss before sending", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    google.control.expiresIn = 90;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:31Z");
    google.control.tokenError = 400;
    await f.app.execute(f.queued.shift()!.work);
    expect(google.sends).toHaveLength(0);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0].state,
    ).toBe("failed");
    const connection = createGmailApplication({
      access: h.access,
      connection: createGmailConnection(runtimeDatabase(h.runtime), {
        clock: h.clock,
        configuration: google.configuration,
        fetch: google.fetch,
      }),
    });
    expect(
      await connection.read(f.owner, f.business.id, f.native!.mailboxId),
    ).toMatchObject({ status: "reconnect_required", send: false });
  });
  it("rechecks current reply visibility after Gmail refresh before crossing the transport boundary", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    google.control.expiresIn = 90;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    h.clock.set("2026-11-05T14:00:31Z");
    google.control.beforeRefresh = async () => {
      h.clock.set("2026-11-05T14:06:00Z");
    };
    await f.app.execute(f.queued.shift()!.work);
    expect(google.sends).toHaveLength(0);
  });
  it("keeps a malformed Gmail acceptance response unresolved and fences forged Business work", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const job = f.queued.shift()!;
    await expect(
      f.app.execute({ ...job.work, businessId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    google.control.sendResponse = { id: "private-gmail-response" };
    await f.app.execute(job.work);
    await f.newApp().execute(job.work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
    expect(google.sends).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("private-gmail-response");
  });
  it("reconciles a lost Gmail response only from an exact selected Sent observation without blind resend or history access", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const job = f.queued.shift()!;
    google.control.sendLost = true;
    await f.app.execute(job.work);
    await f.newApp().execute(job.work);
    let state = await f.app.workspace(f.owner, f.business.id);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
    expect(google.sends).toHaveLength(1);
    google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "gmail-sent-1" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T14:00:01Z");
    await f.native!.synchronize();
    await f.newApp().execute(job.work);
    state = await f.app.workspace(f.owner, f.business.id);
    expect(
      state.runs[0].history.filter((e) => e.kind === "sent_folder_observed"),
    ).toHaveLength(1);
    expect(state.runs[0].recipients[0].actions[0]).toMatchObject({
      state: "accepted",
      receipt: {
        evidence: "sent_folder",
        messageRef: "gmail-sent-1",
        threadRef: "gmail-thread-1",
      },
    });
    expect(
      state.runs[0].history.filter((e) => e.kind === "sent_folder_observed"),
    ).toHaveLength(1);
    expect(google.sends).toHaveLength(1);
    expect(
      (
        await createMailboxApplication({
          authenticate: h.access.authenticateForWork,
          repository: createMailboxRepository(
            runtimeDatabase(h.runtime),
            h.clock,
          ),
          clock: h.clock,
          provider: unavailableMailboxProvider,
        }).workspace(f.owner, f.business.id)
      ).mailboxes[0].configuration.history,
    ).toBeNull();
  });
  it("correlates UTF-8 Gmail messages with folded MIME headers and preserves their exact approved content", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google, {
      subject:
        "Galvanized steel — café procurement and fabrication specification enquiry",
      body: "Specifications: café façade.\nPlease review the approved scope.",
    });
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    google.control.sendLost = true;
    const job = f.queued.shift()!;
    await f.app.execute(job.work);
    google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [{ message: { id: "gmail-sent-1" } }],
        },
      ],
    });
    h.clock.set("2026-11-05T14:00:01Z");
    await f.native!.synchronize();
    await f.app.execute(job.work);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0].state,
    ).toBe("accepted");
  });
  it("keeps matching-subject Gmail follow-ups in their native thread with exact RFC references", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google, {
      subject: "Steel supply follow-up",
      body: "Approved opening message.",
    });
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    await f.app.execute(f.queued.shift()!.work);
    const receipt = (await f.app.workspace(f.owner, f.business.id)).runs[0]
      .recipients[0].actions[0].receipt!;
    h.clock.set("2026-11-09T14:00:00Z");
    await h.reverifyAuthenticator(f.owner);
    await f.native!.synchronize();
    await f.newApp().execute(f.queued.shift()!.work);
    expect(google.sends).toHaveLength(2);
    expect(google.sends[1]).toContain(
      `In-Reply-To: ${receipt.internetMessageId}\r\n`,
    );
    expect(
      google.calls.filter((c) => c.url.pathname.endsWith("/messages/send"))[1]
        .body.threadId,
    ).toBe("gmail-thread-1");
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[1].receipt?.threadRef,
    ).toBe("gmail-thread-1");
  });
  it("leaves conflicting exact Gmail Sent observations unresolved", async () => {
    const google = gmailFixture();
    google.control.scopes += ` ${gmailSendScope}`;
    const f = await setup(false, "2026-11-05T14:00:00Z", undefined, google);
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    google.control.sendLost = true;
    const job = f.queued.shift()!;
    await f.app.execute(job.work);
    const internetId = /^Message-ID: (.+)\r$/m.exec(google.sends[0])![1];
    const duplicate = google.add("duplicate-send", {
      at: "2026-11-05T14:00:00Z",
      from: google.control.email,
      to: "purchasing@fabricator.example",
      labels: ["SENT"],
      internetId,
      text: f.revision.snapshot.steps[0].body,
    });
    duplicate.payload.headers.find((h) => h.name === "Subject")!.value =
      f.revision.snapshot.steps[0].subject;
    google.histories.set("18446744073709551630", {
      historyId: "18446744073709551631",
      history: [
        {
          id: "18446744073709551631",
          messagesAdded: [
            { message: { id: "gmail-sent-1" } },
            { message: { id: "duplicate-send" } },
          ],
        },
      ],
    });
    h.clock.set("2026-11-05T14:00:01Z");
    await f.native!.synchronize();
    await f.app.execute(job.work);
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(
      state.runs[0].history.filter((e) => e.kind === "sent_folder_observed"),
    ).toHaveLength(2);
    expect(state.runs[0].recipients[0].actions[0].state).toBe("unknown");
    expect(google.sends).toHaveLength(1);
  });
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
  it("serializes authenticated health ingestion ahead of the final due boundary and keeps alerts duplicate-safe across workers and restart", async () => {
    const f = await setup(false, "2026-11-05T14:00:00Z");
    const health = await reviewedSenderHealth(
      h,
      f.business.id,
      f.sender.identity.id,
    );
    await f.app.start(f.owner, f.business.id, f.ref(f.revision));
    const work = f.queued.shift()!.work;
    const bad = {
      ...health.evidence,
      eventKey: "bounce-report",
      metrics: {
        ...health.evidence.metrics,
        bounces: { failed: 5, total: 100 },
      },
    };
    await restrictionWins(f, work, () =>
      health.app.ingest(
        health.operator,
        f.business.id,
        f.sender.identity.id,
        bad,
      ),
    );
    await Promise.all([
      health.app.ingest(
        health.operator,
        f.business.id,
        f.sender.identity.id,
        bad,
      ),
      f.newApp().execute(work),
      f.newApp().execute(work),
    ]);
    expect(f.mail.effects).toHaveLength(0);
    expect(
      (await health.app.workspace(f.owner, f.business.id)).alerts,
    ).toHaveLength(1);
    expect(
      (await health.app.alerts(health.operator)).alerts.filter(
        (a) => a.businessId === f.business.id,
      ),
    ).toHaveLength(1);
    expect(
      (await f.app.workspace(f.owner, f.business.id)).runs[0].recipients[0]
        .actions[0].state,
    ).toBe("paused");
  });
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
      const operations = createOperationsApplication({
        authenticate: h.access.authenticateForWork,
        repository: createOperationsRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
        commands: { sequences: f.newApp() },
      });
      expect(
        (await operations.workspace(f.owner, f.business.id)).resources.find(
          (r) => r.id === started.runs[0].id,
        ),
      ).toMatchObject({
        source: "sequence",
        context: {
          approvalHash: started.runs[0].payloadHash,
          revisionId: started.runs[0].revisionId,
        },
      });
      await operations.recover(f.owner, f.business.id, {
        source: "sequence",
        targetId: started.runs[0].id,
        action: "reconcile",
        requestKey: crypto.randomUUID(),
      });
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
