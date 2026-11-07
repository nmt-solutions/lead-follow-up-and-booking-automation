import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import { createInboxApplication } from "../../src/application/inbox";
import { createInboxRepository } from "../../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../../src/inbox/adapter";
import { createKnowledgeApplication } from "../../src/application/knowledge";
import { createKnowledgeRepository } from "../../src/db/knowledge-repository";
import { createOpportunityApplication } from "../../src/application/opportunity-control";
import { createOpportunityRepository } from "../../src/db/opportunity-control-repository";
import { createCallApplication } from "../../src/application/calls";
import { createCallRepository } from "../../src/db/call-repository";
import { createRfqApplication } from "../../src/application/rfq";
import { createRfqRepository } from "../../src/db/rfq-repository";
import { createCommercialApplication } from "../../src/application/commercial-actions";
import { createCommercialRepository } from "../../src/db/commercial-actions-repository";

export async function reportSalesFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  h.clock.set("2026-11-05T09:00:00Z");
  const owner = await h.signIn(
    `report-sales-${crypto.randomUUID()}@example.com`,
  );
  const actor = await h.authenticate(owner);
  const business = await h.application.createBusiness(owner, {
    name: "Supplier",
    offering: "Steel",
    homeMarket: "US",
    website: "",
  });
  const db = runtimeDatabase(h.runtime);
  const inbox = createInboxApplication({
    authenticate: h.authenticate,
    repository: createInboxRepository(db),
    adapter: normalizedInquiryAdapter,
    clock: h.clock,
  });
  const connection = await inbox.addConnection(owner, business.id, {
    label: "Sales",
    channel: "email",
    conversationRefs: [],
    manualRepliesObservable: true,
  });
  const incoming = {
    eventId: "inquiry",
    messageRef: "inquiry",
    conversationRef: "buyer",
    senderRef: "buyer@example.net",
    senderName: "Buyer",
    subject: "Steel",
    text: "Please quote steel.",
    kind: "direct_inquiry",
    occurredAt: h.clock.now().toISOString(),
  };
  await inbox.capture(owner, business.id, connection.id, incoming);
  await inbox.capture(owner, business.id, connection.id, incoming);
  const ws = await inbox.workspace(owner, business.id);
  const need = ws.opportunities[0];
  const conversation = await inbox.conversation(
    owner,
    business.id,
    ws.conversations[0].id,
  );
  const knowledge = createKnowledgeApplication({
    authenticate: h.authenticate,
    repository: createKnowledgeRepository(db),
    clock: h.clock,
  });
  const configuration = {
    offerings: [{ name: "Steel", details: "Steel supply" }],
    answers: [],
    missingInformation: [],
    goal: "rfq",
    qualification: [],
    escalation: { name: "Owner", email: "owner@example.com" },
  };
  await knowledge.saveDraft(owner, business.id, {
    expectedVersion: 0,
    configuration,
    note: "Requirements",
  });
  await knowledge.approve(owner, business.id, {
    expectedVersion: 1,
    note: "Approved",
  });
  const effects: unknown[] = [];
  const control = createOpportunityApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    repository: createOpportunityRepository(db, h.clock),
    clock: h.clock,
    provider: {
      channels: [],
      async dispatch(v) {
        effects.push(v);
      },
    },
  });
  await control.change(owner, business.id, need.id, {
    command: "takeover",
    expectedVersion: 0,
    reason: "Review buyer need",
    nextAction: "Prepare request",
  });
  const calls = createCallApplication({
    authenticateForWork: h.access.authenticateForWork,
    repository: createCallRepository(db, h.clock),
  });
  const rfq = createRfqApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    repository: createRfqRepository(db, h.clock),
  });
  const commercial = createCommercialApplication({
    authenticateForWork: h.access.authenticateForWork,
    repository: createCommercialRepository(db, h.clock),
    provider: {
      key: "reporting-no-transport",
      available: false,
      async execute(v) {
        effects.push(v);
        throw new Error("No transport configured");
      },
    },
  });
  return {
    owner,
    actor,
    business,
    db,
    inbox,
    connection,
    conversation,
    need,
    knowledge,
    configuration,
    control,
    calls,
    rfq,
    commercial,
    effects,
  };
}
