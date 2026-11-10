"use client";
import { Field, FieldGroup } from "./ui/field";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  controlChangeSchema,
  manualReplySchema,
  type OpportunityControl as Control,
} from "@/models/opportunity-control";
import type { InboxConversation } from "@/models/inbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const envelope = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
function useControlCommand() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<"/security" | "/sign-in" | null>(
    null,
  );
  async function run(
    path: string,
    input: unknown,
    schema: z.ZodType,
    message: string,
  ) {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = envelope.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The response could not be read. Reload before retrying; your entries are still here.",
        );
        return false;
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
            ? "The Opportunity or source activity changed. Reload and review it. Take over first if its owner is unassigned or no longer a member."
            : code === "MFA_REQUIRED"
              ? "Verify your session in Security, then retry. Your entries are still here."
              : code === "UNAUTHENTICATED"
                ? "Sign in again in a new tab, then retry. Your entries are still here."
                : "The change could not be saved. Check your current access, connection and source references, then retry.",
        );
        return false;
      }
      if (!schema.safeParse(result.data.data).success) {
        setError("The result could not be confirmed. Reload before retrying.");
        return false;
      }
      setNotice(message);
      router.refresh();
      return true;
    } catch {
      setError(
        "The request could not be confirmed. Reload before retrying; your entries are still here.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, setError, notice, recovery, run };
}
function Feedback({
  status,
}: {
  status: ReturnType<typeof useControlCommand>;
}) {
  return (
    <>
      {status.notice && (
        <p role="status" className="text-sm text-success">
          {status.notice}
        </p>
      )}
      {status.error && (
        <Alert variant="destructive">
          {status.error}
          {status.recovery && (
            <>
              {" "}
              <Link
                href={status.recovery}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                {status.recovery === "/security"
                  ? "Open Security"
                  : "Open sign in"}{" "}
                (new tab)
              </Link>
            </>
          )}
        </Alert>
      )}
    </>
  );
}
export function OpportunityControl({
  businessId,
  control,
}: {
  businessId: string;
  control: Control;
}) {
  const status = useControlCommand();
  const [command, setCommand] = useState("takeover");
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const prefix = `control-${control.id}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = controlChangeSchema.safeParse({
      command,
      expectedVersion: control.version,
      reason: form.get("reason"),
      nextAction: form.get("nextAction"),
    });
    if (!parsed.success) {
      status.setError(
        "Choose an action and enter a reason and next action (up to 1,000 characters each).",
      );
      return;
    }
    if (
      await status.run(
        `/api/businesses/${businessId}/opportunities/${control.id}/control`,
        parsed.data,
        z.object({ saved: z.literal(true) }),
        command === "handback"
          ? "Handed back for fresh policy evaluation. Previous queued actions remain stopped."
          : "Opportunity control saved across its channels.",
      )
    )
      setSavedVersion(control.version);
  }
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <p className="text-sm">
        Assigned owner: {control.ownerName ?? "Unassigned"}
      </p>
      <Badge>
        {control.state === "human"
          ? "Automation paused across channels"
          : "Returned to automation - policy checks required"}
      </Badge>
      <p className="text-sm text-muted-foreground">
        {control.state === "human"
          ? "Only an explicit handback allows automation to evaluate new actions. New messages and elapsed time do not resume it."
          : "Each new action still needs current authority, owner, association and channel checks. Handback grants no sending or commercial authority."}
      </p>
      <form onSubmit={save} className="flex flex-col gap-4">
        <FieldGroup className="gap-4">
          <Field className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-command`}>Control action</Label>
            <NativeSelect
              id={`${prefix}-command`}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            >
              <option value="takeover">Take over and assign to me</option>
              {control.state === "human" && (
                <option value="update">Update handoff details</option>
              )}
              {control.ownerId && (
                <option value="handback">
                  Explicitly hand back to automation
                </option>
              )}
            </NativeSelect>
          </Field>
          <Field className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-reason`}>
              {command === "handback"
                ? "Handback reason"
                : "Takeover or handoff reason"}
            </Label>
            <Textarea
              id={`${prefix}-reason`}
              name="reason"
              required
              maxLength={1000}
            />
          </Field>
          <Field className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-next`}>Next action</Label>
            <Textarea
              id={`${prefix}-next`}
              name="nextAction"
              required
              maxLength={1000}
              defaultValue={control.nextAction}
            />
          </Field>
          <Button disabled={status.pending || savedVersion === control.version}>
            {status.pending
              ? "Saving..."
              : command === "handback"
                ? "Hand back to automation"
                : command === "update"
                  ? "Save handoff details"
                  : "Take over Opportunity"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Reload current state
          </Button>
          <Feedback status={status} />
        </FieldGroup>
      </form>
      <p className="text-sm text-muted-foreground">
        Queued actions are cancelled on a control change. A send already started
        may finish; its effects cannot be undone here.
      </p>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Control history and queued actions
        </summary>
        {control.history.length ? (
          <ol className="flex flex-col gap-3">
            {control.history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1">
                <p className="font-medium">
                  {entry.command.replaceAll("_", " ")}: {entry.after.reason}
                </p>
                <p>
                  Owner: {entry.after.ownerId ?? "Unassigned"} - Next:{" "}
                  {entry.after.nextAction}
                </p>
                <p className="text-muted-foreground">
                  By {entry.actorId} -{" "}
                  <time dateTime={entry.at}>{entry.at}</time> -{" "}
                  {entry.before.state} to {entry.after.state}
                </p>
                {entry.sourceRef && <p>Source event: {entry.sourceRef}</p>}
                {entry.policy && (
                  <div>
                    <p>
                      Current policy reviewed: revision {entry.policy.version}.
                      Active import connections:{" "}
                      {entry.policy.activeConnections}.
                    </p>
                    <ul>
                      {Object.entries(entry.policy.decisions).map(
                        ([action, reason]) => (
                          <li key={action}>
                            {action}: {reason.replaceAll("_", " ")}
                          </li>
                        ),
                      )}
                    </ul>
                    <p>
                      Action details and channel readiness must be checked
                      before execution.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>No control changes recorded. Initial review remains paused.</p>
        )}
        {control.actions.length ? (
          <ul className="flex flex-col mt-4 gap-2">
            {control.actions.map((action) => (
              <li key={action.id}>
                {action.state === "committed"
                  ? "Dispatch unconfirmed; no automatic retry"
                  : action.state}{" "}
                - {action.reason?.replaceAll("_", " ") ?? "No block recorded"} -
                Due <time dateTime={action.dueAt}>{action.dueAt}</time> -{" "}
                {action.id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-muted-foreground">
            No queued actions. Live automated response sending is not connected.
          </p>
        )}
      </details>
    </div>
  );
}

export function ManualReplyRecord({
  businessId,
  conversation,
}: {
  businessId: string;
  conversation: InboxConversation;
}) {
  const status = useControlCommand();
  const [recorded, setRecorded] = useState(false);
  const supported =
    conversation.connection.active &&
    conversation.connection.manualRepliesObservable;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = manualReplySchema.safeParse({
      eventId: form.get("eventId"),
      messageRef: form.get("messageRef"),
      conversationRef: conversation.providerRef,
      replyToMessageRef: form.get("replyToMessageRef"),
      occurredAt: form.get("occurredAt"),
      reason: form.get("reason"),
      nextAction: form.get("nextAction"),
    });
    if (!parsed.success) {
      status.setError(
        "Enter the source event and sent-message references, observed UTC time, reason and next action.",
      );
      return;
    }
    if (
      await status.run(
        `/api/businesses/${businessId}/inbox/connections/${conversation.connection.id}/manual-replies`,
        parsed.data,
        z.object({
          status: z.enum(["captured", "duplicate"]),
          opportunityId: z.uuid(),
        }),
        "Manual reply processed. New activity pauses its Opportunity; a replay leaves current control unchanged.",
      )
    )
      setRecorded(true);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a supported manual reply</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          This records activity you already performed; it does not send a
          message. Authenticated normalized records are supported for selected
          imports only. Gmail, Outlook and WhatsApp app activity is not detected
          live here. Use Take over for unobservable activity.
        </p>
        {supported ? (
          <form onSubmit={save} className="flex flex-col gap-4">
            <FieldGroup className="gap-4">
              <Field className="flex flex-col gap-2">
                <Label htmlFor="manual-reply-source">
                  Received message being answered
                </Label>
                <NativeSelect
                  id="manual-reply-source"
                  name="replyToMessageRef"
                  required
                >
                  {conversation.messages.map((message, index) => (
                    <option key={message.id} value={message.messageRef}>
                      Message {index + 1}: {message.subject} -{" "}
                      {message.opportunityId
                        ? "Associated need"
                        : "Needs association review"}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {[
                ["eventId", "Source event reference"],
                ["messageRef", "Sent-message reference"],
                ["occurredAt", "Observed at (UTC, e.g. 2026-11-06T09:00:00Z)"],
              ].map(([name, label]) => (
                <Field key={name} className="flex flex-col gap-2">
                  <Label htmlFor={`manual-${name}`}>{label}</Label>
                  <Input
                    id={`manual-${name}`}
                    name={name}
                    required
                    maxLength={256}
                  />
                </Field>
              ))}
              <Field className="flex flex-col gap-2">
                <Label htmlFor="manual-reason">Handoff reason</Label>
                <Textarea
                  id="manual-reason"
                  name="reason"
                  required
                  maxLength={1000}
                />
              </Field>
              <Field className="flex flex-col gap-2">
                <Label htmlFor="manual-next">Next action</Label>
                <Textarea
                  id="manual-next"
                  name="nextAction"
                  required
                  maxLength={1000}
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                The received message&apos;s current association determines the
                Opportunity. Your signed-in identity becomes its owner.
                Unassociated messages require association review first.
              </p>
              <Button disabled={status.pending || recorded}>
                {status.pending
                  ? "Recording..."
                  : "Record manual reply and pause"}
              </Button>
              {recorded && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRecorded(false)}
                >
                  Record another reply
                </Button>
              )}
              <Feedback status={status} />
            </FieldGroup>
          </form>
        ) : (
          <p>
            {!conversation.connection.active
              ? "This connection has been revoked. "
              : conversation.connection.mode === "mailbox"
                ? "Use mailbox synchronization to observe supported manual replies within the selected scope. "
                : "This import does not support manual-reply records. "}
            Take over the Opportunity above to pause automation yourself.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
