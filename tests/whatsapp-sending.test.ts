import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { metaSendingFixture } from "./support/meta-sending";
import { verifyRuntimeRole } from "../src/db/runtime";
import { createWhatsAppSendingHttp } from "../src/http/whatsapp-sending";

describe("WhatsApp sends through current public application commands", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("blocks an ordinary grounded inquiry without WhatsApp permission, independently of email policy", async () => {
    const f = await metaSendingFixture(h, "permission");
    const action = await f.groundedReply();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "whatsapp_permission_required",
    });
    expect(f.sent).toEqual([]);
  });
  it("sends the persisted ordinary reply and parent once, retaining acceptance separately from delivery", async () => {
    const f = await metaSendingFixture(h, "ordinary");
    await f.permission();
    const action = await f.groundedReply();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "dispatched",
      reason: "whatsapp_accepted_delivery_unconfirmed",
    });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({
      to: "919876543210",
      type: "text",
      context: { message_id: "wamid.inquiry" },
      biz_opaque_callback_data: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(f.sent[0].text).toMatchObject({
      body: expect.stringContaining("quotation-request review"),
    });
    expect(f.sent[0].biz_opaque_callback_data).not.toBe(action.id);
    expect(
      JSON.stringify(await f.app.workspace(f.credentials, f.businessId)),
    ).not.toContain(String(f.sent[0].biz_opaque_callback_data));
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
    const restarted = f.restart();
    await restarted.recoverDue();
    expect(f.sent).toHaveLength(1);
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).actions[0],
    ).toMatchObject({
      providerMessageRef: "wamid.out-1",
      evidence: "accepted",
    });
  });
  it("keeps ambiguous acceptance reserved across restart until an exact signed account, recipient and action status resolves it", async () => {
    const f = await metaSendingFixture(h, "ambiguous");
    await f.permission();
    const action = await f.groundedReply();
    f.httpState.ambiguous = true;
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "committed",
      reason: "whatsapp_acceptance_unknown",
    });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.wrong-recipient",
          status: "delivered",
          timestamp: String(Math.floor(h.clock.now().getTime() / 1000)),
          recipient_id: "919876543211",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
        },
      ],
    });
    await f.intake.drain();
    await f.app.reconcile(f.credentials, f.businessId, { actionId: action.id });
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).actions[0].evidence,
    ).toBe("unresolved");
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.out-1",
          status: "delivered",
          timestamp: String(Math.floor(h.clock.now().getTime() / 1000)),
          recipient_id: "919876543210",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
          pricing: {
            billable: true,
            pricing_model: "PMP",
            category: "marketing",
            type: "regular",
          },
        },
      ],
    });
    await f.intake.drain();
    await f.restart().recoverDue();
    const workspace = await f.restart().reconcile(f.credentials, f.businessId, {
      actionId: action.id,
    });
    expect(workspace.actions[0]).toMatchObject({
      evidence: "delivered",
      providerMessageRef: "wamid.out-1",
    });
    expect(workspace.usage[0]).toMatchObject({
      state: "observed_unpriced",
      currency: null,
      minor: null,
      provenance: "authenticated_meta_status",
    });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
  });
  it("requires an immutable Owner approval, sends its fixed recipient only and durably bounds follow-up timing and attempts", async () => {
    const f = await metaSendingFixture(h, "outreach"),
      o = await f.outreach();
    const saved = await f.app.savePlan(f.credentials, f.businessId, o.plan),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await expect(
      f.app.start(f.credentials, f.businessId, ref),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    const started = await f.app.start(f.credentials, f.businessId, ref);
    expect(started.actions).toHaveLength(2);
    expect(f.sent).toHaveLength(0);
    const actions = [...started.actions].sort((a, b) =>
      a.dueAt.localeCompare(b.dueAt),
    );
    await f.control.dispatch(f.credentials, f.businessId, actions[1].id);
    expect(f.sent).toHaveLength(0);
    await f.control.dispatch(f.credentials, f.businessId, actions[0].id);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({
      type: "template",
      to: "919876543211",
      template: {
        name: "steel_offer",
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Pat" }] },
        ],
      },
    });
    h.clock.set("2026-11-05T09:01:00Z");
    await f.control.dispatch(f.credentials, f.businessId, actions[1].id);
    expect(f.sent).toHaveLength(1);
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.out-1",
          status: "sent",
          timestamp: "1793869260",
          recipient_id: "919876543211",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
        },
      ],
    });
    await f.intake.drain();
    await f.app.reconcile(f.credentials, f.businessId, {
      actionId: actions[0].id,
    });
    await f.control.dispatch(f.credentials, f.businessId, actions[1].id);
    expect(f.sent).toHaveLength(2);
    for (const a of actions)
      await f.control.dispatch(f.credentials, f.businessId, a.id);
    await f.app.start(f.credentials, f.businessId, ref);
    expect(f.sent).toHaveLength(2);
  });
  it("does not reopen an expired service window from delayed or replayed incoming timestamps", async () => {
    const f = await metaSendingFixture(h, "old-window");
    h.clock.set("2026-11-06T09:01:00Z");
    await h.reverifyAuthenticator(f.credentials);
    await f.onboarding.refresh(f.credentials, f.businessId, {
      expectedVersion: 2,
    });
    await f.incoming(
      "wamid.delayed-old",
      "Quantity: 500",
      "wamid.inquiry",
      new Date("2026-11-05T09:00:00Z"),
    );
    await f.intake.drain();
    await f.permission();
    const a = await f.groundedReply();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "whatsapp_service_window_expired",
    });
    expect(f.sent).toHaveLength(0);
  });
  it("rechecks expiry after account credential I/O and leaves the exact intent without a transport effect", async () => {
    const f = await metaSendingFixture(h, "window-race");
    h.clock.set("2026-11-06T08:59:59Z");
    await h.reverifyAuthenticator(f.credentials);
    await f.onboarding.refresh(f.credentials, f.businessId, {
      expectedVersion: 2,
    });
    await f.permission();
    const a = await f.groundedReply();
    f.meta.state.inspect = async () => {
      h.clock.set("2026-11-06T09:00:01Z");
    };
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "whatsapp_service_window_expired",
    });
    expect(f.sent).toHaveLength(0);
  });
  it("keeps incoming records accessible when the paid automation allowance is zero", async () => {
    const f = await metaSendingFixture(h, "unpaid", 0);
    await f.permission();
    const a = await f.groundedReply();
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "paid_automation_unavailable",
    });
    expect(f.sent).toHaveLength(0);
    expect(
      (await f.inbox.workspace(f.credentials, f.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("blocks a current permission revocation and a pending buyer reply before transport", async () => {
    const f = await metaSendingFixture(h, "revoke");
    const permission = await f.permission();
    const a = await f.groundedReply();
    await f.app.revokePermission(f.credentials, f.businessId, {
      permissionId: permission.permissions[0].id,
      reason: "Recipient withdrew",
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({ reason: "whatsapp_permission_revoked" });
    expect(f.sent).toHaveLength(0);
    const g = await metaSendingFixture(h, "reply-race");
    await g.permission();
    const b = await g.groundedReply();
    await g.incoming(
      "wamid.just-arrived",
      "Please stop messaging",
      "wamid.inquiry",
    );
    expect(
      await g.control.dispatch(g.credentials, g.businessId, b.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "reply_visibility_unavailable",
    });
    expect(g.sent).toHaveLength(0);
    await g.intake.drain();
    expect(
      (await g.inbox.workspace(g.credentials, g.businessId)).conversations,
    ).toHaveLength(1);
  });
  it("does not resend when acceptance succeeded but storing the provider result failed", async () => {
    const f = await metaSendingFixture(h, "persist-failure");
    await f.permission();
    const a = await f.groundedReply();
    await h.admin.query(
      "CREATE FUNCTION fixture_reject_meta_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.data->>'kind'='result' THEN RAISE EXCEPTION 'fixture result write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_reject_meta_result BEFORE INSERT ON whatsapp_outbound FOR EACH ROW EXECUTE FUNCTION fixture_reject_meta_result()",
    );
    try {
      await expect(
        f.control.dispatch(f.credentials, f.businessId, a.id),
      ).rejects.toBeDefined();
    } finally {
      await h.admin.query(
        "DROP TRIGGER fixture_reject_meta_result ON whatsapp_outbound; DROP FUNCTION fixture_reject_meta_result()",
      );
    }
    expect(f.sent).toHaveLength(1);
    await f.control.dispatch(f.credentials, f.businessId, a.id);
    expect(f.sent).toHaveLength(1);
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.out-1",
          status: "sent",
          timestamp: String(Math.floor(h.clock.now().getTime() / 1000)),
          recipient_id: "919876543210",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
        },
      ],
    });
    await f.intake.drain();
    expect(
      (await f.app.reconcile(f.credentials, f.businessId, { actionId: a.id }))
        .actions[0],
    ).toMatchObject({ state: "dispatched", evidence: "sent" });
    expect(f.sent).toHaveLength(1);
  });
  it("checks native grants again after credential I/O", async () => {
    const f = await metaSendingFixture(h, "grant-revoked");
    await f.permission();
    const a = await f.groundedReply();
    f.meta.checks.permissions = "missing";
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({ state: "cancelled", reason: "connection_revoked" });
    expect(f.sent).toHaveLength(0);
  });
  it("isolates Business HTTP reads and denies caller-supplied ordinary reply text", async () => {
    const f = await metaSendingFixture(h, "http-scope"),
      g = await metaSendingFixture(h, "http-other");
    const http = createWhatsAppSendingHttp({
      application: f.app,
      origin: "http://localhost:3000",
      reportFailure: () => {},
    });
    expect(
      (
        await http.get(
          new Request("http://localhost:3000", { headers: g.credentials }),
          f.businessId,
        )
      ).status,
    ).toBe(404);
    const headers = new Headers(f.credentials);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    expect(
      (
        await http.command(
          new Request("http://localhost:3000", {
            method: "POST",
            headers,
            body: JSON.stringify({
              action: "permission",
              input: { peer: "919876543210", body: "Injected body" },
            }),
          }),
          f.businessId,
        )
      ).status,
    ).toBe(400);
    expect(f.sent).toHaveLength(0);
  });
  it("requires a new approval for changed template content or recipient selection", async () => {
    const f = await metaSendingFixture(h, "new-version"),
      o = await f.outreach();
    const saved = await f.app.savePlan(f.credentials, f.businessId, o.plan),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    await expect(
      f.app.start(f.credentials, f.businessId, {
        ...ref,
        recipients: ["919876543299"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await f.app.template(f.credentials, f.businessId, {
      name: "steel_offer",
      language: "en_US",
      parameters: ["Alex"],
    });
    const ws = await f.app.workspace(f.credentials, f.businessId),
      changed = ws.templates.at(-1)!;
    await f.app.savePlan(f.credentials, f.businessId, {
      ...o.plan,
      expectedVersion: 1,
      recipients: o.plan.recipients.map((c) => ({
        ...c,
        steps: c.steps.map((s) => ({ ...s, template: changed.template })),
      })),
    });
    const latest = (
      await f.app.workspace(f.credentials, f.businessId)
    ).plans.at(-1)!;
    await expect(
      f.app.start(f.credentials, f.businessId, {
        planId: latest.id,
        hash: latest.hash,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.app.start(f.credentials, f.businessId, ref),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.app.workspace(f.credentials, f.businessId)).plans[0].plan
        .recipients[0].steps[0].template.rendered,
    ).toContain("Pat");
    expect(f.sent).toHaveLength(0);
  });
  it("stops an approved outreach when the current Meta template is paused", async () => {
    const f = await metaSendingFixture(h, "paused-template"),
      o = await f.outreach(),
      saved = await f.app.savePlan(f.credentials, f.businessId, o.plan),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    const started = await f.app.start(f.credentials, f.businessId, ref);
    f.httpState.templateStatus = "PAUSED";
    expect(
      await f.control.dispatch(
        f.credentials,
        f.businessId,
        [...started.actions].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]
          .id,
      ),
    ).toMatchObject({
      state: "cancelled",
      reason: "whatsapp_template_unavailable_or_unsupported",
    });
    expect(f.sent).toHaveLength(0);
  });
  it("associates an authenticated reply to the exact outgoing action and stops the bounded follow-up", async () => {
    const f = await metaSendingFixture(h, "outgoing-reply"),
      o = await f.outreach(),
      saved = await f.app.savePlan(f.credentials, f.businessId, o.plan),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    const started = await f.app.start(f.credentials, f.businessId, ref),
      actions = [...started.actions].sort((a, b) =>
        a.dueAt.localeCompare(b.dueAt),
      );
    await f.control.dispatch(f.credentials, f.businessId, actions[0].id);
    h.clock.set("2026-11-05T09:01:00Z");
    await f.deliver("messages", {
      contacts: [
        { wa_id: "919876543211", profile: { name: "Different display name" } },
      ],
      messages: [
        {
          id: "wamid.buyer-reply",
          from: "919876543211",
          timestamp: "1793869260",
          type: "text",
          text: { body: "Please stop messages" },
          context: { id: "wamid.out-1" },
        },
      ],
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, actions[1].id),
    ).toMatchObject({
      state: "cancelled",
      reason: "reply_visibility_unavailable",
    });
    await f.intake.drain();
    const ws = await f.inbox.workspace(f.credentials, f.businessId),
      conversations = await Promise.all(
        ws.conversations.map((c) =>
          f.inbox.conversation(f.credentials, f.businessId, c.id),
        ),
      );
    expect(
      conversations
        .flatMap((c) => c.messages)
        .find((m) => m.messageRef === "wamid.buyer-reply")?.opportunityId,
    ).toBe(actions[0].opportunityId);
    expect(
      ws.opportunities.find((n) => n.id === actions[0].opportunityId)?.stage,
    ).toBe("inquiry");
    expect(f.sent).toHaveLength(1);
  });
  it("does not treat a signed status marker or unknown origin as manual activity or application acceptance", async () => {
    const f = await metaSendingFixture(h, "unknown-status");
    await f.permission();
    const a = await f.groundedReply();
    f.httpState.ambiguous = true;
    await f.control.dispatch(f.credentials, f.businessId, a.id);
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.unknown-origin",
          status: "delivered",
          timestamp: "1793869200",
          recipient_id: "919876543210",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
          origin: "unrecognized-device",
        },
      ],
    });
    await f.intake.drain();
    expect(
      (await f.app.reconcile(f.credentials, f.businessId, { actionId: a.id }))
        .actions[0],
    ).toMatchObject({ evidence: "unresolved", state: "committed" });
    expect(
      (await f.control.read(f.credentials, f.businessId, f.opportunityId))
        .state,
    ).toBe("automation");
    expect(f.sent).toHaveLength(1);
  });
  it("takes over an unambiguous approved prospect after supported Business App activity and never revives cancelled work on handback", async () => {
    const f = await metaSendingFixture(h, "prospect-takeover"),
      o = await f.outreach(),
      saved = await f.app.savePlan(f.credentials, f.businessId, o.plan),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    const started = await f.app.start(f.credentials, f.businessId, ref),
      actions = [...started.actions].sort((a, b) =>
        a.dueAt.localeCompare(b.dueAt),
      );
    await f.control.dispatch(f.credentials, f.businessId, actions[0].id);
    h.clock.set("2026-11-05T09:01:00Z");
    await f.deliver("smb_message_echoes", {
      message_echoes: [
        {
          id: "wamid.prospect-human",
          from: "14155550123",
          to: "919876543211",
          timestamp: "1793869260",
          type: "text",
          text: { body: "I will help you personally" },
        },
      ],
    });
    await f.intake.drain();
    const state = await f.control.read(
      f.credentials,
      f.businessId,
      actions[0].opportunityId,
    );
    expect(state.state).toBe("human");
    await f.control.change(f.credentials, f.businessId, state.id, {
      command: "handback",
      expectedVersion: state.version,
      reason: "Reviewed",
      nextAction: "Only freshly evaluated work",
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, actions[1].id),
    ).toMatchObject({ state: "cancelled" });
    expect(f.sent).toHaveLength(1);
  });
  it("sends an expired-window ordinary reply only through a current approved template with exactly its saved grounded body", async () => {
    const f = await metaSendingFixture(h, "ordinary-template");
    h.clock.set("2026-11-06T09:01:00Z");
    await h.reverifyAuthenticator(f.credentials);
    await f.onboarding.refresh(f.credentials, f.businessId, {
      expectedVersion: 2,
    });
    await f.permission();
    const a = await f.groundedReply();
    const wrong = await f.app.template(f.credentials, f.businessId, {
      name: "steel_offer",
      language: "en_US",
      parameters: ["Pat"],
    });
    await expect(
      f.app.bindReplyTemplate(f.credentials, f.businessId, {
        actionId: a.id,
        templateId: wrong.templates[0].id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    f.httpState.templateBody = a.body!;
    const correct = await f.app.template(f.credentials, f.businessId, {
      name: "steel_offer",
      language: "en_US",
      parameters: [],
    });
    await f.app.bindReplyTemplate(f.credentials, f.businessId, {
      actionId: a.id,
      templateId: correct.templates.at(-1)!.id,
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, a.id),
    ).toMatchObject({ state: "dispatched" });
    expect(f.sent[0]).toMatchObject({
      type: "template",
      to: "919876543210",
      context: { message_id: "wamid.inquiry" },
    });
  });
  it("keeps a sourced Meta cost estimate separate from observed unpriced usage and our reserved automation", async () => {
    const f = await metaSendingFixture(h, "usage");
    await f.permission();
    const a = await f.groundedReply();
    await f.control.dispatch(f.credentials, f.businessId, a.id);
    const estimate = await f.app.estimate(f.credentials, f.businessId, {
      actionId: a.id,
      currency: "USD",
      minor: "12",
      reference: "META-RATE-FIXTURE-2026",
      observedAt: h.clock.now().toISOString(),
      validUntil: "2026-11-07T09:00:00Z",
    });
    expect(estimate.usage[0]).toMatchObject({
      state: "estimated",
      minor: "12",
      currency: "USD",
    });
    expect(estimate.automation.remaining).toBe(99);
    const status = {
      statuses: [
        {
          id: "wamid.out-1",
          status: "delivered",
          timestamp: "1793869200",
          recipient_id: "919876543210",
          biz_opaque_callback_data: f.sent[0].biz_opaque_callback_data,
          pricing: {
            category: "service",
            pricing_model: "PMP",
            billable: false,
          },
        },
      ],
    };
    await f.deliver("messages", status);
    await f.deliver("messages", status);
    await f.intake.drain();
    const result = await f.app.reconcile(f.credentials, f.businessId, {
      actionId: a.id,
    });
    expect(result.usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "observed_unpriced",
          minor: null,
          currency: null,
        }),
        expect.objectContaining({
          state: "estimated",
          minor: "12",
          currency: "USD",
        }),
      ]),
    );
    expect(result.automation.remaining).toBe(99);
    expect(result).toMatchObject({
      metaPayer: "customer",
      includedInSubscription: false,
      includedInOperatorSpend: false,
    });
  });
  it("requires SELECT and INSERT independently on the immutable outbound ledger and restores security on reapplication", async () => {
    await h.admin.query("REVOKE INSERT ON whatsapp_outbound FROM app_runtime");
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.reapplySchema();
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
    expect(
      (
        await h.runtime.query(
          "SELECT count(*)::int AS n FROM whatsapp_outbound",
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(
      h.runtime.query("UPDATE whatsapp_outbound SET data='{}'::jsonb"),
    ).rejects.toBeDefined();
  });
  it("rejects a missing SELECT grant independently, even when INSERT is still present", async () => {
    await h.admin.query("REVOKE SELECT ON whatsapp_outbound FROM app_runtime");
    try {
      await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
        code: "SETUP_REQUIRED",
      });
    } finally {
      await h.admin.query("GRANT SELECT ON whatsapp_outbound TO app_runtime");
    }
    await expect(verifyRuntimeRole(h.runtime)).resolves.toBeUndefined();
  });
  it("does not turn Meta template and Owner outreach approval into authority for a financial promise", async () => {
    const f = await metaSendingFixture(h, "financial-template");
    f.httpState.templateBody = "Hello {{1}}, our steel has no cost.";
    const o = await f.outreach();
    const saved = await f.app.savePlan(f.credentials, f.businessId, {
        ...o.plan,
        recipients: o.plan.recipients.map((r) => ({
          ...r,
          steps: r.steps.map((s) => ({ ...s, evaluation: null })),
        })),
      }),
      r = saved.plans[0],
      ref = { planId: r.id, hash: r.hash };
    await f.app.decide(f.credentials, f.businessId, { ...ref, approved: true });
    const started = await f.app.start(f.credentials, f.businessId, ref),
      first = [...started.actions].sort((a, b) =>
        a.dueAt.localeCompare(b.dueAt),
      )[0];
    expect(
      await f.control.dispatch(f.credentials, f.businessId, first.id),
    ).toMatchObject({
      state: "cancelled",
      reason: "whatsapp_commercial_template_requires_authorized_action",
    });
    expect(f.sent).toHaveLength(0);
  });
  it("retains an HTTP request timeout as unknown acceptance rather than authoritative rejection", async () => {
    const f = await metaSendingFixture(h, "http-timeout");
    await f.permission();
    const action = await f.groundedReply();
    f.httpState.responseStatus = 408;
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({
      state: "committed",
      reason: "whatsapp_acceptance_unknown",
    });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
  });
  it("requires newer distinct recipient evidence after withdrawal instead of restoring a revoked consent artifact", async () => {
    const f = await metaSendingFixture(h, "reconsent");
    const recorded = await f.permission();
    const action = await f.groundedReply();
    await f.app.revokePermission(f.credentials, f.businessId, {
      permissionId: recorded.permissions[0].id,
      reason: "Recipient withdrew permission",
    });
    h.clock.set("2026-11-05T09:00:01Z");
    await expect(f.permission()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.sent).toHaveLength(0);
    await f.app.permission(f.credentials, f.businessId, {
      peer: "919876543210",
      purpose: "conversation",
      opportunityId: f.opportunityId,
      numberProvided: true,
      optedIn: true,
      noticesReviewed: true,
      reference: "CONSENT-RENEWED-2026",
      sha256: "ef".repeat(32),
      observedAt: h.clock.now().toISOString(),
      validUntil: "2026-12-05T09:00:00Z",
    });
    expect(
      await f.control.dispatch(f.credentials, f.businessId, action.id),
    ).toMatchObject({ state: "dispatched" });
    expect(f.sent).toHaveLength(1);
  });
  it("does not attribute acceptance from a copyable action marker without the private committed provider correlation reference", async () => {
    const f = await metaSendingFixture(h, "marker-only");
    await f.permission();
    const a = await f.groundedReply();
    f.httpState.ambiguous = true;
    await f.control.dispatch(f.credentials, f.businessId, a.id);
    await f.deliver("messages", {
      statuses: [
        {
          id: "wamid.marker-only",
          status: "sent",
          timestamp: "1793869200",
          recipient_id: "919876543210",
          biz_opaque_callback_data: a.id,
        },
      ],
    });
    await f.intake.drain();
    expect(
      (await f.app.reconcile(f.credentials, f.businessId, { actionId: a.id }))
        .actions[0],
    ).toMatchObject({
      state: "committed",
      evidence: "unresolved",
      providerMessageRef: null,
    });
    expect(f.sent).toHaveLength(1);
  });
  it("recovers unrelated due work after an older unresolved intent without repeating its transport", async () => {
    const recovery = await createHarness();
    try {
      const old = await metaSendingFixture(recovery, "recovery-old");
      await old.permission();
      const a = await old.groundedReply();
      old.httpState.ambiguous = true;
      await old.control.dispatch(old.credentials, old.businessId, a.id);
      const fresh = await metaSendingFixture(
        recovery,
        "recovery-fresh",
        100,
        "2026-11-05T09:01:00Z",
      );
      await fresh.permission();
      await fresh.groundedReply();
      recovery.clock.set("2026-11-05T09:02:00Z");
      await fresh.restart().recoverDue({ maxActions: 1 });
      expect(fresh.sent).toHaveLength(0);
      await fresh.restart().recoverDue({ maxActions: 1 });
      expect(fresh.sent).toHaveLength(1);
      expect(old.sent).toHaveLength(1);
      await fresh.restart().recoverDue({ maxActions: 1 });
      expect(fresh.sent).toHaveLength(1);
      expect(old.sent).toHaveLength(1);
    } finally {
      await recovery.close();
    }
  });
});
