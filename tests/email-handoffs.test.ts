import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { campaignFixture } from "./support/campaigns";
import { eligibilityApplication } from "./support/email-eligibility";
import { runtimeDatabase } from "../src/db/runtime";
import { createEmailHandoffApplication } from "../src/application/email-handoffs";
import { createEmailHandoffRepository } from "../src/db/email-handoff-repository";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createGmailApplication } from "../src/application/gmail";
import { createGmailConnection } from "../src/gmail/connection";
import { createGmailProvider } from "../src/gmail/provider";
import { gmailFixture } from "./support/gmail";
import { createEmailHandoffHttp } from "../src/http/email-handoffs";
import { createMicrosoftMailApplication } from "../src/application/microsoft-mail";
import { createMicrosoftMailConnection } from "../src/microsoft-mail/connection";
import { createMicrosoftMailProvider } from "../src/microsoft-mail/provider";
import { microsoftMailFixture } from "./support/microsoft-mail";

describe("Own-client email handoff at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  async function setup(mailboxProvider: "gmail" | "microsoft" = "gmail") {
    h.clock.set("2026-11-05T09:00:00Z");
    const f = await campaignFixture(h, { mailboxProvider });
    const draft = f.draft();
    draft.steps[0] = {
      subject: "Steel & supply + café?",
      body: "First line &bcc=other@example.com\nSecond line <script>alert(1)</script> + café",
      delayMinutes: 0,
    };
    const r = (await f.app.save(f.owner, f.business.id, draft)).campaigns[0]
      .revisions[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Exact draft reviewed",
    });
    const recipient = r.snapshot.recipients[0];
    const eligibility = eligibilityApplication(h);
    const actor = await h.authenticate(f.owner);
    await h.admin.query(
      "insert into platform_operator(user_id,email_policy) values ($1,true) on conflict(user_id) do update set email_policy=true",
      [actor.userId],
    );
    let policy = (
      await eligibility.workspace(f.owner, f.business.id)
    ).policies.find((p) => p.policy.purpose === "sales_outreach");
    if (!policy) {
      await eligibility.publishPolicy(f.owner, f.business.id, {
        expectedVersion: 0,
        policy: {
          market: "US",
          recipientClass: "corporate",
          purpose: "sales_outreach",
          enabled: true,
          effectiveAt: h.clock.now().toISOString(),
          validUntil: "2027-01-01T00:00:00Z",
          acceptedEvidence: ["consent"],
          requiredContent: [],
          incomingOptOutScope: "recipient_outreach",
          sources: ["https://policy.example/synthetic"],
          rationale: "Synthetic test policy, never production permission",
        },
      });
      policy = (
        await eligibility.workspace(f.owner, f.business.id)
      ).policies.find((p) => p.policy.purpose === "sales_outreach")!;
    }
    await eligibility.saveRecipient(f.owner, f.business.id, {
      expectedVersion: 0,
      facts: {
        recipient: recipient.address,
        market: "US",
        recipientClass: "corporate",
        reference: "Synthetic fixture",
        effectiveAt: h.clock.now().toISOString(),
        validUntil: "2027-01-01T00:00:00Z",
        permissions: [
          {
            kind: "consent",
            purpose: "sales_outreach",
            policyId: policy.id,
            opportunityId: null,
            prospectId: recipient.prospectId,
            reference: "Synthetic prospect permission",
            observedAt: h.clock.now().toISOString(),
            validUntil: "2027-01-01T00:00:00Z",
          },
        ],
      },
    });
    const newApp = () =>
      createEmailHandoffApplication({
        authenticate: h.access.authenticateForWork,
        repository: createEmailHandoffRepository(
          runtimeDatabase(h.runtime),
          h.clock,
        ),
      });
    const input = {
      ...f.ref(r),
      recipient: {
        prospectId: recipient.prospectId,
        contactId: recipient.contactId,
        address: recipient.address,
      },
      stepIndex: 0,
    };
    return {
      ...f,
      r,
      recipient,
      eligibility,
      newApp,
      handoffs: newApp(),
      input,
    };
  }
  it("prepares exact approved content, reloads it and exposes safe mailto/copy contracts without sending", async () => {
    const f = await setup();
    const effects = h.mail.sent.length;
    const prepared = await f.handoffs.prepare(f.owner, f.business.id, f.input);
    expect(prepared.recipient).toBe("purchasing@fabricator.example");
    expect(prepared.subject).toBe("Steel & supply + café?");
    expect(prepared.body).toBe(f.r.snapshot.steps[0].body);
    expect(prepared.mailto).toBe(
      "mailto:purchasing@fabricator.example?subject=Steel%20%26%20supply%20%2B%20caf%C3%A9%3F&body=First%20line%20%26bcc%3Dother%40example.com%0D%0ASecond%20line%20%3Cscript%3Ealert(1)%3C%2Fscript%3E%20%2B%20caf%C3%A9",
    );
    expect(prepared.evidence.map((e) => e.kind)).toEqual(["prepared"]);
    expect(await f.newApp().workspace(f.owner, f.business.id)).toMatchObject({
      handoffs: [
        { id: prepared.id, revisionId: f.r.id, payloadHash: f.r.payloadHash },
      ],
    });
    const replay = await f.handoffs.prepare(f.owner, f.business.id, f.input);
    expect(replay.id).toBe(prepared.id);
    for (const operation of [
      "open",
      "copy_recipient",
      "copy_subject",
      "copy_body",
    ] as const) {
      const used = await f.handoffs.use(f.owner, f.business.id, {
        handoffId: prepared.id,
        operation,
      });
      expect(used.body).toBe(prepared.body);
      expect(used.evidence.map((e) => e.kind)).toEqual(["prepared"]);
    }
    await f.handoffs.markSent(f.owner, f.business.id, {
      handoffId: prepared.id,
    });
    const state = await f.newApp().workspace(f.owner, f.business.id);
    expect(state.handoffs[0].evidence.map((e) => e.kind)).toEqual([
      "prepared",
      "user_marked_sent",
    ]);
    expect(state.handoffs[0].visibility).toBe("unavailable");
    expect(h.mail.sent).toHaveLength(effects);
    expect(f.queued).toEqual([]);
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).conversations,
    ).toEqual([]);
  });
  async function native(f: Awaited<ReturnType<typeof setup>>) {
    const database = runtimeDatabase(h.runtime);
    const settings = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const mailbox = await settings.save(f.owner, f.business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: f.sender.connection.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["Label_sales"] },
        history: null,
        salesSubjectTerms: ["steel"],
      },
    });
    const google = gmailFixture();
    const connection = createGmailConnection(database, {
      clock: h.clock,
      configuration: google.configuration,
      fetch: google.fetch,
    });
    const auth = createGmailApplication({ access: h.access, connection });
    const start = await auth.start(f.owner, f.business.id, mailbox.id);
    await auth.callback(f.owner, f.business.id, mailbox.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      enqueue: async () => {},
      repository: createMailboxRepository(database, h.clock),
      provider: createGmailProvider(connection, h.clock),
      clock: h.clock,
    });
    async function synchronize() {
      const work = await sync.queue(f.owner, f.business.id, mailbox.id, {
        mode: "incremental",
      });
      let result = await sync.execute(work);
      for (let i = 0; result?.status === "partial" && i < 10; i++)
        result = await sync.execute(work);
      return result;
    }
    function addSent(
      id: string,
      changes: { text?: string; to?: string; from?: string } = {},
    ) {
      const m = google.add(id, {
        at: "2026-11-05T09:01:00Z",
        labels: ["Label_sales", "SENT"],
        thread: "abc123",
        from: f.sender.identity.configuration.fromAddress,
        to: f.recipient.address,
        text: f.r.snapshot.steps[0].body,
        ...changes,
      });
      const payload = m.payload;
      payload.headers.find((header) => header.name === "Subject")!.value =
        f.r.snapshot.steps[0].subject;
      return m;
    }
    return { google, mailbox, sync, auth, settings, synchronize, addSent };
  }
  it("binds only an explicitly reviewed exact native Sent record and retains an out-of-order exact reply, idempotently", async () => {
    const f = await setup(),
      prepared = await f.handoffs.prepare(f.owner, f.business.id, f.input);
    const n = await native(f);
    n.addSent("sent1");
    n.google.add("reply1", {
      at: "2026-11-05T09:02:00Z",
      from: f.recipient.address,
      reply: "<sent1@example.com>",
      text: "Thank you. This is an automatic acknowledgement.",
    });
    n.google.pages.set("Label_sales", {
      messages: [
        { id: "reply1", threadId: "abc123" },
        { id: "sent1", threadId: "abc123" },
      ],
    });
    h.clock.set("2026-11-05T09:03:00Z");
    expect((await n.synchronize())?.status).toBe("completed");
    let row = (await f.handoffs.workspace(f.owner, f.business.id)).handoffs[0];
    expect(row.evidence.map((e) => e.kind)).toEqual(["prepared"]);
    expect(row.candidates).toHaveLength(1);
    const source = row.candidates[0];
    expect(source.source).toMatchObject({
      provider: "gmail",
      mailboxId: n.mailbox.id,
      connectionId: f.sender.connection.id,
      messageRef: "sent1",
      internetMessageId: "<sent1@example.com>",
      threadRef: "abc123",
      syncGeneration: 1,
    });
    row = await f.handoffs.bindSent(f.owner, f.business.id, {
      handoffId: prepared.id,
      observationId: source.id,
      confirmExactMessage: true,
    });
    expect(row.evidence.map((e) => e.kind)).toEqual([
      "prepared",
      "sent_folder_observed",
      "reply_observed",
    ]);
    expect(row.evidence[2].source).toMatchObject({
      messageRef: "reply1",
      inReplyTo: "<sent1@example.com>",
    });
    expect(row.visibility).toBe("limited");
    await f.handoffs.bindSent(f.owner, f.business.id, {
      handoffId: prepared.id,
      observationId: source.id,
      confirmExactMessage: true,
    });
    await n.synchronize();
    expect(
      (await f.newApp().workspace(f.owner, f.business.id)).handoffs[0].evidence,
    ).toHaveLength(3);
    await n.auth.disconnect(f.owner, f.business.id, n.mailbox.id);
    row = (await f.newApp().workspace(f.owner, f.business.id)).handoffs[0];
    expect(row.visibility).toBe("unavailable");
    expect(row.evidence).toHaveLength(3);
    expect(row.candidates).toEqual([]);
    await expect(
      f.handoffs.bindSent(f.owner, f.business.id, {
        handoffId: prepared.id,
        observationId: source.id,
        confirmExactMessage: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.queued).toEqual([]);
    expect(n.google.calls.some((c) => /send|drafts/.test(c.url.pathname))).toBe(
      false,
    );
    expect(
      (await f.app.workspace(f.owner, f.business.id)).candidates[0].prospect
        .relationship,
    ).toBe("potential_buyer");
  });
  it("rejects widened recipients, edited content, unsupported follow-ups and forged observations through the HTTP contract", async () => {
    const f = await setup();
    const diagnostics: unknown[] = [];
    const http = createEmailHandoffHttp({
      application: f.handoffs,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const request = (
      command: string,
      input: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request("http://localhost:3000/api/handoff", {
        method: "POST",
        headers: new Headers([
          ...f.owner,
          ["Origin", origin],
          ["Content-Type", "application/json"],
        ]),
        body: JSON.stringify({ command, input }),
      });
    for (const input of [
      { ...f.input, subject: "Changed by client" },
      {
        ...f.input,
        recipient: { ...f.input.recipient, address: "other@example.net" },
      },
      {
        ...f.input,
        recipient: {
          ...f.input.recipient,
          address: "purchasing@fabricator.example\r\nBcc:other@example.net",
        },
      },
      { ...f.input, stepIndex: 1 },
      { ...f.input, payloadHash: "0".repeat(64) },
    ])
      expect(
        (await http.post(request("prepare", input), f.business.id)).status,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (await f.handoffs.workspace(f.owner, f.business.id)).handoffs,
    ).toEqual([]);
    const response = await http.post(
      request("prepare", f.input),
      f.business.id,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const prepared = (await f.handoffs.workspace(f.owner, f.business.id))
      .handoffs[0];
    for (const operation of [
      "open",
      "copy_recipient",
      "copy_subject",
      "copy_body",
    ]) {
      expect(
        (
          await http.post(
            request("use", { handoffId: prepared.id, operation }),
            f.business.id,
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await http.post(
          request("markSent", { handoffId: prepared.id, observed: true }),
          f.business.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.post(
          request("bindSent", {
            handoffId: prepared.id,
            observationId: crypto.randomUUID(),
            confirmExactMessage: true,
          }),
          f.business.id,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await http.post(
          request("prepare", f.input, "https://attacker.example"),
          f.business.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.post(
          new Request("http://localhost:3000", {
            method: "POST",
            headers: {
              Origin: "http://localhost:3000",
              "Content-Type": "application/json",
            },
            body: "{",
          }),
          f.business.id,
        )
      ).status,
    ).toBe(400);
    const stranger = await h.signIn(
      `stranger-${crypto.randomUUID()}@example.com`,
    );
    await expect(
      f.handoffs.workspace(stranger, f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.handoffs.markSent(stranger, f.business.id, { handoffId: prepared.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.handoffs.workspace(f.owner, "not-a-business"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(diagnostics)).not.toContain(
      f.r.snapshot.steps[0].body,
    );
  });
  it("rechecks current suppression, authority, approved versions and selected evidence before every new handoff or copy/open", async () => {
    const f = await setup(),
      row = await f.handoffs.prepare(f.owner, f.business.id, f.input);
    await f.eligibility.suppress(f.owner, f.business.id, {
      requestKey: crypto.randomUUID(),
      recipient: f.recipient.address,
      scope: "recipient_outreach",
      opportunityId: null,
      reference: "Opted out",
      effectiveAt: h.clock.now().toISOString(),
    });
    await expect(
      f.handoffs.prepare(f.owner, f.business.id, f.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const operation of ["open", "copy_body"] as const)
      await expect(
        f.handoffs.use(f.owner, f.business.id, {
          handoffId: row.id,
          operation,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    // Recording what a person asserts happened remains possible after a restriction; it grants no outbound authority.
    await f.handoffs.markSent(f.owner, f.business.id, { handoffId: row.id });
    expect(
      (
        await f.handoffs.workspace(f.owner, f.business.id)
      ).handoffs[0].evidence.map((e) => e.kind),
    ).toEqual(["prepared", "user_marked_sent"]);
    const g = await setup();
    const draft = g.draft();
    await g.app.save(g.owner, g.business.id, {
      ...draft,
      campaignId: g.r.campaignId,
      expectedVersion: 1,
      steps: [{ subject: "Changed", body: "Changed", delayMinutes: 0 }],
      maxAttempts: 1,
    });
    await expect(
      g.handoffs.prepare(g.owner, g.business.id, g.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const k = await setup();
    await k.discover("newly-discovered@fabricator.example");
    await expect(
      k.handoffs.prepare(k.owner, k.business.id, k.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("applies a restriction that wins the shared Business guard before preparation, and rejects a time boundary crossed while persisting", async () => {
    const f = await setup();
    const gate = await h.admin.connect();
    async function blocked(count: number) {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const r = await h.admin.query<{ count: string }>(
          "select count(*) from pg_locks where locktype='advisory' and not granted",
        );
        if (Number(r.rows[0].count) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Preparation concurrency barrier not reached");
    }
    await gate.query("select pg_advisory_lock(hashtextextended($1,0))", [
      f.business.id,
    ]);
    const restriction = f.eligibility.suppress(f.owner, f.business.id, {
      requestKey: crypto.randomUUID(),
      recipient: f.recipient.address,
      scope: "recipient_outreach",
      opportunityId: null,
      reference: "Current restriction",
      effectiveAt: h.clock.now().toISOString(),
    });
    await blocked(1);
    const prepared = Promise.allSettled([
      f.handoffs.prepare(f.owner, f.business.id, f.input),
    ]);
    try {
      await blocked(2);
      await gate.query("select pg_advisory_unlock_all()");
      await restriction;
      expect(await prepared).toMatchObject([
        { status: "rejected", reason: { code: "CONFLICT" } },
      ]);
      expect(
        (await f.handoffs.workspace(f.owner, f.business.id)).handoffs,
      ).toEqual([]);
      const g = await setup();
      await g.eligibility.suppress(g.owner, g.business.id, {
        requestKey: crypto.randomUUID(),
        recipient: g.recipient.address,
        scope: "recipient_outreach",
        opportunityId: null,
        reference: "Future restriction",
        effectiveAt: "2026-11-05T09:01:00Z",
      });
      await gate.query("select pg_advisory_lock(330033)");
      await h.admin.query(
        "CREATE FUNCTION test_handoff_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(330033); RETURN NEW; END $$; CREATE TRIGGER test_handoff_barrier BEFORE INSERT ON email_handoff FOR EACH ROW EXECUTE FUNCTION test_handoff_barrier()",
      );
      const crossing = Promise.allSettled([
        g.handoffs.prepare(g.owner, g.business.id, g.input),
      ]);
      await blocked(1);
      h.clock.set("2026-11-05T09:01:00Z");
      await gate.query("select pg_advisory_unlock_all()");
      expect(await crossing).toMatchObject([
        { status: "rejected", reason: { code: "CONFLICT" } },
      ]);
      expect(
        (await g.handoffs.workspace(g.owner, g.business.id)).handoffs,
      ).toEqual([]);
    } finally {
      await gate.query("select pg_advisory_unlock_all()");
      gate.release();
      await h.admin.query(
        "DROP TRIGGER IF EXISTS test_handoff_barrier ON email_handoff; DROP FUNCTION IF EXISTS test_handoff_barrier()",
      );
    }
  });
  it("accepts a reviewed Graph Sent Items source while rejecting changed content, wrong participants and unrelated RFC replies", async () => {
    const f = await setup("microsoft"),
      prepared = await f.handoffs.prepare(f.owner, f.business.id, f.input),
      database = runtimeDatabase(h.runtime);
    const graph = microsoftMailFixture(h.clock);
    const settings = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const mailbox = await settings.save(f.owner, f.business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: f.sender.connection.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["sales", "sent"] },
        history: null,
        salesSubjectTerms: ["steel"],
      },
    });
    const connection = createMicrosoftMailConnection(database, {
      clock: h.clock,
      configuration: graph.configuration,
      fetch: graph.fetch,
    });
    const auth = createMicrosoftMailApplication({
      access: h.access,
      connection,
    });
    const start = await auth.start(f.owner, f.business.id, mailbox.id);
    graph.identity.nonce =
      new URL(start.authorizationUrl).searchParams.get("nonce") ?? "";
    await auth.callback(f.owner, f.business.id, mailbox.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    const sync = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      enqueue: async () => {},
      repository: createMailboxRepository(database, h.clock),
      provider: createMicrosoftMailProvider(connection, h.clock),
      clock: h.clock,
    });
    graph.add("sent1", {
      folder: "sent",
      from: f.sender.identity.configuration.fromAddress,
      to: f.recipient.address,
      subject: f.r.snapshot.steps[0].subject,
      text: f.r.snapshot.steps[0].body,
    });
    graph.add("edited1", {
      folder: "sent",
      from: f.sender.identity.configuration.fromAddress,
      to: f.recipient.address,
      subject: f.r.snapshot.steps[0].subject,
      text: "Changed outside this app",
    });
    graph.add("wrong1", {
      folder: "sent",
      from: f.sender.identity.configuration.fromAddress,
      to: "other@example.com",
      subject: f.r.snapshot.steps[0].subject,
      text: f.r.snapshot.steps[0].body,
    });
    graph.add("bcc1", {
      folder: "sent",
      from: f.sender.identity.configuration.fromAddress,
      to: f.recipient.address,
      bcc: "other@example.com",
      subject: f.r.snapshot.steps[0].subject,
      text: f.r.snapshot.steps[0].body,
    });
    graph.add("reply1", {
      at: "2026-11-05T09:02:00Z",
      from: f.recipient.address,
      subject: "Steel reply",
      reply: "<sent1@example.com>",
    });
    graph.add("unrelated1", {
      at: "2026-11-05T09:02:00Z",
      from: f.recipient.address,
      subject: "Steel reply",
      reply: "<other@example.com>",
    });
    graph.pages.set("sent", {
      value: ["sent1", "edited1", "wrong1", "bcc1"].map((id) => ({ id })),
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=sent-steady",
    });
    graph.pages.set("sales", {
      value: [{ id: "reply1" }, { id: "unrelated1" }],
      "@odata.deltaLink":
        "https://graph.microsoft.com/v1.0/me/mailFolders/sales/messages/delta?$deltatoken=sales-steady",
    });
    h.clock.set("2026-11-05T09:03:00Z");
    const work = await sync.queue(f.owner, f.business.id, mailbox.id, {
      mode: "incremental",
    });
    let result = await sync.execute(work);
    for (let i = 0; result?.status === "partial" && i < 10; i++)
      result = await sync.execute(work);
    expect(result?.status).toBe("completed");
    let row = (await f.handoffs.workspace(f.owner, f.business.id)).handoffs[0];
    expect(row.candidates).toHaveLength(1);
    expect(row.candidates[0].source.provider).toBe("microsoft");
    row = await f.handoffs.bindSent(f.owner, f.business.id, {
      handoffId: prepared.id,
      observationId: row.candidates[0].id,
      confirmExactMessage: true,
    });
    expect(row.evidence.map((e) => e.kind)).toEqual([
      "prepared",
      "sent_folder_observed",
      "reply_observed",
    ]);
    expect(row.evidence[2].source?.messageRef).toBe("reply1");
    expect(
      graph.calls.some((c) => /sendMail|\/send$/.test(c.url.pathname)),
    ).toBe(false);
  });
  it("keeps ambiguous native matches for explicit review and rejects cross-Business, stale and differently bound observations", async () => {
    const f = await setup(),
      prepared = await f.handoffs.prepare(f.owner, f.business.id, f.input),
      n = await native(f);
    n.addSent("sent1");
    n.addSent("sent2");
    n.google.pages.set("Label_sales", {
      messages: [
        { id: "sent1", threadId: "abc123" },
        { id: "sent2", threadId: "abc123" },
      ],
    });
    h.clock.set("2026-11-05T09:03:00Z");
    await n.synchronize();
    let row = (await f.handoffs.workspace(f.owner, f.business.id)).handoffs[0];
    expect(row.candidates).toHaveLength(2);
    expect(row.evidence.map((e) => e.kind)).toEqual(["prepared"]);
    const [first, second] = row.candidates;
    const otherBusiness = await h.application.createBusiness(f.owner, {
      name: "Other",
      offering: "Other",
      homeMarket: "US",
      website: "",
    });
    await expect(
      f.handoffs.bindSent(f.owner, otherBusiness.id, {
        handoffId: prepared.id,
        observationId: first.id,
        confirmExactMessage: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await f.handoffs.bindSent(f.owner, f.business.id, {
      handoffId: prepared.id,
      observationId: first.id,
      confirmExactMessage: true,
    });
    await expect(
      f.handoffs.bindSent(f.owner, f.business.id, {
        handoffId: prepared.id,
        observationId: second.id,
        confirmExactMessage: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    h.clock.set("2026-11-05T09:08:00Z");
    row = (await f.handoffs.workspace(f.owner, f.business.id)).handoffs[0];
    expect(row.visibility).toBe("unavailable");
    expect(row.evidence.map((e) => e.kind)).toEqual([
      "prepared",
      "sent_folder_observed",
    ]);
    expect(row.candidates).toEqual([]);
    await expect(
      f.handoffs.bindSent(f.owner, f.business.id, {
        handoffId: prepared.id,
        observationId: first.id,
        confirmExactMessage: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("allows current sales staff to prepare and assert, requires a manager for native binding and rejects revoked actors without losing history", async () => {
    const f = await setup();
    const email = `handoff-sales-${crypto.randomUUID()}@example.com`;
    await h.team.invite(f.owner, f.business.id, { email, role: "salesperson" });
    const sales = await h.signIn(email, false);
    await h.team.accept(sales, {
      token: new URLSearchParams(
        new URL(h.invitations.sent.at(-1)!.url).hash.slice(1),
      ).get("token"),
    });
    const row = await f.handoffs.prepare(sales, f.business.id, f.input);
    expect((await f.handoffs.workspace(sales, f.business.id)).canBind).toBe(
      false,
    );
    await f.handoffs.markSent(sales, f.business.id, { handoffId: row.id });
    await expect(
      f.handoffs.bindSent(sales, f.business.id, {
        handoffId: row.id,
        observationId: crypto.randomUUID(),
        confirmExactMessage: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.team.removeMember(
      f.owner,
      f.business.id,
      await h.authenticate(sales),
    );
    for (const command of ["markSent", "workspace"] as const)
      await expect(
        command === "workspace"
          ? f.handoffs.workspace(sales, f.business.id)
          : f.handoffs.markSent(sales, f.business.id, { handoffId: row.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const primary = await h.signIn(
      (await h.auth.api.getSession({ headers: f.owner }))!.user.email,
      false,
    );
    await expect(
      f.handoffs.workspace(primary, f.business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(
      (
        await f.handoffs.workspace(f.owner, f.business.id)
      ).handoffs[0].evidence.map((e) => e.kind),
    ).toEqual(["prepared", "user_marked_sent"]);
  });
  it("preserves immutable handoffs, assertions and forced scoped history across a populated additive schema push", async () => {
    const f = await setup();
    const rows = await Promise.all([
      f.handoffs.prepare(f.owner, f.business.id, f.input),
      f.handoffs.prepare(f.owner, f.business.id, f.input),
    ]);
    expect(rows[0].id).toBe(rows[1].id);
    await Promise.all([
      f.handoffs.markSent(f.owner, f.business.id, { handoffId: rows[0].id }),
      f.handoffs.markSent(f.owner, f.business.id, { handoffId: rows[0].id }),
    ]);
    await h.reapplySchema();
    const restored = await f.newApp().workspace(f.owner, f.business.id);
    expect(restored.handoffs).toHaveLength(1);
    expect(restored.handoffs[0].evidence.map((e) => e.kind)).toEqual([
      "prepared",
      "user_marked_sent",
    ]);
    const security = await h.admin.query<{
      relname: string;
      relforcerowsecurity: boolean;
      mutable: boolean;
    }>(
      "select c.relname,c.relforcerowsecurity,has_table_privilege('app_runtime',c.oid,'UPDATE,DELETE') as mutable from pg_class c where c.relname in ('email_handoff','email_handoff_evidence')",
    );
    expect(security.rows).toHaveLength(2);
    expect(
      security.rows.every((r) => r.relforcerowsecurity && !r.mutable),
    ).toBe(true);
    const other = await h.signIn(
        `handoff-other-${crypto.randomUUID()}@example.com`,
      ),
      actor = await h.authenticate(other),
      connection = await h.runtime.connect();
    try {
      await connection.query("begin");
      await connection.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true)",
        [actor.userId, f.business.id],
      );
      expect(
        (await connection.query("select id from email_handoff")).rows,
      ).toEqual([]);
      expect(
        (await connection.query("select id from email_handoff_evidence")).rows,
      ).toEqual([]);
    } finally {
      await connection.query("rollback");
      connection.release();
    }
  });
});
