import { and, asc, eq } from "drizzle-orm";
import type { WorkIdentity } from "../models/discovery";
import type { ReportDetail, ReportMetric } from "../models/reporting";
import type { Transaction } from "./scope";
import { inquiryContext, sameInquirySnapshot } from "./inquiry-context";
import { readRfqWorkspace } from "./rfq-repository";
import {
  appointment,
  appointmentHistory,
  callRevision,
  commercialOutcome,
  inboxAssociation,
  inboxAssociationHistory,
  inboxConnection,
  inboxMessage,
  inboxMessageLink,
  inboxOpportunity,
  inquiryRun,
  opportunityControlHistory,
  opportunityManualEvent,
  rfqRequest,
  whatsAppReceipt,
} from "./schema";

export type AddReportMetric = (
  id: string,
  label: string,
  group: ReportMetric["group"],
  value: number | null,
  denominator: number | null,
  definition: string,
  cohort: string,
  unit?: string,
  status?: ReportMetric["status"],
) => void;

/** Counts every retained source identity before paginating safe projections. No provider I/O. */
export async function collectSalesReport(
  tx: Transaction,
  actor: WorkIdentity,
  businessId: string,
  at: Date,
  inWindow: (value: Date | string) => boolean,
  metric: AddReportMetric,
  items: ReportDetail[],
) {
  const base = `/businesses/${businessId}`;
  const needs = await tx
    .select()
    .from(inboxOpportunity)
    .where(eq(inboxOpportunity.businessId, businessId));
  const messages = await tx
    .select({
      message: inboxMessage,
      opportunityId: inboxMessageLink.opportunityId,
      buyerId: inboxAssociation.buyerId,
      version: inboxAssociation.version,
      channel: inboxConnection.channel,
    })
    .from(inboxMessage)
    .innerJoin(
      inboxMessageLink,
      and(
        eq(inboxMessageLink.id, inboxMessage.id),
        eq(inboxMessageLink.businessId, businessId),
      ),
    )
    .innerJoin(
      inboxAssociation,
      and(
        eq(inboxAssociation.id, inboxMessage.conversationId),
        eq(inboxAssociation.businessId, businessId),
      ),
    )
    .innerJoin(
      inboxConnection,
      and(
        eq(inboxConnection.id, inboxMessage.connectionId),
        eq(inboxConnection.businessId, businessId),
      ),
    )
    .where(eq(inboxMessage.businessId, businessId));
  const incoming = messages.filter((m) =>
    inWindow(m.message.content.occurredAt),
  );
  const engagement = incoming.filter(
    (m) =>
      ["direct_inquiry", "buying_interest_reply"].includes(
        m.message.content.kind,
      ) && m.opportunityId,
  );
  const cohort = new Set(engagement.map((m) => m.opportunityId));
  const cohortLabel =
    "Opportunities with currently associated direct inquiry or buying-interest messages occurring in the inclusive selected interval.";
  metric(
    "incoming_messages",
    "Captured incoming messages",
    "sales",
    incoming.length,
    null,
    "Distinct captured message identities, including non-buying replies and opt-outs. Outgoing app echoes are not incoming messages.",
    "Message occurred time in interval",
    "messages",
  );
  metric(
    "direct_engagement",
    "Direct buying-interest Opportunities",
    "sales",
    cohort.size,
    null,
    "Distinct current purchasing needs supported by direct inquiry or buying-interest reply. Plain replies/public signals do not establish buying interest.",
    cohortLabel,
    "Opportunities",
  );
  metric(
    "engaged_buyers",
    "Associated engaged buyers",
    "sales",
    new Set(engagement.map((m) => m.buyerId)).size,
    null,
    "Distinct explicitly associated buyer identities across channels. A buyer can have several purchasing needs; unassociated identities are not guessed to be the same person.",
    cohortLabel,
    "buyers",
  );
  metric(
    "unassociated_messages",
    "Messages awaiting association",
    "sales",
    incoming.filter((m) => !m.opportunityId).length,
    incoming.length,
    "Incoming messages without a current purchasing-need association / captured incoming messages.",
    "Message occurred time in interval",
    "messages",
  );
  for (const channel of ["email", "whatsapp"] as const)
    metric(
      `${channel}_incoming`,
      `${channel} incoming messages`,
      "sales",
      incoming.filter((m) => m.channel === channel).length,
      incoming.length,
      "Captured incoming messages on this channel / captured incoming messages across email and WhatsApp.",
      "Message occurred time in interval",
      "messages",
    );
  for (const m of incoming)
    items.push({
      id: `incoming:${m.message.id}`,
      category: "sales",
      entityId: m.message.id,
      opportunityId: m.opportunityId,
      channel: m.channel,
      kind: m.message.content.kind,
      state: m.opportunityId ? "associated" : "review_required",
      at: new Date(m.message.content.occurredAt).toISOString(),
      sourceIds: [m.message.id],
      version: m.version,
      link: `${base}/inbox/${m.message.conversationId}`,
      note: "Captured source message; displayed association is current. Review source content and association history in the inbox.",
    });
  const evaluations = await tx
    .select()
    .from(inquiryRun)
    .where(eq(inquiryRun.businessId, businessId))
    .orderBy(asc(inquiryRun.sequence));
  let evaluated = 0,
    qualified = 0,
    stale = 0;
  const contexts = new Map<
    string,
    Awaited<ReturnType<typeof inquiryContext>>
  >();
  const currentAssessments = new Set<string>();
  for (const need of needs) {
    const latest = evaluations
      .filter((r) => r.opportunityId === need.id)
      .at(-1);
    if (latest || cohort.has(need.id)) {
      const context = await inquiryContext(tx, businessId, need.id, at);
      contexts.set(need.id, context);
      const current =
        !!latest &&
        sameInquirySnapshot(latest.snapshot, context.snapshot) &&
        latest.result.status !== "stale";
      if (current) currentAssessments.add(latest.id);
      if (cohort.has(need.id) && latest) {
        if (current && latest.result.status !== "processing") evaluated++;
        if (
          current &&
          latest.result.status === "ready" &&
          latest.result.qualification === "qualified"
        )
          qualified++;
        if (!current) stale++;
      }
    }
    if (need.nextAction)
      items.push({
        id: `need:${need.id}`,
        category: "activity",
        entityId: need.id,
        opportunityId: need.id,
        channel: null,
        kind: "next_action",
        state: need.controlState,
        at: need.createdAt.toISOString(),
        sourceIds: [need.id],
        version: need.controlVersion,
        link: `${base}/opportunities/${need.id}`,
        note: need.nextAction,
      });
  }
  for (const r of evaluations.filter((r) => inWindow(r.at)))
    items.push({
      id: `assessment:${r.id}`,
      category: "sales",
      entityId: r.id,
      opportunityId: r.opportunityId,
      channel:
        messages.find((m) => m.message.id === r.messageId)?.channel ?? null,
      kind: "qualification_assessment",
      state: `${currentAssessments.has(r.id) ? "current" : "historical"}_${r.result.status}_${r.result.qualification}`,
      at: r.at.toISOString(),
      sourceIds: [
        ...new Set([
          r.id,
          r.messageId,
          ...r.snapshot.messages.map((m) => m.id),
        ]),
      ],
      version: r.sequence,
      link: `${base}/opportunities/${r.opportunityId}`,
      note: `Recorded assessment against Business knowledge version ${r.snapshot.knowledgeVersion ?? "unavailable"}. Historical results retain their original classification; current coverage requires the unchanged source/knowledge/control snapshot.`,
    });
  metric(
    "recorded_next_actions",
    "Recorded current next actions",
    "activity",
    needs.filter((n) => Boolean(n.nextAction)).length,
    needs.length,
    "Retained Opportunities with a recorded current next action / all retained Business Opportunities, including unengaged prospects. These current views are independent of the selected event interval.",
    "All retained Opportunities; current next-action fields",
    "Opportunities",
  );
  metric(
    "qualification_coverage",
    "Current qualification assessment coverage",
    "sales",
    evaluated,
    cohort.size,
    "Cohort Opportunities with a completed current-context assessment / direct-engagement Opportunities. Stale, changed and processing evaluations do not qualify.",
    cohortLabel,
    "Opportunities",
  );
  metric(
    "qualified",
    "Currently qualified Opportunities",
    "sales",
    qualified,
    cohort.size,
    "Cohort Opportunities whose latest ready evaluation is qualified against its unchanged source/knowledge/control snapshot / direct-engagement Opportunities.",
    cohortLabel,
    "Opportunities",
  );
  metric(
    "stale_qualification",
    "Stale qualification assessments",
    "sales",
    stale,
    cohort.size,
    "Cohort Opportunities whose latest assessment no longer matches current context / direct-engagement Opportunities.",
    cohortLabel,
    "Opportunities",
    stale ? "stale" : "recorded",
  );
  const requests = await tx
    .select()
    .from(rfqRequest)
    .where(eq(rfqRequest.businessId, businessId));
  let complete = 0,
    review = 0;
  const requestCohort = requests.filter((r) => inWindow(r.createdAt));
  for (const r of requests) {
    const c =
      contexts.get(r.opportunityId) ??
      (await inquiryContext(tx, businessId, r.opportunityId, at));
    const state = await readRfqWorkspace(tx, actor, businessId, c);
    if (inWindow(r.createdAt) && state.current?.status === "complete")
      complete++;
    if (inWindow(r.createdAt) && state.current?.status === "review_required")
      review++;
    for (const revision of state.history.filter((v) => inWindow(v.at)))
      items.push({
        id: `rfq:${revision.revisionId}`,
        category: "sales",
        entityId: r.id,
        opportunityId: r.opportunityId,
        channel: null,
        kind: "rfq_revision",
        state:
          revision.revisionId === state.current?.revisionId
            ? state.current.status
            : `historical_${revision.completeness}`,
        at: revision.at,
        sourceIds: [revision.revisionId, ...revision.sources.map((s) => s.id)],
        version: revision.version,
        link: `${base}/opportunities/${r.opportunityId}`,
        note: "Quotation request requirements; completeness is not an issued quote, order or sale.",
      });
  }
  metric(
    "rfqs",
    "Quotation requests",
    "sales",
    requestCohort.length,
    null,
    "Distinct RFQ request identities created in the interval; revisions are not new requests.",
    "RFQ-created cohort",
    "requests",
  );
  metric(
    "complete_rfqs",
    "Currently complete RFQs",
    "sales",
    complete,
    requestCohort.length,
    "Request-created cohort whose latest revision remains complete against current requirements and source associations / cohort RFQs.",
    "RFQ-created cohort; current completeness",
    "requests",
  );
  metric(
    "review_rfqs",
    "RFQs needing current review",
    "sales",
    review,
    requestCohort.length,
    "Request-created cohort whose evidence/requirements now require review / cohort RFQs.",
    "RFQ-created cohort; current completeness",
    "requests",
    review ? "stale" : "recorded",
  );
  const outcomes = await tx
    .select({
      id: commercialOutcome.id,
      opportunityId: commercialOutcome.opportunityId,
      actionId: commercialOutcome.actionId,
      kind: commercialOutcome.kind,
      source: commercialOutcome.source,
      occurredAt: commercialOutcome.occurredAt,
    })
    .from(commercialOutcome)
    .where(eq(commercialOutcome.businessId, businessId));
  for (const kind of [
    "issued_quote",
    "accepted_order",
    "confirmed_sale",
  ] as const) {
    const selected = outcomes.filter(
      (r) => r.kind === kind && inWindow(r.occurredAt),
    );
    metric(
      kind,
      {
        issued_quote: "Issued quotes",
        accepted_order: "Accepted orders",
        confirmed_sale: "Confirmed sales",
      }[kind],
      "sales",
      selected.length,
      null,
      "Canonical typed authoritative commercial evidence identities. RFQs, call notes, suggestions, delivery and replies are not commercial proof. Outcomes may legitimately overlap for one purchasing need.",
      "Authoritative outcome occurred time in interval",
      "outcomes",
    );
    metric(
      `${kind}_cohort`,
      `${kind.replaceAll("_", " ")} in engagement cohort`,
      "sales",
      new Set(
        outcomes
          .filter(
            (r) =>
              r.kind === kind &&
              r.occurredAt <= at &&
              cohort.has(r.opportunityId),
          )
          .map((r) => r.opportunityId),
      ).size,
      cohort.size,
      "Direct-engagement cohort Opportunities with this retained typed outcome by report generation / the SAME engagement cohort. This is cohort coverage, not a period-event conversion rate.",
      cohortLabel,
      "Opportunities",
    );
    for (const r of selected)
      items.push({
        id: `commercial:${r.id}`,
        category: "sales",
        entityId: r.actionId,
        opportunityId: r.opportunityId,
        channel: null,
        kind,
        state: `confirmed_by_${r.source}`,
        at: r.occurredAt.toISOString(),
        sourceIds: [r.id, r.actionId],
        version: null,
        link: `${base}/opportunities/${r.opportunityId}/commercial-actions`,
        note: "Retained typed commercial evidence. Reporting provides no alternative outcome-writing path.",
      });
  }
  const bookings = await tx
    .select({
      id: appointment.id,
      opportunityId: appointment.opportunityId,
      status: appointment.status,
      phase: appointment.phase,
      at: appointment.at,
    })
    .from(appointment)
    .where(eq(appointment.businessId, businessId));
  const history = await tx
    .select({
      id: appointmentHistory.id,
      appointmentId: appointmentHistory.appointmentId,
      opportunityId: appointmentHistory.opportunityId,
      kind: appointmentHistory.kind,
      source: appointmentHistory.source,
      occurredAt: appointmentHistory.occurredAt,
      sequence: appointmentHistory.sequence,
    })
    .from(appointmentHistory)
    .where(eq(appointmentHistory.businessId, businessId));
  metric(
    "appointment_requests",
    "Appointment requests",
    "sales",
    bookings.filter((r) => inWindow(r.at)).length,
    null,
    "Distinct reservation requests created in the interval. Held/committed/ambiguous requests are not confirmation.",
    "Request-created time in interval",
    "appointments",
  );
  for (const status of ["confirmed", "attended", "cancelled"] as const) {
    const reached = history.filter(
      (r) => r.kind === status && inWindow(r.occurredAt),
    );
    metric(
      `appointments_${status}`,
      `${status} appointments (recorded events)`,
      "sales",
      new Set(reached.map((r) => r.appointmentId)).size,
      null,
      "Distinct appointment identities with this authoritative history event in the interval. Repeated observations do not add appointments; historical confirmation survives later cancellation.",
      "Appointment evidence occurred time in interval",
      "appointments",
    );
    metric(
      `appointments_current_${status}`,
      `Currently ${status} request cohort`,
      "sales",
      bookings.filter((r) => inWindow(r.at) && r.status === status).length,
      bookings.filter((r) => inWindow(r.at)).length,
      "Request-created cohort in this current customer status / the same request-created cohort. Worker phase is separate.",
      "Appointment request-created cohort; current status",
      "appointments",
    );
  }
  for (const r of history.filter((r) => inWindow(r.occurredAt)))
    items.push({
      id: `booking:${r.id}`,
      category: "sales",
      entityId: r.appointmentId,
      opportunityId: r.opportunityId,
      channel: null,
      kind: `appointment_${r.kind}`,
      state: r.source,
      at: r.occurredAt.toISOString(),
      sourceIds: [r.id, r.appointmentId],
      version: r.sequence,
      link: `${base}/opportunities/${r.opportunityId}/appointments`,
      note: "Immutable appointment event. Request, provider confirmation, Business attendance and current status remain distinct.",
    });
  const revisions = await tx
    .select({
      id: callRevision.id,
      callId: callRevision.callId,
      opportunityId: callRevision.opportunityId,
      version: callRevision.version,
      occurredAt: callRevision.occurredAt,
      at: callRevision.at,
    })
    .from(callRevision)
    .where(eq(callRevision.businessId, businessId))
    .orderBy(asc(callRevision.version));
  const latestCalls = new Map(revisions.map((r) => [r.callId, r]));
  metric(
    "calls",
    "Recorded human calls",
    "activity",
    [...latestCalls.values()].filter((r) => inWindow(r.occurredAt)).length,
    null,
    "Distinct call identities using their latest corrected occurrence time. Revisions are not additional calls; no duration was recorded.",
    "Current call occurrence time in interval",
    "calls",
  );
  metric(
    "call_revisions",
    "Recorded call revisions",
    "activity",
    revisions.filter((r) => inWindow(r.at)).length,
    null,
    "Attributed immutable call writes, including corrections; this measures recorded activity, not call count or hours.",
    "Revision recorded time in interval",
    "revisions",
  );
  for (const r of revisions.filter((r) => inWindow(r.at)))
    items.push({
      id: `call:${r.id}`,
      category: "activity",
      entityId: r.callId,
      opportunityId: r.opportunityId,
      channel: "call",
      kind: "call_revision",
      state: latestCalls.get(r.callId)?.id === r.id ? "current" : "historical",
      at: r.at.toISOString(),
      sourceIds: [r.id, r.callId],
      version: r.version,
      link: `${base}/opportunities/${r.opportunityId}/calls`,
      note: "Attributed call revision. Free-text outcome does not establish a sale and no duration is measured.",
    });
  const controls = await tx
    .select()
    .from(opportunityControlHistory)
    .where(eq(opportunityControlHistory.businessId, businessId));
  metric(
    "human_control",
    "Engagement cohort under human control",
    "activity",
    needs.filter((n) => cohort.has(n.id) && n.controlState === "human").length,
    cohort.size,
    "Engagement cohort Opportunities currently controlled by a person / the same cohort; this is not measured staff time.",
    cohortLabel,
    "Opportunities",
  );
  metric(
    "handoffs",
    "Recorded human handoffs",
    "activity",
    controls.filter(
      (r) =>
        inWindow(r.at) &&
        r.after.state === "human" &&
        r.before.state !== "human",
    ).length,
    null,
    "Actual automation-to-human control transitions in the interval; repeated takeover while already human is not another handoff.",
    "Control transition recorded time in interval",
    "transitions",
  );
  for (const r of controls.filter((r) => inWindow(r.at)))
    items.push({
      id: `control:${r.id}`,
      category: "activity",
      entityId: r.opportunityId,
      opportunityId: r.opportunityId,
      channel: null,
      kind: r.command,
      state: r.after.state,
      at: r.at.toISOString(),
      sourceIds: [r.id],
      version: r.after.version,
      link: `${base}/opportunities/${r.opportunityId}`,
      note: "Recorded control transition; current owner and next action appear on the Opportunity.",
    });
  const manual = await tx
    .select({
      id: opportunityManualEvent.id,
      connectionId: opportunityManualEvent.connectionId,
      opportunityId: opportunityManualEvent.opportunityId,
      occurredAt: opportunityManualEvent.occurredAt,
    })
    .from(opportunityManualEvent)
    .where(eq(opportunityManualEvent.businessId, businessId));
  metric(
    "manual_replies",
    "Observed manual replies",
    "activity",
    manual.filter((r) => inWindow(r.occurredAt)).length,
    null,
    "Distinct supported manual activity identities. No duration or native delivery is inferred.",
    "Manual activity occurred time in interval",
    "messages",
  );
  const metaReceipts = await tx
    .select({
      id: whatsAppReceipt.id,
      eventKey: whatsAppReceipt.eventKey,
      kind: whatsAppReceipt.kind,
      opportunityId: whatsAppReceipt.opportunityId,
      activity: whatsAppReceipt.activity,
    })
    .from(whatsAppReceipt)
    .where(eq(whatsAppReceipt.businessId, businessId));
  const nativeManuals = metaReceipts.flatMap((r) => {
    const applied = controls.find(
      (c) =>
        c.command === "manual_reply" &&
        c.sourceRef === r.eventKey &&
        c.opportunityId === r.opportunityId,
    );
    return r.kind === "app_echo" && applied
      ? [
          {
            id: r.id,
            opportunityId: applied.opportunityId,
            occurredAt: r.activity?.occurredAt ?? null,
            recordedAt: applied.at,
            controlId: applied.id,
          },
        ]
      : [];
  });
  metric(
    "whatsapp_manual_activity",
    "Applied WhatsApp Business App manual activity",
    "activity",
    nativeManuals.filter((r) => inWindow(r.recordedAt)).length,
    null,
    "Distinct authenticated native app-echo identities with an actual bound manual-control source event. Application echoes, status events and buyer requests for a human are excluded. This is recorded activity, not duration or delivery.",
    "Manual-control recorded time in interval; retained event identity survives private artifact expiry",
    "messages",
  );
  for (const r of nativeManuals.filter((r) => inWindow(r.recordedAt)))
    items.push({
      id: `meta-manual:${r.id}`,
      category: "activity",
      entityId: r.id,
      opportunityId: r.opportunityId,
      channel: "whatsapp",
      kind: "whatsapp_manual_activity",
      state: "applied",
      at: r.recordedAt.toISOString(),
      sourceIds: [r.id, r.controlId],
      version: null,
      link: `${base}/opportunities/${r.opportunityId}`,
      note: "Supported native manual activity bound to an actual control event. Time shown is application-recorded time; it establishes neither duration nor delivery.",
    });
  for (const r of manual.filter((r) => inWindow(r.occurredAt)))
    items.push({
      id: `manual:${r.id}`,
      category: "activity",
      entityId: r.id,
      opportunityId: r.opportunityId,
      channel:
        messages.find((m) => m.message.connectionId === r.connectionId)
          ?.channel ?? null,
      kind: "manual_reply",
      state: "observed",
      at: r.occurredAt.toISOString(),
      sourceIds: [r.id],
      version: null,
      link: `${base}/opportunities/${r.opportunityId}`,
      note: "Attributed supported manual activity. This observation establishes neither duration nor delivery.",
    });
  const associations = await tx
    .select({
      id: inboxAssociationHistory.id,
      at: inboxAssociationHistory.at,
      version: inboxAssociationHistory.version,
      conversationId: inboxAssociationHistory.conversationId,
    })
    .from(inboxAssociationHistory)
    .where(eq(inboxAssociationHistory.businessId, businessId));
  for (const r of associations.filter((r) => inWindow(r.at)))
    items.push({
      id: `association:${r.id}`,
      category: "activity",
      entityId: r.conversationId,
      opportunityId: null,
      channel: null,
      kind: "association_history",
      state: "recorded",
      at: r.at.toISOString(),
      sourceIds: [r.id],
      version: r.version,
      link: `${base}/inbox/${r.conversationId}`,
      note: "Immutable association event; engagement and current qualification use the current message links.",
    });
  return { cohort, needs, messages, incoming, nativeManuals };
}
