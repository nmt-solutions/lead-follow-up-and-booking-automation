import { z } from "zod";

export const operationSourceSchema = z.enum([
  "discovery",
  "queue",
  "mailbox",
  "mailbox_scope",
  "sequence",
  "sequence_action",
  "sequence_history",
  "approval",
  "inquiry",
  "action",
  "ownership",
  "appointment",
  "appointment_history",
  "sender_health",
  "whatsapp",
  "whatsapp_intake",
  "whatsapp_action_history",
  "channel_observation",
  "payment",
  "payment_history",
  "document",
  "authority",
]);
export type OperationSource = z.infer<typeof operationSourceSchema>;
// Only selected identifiers, versions and counters enter the monitoring projection.
const id = z.uuid().nullable().optional(),
  count = z.number().nullable().optional(),
  code = z.string().max(256).nullable().optional(),
  flag = z.boolean().nullable().optional();
export const operationContextSchema = z.strictObject({
  mailboxId: id,
  policyVersion: count,
  mode: code,
  checkpoint: count,
  captured: count,
  considered: count,
  retryAt: code,
  readRequested: flag,
  sendRequested: flag,
  sendPermission: code,
  completeReplyCapture: flag,
  lastSyncedAt: code,
  approvedBudget: count,
  used: count,
  completedSteps: count,
  attempt: count,
  scheduleId: id,
  scheduleRevision: count,
  configurationVersion: count,
  policyHash: code,
  briefHash: code,
  policyId: id,
  bookingStatus: code,
  appointmentId: id,
  source: code,
  sequence: count,
  provider: code,
  connectionId: id,
  authorityVersion: count,
  contextKey: code,
  inquiryRunId: id,
  planId: id,
  controlVersion: count,
  associationVersion: count,
  acceptance: code,
  processingAcceptance: code,
  sentObserved: flag,
  senderIdentityId: id,
  senderVersion: count,
  senderEvidenceId: id,
  revisionId: id,
  approvalHash: code,
  version: count,
  runId: id,
  stepIndex: count,
  queueState: code,
  processingAccepted: flag,
  attemptId: id,
  role: code,
  knowledgeVersion: count,
  profileId: id,
  activationVersion: count,
  identityId: id,
  incidentId: id,
  evidenceId: id,
  connectionVersion: count,
  permission: code,
  ownership: code,
  inboxConnectionId: id,
  inboundAt: code,
  echoAt: code,
  quoteId: id,
  reconciliationPending: flag,
  reviewPending: flag,
  actionId: id,
  paymentState: code,
  kind: code,
  periodId: id,
  originalId: id,
  issuerId: id,
  issuerVersion: count,
  attempts: count,
  approved: flag,
  permissionId: id,
  processingState: code,
  nativeStatus: code,
  receiptEvidence: code,
  nativeEvidence: code,
  notificationId: id,
  notificationAudience: z.enum(["business", "operator"]).optional(),
  recoveryAuthority: z.enum(["sales.work", "operations.manage"]).optional(),
  recoveryRole: z
    .enum(["owner", "admin", "salesperson", "operations"])
    .optional(),
  recoveryMfaAt: z.iso.datetime().nullable().optional(),
});
export const operationSnapshotSchema = z.object({
  source: operationSourceSchema,
  targetId: z.uuid(),
  businessId: z.uuid(),
  status: z.string(),
  reason: z.string().nullable(),
  responsibleUserId: z.string().nullable(),
  opportunityId: z.uuid().nullable(),
  context: operationContextSchema,
  sourceAt: z.string().nullable(),
});
export type OperationSnapshot = z.infer<typeof operationSnapshotSchema>;
export const operationEventSchema = operationSnapshotSchema.extend({
  id: z.uuid(),
  position: z.number(),
  actorId: z.string().nullable(),
  action: z.string(),
  outcome: z.string(),
  requestKey: z.uuid().nullable(),
  at: z.string(),
});
export type OperationEvent = z.infer<typeof operationEventSchema>;
export const recoverySchema = z.strictObject({
  source: operationSourceSchema,
  targetId: z.uuid(),
  action: z.enum(["retry", "reconcile", "escalate"]),
  requestKey: z.uuid(),
});
export type RecoveryCommand = z.infer<typeof recoverySchema>;
export const recoveryResultSchema = z.object({
  outcome: z.enum([
    "queued",
    "checked",
    "escalated",
    "unavailable",
    "blocked",
    "reconciliation_required",
  ]),
});
export type RecoveryResult = z.infer<typeof recoveryResultSchema>;
export const operationQuerySchema = z.strictObject({
  before: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type OperationQuery = z.infer<typeof operationQuerySchema>;
export const diagnosticRetentionSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  diagnosticSeconds: z.number().int().positive().max(2147483647),
  auditDetailSeconds: z.number().int().positive().max(2147483647),
  evidenceRef: z.uuid(),
  confirmPolicy: z.literal(true),
});
export type DiagnosticRetention = z.infer<typeof diagnosticRetentionSchema>;
export const operationWorkspaceSchema = z.object({
  operator: z.boolean(),
  resources: z.array(
    operationSnapshotSchema.extend({
      id: z.uuid(),
      observedAt: z.string(),
      nextAction: z.string(),
      href: z.string(),
      handoff: z
        .object({ reason: z.string(), nextAction: z.string() })
        .nullable(),
      controls: z.array(z.enum(["retry", "reconcile", "escalate"])),
    }),
  ),
  history: z.array(operationEventSchema),
  nextHistoryBefore: z.number().nullable(),
  notifications: z.array(
    z.object({
      id: z.uuid(),
      businessId: z.uuid(),
      source: operationSourceSchema,
      targetId: z.uuid(),
      responsibleUserId: z.string().nullable(),
      audience: z.enum(["business", "operator"]),
      delivery: z.enum(["available_in_app", "acknowledged_in_app"]),
      resolved: z.boolean(),
      nextAction: z.string(),
    }),
  ),
  retention: z
    .object({
      version: z.number(),
      diagnosticSeconds: z.number(),
      auditDetailSeconds: z.number(),
      evidenceRef: z.uuid(),
    })
    .nullable(),
  unavailable: z.array(z.string()),
  providerLogs: z.array(z.object({ label: z.string(), url: z.url() })),
});
export type OperationWorkspace = z.infer<typeof operationWorkspaceSchema>;
export type OperationNotification = OperationWorkspace["notifications"][number];

export function operationLink(row: OperationSnapshot, operator: boolean) {
  const root = `/businesses/${row.businessId}`;
  if (row.source === "discovery" || row.source === "queue")
    return `${root}/discovery`;
  if (row.source === "mailbox" || row.source === "mailbox_scope")
    return `${root}/mailboxes`;
  if (row.source.startsWith("sequence") || row.source === "approval")
    return `${root}/campaigns`;
  if (row.source === "sender_health")
    return operator
      ? `/platform/sender-health/${row.businessId}`
      : `${root}/sender-health`;
  if (row.source.startsWith("whatsapp") || row.source === "channel_observation")
    return `${root}/whatsapp`;
  if (row.source.startsWith("payment"))
    return operator
      ? "/platform/subscription-payments"
      : `${root}/subscription-payments`;
  if (row.source === "document")
    return operator ? "/platform/seller-documents" : `${root}/seller-documents`;
  if (row.opportunityId) return `${root}/opportunities/${row.opportunityId}`;
  return root;
}
export function recoveryControls(
  row: OperationSnapshot,
  operator: boolean,
): RecoveryCommand["action"][] {
  if (operator)
    return row.source === "mailbox" && row.status !== "completed"
      ? ["retry", "escalate"]
      : [
            "payment",
            "document",
            "sequence",
            "sequence_action",
            "queue",
          ].includes(row.source)
        ? ["reconcile", "escalate"]
        : ["escalate"];
  if (row.source === "queue") return ["reconcile", "escalate"];
  if (row.source === "mailbox" && row.status !== "completed")
    return ["retry", "escalate"];
  if (row.source === "discovery" && row.status === "stopped")
    return ["retry", "escalate"];
  if (
    [
      "sequence",
      "sequence_action",
      "action",
      "appointment",
      "document",
      "payment",
    ].includes(row.source)
  )
    return ["reconcile", "escalate"];
  return ["escalate"];
}
export function responsibleNextAction(row: OperationSnapshot) {
  if (row.source === "sender_health")
    return "The sender-health operator must review current evidence and the selected incident. Acknowledgement or reconnecting does not repair health.";
  if (row.source === "mailbox_scope")
    return "The Business integration manager reviews the selected mailbox scope, independent read/send grants and current reply visibility. A recorded configuration does not authorize new sending or wider history.";
  if (row.source === "channel_observation")
    return "Review the signed native observation and its exact application association in WhatsApp. An unassociated status does not establish an application send or delivery.";
  if (row.source === "ownership")
    return "The assigned person reviews the handoff and explicitly returns control in the Opportunity when appropriate.";
  if (row.source === "appointment")
    return "Reconcile the exact saved calendar intent. Unresolved bookings require authoritative evidence before any new booking.";
  if (row.source === "action" || row.source.startsWith("sequence"))
    return "Reconcile exact native acceptance evidence. Current permission, ownership, authority and reserved allowance still apply; unresolved sends cannot be replayed.";
  if (row.source === "payment")
    return "A reconciliation operator reviews authoritative gateway evidence. Uncertain creation cannot be repeated and pending evidence cannot grant access.";
  if (row.source === "document")
    return "Recover the existing protected artifact using its exact committed identity; retain the original financial history.";
  if (row.source === "mailbox")
    return "The current integration manager restores legitimate connection access and queues the existing selected scope and checkpoint.";
  if (row.source === "discovery")
    return "The current Business manager reviews remaining budget and configuration before explicitly resuming unfinished work.";
  return "Review the attributed source and current domain policy with the responsible person.";
}
