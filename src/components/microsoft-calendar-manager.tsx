"use client";
import { FieldGroup } from "./ui/field";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  microsoftCalendarViewSchema,
  type MicrosoftCalendarView,
} from "@/models/microsoft-calendar";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const statusLabels: Record<MicrosoftCalendarView["status"], string> = {
  not_connected: "Not connected",
  connecting: "Consent incomplete",
  selection_required: "Choose a calendar",
  ready: "Calendar authorized",
  reconnect_required: "Reconnect required",
  insufficient: "Calendar permission missing",
  disconnected: "Disconnected locally",
};
const reasonLabels: Record<string, string> = {
  rate_limited:
    "Microsoft is limiting requests. Wait before refreshing or reconciling; no automatic booking retry will run.",
  revoked:
    "Microsoft authorization expired or was revoked. Reconnect to restore calendar access.",
  insufficient:
    "The required calendar permissions or account identity could not be verified. Reconnect with the original account and grant all calendar permissions.",
  calendar_access_lost:
    "Write access to the selected calendar was lost. Restore its access in Microsoft and reconnect.",
  unavailable:
    "Microsoft could not be reached. Refresh the connection when service returns.",
  invalid_response:
    "The Microsoft response could not be validated. Refresh or ask the operator to review setup.",
  consent_denied:
    "Consent was declined. Connect when you are ready to grant calendar access.",
  provider_consent_remains:
    "Stored credentials were deleted. Microsoft consent remains until you remove the app in account permissions or My Apps. Administrator consent needs your administrator; issued tokens may remain valid until expiry.",
};
export function MicrosoftCalendarManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: MicrosoftCalendarView;
}) {
  const [state, setState] = useState(initialState);
  const [selection, setSelection] = useState(
    initialState.selectedCalendarId ?? "",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function command(action: "read" | "start" | "select" | "disconnect") {
    if (pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/calendar/microsoft${action === "read" ? "" : `/${action}`}`,
        {
          method: action === "read" ? "GET" : "POST",
          headers: { "Content-Type": "application/json" },
          ...(action === "read"
            ? {}
            : {
                body: JSON.stringify(
                  action === "start"
                    ? { returnPath: `/businesses/${businessId}/calendar` }
                    : action === "select"
                      ? { calendarId: selection }
                      : {},
                ),
              }),
        },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const p = z.object({ code: z.string() }).safeParse(raw);
        setError(
          p.success && p.data.code === "MFA_REQUIRED"
            ? "Verify your authenticator in Security, then retry. Your calendar choice is preserved."
            : p.success && p.data.code === "UNAUTHENTICATED"
              ? "Sign in again, then retry."
              : "The calendar action could not be completed. Refresh the connection and review its state.",
        );
        return;
      }
      if (action === "start") {
        const p = z
          .object({ data: z.object({ authorizationUrl: z.url() }) })
          .parse(raw);
        const url = new URL(p.data.authorizationUrl);
        if (
          url.origin !== "https://login.microsoftonline.com" ||
          url.pathname !== "/common/oauth2/v2.0/authorize"
        )
          throw new Error();
        window.location.assign(url.toString());
        return;
      }
      const p = z.object({ data: microsoftCalendarViewSchema }).parse(raw);
      setState(p.data);
      setSelection(p.data.selectedCalendarId ?? "");
      setMessage(
        action === "select"
          ? "Booking calendar selected. Review appointment hours and availability before booking."
          : action === "disconnect"
            ? "Connection state updated. Existing appointment records are retained."
            : "Connection state refreshed.",
      );
    } catch {
      setError(
        "The calendar response could not be validated. Refresh and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  const canSelect =
    ["ready", "selection_required"].includes(state.status) &&
    state.calendars.length > 0;
  return (
    <Card aria-busy={pending}>
      <CardHeader>
        <CardTitle>Microsoft Calendar</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          Allow calendar access separately from sign-in or mail. Choose a
          calendar you control for availability checks and appointments.
          Connecting does not authorize mail or send invitations.
        </p>
        <Badge
          className={
            state.status === "ready" && !state.reason && state.configured
              ? "bg-success/10 text-success"
              : "bg-warning/10 text-warning"
          }
        >
          {statusLabels[state.status]}
        </Badge>
        {!state.configured && <Alert>{state.setupReason}</Alert>}
        {state.reason && (
          <p className="text-sm text-muted-foreground" role="status">
            {reasonLabels[state.reason] ??
              "Review the connection and reconnect if access is unavailable."}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            {error}{" "}
            <Link href="/security" className="underline">
              Open Security
            </Link>
          </Alert>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {state.status === "selection_required" &&
          state.calendars.length === 0 && (
            <p role="status" className="text-sm text-muted-foreground">
              No supported owned calendar is available. Check your Outlook
              calendar ownership and permissions, or use another supported
              account after disconnecting.
            </p>
          )}
        {state.accountKind && (
          <p className="text-sm text-muted-foreground">
            {state.accountKind === "microsoft_personal"
              ? "Personal Outlook: calendar event reads"
              : "Work or school: primary calendar free/busy"}
          </p>
        )}
        {state.accountEmail && (
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">
                Authorized Microsoft account
              </dt>
              <dd className="wrap-anywhere">{state.accountEmail}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Calendar grant recorded</dt>
              <dd>
                {state.authorizedAt
                  ? new Date(state.authorizedAt).toLocaleString()
                  : "Not established"}
              </dd>
            </div>
          </dl>
        )}
        {canSelect && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void command("select");
            }}
          >
            <FieldGroup className="gap-3">
              <Label htmlFor="microsoft-calendar">Booking calendar</Label>
              <NativeSelect
                id="microsoft-calendar"
                value={selection}
                onChange={(e) => setSelection(e.target.value)}
                disabled={pending}
                required
              >
                <option value="">Choose a calendar</option>
                {state.calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.primary ? " (primary)" : ""}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                Work/school accounts support the owned primary calendar with
                free/busy checks. Personal Outlook accounts support owned
                primary and secondary calendars using event reads. Shared,
                delegated, group and work secondary calendars are unavailable.
                Working hours and appointment time zone are configured in
                Appointments.
              </p>
              <Button disabled={pending || !selection} type="submit">
                Use this calendar
              </Button>
            </FieldGroup>
          </form>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={pending || !state.configured}
            variant={canSelect ? "outline" : "default"}
            onClick={() => void command("start")}
          >
            {pending
              ? "Working…"
              : ["not_connected", "disconnected"].includes(state.status)
                ? "Connect Microsoft Calendar"
                : "Reconnect Microsoft Calendar"}
          </Button>
          <Button
            disabled={pending}
            variant="outline"
            onClick={() => void command("read")}
          >
            Refresh connection
          </Button>
          {state.connectionId && state.status !== "disconnected" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={pending} variant="outline">
                  Disconnect calendar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Disconnect Microsoft Calendar?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Booking stops for this Business. Existing Microsoft events and
                  appointment history remain. Cancel appointments separately
                  before disconnecting if needed. This deletes our stored
                  credentials; Microsoft consent remains until you remove the
                  app in Microsoft account permissions or My Apps. Admin-granted
                  permissions need your administrator. Disconnecting does not
                  revoke access everywhere.
                </AlertDialogDescription>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel>Keep connection</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void command("disconnect")}>
                    Disconnect calendar
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          To revoke Microsoft consent, use{" "}
          <a
            className="underline"
            href="https://account.live.com/consent/Manage"
          >
            personal account permissions
          </a>{" "}
          or{" "}
          <a className="underline" href="https://myapplications.microsoft.com/">
            work/school My Apps
          </a>
          . Administrator consent may require your administrator. Previously
          issued tokens may remain valid until expiry.
        </p>
        <p className="text-sm text-muted-foreground">
          Calendar authorization enables availability and event operations.
          Confirmation still requires a validated event stored by the booking
          workflow. Appointments have no attendees, invitations, conferencing or
          default reminders; customer communication is separate. RFQ handling
          remains available without Microsoft access.
        </p>
      </CardContent>
    </Card>
  );
}
