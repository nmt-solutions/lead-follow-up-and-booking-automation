"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { z } from "zod";
import {
  discoveryWorkspaceSchema,
  startDiscoverySchema,
  allowanceApprovalSchema,
  resumeDiscoverySchema,
  cancelDiscoverySchema,
  type DiscoveryWorkspace,
  type RunView,
  type StopReason,
} from "@/models/discovery";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { DiscoverySchedules } from "./discovery-schedules";
import { DiscoveryProspectCard } from "./discovery-prospect";

const reasons: Record<StopReason, string> = {
  completed: "Completed",
  cancelled: "Cancelled by an Owner or Admin",
  budget_exhausted: "Authorized allowance reached",
  provider_unavailable: "Source provider unavailable",
  provider_uncertain:
    "Source call outcome is uncertain; its allowance remains consumed",
  provider_rate_limited: "Provider rate limit reached",
  provider_permission_denied: "Provider permission denied",
  invalid_provider_response: "Provider response could not be verified",
  interrupted: "Interrupted",
  defect: "Unexpected worker failure",
  authorization_revoked: "Actor access or session verification no longer valid",
  configuration_changed: "Targeting, reach or provider configuration changed",
  queue_unavailable: "Worker queue unavailable",
  worker_lost: "Worker stopped before completion",
};
const responseSchema = z.object({
  success: z.literal(true),
  data: discoveryWorkspaceSchema,
});
const errorMessages: Record<string, string> = {
  MFA_REQUIRED:
    "Verify your authenticator in Security, then retry. Your form is preserved.",
  UNAUTHENTICATED: "Sign in again, then retry. Your form is preserved.",
  FORBIDDEN: "Only an Owner or Admin can authorize discovery runs.",
  DISCOVERY_SCOPE_INVALID:
    "The selected scope or allowance is no longer eligible. Refresh the run list and review your configuration.",
  DISCOVERY_SETUP_REQUIRED:
    "Discovery setup is incomplete. Contact the service operator to configure reach, coverage, allowances and the approved provider and worker.",
  CONFLICT:
    "This request has already been used with other values. Refresh and review the run list.",
};
class DiscoveryRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function RunControls({
  run,
  enabled,
  ready,
  command,
}: {
  run: RunView;
  enabled: boolean;
  ready: boolean;
  command(
    action: "allowance" | "resume" | "cancel",
    input: unknown,
  ): Promise<void>;
}) {
  const [budget, setBudget] = useState("");
  const [extraApproved, setExtraApproved] = useState(false);
  const [resumeApproved, setResumeApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const keys = useRef<
    Partial<
      Record<
        "allowance" | "resume" | "cancel",
        { scope: string; requestKey: string }
      >
    >
  >({});
  async function act(action: "allowance" | "resume" | "cancel") {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    // Replay an unchanged command after an uncertain response. Once a refresh
    // establishes another attempt/allowance, a new explicit action needs its own
    // identity rather than reusing a key with a different expected state.
    const scope =
      action === "allowance"
        ? JSON.stringify([run.budget, budget])
        : String(run.attempt);
    if (keys.current[action]?.scope !== scope)
      keys.current[action] = { scope, requestKey: crypto.randomUUID() };
    try {
      const common = {
        runId: run.id,
        requestKey: keys.current[action]?.requestKey,
      };
      const input =
        action === "allowance"
          ? allowanceApprovalSchema.parse({
              ...common,
              expectedBudget: run.budget,
              budget: Number(budget),
              confirmExtraUsage: extraApproved,
            })
          : action === "resume"
            ? resumeDiscoverySchema.parse({
                ...common,
                expectedAttempt: run.attempt,
                confirmResume: resumeApproved,
              })
            : cancelDiscoverySchema.parse({
                ...common,
                expectedAttempt: run.attempt,
              });
      await command(action, input);
      delete keys.current[action];
      setExtraApproved(false);
      setResumeApproved(false);
      setMessage(
        action === "allowance"
          ? "Allowance approved. Review the remaining units, then explicitly resume."
          : action === "resume"
            ? "Resume requested. Refresh to see saved progress."
            : "Run cancelled. Completed results are retained.",
      );
    } catch (failure: unknown) {
      setExtraApproved(false);
      setResumeApproved(false);
      setError(
        failure instanceof DiscoveryRequestError
          ? (errorMessages[failure.code] ??
              "The action could not complete. Refresh the run and review its saved state before retrying.")
          : "The action could not complete. Refresh the run and review its saved state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  const validBudget =
    /^\d+$/.test(budget) &&
    Number(budget) > run.budget &&
    Number(budget) <= run.maxBudget;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-muted p-5"
      aria-label="Run allowance and recovery"
    >
      <p className="text-sm text-muted-foreground">
        Allowance units authorize research capacity. Pricing and commercial
        terms are not configured here; this approval is not a price, charge or
        bill. Failed and uncertain calls remain consumed. Retrying them uses
        another reservation from the remaining allowance.
      </p>
      {run.status === "stopped" && enabled && (
        <>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void act("allowance");
            }}
          >
            <Label htmlFor={`allowance-${run.id}`}>
              New total allowance ({run.allowanceUnit})
            </Label>
            <Input
              id={`allowance-${run.id}`}
              inputMode="numeric"
              value={budget}
              disabled={busy}
              aria-describedby={`limit-${run.id}`}
              onChange={(event) => {
                setBudget(event.target.value);
                setExtraApproved(false);
                delete keys.current.allowance;
              }}
            />
            <p id={`limit-${run.id}`} className="text-sm text-muted-foreground">
              Current total: {run.budget}. Configured maximum: {run.maxBudget}.{" "}
              {validBudget
                ? `You are approving ${Number(budget) - run.budget} extra ${run.allowanceUnit}.`
                : "Enter a higher whole-number total within the configured maximum."}
            </p>
            <Label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-primary"
                checked={extraApproved}
                disabled={busy || !validBudget}
                onChange={(event) => setExtraApproved(event.target.checked)}
              />
              <span>
                I approve this bounded allowance increase. It will not resume
                the run until I request it separately.
              </span>
            </Label>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !validBudget || !extraApproved}
            >
              {busy ? "Saving…" : "Approve allowance increase"}
            </Button>
          </form>
          {run.resumable ? (
            <div className="space-y-3 border-t border-border pt-4">
              <Label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 accent-primary"
                  checked={resumeApproved}
                  disabled={busy || !ready || run.remaining === 0}
                  onChange={(event) => setResumeApproved(event.target.checked)}
                />
                <span>
                  I request continuation of this stopped run within its
                  remaining {run.remaining} {run.allowanceUnit}, including
                  retrying failed or uncertain work. Completed work will be
                  skipped.
                </span>
              </Label>
              <Button
                disabled={
                  busy || !ready || !resumeApproved || run.remaining === 0
                }
                onClick={() => void act("resume")}
              >
                {busy ? "Requesting…" : "Resume remaining work"}
              </Button>
              {!ready && (
                <p className="text-sm text-muted-foreground">
                  Complete the discovery setup above before requesting
                  continuation.
                </p>
              )}
              {run.remaining === 0 && (
                <p className="text-sm text-muted-foreground">
                  Approve a bounded increase before resuming.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This older run has no resumable checkpoints. Its results and usage
              remain available. Authorize a separate run to research again.
            </p>
          )}
        </>
      )}
      {!enabled && (
        <p className="text-sm text-muted-foreground">
          An Owner or Admin with verified MFA can approve allowance and request
          recovery.
        </p>
      )}
      {enabled && (run.status === "queued" || run.status === "running") && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Cancellation stops further reservations. Calls already reserved may
            finish; unsettled outcomes remain consumed as uncertain. Resuming
            later requires an explicit request.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            {busy ? "Cancelling…" : "Cancel this run"}
          </Button>
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <RecoveryLink href="/security" className="underline">
              Security
            </RecoveryLink>
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}

function RunResults({ run, children }: { run: RunView; children: ReactNode }) {
  const openRequests = run.prospects.filter((p) => p.requestState === "open");
  const potentialBuyers = run.prospects.filter(
    (p) => p.requestState !== "open",
  );
  return (
    <article
      id={`run-${run.id}`}
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold wrap-anywhere">
          {run.brief.publicOffering}
        </h3>
        <Badge>
          {run.stopReason
            ? reasons[run.stopReason]
            : run.status === "queued"
              ? run.queueState === "pending"
                ? "Dispatch pending"
                : "Queued with worker"
              : "Running"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Created {new Date(run.createdAt).toLocaleString()} ·{" "}
        {run.brief.markets.join("; ")}
      </p>
      {run.executionCapacity && (
        <p className="text-sm text-muted-foreground">
          Execution allowance:{" "}
          {run.executionCapacity.mode === "reserved" ? "Reserved" : "Pooled"} ·{" "}
          {run.executionCapacity.slots} concurrent discovery runs · approval
          revision {run.executionCapacity.policyVersion}.
        </p>
      )}
      {run.scheduledFor && (
        <p className="text-sm text-muted-foreground">
          Scheduled occurrence: {new Date(run.scheduledFor).toLocaleString()}.
          See Saved searches for its Business time zone and timing rules.
        </p>
      )}
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">
            Authorized allowance
          </dt>
          <dd className="mt-1 font-medium">
            {run.budget} {run.allowanceUnit}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Consumed / reserved / remaining
          </dt>
          <dd className="mt-1 font-medium">
            {run.consumed} / {run.reserved} / {run.remaining}{" "}
            {run.allowanceUnit}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Searches processed</dt>
          <dd className="mt-1 font-medium">{run.completedSteps}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Evidence-backed matches
          </dt>
          <dd className="mt-1 font-medium">{run.counts.evidenceBacked}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Contactable prospects
          </dt>
          <dd className="mt-1 font-medium">{run.counts.contactable}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Named-buyer coverage
          </dt>
          <dd className="mt-1 font-medium">{run.counts.namedBuyers}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Raw search results</dt>
          <dd className="mt-1 font-medium">
            {run.consolidation.rawResults ?? "Not recorded"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            Matched observations
          </dt>
          <dd className="mt-1 font-medium">
            {run.consolidation.matchedObservations}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">
            New / refreshed / duplicates
          </dt>
          <dd className="mt-1 font-medium">
            {run.consolidation.created} / {run.consolidation.refreshed} /{" "}
            {run.consolidation.duplicates}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Counts cover unique prospects in this run. Named-buyer coverage counts
        prospects with an evidenced purchasing person or owner, even without a
        contact route. Contactable means a usable public route, including
        general business contacts; it does not establish permission to send.
      </p>
      <p className="text-sm text-muted-foreground">
        Raw results include repeated search entries and results that do not
        establish a match. Refreshed means an existing prospect first
        encountered in this run; duplicates are further observations of that
        prospect within the run. Both retain evidence. Earlier runs may lack
        these outcome measurements. Each newly authorized run uses its own
        allowance.
      </p>
      {(run.status === "queued" || run.status === "running") && (
        <p className="text-sm text-muted-foreground">
          Refresh to see progress. Completed evidence appears as it is saved.
        </p>
      )}
      {run.status === "stopped" && (
        <p className="text-sm text-muted-foreground">
          Completed work is retained. Uncertain calls consume their reserved
          allowance. Further execution requires an explicit resume request;
          increasing allowance alone does not continue research.
        </p>
      )}
      {children}
      <details className="rounded-lg border border-border p-4">
        <summary className="min-h-11 cursor-pointer font-medium">
          Reviewed brief and usage
        </summary>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="font-medium">Offering</dt>
            <dd className="whitespace-pre-wrap wrap-anywhere">
              {run.brief.offering}
            </dd>
          </div>
          {Object.entries(run.brief.requirements).map(([key, value]) => (
            <div key={key}>
              <dt className="font-medium">
                {
                  {
                    specifications: "Specifications",
                    minimumOrder: "Minimum order",
                    deliveryConstraints: "Delivery constraints",
                    serviceConstraints: "Service constraints",
                  }[key]
                }
              </dt>
              <dd className="whitespace-pre-wrap wrap-anywhere">
                {value || "Not specified"}
              </dd>
            </div>
          ))}
          <div>
            <dt className="font-medium">Buyer categories</dt>
            <dd>{run.brief.buyers.map((buyer) => buyer.label).join("; ")}</dd>
          </div>
          <div>
            <dt className="font-medium">Exclusions</dt>
            <dd>{run.brief.exclusions.join("; ") || "None configured"}</dd>
          </div>
        </dl>
        <ul className="mt-4 space-y-2 text-sm">
          {run.usage.map((usage) => (
            <li key={usage.id} className="wrap-anywhere">
              {usage.kind === "search"
                ? "Public search"
                : usage.kind === "contents"
                  ? "Shortlisted source content"
                  : "AI evidence review"}
              : {usage.units} {run.allowanceUnit} · {usage.outcome}
              {usage.query ? ` · Query: ${usage.query}` : ""}
            </li>
          ))}
        </ul>
        <h4 className="mt-4 font-medium">Allowance and recovery history</h4>
        {run.audit.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {run.audit.map((entry) => (
              <li key={entry.id} className="wrap-anywhere">
                {entry.action === "increase"
                  ? "Allowance increase"
                  : entry.action === "resume"
                    ? "Resume requested"
                    : "Run cancelled"}{" "}
                · {entry.budgetBefore} → {entry.budgetAfter} {run.allowanceUnit}{" "}
                · Actor {entry.actorId} · {new Date(entry.at).toLocaleString()}
                {entry.stopReason
                  ? ` · Previous stop: ${reasons[entry.stopReason] ?? entry.stopReason}`
                  : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No additional allowance or recovery actions.
          </p>
        )}
      </details>
      <section className="space-y-4" aria-labelledby={`open-${run.id}`}>
        <h4 id={`open-${run.id}`} className="text-lg font-semibold">
          Open buying requests ({run.counts.openBuyingRequests})
        </h4>
        <p className="text-sm text-muted-foreground">
          Explicit, dated public needs shown open by their source when checked,
          with no evidenced expiry reached. Source check times remain visible;
          no automatic revalidation is assumed.
        </p>
        {openRequests.length ? (
          <ul className="space-y-4">
            {openRequests.map((prospect) => (
              <DiscoveryProspectCard key={prospect.id} prospect={prospect} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No established open buying requests saved for this run.
          </p>
        )}
      </section>
      <section className="space-y-4" aria-labelledby={`potential-${run.id}`}>
        <h4 id={`potential-${run.id}`} className="text-lg font-semibold">
          Potential buyers ({run.counts.potentialBuyers})
        </h4>
        <p className="text-sm text-muted-foreground">
          Evidence-backed fit without established open demand. Expired, undated
          and uncertain requests remain here with their evidence and actual
          status.
        </p>
        {potentialBuyers.length ? (
          <ul className="space-y-4">
            {potentialBuyers.map((prospect) => (
              <DiscoveryProspectCard key={prospect.id} prospect={prospect} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No other potential buyers saved for this run yet. Results depend on
            sources and scope; no count is guaranteed.
          </p>
        )}
      </section>
    </article>
  );
}

export function DiscoveryManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: DiscoveryWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [publicOffering, setPublicOffering] = useState(
    initialState.policy?.exa?.publicOfferings[0] ??
      initialState.offering.slice(0, 400),
  );
  const [markets, setMarkets] = useState(
    initialState.availableMarkets.slice(0, 1),
  );
  const [budget, setBudget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const endpoint = `/api/businesses/${businessId}/discovery`;
  async function request(
    method: "GET" | "POST",
    payload?: unknown,
    action?: "allowance" | "resume" | "cancel",
  ): Promise<unknown> {
    const response = await fetch(action ? `${endpoint}/${action}` : endpoint, {
      method,
      cache: "no-store",
      headers:
        payload === undefined
          ? undefined
          : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const json: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ code: z.string() }).safeParse(json);
      throw new DiscoveryRequestError(
        parsed.success ? parsed.data.code : "UNKNOWN",
      );
    }
    return json;
  }
  async function refresh() {
    const json = await request("GET");
    setState(responseSchema.parse(json).data);
  }
  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await operation();
    } catch (failure: unknown) {
      setError(
        failure instanceof DiscoveryRequestError
          ? (errorMessages[failure.code] ??
              "Discovery could not complete. Refresh and review saved runs before retrying.")
          : "Discovery could not complete. Refresh and review saved runs before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  function edit() {
    requestKey.current = null;
  }
  const validBudget =
    /^\d+$/.test(budget) &&
    Number(budget) > 0 &&
    Number(budget) <= (state.policy?.maxRunBudget ?? 0);
  return (
    <div className="space-y-8">
      {state.setup.length > 0 && (
        <section className="rounded-xl border border-border bg-muted p-5">
          <h2 className="font-semibold">Discovery setup needed</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {state.setup.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Review your discovery brief</h2>
        <p className="text-sm text-muted-foreground">
          AI reviews source evidence against your saved offering, product
          requirements, buyer categories and exclusions. Search receives only
          the public offering phrase, buyer category and selected market.
          Private files, approved answers and mailbox content are never
          included.
        </p>
        <Link
          href={`/businesses/${businessId}/configuration`}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review offerings, buyers and geography
        </Link>
        {state.brief && (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">Requirements</dt>
              <dd className="whitespace-pre-wrap wrap-anywhere">
                {Object.values(state.brief.requirements)
                  .filter(Boolean)
                  .join(" · ") || "Not specified"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Buyer categories</dt>
              <dd>
                {state.brief.buyers.map((buyer) => buyer.label).join("; ")}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Exclusions</dt>
              <dd>{state.brief.exclusions.join("; ") || "None configured"}</dd>
            </div>
          </dl>
        )}
        {state.policy && (
          <p className="text-sm text-muted-foreground">
            Coverage:{" "}
            {state.policy.coverage
              .map((coverage) => `${coverage.market} (public web)`)
              .join("; ")}
            . Active reach: {state.policy.activeMarkets.join("; ")}. Search:{" "}
            {state.policy.searchUnits}; AI review: {state.policy.reviewUnits}{" "}
            {state.policy.allowanceUnit} per call. At most{" "}
            {state.policy.maxResults} results per search.
            {state.policy.exa && (
              <>
                {" "}
                Exa retrieves at most {
                  state.policy.exa.maxContentsPerSearch
                }{" "}
                shortlisted URLs per search as {state.policy.exa.contentsType}{" "}
                excerpts, at {state.policy.exa.contentsUnits}{" "}
                {state.policy.allowanceUnit} per URL. The whole run allows at
                most {state.policy.exa.maxCalls} Exa calls and{" "}
                {state.policy.exa.maxAttemptsPerStep} attempts per step,
                including explicit resumes. No automatic source retries.
              </>
            )}
          </p>
        )}
        {state.capacity && (
          <section
            className="space-y-2 rounded-xl border border-border bg-muted p-4"
            aria-label="Execution capacity"
          >
            <h3 className="font-medium">
              {state.capacity.mode === "reserved"
                ? "Reserved discovery capacity"
                : state.capacity.mode === "pooled"
                  ? "Pooled discovery capacity"
                  : "Discovery capacity setup required"}
            </h3>
            <p className="text-sm">
              {
                {
                  available: "Available",
                  busy: "Busy — queued work waits for capacity",
                  setup_required:
                    "Current paid entitlement, approved allocation and worker deployment are required",
                  unavailable:
                    "Provider capacity could not be verified — queued work waits",
                  stale:
                    "Provider observation is stale — refresh to check again",
                  entitlement_changed:
                    "Entitlement changed — review configuration before resuming",
                }[state.capacity.status]
              }
            </p>
            {state.capacity.mode && (
              <p className="text-sm">
                {state.capacity.slots} concurrent discovery runs allocated.{" "}
                {state.capacity.running !== null
                  ? `${state.capacity.running} running · ${state.capacity.queued} queued in this lane.`
                  : "Current running and queued counts are unknown."}
              </p>
            )}
            {state.capacity.observedAt && (
              <p className="text-xs text-muted-foreground">
                Observed {new Date(state.capacity.observedAt).toLocaleString()}.
                Refresh runs for a current observation.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Capacity does not guarantee leads or throughput. Privacy, source
              permissions and approved budgets apply in both modes. Reserved
              work waits in its approved lane; it never silently moves to pooled
              execution.
            </p>
          </section>
        )}
        {!state.canRun ? (
          <p className="text-sm text-muted-foreground">
            You can review sourced prospects. Ask an Owner or Admin to authorize
            a run.
          </p>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                requestKey.current ??= crypto.randomUUID();
                const payload = startDiscoverySchema.parse({
                  markets,
                  publicOffering,
                  confirmPublicQuery: confirmed,
                  budget: Number(budget),
                  requestKey: requestKey.current,
                });
                const result = await request("POST", payload);
                z.object({
                  success: z.literal(true),
                  data: z.object({
                    id: z.uuid(),
                    status: z.enum([
                      "queued",
                      "running",
                      "completed",
                      "stopped",
                    ]),
                  }),
                }).parse(result);
                requestKey.current = null;
                setConfirmed(false);
                await refresh();
                setMessage(
                  "Run accepted. Refresh to review progress and saved evidence.",
                );
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="public-offering">Public offering phrase</Label>
              {state.policy?.exa ? (
                <NativeSelect
                  id="public-offering"
                  value={publicOffering}
                  required
                  onChange={(event) => {
                    edit();
                    setPublicOffering(event.target.value);
                    setConfirmed(false);
                  }}
                >
                  {state.policy.exa.publicOfferings.map((phrase) => (
                    <option key={phrase} value={phrase}>
                      {phrase}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  id="public-offering"
                  value={publicOffering}
                  maxLength={400}
                  required
                  onChange={(event) => {
                    edit();
                    setPublicOffering(event.target.value);
                    setConfirmed(false);
                  }}
                />
              )}
              <p className="text-sm text-muted-foreground">
                Review this phrase for public search. Omit private requirements
                or personal information.
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">
                Selected markets within active reach and coverage
              </legend>
              {state.availableMarkets.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No eligible markets configured.
                </p>
              )}
              {state.availableMarkets.map((market) => (
                <Label
                  key={market}
                  className="flex min-h-11 items-center gap-3"
                >
                  <Input
                    type="checkbox"
                    className="size-5 min-h-5 shrink-0"
                    checked={markets.includes(market)}
                    onChange={(event) => {
                      edit();
                      setMarkets(
                        event.target.checked
                          ? [...markets, market]
                          : markets.filter((value) => value !== market),
                      );
                    }}
                  />
                  {market}
                </Label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="discovery-budget">
                Initial run allowance
                {state.policy ? ` (${state.policy.allowanceUnit})` : ""}
              </Label>
              <Input
                id="discovery-budget"
                type="number"
                min={1}
                max={state.policy?.maxRunBudget}
                step={1}
                value={budget}
                required
                onChange={(event) => {
                  edit();
                  setBudget(event.target.value);
                }}
              />
              <p className="text-sm text-muted-foreground">
                {state.policy
                  ? `Maximum ${state.policy.maxRunBudget} ${state.policy.allowanceUnit}. `
                  : ""}
                No automatic increase or guaranteed result count. Failed or
                uncertain operations retain their reservation.
              </p>
            </div>
            <Label className="flex min-h-11 items-start gap-3">
              <Input
                type="checkbox"
                className="mt-1 size-5 min-h-5 shrink-0"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I reviewed the public search phrase and brief and authorize this
                initial allowance.
              </span>
            </Label>
            <Button
              type="submit"
              disabled={
                busy ||
                state.setup.length > 0 ||
                !validBudget ||
                !confirmed ||
                !publicOffering.trim() ||
                markets.length === 0
              }
            >
              {busy ? "Submitting…" : "Authorize and run discovery"}
            </Button>
          </form>
        )}
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <RecoveryLink href="/security" className="underline">
              Security
            </RecoveryLink>
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          {message}
        </p>
      )}
      <DiscoverySchedules
        businessId={businessId}
        state={state}
        refresh={refresh}
      />
      <section className="space-y-5" aria-labelledby="retained-prospects">
        <h2 id="retained-prospects" className="text-lg font-semibold">
          Retained prospects ({state.counts.evidenceBacked})
        </h2>
        <p className="text-sm text-muted-foreground">
          Consolidated within this Business across saved runs. Exact evidenced
          company identities and purchasing needs stay separate; a name or
          shared mailbox alone does not establish a match.{" "}
          {state.counts.contactable} contactable · {state.counts.namedBuyers}{" "}
          with evidenced named buyers. Conflicting roles are unverified until
          reviewed. Reloading saved evidence makes no provider calls.
        </p>
        {[
          {
            key: "open",
            title: "Open buying requests",
            prospects: state.prospects.filter((p) => p.requestState === "open"),
          },
          {
            key: "potential",
            title: "Potential buyers",
            prospects: state.prospects.filter((p) => p.requestState !== "open"),
          },
        ].map((section) => (
          <div key={section.key} className="space-y-4">
            <h3 className="font-semibold">
              {section.title} ({section.prospects.length})
            </h3>
            {section.prospects.length ? (
              <ul className="space-y-4">
                {section.prospects.map((prospect) => (
                  <DiscoveryProspectCard
                    key={prospect.id}
                    prospect={prospect}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No retained {section.title.toLowerCase()}.
              </p>
            )}
          </div>
        ))}
      </section>
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Discovery runs and potential buyers
          </h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await refresh();
                setMessage("Run list refreshed.");
              })
            }
          >
            {busy ? "Loading…" : "Refresh runs"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Research results remain potential buyers. Discovery does not send
          messages or create engagement. AI match reasons may contain errors;
          inspect the dated source evidence.
        </p>
        {state.runs.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
            No discovery runs yet. Review your brief and setup above to begin.
          </p>
        ) : (
          state.runs.map((run) => (
            <RunResults key={run.id} run={run}>
              <RunControls
                run={run}
                enabled={state.canRun}
                ready={state.setup.length === 0}
                command={async (action, input) => {
                  const result = await request("POST", input, action);
                  z.object({
                    success: z.literal(true),
                    data: z.object({
                      id: z.uuid(),
                      status: z.enum([
                        "queued",
                        "running",
                        "completed",
                        "stopped",
                      ]),
                    }),
                  }).parse(result);
                  await refresh();
                }}
              />
            </RunResults>
          ))
        )}
        {state.runs.length === 50 && (
          <p className="text-sm text-muted-foreground">
            Showing the most recent 50 runs.
          </p>
        )}
      </section>
    </div>
  );
}
