"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  saveScheduleSchema,
  scheduleCommandSchema,
  type SavedScheduleView,
} from "@/models/discovery-schedules";
import type { DiscoveryWorkspace } from "@/models/discovery";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";

const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const failures = {
  worker_lost:
    "The scheduled worker stopped before dispatch. Review setup, then resume this schedule.",
  queue_unavailable:
    "Queue delivery failed. The saved dispatch is pending recovery.",
  authorization_revoked:
    "Authorizer access or MFA expired. Verify in Security, then resume to reauthorize.",
  configuration_changed:
    "Reach, allowance, targeting or supported capabilities changed. Edit and approve the current brief before resuming.",
  setup_required:
    "Discovery provider or worker setup is incomplete. Contact the service operator before resuming.",
  overlap_skipped:
    "This occurrence was skipped because an earlier run is still queued or running.",
  missed_skipped:
    "An expired occurrence was skipped. The next local occurrence remains scheduled.",
};
const commandResponse = z.object({
  success: z.literal(true),
  data: z.object({ id: z.uuid(), revision: z.number().int().positive() }),
});

class ScheduleRequestError extends Error {}

async function sendScheduleCommand(endpoint: string, input: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const code = z.object({ code: z.string() }).safeParse(json);
    const messages: Record<string, string> = {
      MFA_REQUIRED:
        "Verify your authenticator in Security and retry. Your form is preserved.",
      UNAUTHENTICATED: "Sign in again and retry. Your form is preserved.",
      CONFLICT:
        "This schedule changed. Refresh the saved searches before submitting another edit.",
      DISCOVERY_SCOPE_INVALID:
        "The saved targeting or allowance is no longer eligible. Edit and approve the current brief.",
      DISCOVERY_SETUP_REQUIRED:
        "The operator must configure discovery coverage and allowance first.",
      FORBIDDEN: "Only an Owner or Admin can manage saved searches.",
      NOT_FOUND: "This saved search is unavailable in your current Business.",
    };
    throw new ScheduleRequestError(
      code.success
        ? (messages[code.data.code] ??
            "The schedule could not be saved. Refresh and review its state before retrying.")
        : "The schedule could not be saved. Refresh and retry.",
    );
  }
  return commandResponse.parse(json).data;
}

function ScheduleEditor({
  state,
  saved,
  save,
  close,
}: {
  state: DiscoveryWorkspace;
  saved?: SavedScheduleView;
  save(input: unknown): Promise<void>;
  close(): void;
}) {
  const [name, setName] = useState(saved?.name ?? "");
  const [timeZone, setTimeZone] = useState(saved?.timeZone ?? "");
  const [localTime, setLocalTime] = useState(saved?.localTime ?? "");
  const [days, setDays] = useState<number[]>(saved?.weekdays ?? []);
  const [publicOffering, setPublicOffering] = useState(
    saved?.publicOffering ?? state.offering.slice(0, 400),
  );
  const [markets, setMarkets] = useState<string[]>(saved?.markets ?? []);
  const [budget, setBudget] = useState(saved ? String(saved.budget) : "");
  const [publicApproved, setPublicApproved] = useState(false);
  const [recurringApproved, setRecurringApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const identity = useRef<{ id: string; requestKey: string } | null>(null);
  const formId = saved?.id ?? "new";
  function edit() {
    identity.current = null;
    setRecurringApproved(false);
    setPublicApproved(false);
  }
  function payloadFor(identity: { id: string; requestKey: string }) {
    return {
      scheduleId: identity.id,
      expectedRevision: saved?.revision ?? 0,
      name,
      timeZone,
      localTime,
      weekdays: days,
      missed: "skip",
      overlap: "skip",
      dst: "compatible",
      search: {
        publicOffering,
        markets,
        budget: Number(budget),
        requestKey: identity.requestKey,
        confirmPublicQuery: publicApproved,
      },
      confirmRecurring: recurringApproved,
    };
  }
  const zoneInvalid =
    timeZone.length > 0 &&
    !saveScheduleSchema.shape.timeZone.safeParse(timeZone).success;
  const eligible =
    saveScheduleSchema.safeParse(
      payloadFor({
        id: saved?.id ?? "00000000-0000-4000-8000-000000000000",
        requestKey: "00000000-0000-4000-8000-000000000000",
      }),
    ).success &&
    Number(budget) <= (state.policy?.maxRunBudget ?? 0) &&
    markets.every((market) => state.availableMarkets.includes(market));
  return (
    <form
      className="space-y-5 rounded-xl border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        identity.current ??= {
          id: saved?.id ?? crypto.randomUUID(),
          requestKey: crypto.randomUUID(),
        };
        void save(saveScheduleSchema.parse(payloadFor(identity.current)))
          .catch((failure: unknown) =>
            setError(
              failure instanceof ScheduleRequestError
                ? failure.message
                : "The schedule could not be saved. Your form is preserved.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="font-semibold">
        {saved ? "Edit saved search" : "New saved search"}
      </h3>
      <fieldset disabled={busy} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor={`schedule-name-${formId}`}>Saved-search name</Label>
          <Input
            id={`schedule-name-${formId}`}
            value={name}
            maxLength={120}
            required
            onChange={(e) => {
              edit();
              setName(e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`schedule-offering-${formId}`}>
            Public offering phrase
          </Label>
          <Input
            id={`schedule-offering-${formId}`}
            value={publicOffering}
            maxLength={400}
            required
            onChange={(e) => {
              edit();
              setPublicOffering(e.target.value);
            }}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            Markets within current reach and coverage
          </legend>
          {[...new Set([...markets, ...state.availableMarkets])].map(
            (market) => (
              <Label key={market} className="flex min-h-11 items-center gap-3">
                <Input
                  type="checkbox"
                  className="size-5 min-h-5 shrink-0"
                  checked={markets.includes(market)}
                  onChange={(e) => {
                    edit();
                    setMarkets(
                      e.target.checked
                        ? [...markets, market]
                        : markets.filter((m) => m !== market),
                    );
                  }}
                />
                {market}
                {!state.availableMarkets.includes(market) &&
                  " (no longer eligible; remove before saving)"}
              </Label>
            ),
          )}
          {!state.availableMarkets.length && (
            <p className="text-sm text-muted-foreground">
              No eligible markets. Review Business configuration and operator
              coverage.
            </p>
          )}
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor={`schedule-budget-${formId}`}>
            Allowance for each run (
            {state.policy?.allowanceUnit ?? "not configured"})
          </Label>
          <Input
            id={`schedule-budget-${formId}`}
            type="number"
            min={1}
            max={state.policy?.maxRunBudget}
            step={1}
            required
            value={budget}
            onChange={(e) => {
              edit();
              setBudget(e.target.value);
            }}
          />
          <p className="text-sm text-muted-foreground">
            Configured maximum: {state.policy?.maxRunBudget ?? "not configured"}
            . Each new occurrence has this allowance. Recovery retains the
            consumed and reserved units for that run; extra usage requires
            separate approval.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`schedule-zone-${formId}`}>
              Business time zone (IANA)
            </Label>
            <Input
              id={`schedule-zone-${formId}`}
              value={timeZone}
              placeholder="e.g. America/New_York"
              aria-invalid={zoneInvalid}
              required
              maxLength={100}
              aria-describedby={`schedule-timing-${formId}`}
              onChange={(e) => {
                edit();
                setTimeZone(e.target.value);
              }}
            />
            {zoneInvalid && (
              <p className="text-sm text-destructive">
                Enter a supported IANA time zone, such as America/New_York.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`schedule-time-${formId}`}>Local run time</Label>
            <Input
              id={`schedule-time-${formId}`}
              type="time"
              step={60}
              required
              value={localTime}
              onChange={(e) => {
                edit();
                setLocalTime(e.target.value);
              }}
            />
          </div>
        </div>
        <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
          <legend className="mb-2 text-sm font-medium">
            Run on these local weekdays
          </legend>
          {weekdays.map((day, i) => (
            <Label key={day} className="flex min-h-11 items-center gap-3">
              <Input
                type="checkbox"
                className="size-5 min-h-5 shrink-0"
                checked={days.includes(i + 1)}
                onChange={(e) => {
                  edit();
                  setDays(
                    e.target.checked
                      ? [...days, i + 1]
                      : days.filter((d) => d !== i + 1),
                  );
                }}
              />
              {day}
            </Label>
          ))}
        </fieldset>
        <p
          id={`schedule-timing-${formId}`}
          className="text-sm text-muted-foreground"
        >
          Timing rules: skip expired local days and overlapping runs.
          Daylight-saving changes move a missing local time forward by the clock
          gap and use the first occurrence of a repeated time. Pausing or
          editing invalidates queued occurrences. A running provider request may
          already have consumed its reservation; completed evidence is retained.
        </p>
        <p className="text-sm text-muted-foreground">
          Saving approves the current reviewed offering, requirements, buyers
          and exclusions shown above. Changed targeting, reach, allowances or
          provider capabilities block the next run until reviewed again. Current
          authorizer access and MFA are required at every start.
        </p>
        <Label className="flex min-h-11 items-start gap-3">
          <Input
            type="checkbox"
            className="mt-1 size-5 min-h-5 shrink-0"
            checked={publicApproved}
            onChange={(e) => setPublicApproved(e.target.checked)}
          />
          I approve this public phrase and selected markets for search.
        </Label>
        <Label className="flex min-h-11 items-start gap-3">
          <Input
            type="checkbox"
            className="mt-1 size-5 min-h-5 shrink-0"
            checked={recurringApproved}
            onChange={(e) => setRecurringApproved(e.target.checked)}
          />
          I authorize recurring discovery with this allowance for each run, time
          zone and timing rules. This does not approve outreach or extra usage.
        </Label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!eligible || busy}>
            {busy ? "Saving..." : "Save schedule"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            Cancel edit
          </Button>
        </div>
      </fieldset>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link
              className="underline"
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Security in a new tab
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function SavedSearch({
  saved,
  state,
  endpoint,
  refresh,
}: {
  saved: SavedScheduleView;
  state: DiscoveryWorkspace;
  endpoint: string;
  refresh(): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [approvedRevision, setApprovedRevision] = useState<number | null>(null);
  const approved = approvedRevision === saved.revision;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const commandKey = useRef<{ revision: number; key: string } | null>(null);
  async function change() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    if (commandKey.current?.revision !== saved.revision)
      commandKey.current = {
        revision: saved.revision,
        key: crypto.randomUUID(),
      };
    try {
      await sendScheduleCommand(
        `${endpoint}/command`,
        scheduleCommandSchema.parse({
          action: saved.status === "active" ? "pause" : "resume",
          scheduleId: saved.id,
          expectedRevision: saved.revision,
          requestKey: commandKey.current.key,
          ...(saved.status === "paused" ? { confirmRecurring: approved } : {}),
        }),
      );
      await refresh();
      setApprovedRevision(null);
      commandKey.current = null;
      setMessage(
        saved.status === "active"
          ? "Schedule paused. Queued occurrences cannot start new research."
          : "Schedule resumed under your current verified access. Refresh to see delivery state.",
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof ScheduleRequestError
          ? failure.message
          : "The schedule could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-semibold wrap-anywhere">{saved.name}</h3>
        <Badge>
          {saved.status === "paused"
            ? "Paused"
            : saved.queueState === "pending"
              ? "Dispatch pending"
              : "Scheduled"}
        </Badge>
      </div>
      <p className="text-sm wrap-anywhere">
        {saved.publicOffering} &middot; {saved.markets.join("; ")}
      </p>
      <p className="text-sm">
        {saved.weekdays.map((day) => weekdays[day - 1]).join(", ")} at{" "}
        {saved.localTime} &middot; {saved.timeZone}
      </p>
      <p className="text-sm text-muted-foreground">
        Allowance per run: {saved.budget} {saved.allowanceUnit}. Revision{" "}
        {saved.revision}.{" "}
        {saved.nextDueAt
          ? `Next: ${new Intl.DateTimeFormat(undefined, { timeZone: saved.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(saved.nextDueAt))} (${saved.timeZone}).`
          : "No upcoming occurrence while paused."}
      </p>
      {saved.failure && (
        <p className="text-sm text-warning">{failures[saved.failure]}</p>
      )}
      {saved.lastRunId && (
        <a
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`#run-${saved.lastRunId}`}
        >
          Latest scheduled run
        </a>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Saved brief and timing rules
        </summary>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="whitespace-pre-wrap wrap-anywhere">
            {saved.brief.offering}
          </p>
          <p className="whitespace-pre-wrap wrap-anywhere">
            {Object.values(saved.brief.requirements)
              .filter(Boolean)
              .join("; ") || "No additional requirements"}
          </p>
          <p>
            Buyers: {saved.brief.buyers.map((b) => b.label).join("; ")}.
            Exclusions: {saved.brief.exclusions.join("; ") || "None"}.
          </p>
          <p>
            Expired local days and overlapping runs are skipped. Missing DST
            times move forward; repeated times use the first occurrence. Access
            and MFA must remain current. Verify in Security, then resume when
            access expires.
          </p>
        </div>
      </details>
      {state.canRun && (
        <>
          {saved.status === "paused" && (
            <Label className="flex min-h-11 items-start gap-3">
              <Input
                type="checkbox"
                className="mt-1 size-5 min-h-5 shrink-0"
                checked={approved}
                disabled={busy}
                onChange={(e) =>
                  setApprovedRevision(e.target.checked ? saved.revision : null)
                }
              />
              I reauthorize this saved brief, its per-run allowance and timing
              rules under my current access.
            </Label>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={busy || (saved.status === "paused" && !approved)}
              onClick={() => void change()}
            >
              {busy
                ? "Updating..."
                : saved.status === "active"
                  ? "Pause schedule"
                  : "Resume schedule"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Close edit" : "Edit saved search"}
            </Button>
          </div>
          {editing && (
            <ScheduleEditor
              key={`${saved.id}-${saved.revision}`}
              state={state}
              saved={saved}
              close={() => setEditing(false)}
              save={async (input) => {
                await sendScheduleCommand(endpoint, input);
                await refresh();
                setEditing(false);
                setMessage(
                  "Saved search updated. Review its queue state below.",
                );
              }}
            />
          )}
        </>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link
              href="/security"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Security in a new tab
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </article>
  );
}

export function DiscoverySchedules({
  businessId,
  state,
  refresh,
}: {
  businessId: string;
  state: DiscoveryWorkspace;
  refresh(): Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/businesses/${businessId}/discovery/schedules`;
  return (
    <section className="space-y-5" aria-labelledby="saved-searches-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="saved-searches-heading" className="text-lg font-semibold">
          Saved searches
        </h2>
        {state.canRun && (
          <Button
            variant="outline"
            disabled={creating || !state.policy || !state.brief}
            onClick={() => {
              setCreating(true);
              setMessage("");
            }}
          >
            New saved search
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Save a reviewed discovery brief with an explicit Business time zone.
        Refresh discovery to see queue state, retained results and failures.
        Setup requirements above must be complete before execution.
      </p>
      {creating && (
        <ScheduleEditor
          state={state}
          close={() => setCreating(false)}
          save={async (input) => {
            await sendScheduleCommand(endpoint, input);
            await refresh();
            setCreating(false);
            setMessage(
              "Schedule saved. Review its next occurrence and queue state.",
            );
          }}
        />
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {state.schedules.length ? (
        state.schedules.map((saved) => (
          <SavedSearch
            key={saved.id}
            saved={saved}
            state={state}
            endpoint={endpoint}
            refresh={refresh}
          />
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No saved searches yet. An Owner or Admin can save the current reviewed
          targeting and configure its timing.
        </p>
      )}
    </section>
  );
}
