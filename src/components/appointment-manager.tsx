"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  appointmentWorkspaceSchema,
  availabilityViewSchema,
  bookingConfigurationSchema,
  calendarBindingSchema,
  type AppointmentWorkspace,
  type AppointmentView,
  type CandidateSlot,
} from "@/models/appointments";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Textarea } from "./ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const reasons: Record<string, string> = {
  qualification_review_required:
    "Complete and review the current inquiry qualification before automated booking. The assigned owner can review the missing information and act manually when appropriate.",
  event_identity_already_used:
    "This calendar identity is already retained by another appointment. The assigned owner must investigate the provider records before proceeding.",
  calendar_setup_required:
    "An Admin must connect a supported calendar with separate calendar permissions and configure booking hours. Google Calendar setup is available from the Business profile. RFQs remain available.",
  calendar_rate_limited:
    "Google is limiting calendar requests. Wait before checking or reconciling again; do not repeat event creation.",
  calendar_revoked:
    "Google authorization was revoked or expired. Ask an Admin to reconnect, then reconcile any unresolved event.",
  calendar_insufficient:
    "Calendar permission is insufficient. Ask an Admin to restore the selected calendar grant, then reconcile unresolved bookings.",
  calendar_conflict:
    "Google reported an event identity or revision conflict. Reconcile the original request before any further action.",
  calendar_invalid_response:
    "Google returned an unverified result. Review the connection and reconcile; do not repeat creation.",
  calendar_unavailable:
    "Google is unavailable. Restore access and reconcile any uncertain result before booking again.",
  configure_booking_hours:
    "Ask an Admin to configure working hours, duration, buffers and hold expiry.",
  calendar_permission_required:
    "Ask an Admin to restore read and write permission for the selected calendar, then refresh availability.",
  calendar_capability_changed:
    "The calendar account capabilities changed. Ask an Admin to review and save the calendar selection again.",
  provider_unavailable:
    "The calendar could not be checked. Review setup and try a fresh availability check when service returns.",
  slot_held_or_booked:
    "This time overlaps an active hold or appointment. Choose another slot.",
  slot_no_longer_available:
    "The calendar changed and this slot is busy. Check availability and choose another slot.",
  hold_expired:
    "The hold expired. Check availability and request a fresh hold.",
  booking_policy_changed:
    "Booking settings changed. Review the new settings and request a fresh hold.",
  opportunity_context_changed:
    "The Opportunity, its ownership or approved policy changed. Review the current context and request a fresh hold.",
  automation_not_authorized:
    "Automation is not currently authorized. The assigned owner can review and act manually.",
  ownership_changed:
    "The assigned owner changed. The current owner must review this request.",
  creation_unconfirmed:
    "Booking was committed locally; the calendar result is not yet established. Reconcile before any new booking.",
  creation_result_unknown:
    "The calendar may have accepted the booking. Reconcile it; do not create a replacement.",
  invalid_or_mismatched_event:
    "The calendar result could not be validated for this request. Reconcile with the selected calendar.",
  reconciliation_unavailable:
    "The calendar could not be reconciled. Restore access and reconcile again; do not repeat booking.",
  invalid_reconciliation_result:
    "Reconciliation could not establish an authoritative result. The assigned owner must review the calendar.",
  external_calendar_conflict:
    "An external calendar edit or overlapping event needs review. Inspect the original event, resolve the conflict, then reconcile.",
  authoritative_event_missing:
    "The retained event is missing from the calendar. Review it and record explicit cancellation evidence only if established.",
  authoritative_no_event:
    "The calendar authoritatively found no accepted event. Review history, then request a fresh slot if still needed.",
  cancellation_requested:
    "Cancellation was requested. The original appointment remains reserved until cancellation is confirmed.",
  cancellation_result_unknown:
    "Cancellation is uncertain. Reconcile with the calendar; the original reservation may still be active.",
  invalid_cancellation_result:
    "The cancellation response could not be validated. Reconcile before taking further action.",
  cancellation_context_changed:
    "Opportunity or policy changed before cancellation. Review the current context before requesting cancellation again.",
  business_evidence:
    "An authorized Business owner or Admin recorded explicit evidence. See the retained reference and note.",
};
const reasonText = (reason: string) =>
  reasons[reason] ??
  "Review the appointment history and next action with the assigned owner.";
const errorSchema = z.object({
  success: z.literal(false),
  code: z.string(),
  requestId: z.string().optional(),
});
type Command =
  "request" | "book" | "reconcile" | "cancel" | "evidence" | "configuration";
type Send = (command: Command, input: unknown) => Promise<boolean>;
class AppointmentClientError extends Error {}

function zoned(at: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(at));
}
export function AppointmentManager({
  businessId,
  opportunityId,
  initialState,
}: {
  businessId: string;
  opportunityId: string;
  initialState: AppointmentWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [zone, setZone] = useState("");
  const [slots, setSlots] = useState<{
    version: number;
    zone: string;
    values: CandidateSlot[];
  } | null>(null);
  const requestIdentity = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const base = `/api/businesses/${businessId}/opportunities/${opportunityId}/appointments`;
  async function post(command: string, input: unknown) {
    const response = await fetch(
      `${base}${command === "request" ? "" : `/${command}`}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    const raw: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(raw);
      const code = parsed.success ? parsed.data.code : "";
      setRecovery(
        code === "MFA_REQUIRED"
          ? "/security"
          : code === "UNAUTHENTICATED"
            ? "/sign-in"
            : null,
      );
      const messages: Record<string, string> = {
        MFA_REQUIRED:
          "Verify your authenticator in Security. Your form is preserved.",
        UNAUTHENTICATED: "Sign in again. Your form is preserved.",
        INVALID_INPUT: "Check the fields, time zone and timing values.",
        FORBIDDEN:
          "Only an authorized assigned owner can act; an Owner or Admin manages settings and outcome evidence.",
        CONFLICT:
          "State changed. Refresh the records and review before proceeding.",
        CALENDAR_SETUP_REQUIRED: reasons.calendar_setup_required,
      };
      throw new AppointmentClientError(
        `${messages[code] ?? "The result could not be established. Refresh records and reconcile before repeating any external action."}${parsed.success && parsed.data.requestId ? ` Reference: ${parsed.data.requestId}` : ""}`,
      );
    }
    return raw;
  }
  const send: Send = async (command, input) => {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const parsed = z
        .object({ success: z.literal(true), data: appointmentWorkspaceSchema })
        .safeParse(await post(command, input));
      if (!parsed.success)
        throw new AppointmentClientError(
          "The response could not be validated. Refresh records and reconcile before retrying.",
        );
      setState(parsed.data.data);
      setSlots(null);
      setNotice(
        "Records updated. Review the appointment state and next action below.",
      );
      return true;
    } catch (e: unknown) {
      setError(
        e instanceof AppointmentClientError && e.message
          ? e.message
          : "Connection interrupted. Refresh records and reconcile before retrying.",
      );
      return false;
    } finally {
      setPending(false);
    }
  };
  async function refresh() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(base, { cache: "no-store" });
      const parsed = z
        .object({ success: z.literal(true), data: appointmentWorkspaceSchema })
        .safeParse(await response.json());
      if (!response.ok || !parsed.success)
        throw new AppointmentClientError(
          "Refresh failed. Sign in or verify Security if needed, then refresh again.",
        );
      setState(parsed.data.data);
      setSlots(null);
      setNotice("Records refreshed.");
    } catch {
      setError(
        "Records could not be refreshed. Sign in or verify Security if needed; preserve this form and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function findSlots(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    setSlots(null);
    try {
      const parsed = z
        .object({ success: z.literal(true), data: availabilityViewSchema })
        .safeParse(await post("availability", { day, customerTimeZone: zone }));
      if (!parsed.success)
        throw new AppointmentClientError(
          "The availability response could not be validated. Check again.",
        );
      if (parsed.data.data.reason) {
        setError(reasonText(parsed.data.data.reason));
        return;
      }
      setSlots({
        version: parsed.data.data.version,
        zone,
        values: parsed.data.data.slots,
      });
      setNotice(
        parsed.data.data.slots.length
          ? "Choose a slot to request a local hold. Booking checks the calendar again."
          : "No slots are available on this customer local day. Choose another day or review working hours.",
      );
    } catch (e: unknown) {
      setError(
        e instanceof AppointmentClientError
          ? e.message
          : "Availability could not be checked. Check the connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function hold(slot: CandidateSlot) {
    if (!slots) return;
    const input = {
      expectedVersion: slots.version,
      mode: "manual",
      customerTimeZone: slots.zone,
      localStart: slot.localStart,
      utcOffset: slot.utcOffset,
    };
    const fingerprint = JSON.stringify(input);
    if (requestIdentity.current?.fingerprint !== fingerprint)
      requestIdentity.current = { fingerprint, key: crypto.randomUUID() };
    if (
      await send("request", {
        ...input,
        requestKey: requestIdentity.current.key,
      })
    )
      requestIdentity.current = null;
  }
  return (
    <div className="space-y-8 wrap-anywhere" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          Assigned owner: {state.ownerId ?? "Unassigned"} ·{" "}
          {state.controlState === "human"
            ? "Human handling"
            : "Automation handling"}
        </p>
        <Button variant="outline" onClick={refresh} disabled={pending}>
          {pending ? "Working…" : "Refresh records"}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          {error}{" "}
          {recovery && (
            <Link
              className="underline"
              href={recovery}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {recovery === "/security" ? "Security" : "sign-in"} (new tab)
            </Link>
          )}
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {state.setupReason && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Badge className="text-warning">Calendar setup needed</Badge>
            <p>{reasonText(state.setupReason)}</p>
            <p className="text-sm text-muted-foreground">
              Mailbox permission does not authorize a calendar. No customer
              invitations or notifications are sent by this workflow.
            </p>
          </CardContent>
        </Card>
      )}
      {!state.canAct && (
        <p className="text-muted-foreground">
          The current assigned Opportunity owner checks availability and
          requests, books, cancels or reconciles appointments. Use Opportunity
          controls in the inbox to assign ownership.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Find an appointment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {state.policy && (
            <p className="text-sm text-muted-foreground">
              Business zone: {state.policy.configuration.timeZone} · Duration:{" "}
              {state.policy.configuration.durationMinutes} minutes · Buffers:{" "}
              {state.policy.configuration.bufferBeforeMinutes} before /{" "}
              {state.policy.configuration.bufferAfterMinutes} after · Hold:{" "}
              {state.policy.configuration.holdSeconds} seconds.
            </p>
          )}
          <form onSubmit={findSlots} className="space-y-4">
            <fieldset
              disabled={pending || !state.canAct || !!state.setupReason}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="appointment-zone">Customer time zone</Label>
                  <Input
                    id="appointment-zone"
                    required
                    value={zone}
                    onChange={(e) => {
                      setZone(e.target.value);
                      setSlots(null);
                    }}
                    placeholder="Europe/London"
                    maxLength={100}
                    autoComplete="off"
                  />
                  <p className="text-sm text-muted-foreground">
                    Confirm the customer&apos;s IANA zone, for example
                    Asia/Kolkata. All slot dates below use this zone.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="appointment-day">Customer local date</Label>
                  <Input
                    id="appointment-day"
                    type="date"
                    required
                    value={day}
                    onChange={(e) => {
                      setDay(e.target.value);
                      setSlots(null);
                    }}
                  />
                </div>
              </div>
              <Button type="submit">Check available slots</Button>
            </fieldset>
          </form>
          <p className="text-sm text-muted-foreground">
            Holds protect overlapping requests inside this Business. External
            calendar editors can still race with booking; the calendar is
            checked immediately before creation and reconciled afterwards.
            Ambiguous or nonexistent Business wall times are not offered.
          </p>
          {slots && (
            <ul className="space-y-3">
              {slots.values.map((slot) => (
                <li
                  key={slot.startsAt}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p>
                      {slot.localStart.replace("T", " ")} ({slot.utcOffset}) ·{" "}
                      {slots.zone}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Until {zoned(slot.endsAt, slots.zone)} · Business:{" "}
                      {state.policy &&
                        zoned(
                          slot.startsAt,
                          state.policy.configuration.timeZone,
                        )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => hold(slot)}
                  >
                    Request hold
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <section aria-labelledby="appointment-records" className="space-y-4">
        <h2 id="appointment-records" className="text-xl font-semibold">
          Appointment records
        </h2>
        <p className="text-sm text-muted-foreground">
          Requested, confirmed, attended and cancelled appointments are separate
          from quotation requests, quotes and sales.
        </p>
        {state.appointments.length === 0 && (
          <p>
            No appointment requested yet. Configure the calendar and check
            available slots when an appointment is needed.
          </p>
        )}
        {state.appointments.map((p) => (
          <AppointmentRecord
            key={p.id}
            appointment={p}
            pending={pending}
            canAct={state.canAct}
            canAttest={state.canAct && state.canManage}
            send={send}
          />
        ))}
      </section>
      <BookingSettings
        key={state.policy?.version ?? 0}
        state={state}
        pending={pending}
        send={send}
      />
    </div>
  );
}

function AppointmentRecord({
  appointment: p,
  pending,
  canAct,
  canAttest,
  send,
}: {
  appointment: AppointmentView;
  pending: boolean;
  canAct: boolean;
  canAttest: boolean;
  send: Send;
}) {
  const uncertain = [
    "committed",
    "ambiguous",
    "cancel_committed",
    "cancel_ambiguous",
    "conflict",
  ].includes(p.phase);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {uncertain
            ? p.phase.startsWith("cancel")
              ? "Cancellation pending"
              : "Calendar reconciliation needed"
            : p.status === "confirmed"
              ? "Confirmed appointment"
              : p.status === "attended"
                ? "Attended appointment"
                : p.status === "cancelled"
                  ? "Cancelled appointment"
                  : "Requested appointment"}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge
            className={
              uncertain
                ? "text-warning"
                : p.status === "confirmed"
                  ? "text-success"
                  : undefined
            }
          >
            {p.status}
          </Badge>
          <Badge>{p.phase.replaceAll("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          <time dateTime={p.intent.startsAt}>
            {zoned(p.intent.startsAt, p.intent.customerTimeZone)}
          </time>{" "}
          – {zoned(p.intent.endsAt, p.intent.customerTimeZone)} ·{" "}
          {p.intent.customerTimeZone}
        </p>
        <p className="text-sm text-muted-foreground">
          Business: {zoned(p.intent.startsAt, p.intent.businessTimeZone)} ·{" "}
          {p.intent.businessTimeZone}
        </p>
        {p.phase === "held" && (
          <p>
            Hold expires:{" "}
            <time dateTime={p.holdExpiresAt}>
              {zoned(p.holdExpiresAt, p.intent.customerTimeZone)}
            </time>{" "}
            · {p.intent.customerTimeZone}. Expiry is checked on the server; a
            hold is not a calendar reservation.
          </p>
        )}
        {p.reason && <p>{reasonText(p.reason)}</p>}
        <p className="font-medium">Next action: {p.nextAction}</p>
        {p.event && (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">
                Retained original calendar event
              </dt>
              <dd>
                {p.event.eventId} · {p.event.provider} · {p.event.calendarId}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Appointment reference</dt>
              <dd>{p.id}</dd>
            </div>
          </dl>
        )}
        <p className="text-sm text-muted-foreground">
          Customer notification: not sent. Arrange communication separately.
        </p>
        <div className="flex flex-wrap gap-3">
          {p.phase === "held" && (
            <Button
              disabled={pending || !canAct}
              onClick={() => send("book", { appointmentId: p.id })}
            >
              Check calendar and book
            </Button>
          )}
          {[
            "committed",
            "ambiguous",
            "booked",
            "conflict",
            "cancel_committed",
            "cancel_ambiguous",
          ].includes(p.phase) && (
            <Button
              variant="outline"
              disabled={pending || !canAct}
              onClick={() => send("reconcile", { appointmentId: p.id })}
            >
              Reconcile calendar
            </Button>
          )}
          {p.event && ["booked", "conflict"].includes(p.phase) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={pending || !canAct}>
                  Cancel calendar appointment
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Request cancellation of this event?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The calendar event will be cancelled if the provider accepts.
                  An uncertain result remains pending for reconciliation. The
                  original event and history are retained. No customer
                  notification is sent.
                </AlertDialogDescription>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel>Keep appointment</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => send("cancel", { appointmentId: p.id })}
                  >
                    Request cancellation
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {canAttest &&
          p.event &&
          p.status !== "cancelled" &&
          p.status !== "attended" && (
            <EvidenceForm appointment={p} pending={pending} send={send} />
          )}
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Retained appointment history
          </summary>
          <ol className="space-y-3">
            {p.history.map((e) => (
              <li key={e.id} className="rounded-lg bg-muted p-4">
                <p className="font-medium">
                  {e.kind.replaceAll("_", " ")} · {e.source}
                </p>
                <p>{e.note}</p>
                {e.reference && <p>Evidence reference: {e.reference}</p>}
                <p className="text-sm text-muted-foreground">
                  By {e.actorId} · Evidence at{" "}
                  {zoned(e.occurredAt, p.intent.businessTimeZone)} ·{" "}
                  {p.intent.businessTimeZone}
                </p>
              </li>
            ))}
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}
function EvidenceForm({
  appointment,
  pending,
  send,
}: {
  appointment: AppointmentView;
  pending: boolean;
  send: Send;
}) {
  const key = useRef<string | null>(null);
  const [kind, setKind] = useState(
    appointment.status === "confirmed" && appointment.phase === "booked"
      ? "attended"
      : "cancelled",
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    key.current ??= crypto.randomUUID();
    const success = await send("evidence", {
      appointmentId: appointment.id,
      requestKey: key.current,
      kind,
      reference: data.get("reference"),
      occurredAt: data.get("occurredAt"),
      note: data.get("note"),
    });
    if (success) key.current = null;
  }
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        Record explicit Business evidence
      </summary>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Owner/Admin evidence is a deliberate attestation. A request, message,
          quote or elapsed time does not establish attendance or cancellation.
        </p>
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`outcome-${appointment.id}`}>
              Evidence establishes
            </Label>
            <NativeSelect
              id={`outcome-${appointment.id}`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option
                value="attended"
                disabled={
                  appointment.status !== "confirmed" ||
                  appointment.phase !== "booked"
                }
              >
                Attended appointment
              </option>
              <option value="cancelled">Confirmed external cancellation</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reference-${appointment.id}`}>
              Authoritative evidence reference
            </Label>
            <Input
              id={`reference-${appointment.id}`}
              name="reference"
              maxLength={256}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`occurred-${appointment.id}`}>
              Evidence time with UTC offset
            </Label>
            <Input
              id={`occurred-${appointment.id}`}
              name="occurredAt"
              required
              placeholder="2026-11-05T14:40:00+00:00"
            />
            <p className="text-sm text-muted-foreground">
              Enter an ISO timestamp with its offset. Attendance evidence must
              be at or after the scheduled end and cannot be in the future.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`note-${appointment.id}`}>
              What confirms this outcome?
            </Label>
            <Textarea
              id={`note-${appointment.id}`}
              name="note"
              maxLength={2000}
              required
            />
          </div>
          <Button variant="outline">Record evidence</Button>
        </fieldset>
      </form>
    </details>
  );
}

function BookingSettings({
  state,
  pending,
  send,
}: {
  state: AppointmentWorkspace;
  pending: boolean;
  send: Send;
}) {
  const config = state.policy?.configuration;
  const [windows, setWindows] = useState(
    config?.hours.map((h, index) => ({ ...h, key: `saved-${index}` })) ?? [],
  );
  const [error, setError] = useState("");
  const [automation, setAutomation] = useState(
    config?.automationEnabled ?? false,
  );
  const [selected, setSelected] = useState(
    config?.calendar ? JSON.stringify(config.calendar) : "",
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const binding = selected
      ? calendarBindingSchema.safeParse(JSON.parse(selected))
      : null;
    if (binding && !binding.success) {
      setError("Select a listed calendar.");
      return;
    }
    const parsed = bookingConfigurationSchema.safeParse({
      timeZone: data.get("timeZone"),
      hours: windows.map(({ weekday, start, end }) => ({
        weekday,
        start,
        end,
      })),
      durationMinutes: Number(data.get("durationMinutes")),
      bufferBeforeMinutes: Number(data.get("bufferBeforeMinutes")),
      bufferAfterMinutes: Number(data.get("bufferAfterMinutes")),
      slotStepMinutes: Number(data.get("slotStepMinutes")),
      holdSeconds: Number(data.get("holdSeconds")),
      automationEnabled: automation,
      calendar: binding?.success ? binding.data : null,
    });
    if (!parsed.success) {
      setError(
        "Enter a valid Business zone, non-overlapping hours within each day, positive duration, slot step and hold expiry, and explicit nonnegative buffers.",
      );
      return;
    }
    await send("configuration", {
      expectedVersion: state.policy?.version ?? 0,
      configuration: parsed.data,
      note: data.get("note"),
    });
  }
  const weekdays = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business booking settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Settings apply to future requests across this Business. Existing
          requests retain their original intent and event. A changed
          configuration blocks stale booking attempts.
        </p>
        {!state.canManage ? (
          <p>
            An Owner or Admin configures appointment timing and calendar
            selection.
          </p>
        ) : (
          <form onSubmit={save} className="space-y-5">
            {error && <Alert variant="destructive">{error}</Alert>}
            <fieldset disabled={pending} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="booking-business-zone">
                  Business time zone
                </Label>
                <Input
                  id="booking-business-zone"
                  name="timeZone"
                  defaultValue={config?.timeZone ?? ""}
                  required
                  maxLength={100}
                  placeholder="America/New_York"
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-2 font-medium">
                  Working hours in the Business zone
                </legend>
                <p className="text-sm text-muted-foreground">
                  Use separate windows for each local day. Gaps, repeated times
                  and overlapping windows cannot silently shift an appointment.
                </p>
                {windows.map((w, index) => (
                  <div
                    key={w.key}
                    className="grid items-end gap-3 rounded-lg border p-4 sm:grid-cols-2"
                  >
                    <div className="space-y-2">
                      <Label htmlFor={`weekday-${w.key}`}>
                        Day {index + 1}
                      </Label>
                      <NativeSelect
                        id={`weekday-${w.key}`}
                        value={w.weekday}
                        onChange={(e) =>
                          setWindows(
                            windows.map((v) =>
                              v.key === w.key
                                ? { ...v, weekday: Number(e.target.value) }
                                : v,
                            ),
                          )
                        }
                      >
                        {weekdays.map((day, i) => (
                          <option key={day} value={i + 1}>
                            {day}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <Label htmlFor={`start-${w.key}`}>Opens</Label>
                        <Input
                          id={`start-${w.key}`}
                          type="time"
                          value={w.start}
                          required
                          onChange={(e) =>
                            setWindows(
                              windows.map((v) =>
                                v.key === w.key
                                  ? { ...v, start: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <Label htmlFor={`end-${w.key}`}>Closes</Label>
                        <Input
                          id={`end-${w.key}`}
                          type="time"
                          value={w.end}
                          required
                          onChange={(e) =>
                            setWindows(
                              windows.map((v) =>
                                v.key === w.key
                                  ? { ...v, end: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() =>
                        setWindows(windows.filter((v) => v.key !== w.key))
                      }
                    >
                      Remove window {index + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  type="button"
                  disabled={windows.length >= 28}
                  onClick={() =>
                    setWindows([
                      ...windows,
                      {
                        key: crypto.randomUUID(),
                        weekday: 1,
                        start: "",
                        end: "",
                      },
                    ])
                  }
                >
                  Add working hours
                </Button>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    [
                      "durationMinutes",
                      "Appointment duration (minutes)",
                      1,
                      1440,
                    ],
                    ["bufferBeforeMinutes", "Buffer before (minutes)", 0, 1440],
                    ["bufferAfterMinutes", "Buffer after (minutes)", 0, 1440],
                    ["slotStepMinutes", "Slot interval (minutes)", 1, 1440],
                    ["holdSeconds", "Local hold expiry (seconds)", 1, 86400],
                  ] as const
                ).map(([name, label, min, max]) => (
                  <div key={name} className="space-y-2">
                    <Label htmlFor={`booking-${name}`}>{label}</Label>
                    <Input
                      id={`booking-${name}`}
                      name={name}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={min}
                      max={max}
                      required
                      defaultValue={config?.[name] ?? ""}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-calendar">
                  Customer-owned calendar
                </Label>
                <NativeSelect
                  id="booking-calendar"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">
                    No calendar selected — save timing only
                  </option>
                  {state.calendars.map((c) => (
                    <option
                      key={`${c.connectionId}:${c.calendarId}`}
                      value={JSON.stringify({
                        connectionId: c.connectionId,
                        calendarId: c.calendarId,
                      })}
                    >
                      {c.label} · {c.provider} · {c.grant}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-sm text-muted-foreground">
                  Only calendars returned by the configured provider are
                  selectable. Read/write grants are checked again before
                  booking. RFQs need no calendar selection.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-automation">
                  Appointment automation
                </Label>
                <NativeSelect
                  id="booking-automation"
                  value={automation ? "enabled" : "disabled"}
                  onChange={(e) => setAutomation(e.target.value === "enabled")}
                >
                  <option value="disabled">Manual booking only</option>
                  <option value="enabled">
                    Allow authorized booking automation
                  </option>
                </NativeSelect>
                <p className="text-sm text-muted-foreground">
                  Automation also requires the current booking goal, ownership
                  and Opportunity handback. Manual actions remain separately
                  authorized.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-note">
                  Reason for this configuration
                </Label>
                <Textarea
                  id="booking-note"
                  name="note"
                  maxLength={1000}
                  required
                />
              </div>
              <Button>Save Business booking settings</Button>
            </fieldset>
          </form>
        )}
        {state.policyHistory.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-medium">
              Configuration history
            </summary>
            <ol className="space-y-3">
              {state.policyHistory.map((p) => (
                <li key={p.version}>
                  <p>
                    Version {p.version} · {p.configuration.timeZone} ·{" "}
                    {p.calendar?.label ?? "No calendar selected"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.note} · {p.at}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
