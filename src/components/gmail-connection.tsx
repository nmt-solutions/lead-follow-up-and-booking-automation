"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { gmailViewSchema, type GmailView } from "@/models/gmail";
import { Button } from "./ui/button";
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

const labels: Record<NonNullable<GmailView["status"]>, string> = {
  connecting: "Consent incomplete",
  connected: "Gmail authorized",
  reconnect_required: "Reconnect required",
  insufficient: "Permission missing",
  revocation_pending: "Locally disabled; revocation pending",
  disconnected: "Disconnected",
};
const reasons: Record<NonNullable<GmailView["reason"]>, string> = {
  consent_denied: "Consent was declined. Connect when you are ready.",
  revoked:
    "Google access expired or was revoked. Reconnect with the selected account.",
  insufficient:
    "Some requested permissions were not granted. Reading and sending remain independent; review your selection and reconnect.",
  unavailable: "Google could not be reached. Retry when service returns.",
  rate_limited: "Google is limiting requests. Wait before retrying.",
  invalid_response:
    "The Google response could not be validated. Ask the operator to review setup.",
  account_mismatch:
    "The authorized account did not match this mailbox. Reconnect with the selected account. Rejected credentials cannot authorize consent removal.",
  manual_required:
    "Disconnected locally. Unattributed credentials were disposed of without revoking an unverified account. Review consent in the intended Google account; remote removal is incomplete.",
  shared_identity:
    "Disconnected locally. Google consent is still used by another connection and was not revoked. Review shared consent before removing it in Google.",
  revocation_pending:
    "Sync is disabled locally. Retry revocation when Google is available, or remove the application in your Google account permissions.",
};
export function GmailConnection({
  businessId,
  mailboxId,
  initialState,
  enabled,
  onChanged,
}: {
  businessId: string;
  mailboxId: string;
  initialState?: GmailView;
  enabled: boolean;
  onChanged(): Promise<void>;
}) {
  const [state, setState] = useState(initialState ?? null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recovery, setRecovery] = useState("");
  async function command(action: "read" | "start" | "disconnect") {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/mailboxes/${mailboxId}/gmail${action === "read" ? "" : `/${action}`}`,
        action === "read"
          ? { cache: "no-store" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            },
      );
      const result = z
        .discriminatedUnion("success", [
          z.object({ success: z.literal(true), data: z.unknown() }),
          z.object({ success: z.literal(false), code: z.string() }),
        ])
        .parse(await response.json());
      if (!result.success || !response.ok) {
        const code = result.success ? "" : result.code;
        if (code === "MFA_REQUIRED" || code === "UNAUTHENTICATED")
          setRecovery(code === "MFA_REQUIRED" ? "/security" : "/sign-in");
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your authenticator in Security, then retry. Your selection is preserved."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then retry."
              : code === "CHANNEL_SETUP_REQUIRED"
                ? "Ask the operator to finish approved Gmail OAuth and encryption setup."
                : "This action could not be completed. Refresh status and check your access and saved selection.",
        );
        return;
      }
      if (action === "start") {
        const { authorizationUrl } = z
          .object({ authorizationUrl: z.url() })
          .parse(result.data);
        const url = new URL(authorizationUrl);
        if (
          url.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth"
        )
          throw new Error("Invalid consent destination");
        window.location.assign(url.toString());
        return;
      }
      setState(gmailViewSchema.parse(result.data));
      await onChanged();
      setNotice(
        action === "disconnect"
          ? "Local Gmail access disabled. Review revocation status below."
          : "Gmail authorization status refreshed. Request sync to check current mailbox visibility.",
      );
    } catch {
      setError(
        "The response could not be verified. Refresh status before retrying.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-label="Gmail connection"
      className="flex flex-col gap-4 rounded-xl border border-border p-4"
    >
      <h3 className="font-semibold">Gmail connection</h3>
      <Badge
        className={
          state?.status === "connected" ? "text-success" : "text-warning"
        }
      >
        {state?.status ? labels[state.status] : "Not connected"}
      </Badge>
      <p className="text-sm text-muted-foreground">
        Save the reading and sending requests below, then open Google consent.
        Calendar access and app sign-in do not grant mailbox access. Sending
        requires a separate grant, a ready sending identity and reply route, and
        an explicitly started approved sequence. This does not change the
        selected mail or authorize historical imports.
      </p>
      {state && (
        <p>
          Authorized for this selection: reading {state.read ? "yes" : "no"};
          sending {state.send ? "yes" : "no"}.
        </p>
      )}
      {state && !state.configured && (
        <Alert>
          Gmail needs an approved OAuth project, encryption keys, production
          verification/security assessment and recorded costs before activation.
          Ask the operator to finish setup.
        </Alert>
      )}
      {state?.reason && <Alert>{reasons[state.reason]}</Alert>}
      {error && (
        <Alert variant="destructive">
          {error}{" "}
          {recovery && (
            <Link
              href={recovery}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open {recovery === "/security" ? "Security" : "sign-in"}
            </Link>
          )}
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            pending ||
            !enabled ||
            state?.configured === false ||
            state?.status === "revocation_pending"
          }
          onClick={() => void command("start")}
        >
          {pending
            ? "Working…"
            : state?.status
              ? "Reconnect Gmail"
              : "Connect Gmail"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void command("read")}
        >
          Refresh Gmail status
        </Button>
        {state?.status && state.status !== "disconnected" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={pending}>
                Disconnect and revoke
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Revoke Google access?</AlertDialogTitle>
              <AlertDialogDescription>
                Synchronization and affected follow-ups stop immediately; stored
                mail stays available. Google revocation can remove other grants
                for the same account and OAuth project, including Calendar if
                the operator shares that project. It cannot revoke only reading
                or sending. Other affected Google integrations may need
                reconnection.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void command("disconnect")}>
                  Disable and revoke
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </section>
  );
}
