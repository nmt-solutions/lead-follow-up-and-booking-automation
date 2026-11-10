"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import type { CampaignWorkspace } from "@/models/campaigns";
import {
  emailHandoffSchema,
  handoffWorkspaceSchema,
  type EmailHandoff,
} from "@/models/email-handoffs";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";

const evidenceLabels = {
  prepared: "Prepared",
  user_marked_sent: "User-marked sent",
  sent_folder_observed: "Sent-folder observed",
  reply_observed: "Reply observed",
};
const failureSchema = z.object({ success: z.literal(false), code: z.string() });
class HandoffUiError extends Error {}
function failureMessage(code: string) {
  if (code === "UNAUTHENTICATED")
    return "Sign in again, then refresh handoffs.";
  if (code === "MFA_REQUIRED")
    return "Verify your authenticator in Security, then try again.";
  if (code === "FORBIDDEN")
    return "Your current role cannot perform this action. Ask a Business Owner or Admin to review mailbox evidence.";
  if (code === "NOT_FOUND")
    return "This handoff or selected mailbox record is unavailable in this Business. Refresh the history.";
  if (code === "CONFLICT")
    return "Current approval, authority, contact evidence, eligibility, sender or mailbox visibility needs review. Refresh and check the campaign and mailbox settings before trying again.";
  if (code === "INVALID_INPUT")
    return "Check the selected campaign and message, then try again.";
  return "The handoff could not be loaded. Refresh or try again shortly.";
}
async function responseData<T>(response: Response, schema: z.ZodType<T>) {
  const value: unknown = await response.json();
  const failure = failureSchema.safeParse(value);
  if (failure.success)
    throw new HandoffUiError(failureMessage(failure.data.code));
  const p = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(value);
  if (!response.ok || !p.success)
    throw new HandoffUiError(
      "The handoff response could not be validated. Refresh and try again.",
    );
  return p.data.data;
}

/** Source/intended-flow review uses the existing semantic theme and shadcn controls. UI acceptance is user-owned. */
export function EmailHandoffManager({
  businessId,
  campaigns,
}: {
  businessId: string;
  campaigns: CampaignWorkspace;
}) {
  const base = `/api/businesses/${businessId}/email-handoffs`;
  const [workspace, setWorkspace] = useState<z.infer<
    typeof handoffWorkspaceSchema
  > | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch(base, { cache: "no-store", signal: controller.signal })
      .then((r) => responseData(r, handoffWorkspaceSchema))
      .then(setWorkspace)
      .catch(() => {
        if (!controller.signal.aborted)
          setFeedback({
            error: true,
            text: "Handoff history could not be loaded. Refresh handoffs to try again.",
          });
      });
    return () => controller.abort();
  }, [base]);
  async function refresh() {
    setPending(true);
    setFeedback(null);
    try {
      setWorkspace(
        await responseData(
          await fetch(base, { cache: "no-store" }),
          handoffWorkspaceSchema,
        ),
      );
    } catch (error: unknown) {
      setFeedback({
        error: true,
        text:
          error instanceof HandoffUiError
            ? error.message
            : "Refresh failed. Try again shortly.",
      });
    } finally {
      setPending(false);
    }
  }
  async function command(
    command: "prepare" | "use" | "markSent" | "bindSent",
    input: unknown,
    success: string,
    effect?: (row: EmailHandoff) => Promise<void> | void,
  ) {
    setPending(true);
    setFeedback(null);
    try {
      const row = await responseData(
        await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, input }),
        }),
        emailHandoffSchema,
      );
      setWorkspace((current) =>
        current
          ? {
              ...current,
              handoffs: [
                ...current.handoffs.filter((h) => h.id !== row.id),
                row,
              ],
            }
          : null,
      );
      await effect?.(row);
      setFeedback({ error: false, text: success });
    } catch (error: unknown) {
      setFeedback({
        error: true,
        text:
          error instanceof HandoffUiError
            ? error.message
            : "This action could not be completed. Try again shortly.",
      });
    } finally {
      setPending(false);
    }
  }
  const available = campaigns.campaigns
    .flatMap((c) => c.revisions.slice(-1))
    .filter((r) => r.decision?.decision === "approved");
  return (
    <section aria-labelledby="email-handoffs" className="flex flex-col gap-5">
      <h2 id="email-handoffs" className="text-xl font-semibold">
        Use your own email client
      </h2>
      <p className="text-sm text-muted-foreground">
        Prepare an approved initial email, then review and send it yourself.
        This app does not send it or schedule follow-ups.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Before opening your client</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            The standard mailto link uses your device’s configured email
            handler. Select the approved From account yourself and review the
            recipient, subject and body. The link cannot force an account,
            attach files universally or prove you pressed Send.
          </p>
          <p>
            Your client may change or truncate a draft, and you can edit it
            outside this app. Those changes do not create a new approved
            campaign. Copy the fields if the handler does not preserve them. No
            downloadable draft or provider-specific compose format is offered.
          </p>
          <p>
            Prepared and User-marked sent do not establish a mailbox observation
            or delivery. Sent-folder observed is not proof of delivery. A Reply
            observed can be an automatic acknowledgement; it does not establish
            buying interest or a sale.
          </p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={pending} onClick={refresh}>
          Refresh handoffs and mailbox evidence
        </Button>
        <Link
          href={`/businesses/${businessId}/mailboxes`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Mailbox processing
        </Link>
        <Link
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security
        </Link>
      </div>
      {pending && (
        <p role="status">Checking current access and recording the action…</p>
      )}
      {feedback && (
        <Alert variant={feedback.error ? "destructive" : "success"}>
          {feedback.text}
        </Alert>
      )}
      {!workspace && !feedback && <p role="status">Loading handoff history…</p>}
      {workspace && !available.length && (
        <p className="text-sm text-muted-foreground">
          Save and obtain Owner approval for a campaign above before preparing
          its initial emails.
        </p>
      )}
      {workspace &&
        available.map((r) => (
          <div key={r.id} className="flex flex-col gap-3">
            <h3 className="font-medium">
              {r.snapshot.name} · version {r.version}
            </h3>
            {r.snapshot.recipients.map((recipient) => {
              const exists = workspace.handoffs.some(
                (h) =>
                  h.revisionId === r.id && h.contactId === recipient.contactId,
              );
              return (
                <div
                  key={recipient.contactId}
                  className="flex flex-wrap items-center gap-3 text-sm"
                >
                  <span className="wrap-anywhere">{recipient.address}</span>
                  {!exists && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        command(
                          "prepare",
                          {
                            revisionId: r.id,
                            payloadHash: r.payloadHash,
                            recipient: {
                              prospectId: recipient.prospectId,
                              contactId: recipient.contactId,
                              address: recipient.address,
                            },
                            stepIndex: 0,
                          },
                          "Prepared. No email has been sent by this app.",
                        )
                      }
                    >
                      Prepare approved initial email
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      {workspace?.handoffs.map((row) => (
        <Card key={row.id}>
          <CardHeader>
            <CardTitle className="wrap-anywhere">
              Email to {row.recipient}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <p className="text-sm">
              Approved From:{" "}
              <strong className="wrap-anywhere">{row.fromAddress}</strong>.
              Select this account in your client yourself.
            </p>
            {(["recipient", "subject", "body"] as const).map((field) => (
              <div key={field} className="flex flex-col gap-2">
                <Label htmlFor={`${row.id}-${field}`}>
                  {field === "recipient"
                    ? "Recipient"
                    : field === "subject"
                      ? "Subject"
                      : "Body"}
                </Label>
                {field === "body" ? (
                  <Textarea
                    id={`${row.id}-${field}`}
                    readOnly
                    value={row[field]}
                    rows={6}
                  />
                ) : (
                  <Input
                    id={`${row.id}-${field}`}
                    readOnly
                    value={row[field]}
                  />
                )}
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    command(
                      "use",
                      { handoffId: row.id, operation: `copy_${field}` },
                      `${field === "body" ? "Body" : field === "subject" ? "Subject" : "Recipient"} copied. This does not establish sending.`,
                      async (current) => {
                        try {
                          await navigator.clipboard.writeText(current[field]);
                        } catch {
                          throw new HandoffUiError(
                            "Clipboard access is unavailable. Select the displayed field and copy it manually.",
                          );
                        }
                      },
                    )
                  }
                >
                  Copy {field}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pending}
                onClick={() =>
                  command(
                    "use",
                    { handoffId: row.id, operation: "open" },
                    "Compose link requested. Review the draft in your configured handler; sending remains unconfirmed.",
                    (current) => {
                      window.location.assign(current.mailto);
                    },
                  )
                }
              >
                Open in email client
              </Button>
              <Button
                variant="outline"
                disabled={
                  pending ||
                  row.evidence.some((e) => e.kind === "user_marked_sent")
                }
                onClick={() =>
                  command(
                    "markSent",
                    { handoffId: row.id },
                    "Recorded as User-marked sent. This is your assertion, not provider confirmation or delivery evidence.",
                  )
                }
              >
                I sent this email · record my assertion
              </Button>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <h4 className="font-medium">Evidence history</h4>
              <ol className="flex flex-col gap-3">
                {row.evidence.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1">
                    <Badge>{evidenceLabels[e.kind]}</Badge>
                    <p>
                      Recorded {e.at} ·{" "}
                      {e.actorId === campaigns.actorId
                        ? "by you"
                        : "by a Business member"}
                    </p>
                    {e.source && (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-primary">
                          Inspect synchronized source
                        </summary>
                        <p className="wrap-anywhere">
                          {e.source.provider} · message {e.source.messageRef} ·
                          thread {e.source.threadRef}
                          <br />
                          Message-ID: {e.source.internetMessageId}
                          <br />
                          In-Reply-To: {e.source.inReplyTo ?? "None"}
                          <br />
                          Occurred {e.source.occurredAt} · mailbox{" "}
                          {e.source.mailboxId} · policy version{" "}
                          {e.source.policyVersion}
                        </p>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
              <p>
                Current reply visibility: <strong>{row.visibility}</strong>.{" "}
                {row.visibility === "unavailable"
                  ? "No functioning authorized native synchronization is available here. Manual, forwarded and BCC records cannot establish full sync."
                  : row.visibility === "limited"
                    ? "Only selected, synchronized messages are observable. Scope or association review prevents a promise of complete reply capture."
                    : "Current selected mailbox synchronization is available; it must remain healthy for future automation."}{" "}
                Historical observations remain factual when current access is
                lost.
              </p>
              <p>
                Follow-ups require their own applicable immutable approval and
                current authority, recipient eligibility, sender, reply
                visibility and opportunity checks. Preparation or a user
                assertion grants no follow-up permission.
              </p>
            </div>
            {!row.evidence.some((e) => e.kind === "sent_folder_observed") && (
              <div className="flex flex-col gap-3 border-t border-border pt-4 text-sm">
                <h4 className="font-medium">
                  Link a reviewed Sent-folder observation
                </h4>
                <p>
                  There is no automatic match from an equal subject or
                  recipient. A Business Owner or Admin must explicitly select
                  the exact synchronized native message after reviewing its
                  content and provider references. Edited or ambiguous records
                  remain unlinked.
                </p>
                {!workspace.canBind ? (
                  <p>
                    Ask a Business Owner or Admin to review native mailbox
                    evidence.
                  </p>
                ) : !row.candidates.length ? (
                  <p>
                    No exact authorized Sent-folder candidate is available.
                    Check mailbox scope, sync status and the actual From
                    account/content. A manual assertion remains narrower
                    evidence.
                  </p>
                ) : (
                  row.candidates.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col gap-3 rounded-xl border border-border p-4"
                    >
                      <p className="wrap-anywhere">
                        {c.source.provider} · message {c.source.messageRef} ·
                        thread {c.source.threadRef}
                        <br />
                        Message-ID: {c.source.internetMessageId} ·{" "}
                        {c.source.occurredAt}
                      </p>
                      <p className="font-medium wrap-anywhere">{c.subject}</p>
                      <p className="whitespace-pre-wrap wrap-anywhere">
                        {c.body}
                      </p>
                      <label className="flex min-h-11 items-start gap-3">
                        <Checkbox
                          className="mt-1"
                          checked={confirmed[c.id] ?? false}
                          onCheckedChange={(checked) =>
                            setConfirmed((current) => ({
                              ...current,
                              [c.id]: checked === true,
                            }))
                          }
                        />
                        <span>
                          I reviewed this exact native message and confirm it
                          belongs to this prepared email.
                        </span>
                      </label>
                      <Button
                        variant="outline"
                        disabled={pending || !confirmed[c.id]}
                        onClick={() =>
                          command(
                            "bindSent",
                            {
                              handoffId: row.id,
                              observationId: c.id,
                              confirmExactMessage: true,
                            },
                            "Sent-folder observation linked. This is not delivery confirmation; exact synchronized replies are recorded separately.",
                          )
                        }
                      >
                        Link this Sent-folder message
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
