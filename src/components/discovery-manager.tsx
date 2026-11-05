"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  discoveryWorkspaceSchema,
  startDiscoverySchema,
  type DiscoveryWorkspace,
  type RunView,
  type StopReason,
} from "@/models/discovery";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { DiscoveryProspectCard } from "./discovery-prospect";

const reasons: Record<StopReason, string> = {
  completed: "Completed",
  budget_exhausted: "Authorized allowance reached",
  provider_unavailable: "Source provider unavailable",
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

function RunResults({ run }: { run: RunView }) {
  const openRequests = run.prospects.filter((p) => p.requestState === "open");
  const potentialBuyers = run.prospects.filter(
    (p) => p.requestState !== "open",
  );
  return (
    <article className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold wrap-anywhere">
          {run.brief.publicOffering}
        </h3>
        <Badge>
          {run.stopReason
            ? reasons[run.stopReason]
            : run.status === "queued"
              ? "Queued"
              : "Running"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Started {new Date(run.createdAt).toLocaleString()} ·{" "}
        {run.brief.markets.join("; ")}
      </p>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Allowance reserved</dt>
          <dd className="mt-1 font-medium">
            {run.used} / {run.budget} {run.allowanceUnit}
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
          allowance. This run will not spend more; any new run needs a separate
          authorization.
        </p>
      )}
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
              {usage.kind === "search" ? "Public search" : "AI evidence review"}
              : {usage.units} {run.allowanceUnit} · {usage.outcome}
              {usage.query ? ` · Query: ${usage.query}` : ""}
            </li>
          ))}
        </ul>
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
  ): Promise<unknown> {
    const response = await fetch(endpoint, {
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
          </p>
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
            <Link href="/security" className="underline">
              Security
            </Link>
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
          state.runs.map((run) => <RunResults key={run.id} run={run} />)
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
