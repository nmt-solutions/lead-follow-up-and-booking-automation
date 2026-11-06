import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import {
  recoverySchema,
  recoveryResultSchema,
  type RecoveryResult,
  recoveryControls,
  responsibleNextAction,
  operationLink,
  diagnosticRetentionSchema,
  operationQuerySchema,
  type OperationWorkspace,
} from "../models/operations";
import type { createOperationsRepository } from "../db/operations-repository";
import type { createMailboxApplication } from "./mailboxes";
import type { createDiscoveryApplication } from "./discovery";
import type { createAppointmentApplication } from "./appointments";
import type { createInquiryApplication } from "./inquiries";
import type { createWhatsAppSendingApplication } from "./whatsapp-sending";
import type { createEmailSequenceApplication } from "./email-sequences";
import type { createSubscriptionPaymentApplication } from "./subscription-payments";
import type { createSellerDocumentApplication } from "./seller-documents";

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
function needsAttention(row: { status: string; reason: string | null }) {
  return (
    [
      "blocked",
      "failed",
      "ambiguous",
      "handoff",
      "incident",
      "review",
    ].includes(row.status) ||
    Boolean(
      row.reason &&
      ![
        "completed",
        "provider_accepted",
        "ready",
        "connected",
        "booked",
      ].includes(row.reason),
    )
  );
}
export function createOperationsApplication<C>(d: {
  authenticate(credentials: C): Promise<WorkIdentity>;
  repository: ReturnType<typeof createOperationsRepository>;
  logs?: { links: { label: string; url: string }[]; unavailable: string[] };
  commands: {
    mailbox?: Pick<
      ReturnType<typeof createMailboxApplication<C>>,
      "recoverConnection" | "recoverExisting"
    >;
    discovery?: Pick<
      ReturnType<typeof createDiscoveryApplication<C>>,
      "resume" | "recoverDispatches"
    >;
    appointments?: Pick<
      ReturnType<typeof createAppointmentApplication<C>>,
      "reconcile"
    >;
    inquiries?: Pick<
      ReturnType<typeof createInquiryApplication<C>>,
      "reconcile"
    >;
    whatsapp?: Pick<
      ReturnType<typeof createWhatsAppSendingApplication<C>>,
      "reconcile" | "workspace"
    >;
    sequences?: Pick<
      ReturnType<typeof createEmailSequenceApplication<C>>,
      "workspace" | "command" | "recoverDue"
    >;
    payments?: Pick<
      ReturnType<typeof createSubscriptionPaymentApplication<C>>,
      "refresh" | "operatorRefresh"
    >;
    documents?: Pick<
      ReturnType<typeof createSellerDocumentApplication<C>>,
      "recover"
    >;
  };
}) {
  const app = {
    maintainRetention: () => d.repository.maintainRetention(),
    async acknowledge(
      credentials: C,
      id: unknown,
      input: unknown,
      operator = false,
    ) {
      const value = parse(
        z.strictObject({ eventId: z.uuid(), requestKey: z.uuid() }),
        input,
      );
      await d.repository.acknowledge(
        await d.authenticate(credentials),
        parse(z.uuid(), id),
        value.eventId,
        value.requestKey,
        operator,
      );
      return { outcome: "acknowledged_in_app" };
    },
    async saveRetention(credentials: C, input: unknown) {
      await d.repository.saveRetention(
        await d.authenticate(credentials),
        parse(diagnosticRetentionSchema, input),
      );
      return d.repository.retention(await d.authenticate(credentials));
    },
    async diagnostics(credentials: C) {
      return d.repository.diagnostics(await d.authenticate(credentials));
    },
    async prune(credentials: C) {
      return d.repository.prune(await d.authenticate(credentials));
    },
    async workspace(
      credentials: C,
      id: unknown,
      operator = false,
      input: unknown = {},
    ): Promise<OperationWorkspace> {
      const actor = await d.authenticate(credentials),
        businessId = operator && id === null ? "" : parse(z.uuid(), id);
      const records = await d.repository.read(
        actor,
        businessId,
        operator,
        parse(operationQuerySchema, input),
      );
      const events = records.history;
      let nativeActions: { id: string; evidence: string }[] = [];
      const nativeUnavailable: string[] = [];
      if (!operator && d.commands.whatsapp) {
        try {
          nativeActions = (
            await d.commands.whatsapp.workspace(credentials, businessId)
          ).actions;
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError)) throw error;
          nativeUnavailable.push(
            "Current native message evidence is unavailable with this actor’s channel access or setup. Review the source with its authorized Business actor.",
          );
        }
      }
      const resources = records.latest.map((e) => {
        const ownership = records.latest.find(
          (r) => r.source === "ownership" && r.targetId === e.opportunityId,
        );
        const handoff = records.handoffs.find((r) => r.id === e.opportunityId);
        const native = nativeActions.find(
          (a) => e.source === "action" && a.id === e.targetId,
        );
        return {
          ...e,
          context: native
            ? { ...e.context, nativeEvidence: native.evidence }
            : e.context,
          id: e.targetId,
          responsibleUserId:
            ownership?.responsibleUserId ?? e.responsibleUserId,
          observedAt: e.at,
          nextAction: handoff?.nextAction || responsibleNextAction(e),
          handoff: handoff
            ? { reason: handoff.reason, nextAction: handoff.nextAction }
            : null,
          href: operationLink(e, operator),
          controls: recoveryControls(e, operator),
        };
      });
      const audience = operator ? ("operator" as const) : ("business" as const);
      const acknowledged = new Set(
        records.acknowledgements
          .filter((e) => e.context.notificationAudience === audience)
          .map((e) => e.context.notificationId),
      );
      const notifications = records.alerts
        .filter((e) => e.outcome === "escalated" || needsAttention(e))
        .map((e) => ({
          id: e.id,
          businessId: e.businessId,
          source: e.source,
          targetId: e.targetId,
          responsibleUserId:
            resources.find((r) => r.source === e.source && r.id === e.targetId)
              ?.responsibleUserId ?? e.responsibleUserId,
          audience,
          delivery: acknowledged.has(e.id)
            ? ("acknowledged_in_app" as const)
            : ("available_in_app" as const),
          resolved:
            e.outcome === "escalated"
              ? acknowledged.has(e.id)
              : e.source === "sender_health"
                ? resources.some(
                    (r) =>
                      r.source === "sender_health" &&
                      r.status === "repair" &&
                      r.context.incidentId ===
                        (e.context.incidentId ?? e.targetId),
                  )
                : !resources.some(
                    (r) =>
                      r.source === e.source &&
                      r.id === e.targetId &&
                      needsAttention(r),
                  ),
          nextAction: responsibleNextAction(e),
        }));
      const retention = operator ? await d.repository.retention(actor) : null;
      return {
        operator,
        resources,
        history: events,
        nextHistoryBefore: records.nextHistoryBefore,
        notifications,
        retention,
        unavailable: [
          ...nativeUnavailable,
          ...(operator
            ? [
                "Operator monitoring does not impersonate Business actors to read private message evidence. The responsible Business actor reconciles native sends and bookings.",
              ]
            : []),
          "Provider-native telemetry is available only through the configured provider account; private provider payloads are not collected.",
          "Alerts show the most recent 200 observations. Use paged history for earlier records.",
          ...(!retention
            ? [
                "Detailed diagnostics require an explicit operator-approved retention policy. Immutable domain and recovery identity history follows its protected domain policy.",
              ]
            : []),
          ...(operator ? (d.logs?.unavailable ?? []) : []),
        ],
        providerLogs: operator ? (d.logs?.links ?? []) : [],
      };
    },
    async recover(
      credentials: C,
      id: unknown,
      input: unknown,
      operator = false,
    ): Promise<RecoveryResult> {
      const actor = await d.authenticate(credentials),
        businessId = parse(z.uuid(), id),
        command = parse(recoverySchema, input);
      const start = await d.repository.begin(
        actor,
        businessId,
        command,
        operator,
      );
      if (start.replay)
        return parse(recoveryResultSchema, {
          outcome:
            start.event.outcome === "requested"
              ? "reconciliation_required"
              : start.event.outcome,
        });
      if (command.action === "escalate") {
        await d.repository.finish(
          actor,
          businessId,
          command,
          operator,
          "escalated",
        );
        return { outcome: "escalated" };
      }
      const controls = recoveryControls(start.event, operator);
      if (!controls.includes(command.action)) {
        await d.repository.finish(
          actor,
          businessId,
          command,
          operator,
          "blocked",
        );
        throw new ApplicationError("FORBIDDEN");
      }
      try {
        let outcome: "queued" | "checked" | "unavailable" = "unavailable";
        if (command.source === "mailbox" && !operator && d.commands.mailbox) {
          outcome = (
            await d.commands.mailbox.recoverConnection(
              credentials,
              businessId,
              parse(z.uuid(), start.event.context.mailboxId),
              { mode: start.event.context.mode },
            )
          ).outcome;
        }
        if (command.source === "mailbox" && operator && d.commands.mailbox) {
          const work = await d.repository.mailboxWork(
            actor,
            businessId,
            command.targetId,
          );
          outcome = (await d.commands.mailbox.recoverExisting(work)).outcome;
        }
        if (
          command.source === "discovery" &&
          !operator &&
          d.commands.discovery
        ) {
          await d.commands.discovery.resume(credentials, businessId, {
            runId: command.targetId,
            requestKey: command.requestKey,
            expectedAttempt: parse(
              z.number().int().nonnegative(),
              start.event.context.attempt,
            ),
            confirmResume: true,
          });
          outcome = "queued";
        }
        if (command.source === "queue" && d.commands.discovery) {
          const result = await d.commands.discovery.recoverDispatches({
            businessId,
            dispatchId: command.targetId,
          });
          if (result.failed) throw new ApplicationError("PROVIDER_UNAVAILABLE");
          outcome = "checked";
        }
        if (
          ["sequence", "sequence_action"].includes(command.source) &&
          d.commands.sequences
        ) {
          const runId =
            command.source === "sequence"
              ? command.targetId
              : parse(z.uuid(), start.event.context.runId);
          if (operator)
            await d.commands.sequences.recoverDue({ businessId, runId });
          else {
            const state = await d.commands.sequences.workspace(
                credentials,
                businessId,
              ),
              run = state.runs.find((r) => r.id === runId);
            if (!run) throw new ApplicationError("NOT_FOUND");
            await d.commands.sequences.command(credentials, businessId, {
              runId,
              expectedVersion: run.version,
              command: "recover",
              note: "Evidence reconciliation requested from action history.",
            });
          }
          outcome = "checked";
        }
        if (
          command.source === "appointment" &&
          !operator &&
          d.commands.appointments
        ) {
          await d.commands.appointments.reconcile(
            credentials,
            businessId,
            parse(z.uuid(), start.event.opportunityId),
            { appointmentId: command.targetId },
          );
          outcome = "checked";
        }
        if (
          command.source === "action" &&
          !operator &&
          d.commands.inquiries &&
          start.event.context.inquiryRunId
        ) {
          await d.commands.inquiries.reconcile(
            credentials,
            businessId,
            parse(z.uuid(), start.event.opportunityId),
            parse(z.uuid(), start.event.context.inquiryRunId),
          );
          outcome = "checked";
        } else if (
          command.source === "action" &&
          !operator &&
          d.commands.whatsapp
        ) {
          await d.commands.whatsapp.reconcile(credentials, businessId, {
            actionId: command.targetId,
          });
          outcome = "checked";
        }
        if (command.source === "payment" && d.commands.payments) {
          if (operator)
            await d.commands.payments.operatorRefresh(credentials, businessId, {
              actionId: command.targetId,
            });
          else
            await d.commands.payments.refresh(credentials, businessId, {
              actionId: command.targetId,
            });
          outcome = "checked";
        }
        if (command.source === "document" && d.commands.documents) {
          await d.commands.documents.recover(
            credentials,
            businessId,
            { documentId: command.targetId },
            operator,
          );
          outcome = "checked";
        }
        await d.repository.finish(
          actor,
          businessId,
          command,
          operator,
          outcome,
        );
        return { outcome };
      } catch (error: unknown) {
        await d.repository.finish(
          actor,
          businessId,
          command,
          operator,
          "blocked",
        );
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
    },
  };
  return app;
}
