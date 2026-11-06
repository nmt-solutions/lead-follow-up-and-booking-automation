"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  mailboxWorkspaceSchema,
  saveMailboxSchema,
  type MailboxView,
  type MailboxWorkspace,
} from "@/models/mailboxes";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { GmailConnection } from "./gmail-connection";
import type { GmailView } from "@/models/gmail";
import { MicrosoftMailConnection } from "./microsoft-mail-connection";
import type { MicrosoftMailView } from "@/models/microsoft-mail";

const resultSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
class MailboxFormError extends Error {
  constructor(
    message: string,
    readonly recovery: string = "",
  ) {
    super(message);
  }
}
const reasons = {
  reply_association_review:
    "A selected incoming reply is retained but its exact received or sent reference is not yet available. Review the reply below and explicitly authorize any needed source conversation/history. It has not been assigned to a guessed purchasing need; affected follow-ups remain paused.",
  worker_required:
    "Mailbox authorization is separate from durable synchronization. Ask the operator to configure or restore the deployed mailbox worker, then resume this saved job.",
  manual_reply_review:
    "A selected outgoing message needs review. For an initial email, review its evidence in First-outreach campaigns; replies need an exact received-message and Opportunity association. Affected follow-ups remain paused.",
  rate_limited:
    "The mail provider limited this request. Follow-ups are paused; retry later from the saved checkpoint.",
  cursor_recovery:
    "Catching up or recovering available selected mail; follow-ups are paused. Any unrecoverable history gap stays visible after recovery.",
  history_gap:
    "Available selected mail was recovered, but the provider cannot prove deleted or missing history. Follow-ups remain paused. After review, disable reading and save, then re-enable and save to approve a new mail boundary. Existing history stays available.",
  interrupted:
    "This sync was interrupted. No unfinished page was saved. Resume when you are ready.",
  authorization_required:
    "The queued session or team access is no longer valid. Verify your current access, then explicitly resume this work.",
  setup_required:
    "The selected Gmail or Microsoft integration is not connected. Ask the operator to complete mailbox setup.",
  permission_required:
    "Reconnect with reading access that covers the selection. Sending and calendar access do not grant reading access.",
  scope_changed:
    "Settings changed. Review the current selection before starting work again.",
  provider_unavailable:
    "The provider could not finish this batch. Retry to continue from the saved checkpoint.",
  invalid_provider_response:
    "The provider response could not be verified. Ask the operator to check this connection.",
  limit_reached:
    "The saved message limit was reached. This import will not read more mail. Review before explicitly choosing new bounds.",
};

export function MailboxManager({
  businessId,
  initialState,
  gmailConnections = {},
  microsoftConnections = {},
}: {
  businessId: string;
  initialState: MailboxWorkspace;
  gmailConnections?: Record<string, GmailView>;
  microsoftConnections?: Record<string, MicrosoftMailView>;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState("");
  const base = `/api/businesses/${businessId}/mailboxes`;
  async function request(path: string, input?: unknown) {
    const response = await fetch(
      path,
      input === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
    );
    const parsed = resultSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new MailboxFormError(
        "The response could not be read. Refresh status before retrying.",
      );
    if (!parsed.data.success || !response.ok) {
      const code = parsed.data.success ? "" : parsed.data.code;
      throw new MailboxFormError(
        code === "CONFLICT"
          ? "Settings or ownership changed. Refresh status, review your entries and try again."
          : code === "MFA_REQUIRED"
            ? "Verify your authenticator in Security, then retry. Your entries are preserved."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then retry. Your entries are preserved."
              : "This action could not be completed. Check your access, mailbox selection and import bounds.",
        code === "MFA_REQUIRED"
          ? "/security"
          : code === "UNAUTHENTICATED"
            ? "/sign-in"
            : "",
      );
    }
    return parsed.data.data;
  }
  async function run(operation: () => Promise<void>, message: string) {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery("");
    try {
      await operation();
      setState(mailboxWorkspaceSchema.parse(await request(base)));
      setNotice(message);
    } catch (failure: unknown) {
      setError(
        failure instanceof MailboxFormError
          ? failure.message
          : "The request failed. Your entries are preserved; try again.",
      );
      setRecovery(failure instanceof MailboxFormError ? failure.recovery : "");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Select the sales mail this Business may process. Reading and sending are
        separate requests; provider authorization is checked separately.
        Calendar permissions have no effect here.
      </p>
      {state.providerMode === "unconfigured" && (
        <Alert>
          Mailbox synchronization is unavailable until the selected Gmail or
          Microsoft integration is connected. You can save your selection now.
          Saving settings does not grant mailbox access.
        </Alert>
      )}
      <div className="flex flex-wrap gap-4">
        <Link
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          href={`/businesses/${businessId}/senders`}
        >
          Manage mailbox identities
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          href={`/businesses/${businessId}/inbox`}
        >
          Open sales inbox
        </Link>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void run(async () => {}, "Mailbox status refreshed.")}
        >
          Refresh status
        </Button>
      </div>
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
              Open {recovery === "/security" ? "Security" : "sign-in"} in a new
              tab
            </Link>
          )}
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state.canManage && (
        <p>Ask a Business Owner or Admin to change processing access.</p>
      )}
      {state.mailboxes.map((mailbox) => (
        <Card key={mailbox.id}>
          <CardHeader>
            <CardTitle className="wrap-anywhere">{mailbox.account}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {mailbox.provider === "gmail" ? "Gmail" : "Microsoft"} · New-mail
              boundary: {new Date(mailbox.incrementalSince).toLocaleString()}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {mailbox.provider === "microsoft" && state.canManage && (
              <MicrosoftMailConnection
                businessId={businessId}
                mailboxId={mailbox.id}
                initialState={microsoftConnections[mailbox.id]}
                enabled={
                  mailbox.configuration.enabled &&
                  (mailbox.configuration.requestedRead ||
                    mailbox.configuration.requestedSend)
                }
                onChanged={async () =>
                  setState(mailboxWorkspaceSchema.parse(await request(base)))
                }
              />
            )}
            {mailbox.provider === "gmail" && state.canManage && (
              <GmailConnection
                businessId={businessId}
                mailboxId={mailbox.id}
                initialState={gmailConnections[mailbox.id]}
                enabled={
                  mailbox.configuration.enabled &&
                  (mailbox.configuration.requestedRead ||
                    mailbox.configuration.requestedSend)
                }
                onChanged={async () =>
                  setState(mailboxWorkspaceSchema.parse(await request(base)))
                }
              />
            )}
            <p>
              Reply visibility:{" "}
              <strong>
                {mailbox.visibility === "current"
                  ? "Current within the selected scope"
                  : mailbox.visibility === "recovering"
                    ? "Catching up; follow-ups paused"
                    : mailbox.visibility === "limited"
                      ? "History gap; follow-ups paused"
                      : "Unavailable or stale; follow-ups paused"}
              </strong>
              . Last synchronized:{" "}
              {mailbox.lastSyncedAt
                ? new Date(mailbox.lastSyncedAt).toLocaleString()
                : "not yet"}
              .
            </p>
            {mailbox.pendingManualReplies > 0 && (
              <Alert>
                {mailbox.pendingManualReplies} selected outgoing messages are
                retained for review. Initial emails can be reviewed in
                First-outreach campaigns; replies need an exact received-message
                association. No buyer or Opportunity has been inferred.
              </Alert>
            )}
            {mailbox.manualReplyReview.map((reply) => (
              <details
                key={reply.id}
                className="rounded-xl border border-border p-4"
              >
                <summary className="min-h-11 cursor-pointer font-medium">
                  Review outgoing message: {reply.subject}
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">
                  Occurred {new Date(reply.occurredAt).toLocaleString()}. Exact
                  reply reference: {reply.inReplyTo ?? "none"}. Locate this
                  message in{" "}
                  {mailbox.provider === "microsoft" ? "Outlook" : "Gmail"} and
                  explicitly approve the corresponding thread and history bounds
                  if needed; no buyer association is inferred.
                </p>
                <p
                  className="mt-3 whitespace-pre-wrap wrap-anywhere"
                  dir="auto"
                >
                  {reply.text}
                </p>
              </details>
            ))}
            {mailbox.pendingIncomingReplies > 0 && (
              <Alert>
                {mailbox.pendingIncomingReplies} incoming replies await their
                exact source reference. Retained content remains available while
                association and affected follow-ups are paused.
              </Alert>
            )}
            {mailbox.incomingReplyReview.map((reply) => (
              <details
                key={reply.id}
                className="rounded-xl border border-border p-4"
              >
                <summary className="min-h-11 cursor-pointer font-medium">
                  Review incoming reply: {reply.subject}
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">
                  Occurred {new Date(reply.occurredAt).toLocaleString()}. Exact
                  reply header: {reply.inReplyTo ?? "unavailable"}. Locate its
                  source in{" "}
                  {mailbox.provider === "microsoft" ? "Outlook" : "Gmail"}, then
                  explicitly authorize the relevant conversation or bounded
                  history. Synchronization will reconcile the received message
                  to the current Opportunity of that source when it becomes
                  observable.
                </p>
                <p
                  className="mt-3 whitespace-pre-wrap wrap-anywhere"
                  dir="auto"
                >
                  {reply.text}
                </p>
              </details>
            ))}
            <p>
              Requested: reading{" "}
              {mailbox.configuration.requestedRead ? "on" : "off"} · sending{" "}
              {mailbox.configuration.requestedSend ? "on" : "off"}. Provider:
              reading {mailbox.grant?.read ?? "not checked"} · sending{" "}
              {mailbox.grant?.send ?? "not checked"}.
            </p>
            {mailbox.grant && (
              <p className="text-sm text-muted-foreground">
                Permission checked{" "}
                {new Date(mailbox.grant.observedAt).toLocaleString()}; expires{" "}
                {new Date(mailbox.grant.validUntil).toLocaleString()}. Every
                sync checks current provider access again.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Folder/label and thread selections capture only matching mail.
              These limited selections cannot establish complete reply capture
              for a general sending route. Gmail INBOX-only selections usually
              exclude sent replies. Include the selected sales label on sent
              messages or select the exact thread to observe supported manual
              replies.
            </p>
            <MailboxForm
              key={`${mailbox.id}-${mailbox.version}`}
              mailbox={mailbox}
              state={state}
              disabled={pending || !state.canManage}
              onSave={(input) =>
                run(async () => {
                  await request(base, input);
                }, "Processing selection saved. Existing correspondence remains available.")
              }
            />
            {state.canManage && (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={
                    pending ||
                    !mailbox.configuration.enabled ||
                    !mailbox.configuration.requestedRead
                  }
                  onClick={() =>
                    void run(async () => {
                      await request(`${base}/${mailbox.id}/sync`, {
                        mode: "incremental",
                      });
                    }, "New-mail sync requested. Review its state below.")
                  }
                >
                  Sync new selected mail
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    pending ||
                    !mailbox.configuration.enabled ||
                    !mailbox.configuration.requestedRead ||
                    !mailbox.configuration.history
                  }
                  onClick={() =>
                    void run(async () => {
                      await request(`${base}/${mailbox.id}/sync`, {
                        mode: "history",
                      });
                    }, "History import requested with the saved bounds. Review its state below.")
                  }
                >
                  Start or resume bounded history
                </Button>
              </div>
            )}
            <div className="space-y-3">
              <h3 className="font-semibold">Sync and import activity</h3>
              {mailbox.jobs.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No import or sync requested. History is{" "}
                  {mailbox.configuration.history
                    ? "opted in with bounds; start when ready"
                    : "off"}
                  .
                </p>
              )}
              {mailbox.jobs.map((job) => (
                <div
                  key={job.id}
                  className="space-y-2 rounded-xl border border-border p-4"
                >
                  <p>
                    <Badge>{job.status}</Badge>{" "}
                    {job.mode === "history"
                      ? "Historical import"
                      : "New-mail sync"}{" "}
                    · selection version {job.policyVersion}
                  </p>
                  <p className="text-sm">
                    {job.captured} captured · {job.duplicates} duplicates ·{" "}
                    {job.excluded} excluded · {job.considered} within selection
                    · checkpoint {job.checkpoint}
                  </p>
                  {job.reason && (
                    <p className="text-sm text-muted-foreground">
                      {reasons[job.reason]}
                    </p>
                  )}
                  {job.retryAt && job.reason === "rate_limited" && (
                    <p className="text-sm">
                      Retry after {new Date(job.retryAt).toLocaleString()}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      {state.canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Select a mailbox</CardTitle>
          </CardHeader>
          <CardContent>
            {state.connections.length ? (
              <MailboxForm
                key={state.mailboxes.map((m) => m.id).join()}
                state={state}
                disabled={pending}
                onSave={(input) =>
                  run(async () => {
                    await request(base, input);
                  }, "Mailbox selection saved. History remains off unless explicitly enabled.")
                }
              />
            ) : (
              <p>
                Add a Gmail or Microsoft mailbox identity in{" "}
                <Link
                  href={`/businesses/${businessId}/senders`}
                  className="text-primary underline"
                >
                  Sending identities
                </Link>
                , then return here. OAuth connection is a separate step.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MailboxForm({
  mailbox,
  state,
  disabled,
  onSave,
}: {
  mailbox?: MailboxView;
  state: MailboxWorkspace;
  disabled: boolean;
  onSave: (input: unknown) => Promise<void>;
}) {
  const config = mailbox?.configuration;
  const [scope, setScope] = useState(config?.scope.kind ?? "folders");
  const [history, setHistory] = useState(Boolean(config?.history));
  const [error, setError] = useState("");
  const prefix = mailbox?.id ?? "new-mailbox";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const read = (name: string) => String(form.get(name) ?? "");
    const input = {
      id: mailbox?.id ?? null,
      expectedVersion: mailbox?.version ?? 0,
      configuration: {
        connectionId: config?.connectionId ?? read("connectionId"),
        enabled: form.has("enabled"),
        requestedRead: form.has("read"),
        requestedSend: form.has("send"),
        salesSubjectTerms: read("salesSubjectTerms")
          .split(/\r?\n/)
          .map((v) => v.trim())
          .filter(Boolean),
        scope:
          scope === "mailbox"
            ? { kind: "mailbox" }
            : {
                kind: scope,
                refs: read("refs")
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
        history: history
          ? {
              from: `${read("from")}:00Z`,
              to: `${read("to")}:00Z`,
              maxMessages: Number(read("maxMessages")),
            }
          : null,
      },
    };
    const parsed = saveMailboxSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        "Choose a mailbox and at least one folder/label or thread when needed. For history, use an increasing UTC date range and a message limit from 1 to 10,000.",
      );
      return;
    }
    await onSave(parsed.data);
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={disabled} className="space-y-5">
        <legend className="mb-3 font-semibold">
          {mailbox ? "Processing selection" : "New mailbox selection"}
        </legend>
        {!mailbox && (
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-connection`}>
              Business mailbox identity
            </Label>
            <NativeSelect
              id={`${prefix}-connection`}
              name="connectionId"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Choose a mailbox
              </option>
              {state.connections
                .filter(
                  (c) =>
                    !state.mailboxes.some(
                      (m) => m.configuration.connectionId === c.id,
                    ),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {c.account}
                  </option>
                ))}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1">
          {[
            ["enabled", "Process this mailbox", config?.enabled ?? true],
            [
              "read",
              "Request reading of selected sales mail",
              config?.requestedRead ?? false,
            ],
            [
              "send",
              "Request sending permission separately",
              config?.requestedSend ?? false,
            ],
          ].map(([name, label, checked]) => (
            <label
              key={String(name)}
              className="flex min-h-11 items-center gap-3"
            >
              <input
                type="checkbox"
                name={String(name)}
                defaultChecked={Boolean(checked)}
                className="size-5 accent-primary"
              />
              {String(label)}
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-scope`}>Mail to process</Label>
          <NativeSelect
            id={`${prefix}-scope`}
            value={scope}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "mailbox" ||
                value === "folders" ||
                value === "threads"
              )
                setScope(value);
            }}
          >
            <option value="folders">Selected sales folders or labels</option>
            <option value="threads">Selected conversations (threads)</option>
            <option value="mailbox">Sales mail across this mailbox</option>
          </NativeSelect>
        </div>
        {scope !== "mailbox" && (
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-refs`}>
              {scope === "folders"
                ? "Provider folder or label IDs"
                : "Provider conversation/thread IDs"}{" "}
              — one per line
            </Label>
            <Textarea
              id={`${prefix}-refs`}
              name="refs"
              required
              defaultValue={
                config?.scope.kind !== "mailbox"
                  ? config?.scope.refs.join("\n")
                  : ""
              }
            />
            <p className="text-sm text-muted-foreground">
              Use exact IDs from the selected provider. Access is checked before
              sync; names or permissions for another mailbox cannot authorize
              this selection.
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-sales-terms`}>
            Sales subject phrases — one per line
          </Label>
          <Textarea
            id={`${prefix}-sales-terms`}
            name="salesSubjectTerms"
            defaultValue={config?.salesSubjectTerms?.join("\n") ?? ""}
          />
          <p className="text-sm text-muted-foreground">
            For new inquiries in selected folders or labels, require an
            addressed, non-automated message whose subject contains one of these
            phrases (3–80 characters; up to 20 phrases). Folder selection alone
            does not prove sales relevance. Empty means new folder-only
            inquiries stay excluded. Exact selected threads and already imported
            threads supply explicit sales context. Whole-mailbox mode processes
            established threads only. Bodies of unknown mail are never fetched.
          </p>
        </div>
        <fieldset className="space-y-4 rounded-xl border border-border p-4">
          <legend className="px-2 font-medium">Optional history</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              name="history"
              type="checkbox"
              checked={history}
              onChange={(event) => setHistory(event.target.checked)}
              className="size-5 accent-primary"
            />
            Opt into a bounded historical import
          </label>
          <p className="text-sm text-muted-foreground">
            History is off by default. New-mail sync starts at the saved
            selection time and never imports earlier correspondence. Saving
            history bounds does not start the import.
          </p>
          {history && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-from`}>From, inclusive (UTC)</Label>
                <Input
                  id={`${prefix}-from`}
                  name="from"
                  type="datetime-local"
                  required
                  defaultValue={config?.history?.from.slice(0, 16)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-to`}>Until, exclusive (UTC)</Label>
                <Input
                  id={`${prefix}-to`}
                  name="to"
                  type="datetime-local"
                  required
                  defaultValue={config?.history?.to.slice(0, 16)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-limit`}>
                  Maximum selected messages
                </Label>
                <Input
                  id={`${prefix}-limit`}
                  name="maxMessages"
                  type="number"
                  required
                  min={1}
                  max={10000}
                  defaultValue={config?.history?.maxMessages ?? 100}
                />
              </div>
              <p className="self-center text-sm text-muted-foreground">
                One shared limit across pages, retries and resumes. Duplicate
                imports cannot create another purchasing need.
              </p>
            </div>
          )}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Changing processing scope, subject phrases or read access stops older
          queued work and starts a new-mail boundary. Already authorized
          correspondence remains in your inbox. Unrelated and unselected content
          is excluded from future automated processing.
        </p>
        <Button type="submit">
          {disabled ? "Save unavailable" : "Save processing selection"}
        </Button>
      </fieldset>
      {error && <Alert variant="destructive">{error}</Alert>}
    </form>
  );
}
