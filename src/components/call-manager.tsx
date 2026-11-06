"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  callWorkspaceSchema,
  saveCallSchema,
  type CallRevision,
  type CallWorkspace,
} from "@/models/calls";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Card, CardContent, CardHeader } from "./ui/card";
import { CallTimeline } from "./call-timeline";

const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: callWorkspaceSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
function recoveryPath(code: string) {
  return code === "MFA_REQUIRED"
    ? "/security"
    : code === "UNAUTHENTICATED"
      ? "/sign-in"
      : null;
}
export function CallManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: CallWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [editing, setEditing] = useState<CallRevision | null>(null);
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  function reset() {
    setEditing(null);
    setGeneration((g) => g + 1);
  }
  return (
    <div className="space-y-8">
      {notice && <p role="status">{notice}</p>}
      <Card>
        <CardHeader>
          <h2 ref={editorTitle} tabIndex={-1} className="text-xl font-semibold">
            {editing ? "Update call log" : "Log a human call"}
          </h2>
        </CardHeader>
        <CardContent>
          <CallForm
            key={`${generation}-${editing?.id ?? "new"}`}
            businessId={businessId}
            state={state}
            editing={editing}
            onPending={setPending}
            onSaved={(next) => {
              setState(next);
              reset();
              setNotice(
                "Call log saved. This Opportunity is under human control with the recorded next action.",
              );
              router.refresh();
            }}
            onReload={(next) => {
              setState(next);
              reset();
              setNotice(
                "Saved calls reloaded. Review the timeline before editing.",
              );
            }}
          />
          {editing && (
            <Button
              disabled={pending}
              variant="outline"
              className="mt-4"
              onClick={reset}
            >
              Cancel edit
            </Button>
          )}
        </CardContent>
      </Card>
      <section className="space-y-4" aria-labelledby="call-timeline-title">
        <h2 id="call-timeline-title" className="text-xl font-semibold">
          Human call timeline
        </h2>
        <CallTimeline state={state} />
        {!!state.calls.length && (
          <div className="space-y-3">
            <h3 className="font-medium">Correct an existing call</h3>
            <p className="text-sm text-muted-foreground">
              Updates retain the original entry and every revision.
            </p>
            <ul className="space-y-2">
              {state.calls.map((call) => (
                <li key={call.id}>
                  <Button
                    variant="outline"
                    disabled={pending}
                    className="h-auto whitespace-normal text-left"
                    onClick={() => {
                      setEditing(call);
                      setGeneration((g) => g + 1);
                      setNotice("");
                      editorTitle.current?.focus();
                    }}
                  >
                    Edit call ·{" "}
                    {new Date(call.occurredAt).toLocaleString("en-GB", {
                      timeZone: "UTC",
                    })}{" "}
                    UTC · {call.outcome}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
function CallForm({
  businessId,
  state,
  editing,
  onSaved,
  onReload,
  onPending,
}: {
  businessId: string;
  state: CallWorkspace;
  editing: CallRevision | null;
  onSaved(state: CallWorkspace): void;
  onReload(state: CallWorkspace): void;
  onPending(pending: boolean): void;
}) {
  // Capture the loaded generation with the draft; background updates cannot silently rebase an edit.
  const [controlVersion] = useState(state.controlVersion);
  const [occurredAt, setOccurredAt] = useState(
    editing?.occurredAt.slice(0, -1) ?? "",
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [outcome, setOutcome] = useState(editing?.outcome ?? "");
  const [responsibleId, setResponsibleId] = useState(
    editing?.responsibleId ?? state.actorId,
  );
  const [nextAction, setNextAction] = useState(editing?.nextAction ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const busy = useRef(false);
  const endpoint = `/api/businesses/${businessId}/opportunities/${state.opportunityId}/calls`;
  const prefix = `call-${state.opportunityId}`;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    setRecovery(null);
    const payload = {
      callId: editing?.id ?? null,
      buyerId: state.buyerId,
      expectedVersion: editing?.version ?? 0,
      expectedControlVersion: controlVersion,
      occurredAt: occurredAt ? `${occurredAt}Z` : "",
      notes,
      outcome,
      responsibleId,
      nextAction,
    };
    const serialized = JSON.stringify(payload);
    if (command.current?.payload !== serialized)
      command.current = { payload: serialized, key: crypto.randomUUID() };
    const input = saveCallSchema.safeParse({
      ...payload,
      requestKey: command.current.key,
    });
    if (!input.success) {
      setError(
        "Enter when the call occurred in UTC, written notes, its outcome, a responsible person and next action.",
      );
      return;
    }
    busy.current = true;
    setPending(true);
    onPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.data),
      });
      const result = responseSchema.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The save could not be confirmed. Retry the same draft or reload saved calls to inspect history.",
        );
        return;
      }
      if (!response.ok || !result.data.success) {
        const code = result.data.success ? "" : result.data.code;
        setRecovery(recoveryPath(code));
        setError(
          code === "CONFLICT"
            ? "This call or Opportunity changed. Reload saved calls and review the current version before editing."
            : code === "INVALID_INPUT"
              ? "Check the call time is in the past, the responsible person is a current Business member and all written fields are complete."
              : code === "MFA_REQUIRED"
                ? "Verify your session in Security, then retry this draft."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again, then retry this draft."
                  : "The call could not be saved. Check your Business access and the buyer and purchasing need.",
        );
        return;
      }
      onSaved(result.data.data);
    } catch {
      setError(
        "The save could not be confirmed. Retry the same draft or reload saved calls to inspect history.",
      );
    } finally {
      busy.current = false;
      setPending(false);
      onPending(false);
    }
  }
  async function reload() {
    if (busy.current) return;
    setError("");
    setRecovery(null);
    busy.current = true;
    setPending(true);
    onPending(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = responseSchema.safeParse(await response.json());
      if (!response.ok || !result.success || !result.data.success) {
        const code =
          result.success && !result.data.success ? result.data.code : "";
        setRecovery(recoveryPath(code));
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your session in Security, then reload saved calls. Your draft is retained."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then reload saved calls. Your draft is retained."
              : "Saved calls could not be reloaded. Check your session and Business access; your draft is retained.",
        );
        return;
      }
      onReload(result.data.data);
    } catch {
      setError("Saved calls could not be reloaded. Your draft is retained.");
    } finally {
      busy.current = false;
      setPending(false);
      onPending(false);
    }
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Saving puts this Opportunity under your human control and pauses its
        automated messages. The call retains its own responsible person. Return
        control explicitly through Opportunity controls when ready.
      </p>
      {error && <Alert variant="destructive">{error}</Alert>}
      {recovery && (
        <Link
          href={recovery}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          {recovery === "/security" ? "Open Security" : "Open sign-in"} in a new
          tab; keep this draft
        </Link>
      )}
      <fieldset disabled={pending} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-time`}>Call occurred at (UTC)</Label>
          <Input
            id={`${prefix}-time`}
            type="datetime-local"
            step="0.001"
            required
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Use the actual occurrence time, including for a retrospective entry.
            Entry and update times are recorded separately.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-notes`}>Written notes</Label>
          <Textarea
            id={`${prefix}-notes`}
            required
            maxLength={8000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-outcome`}>Call outcome</Label>
          <Textarea
            id={`${prefix}-outcome`}
            required
            maxLength={1000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Describe what happened, including an unanswered attempt if relevant"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-responsible`}>
            Responsible person for this call
          </Label>
          <NativeSelect
            id={`${prefix}-responsible`}
            required
            value={responsibleId}
            onChange={(e) => setResponsibleId(e.target.value)}
          >
            {!state.members.some((m) => m.userId === responsibleId) && (
              <option value={responsibleId}>
                Choose a current Business member
              </option>
            )}
            {state.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-next`}>Next action</Label>
          <Textarea
            id={`${prefix}-next`}
            required
            maxLength={1000}
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
          />
        </div>
        <Button type="submit">
          {pending ? "Saving…" : editing ? "Save call update" : "Save call log"}
        </Button>
      </fieldset>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={reload}
      >
        Reload saved calls (discards this draft)
      </Button>
    </form>
  );
}
