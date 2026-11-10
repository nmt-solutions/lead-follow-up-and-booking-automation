"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  Check,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { gmailViewSchema, type GmailView } from "@/models/gmail";
import {
  microsoftMailViewSchema,
  type MicrosoftMailView,
} from "@/models/microsoft-mail";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
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

export type EmailConnectionProps = {
  businessId: string;
  mailboxId: string;
  initialState?: GmailView | MicrosoftMailView;
  enabled: boolean;
  onChanged(): Promise<void>;
};
const reasons: Record<string, string> = {
  consent_denied: "Access wasn't approved. Try again when you're ready.",
  revoked: "Your account needs to be reconnected.",
  insufficient: "Approve the requested email permissions to finish connecting.",
  unavailable: "Your email provider is unavailable. Please try again shortly.",
  rate_limited: "Your provider is busy. Wait a moment before trying again.",
  invalid_response:
    "We couldn't confirm the connection. Try again or contact support.",
  account_mismatch: "Choose the same email account when reconnecting.",
  unsupported_account:
    "Use a personal Outlook or Microsoft 365 account. Shared mailboxes aren't supported.",
  license_required:
    "This account needs an active Microsoft cloud mailbox. Check with your Microsoft administrator.",
  approval_required:
    "Your Microsoft administrator needs to approve this connection.",
  manual_required:
    "Disconnected from Lead Relay. Review app access in your Google account to remove any remaining permission.",
  shared_identity:
    "Disconnected from email. Another Google connection still uses this access.",
  revocation_pending:
    "Email is paused. Try disconnecting again to finish removing Google access.",
  provider_consent_retained:
    "Disconnected from Lead Relay. Remove the app in your Microsoft account to revoke its remaining access.",
};
export function EmailConnection({
  provider,
  businessId,
  mailboxId,
  initialState,
  enabled,
  onChanged,
}: EmailConnectionProps & { provider: "gmail" | "microsoft" }) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const [notice, setNotice] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const manageButton = useRef<HTMLButtonElement>(null);
  const name = provider === "gmail" ? "Google" : "Microsoft";
  const connected = state?.status === "connected" && !state.reason && enabled;
  async function command(action: "read" | "start" | "disconnect") {
    if (pending) return;
    setPending(action);
    setError("");
    setRecovery("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/mailboxes/${mailboxId}/${provider}${action === "read" ? "" : `/${action}`}`,
        action === "read"
          ? { cache: "no-store" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
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
            ? "Verify your account security, then try again."
            : code === "UNAUTHENTICATED"
              ? "Sign in again to continue."
              : "We couldn't update this connection. Please try again.",
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
            (provider === "gmail"
              ? "https://accounts.google.com"
              : "https://login.microsoftonline.com") ||
          url.pathname !==
            (provider === "gmail"
              ? "/o/oauth2/v2/auth"
              : "/common/oauth2/v2.0/authorize")
        )
          throw new Error();
        window.location.assign(url.toString());
        return;
      }
      const result =
        provider === "gmail"
          ? z.object({ data: gmailViewSchema }).parse(raw)
          : z.object({ data: microsoftMailViewSchema }).parse(raw);
      setState(result.data);
      await onChanged();
      setNotice(
        action === "disconnect" ? "Email disconnected." : "Connection checked.",
      );
    } catch {
      setError(
        "We couldn't confirm the result. Check the connection before trying again.",
      );
    } finally {
      setPending("");
    }
  }
  return (
    <div className="flex flex-col gap-4" aria-busy={Boolean(pending)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "success" : "outline"}>
            {connected ? (
              <>
                <Check aria-hidden="true" />
                Access approved
              </>
            ) : state?.status === "disconnected" ? (
              "Disconnected"
            ) : (
              "Needs connection"
            )}
          </Badge>
          {connected && (
            <span className="text-xs text-muted-foreground">
              {[
                state.read && "Read email",
                state.send && "Send approved messages",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!connected && (
            <Button
              disabled={
                Boolean(pending) || !enabled || state?.configured === false
              }
              onClick={() => void command("start")}
            >
              {pending === "start" && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              {state?.status ? `Reconnect ${name}` : `Connect ${name}`}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Manage ${name} connection`}
                ref={manageButton}
                aria-busy={Boolean(pending)}
              >
                <MoreHorizontal aria-hidden="true" />
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
                {connected && (
                  <DropdownMenuItem
                    disabled={Boolean(pending)}
                    onSelect={() => void command("start")}
                  >
                    Reconnect {name}
                  </DropdownMenuItem>
                )}
                {state?.status && state.status !== "disconnected" && (
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
      </div>
      {state?.reason && (
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {reasons[state.reason] ?? "Check your connection and try again."}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {recovery && (
              <Link
                className="ml-2 underline"
                href={recovery}
                target="_blank"
                rel="noreferrer"
              >
                {recovery === "/security" ? "Open account security" : "Sign in"}
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
      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            manageButton.current?.focus();
          }}
        >
          <AlertDialogTitle>Disconnect this email?</AlertDialogTitle>
          <AlertDialogDescription>
            Email syncing and affected follow-ups will stop. Existing
            conversations stay in Lead Relay.{" "}
            {provider === "gmail"
              ? "Google access shared with a calendar may remain until you remove it in Google account permissions."
              : "To revoke Microsoft's remaining permission, remove the app in your Microsoft account or My Apps. Your administrator may need to help."}
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={() => void command("disconnect")}>
              Disconnect email
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
