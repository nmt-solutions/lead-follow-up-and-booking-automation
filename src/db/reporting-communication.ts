import { asc, eq } from "drizzle-orm";
import type { ReportDetail } from "../models/reporting";
import type { Transaction } from "./scope";
import type { AddReportMetric, collectSalesReport } from "./reporting-sales";
import {
  emailHandoffEvidence,
  emailSequenceAction,
  emailSequenceEvent,
  emailSuppression,
  opportunityDueAction,
  opportunityManualEvent,
  senderHealthRecord,
  whatsAppOutbound,
  whatsAppReceipt,
} from "./schema";

export async function collectCommunicationReport(
  tx: Transaction,
  businessId: string,
  at: Date,
  inWindow: (v: Date | string) => boolean,
  sales: Awaited<ReturnType<typeof collectSalesReport>>,
  metric: AddReportMetric,
  items: ReportDetail[],
) {
  const base = `/businesses/${businessId}`;
  const actions = await tx
    .select()
    .from(opportunityDueAction)
    .where(eq(opportunityDueAction.businessId, businessId));
  const sequences = await tx
    .select({
      id: emailSequenceAction.id,
      opportunityId: emailSequenceAction.opportunityId,
      state: emailSequenceAction.state,
      at: emailSequenceAction.at,
      receipt: emailSequenceAction.receipt,
      processingAcceptance: emailSequenceAction.processingAcceptance,
    })
    .from(emailSequenceAction)
    .where(eq(emailSequenceAction.businessId, businessId));
  const sequenceEvents = await tx
    .select({
      id: emailSequenceEvent.id,
      actionId: emailSequenceEvent.actionId,
      kind: emailSequenceEvent.kind,
      at: emailSequenceEvent.at,
    })
    .from(emailSequenceEvent)
    .where(eq(emailSequenceEvent.businessId, businessId));
  const meta = await tx
    .select()
    .from(whatsAppOutbound)
    .where(eq(whatsAppOutbound.businessId, businessId))
    .orderBy(asc(whatsAppOutbound.position));
  const withdrawals = meta.filter(
    (r) => r.data.kind === "revoke_permission" && inWindow(r.at),
  );
  metric(
    "whatsapp_permission_withdrawals",
    "Recorded WhatsApp permission withdrawals",
    "communication",
    withdrawals.length,
    null,
    "Canonical permission-withdrawal command events recorded in the interval. Exact replay counts once. This is not a count of unique people or inferred incoming opt-outs; the original permission scope remains authoritative.",
    "Withdrawal recorded time in interval",
    "events",
  );
  for (const r of withdrawals)
    items.push({
      id: `meta-withdrawal:${r.id}`,
      category: "communication",
      entityId: r.id,
      opportunityId: null,
      channel: "whatsapp",
      kind: "permission_withdrawal",
      state: "recorded",
      at: r.at.toISOString(),
      sourceIds: [r.id],
      version: null,
      link: `${base}/whatsapp/sending`,
      note: "Recorded scoped permission withdrawal. The original permission and evidence remain behind their existing authorization checks.",
    });
  const manual = await tx
    .select({
      id: opportunityManualEvent.id,
      opportunityId: opportunityManualEvent.opportunityId,
      occurredAt: opportunityManualEvent.occurredAt,
    })
    .from(opportunityManualEvent)
    .where(eq(opportunityManualEvent.businessId, businessId));
  const responded = new Set<string>();
  const cohortStart = new Map<string, number>();
  for (const m of sales.incoming)
    if (
      m.opportunityId &&
      ["direct_inquiry", "buying_interest_reply"].includes(
        m.message.content.kind,
      )
    ) {
      const time = Date.parse(m.message.content.occurredAt);
      cohortStart.set(
        m.opportunityId,
        Math.min(time, cohortStart.get(m.opportunityId) ?? Infinity),
      );
    }
  const afterIncoming = (id: string, time: Date | string) =>
    sales.cohort.has(id) &&
    new Date(time).getTime() >= (cohortStart.get(id) ?? Infinity) &&
    new Date(time) <= at;
  for (const a of actions) {
    const acceptedAt =
      a.email?.result?.status === "accepted"
        ? a.email.result.receipt.acceptedAt
        : a.email?.processingAcceptance?.acceptedAt;
    if (acceptedAt && afterIncoming(a.opportunityId, acceptedAt))
      responded.add(a.opportunityId);
  }
  for (const s of sequences) {
    const time = s.receipt?.acceptedAt ?? s.processingAcceptance?.acceptedAt;
    if (time && afterIncoming(s.opportunityId, time))
      responded.add(s.opportunityId);
  }
  for (const r of manual)
    if (afterIncoming(r.opportunityId, r.occurredAt))
      responded.add(r.opportunityId);
  for (const r of sales.nativeManuals)
    if (r.occurredAt && afterIncoming(r.opportunityId, r.occurredAt))
      responded.add(r.opportunityId);
  for (const r of meta)
    if (r.data.kind === "result" && r.data.result.status === "accepted") {
      const actionId = r.data.actionId;
      const action = actions.find((a) => a.id === actionId);
      const intent = meta.find(
        (row) =>
          row.data.kind === "intent" && row.data.intent.actionId === actionId,
      )?.data;
      if (
        action &&
        intent?.kind === "intent" &&
        afterIncoming(action.opportunityId, intent.intent.reservedAt) &&
        r.at <= at
      )
        responded.add(action.opportunityId);
    }
  metric(
    "response_coverage",
    "Recorded response submission coverage",
    "communication",
    responded.size,
    sales.cohort.size,
    "Direct-engagement cohort Opportunities with a later native accepted submission or supported manual reply / the SAME cohort. Meta requires its original reservation after engagement: a delayed reconciliation cannot move an earlier submission into this cohort. Reservations before engagement with uncertain actual submission timing are conservatively excluded. Acceptance or manual observation does not establish delivery or a sale. User-marked sent and outgoing echo are excluded.",
    "Incoming engagement cohort, responses through report generation",
    "Opportunities",
  );
  const suppressions = await tx
    .select({
      id: emailSuppression.id,
      recipient: emailSuppression.recipient,
      at: emailSuppression.at,
      source: emailSuppression.source,
      suppression: emailSuppression.suppression,
    })
    .from(emailSuppression)
    .where(eq(emailSuppression.businessId, businessId));
  metric(
    "opt_out_messages",
    "Captured email opt-out messages",
    "communication",
    suppressions.filter(
      (s) =>
        s.source === "incoming_opt_out" && inWindow(s.suppression.effectiveAt),
    ).length,
    null,
    "Deduplicated authoritative incoming email opt-out records, stored in the suppression ledger rather than the inquiry-message ledger. Replayed receipts count once. Ordinary ignored replies are not counted as captured inquiries.",
    "Opt-out occurred/effective time in interval",
    "messages",
  );
  const effective = suppressions.filter(
    (s) => new Date(s.suppression.effectiveAt) <= at,
  );
  metric(
    "email_suppressions",
    "Current recorded email restrictions",
    "communication",
    new Set(
      effective.map((s) =>
        JSON.stringify([
          s.recipient,
          s.suppression.scope,
          s.suppression.opportunityId,
        ]),
      ),
    ).size,
    null,
    "Distinct recipient/scope/Opportunity restrictions effective by report generation; duplicate restriction records do not create new restrictions. Applies only to the recorded scope.",
    "Current retained restriction state; independent of interval",
    "restrictions",
  );
  for (const r of suppressions.filter((r) => inWindow(r.at)))
    items.push({
      id: `suppression:${r.id}`,
      category: "communication",
      entityId: r.id,
      opportunityId: r.suppression.opportunityId,
      channel: "email",
      kind: "suppression",
      state:
        new Date(r.suppression.effectiveAt) <= at ? "effective" : "scheduled",
      at: r.at.toISOString(),
      sourceIds: [r.id],
      version: null,
      link: `${base}/email-eligibility`,
      note: "Recorded scoped restriction; recipient and original evidence remain in the authorized eligibility flow.",
    });
  const health = await tx
    .select()
    .from(senderHealthRecord)
    .where(eq(senderHealthRecord.businessId, businessId))
    .orderBy(asc(senderHealthRecord.position));
  const incidents = health.filter((r) => r.payload.kind === "incident");
  const unresolved = incidents.filter(
    (r) =>
      !health.some(
        (other) =>
          other.payload.kind === "repair" && other.payload.incidentId === r.id,
      ),
  );
  metric(
    "sender_pauses",
    "Senders with unrepaired health incidents",
    "communication",
    new Set(unresolved.map((r) => r.identityId)).size,
    null,
    "Distinct sender identities with an unrepaired retained health incident. Acknowledgement and refresh do not repair an incident; historical incidents are not multiplied by repeated failure evidence.",
    "Current retained health state; independent of interval",
    "senders",
  );
  metric(
    "complaint_incidents",
    "Recorded complaint incidents",
    "communication",
    incidents.filter(
      (r) =>
        r.payload.kind === "incident" &&
        r.payload.failures.includes("complaints") &&
        inWindow(r.payload.observedAt),
    ).length,
    null,
    "Distinct incidents whose authoritative reviewed sample failed the complaint threshold. This is not a count of complaints; overlapping review windows are never summed.",
    "Incident observed time in interval",
    "incidents",
  );
  const healthIds = new Set(health.map((r) => r.identityId));
  let sampleCount = 0;
  for (const identityId of healthIds) {
    const row = health
      .filter(
        (r) =>
          r.identityId === identityId &&
          r.payload.kind === "evidence" &&
          r.payload.evidence,
      )
      .at(-1);
    if (row?.payload.kind !== "evidence" || !row.payload.evidence) continue;
    const evidence = row.payload.evidence;
    const policy = health.find(
      (r) =>
        r.identityId === identityId &&
        r.payload.kind === "policy" &&
        r.payload.version === evidence.policyVersion,
    )?.payload;
    const current =
      policy?.kind === "policy" &&
      at.getTime() - Date.parse(evidence.observedAt) <=
        policy.configuration.freshnessSeconds * 1000;
    sampleCount++;
    metric(
      `complaints_${identityId}`,
      "Complaints in a sender's latest reviewed sample",
      "communication",
      evidence.metrics.complaints.failed,
      evidence.metrics.complaints.total,
      `Latest retained independently attributed review for this sender only. Window ${evidence.windowStart} to ${evidence.windowEnd}; observed ${evidence.observedAt}. This sample is not a period-wide count. Inspect source population and thresholds in Sender health.`,
      "One sender's reviewed source population and window",
      "complaints",
      current ? "recorded" : "stale",
    );
    items.push({
      id: `health-sample:${row.id}`,
      category: "communication",
      entityId: identityId,
      opportunityId: null,
      channel: "email",
      kind: "latest_complaint_sample",
      state: current ? "recorded" : "stale",
      at: new Date(evidence.observedAt).toISOString(),
      sourceIds: [row.id],
      version: evidence.policyVersion,
      link: `${base}/sender-health`,
      note: `Current sample view (independent of interval): ${evidence.metrics.complaints.failed}/${evidence.metrics.complaints.total}; reviewed window ${evidence.windowStart} through ${evidence.windowEnd}. Overlapping samples are not added.`,
    });
  }
  if (!sampleCount)
    metric(
      "complaints",
      "Measured complaint sample",
      "communication",
      null,
      null,
      "No retained labeled sender complaint sample is available. Missing measurement does not mean zero complaints.",
      "Retained reviewed samples",
      "complaints",
      "unavailable",
    );
  for (const r of incidents.filter((r) => inWindow(r.at)))
    items.push({
      id: `health:${r.id}`,
      category: "communication",
      entityId: r.identityId,
      opportunityId: null,
      channel: "email",
      kind: "sender_health_incident",
      state: unresolved.includes(r) ? "unrepaired" : "repaired",
      at: r.at.toISOString(),
      sourceIds: [r.id],
      version: null,
      link: `${base}/sender-health`,
      note: "Scoped sender incident. Reviewed population, sample and repair evidence are separate from message delivery.",
    });
  const periodActions = actions.filter((a) => inWindow(a.createdAt));
  const nativeAccepted = new Set<string>();
  for (const a of periodActions)
    if (a.email?.result?.status === "accepted" || a.email?.processingAcceptance)
      nativeAccepted.add(a.id);
  for (const r of meta)
    if (
      r.data.kind === "result" &&
      r.data.result.status === "accepted" &&
      periodActions.some(
        (a) => a.id === (r.data.kind === "result" ? r.data.actionId : ""),
      )
    )
      nativeAccepted.add(r.data.actionId);
  metric(
    "native_accepted_actions",
    "Native accepted ordinary actions",
    "communication",
    nativeAccepted.size,
    periodActions.length,
    "Action-created cohort with recorded native accepted or processing-accepted submission / same ordinary-action cohort. Does not imply Sent-folder identity, delivery, engagement or sale.",
    "Ordinary action-created cohort; current retained evidence",
    "actions",
  );
  const isMeta = (action: (typeof actions)[number]) =>
    action.whatsappPeer !== null ||
    sales.messages.some(
      (m) =>
        m.message.connectionId === action.connectionId &&
        m.channel === "whatsapp",
    );
  const metaActions = periodActions.filter(isMeta);
  for (const state of ["sent", "delivered", "read", "failed"] as const)
    metric(
      `whatsapp_${state}`,
      `WhatsApp ${state} (current evidence)`,
      "communication",
      metaActions.filter((a) => a.reason === `whatsapp_${state}`).length,
      metaActions.length,
      "Ordinary action-created cohort with this exact current canonical native status / same WhatsApp action cohort. Statuses are mutually exclusive current observations; read and delivered are not buying interest.",
      "WhatsApp action-created cohort; reconciled exact native status",
      "actions",
    );
  for (const state of [
    "pending",
    "committed",
    "dispatched",
    "cancelled",
  ] as const)
    metric(
      `actions_${state}`,
      `Ordinary actions ${state}`,
      "communication",
      periodActions.filter((a) => a.state === state).length,
      periodActions.length,
      "Current workflow state / same ordinary action-created cohort. Dispatched is a workflow result; native acceptance and delivery are shown separately.",
      "Action-created cohort",
      "actions",
    );
  for (const a of periodActions)
    items.push({
      id: `action:${a.id}`,
      category: "communication",
      entityId: a.id,
      opportunityId: a.opportunityId,
      channel: isMeta(a) ? "whatsapp" : "email",
      kind: "outbound_action",
      state: a.state,
      at: a.createdAt.toISOString(),
      sourceIds: [a.id, ...(a.inquiryRunId ? [a.inquiryRunId] : [])],
      version: a.controlVersion,
      link: `${base}/opportunities/${a.opportunityId}`,
      note: "Current workflow state. Inspect native acceptance/delivery, blocking reason and next action on the Opportunity.",
    });
  const seqCohort = sequences.filter((s) => inWindow(s.at));
  metric(
    "sequence_failures",
    "Failed email sequence actions",
    "communication",
    seqCohort.filter((s) => s.state === "failed").length,
    seqCohort.length,
    "Current failed sequence actions / sequence action-created cohort. Unknown acceptance stays separate.",
    "Sequence action-created cohort",
    "actions",
  );
  metric(
    "sequence_unknown",
    "Uncertain email sequence actions",
    "communication",
    seqCohort.filter((s) => s.state === "unknown").length,
    seqCohort.length,
    "Current uncertain sequence actions / sequence action-created cohort. Not evidence that nothing was sent.",
    "Sequence action-created cohort",
    "actions",
  );
  for (const r of sequenceEvents.filter((r) => inWindow(r.at)))
    items.push({
      id: `sequence:${r.id}`,
      category: "communication",
      entityId: r.actionId ?? r.id,
      opportunityId:
        sequences.find((s) => s.id === r.actionId)?.opportunityId ?? null,
      channel: "email",
      kind: r.kind,
      state: "recorded_event",
      at: r.at.toISOString(),
      sourceIds: [r.id, ...(r.actionId ? [r.actionId] : [])],
      version: null,
      link: `${base}/campaigns`,
      note: "Immutable sequence event. Sent/reply observation, provider acceptance and direct buying-interest classification are distinct.",
    });
  const handoffs = await tx
    .select({
      id: emailHandoffEvidence.id,
      handoffId: emailHandoffEvidence.handoffId,
      kind: emailHandoffEvidence.kind,
      at: emailHandoffEvidence.at,
    })
    .from(emailHandoffEvidence)
    .where(eq(emailHandoffEvidence.businessId, businessId));
  for (const kind of [
    "prepared",
    "user_marked_sent",
    "sent_folder_observed",
    "reply_observed",
  ] as const) {
    const rows = handoffs.filter((h) => h.kind === kind && inWindow(h.at));
    metric(
      `email_${kind}`,
      `Email handoffs: ${kind.replaceAll("_", " ")}`,
      "communication",
      new Set(rows.map((r) => r.handoffId)).size,
      null,
      "Distinct prepared-email identities with this recorded evidence event in the interval. Preparation/user marking proves neither native sending nor delivery; reply alone does not prove buying interest.",
      "Handoff evidence recorded time in interval",
      "handoffs",
    );
    for (const r of rows)
      items.push({
        id: `handoff:${r.id}`,
        category: "communication",
        entityId: r.handoffId,
        opportunityId: null,
        channel: "email",
        kind,
        state: "recorded_event",
        at: r.at.toISOString(),
        sourceIds: [r.id, r.handoffId],
        version: null,
        link: `${base}/campaigns`,
        note: "Prepared email evidence; inspect the original source and exact event in Campaigns.",
      });
  }
  const intents = meta.flatMap((r) =>
    r.data.kind === "intent" && inWindow(r.at)
      ? [{ row: r, intent: r.data.intent }]
      : [],
  );
  const receipts = await tx
    .select()
    .from(whatsAppReceipt)
    .where(eq(whatsAppReceipt.businessId, businessId));
  const pricedActions = new Set<string>();
  for (const { intent } of intents) {
    const accepted = meta
      .flatMap((r) =>
        r.data.kind === "result" &&
        r.data.actionId === intent.actionId &&
        r.data.result.status === "accepted"
          ? [r.data.result]
          : [],
      )
      .at(-1);
    if (!accepted) continue;
    const pricing = receipts.some(
      (r) =>
        r.kind === "status" &&
        r.statusEvidence?.supported &&
        r.statusEvidence.pricing &&
        r.connectionId === intent.connectionId &&
        r.connectionVersion === intent.connectionVersion &&
        r.accountKey ===
          `${intent.assets.wabaId}:${intent.assets.phoneNumberId}` &&
        r.peer === intent.peer &&
        r.messageRef === accepted.messageRef &&
        (!r.statusEvidence.callbackData ||
          r.statusEvidence.callbackData === intent.callbackToken) &&
        new Date(r.statusEvidence.occurredAt).getTime() + 999 >=
          Date.parse(intent.reservedAt) &&
        new Date(r.statusEvidence.occurredAt) <= at &&
        r.at >= new Date(intent.reservedAt),
    );
    if (pricing) pricedActions.add(intent.actionId);
  }
  metric(
    "meta_observed_unpriced",
    "Customer-paid Meta usage observed",
    "cost",
    pricedActions.size,
    intents.length,
    "Distinct reserved Meta action cohort with exact authenticated native pricing classification / reserved Meta intents. Classification has no actual monetary charge. Customer pays Meta; excluded from platform allowance money and operator expense.",
    "Meta intent-reserved cohort; retained exact pricing observations",
    "actions",
  );
  metric(
    "meta_actual_charge",
    "Actual customer Meta charge",
    "cost",
    null,
    null,
    "No actual customer Meta statement charge is recorded by this workflow. Observed usage and optional estimates never establish an actual charge or zero/free usage. Verify the customer's Meta bill.",
    "Customer-paid Meta billing, separate from platform",
    "money",
    "unavailable",
  );
  for (const { row, intent } of intents)
    items.push({
      id: `meta-usage:${row.id}`,
      category: "communication",
      entityId: intent.actionId,
      opportunityId: intent.opportunityId,
      channel: "whatsapp",
      kind: "customer_paid_meta_usage",
      state: pricedActions.has(intent.actionId)
        ? "observed_unpriced"
        : "unpriced",
      at: row.at.toISOString(),
      sourceIds: [row.id, intent.actionId],
      version: intent.connectionVersion,
      link: `${base}/opportunities/${intent.opportunityId}`,
      note: "Customer-paid Meta usage. The private callback capability, recipient, account assets and payload are excluded from this report.",
    });
}
