import { createHmac } from "node:crypto";
import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import { createWhatsAppApplication } from "../../src/application/whatsapp";
import { createWhatsAppRepository } from "../../src/db/whatsapp-repository";
import { createWhatsAppIntakeApplication } from "../../src/application/whatsapp-intake";
import { createWhatsAppIntakeRepository } from "../../src/db/whatsapp-intake-repository";
import { calendarCredentialVault } from "../../src/appointments/credentials";
import { metaFixture } from "./whatsapp";
import { createInboxApplication } from "../../src/application/inbox";
import { createInboxRepository } from "../../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../../src/inbox/adapter";
import { createOpportunityApplication } from "../../src/application/opportunity-control";
import { createOpportunityRepository } from "../../src/db/opportunity-control-repository";
import { createWhatsAppSendingRepository } from "../../src/db/whatsapp-sending-repository";
import { createWhatsAppSendingApplication } from "../../src/application/whatsapp-sending";
import { createMetaTransport } from "../../src/whatsapp/transport";
import { createKnowledgeApplication } from "../../src/application/knowledge";
import { createKnowledgeRepository } from "../../src/db/knowledge-repository";
import { bookingInquiry } from "./booking-inquiry";
import { createDiscoveryApplication } from "../../src/application/discovery";
import { createDiscoveryRepository } from "../../src/db/discovery-repository";
import { discoveryPolicySchema, type DiscoveryWork } from "../../src/models/discovery";
import { createCommercialAuthorityApplication } from "../../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../../src/db/commercial-authority-repository";

let number = 820000;
export async function metaSendingFixture(h: Awaited<ReturnType<typeof createHarness>>, name: string) {
  h.clock.set("2026-11-05T09:00:00Z");
  const credentials = await h.signIn(`meta-send-${name}@example.com`);
  const business = await h.application.createBusiness(credentials, { name: "Supplier", offering: "Steel", homeMarket: "US", website: "" });
  const businessId = business.id, db = runtimeDatabase(h.runtime), meta = metaFixture(h.clock);
  const vault = calendarCredentialVault({ activeKeyId: "test", keys: { test: "ab".repeat(32) } });
  const onboarding = createWhatsAppApplication({ authenticate: h.access.authenticateForWork, repository: createWhatsAppRepository(db, h.clock), provider: meta.provider, clock: h.clock, vault });
  await onboarding.save(credentials, businessId, { expectedVersion: 0, configuration: { portfolioId: "100001", numberSource: "business_app", requestedNumber: "+14155550123", provisioningTerms: "Customer retains carrier, Meta account and transfer control.", customerControlsAssets: true, customerPaysMeta: true, termsVersion: "direct_meta_v1" } });
  const started = await onboarding.start(credentials, businessId, { expectedVersion: 1 });
  const assets = { portfolioId: "100001", wabaId: "200001", phoneNumberId: String(++number) };
  await onboarding.complete(credentials, businessId, { state: started.state, event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", code: "fixture", assets });
  const secret = "deterministic-signed-meta";
  const intakeOptions = { authenticate: h.access.authenticateForWork, repository: createWhatsAppIntakeRepository(db, h.clock), provider: meta.provider, clock: h.clock, vault, configuration: { appSecret: secret, verifyToken: "fixture", workerConfigured: true } };
  const intake = createWhatsAppIntakeApplication(intakeOptions);
  await intake.enable(credentials, businessId, { expectedVersion: 2, receiptRetentionSeconds: 86400 });
  const sent: Record<string, unknown>[] = [];
  const httpState = { ambiguous: false, templateStatus: "APPROVED", beforeSend: null as null | (() => Promise<void>), beforeRead: null as null | (() => Promise<void>) };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/message_templates")) {
      await httpState.beforeRead?.();
      return Response.json({ data: [{ id: "900001", name: "steel_offer", language: "en_US", status: httpState.templateStatus, category: "MARKETING", components: [{ type: "BODY", text: "Hello {{1}}, would you like our steel catalogue?" }] }] });
    }
    if (url.pathname.endsWith("/messages") && init?.method === "POST") {
      await httpState.beforeSend?.();
      const body: unknown = JSON.parse(String(init.body));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid fixture send");
      sent.push(Object.fromEntries(Object.entries(body)));
      if (httpState.ambiguous) throw new Error("Accepted then disconnected");
      const peer = sent.at(-1)?.to;
      return Response.json({ messaging_product: "whatsapp", contacts: [{ input: peer, wa_id: peer }], messages: [{ id: `wamid.out-${sent.length}` }] });
    }
    throw new Error("Unexpected Meta HTTP operation");
  };
  const repository = createWhatsAppSendingRepository(db, h.clock, { provider: meta.provider, vault, transport: createMetaTransport({ graphVersion: "v25.0", fetch: fetcher }), workerReady: true });
  const opportunities = createOpportunityRepository(db, h.clock, repository);
  const control = createOpportunityApplication({ authenticate: h.authenticate, authenticateForWork: h.access.authenticateForWork, repository: opportunities, clock: h.clock, provider: { channels: ["whatsapp"], async dispatch() { throw new Error("Native Meta transport required"); } } });
  const app = createWhatsAppSendingApplication({ authenticate: h.access.authenticateForWork, repository, opportunities, clock: h.clock });
  const inbox = createInboxApplication({ authenticate: h.authenticate, repository: createInboxRepository(db), adapter: normalizedInquiryAdapter, clock: h.clock });
  async function deliver(field: string, value: Record<string, unknown>) {
    const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: assets.wabaId, changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: assets.phoneNumberId }, ...value } }] }] }));
    return intake.accept(raw, `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  }
  const incoming = (id: string, text = "Quantity: 500", parent?: string, timestamp = h.clock.now()) => deliver("messages", { contacts: [{ wa_id: "919876543210", profile: { name: "Buyer" } }], messages: [{ id, from: "919876543210", timestamp: String(Math.floor(timestamp.getTime() / 1000)), type: "text", text: { body: text }, ...(parent ? { context: { id: parent } } : {}) }] });
  await incoming("wamid.inquiry");
  await intake.drain();
  await deliver("smb_message_echoes", { message_echoes: [{ id: "wamid.manual-history", from: "14155550123", to: "919876543210", timestamp: String(Math.floor(h.clock.now().getTime()/1000)), type: "text", text: { body: "Salesperson reviewing" }, context: { id: "wamid.inquiry" } }] });
  await intake.drain();
  const ws = await inbox.workspace(credentials, businessId);
  const opportunityId = ws.opportunities[0].id;
  const current = await control.read(credentials, businessId, opportunityId);
  await control.change(credentials, businessId, opportunityId, { command: "handback", expectedVersion: current.version, reason: "Reviewed", nextAction: "Handle eligible replies" });
  async function groundedReply() {
    const knowledge = createKnowledgeApplication({ authenticate: h.authenticate, repository: createKnowledgeRepository(db), clock: h.clock });
    await knowledge.saveDraft(credentials, businessId, { expectedVersion: 0, note: "Approved information", configuration: { offerings: [{ name: "Steel", details: "Collection only.", inquiryReply: "informational" }], answers: [], missingInformation: [], goal: "rfq", qualification: [{ key: "quantity", label: "Quantity", type: "number", required: true }], escalation: { name: "Sales owner", email: `meta-send-${name}@example.com` } } });
    await knowledge.approve(credentials, businessId, { expectedVersion: 1, note: "Approved" });
    const inquiry = await bookingInquiry(h, db, credentials, businessId, control);
    const conversation = await inbox.conversation(credentials, businessId, ws.conversations[0].id);
    const result = await inquiry.process(credentials, businessId, opportunityId, { messageId: conversation.messages[0].id });
    if (!result.action) throw new Error(`Grounded reply unavailable: ${result.reason}`);
    return result.action;
  }
  const permission = () => app.permission(credentials, businessId, { peer: "919876543210", purpose: "conversation", opportunityId, numberProvided: true, optedIn: true, noticesReviewed: true, reference: "CONSENT-REPLY-2026", sha256: "ab".repeat(32), observedAt: h.clock.now().toISOString(), validUntil: "2026-12-05T09:00:00Z" });
  async function outreach() {
    await h.application.saveConfiguration(credentials,businessId,{offering:"Steel",specifications:"ASTM A653",minimumOrder:"500 kg",deliveryConstraints:"Local",serviceConstraints:"Collection",address:{street:"",locality:"Newark",region:"New Jersey",postalCode:"",country:"United States"},homeMarket:"New Jersey, United States",homeMarketConfirmed:true,additionalMarkets:[],buyerCategories:[{label:"Fabricators",identity:"organization",use:"business_end_user",requiresBuyingRequest:false}],buyersReviewed:true,exclusions:[]});
    const policy=discoveryPolicySchema.parse({adapterId:"phone-fixture",activeMarkets:["New Jersey, United States"],coverage:[{market:"New Jersey, United States",source:"public_web"}],allowanceUnit:"fixture units",maxRunBudget:20,searchUnits:1,reviewUnits:1,concurrency:1,maxResults:3,deadlineMs:10000,permissions:{retainEvidence:true,retainQueries:false,displayEvidence:true,exportEvidence:true,afterCancellation:true,privateAiContext:true}});
    await h.admin.query("insert into discovery_configuration(business_id,policy) values ($1,$2)",[businessId,policy]);
    const queued:DiscoveryWork[]=[];
    let phone="+919876543211";
    const discovery=createDiscoveryApplication({authenticate:h.authenticate,authenticateForWork:h.access.authenticateForWork,authenticateWork:h.access.authenticateWork,repository:createDiscoveryRepository(db,h.clock),clock:h.clock,queue:{async schedule(){throw new Error("Unexpected schedule");},async enqueue(work){queued.push(work);}},provider:{id:policy.adapterId,async search(){return [{name:"Hudson Fabrication",market:"New Jersey, United States",url:"https://fabricator.example/about",excerpt:`We fabricate galvanized steel. Contact ${phone}`}];},async review(){return {relevant:true,reason:"Uses steel",evidenceQuote:"We fabricate galvanized steel",uncertainty:"Timing unknown",company:null,request:null,contacts:[{name:null,nameQuote:null,roleEvidence:null,route:{kind:"phone",value:phone,quote:`Contact ${phone}`}}]};}}});
    async function discover(value=phone){phone=value;await discovery.start(credentials,businessId,{markets:["New Jersey, United States"],publicOffering:"Steel",confirmPublicQuery:true,budget:4,requestKey:crypto.randomUUID()});await discovery.execute(queued.shift());}
    await discover();
    const authority=createCommercialAuthorityApplication({authenticate:h.authenticate,authenticatePrivileged:h.access.authenticatePrivileged,repository:createCommercialAuthorityRepository(db),clock:h.clock});
    const state=await authority.workspace(credentials,businessId), actor=await h.authenticate(credentials);
    state.policy.prices={automationEnabled:true,approvalRequired:false,amountLimit:{currency:"USD",minor:"10000"},discountLimitBps:0,escalationOwnerId:actor.userId};
    const saved=await authority.save(credentials,businessId,{expectedVersion:state.version,policy:state.policy,note:"Bounded messages"});
    const templates=await app.template(credentials,businessId,{name:"steel_offer",language:"en_US",parameters:["Pat"]});
    const selected=templates.candidates[0];
    const plan={campaignId:crypto.randomUUID(),expectedVersion:0,name:"Steel introduction",connectionVersion:2,authorityVersion:saved.version,recipients:[{peer:selected.peer,prospectId:selected.prospectId,contactId:selected.contactId,evidenceKey:selected.evidenceKey,steps:[{template:templates.templates[0].template,delayMinutes:0,evaluation:{action:"prices",amount:{currency:"USD",minor:"500"},discountBps:0}},{template:templates.templates[0].template,delayMinutes:1,evaluation:{action:"prices",amount:{currency:"USD",minor:"500"},discountBps:0}}]}],timing:{timeZone:"UTC",weekdays:[1,2,3,4,5,6,7],startTime:"00:00",endTime:"23:59",dst:"compatible",missed:"next_window"},notBefore:h.clock.now().toISOString(),expiresAt:"2026-11-10T09:00:00Z",maxAttempts:2,stopConditions:{reply:true,optOut:true,takeover:true,authorityChange:true,setupFailure:true}};
    await app.permission(credentials,businessId,{peer:selected.peer,purpose:"outreach",opportunityId:null,numberProvided:true,optedIn:true,noticesReviewed:true,reference:"CONSENT-OUTREACH-2026",sha256:"cd".repeat(32),observedAt:h.clock.now().toISOString(),validUntil:"2026-12-05T09:00:00Z"});
    return {plan,discover,authority};
  }
  return { credentials, businessId, assets, meta, onboarding, intake, control, app, repository, sent, httpState, incoming, deliver, inbox, opportunityId, groundedReply, permission, outreach };
}
