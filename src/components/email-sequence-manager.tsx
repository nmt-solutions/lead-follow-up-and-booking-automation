"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import type { CampaignWorkspace } from "@/models/campaigns";
import {
  configureSequenceSchema,
  sequenceWorkspaceSchema,
  type SequenceWorkspace,
} from "@/models/email-sequences";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
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
import { Checkbox } from "./ui/checkbox";

const label = (value: string) => value.replaceAll("_", " ");
export function EmailSequenceManager({
  businessId,
  initialState,
  campaigns,
}: {
  businessId: string;
  initialState: SequenceWorkspace;
  campaigns: CampaignWorkspace;
}) {
  const [state, setState] = useState(initialState),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const ready = state.setupIssues.length === 0;
  async function request(command?: string, input?: unknown) {
    setPending(true);
    setError(false);
    setMessage(
      command ? "Saving sequence state…" : "Refreshing sequence state…",
    );
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/email-sequences`,
        command
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command, input }),
            }
          : { cache: "no-store" },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(raw),
          code = failure.success ? failure.data.code : "";
        setError(true);
        setMessage(
          code === "MFA_REQUIRED"
            ? "Verify your authenticator in Security, then retry. Keep this tab open to preserve your entries."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then retry. Keep this tab open."
              : code === "CONFLICT"
                ? "Refresh and review the approved version, eligibility, handoff history, ownership and allowance before retrying."
                : code === "CHANNEL_SETUP_REQUIRED"
                  ? "Sending and durable recovery need configured integrations. Ask the operator to complete setup."
                  : "The request could not be completed. Check your access and entries, then retry.",
        );
        return;
      }
      const result = z
        .object({ success: z.literal(true), data: sequenceWorkspaceSchema })
        .safeParse(raw);
      if (!result.success) throw new Error("Invalid sequence response");
      setState(result.data.data);
      setMessage(
        "Sequence state refreshed. Review the queue and evidence below.",
      );
    } catch {
      setError(true);
      setMessage(
        "The connection was interrupted. Refresh saved history before retrying.",
      );
    } finally {
      setPending(false);
    }
  }
  async function change(
    run: SequenceWorkspace["runs"][number],
    command: "pause" | "cancel" | "resume" | "recover",
  ) {
    const note = notes[run.id]?.trim();
    if (!note) {
      setError(true);
      setMessage("Enter a reason for the sequence action.");
      return;
    }
    await request("command", {
      runId: run.id,
      expectedVersion: run.version,
      command,
      note,
    });
  }
  async function configure(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const input = configureSequenceSchema.safeParse({
      expectedVersion: state.policy?.version ?? 0,
      policy: {
        enabled: data.get("enabled") === "on",
        adapterKey: state.provider.key,
        mode: state.provider.mode,
        periodStart: data.get("periodStart"),
        periodEnd: data.get("periodEnd"),
        maxProviderCalls: Number(data.get("maxProviderCalls")),
        minIntervalSeconds: Number(data.get("minIntervalSeconds")),
        note: data.get("note"),
      },
    });
    if (!input.success) {
      setError(true);
      setMessage(
        "Complete an explicit allowance period, positive attempt limit, spacing and review note. Use UTC timestamps ending in Z.",
      );
      return;
    }
    await request("configure", input.data);
  }
  return (
    <section className="space-y-5" aria-labelledby="sequence-heading">
      <h2 id="sequence-heading" className="text-xl font-semibold">
        Email sequence execution
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Sending and recovery setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Mail integration:{" "}
            <strong>
              {state.provider.mode === "unconfigured"
                ? "Not configured"
                : state.provider.mode === "fixture"
                  ? "Deterministic test adapter"
                  : "Production adapter"}
            </strong>
            . Durable queue:{" "}
            <strong>
              {state.queueReady ? "Configured" : "Not configured"}
            </strong>
            .
          </p>
          <p className="text-sm text-muted-foreground">
            Mailbox login, approval and preparing an email do not start a
            sequence. Production sending stays blocked until its adapter and
            deployed recovery worker are ready. No live mail is sent by this
            setup view.
          </p>
          {state.setupIssues.map((issue) => (
            <p key={issue} className="text-warning">
              Setup required: {label(issue)}. Review the integration and
              authorized allowance.
            </p>
          ))}
          <p>
            {state.policy
              ? `${state.usage.remaining} of ${state.policy.configuration.maxProviderCalls} attempt reservations remain for ${state.policy.configuration.periodStart} to ${state.policy.configuration.periodEnd}. Minimum spacing: ${state.policy.configuration.minIntervalSeconds} seconds.`
              : "No messaging allowance or pacing has been configured."}
          </p>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => request()}
          >
            Refresh sequence state
          </Button>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link
              href="/security"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Security (new tab)
            </Link>
            <Link
              href="/sign-in"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Sign in again (new tab)
            </Link>
          </div>
          {message && (
            <Alert variant={error ? "destructive" : "default"}>{message}</Alert>
          )}
          {state.canConfigure && (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">
                Operator allowance and pacing
              </summary>
              <form onSubmit={configure} className="space-y-4">
                <fieldset
                  disabled={pending || state.provider.mode === "unconfigured"}
                  className="space-y-4"
                >
                  <p className="text-sm text-muted-foreground">
                    A current email policy operator can record an explicitly
                    authorized limit. This does not purchase capacity or enable
                    a mail adapter.
                  </p>
                  {(
                    [
                      ["periodStart", "Allowance starts (UTC timestamp)"],
                      ["periodEnd", "Allowance ends (UTC timestamp)"],
                      [
                        "maxProviderCalls",
                        "Maximum reserved transport attempts",
                      ],
                      [
                        "minIntervalSeconds",
                        "Minimum seconds between attempts",
                      ],
                    ] as const
                  ).map(([name, title]) => (
                    <div className="space-y-2" key={name}>
                      <Label htmlFor={`sequence-${name}`}>{title}</Label>
                      <Input
                        id={`sequence-${name}`}
                        name={name}
                        required
                        type={
                          name === "periodStart" || name === "periodEnd"
                            ? "text"
                            : "number"
                        }
                        min={1}
                        step={1}
                        defaultValue={state.policy?.configuration[name] ?? ""}
                        placeholder={
                          name.startsWith("period")
                            ? "YYYY-MM-DDTHH:mm:ssZ"
                            : undefined
                        }
                      />
                    </div>
                  ))}
                  <div className="space-y-2">
                    <Label htmlFor="sequence-policy-note">
                      Authorization reference and reason
                    </Label>
                    <Textarea
                      id="sequence-policy-note"
                      name="note"
                      required
                      maxLength={2000}
                    />
                  </div>
                  <div className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      id="sequence-policy-enabled"
                      name="enabled"
                      defaultChecked={
                        state.policy?.configuration.enabled ?? false
                      }
                    />
                    <Label htmlFor="sequence-policy-enabled">
                      Enable this allowance
                    </Label>
                  </div>
                  <Button>Save authorized allowance</Button>
                </fieldset>
              </form>
            </details>
          )}
        </CardContent>
      </Card>
      {campaigns.campaigns
        .flatMap((c) => c.revisions.slice(-1))
        .filter(
          (r) =>
            r.decision?.decision === "approved" &&
            !state.runs.some((s) => s.revisionId === r.id),
        )
        .map((r) => (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle>
                {r.snapshot.name} · version {r.version}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                {r.snapshot.recipients.length} approved recipients ·{" "}
                {r.snapshot.maxAttempts} maximum transport attempts per
                recipient.
              </p>
              <p>
                {r.snapshot.timing
                  ? `${r.snapshot.timing.timeZone}, ${r.snapshot.timing.startTime}–${r.snapshot.timing.endTime}; weekdays ${r.snapshot.timing.weekdays.join(", ")}. Missed work moves to the next allowed window.`
                  : "This approval has no local send window. Revise and approve its timing to enable a sequence."}
              </p>
              {r.snapshot.stopConditions.additional.length > 0 && (
                <p className="text-warning">
                  Additional stop conditions require an executable policy review
                  before automation can start.
                </p>
              )}
              <Button
                disabled={
                  pending ||
                  !ready ||
                  !r.snapshot.timing ||
                  r.snapshot.stopConditions.additional.length > 0
                }
                onClick={() =>
                  request("start", {
                    revisionId: r.id,
                    payloadHash: r.payloadHash,
                  })
                }
              >
                Start approved sequence
              </Button>
            </CardContent>
          </Card>
        ))}
      {!state.runs.length && (
        <p className="text-muted-foreground">
          No sequence has been started. Review and approve a campaign with local
          timing, then explicitly start it when setup is ready.
        </p>
      )}
      {state.runs.map((run) => (
        <Card key={run.id}>
          <CardHeader>
            <CardTitle>{run.name}</CardTitle>
            <Badge>
              {run.state === "active" ? "Enabled" : label(run.state)}
            </Badge>
            <p>Progress: {label(run.progress)}</p>
            {run.reason && <p>{label(run.reason)}</p>}
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Attempt reservations include uncertain calls. Provider acceptance
              does not prove delivery, engagement or a sale. An unknown attempt
              is reconciled before any retry.
            </p>
            {run.recipients.map((r) => (
              <section
                key={r.contactId}
                className="space-y-3 rounded-xl border border-border p-4 wrap-anywhere"
              >
                <h3 className="font-semibold">{r.recipient}</h3>
                <Link
                  href={`/businesses/${businessId}/opportunities/${r.opportunityId}`}
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  Take over or hand back this Opportunity
                </Link>
                {r.actions.map((a) => (
                  <div key={a.id} className="space-y-2 rounded-lg bg-muted p-4">
                    <p className="font-medium">
                      {a.stepIndex === 0
                        ? "Initial message"
                        : `Follow-up ${a.stepIndex}`}{" "}
                      · {label(a.state)}
                    </p>
                    <p>
                      Queue: {label(a.queueState)} ·{" "}
                      {a.dueAt
                        ? `Earliest due ${a.dueAt}`
                        : "Waiting for previous message acceptance"}{" "}
                      · {a.attempts} reserved attempts
                    </p>
                    {a.reason && (
                      <p className="text-warning">
                        {label(a.reason)}. Review current checks; use recovery
                        for uncertain acceptance. Hand back human control
                        explicitly before resuming.
                      </p>
                    )}
                    {a.receipt && (
                      <p className="text-sm">
                        Provider accepted at {a.receipt.acceptedAt}. Message
                        reference: {a.receipt.messageRef}. Delivery is
                        unconfirmed.
                      </p>
                    )}
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 text-primary">
                        Inspect exact approved message
                      </summary>
                      <p className="font-medium">{a.subject}</p>
                      <p className="whitespace-pre-wrap">{a.body}</p>
                    </details>
                  </div>
                ))}
              </section>
            ))}
            <div className="space-y-2">
              <Label htmlFor={`sequence-note-${run.id}`}>
                Reason for the next action
              </Label>
              <Textarea
                id={`sequence-note-${run.id}`}
                value={notes[run.id] ?? ""}
                onChange={(e) =>
                  setNotes({ ...notes, [run.id]: e.target.value })
                }
                maxLength={2000}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                disabled={pending || run.state !== "active"}
                onClick={() => change(run, "pause")}
              >
                Pause sequence
              </Button>
              <Button
                variant="outline"
                disabled={
                  pending ||
                  run.state === "cancelled" ||
                  run.state === "completed" ||
                  !ready
                }
                onClick={() => change(run, "resume")}
              >
                Recheck and resume
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => change(run, "recover")}
              >
                Reconcile and recover queue
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    disabled={
                      pending ||
                      run.state === "cancelled" ||
                      run.state === "completed"
                    }
                  >
                    Cancel sequence
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <div className="space-y-3">
                    <AlertDialogTitle>Cancel this sequence?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Unsent steps stop permanently. Accepted or uncertain
                      attempts remain in history and may still need
                      reconciliation. A provider effect that has already started
                      cannot be undone.
                    </AlertDialogDescription>
                  </div>
                  <div className="flex flex-wrap justify-end gap-3">
                    <AlertDialogCancel>Keep sequence</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground"
                      onClick={() => change(run, "cancel")}
                    >
                      Cancel sequence
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">
                Action and delivery history
              </summary>
              <ol className="space-y-3">
                {run.history.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg bg-muted p-3 text-sm wrap-anywhere"
                  >
                    {e.at} · {label(e.kind)}
                    {e.reason ? ` · ${label(e.reason)}` : ""} · actor{" "}
                    {e.actorId}
                    {e.receipt
                      ? ` · provider message ${e.receipt.messageRef}`
                      : ""}
                    {e.source && (
                      <p className="mt-2">
                        {e.source.provider} observation {e.source.messageRef} at{" "}
                        {e.source.occurredAt}. A mailbox observation does not
                        prove delivery.
                      </p>
                    )}
                    {e.note && <p className="mt-2">{e.note}</p>}
                    {e.reply && (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-primary">
                          Read captured reply
                        </summary>
                        <p className="font-medium">{e.reply.subject}</p>
                        <p>
                          From {e.reply.sender} at {e.reply.occurredAt}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">
                          {e.reply.text}
                        </p>
                      </details>
                    )}
                    {e.reviewNeeded && (
                      <div className="mt-3 space-y-3">
                        <p>
                          Review the exact reply before classifying it. Any
                          reply stops reminders. Only a qualifying inquiry or
                          buying-interest reply enters the inquiry workflow.
                        </p>
                        {state.canClassify ? (
                          <div className="flex flex-wrap gap-3">
                            {(
                              [
                                {
                                  classification: "qualifying_inquiry",
                                  title:
                                    "Add qualifying inquiry to shared inbox",
                                },
                                {
                                  classification: "other_reply",
                                  title: "Mark as other reply",
                                },
                              ] as const
                            ).map((choice) => (
                              <Button
                                key={choice.classification}
                                variant="outline"
                                disabled={pending || !notes[run.id]?.trim()}
                                onClick={() =>
                                  request("classifyReply", {
                                    runId: run.id,
                                    observationId: e.id,
                                    classification: choice.classification,
                                    note: notes[run.id],
                                  })
                                }
                              >
                                {choice.title}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <p>
                            Ask an Owner or Admin to classify this captured
                            reply.
                          </p>
                        )}
                        <p>
                          Enter the review reason above. Classification records
                          a human decision and sends no message.
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </details>
            <Link
              href={`/businesses/${businessId}/inbox`}
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Review qualifying inquiries in the shared inbox
            </Link>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
