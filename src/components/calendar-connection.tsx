"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  googleCalendarViewSchema,
  type GoogleCalendarView,
} from "@/models/google-calendar";
import {
  microsoftCalendarViewSchema,
  type MicrosoftCalendarView,
} from "@/models/microsoft-calendar";
import { ProviderMark } from "./provider-mark";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Field, FieldLabel, FieldDescription } from "./ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
import { Alert, AlertDescription } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const reasons: Record<string, string> = {
  consent_denied: "Access wasn't approved. Connect again when you're ready.",
  revoked: "Reconnect your account to restore calendar access.",
  insufficient: "Approve the requested calendar permissions to continue.",
  calendar_access_lost:
    "This calendar is no longer available. Reconnect or choose another calendar.",
  unavailable:
    "Your calendar provider is unavailable. Please try again shortly.",
  rate_limited: "Your provider is busy. Please wait before checking again.",
  revocation_pending:
    "Booking has stopped. Try disconnecting again to finish removing Google access.",
  provider_consent_remains:
    "Disconnected from Lead Relay. Remove the app in your Microsoft account to revoke remaining permission.",
  shared_identity:
    "Calendar disconnected. Another Google connection still uses this access.",
  manual_required:
    "Calendar disconnected. Review remaining app access in your Google account.",
};
export function CalendarConnection({
  provider,
  businessId,
  initialState,
}: {
  provider: "google" | "microsoft";
  businessId: string;
  initialState: GoogleCalendarView | MicrosoftCalendarView;
}) {
  const [state, setState] = useState(initialState);
  const [selection, setSelection] = useState(
    initialState.selectedCalendarId ??
      (initialState.calendars.length === 1 ? initialState.calendars[0].id : ""),
  );
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const manageButton = useRef<HTMLButtonElement>(null);
  const name = provider === "google" ? "Google" : "Microsoft";
  const ready = state.status === "ready" && !state.reason;
  const choose =
    (state.status === "selection_required" || editing) &&
    state.calendars.length > 0;
  async function command(action: "read" | "start" | "select" | "disconnect") {
    if (pending) return;
    setPending(action);
    setError("");
    setRecovery("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/calendar/${provider}${action === "read" ? "" : `/${action}`}`,
        action === "read"
          ? { cache: "no-store" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                action === "start"
                  ? { returnPath: `/businesses/${businessId}/calendar` }
                  : action === "select"
                    ? { calendarId: selection }
                    : {},
              ),
            },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(raw);
        const code = failure.success ? failure.data.code : "";
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : "",
        );
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your account security, then connect your calendar."
            : code === "UNAUTHENTICATED"
              ? "Sign in again to continue."
              : "We couldn't update this calendar. Please try again.",
        );
        return;
      }
      if (action === "start") {
        const result = z
          .object({ data: z.object({ authorizationUrl: z.url() }) })
          .parse(raw);
        const url = new URL(result.data.authorizationUrl);
        if (
          url.origin !==
            (provider === "google"
              ? "https://accounts.google.com"
              : "https://login.microsoftonline.com") ||
          url.pathname !==
            (provider === "google"
              ? "/o/oauth2/v2/auth"
              : "/common/oauth2/v2.0/authorize")
        )
          throw new Error();
        window.location.assign(url.toString());
        return;
      }
      const result =
        provider === "google"
          ? z.object({ data: googleCalendarViewSchema }).parse(raw)
          : z.object({ data: microsoftCalendarViewSchema }).parse(raw);
      setState(result.data);
      setSelection(
        result.data.selectedCalendarId ??
          (result.data.calendars.length === 1
            ? result.data.calendars[0].id
            : ""),
      );
      if (action === "select") setEditing(false);
      setNotice(
        action === "select"
          ? "Calendar connected. You're ready to use it for supported bookings."
          : action === "disconnect"
            ? "Calendar disconnected."
            : "Connection checked.",
      );
    } catch {
      setError(
        "We couldn't confirm the result. Check your connection before trying again.",
      );
    } finally {
      setPending("");
    }
  }
  return (
    <Card aria-busy={Boolean(pending)} className="h-fit">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card">
            <ProviderMark provider={provider} />
          </div>
          {ready && (
            <Badge variant="success">
              <Check aria-hidden="true" />
              Connected
            </Badge>
          )}
        </div>
        <CardTitle className="mt-3 text-xl">{name} Calendar</CardTitle>
        <CardDescription>
          {provider === "google"
            ? "Google & Google Workspace"
            : "Outlook & Microsoft 365"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {state.accountEmail && (
          <p className="break-all text-sm font-medium">{state.accountEmail}</p>
        )}
        {ready && !editing && (
          <div className="flex items-start gap-3 rounded-xl bg-accent/60 p-4">
            <CalendarCheck2
              className="mt-0.5 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {state.calendars.find(
                  (calendar) => calendar.id === state.selectedCalendarId,
                )?.label ?? "Selected booking calendar"}
              </p>
              <p className="text-xs leading-6 text-muted-foreground">
                Check availability and add approved appointments.
              </p>
            </div>
          </div>
        )}
        {choose && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void command("select");
            }}
            className="flex flex-col gap-4"
          >
            <Field>
              <FieldLabel htmlFor={`${provider}-calendar-choice`}>
                Where should appointments go?
              </FieldLabel>
              <Select
                value={selection}
                onValueChange={setSelection}
                disabled={Boolean(pending)}
              >
                <SelectTrigger id={`${provider}-calendar-choice`}>
                  <SelectValue placeholder="Choose your calendar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {state.calendars.map((calendar) => (
                      <SelectItem key={calendar.id} value={calendar.id}>
                        {calendar.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Choose the calendar you use for work.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={Boolean(pending) || !selection}>
                {pending === "select" && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Use this calendar
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
        {!ready && !choose && (
          <>
            <p className="text-sm leading-7 text-muted-foreground">
              Approve calendar access with {name}. Then choose where to save
              appointments.
            </p>
            <Button
              className="w-full justify-between"
              disabled={Boolean(pending) || !state.configured}
              onClick={() => void command("start")}
            >
              {pending === "start"
                ? "Opening consent..."
                : state.configured
                  ? `Connect ${name} Calendar`
                  : "Not available yet"}
              {pending === "start" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              )}
            </Button>
          </>
        )}
        {state.status === "selection_required" && !state.calendars.length && (
          <p className="text-sm text-warning">
            No supported work calendar was found. Check your calendar
            permissions with {name}, then reconnect.
          </p>
        )}
        {!state.configured && (
          <a
            href="mailto:wafa.khan@nmtsolutions.in"
            className="text-xs text-primary underline"
          >
            Contact us to enable calendar connections
          </a>
        )}
        {state.reason && (
          <p role="status" className="text-sm leading-6 text-muted-foreground">
            {reasons[state.reason] ??
              "Check the connection or contact us for help."}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              {recovery && (
                <Link
                  href={recovery}
                  className="ml-2 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {recovery === "/security"
                    ? "Open account security"
                    : "Sign in"}
                </Link>
              )}
            </AlertDescription>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {state.connectionId && (
          <div className="flex justify-end border-t border-border pt-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={manageButton}
                  variant="ghost"
                  aria-busy={Boolean(pending)}
                >
                  <MoreHorizontal aria-hidden="true" />
                  Manage connection
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={Boolean(pending)}
                    onSelect={() => void command("read")}
                  >
                    <RefreshCw aria-hidden="true" />
                    Check connection
                  </DropdownMenuItem>
                  {ready && (
                    <DropdownMenuItem
                      disabled={Boolean(pending)}
                      onSelect={() => setEditing(true)}
                    >
                      Change calendar
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    disabled={Boolean(pending)}
                    onSelect={() => void command("start")}
                  >
                    Reconnect {name}
                  </DropdownMenuItem>
                  {state.status !== "disconnected" && (
                    <DropdownMenuItem
                      disabled={Boolean(pending)}
                      onSelect={() => setDisconnectOpen(true)}
                    >
                      <Unplug aria-hidden="true" />
                      Disconnect
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              manageButton.current?.focus();
            }}
          >
            <AlertDialogTitle>Disconnect this calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              New bookings will stop using this connection. Existing events and
              appointment records remain.{" "}
              {provider === "google"
                ? "Google access shared with email may remain until you remove it in Google account permissions."
                : "Remove the app in Microsoft account permissions or My Apps to revoke remaining consent. Your administrator may need to help."}
            </AlertDialogDescription>
            <div className="flex flex-wrap justify-end gap-3">
              <AlertDialogCancel>Keep connected</AlertDialogCancel>
              <AlertDialogAction onClick={() => void command("disconnect")}>
                Disconnect calendar
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
