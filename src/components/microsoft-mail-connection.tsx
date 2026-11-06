"use client";

import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  microsoftMailViewSchema,
  type MicrosoftMailView,
} from "@/models/microsoft-mail";
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

const labels: Record<NonNullable<MicrosoftMailView["status"]>, string> = {
  connecting: "Consent incomplete",
  connected: "Microsoft authorized",
  reconnect_required: "Reconnect required",
  insufficient: "Permission or account unavailable",
  revocation_pending: "Locally disabled",
  disconnected: "Disconnected locally",
};
const reasons: Record<NonNullable<MicrosoftMailView["reason"]>, string> = {
  consent_denied:
    "Consent was declined or blocked by account or tenant policy. Review application approval with the administrator before reconnecting.",
  revoked:
    "Microsoft access expired or was revoked. Reconnect with the selected account.",
  insufficient:
    "Some requested permissions are missing. Reading, sending and Calendar are separate; review your requests and reconnect.",
  unavailable: "Microsoft could not be reached. Retry when service returns.",
  rate_limited:
    "Microsoft limited this request. Wait before retrying; synchronization retains its checkpoint.",
  invalid_response:
    "The Microsoft response could not be verified. Ask the operator to review setup.",
  account_mismatch:
    "The authorized account did not match this mailbox. Reconnect with the original selected account.",
  unsupported_account:
    "This account or mailbox configuration is not supported. Use the signed-in user's primary Outlook.com or Exchange Online mailbox in the global Microsoft cloud. Shared, delegated, guest, on-premises, archive and secondary mailboxes are unavailable.",
  license_required:
    "Microsoft could not provide a cloud mailbox. Check the account's Exchange Online licence, mailbox provisioning and tenant access with its administrator.",
  approval_required:
    "Microsoft or your tenant requires application approval. Ask the operator and tenant administrator to review the requested delegated permissions.",
  provider_consent_retained:
    "Credentials were removed locally. Microsoft-side consent has not been revoked or verified. Remove this application's access in your Microsoft account or My Apps; tenant-granted consent needs your administrator.",
};
export function MicrosoftMailConnection({
  businessId,
  mailboxId,
  initialState,
  enabled,
  onChanged,
}: {
  businessId: string;
  mailboxId: string;
  initialState?: MicrosoftMailView;
  enabled: boolean;
  onChanged(): Promise<void>;
}) {
  const [state, setState] = useState(initialState),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recovery, setRecovery] = useState("");
  const [folders, setFolders] = useState<MicrosoftMailView["folders"]>([]);
  async function command(action: "read" | "start" | "disconnect" | "folders") {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery("");
    try {
      const get = action === "read" || action === "folders";
      const response = await fetch(
        `/api/businesses/${businessId}/mailboxes/${mailboxId}/microsoft${action === "read" ? "" : `/${action}`}`,
        get
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
                ? "Ask the operator to finish approved Microsoft mail OAuth and encryption setup."
                : "This action could not be completed. Refresh status and review your access and saved selection.",
        );
        return;
      }
      if (action === "start") {
        const { authorizationUrl } = z
            .object({ authorizationUrl: z.url() })
            .parse(result.data),
          url = new URL(authorizationUrl);
        if (
          url.origin !== "https://login.microsoftonline.com" ||
          url.pathname !== "/common/oauth2/v2.0/authorize"
        )
          throw new Error("Invalid consent destination");
        window.location.assign(url.toString());
        return;
      }
      if (action === "folders") {
        setFolders(microsoftMailViewSchema.shape.folders.parse(result.data));
        setNotice(
          "Folders loaded from this mailbox. Copy the exact IDs into your folder selection below, then save.",
        );
        return;
      }
      setState(microsoftMailViewSchema.parse(result.data));
      if (action === "disconnect") setFolders([]);
      await onChanged();
      setNotice(
        action === "disconnect"
          ? "Microsoft access disabled locally; affected follow-ups are paused. Review the consent-removal steps below."
          : "Microsoft authorization status refreshed. Request synchronization to check current reply visibility.",
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
      aria-label="Microsoft mail connection"
      className="space-y-4 rounded-xl border border-border p-4"
    >
      <h3 className="font-semibold">Microsoft mail connection</h3>
      <Badge
        className={
          state?.status === "connected" ? "text-success" : "text-warning"
        }
      >
        {state?.status ? labels[state.status] : "Not connected"}
      </Badge>
      <p className="text-sm text-muted-foreground">
        Save your reading and sending requests below, then open Microsoft
        consent. Calendar and app sign-in do not grant mail access. Sending
        messages is a later capability.
      </p>
      {state && (
        <p>
          Authorized for this selection: reading {state.read ? "yes" : "no"};
          sending {state.send ? "yes" : "no"}.{" "}
          {state.accountKind === "microsoft_personal"
            ? "Personal Microsoft account."
            : state.accountKind === "microsoft_work"
              ? "Work or school account."
              : ""}
        </p>
      )}
      {state && !state.configured && (
        <Alert>
          Microsoft mail needs its own approved app registration, encryption
          keys, tenant consent where required, validated mailbox/account and
          licence support, and recorded applicable assessment and operating
          costs before activation. Ask the operator to finish setup.
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        Only supported primary cloud mailboxes are available. For manual
        replies, select Sent Items as well as the sales folders, or select the
        exact sales conversations. An Inbox-only selection cannot observe Sent
        Items. No complete reply capture is promised outside observable selected
        mail.
      </p>
      {state?.reason && <Alert>{reasons[state.reason]}</Alert>}
      {state?.status === "disconnected" && (
        <div className="flex flex-wrap gap-3">
          <a
            className="text-primary underline"
            href="https://account.live.com/consent/Manage"
            target="_blank"
            rel="noopener noreferrer"
          >
            Personal account permissions
          </a>
          <a
            className="text-primary underline"
            href="https://myapplications.microsoft.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Work or school My Apps
          </a>
        </div>
      )}
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
          disabled={pending || !enabled || state?.configured === false}
          onClick={() => void command("start")}
        >
          {pending
            ? "Working…"
            : state?.status
              ? "Reconnect Microsoft mail"
              : "Connect Microsoft mail"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void command("read")}
        >
          Refresh Microsoft status
        </Button>
        <Button
          variant="outline"
          disabled={pending || !state?.read}
          onClick={() => void command("folders")}
        >
          Browse mailbox folders
        </Button>
        {state?.status && state.status !== "disconnected" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={pending}>
                Disconnect Microsoft mail
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Disconnect Microsoft mail?</AlertDialogTitle>
              <AlertDialogDescription>
                Synchronization and affected follow-ups stop immediately, and
                stored mail remains available. This removes local credentials.
                Microsoft-side consent must be removed separately in your
                account permissions or My Apps; an administrator must remove
                tenant-granted consent.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void command("disconnect")}>
                  Disconnect locally
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {folders.length > 0 && (
        <details className="space-y-3">
          <summary className="cursor-pointer font-medium">
            Available folders and exact selection IDs
          </summary>
          <p className="text-sm text-muted-foreground">
            Select folders explicitly; subfolders are separate. Newly selected
            mail starts at a new boundary. History remains a separate opt-in.
          </p>
          <ul className="space-y-3">
            {folders.map((folder) => (
              <li key={folder.id}>
                <span className="font-medium">{folder.label}</span>
                <code className="block select-all wrap-anywhere text-sm">
                  {folder.id}
                </code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
