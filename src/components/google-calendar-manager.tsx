"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  googleCalendarViewSchema,
  type GoogleCalendarView,
} from "@/models/google-calendar";
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

const statusLabels: Record<GoogleCalendarView["status"], string> = {
  not_connected: "Not connected",
  connecting: "Consent incomplete",
  selection_required: "Choose a calendar",
  ready: "Calendar authorized",
  reconnect_required: "Reconnect required",
  insufficient: "Calendar permission missing",
  revocation_pending: "Booking disabled · revocation pending",
  disconnected: "Disconnected",
};
const reasonLabels: Record<string, string> = {
  manual_required:
    "Disconnected locally. Unattributed credentials were disposed of without revoking an unverified account. Review the intended Google account permissions; remote consent removal is incomplete.",
  shared_identity:
    "Disconnected locally. Another connection still uses this Google consent, so it was not revoked. Review shared consent before removing it in Google.",
  rate_limited:
    "Google is limiting requests. Wait before refreshing or reconciling; no automatic booking retry will run.",
  revoked:
    "Google authorization expired or was revoked. Reconnect to restore calendar access.",
  insufficient:
    "The required calendar permissions or account identity could not be verified. Reconnect with the original account and grant all calendar permissions.",
  calendar_access_lost:
    "Write access to the selected calendar was lost. Restore its access in Google and reconnect.",
  unavailable:
    "Google could not be reached. Refresh the connection when service returns.",
  invalid_response:
    "The Google response could not be validated. Refresh or ask the operator to review setup.",
  consent_denied:
    "Consent was declined. Connect when you are ready to grant calendar access.",
  revocation_pending:
    "Local booking is disabled. Retry revocation when Google is available. You can also remove the app in your Google account permissions.",
};
export function GoogleCalendarManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: GoogleCalendarView;
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
        `/api/businesses/${businessId}/calendar/google${action === "read" ? "" : `/${action}`}`,
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
          url.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth"
        )
          throw new Error();
        window.location.assign(url.toString());
        return;
      }
      const p = z.object({ data: googleCalendarViewSchema }).parse(raw);
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
        <CardTitle>Google Calendar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Allow calendar access separately from sign-in or mail. Choose a
          calendar you control for availability checks and appointments.
          Connecting does not authorize Gmail or send invitations.
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
        {state.accountEmail && (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">
                Authorized Google account
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
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void command("select");
            }}
          >
            <Label htmlFor="google-calendar">Booking calendar</Label>
            <NativeSelect
              id="google-calendar"
              value={selection}
              onChange={(e) => setSelection(e.target.value)}
              disabled={pending}
              required
            >
              <option value="">Choose a calendar</option>
              {state.calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.timeZone}
                </option>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">
              Only calendars with full writer or owner access are supported.
              Working hours and appointment time zone are configured in
              Appointments.
            </p>
            <Button disabled={pending || !selection} type="submit">
              Use this calendar
            </Button>
          </form>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={
              pending ||
              !state.configured ||
              state.status === "revocation_pending"
            }
            variant={canSelect ? "outline" : "default"}
            onClick={() => void command("start")}
          >
            {pending
              ? "Working…"
              : ["not_connected", "disconnected"].includes(state.status)
                ? "Connect Google Calendar"
                : "Reconnect Google Calendar"}
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
                  {state.status === "revocation_pending"
                    ? "Retry revocation"
                    : "Disconnect and revoke"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Revoke Google Calendar access?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Booking stops for this Business. Existing Google events and
                  appointment history remain. Cancel appointments separately
                  before disconnecting if needed. Google revocation can affect
                  other grants using this same OAuth project and Google account.
                </AlertDialogDescription>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel>Keep connection</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void command("disconnect")}>
                    Disconnect and revoke
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Calendar authorization enables availability and event operations.
          Confirmation still requires a validated event stored by the booking
          workflow. Appointments have no attendees, invitations, conferencing or
          default reminders; customer communication is separate. RFQ handling
          remains available without Google access.
        </p>
      </CardContent>
    </Card>
  );
}
