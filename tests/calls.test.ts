import { persistPaidSubscription } from "./support/paid-subscription";
import { randomUUID } from "node:crypto";
import { readySender, fixtureMailBinding } from "./support/senders";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createCallApplication } from "../src/application/calls";
import { createCallRepository } from "../src/db/call-repository";
import { createCallHttp } from "../src/http/calls";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import type { OpportunityDispatch } from "../src/models/opportunity-control";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { createCommercialApplication } from "../src/application/commercial-actions";
import { createCommercialRepository } from "../src/db/commercial-actions-repository";
import { createAppointmentApplication } from "../src/application/appointments";
import { createAppointmentRepository } from "../src/db/appointment-repository";
import { deterministicCalendar } from "./support/calendar";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallTimeline } from "../src/components/call-timeline";

describe("Human calls through the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`calls-${randomUUID()}@example.com`);
    const actor = await h.authenticate(credentials);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Products and services",
      homeMarket: "US",
      website: "",
    });
    await persistPaidSubscription(h, credentials, business.id, {
      markets: ["US"],
      discovery: { quantity: 0, unit: "research units" },
      automation: { quantity: 10000, unit: "provider calls" },
    });
    const database = runtimeDatabase(h.runtime);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(database),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
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
      subject: "Purchase",
      text: "Please discuss our requirements",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const workspace = await inbox.workspace(credentials, business.id);
    const need = workspace.opportunities[0];
    const application = createCallApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createCallRepository(database, h.clock),
    });
    const read = () => application.read(credentials, business.id, need.id);
    const input = {
      callId: null,
      expectedVersion: 0,
      expectedControlVersion: 0,
      requestKey: randomUUID(),
      buyerId: need.buyerId,
      responsibleId: actor.userId,
      occurredAt: "2026-11-04T15:30:00Z",
      notes: "Discussed their requirements",
      outcome: "Buyer requested a follow-up",
      nextAction: "Call after requirements review",
    };
    const effects: OpportunityDispatch[] = [];
    const opportunities = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(database, h.clock),
      clock: h.clock,
      provider: {
        emailIdentity: fixtureMailBinding,
        channels: ["email", "whatsapp"],
        async dispatch(action) {
          effects.push(action);
        },
      },
    });
    return {
      credentials,
      actor,
      business,
      database,
      inbox,
      connection,
      workspace,
      need,
      application,
      read,
      input,
      opportunities,
      effects,
    };
  }
  it("creates, updates and reloads one attributed call with honest occurrence and audit times", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    expect(first.callCount).toBe(1);
    expect(first.calls[0]).toMatchObject({
      buyerId: f.need.buyerId,
      opportunityId: f.need.id,
      version: 1,
      actorId: f.actor.userId,
      responsibleId: f.actor.userId,
      occurredAt: "2026-11-04T15:30:00.000Z",
      at: "2026-11-05T09:00:00.000Z",
      notes: f.input.notes,
      outcome: f.input.outcome,
      nextAction: f.input.nextAction,
      recordedBy: f.actor.userId,
      recordedAt: "2026-11-05T09:00:00.000Z",
    });
    expect(first.calls[0].actorName).toBeTruthy();
    expect(first.calls[0].responsibleName).toBeTruthy();
    h.clock.set("2026-11-05T10:00:00Z");
    const next = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        callId: first.calls[0].id,
        expectedVersion: 1,
        expectedControlVersion: first.controlVersion,
        requestKey: randomUUID(),
        notes: "Corrected written notes",
        outcome: "Requested specifications",
        nextAction: "Request specifications",
      },
    );
    expect(await f.read()).toEqual(next);
    expect(next.callCount).toBe(1);
    expect(next.calls[0]).toMatchObject({
      id: first.calls[0].id,
      version: 2,
      recordedAt: "2026-11-05T09:00:00.000Z",
      at: "2026-11-05T10:00:00.000Z",
    });
    expect(next.history.map((r) => [r.version, r.notes, r.at])).toEqual([
      [1, "Discussed their requirements", "2026-11-05T09:00:00.000Z"],
      [2, "Corrected written notes", "2026-11-05T10:00:00.000Z"],
    ]);
  });
  it("serves persisted calls over HTTP, validates untrusted input and keeps diagnostics private", async () => {
    const f = await fixture();
    const http = createCallHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const request = (input: unknown, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/calls", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie")!,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const saved = await http.save(request(f.input), f.business.id, f.need.id);
    expect(saved.status).toBe(200);
    const reloaded = await http.read(
      new Request("http://localhost:3000/api/calls", {
        headers: f.credentials,
      }),
      f.business.id,
      f.need.id,
    );
    expect(await reloaded.json()).toEqual(await saved.json());
    expect(
      (
        await http.save(
          request(f.input, "https://attacker.example"),
          f.business.id,
          f.need.id,
        )
      ).status,
    ).toBe(403);
    for (const patch of [
      { actorId: "private-forged-actor" },
      { notes: "\0private-notes" },
      { outcome: "" },
      { occurredAt: "not-a-date" },
      {
        occurredAt: "0000-01-01T00:00:00Z",
        expectedControlVersion: 1,
        requestKey: randomUUID(),
      },
      { notes: "x".repeat(8001) },
    ]) {
      const invalid = await http.save(
        request({ ...f.input, ...patch }),
        f.business.id,
        f.need.id,
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.text()).not.toContain("private-");
    }
    expect(JSON.stringify(h.diagnostics)).not.toContain("private-");
    expect((await f.read()).callCount).toBe(1);
  });
  it("serializes duplicate creates and edits, rejects stale or changed commands, and counts calls rather than revisions", async () => {
    const f = await fixture();
    const save = (input: unknown) =>
      f.application.save(f.credentials, f.business.id, f.need.id, input);
    const [first, replay] = await Promise.all([save(f.input), save(f.input)]);
    expect(replay).toEqual(first);
    expect(first.history).toHaveLength(1);
    expect(first.controlVersion).toBe(1);
    await expect(
      save({ ...f.input, notes: "Changed replay" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const update = {
      ...f.input,
      callId: first.calls[0].id,
      expectedVersion: 1,
      expectedControlVersion: 1,
      requestKey: randomUUID(),
      notes: "Revised notes",
    };
    const [second, duplicate] = await Promise.all([save(update), save(update)]);
    expect(duplicate).toEqual(second);
    expect(second.callCount).toBe(1);
    expect(second.history).toHaveLength(2);
    expect(second.controlVersion).toBe(2);
    const race = await Promise.allSettled([
      save({
        ...update,
        expectedVersion: 2,
        expectedControlVersion: 2,
        requestKey: randomUUID(),
        notes: "Race A",
      }),
      save({
        ...update,
        expectedVersion: 2,
        expectedControlVersion: 2,
        requestKey: randomUUID(),
        notes: "Race B",
      }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(
      save({ ...update, requestKey: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const current = await f.read();
    expect(current.history).toHaveLength(3);
    const another = await save({
      ...f.input,
      requestKey: randomUUID(),
      expectedControlVersion: current.controlVersion,
      outcome: "No answer",
    });
    expect(another.callCount).toBe(2);
    expect(another.history).toHaveLength(4);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .history,
    ).toHaveLength(4);
  });
  it("keeps two purchasing needs for one buyer distinct through message corrections", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    const conversation = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      f.workspace.conversations[0].id,
    );
    await f.inbox.associate(f.credentials, f.business.id, conversation.id, {
      expectedVersion: conversation.association.version,
      buyerId: f.need.buyerId,
      messageIds: [conversation.messages[0].id],
      target: { kind: "new", title: "Separate purchasing need" },
      future: "keep",
      reason: "Buyer clarified a separate purchase",
    });
    const corrected = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      conversation.id,
    );
    const secondId = corrected.messages[0].opportunityId!;
    expect(secondId).not.toBe(f.need.id);
    const second = await f.application.save(
      f.credentials,
      f.business.id,
      secondId,
      { ...f.input, requestKey: randomUUID(), notes: "Second purchase only" },
    );
    expect(second.calls[0]).toMatchObject({
      buyerId: f.need.buyerId,
      opportunityId: secondId,
      notes: "Second purchase only",
    });
    expect(second.calls[0].id).not.toBe(first.calls[0].id);
    expect(await f.read()).toEqual(first);
    await expect(
      f.application.save(f.credentials, f.business.id, secondId, {
        ...f.input,
        callId: first.calls[0].id,
        expectedVersion: 1,
        expectedControlVersion: second.controlVersion,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await f.application.read(f.credentials, f.business.id, secondId))
        .callCount,
    ).toBe(1);
  });
  it("denies invalid and cross-Business buyers, needs, calls and responsible people without partial activity", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      f.application.read(other.credentials, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.read(f.credentials, other.business.id, other.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.read(f.credentials, f.business.id, other.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.read(new Headers(), f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const save = (patch: object) =>
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        ...patch,
      });
    const foreign = await other.application.save(
      other.credentials,
      other.business.id,
      other.need.id,
      other.input,
    );
    await expect(
      save({ callId: foreign.calls[0].id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const buyerId of [other.need.buyerId, randomUUID()])
      await expect(save({ buyerId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    for (const responsibleId of [other.actor.userId, "missing-member"])
      await expect(save({ responsibleId })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    for (const patch of [
      { buyerId: "not-uuid" },
      { callId: randomUUID(), expectedVersion: 0 },
      { occurredAt: "2026-11-06T10:00:00Z" },
      { audioUrl: "https://private.example/audio" },
      { saleConfirmed: true },
    ]) {
      await expect(save(patch)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    await expect(
      save({ callId: randomUUID(), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await f.read()).history).toEqual([]);
    expect(
      (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
        .version,
    ).toBe(0);
  });
  it("allows a salesperson to record a colleague's call while retaining separate entry and update attribution", async () => {
    const f = await fixture();
    const sales = await h.signIn(
      `call-sales-${randomUUID()}@example.com`,
      false,
    );
    const salesActor = await h.authenticate(sales);
    await h.admin.query(
      "INSERT INTO membership (business_id,user_id,role) VALUES ($1,$2,'salesperson')",
      [f.business.id, salesActor.userId],
    );
    const first = await f.application.save(
      sales,
      f.business.id,
      f.need.id,
      f.input,
    );
    expect(first.calls[0]).toMatchObject({
      actorId: salesActor.userId,
      recordedBy: salesActor.userId,
      responsibleId: f.actor.userId,
    });
    expect(first.members.map((m) => m.userId).sort()).toEqual(
      [f.actor.userId, salesActor.userId].sort(),
    );
    const colleagueUpdate = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        callId: first.calls[0].id,
        expectedVersion: 1,
        expectedControlVersion: first.controlVersion,
        requestKey: randomUUID(),
        notes: "Corrected by colleague",
      },
    );
    expect(colleagueUpdate.calls[0]).toMatchObject({
      actorId: f.actor.userId,
      recordedBy: salesActor.userId,
      responsibleId: f.actor.userId,
    });
    await h.admin.query('UPDATE "user" SET name=$1 WHERE id=$2', [
      "Renamed recorder",
      salesActor.userId,
    ]);
    expect((await f.read()).history[0].actorName).toBe(
      first.calls[0].actorName,
    );
    await h.admin.query(
      "DELETE FROM membership WHERE business_id=$1 AND user_id=$2",
      [f.business.id, salesActor.userId],
    );
    expect((await f.read()).calls[0].recordedByName).toBe(
      first.calls[0].recordedByName,
    );
    await expect(
      f.application.read(sales, f.business.id, f.need.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.save(sales, f.business.id, f.need.id, f.input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.save(f.credentials, f.business.id, f.need.id, {
        ...f.input,
        expectedControlVersion: colleagueUpdate.controlVersion,
        requestKey: randomUUID(),
        responsibleId: salesActor.userId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("pauses only the relevant need, cancels queued sends and creates no sales, appointments or communication effects", async () => {
    const f = await fixture();
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(f.database),
      clock: h.clock,
    });
    const policy = await authority.workspace(f.credentials, f.business.id);
    policy.policy.prices = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "10000" },
      discountLimitBps: 0,
      escalationOwnerId: f.actor.userId,
    };
    await authority.save(f.credentials, f.business.id, {
      expectedVersion: policy.version,
      policy: policy.policy,
      note: "Approved explicit price fixture",
    });
    await f.opportunities.change(f.credentials, f.business.id, f.need.id, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Review need",
      nextAction: "Review",
    });
    await f.opportunities.change(f.credentials, f.business.id, f.need.id, {
      command: "handback",
      expectedVersion: 1,
      reason: "Ready",
      nextAction: "Evaluate automation",
    });
    await f.inbox.capture(f.credentials, f.business.id, f.connection.id, {
      eventId: "second",
      messageRef: "second",
      conversationRef: "second-need",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Another purchase",
      text: "A separate request",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const otherNeed = (
      await f.inbox.workspace(f.credentials, f.business.id)
    ).opportunities.find((n) => n.id !== f.need.id)!;
    await f.opportunities.change(f.credentials, f.business.id, otherNeed.id, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Review separately",
      nextAction: "Review",
    });
    await f.opportunities.change(f.credentials, f.business.id, otherNeed.id, {
      command: "handback",
      expectedVersion: 1,
      reason: "Ready separately",
      nextAction: "Evaluate separately",
    });
    const unrelated = await f.opportunities.read(
      f.credentials,
      f.business.id,
      otherNeed.id,
    );
    const before = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      f.workspace.conversations[0].id,
    );
    const queued = await f.opportunities.queue(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        messageId: before.messages[0].id,
        dueAt: h.clock.now().toISOString(),
        evaluation: {
          action: "prices",
          amount: { currency: "USD", minor: "500" },
          discountBps: 0,
        },
      },
    );
    const mailCount = h.mail.sent.length;
    const saved = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        expectedControlVersion: 2,
        outcome:
          "Buyer said they will order and attend; awaiting authoritative confirmation",
      },
    );
    const control = await f.opportunities.read(
      f.credentials,
      f.business.id,
      f.need.id,
    );
    expect(control).toMatchObject({
      state: "human",
      ownerId: f.actor.userId,
      nextAction: f.input.nextAction,
      version: 3,
    });
    expect(control.actions).toEqual([
      { ...queued, state: "cancelled", reason: "control_changed" },
    ]);
    expect(
      (await f.opportunities.dispatch(f.credentials, f.business.id, queued.id))
        .state,
    ).toBe("cancelled");
    const commercialEffects: unknown[] = [];
    const commercial = createCommercialApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createCommercialRepository(f.database, h.clock),
      provider: {
        key: "fixture",
        available: true,
        async execute(action) {
          commercialEffects.push(action);
          throw new Error("Unexpected commercial execution");
        },
      },
    });
    const calendar = deterministicCalendar(f.business.id, h.clock);
    const appointments = createAppointmentApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createAppointmentRepository(f.database, h.clock),
      clock: h.clock,
      provider: calendar.provider,
      timeoutMs: 1000,
    });
    expect(
      (await commercial.read(f.credentials, f.business.id, f.need.id)).outcomes,
    ).toEqual([]);
    expect(
      (await commercial.read(f.credentials, f.business.id, f.need.id)).actions,
    ).toEqual([]);
    expect(
      (await appointments.read(f.credentials, f.business.id, f.need.id))
        .appointments,
    ).toEqual([]);
    expect(calendar.effects).toEqual([]);
    expect(commercialEffects).toEqual([]);
    expect(f.effects).toEqual([]);
    expect(h.mail.sent).toHaveLength(mailCount);
    expect(
      await f.opportunities.read(f.credentials, f.business.id, otherNeed.id),
    ).toEqual(unrelated);
    // Voice, audio and recording fields are rejected at the same boundary, not interpreted as actions.
    for (const patch of [
      { placeCall: true },
      { recording: "private-audio" },
      { audio: "private-audio" },
    ]) {
      await expect(
        f.application.save(f.credentials, f.business.id, f.need.id, {
          ...f.input,
          ...patch,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const after = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      before.id,
    );
    expect(after.messages).toEqual(before.messages);
    expect(after.opportunity.stage).toBe("inquiry");
    expect((await f.read()).calls[0].id).toBe(saved.calls[0].id);
  });
  for (const operation of ["read", "save"] as const) {
    it(`rechecks current session and MFA under the transaction lock for ${operation}`, async () => {
      const f = await fixture();
      const identity = await h.access.authenticateForWork(f.credentials);
      const primary = await h.signIn(
        (await h.auth.api.getSession({ headers: f.credentials }))!.user.email,
        false,
      );
      const invoke = (
        app: typeof f.application,
        credentials = f.credentials,
      ) =>
        operation === "read"
          ? app.read(credentials, f.business.id, f.need.id)
          : app.save(credentials, f.business.id, f.need.id, f.input);
      await expect(invoke(f.application, primary)).rejects.toMatchObject({
        code: "MFA_REQUIRED",
      });
      const changed = createCallApplication({
        authenticateForWork: async (credentials: Headers) => {
          const current = await h.access.authenticateForWork(credentials);
          await h.admin.query(
            "UPDATE session SET mfa_verified_at=NULL WHERE id=$1",
            [current.sessionId],
          );
          return current;
        },
        repository: createCallRepository(f.database, h.clock),
      });
      await expect(invoke(changed)).rejects.toMatchObject({
        code: "MFA_REQUIRED",
      });
      const revoked = createCallApplication<Headers>({
        authenticateForWork: async () => identity,
        repository: createCallRepository(f.database, h.clock),
      });
      await h.signOut(f.credentials);
      await expect(invoke(revoked)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    });
    it(`rechecks revoked membership and a role's new MFA requirement for ${operation}`, async () => {
      const f = await fixture();
      const credentials = await h.signIn(
        `call-role-${randomUUID()}@example.com`,
        false,
      );
      const actor = await h.authenticate(credentials);
      await h.admin.query(
        "INSERT INTO membership (business_id,user_id,role) VALUES ($1,$2,'salesperson')",
        [f.business.id, actor.userId],
      );
      const invoke = (app: typeof f.application) =>
        operation === "read"
          ? app.read(credentials, f.business.id, f.need.id)
          : app.save(credentials, f.business.id, f.need.id, f.input);
      const changed = createCallApplication({
        authenticateForWork: async (headers: Headers) => {
          const identity = await h.access.authenticateForWork(headers);
          await h.admin.query(
            "UPDATE membership SET role='admin' WHERE business_id=$1 AND user_id=$2",
            [f.business.id, actor.userId],
          );
          return identity;
        },
        repository: createCallRepository(f.database, h.clock),
      });
      await expect(invoke(changed)).rejects.toMatchObject({
        code: "MFA_REQUIRED",
      });
      await h.admin.query(
        "UPDATE membership SET role='salesperson' WHERE business_id=$1 AND user_id=$2",
        [f.business.id, actor.userId],
      );
      const removed = createCallApplication({
        authenticateForWork: async (headers: Headers) => {
          const identity = await h.access.authenticateForWork(headers);
          await h.admin.query(
            "DELETE FROM membership WHERE business_id=$1 AND user_id=$2",
            [f.business.id, actor.userId],
          );
          return identity;
        },
        repository: createCallRepository(f.database, h.clock),
      });
      await expect(invoke(removed)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await f.read()).history).toEqual([]);
      expect(
        (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
          .history,
      ).toEqual([]);
    });
  }
  it("renders written notes, outcomes, attribution, next actions and previous revisions as inert text", async () => {
    const f = await fixture();
    const malicious =
      '<script>sendSecrets()</script><img src=x onerror="sendSecrets()">';
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        notes: malicious,
        outcome: "<b>Won sale</b>",
        nextAction: "<a href=javascript:bad()>Review</a>",
      },
    );
    const state = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      {
        ...f.input,
        callId: first.calls[0].id,
        expectedVersion: 1,
        expectedControlVersion: first.controlVersion,
        requestKey: randomUUID(),
        notes: "Corrected notes",
      },
    );
    const html = renderToStaticMarkup(createElement(CallTimeline, { state }));
    expect(html).toContain("Corrected notes");
    expect(html).toContain("&lt;script&gt;sendSecrets()&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Won sale&lt;/b&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;a href=javascript:bad()&gt;Review&lt;/a&gt;");
    for (const value of [
      "Occurred:",
      "04/11/2026",
      "15:30",
      "UTC",
      "Responsible person:",
      "Next action:",
      "First recorded by",
      state.calls[0].actorName,
      "Revision 1",
      "Revision 2",
    ])
      expect(html).toContain(value);
  });
  it("preserves call provenance and corrected message associations through additive schema reapplication", async () => {
    const f = await fixture();
    const first = await f.application.save(
      f.credentials,
      f.business.id,
      f.need.id,
      f.input,
    );
    const c = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      f.workspace.conversations[0].id,
    );
    await f.inbox.associate(f.credentials, f.business.id, c.id, {
      expectedVersion: c.association.version,
      buyerId: f.need.buyerId,
      messageIds: [c.messages[0].id],
      target: { kind: "new", title: "Corrected purchasing need" },
      future: "target",
      reason: "Correct original message association",
    });
    const corrected = await f.inbox.conversation(
      f.credentials,
      f.business.id,
      c.id,
    );
    await h.reapplySchema();
    expect(await f.read()).toEqual(first);
    expect(
      await f.inbox.conversation(f.credentials, f.business.id, c.id),
    ).toEqual(corrected);
  });
  it("completes create, update and reload with external HTTP disabled and zero voice, recording, calendar or send effects", async () => {
    const f = await fixture();
    const external = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("All external services unavailable"));
    const mailCount = h.mail.sent.length;
    try {
      const first = await f.application.save(
        f.credentials,
        f.business.id,
        f.need.id,
        f.input,
      );
      const updated = await f.application.save(
        f.credentials,
        f.business.id,
        f.need.id,
        {
          ...f.input,
          callId: first.calls[0].id,
          expectedVersion: 1,
          expectedControlVersion: first.controlVersion,
          requestKey: randomUUID(),
          outcome: "No answer; retry manually",
        },
      );
      expect(await f.read()).toEqual(updated);
      expect(external).not.toHaveBeenCalled();
      expect(h.mail.sent).toHaveLength(mailCount);
      expect(f.effects).toEqual([]);
      expect(
        (await f.opportunities.read(f.credentials, f.business.id, f.need.id))
          .actions,
      ).toEqual([]);
    } finally {
      external.mockRestore();
    }
  });
});
