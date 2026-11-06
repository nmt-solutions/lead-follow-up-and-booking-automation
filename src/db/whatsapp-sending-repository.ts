import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import { metaObservationSchema, metaTokenSchema } from "../models/whatsapp";
import type { MetaOutboundData, MetaIntent, MetaPermission, MetaSendResult, MetaSendingWorkspace, MetaTemplate, MetaPlan, MetaCandidate, MetaTemplateSelection } from "../models/whatsapp-sending";
import type { MetaProvider } from "../whatsapp/provider";
import type { MetaTransport } from "../whatsapp/transport";
import type { calendarCredentialVault } from "../appointments/credentials";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import { createWhatsAppRepository } from "./whatsapp-repository";
import { metaInboundAllowed, metaPeerVisible } from "./whatsapp-visibility";
import { discoveryEvidenceAt } from "./discovery-repository";
import { settings } from "./discovery-state";
import { availableMarkets } from "../discovery/repository";
import { campaignHash } from "./campaign-repository";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { evaluateCommercialAuthority } from "../models/commercial-authority";
import { sequenceDue } from "../email-sequences/timing";
import { whatsAppOutbound, whatsAppConnection, whatsAppIntake, whatsAppReceipt, opportunityDueAction, inboxMessage, inboxOpportunity, inboxConnection } from "./schema";

type Action = typeof opportunityDueAction.$inferSelect;
type Row = typeof whatsAppOutbound.$inferSelect;
export type WhatsAppSendingRepository = ReturnType<typeof createWhatsAppSendingRepository>;
export function createWhatsAppSendingRepository(database: Database, clock: Clock, d: {
  provider: MetaProvider; vault: ReturnType<typeof calendarCredentialVault> | null; transport: MetaTransport | null; workerReady: boolean;
}) {
  const onboarding = createWhatsAppRepository(database, clock);
  const records = (tx: Transaction, businessId: string) => tx.select().from(whatsAppOutbound).where(eq(whatsAppOutbound.businessId, businessId)).orderBy(asc(whatsAppOutbound.position));
  async function append(tx: Transaction, actor: WorkIdentity, businessId: string, connectionId: string, key: string, data: MetaOutboundData) {
    const [r] = await tx.insert(whatsAppOutbound).values({ id: randomUUID(), businessId, connectionId, key, actorId: actor.userId, at: clock.now(), data }).onConflictDoNothing().returning();
    return r;
  }
  async function scope<T>(actor: WorkIdentity, businessId: string, operation: (tx: Transaction, role: string) => Promise<T>, manage = false) {
    return scoped(database, actor, businessId, async (tx) => {
      const role = await requireCapability(tx, actor, businessId, manage ? "integrations.manage" : "sales.work");
      await requireSalesSession(tx, actor, clock.now(), role);
      return operation(tx, role);
    }, { lock: true });
  }
  async function account(tx: Transaction, businessId: string) {
    const [connection] = await tx.select().from(whatsAppConnection).where(eq(whatsAppConnection.businessId, businessId));
    const [intake] = await tx.select().from(whatsAppIntake).where(eq(whatsAppIntake.businessId, businessId));
    const view = await onboarding.workspaceAt(tx, businessId, d.provider);
    const issues = [...view.readiness.issues];
    if (!d.transport || !d.vault) issues.push("native_transport_unavailable");
    if (!d.workerReady) issues.push("durable_worker_required");
    if (!view.intake.enabled || !view.intake.inboundObserved || !view.intake.manualObserved) issues.push("reply_visibility_unavailable");
    if (!connection?.credentials || !connection.assets || !intake || intake.connectionVersion !== connection.version) issues.push("current_account_required");
    return { connection, intake, issues };
  }
  function permissionAt(rows: Row[], peer: string, purpose: MetaPermission["purpose"], opportunityId: string) {
    return rows.filter((r) => {
      const p = r.data;
      return p.kind === "permission" && p.permission.peer === peer && p.permission.purpose === purpose && (!p.permission.opportunityId || p.permission.opportunityId === opportunityId);
    }).at(-1);
  }
  async function permissionReason(tx: Transaction, businessId: string, rows: Row[], permission: Row | undefined, peer: string) {
    if (!permission || permission.data.kind !== "permission") return "whatsapp_permission_required";
    const p = permission.data.permission, at = clock.now();
    if (rows.some((r) => r.data.kind === "revoke_permission" && r.data.permissionId === permission.id)) return "whatsapp_permission_revoked";
    if (new Date(p.observedAt) > at || new Date(p.validUntil) <= at) return "whatsapp_permission_expired";
    const incoming = await tx.select().from(inboxMessage).where(and(eq(inboxMessage.businessId, businessId), sql`${inboxMessage.content}->>'senderRef'=${peer}`));
    if (incoming.some((m) => /\b(stop|unsubscribe|opt[ -]?out|do not (?:message|contact)|don.t (?:message|contact))\b/i.test(m.content.text) && new Date(m.content.occurredAt) >= new Date(p.observedAt))) return "whatsapp_opted_out";
    return null;
  }
  async function intentAt(tx: Transaction, businessId: string, actionId: string) {
    const [r] = await tx.select().from(whatsAppOutbound).where(and(eq(whatsAppOutbound.businessId, businessId), eq(whatsAppOutbound.key, `intent:${actionId}`)));
    return r?.data.kind === "intent" ? r.data.intent : null;
  }
  async function evidenceAt(tx: Transaction, businessId: string, intent: MetaIntent, rows: Row[]) {
    const result = rows.filter((r) => r.data.kind === "result" && r.data.actionId === intent.actionId).at(-1)?.data;
    const accepted = result?.kind === "result" && result.result.status === "accepted" ? result.result : null;
    const receipts = await tx.select().from(whatsAppReceipt).where(and(eq(whatsAppReceipt.businessId, businessId), eq(whatsAppReceipt.connectionId, intent.connectionId), eq(whatsAppReceipt.connectionVersion, intent.connectionVersion), eq(whatsAppReceipt.accountKey, `${intent.assets.wabaId}:${intent.assets.phoneNumberId}`), eq(whatsAppReceipt.kind, "status")));
    const authorized = await metaInboundAllowed(tx, businessId, intent.inboxConnectionId);
    const matching = authorized ? receipts.filter((r) => {
      const proof = r.statusEvidence;
      return proof?.supported && r.messageRef && r.peer === intent.peer &&
        (proof.callbackData === intent.actionId || (!!accepted && r.messageRef === accepted.messageRef && !proof.callbackData)) &&
        (!accepted || r.messageRef === accepted.messageRef) &&
        new Date(proof.occurredAt).getTime() + 999 >= new Date(intent.reservedAt).getTime() && new Date(proof.occurredAt) <= clock.now() && r.at >= new Date(intent.reservedAt) &&
        !rows.some((other) => other.data.kind === "result" && other.data.actionId !== intent.actionId && other.data.result.status === "accepted" && other.data.result.messageRef === r.messageRef);
    }) : [];
    const ids = new Set(matching.map((r) => r.messageRef));
    const contradictory = matching.some((r) => r.status === "failed") && matching.some((r) => r.status === "delivered" || r.status === "read");
    if (ids.size > 1 || contradictory) return { evidence: "unresolved" as const, messageRef: accepted?.messageRef ?? null, reason: "conflicting_provider_evidence", pricing: null, proof: null };
    const ranked = [...matching].sort((a, b) => ({ sent: 1, failed: 2, delivered: 3, read: 4 }[b.status ?? ""] ?? 0) - ({ sent: 1, failed: 2, delivered: 3, read: 4 }[a.status ?? ""] ?? 0));
    const proof = ranked[0] ?? null;
    const evidence = proof?.status === "read" ? "read" as const : proof?.status === "delivered" ? "delivered" as const : proof?.status === "failed" ? "failed" as const : proof?.status === "sent" ? "sent" as const : accepted ? "accepted" as const : "unresolved" as const;
    const pricing = matching.filter((r) => r.statusEvidence?.pricing).sort((a,b) => a.at.getTime()-b.at.getTime()).at(-1) ?? null;
    return { evidence, messageRef: proof?.messageRef ?? accepted?.messageRef ?? null, reason: evidence === "unresolved" ? "awaiting_exact_authenticated_account_recipient_action_status" : null, pricing, proof };
  }
  async function candidatesAt(tx: Transaction, businessId: string): Promise<MetaCandidate[]> {
    const {prospects} = await discoveryEvidenceAt(tx,businessId,clock.now());
    return prospects.flatMap((p) => p.contacts.flatMap((c) => {
      if (!c.id || c.route?.kind !== "phone" || p.identityConflict || p.reviewReasons.length) return [];
      const evidence = {prospect:p,contact:c};
      return [{prospectId:p.id,contactId:c.id,peer:c.route.value.slice(1),name:p.name,market:p.market,evidenceKey:campaignHash(evidence),evidence}];
    }));
  }
  async function planReason(tx: Transaction, actor: WorkIdentity, row: Row, rows: Row[]) {
    if (row.data.kind !== "plan") return "whatsapp_plan_missing";
    const {plan,hash,sources} = row.data;
    if (campaignHash({plan,sources}) !== hash) return "whatsapp_approval_integrity";
    if (rows.some((r) => r.data.kind === "plan" && r.data.plan.campaignId === plan.campaignId && r.data.plan.expectedVersion>plan.expectedVersion)) return "whatsapp_new_version_requires_approval";
    if (rows.some((r) => r.data.kind === "cancel_plan" && r.data.planId===row.id)) return "whatsapp_plan_cancelled";
    const decision = rows.find((r) => r.data.kind === "decision" && r.data.planId===row.id);
    if (!decision || decision.data.kind !== "decision" || !decision.data.approved || decision.data.hash!==hash) return "whatsapp_owner_approval_required";
    try {
      const owner = {userId:decision.actorId,sessionId:decision.data.sessionId};
      if (await requireCapability(tx,owner,row.businessId,"sales.work") !== "owner") return "whatsapp_approver_authority_changed";
      await requireSalesSession(tx,owner,clock.now(),"owner");
    } catch { return "whatsapp_approver_authority_changed"; }
    const policy = await readCommercialPolicy(tx,row.businessId,false);
    if (policy.version !== plan.authorityVersion || decision.data.authorityVersion !== policy.version) return "whatsapp_commercial_authority_changed";
    if (new Date(plan.expiresAt)<=clock.now()) return "whatsapp_plan_expired";
    const candidates = await candidatesAt(tx,row.businessId);
    const {profile,policy:discoveryPolicy} = await settings(tx,row.businessId);
    const markets = availableMarkets(profile,discoveryPolicy);
    if (!sources.every((s) => candidates.some((c) => c.prospectId===s.prospectId && c.contactId===s.contactId && c.peer===s.peer && c.evidenceKey===s.evidenceKey))) return "whatsapp_contact_evidence_changed";
    if (!sources.every((s) => markets.includes(s.market))) return "whatsapp_current_reach_required";
    void actor;
    return null;
  }
  async function preparePlanAt(tx: Transaction, actor: WorkIdentity, action: Action) {
    const rows = await records(tx,action.businessId), row = rows.find((r) => r.id === action.whatsappPlanId);
    if (!row || row.data.kind !== "plan" || action.whatsappStep===null || !action.whatsappPeer) return {reason:"whatsapp_plan_missing",intent:null};
    const reason = await planReason(tx,actor,row,rows);
    if (reason) return {reason,intent:null};
    const plan = row.data.plan, recipient = plan.recipients.find((r) => r.peer===action.whatsappPeer), step = recipient?.steps[action.whatsappStep];
    if (!recipient || !step || action.whatsappStep>=plan.maxAttempts) return {reason:"whatsapp_recipient_not_approved",intent:null};
    const a = await account(tx,action.businessId);
    if (a.issues.length || !a.connection?.assets || !a.intake || a.connection.version!==plan.connectionVersion || a.intake.inboxConnectionId!==action.connectionId) return {reason:`whatsapp_${a.issues[0] ?? "account_changed"}`,intent:null};
    const [need] = await tx.select().from(inboxOpportunity).where(and(eq(inboxOpportunity.businessId,action.businessId),eq(inboxOpportunity.id,action.opportunityId)));
    if (!need || need.controlState!=="automation" || need.controlVersion!==action.controlVersion || need.ownerId!==actor.userId) return {reason:"control_changed",intent:null};
    if (!(await metaPeerVisible(tx,action.businessId,action.connectionId,recipient.peer,action.opportunityId))) return {reason:"reply_visibility_unavailable",intent:null};
    if (!isDeepStrictEqual(action.evaluation,step.evaluation) || action.policyVersion!==plan.authorityVersion) return {reason:"whatsapp_approved_authority_changed",intent:null};
    const policy = await readCommercialPolicy(tx,action.businessId,false);
    const commercial = evaluateCommercialAuthority(policy,step.evaluation,clock.now());
    if (commercial.status!=="permitted") return {reason:commercial.reason,intent:null};
    const incoming = await tx.select().from(inboxMessage).where(and(eq(inboxMessage.businessId,action.businessId),eq(inboxMessage.connectionId,action.connectionId),sql`${inboxMessage.content}->>'senderRef'=${recipient.peer}`));
    if (incoming.length) return {reason:"buyer_replied",intent:null};
    const permission = permissionAt(rows,recipient.peer,"outreach",action.opportunityId);
    const permissionBlock = await permissionReason(tx,action.businessId,rows,permission,recipient.peer);
    if (permissionBlock || !permission) return {reason:permissionBlock ?? "whatsapp_permission_required",intent:null};
    const others = await tx.select().from(opportunityDueAction).where(and(eq(opportunityDueAction.businessId,action.businessId),eq(opportunityDueAction.whatsappPeer,recipient.peer)));
    if (others.some((r) => r.id!==action.id && r.state==="committed")) return {reason:"whatsapp_previous_attempt_unresolved",intent:null};
    if (action.whatsappStep>0) {
      const previous = others.find((r) => r.whatsappPlanId===row.id && r.whatsappStep===action.whatsappStep!-1);
      if (previous?.state==="cancelled") return {reason:"whatsapp_previous_action_stopped",intent:null};
      const intent = previous ? await intentAt(tx,action.businessId,previous.id) : null;
      const evidence = intent ? await evidenceAt(tx,action.businessId,intent,rows) : null;
      if (!intent || !evidence || !["sent","delivered","read"].includes(evidence.evidence)) return {reason:"whatsapp_previous_attempt_unresolved",intent:null};
      if (new Date(intent.reservedAt).getTime()+step.delayMinutes*60000>clock.now().getTime()) return {reason:"whatsapp_followup_not_due",intent:null};
    }
    if (new Date(plan.notBefore)>clock.now() || sequenceDue(plan.timing,clock.now()).getTime()!==clock.now().getTime()) return {reason:"whatsapp_outside_approved_timing",intent:null};
    const existing = await intentAt(tx,action.businessId,action.id);
    const intent:MetaIntent = {actionId:action.id,businessId:action.businessId,opportunityId:action.opportunityId,connectionId:a.connection.id,connectionVersion:a.connection.version,inboxConnectionId:action.connectionId,assets:a.connection.assets,peer:recipient.peer,body:step.template.rendered,parent:null,template:step.template,permissionId:permission.id,planId:row.id,stepIndex:action.whatsappStep,reservedAt:existing?.reservedAt ?? clock.now().toISOString()};
    if (existing && !isDeepStrictEqual(existing,intent)) return {reason:"whatsapp_intent_changed",intent:null};
    return {reason:null,intent};
  }
  async function prepareAt(tx: Transaction, actor: WorkIdentity, action: Action, reply?: { text: string; recipientRef: string; replyToMessageRef: string }) {
    if (action.whatsappPlanId) return preparePlanAt(tx,actor,action);
    if (!action.messageId || !action.inquiryRunId || !reply) return { reason: "persisted_grounded_inquiry_required", intent: null };
    const a = await account(tx, action.businessId);
    if (a.issues.length || !a.connection?.assets || !a.intake) return { reason: `whatsapp_${a.issues[0] ?? "account_required"}`, intent: null };
    if (a.intake.inboxConnectionId !== action.connectionId) return { reason: "whatsapp_account_mismatch", intent: null };
    const [message] = await tx.select().from(inboxMessage).where(and(eq(inboxMessage.id, action.messageId), eq(inboxMessage.businessId, action.businessId)));
    if (!message || message.content.senderRef !== reply.recipientRef || message.messageRef !== reply.replyToMessageRef) return { reason: "whatsapp_reply_context_changed", intent: null };
    const rows = await records(tx, action.businessId);
    const permission = permissionAt(rows, reply.recipientRef, "conversation", action.opportunityId);
    const reason = await permissionReason(tx, action.businessId, rows, permission, reply.recipientRef);
    if (reason || !permission) return { reason: reason ?? "whatsapp_permission_required", intent: null };
    const templateRecord = rows.filter((r) => r.data.kind === "reply_template" && r.data.actionId === action.id).at(-1);
    const template = templateRecord?.data.kind === "reply_template" ? templateRecord.data.template : null;
    if (template && template.rendered !== reply.text) return { reason: "whatsapp_template_content_mismatch", intent: null };
    if (!template) {
      const received = await tx.select().from(inboxMessage).where(and(eq(inboxMessage.businessId, action.businessId), eq(inboxMessage.connectionId, action.connectionId), sql`${inboxMessage.content}->>'senderRef'=${reply.recipientRef}`));
      const latest = Math.max(0, ...received.map((m) => new Date(m.content.occurredAt).getTime()).filter((t) => t <= clock.now().getTime()));
      if (latest + 24 * 3600000 <= clock.now().getTime()) return { reason: "whatsapp_service_window_expired", intent: null };
    }
    const existing = await intentAt(tx, action.businessId, action.id);
    const intent: MetaIntent = { actionId: action.id, businessId: action.businessId, opportunityId: action.opportunityId, connectionId: a.connection.id, connectionVersion: a.connection.version, inboxConnectionId: action.connectionId, assets: a.connection.assets, peer: reply.recipientRef, body: reply.text, parent: reply.replyToMessageRef, template, permissionId: permission.id, planId: null, stepIndex: null, reservedAt: existing?.reservedAt ?? clock.now().toISOString() };
    if (existing && !isDeepStrictEqual(existing, intent)) return { reason: "whatsapp_intent_changed", intent: null };
    return { reason: null, intent };
  }
  async function workspace(tx: Transaction, businessId: string, role: string): Promise<MetaSendingWorkspace> {
    const a = await account(tx, businessId), rows = await records(tx, businessId);
    const intents = rows.flatMap((r) => r.data.kind === "intent" ? [r.data.intent] : []);
    const actions = await tx.select().from(opportunityDueAction).where(eq(opportunityDueAction.businessId, businessId));
    const evidence = new Map(await Promise.all(intents.map(async (i) => [i.actionId, await evidenceAt(tx, businessId, i, rows)] as const)));
    return {
      sendingReady: a.issues.length === 0, issues: a.issues, workerReady: d.workerReady, canApprove: role === "owner",
      permissions: rows.flatMap((r) => r.data.kind === "permission" ? [{ id: r.id, permission: r.data.permission, revoked: rows.some((v) => v.data.kind === "revoke_permission" && v.data.permissionId === r.id) }] : []),
      templates: rows.flatMap((r) => r.data.kind === "template" ? [{ id: r.id, template: r.data.template, connectionVersion: r.data.connectionVersion, observedAt: r.at.toISOString() }] : []),
      plans: rows.flatMap((r) => r.data.kind==="plan" ? [{id:r.id,plan:r.data.plan,hash:r.data.hash,approved:rows.some((v) => v.data.kind==="decision" && v.data.planId===r.id && v.data.approved),current:!rows.some((v) => v.data.kind==="plan" && r.data.kind==="plan" && v.data.plan.campaignId===r.data.plan.campaignId && v.data.plan.expectedVersion>r.data.plan.expectedVersion),cancelled:rows.some((v) => v.data.kind==="cancel_plan" && v.data.planId===r.id)}] : []),
      candidates:await candidatesAt(tx,businessId),
      actions: actions.filter((r) => r.connectionId===a.intake?.inboxConnectionId).map((r) => {
        const intent = intents.find((i) => i.actionId === r.id) ?? null;
        const proof = evidence.get(r.id) ?? {messageRef:null,evidence:"unresolved" as const,reason:r.reason ?? "not_dispatched"};
        return { id: r.id, opportunityId: r.opportunityId, state: r.state, reason: r.reason, dueAt: r.dueAt.toISOString(), intent, providerMessageRef: proof.messageRef, evidence: proof.evidence, reconciliationReason: proof.reason };
      }),
      usage: intents.map((i) => {
        const proof = evidence.get(i.actionId)!;
        const estimate = rows.filter((r) => r.data.kind === "estimate" && r.data.actionId === i.actionId && new Date(r.data.validUntil)>clock.now()).at(-1)?.data;
        const cost = estimate?.kind === "estimate" ? estimate : null;
        return { actionId: i.actionId, providerMessageRef: proof.messageRef, state: proof.pricing ? "observed_unpriced" : cost ? "estimated" : "unpriced", currency: cost?.currency ?? null, minor: cost?.minor ?? null, provenance: proof.pricing ? "authenticated_meta_status" : cost ? cost.reference : "app_reserved_attempt; Meta bill not yet observed", observedAt: proof.pricing?.statusEvidence?.occurredAt ?? cost?.observedAt ?? null, receivedAt: proof.pricing?.at.toISOString() ?? null, pricing: proof.pricing?.statusEvidence?.pricing ?? null };
      }),
      metaPayer: "customer", includedInSubscription: false, includedInOperatorSpend: false,
    };
  }
  return {
    prepareAt,
    async planConnectionAt(tx: Transaction, businessId: string, action: Action) {
      const [connection] = await tx.select().from(inboxConnection).where(and(eq(inboxConnection.id,action.connectionId),eq(inboxConnection.businessId,businessId),eq(inboxConnection.mode,"meta")));
      return connection;
    },
    template(actor:WorkIdentity,businessId:string,selection:MetaTemplateSelection) {
      return scope(actor,businessId,async (tx,role) => {
        const a = await account(tx,businessId);
        if (!a.connection?.credentials || !a.connection.assets || !d.vault || !d.transport) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        const token = metaTokenSchema.parse(JSON.parse(d.vault.decrypt(a.connection.credentials,`whatsapp:${businessId}:${a.connection.id}:${a.connection.version}`)));
        const template = await d.transport.template(token,a.connection.assets,selection,AbortSignal.timeout(5000));
        await requireCapability(tx,actor,businessId,"integrations.manage");
        await requireSalesSession(tx,actor,clock.now(),role === "owner" ? "owner" : "admin");
        await append(tx,actor,businessId,a.connection.id,`template:${randomUUID()}`,{kind:"template",template,connectionVersion:a.connection.version});
      },true);
    },
    savePlan(actor:WorkIdentity,businessId:string,plan:MetaPlan) {
      return scope(actor,businessId,async (tx) => {
        const rows=await records(tx,businessId), a=await account(tx,businessId);
        if (!a.connection || a.connection.version!==plan.connectionVersion) throw new ApplicationError("CONFLICT");
        const versions=rows.filter((r) => r.data.kind==="plan" && r.data.plan.campaignId===plan.campaignId);
        if (Math.max(0,...versions.map((r) => r.data.kind==="plan" ? r.data.plan.expectedVersion+1 : 0))!==plan.expectedVersion) throw new ApplicationError("CONFLICT");
        if (new Date(plan.expiresAt)<=clock.now() || new Date(plan.expiresAt)<=new Date(plan.notBefore)) throw new ApplicationError("INVALID_INPUT");
        const candidates=await candidatesAt(tx,businessId);
        const sources=plan.recipients.map((r) => candidates.find((c) => c.prospectId===r.prospectId && c.contactId===r.contactId && c.peer===r.peer && c.evidenceKey===r.evidenceKey));
        if (sources.some((s) => !s)) throw new ApplicationError("CONFLICT");
        for (const r of plan.recipients) for (const step of r.steps) if (!rows.some((v) => v.data.kind==="template" && v.data.connectionVersion===plan.connectionVersion && isDeepStrictEqual(v.data.template,step.template))) throw new ApplicationError("CONFLICT");
        const selected=sources.filter((s):s is MetaCandidate => !!s);
        await append(tx,actor,businessId,a.connection.id,`plan:${plan.campaignId}:${plan.expectedVersion+1}`,{kind:"plan",plan,sources:selected,hash:campaignHash({plan,sources:selected})});
      },true);
    },
    decide(actor:WorkIdentity,businessId:string,planId:string,hash:string,approved:boolean) {
      return scope(actor,businessId,async (tx,role) => {
        if (role!=="owner") throw new ApplicationError("FORBIDDEN");
        const rows=await records(tx,businessId), row=rows.find((r) => r.id===planId);
        if (!row || row.data.kind!=="plan") throw new ApplicationError("NOT_FOUND");
        if (row.data.hash!==hash || rows.some((r) => r.data.kind==="plan" && row.data.kind==="plan" && r.data.plan.campaignId===row.data.plan.campaignId && r.data.plan.expectedVersion>row.data.plan.expectedVersion)) throw new ApplicationError("CONFLICT");
        if ((await readCommercialPolicy(tx,businessId,false)).version!==row.data.plan.authorityVersion) throw new ApplicationError("CONFLICT");
        const existing=rows.find((r) => r.data.kind==="decision" && r.data.planId===planId);
        if (existing) {
          if (existing.data.kind!=="decision" || existing.actorId!==actor.userId || existing.data.approved!==approved || existing.data.hash!==hash) throw new ApplicationError("CONFLICT");
          return;
        }
        await append(tx,actor,businessId,row.connectionId,`decision:${planId}`,{kind:"decision",planId,hash,approved,sessionId:actor.sessionId,authorityVersion:row.data.plan.authorityVersion});
      });
    },
    start(actor:WorkIdentity,businessId:string,planId:string,hash:string) {
      return scope(actor,businessId,async (tx) => {
        const rows=await records(tx,businessId), row=rows.find((r) => r.id===planId);
        if (!row || row.data.kind!=="plan") throw new ApplicationError("NOT_FOUND");
        if (row.data.hash!==hash || await planReason(tx,actor,row,rows)) throw new ApplicationError("CONFLICT");
        const [seen]=await tx.select().from(opportunityDueAction).where(and(eq(opportunityDueAction.businessId,businessId),eq(opportunityDueAction.whatsappPlanId,planId)));
        if (seen) return;
        const a=await account(tx,businessId);
        if (a.issues.length || !a.intake || !a.connection || a.connection.version!==row.data.plan.connectionVersion) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        const plan=row.data.plan;
        for (const recipient of plan.recipients) {
          const existing = await tx.select().from(opportunityDueAction).where(and(eq(opportunityDueAction.businessId,businessId),eq(opportunityDueAction.whatsappPeer,recipient.peer),sql`${opportunityDueAction.state} IN ('pending','committed')`));
          if (existing.length) throw new ApplicationError("CONFLICT");
          const opportunityId=randomUUID();
          await tx.insert(inboxOpportunity).values({id:opportunityId,businessId,title:`${plan.name}: ${recipient.peer}`,stage:"prospect",ownerId:actor.userId,controlState:"automation",controlVersion:0,policyVersion:plan.authorityVersion,handoffReason:"Owner-approved WhatsApp prospect plan; no direct engagement",nextAction:"Run bounded approved messages and monitor replies",createdAt:clock.now()});
          let due=sequenceDue(plan.timing,new Date(Math.max(clock.now().getTime(),new Date(plan.notBefore).getTime())));
          for (const [stepIndex,step] of recipient.steps.entries()) {
            if (stepIndex) due=sequenceDue(plan.timing,new Date(due.getTime()+step.delayMinutes*60000));
            await tx.insert(opportunityDueAction).values({id:randomUUID(),businessId,opportunityId,messageId:null,conversationId:null,connectionId:a.intake.inboxConnectionId,actorId:actor.userId,sessionId:actor.sessionId,controlVersion:0,associationVersion:0,policyVersion:plan.authorityVersion,evaluation:step.evaluation,state:"pending",dueAt:due,createdAt:clock.now(),whatsappPlanId:planId,whatsappPeer:recipient.peer,whatsappStep:stepIndex});
          }
        }
      });
    },
    async reserveAt(tx: Transaction, actor: WorkIdentity, intent: MetaIntent) {
      await append(tx, actor, intent.businessId, intent.connectionId, `intent:${intent.actionId}`, { kind: "intent", intent });
    },
    async dispatchAt(tx: Transaction, actor: WorkIdentity, intent: MetaIntent, reauthorize: () => Promise<boolean>, signal: AbortSignal): Promise<{ reason: string | null; result: MetaSendResult | null }> {
      const a = await account(tx, intent.businessId);
      if (a.issues.length || !a.connection?.credentials || !a.connection.assets || !d.vault || !d.transport) return { reason: "whatsapp_account_not_ready", result: null };
      if (a.connection.id !== intent.connectionId || a.connection.version !== intent.connectionVersion || !isDeepStrictEqual(a.connection.assets, intent.assets)) return { reason: "whatsapp_account_changed", result: null };
      try {
        const token = metaTokenSchema.parse(JSON.parse(d.vault.decrypt(a.connection.credentials, `whatsapp:${intent.businessId}:${a.connection.id}:${a.connection.version}`)));
        if (token.expiresAt && new Date(token.expiresAt) <= clock.now()) return { reason: "whatsapp_authorization_expired", result: null };
        const requested = clock.now();
        const proof = metaObservationSchema.parse(await d.provider.inspect(token, intent.assets, a.connection.configuration, a.connection.coexistenceFinished, signal));
        if (!isDeepStrictEqual({ portfolioId: proof.portfolioId, wabaId: proof.wabaId, phoneNumberId: proof.phoneNumberId }, intent.assets) || new Date(proof.observedAt) < requested || new Date(proof.observedAt) > clock.now() || new Date(proof.validUntil) <= clock.now() || new Date(proof.validUntil).getTime() > clock.now().getTime() + 15 * 60000) return { reason: "whatsapp_invalid_account_evidence", result: null };
        await tx.update(whatsAppConnection).set({ observation: proof }).where(eq(whatsAppConnection.id, intent.connectionId));
        if (intent.template) {
          const template = await d.transport.template(token, intent.assets, { name: intent.template.name, language: intent.template.language, parameters: intent.template.parameters }, signal);
          if (!isDeepStrictEqual(template, intent.template)) return { reason: "whatsapp_template_changed", result: null };
        }
        // Credential/account/template I/O can consume the window or reveal revoked grants. Recheck the whole guarded action now.
        if (!(await reauthorize())) return { reason: "whatsapp_authorization_changed", result: null };
        signal.throwIfAborted();
        return { reason: null, result: await d.transport.send(token, intent, signal) };
      } catch { return { reason: "whatsapp_provider_check_unavailable", result: null }; }
    },
    async settleAt(tx: Transaction, actor: WorkIdentity, intent: MetaIntent, result: MetaSendResult) {
      await append(tx, actor, intent.businessId, intent.connectionId, `result:${intent.actionId}`, { kind: "result", actionId: intent.actionId, result });
    },
    intentAt,
    async reconcileAt(tx: Transaction, actor: WorkIdentity, businessId: string, actionId: string) {
      const intent = await intentAt(tx, businessId, actionId);
      if (!intent) return;
      const rows = await records(tx, businessId), proof = await evidenceAt(tx, businessId, intent, rows);
      if (!proof.proof || !proof.messageRef) return;
      const result: MetaSendResult = { status: "accepted", peer: intent.peer, messageRef: proof.messageRef };
      await append(tx, actor, businessId, intent.connectionId, `reconciled:${actionId}:${proof.proof.id}`, { kind: "result", actionId, result });
      await tx.update(opportunityDueAction).set({ state: "dispatched", reason: `whatsapp_${proof.evidence}` }).where(and(eq(opportunityDueAction.id, actionId), eq(opportunityDueAction.businessId, businessId), sql`${opportunityDueAction.state} IN ('committed','dispatched')`));
    },
    reconcile(actor: WorkIdentity, businessId: string, actionId: string) {
      return scope(actor, businessId, async (tx, role) => {
        const [action] = await tx.select().from(opportunityDueAction).where(and(eq(opportunityDueAction.id, actionId), eq(opportunityDueAction.businessId, businessId)));
        if (!action) throw new ApplicationError("NOT_FOUND");
        if (role === "salesperson" && action.actorId !== actor.userId) throw new ApplicationError("FORBIDDEN");
        const intent = await intentAt(tx, businessId, actionId);
        if (!intent) return;
        const proof = await evidenceAt(tx, businessId, intent, await records(tx,businessId));
        if (!proof.proof || !proof.messageRef) return;
        await append(tx, actor,businessId,intent.connectionId,`reconciled:${actionId}:${proof.proof.id}`,{kind:"result",actionId,result:{status:"accepted",peer:intent.peer,messageRef:proof.messageRef}});
        await tx.update(opportunityDueAction).set({state:"dispatched",reason:`whatsapp_${proof.evidence}`}).where(and(eq(opportunityDueAction.id,actionId),eq(opportunityDueAction.businessId,businessId),sql`${opportunityDueAction.state} IN ('committed','dispatched')`));
      });
    },
    workspace: (actor: WorkIdentity, businessId: string) => scope(actor, businessId, (tx, role) => workspace(tx, businessId, role)),
    permission(actor: WorkIdentity, businessId: string, permission: MetaPermission) {
      return scope(actor, businessId, async (tx) => {
        const a = await account(tx, businessId);
        if (!a.connection) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        if (new Date(permission.observedAt) > clock.now() || new Date(permission.validUntil) <= clock.now() || new Date(permission.validUntil) <= new Date(permission.observedAt)) throw new ApplicationError("INVALID_INPUT");
        if (permission.opportunityId) {
          const [need] = await tx.execute(sql`select id from public.inbox_opportunity where business_id=${businessId}::uuid and id=${permission.opportunityId}::uuid`).then((r) => r.rows);
          if (!need) throw new ApplicationError("NOT_FOUND");
        }
        await append(tx, actor, businessId, a.connection.id, `permission:${randomUUID()}`, { kind: "permission", permission });
      }, true);
    },
  };
}
