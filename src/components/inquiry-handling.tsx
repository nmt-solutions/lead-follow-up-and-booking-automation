"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { inquiryRunSchema, type InquiryWorkspace } from "@/models/inquiries";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";

const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: inquiryRunSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);

export function InquiryHandling({
  businessId,
  opportunityId,
  state,
}: {
  businessId: string;
  opportunityId: string;
  state: InquiryWorkspace;
}) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const pending = working !== null;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">(
    "success",
  );
  const [recovery, setRecovery] = useState<string | null>(null);
  async function delivery(runId: string, command: "dispatch" | "reconcile") {
    setWorking(`${runId}:${command}`);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/opportunities/${opportunityId}/inquiries/${runId}/${command}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const result = responseSchema.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The result could not be confirmed. Reload to inspect saved evidence before taking further action.",
        );
        return;
      }
      if (!response.ok || !result.data.success) {
        const code = result.data.success ? "" : result.data.code;
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : null,
        );
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your session in Security, then reload."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then reload."
              : code === "CHANNEL_SETUP_REQUIRED"
                ? "Sending requires a configured native channel. Review sender, WhatsApp and reply-capture setup."
                : "The action could not complete. Reload to review its saved state, ownership and setup.",
        );
        router.refresh();
        return;
      }
      const action = result.data.data.action;
      setNoticeTone(action?.state === "dispatched" ? "success" : "warning");
      setNotice(
        action?.email?.sent
          ? "Exact Sent-folder evidence saved. Delivery remains unconfirmed."
          : action?.email?.result?.status === "accepted"
            ? "Gmail accepted the prepared reply. Delivery remains unconfirmed."
            : action?.state === "dispatched" &&
                action.reason?.startsWith("whatsapp_")
              ? "Meta accepted the saved WhatsApp reply. Review WhatsApp message evidence for Sent, delivery and read status."
              : action?.state === "committed"
                ? "Acceptance remains unknown. Review native mailbox or WhatsApp provider evidence. This action will not resend."
                : action?.state === "cancelled"
                  ? `Sending stopped: ${action.reason?.replaceAll("_", " ") ?? "current authorization failed"}. Review setup and current inquiry context.`
                  : "No new Sent evidence was confirmed. Synchronize the selected mailbox and check again.",
      );
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Reload to inspect the saved action; do not send a duplicate manually.",
      );
    } finally {
      setWorking(null);
    }
  }
  async function process() {
    if (!state.latestMessageId) return;
    setWorking("evaluate");
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/opportunities/${opportunityId}/inquiries`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId: state.latestMessageId }),
        },
      );
      const result = responseSchema.safeParse(await response.json());
      if (!result.success) {
        setError("The result could not be confirmed. Reload before retrying.");
        return;
      }
      if (!response.ok || !result.data.success) {
        const code = result.data.success ? "" : result.data.code;
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : null,
        );
        setError(
          code === "CONFLICT"
            ? "The inquiry or its ownership changed. Reload and review current context."
            : code === "MFA_REQUIRED"
              ? "Verify your session in Security, then retry."
              : code === "UNAUTHENTICATED"
                ? "Sign in again, then retry."
                : "The inquiry could not be evaluated. Check your current access and setup.",
        );
        return;
      }
      setNoticeTone(
        result.data.data.status === "ready" ? "success" : "warning",
      );
      setNotice(
        result.data.data.status === "ready"
          ? "Grounded response saved. Delivery is still pending."
          : "Evaluation saved. Review its status and next action below.",
      );
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Reload to inspect persisted work before retrying.",
      );
    } finally {
      setWorking(null);
    }
  }
  return (
    <section
      className="space-y-4 border-t pt-5"
      aria-labelledby={`inquiry-${opportunityId}`}
    >
      <h3 id={`inquiry-${opportunityId}`} className="font-semibold">
        Answer and qualify
      </h3>
      <p className="text-sm text-muted-foreground">{state.nextAction}</p>
      <Button
        type="button"
        disabled={pending || !state.canProcess || !state.latestMessageId}
        onClick={process}
        aria-busy={working === "evaluate"}
      >
        {working === "evaluate"
          ? "Evaluating inquiry…"
          : "Evaluate latest inquiry"}
      </Button>
      {notice && (
        <p
          role="status"
          className={
            noticeTone === "warning"
              ? "text-sm text-warning"
              : "text-sm text-success"
          }
        >
          {notice}
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          {error}
          {recovery && (
            <>
              {" "}
              <Link
                href={recovery}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                Open {recovery === "/security" ? "Security" : "sign in"} (new
                tab)
              </Link>
            </>
          )}
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        Review the exact response and recipient before sending through the
        selected native channel. Sending requires current authority, paid
        automation, sender, reply visibility and recipient checks. WhatsApp
        additionally requires permission and an open customer service window or
        an exact matching approved template.
      </p>
      <div className="flex flex-wrap gap-x-4 text-sm">
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/whatsapp/sending`}
        >
          Review WhatsApp permission and message evidence
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/mailboxes`}
        >
          Synchronize selected mailbox
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/senders`}
        >
          Review sender and reply setup
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/knowledge`}
        >
          Review Business knowledge
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/ai`}
        >
          Review AI setup with the operator
        </Link>
      </div>
      {!state.runs.length ? (
        <p className="text-sm text-muted-foreground">
          No inquiry evaluation yet. Take over to assign an owner, then
          explicitly hand back when it is ready for automation.
        </p>
      ) : (
        <ol className="space-y-5">
          {[...state.runs].reverse().map((run) => (
            <li key={run.id} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap gap-2">
                <Badge
                  className={
                    run.status === "handoff" ? "text-warning" : undefined
                  }
                >
                  {run.status === "ready"
                    ? "Response prepared"
                    : run.status.replaceAll("_", " ")}
                </Badge>
                <Badge>{run.qualification.replaceAll("_", " ")}</Badge>
              </div>
              <p className="text-sm">
                Goal:{" "}
                {run.goal === "rfq"
                  ? "Quotation request"
                  : run.goal === "booking"
                    ? "Booking"
                    : "Setup required"}
                . {run.reason.replaceAll("_", " ")}
              </p>
              {run.body && <p className="whitespace-pre-wrap">{run.body}</p>}
              {run.body && (
                <dl className="space-y-1 text-sm wrap-anywhere">
                  <div>
                    <dt className="inline font-medium">To: </dt>
                    <dd className="inline">{run.reply.recipient}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Subject: </dt>
                    <dd className="inline">{run.reply.subject}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">From: </dt>
                    <dd className="inline">
                      {run.reply.fromAddress ?? "Sender setup required"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Reply to: </dt>
                    <dd className="inline">
                      {run.reply.replyTo ?? "Reply setup required"}
                    </dd>
                  </div>
                </dl>
              )}
              {run.ownerId && (
                <p className="text-sm">
                  Accountable person: {run.ownerName ?? run.ownerId}. Escalation
                  contact: {run.escalationEmail}. No external notification sent.
                </p>
              )}
              <p className="text-sm font-medium">
                Next action: {run.nextAction}
              </p>
              <p className="text-sm text-muted-foreground">
                Action:{" "}
                {run.action
                  ? `${run.action.state}${run.action.reason ? ` (${run.action.reason.replaceAll("_", " ")})` : ""}`
                  : "No outbound action"}
                .{" "}
                {run.action?.state === "committed" &&
                  "Acceptance is unknown. This action will not resend. Synchronize the selected mailbox and check Sent evidence before any manual action."}
              </p>
              {run.action?.email && (
                <div className="space-y-2 text-sm wrap-anywhere">
                  <p>
                    Provider acceptance:{" "}
                    {run.action.email.result?.status === "accepted"
                      ? run.action.email.result.receipt.evidence ===
                        "sent_folder"
                        ? "Reconciled from exact Sent-folder evidence"
                        : "Confirmed by Gmail response"
                      : run.action.email.result?.status === "not_accepted"
                        ? `Not accepted (${run.action.email.result.reason.replaceAll("_", " ")})`
                        : run.action.state === "cancelled"
                          ? "Not attempted; current checks blocked transport"
                          : "Unknown"}
                    .
                  </p>
                  <p>
                    Sent-folder observation:{" "}
                    {run.action.email.sent
                      ? `Observed message ${run.action.email.sent.messageRef} in thread ${run.action.email.sent.threadRef}`
                      : "Not confirmed"}
                    .
                  </p>
                  <p>
                    Delivery: unconfirmed. Acceptance and Sent-folder
                    observations do not establish delivery.
                  </p>
                  {run.action.email.result?.status === "accepted" && (
                    <p>
                      Gmail message:{" "}
                      {run.action.email.result.receipt.messageRef} · Thread:{" "}
                      {run.action.email.result.receipt.threadRef}
                    </p>
                  )}
                </div>
              )}
              {run.action?.state === "pending" && run.status === "ready" && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    disabled={
                      pending || !state.canProcess || !run.reply.nativeGmail
                    }
                    aria-busy={working === `${run.id}:dispatch`}
                    onClick={() => delivery(run.id, "dispatch")}
                  >
                    {working === `${run.id}:dispatch`
                      ? "Sending prepared reply…"
                      : "Send prepared Gmail reply"}
                  </Button>
                  {!run.reply.nativeGmail && (
                    <p className="text-sm text-muted-foreground">
                      A current native Gmail sender and reply route are
                      required. Review sender and mailbox setup, then reload.
                    </p>
                  )}
                </div>
              )}
              {run.action?.email &&
                ["committed", "dispatched"].includes(run.action.state) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    aria-busy={working === `${run.id}:reconcile`}
                    onClick={() => delivery(run.id, "reconcile")}
                  >
                    {working === `${run.id}:reconcile`
                      ? "Checking Sent evidence…"
                      : "Check Sent evidence"}
                  </Button>
                )}
              {run.facts.length > 0 && (
                <dl className="space-y-2">
                  {run.facts.map((fact) => (
                    <div key={fact.key}>
                      <dt className="text-sm font-medium">{fact.key}</dt>
                      <dd className="text-sm">
                        {fact.value}
                        <blockquote className="mt-1 border-l-2 pl-3 text-muted-foreground">
                          {fact.quote}
                        </blockquote>
                        <span className="text-xs text-muted-foreground">
                          Source message: {fact.messageId}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {run.missing.length > 0 && (
                <p className="text-sm">
                  Missing requirements: {run.missing.join(", ")}
                </p>
              )}
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-3">
                  Grounding and evaluation context
                </summary>
                <p>
                  Knowledge version: {run.knowledgeVersion ?? "Unavailable"} ·
                  Profile: {run.profileId ?? "Unavailable"}
                </p>
                <p>
                  Inbound message: {run.messageId} · Evaluated by: {run.actorId}
                </p>
                <time dateTime={run.at}>
                  {new Date(run.at).toLocaleString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </time>
                <ul className="mt-3 space-y-2">
                  {run.citations.map((citation) => (
                    <li key={`${citation.kind}-${citation.index}`}>
                      {citation.kind} {citation.index + 1}: {citation.text}
                    </li>
                  ))}
                </ul>
                {run.proposal && (
                  <>
                    <p className="mt-3 font-medium">
                      Model proposal for review
                    </p>
                    <pre className="whitespace-pre-wrap wrap-anywhere">
                      {JSON.stringify(run.proposal, null, 2)}
                    </pre>
                  </>
                )}
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
