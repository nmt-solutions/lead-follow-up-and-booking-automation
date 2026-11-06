import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { metaSendingFixture } from "./support/meta-sending";

describe("WhatsApp sends through current public application commands", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => { h = await createHarness(); });
  afterAll(async () => { await h?.close(); });

  it("blocks an ordinary grounded inquiry without WhatsApp permission, independently of email policy", async () => {
    const f = await metaSendingFixture(h, "permission");
    const action = await f.groundedReply();
    expect(await f.control.dispatch(f.credentials, f.businessId, action.id)).toMatchObject({
      state: "cancelled", reason: "whatsapp_permission_required",
    });
    expect(f.sent).toEqual([]);
  });
  it("sends the persisted ordinary reply and parent once, retaining acceptance separately from delivery", async () => {
    const f = await metaSendingFixture(h, "ordinary");
    await f.permission();
    const action = await f.groundedReply();
    expect(await f.control.dispatch(f.credentials, f.businessId, action.id)).toMatchObject({ state: "dispatched", reason: "whatsapp_accepted_delivery_unconfirmed" });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ to: "919876543210", type: "text", context: { message_id: "wamid.inquiry" }, biz_opaque_callback_data: action.id });
    expect(f.sent[0].text).toMatchObject({ body: expect.stringContaining("quotation-request review") });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
    expect((await f.app.workspace(f.credentials, f.businessId)).actions[0]).toMatchObject({ providerMessageRef: "wamid.out-1", evidence: "accepted" });
  });
  it("keeps ambiguous acceptance reserved across restart until an exact signed account, recipient and action status resolves it", async () => {
    const f = await metaSendingFixture(h, "ambiguous");
    await f.permission();
    const action = await f.groundedReply();
    f.httpState.ambiguous = true;
    expect(await f.control.dispatch(f.credentials, f.businessId, action.id)).toMatchObject({ state: "committed", reason: "whatsapp_acceptance_unknown" });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
    await f.deliver("messages", { statuses: [{ id: "wamid.wrong-recipient", status: "delivered", timestamp: String(Math.floor(h.clock.now().getTime()/1000)), recipient_id: "919876543211", biz_opaque_callback_data: action.id }] });
    await f.intake.drain();
    await f.app.reconcile(f.credentials, f.businessId, { actionId: action.id });
    expect((await f.app.workspace(f.credentials, f.businessId)).actions[0].evidence).toBe("unresolved");
    await f.deliver("messages", { statuses: [{ id: "wamid.out-1", status: "delivered", timestamp: String(Math.floor(h.clock.now().getTime()/1000)), recipient_id: "919876543210", biz_opaque_callback_data: action.id, pricing: { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" } }] });
    await f.intake.drain();
    const workspace = await f.app.reconcile(f.credentials, f.businessId, { actionId: action.id });
    expect(workspace.actions[0]).toMatchObject({ evidence: "delivered", providerMessageRef: "wamid.out-1" });
    expect(workspace.usage[0]).toMatchObject({ state: "observed_unpriced", currency: null, minor: null, provenance: "authenticated_meta_status" });
    await f.control.dispatch(f.credentials, f.businessId, action.id);
    expect(f.sent).toHaveLength(1);
  });
  it("requires an immutable Owner approval, sends its fixed recipient only and durably bounds follow-up timing and attempts",async () => {
    const f=await metaSendingFixture(h,"outreach"), o=await f.outreach();
    const saved=await f.app.savePlan(f.credentials,f.businessId,o.plan), r=saved.plans[0], ref={planId:r.id,hash:r.hash};
    await expect(f.app.start(f.credentials,f.businessId,ref)).rejects.toMatchObject({code:"CONFLICT"});
    await f.app.decide(f.credentials,f.businessId,{...ref,approved:true});
    const started=await f.app.start(f.credentials,f.businessId,ref);
    expect(started.actions).toHaveLength(2);
    expect(f.sent).toHaveLength(0);
    const actions=[...started.actions].sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
    await f.control.dispatch(f.credentials,f.businessId,actions[1].id);
    expect(f.sent).toHaveLength(0);
    await f.control.dispatch(f.credentials,f.businessId,actions[0].id);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({type:"template",to:"919876543211",template:{name:"steel_offer",language:{code:"en_US"},components:[{type:"body",parameters:[{type:"text",text:"Pat"}]}]}});
    h.clock.set("2026-11-05T09:01:00Z");
    await f.control.dispatch(f.credentials,f.businessId,actions[1].id);
    expect(f.sent).toHaveLength(1);
    await f.deliver("messages",{statuses:[{id:"wamid.out-1",status:"sent",timestamp:"1793869260",recipient_id:"919876543211",biz_opaque_callback_data:actions[0].id}]});
    await f.intake.drain();
    await f.app.reconcile(f.credentials,f.businessId,{actionId:actions[0].id});
    await f.control.dispatch(f.credentials,f.businessId,actions[1].id);
    expect(f.sent).toHaveLength(2);
    for (const a of actions) await f.control.dispatch(f.credentials,f.businessId,a.id);
    await f.app.start(f.credentials,f.businessId,ref);
    expect(f.sent).toHaveLength(2);
  });
});
