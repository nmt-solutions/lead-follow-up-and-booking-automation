"use client";
import Link from "next/link";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { z } from "zod";
import {
  costWorkspaceSchema,
  costCategorySchema,
  formatCostMoney,
  type CostWorkspace,
} from "@/models/costs";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";

function Field({
  label,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}
function Choice({
  label,
  children,
  ...props
}: ComponentProps<typeof NativeSelect> & {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} {...props}>
        {children}
      </NativeSelect>
    </div>
  );
}
function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function currency(form: FormData, key: string) {
  return z.enum(["INR", "USD"]).parse(text(form, key));
}
function micros(value: string) {
  if (!/^-?\d{1,18}(\.\d{1,6})?$/.test(value))
    throw new Error(
      "Use an amount with at most six decimal places. Signed values apply only to planned changes.",
    );
  const negative = value.startsWith("-");
  const [whole, part = ""] = (negative ? value.slice(1) : value).split(".");
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole) * 1000000n + BigInt(part.padEnd(6, "0")))
  ).toString();
}
function money(value: string | null, currency = "INR") {
  if (value === null) return "Unknown";
  return formatCostMoney(value, currency);
}
function breakdown(values: Record<string, string>) {
  return (
    Object.entries(values)
      .map(([currency, v]) => money(v, currency))
      .join(" · ") || "No priced records"
  );
}
function instant(form: FormData, key: string) {
  const value = text(form, key);
  if (!value) throw new Error("Choose the observation and freshness dates.");
  return new Date(value).toISOString();
}
async function response<T>(r: Response, schema: z.ZodType<T>) {
  const json: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const failure = z.object({ code: z.string() }).safeParse(json);
    const messages: Record<string, string> = {
      MFA_REQUIRED: "Verify in Security, then retry. Your entries remain here.",
      UNAUTHENTICATED:
        "Sign in in another tab, then retry. Your entries remain here.",
      FORBIDDEN:
        "Your current operator capability or responsible owner is unavailable.",
      INVALID_INPUT:
        "Check the fields, attribution, dates, funding and evidence coverage.",
      CONFLICT:
        "Saved history changed. Refresh and review its latest version before correcting it.",
    };
    throw new Error(
      messages[failure.success ? failure.data.code : ""] ??
        "Unable to confirm the result. Refresh saved history before retrying.",
    );
  }
  const result = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(json);
  if (!result.success)
    throw new Error("Unable to read saved costs. Refresh and try again.");
  return result.data.data;
}

export function CostManager({ initial }: { initial: CostWorkspace }) {
  const [state, setState] = useState(initial),
    [month, setMonth] = useState(initial.month),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [category, setCategory] = useState("all");
  async function load(target = month) {
    const data = await response(
      await fetch(`/api/platform/costs?month=${encodeURIComponent(target)}`, {
        cache: "no-store",
      }),
      costWorkspaceSchema,
    );
    setState(data);
  }
  async function run(operation: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      setStatus(message);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Refresh saved history.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function command(action: string, input: unknown) {
    await response(
      await fetch("/api/platform/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input }),
      }),
      z.object({ saved: z.literal(true) }),
    );
    await load(state.month);
  }
  const selected = state.sources.filter(
    (r) =>
      category === "all" ||
      (category === "unpriced"
        ? !r.valuedAmount
        : r.source.category === category),
  );
  return (
    <div key={state.month} className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Forms belong to the loaded month. Loading another month starts fresh
        forms.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <Field
          label="UTC cost month"
          name="month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <Button
          disabled={busy}
          onClick={() => run(() => load(), "Saved month loaded.")}
        >
          Load month
        </Button>
        <Link
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security and MFA
        </Link>
      </div>
      {error && <Alert role="alert">{error}</Alert>}
      {status && <p role="status">{status}</p>}
      {busy && <p role="status">Updating saved cost records…</p>}
      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-6"
        aria-labelledby="cost-summary"
      >
        <h2 id="cost-summary" className="text-xl font-semibold">
          {state.month} · known covered operator cost
        </h2>
        <dl className="grid gap-5 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              Consumed resources and incurred commitments
            </dt>
            <dd className="text-2xl font-semibold">
              {money(state.totals.operatorMicros)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Month-end planning forecast · known sources only
            </dt>
            <dd className="text-2xl font-semibold">
              {money(state.forecast.operatorMicros)}
            </dd>
          </div>
        </dl>
        <p>
          {state.totals.unpriced} unpriced operator sources ·{" "}
          {state.totals.unconverted} without INR conversion ·{" "}
          {state.totals.stale} past their stated freshness.
        </p>
        <p className="text-sm">
          {state.coverage.estimatedSourceIds.length} priced estimates ·{" "}
          {state.coverage.unsettledSourceIds.length} unsettled provider
          observations · {state.coverage.unresolvedFundingSourceIds.length}{" "}
          native AI funding declarations awaiting statement allocation. Recorded
          usage totals can include evidenced rate estimates; they are not
          settled cash.
        </p>
        <p className="text-sm text-muted-foreground">
          As of {state.asOf}. Native application scan:{" "}
          {state.coverage.nativeScanAt ?? "Not yet run"}. A missing source or
          rate never means free usage.
        </p>
        <p className="text-sm">
          INR values use{" "}
          {state.planning?.usdToInr
            ? `the explicitly assumed USD/INR planning rate ${state.planning.usdToInr}`
            : "no USD/INR conversion; USD remains unconverted"}
          . They do not establish settlement or customer FX.
        </p>
        <p className="text-sm">
          {state.forecast.assumptions} · {state.forecast.elapsedSeconds} elapsed
          seconds of {state.forecast.monthSeconds} in the UTC month.
        </p>
        <p className="text-sm">
          Selected provider evidence absent:{" "}
          {state.coverage.missingProviderEvidence.join(", ") ||
            "None in the selected provider checklist"}
          . This checklist is source coverage, not provider activation.
        </p>
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-primary">
            Review separate funding and customer costs
          </summary>
          <dl className="space-y-3">
            <div>
              <dt className="font-medium">
                Cash top-ups · funding, excluded from consumption total
              </dt>
              <dd>{breakdown(state.totals.cashTopups)}</dd>
            </div>
            <div>
              <dt className="font-medium">
                Linked OpenAI credit consumption · separate from subscription
                commitment
              </dt>
              <dd>{breakdown(state.totals.linkedCreditConsumption)}</dd>
            </div>
            <div>
              <dt className="font-medium">
                Existing subscription allocation · informational, excluded from
                total
              </dt>
              <dd>{breakdown(state.totals.subscriptionAllocation)}</dd>
            </div>
            <div>
              <dt className="font-medium">
                Customer-paid Meta · excluded from operator total and platform
                billing
              </dt>
              <dd>{breakdown(state.totals.customerPaid)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm">
            Funding declarations do not prove which balance paid a request.
            Reconcile provider statements through attributable evidence. Gateway
            system debit is counted once; upstream provider cost stays
            contextual.
          </p>
        </details>
      </section>
      <section className="space-y-4" aria-labelledby="cost-alerts">
        <h2 id="cost-alerts" className="text-xl font-semibold">
          Budgets and notifications
        </h2>
        <p className="text-sm">
          Email sender:{" "}
          {state.delivery.emailConfigured
            ? "configured"
            : "missing; email notifications remain pending"}
          . Automatic schedule:{" "}
          {state.delivery.scheduleConfigured
            ? "configured; deployment must be verified"
            : "missing; use manual evaluation until an approved Trigger schedule is deployed"}
          .
        </p>
        <p>
          These reports never approve extra run spend, change entitlements or
          cancel customer work.
        </p>
        {!state.budgets.length && (
          <p>
            No monthly budget is configured. Record an explicit budget and
            responsible operator below.
          </p>
        )}
        {state.budgets.map((b) => (
          <div
            key={b.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <p className="font-medium">
              {b.category} · {money(b.limitInrMicros)} · version {b.version}
            </p>
            <p>
              Thresholds: {b.thresholds.join(" / ")}% · owner: {b.ownerId} ·{" "}
              {b.email ? "In-app and email" : "In-app"} ·{" "}
              {b.forecastAlerts ? "actual and forecast" : "actual"}
              {b.activeUntil && (
                <>
                  {" "}
                  · delegation {b.automationActive ? "active" : "expired"}{" "}
                  through {b.activeUntil}
                </>
              )}
            </p>
          </div>
        ))}
        {!state.alerts.length && (
          <p>No saved threshold notifications for this month.</p>
        )}
        {state.alerts.map((a) => (
          <article
            key={a.id}
            className="space-y-3 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap gap-3">
              <h3 className="font-semibold">
                {a.category} · {a.measure} · {a.threshold}%
              </h3>
              <Badge>
                {a.emailState === "accepted"
                  ? "Email accepted by provider"
                  : a.emailState === "in_app"
                    ? "In-app notification"
                    : a.emailState}
              </Badge>
              {a.acknowledged && <Badge>Acknowledged</Badge>}
            </div>
            <p>{a.summary}</p>
            <p className="text-sm text-muted-foreground">
              Responsible operator: {a.ownerId} · {a.at}
            </p>
            {!a.acknowledged && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void run(
                    () =>
                      command("acknowledge", {
                        id: a.id,
                        note: text(form, "note"),
                      }),
                    "Notification acknowledged.",
                  );
                }}
              >
                <Field
                  label="Review note"
                  name="note"
                  required
                  maxLength={300}
                />
                <Button disabled={busy} variant="outline">
                  Acknowledge notification
                </Button>
              </form>
            )}
            {a.emailState === "held" && (
              <p>
                Review recipient authority or the expired delivery window. The
                in-app record remains; recovery does not send a new email
                identity.
              </p>
            )}
          </article>
        ))}
        <Button
          disabled={busy}
          variant="outline"
          onClick={() =>
            run(
              () => command("evaluate", state.month),
              "Budgets evaluated; saved notification status refreshed.",
            )
          }
        >
          Evaluate budgets and recover notifications
        </Button>
        <details className="rounded-xl border border-border bg-card p-6">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Configure a monthly budget
          </summary>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const category = text(f, "category"),
                  previous = state.budgets.find((b) => b.category === category);
                await command("budget", {
                  month: state.month,
                  category,
                  expectedVersion: previous?.version ?? 0,
                  limitInrMicros: micros(text(f, "limit")),
                  ownerId: text(f, "owner"),
                  email: text(f, "email") === "yes",
                  forecastAlerts: text(f, "forecast") === "yes",
                  thresholds: text(f, "thresholds").split(",").map(Number),
                  retentionSeconds: Number(text(f, "retention")),
                  note: text(f, "note"),
                });
              }, "Budget version saved.");
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice label="Budget category" name="category" required>
                <option value="global">All operator categories</option>
                {costCategorySchema.options.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Choice>
              <Field
                label="Monthly INR planning budget"
                name="limit"
                required
                inputMode="decimal"
              />
              <Field
                label="Responsible operator user ID"
                name="owner"
                required
                defaultValue={state.operatorId}
              />
              <Field
                label="Threshold percentages, separated by commas"
                name="thresholds"
                defaultValue="80,90,100"
                required
              />
              <Choice label="Notification delivery" name="email">
                <option value="no">In-app</option>
                <option value="yes">In-app and configured email sender</option>
              </Choice>
              <Choice label="Forecast notifications" name="forecast">
                <option value="no">Actual cost only</option>
                <option value="yes">
                  Actual cost and known-source forecast
                </option>
              </Choice>
              <Field
                label="Delegation and evidence retention, seconds"
                name="retention"
                required
                type="number"
                min="60"
                max="2147483647"
              />
              <Field
                label="Reason and responsibility"
                name="note"
                required
                maxLength={300}
              />
            </div>
            <p className="text-sm">
              Saving revises the selected category for this month. Automation
              remains authorized only while this version is current, unexpired
              and its owner retains cost capability and MFA enrollment.
            </p>
            <Button disabled={busy}>Save budget version</Button>
          </form>
        </details>
      </section>
      <section className="space-y-4" aria-labelledby="cost-sources">
        <h2 id="cost-sources" className="text-xl font-semibold">
          Source usage and evidence
        </h2>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              () =>
                command("refresh", {
                  month: state.month,
                  retentionSeconds: Number(text(f, "retention")),
                }),
              "Native usage ingested. Existing source identities retained.",
            );
          }}
        >
          <Field
            label="Native evidence retention, seconds"
            name="retention"
            type="number"
            min="60"
            max="2147483647"
            required
          />
          <Button disabled={busy}>Ingest current application usage</Button>
        </form>
        <p className="text-sm">
          Application usage includes AI, discovery, storage operations, native
          mail, mailbox jobs, Meta status and normalized payment fees.
          Hosting/database/worker meters and contract commitments need exact
          provider statements or agreed evidence; no price or free band is
          assumed.
        </p>
        <Choice
          label="Filter sources"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          <option value="unpriced">Unpriced sources</option>
          {costCategorySchema.options.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Choice>
        {!selected.length && (
          <p>No sources match. Ingest usage or record attributable evidence.</p>
        )}
        {selected.map((r) => (
          <details
            key={r.id}
            className="rounded-xl border border-border bg-card p-5"
          >
            <summary className="min-h-11 cursor-pointer py-3">
              <span className="font-medium">
                {r.source.provider} · {r.source.category} · {r.source.kind}
              </span>
              <span className="ml-3">
                {r.valuedAmount
                  ? money(r.valuedAmount.micros, r.valuedAmount.currency)
                  : "Unpriced"}
              </span>
            </summary>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="font-medium">Accounting treatment</dt>
                <dd>
                  {r.coveredBy
                    ? `Covered by ${r.coveredBy}`
                    : r.included
                      ? "Included in known operator cost"
                      : "Reported separately"}{" "}
                  · {r.source.funding} · {r.source.status}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Pricing basis</dt>
                <dd>{r.pricing}</dd>
              </div>
              <div>
                <dt className="font-medium">Attribution</dt>
                <dd>
                  {r.source.businessId ?? "Global platform"}{" "}
                  {r.source.runId ? `· run ${r.source.runId}` : ""}
                  <br />
                  {r.source.allocation}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Meter and selected plan</dt>
                <dd>
                  {r.source.quantity ?? "Unknown quantity"} {r.source.unit} ·{" "}
                  {r.source.plan ?? "No selected-plan evidence"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Source and freshness</dt>
                <dd>
                  {r.source.evidence}
                  <br />
                  {r.source.observedAt} through {r.source.freshUntil} ·{" "}
                  {r.stale
                    ? "Past stated freshness"
                    : "Within stated freshness"}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Stable identity</dt>
                <dd>
                  {r.sourceId} · version {r.version}
                  <br />
                  Recorded by {r.actorId} · {r.at}
                </dd>
              </div>
            </dl>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-3 text-primary">
                History and normalized evidence
              </summary>
              <pre className="overflow-auto whitespace-pre-wrap text-sm">
                {JSON.stringify(
                  {
                    details: r.source.details,
                    history: state.history.filter(
                      (h) => h.sourceId === r.sourceId,
                    ),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </details>
        ))}
      </section>
      <details className="rounded-xl border border-border bg-card p-6">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Record or correct attributable cost evidence
        </summary>
        <p className="my-4 text-sm">
          Use an exact statement line, commitment, time record or plan-change
          reference. Keep the same stable source ID for corrections. Amounts are
          the attributed platform share. Include no credentials or private
          customer content. For effort, record minutes/hours and an evidenced
          amount or rate; blank amounts stay unpriced.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              const sourceId = text(f, "sourceId"),
                previous = state.sources.find((r) => r.sourceId === sourceId),
                kind = text(f, "kind"),
                amount = text(f, "amount");
              await command("record", {
                sourceId,
                expectedVersion: previous?.version ?? 0,
                reason: text(f, "reason"),
                retentionSeconds: Number(text(f, "retention")),
                source: {
                  month: state.month,
                  provider: text(f, "provider"),
                  category: text(f, "category"),
                  kind,
                  funding: text(f, "funding"),
                  amount: amount
                    ? { currency: text(f, "currency"), micros: micros(amount) }
                    : null,
                  quantity: text(f, "quantity")
                    ? Number(text(f, "quantity"))
                    : null,
                  unit: text(f, "unit"),
                  businessId: text(f, "business") || null,
                  runId: text(f, "run") || null,
                  allocation: text(f, "allocation"),
                  evidence: text(f, "evidence"),
                  observedAt: instant(f, "observed"),
                  freshUntil: instant(f, "fresh"),
                  plan: text(f, "plan") || null,
                  status: amount ? "recorded" : "unpriced",
                  details: {},
                  coversSourceIds: text(f, "covers")
                    .split(/\s*,\s*/)
                    .filter(Boolean),
                },
              });
            }, "Evidence version saved. Prior versions remain in history.");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Stable source ID, beginning evidence:"
              name="sourceId"
              placeholder="evidence:provider-statement-line"
              required
            />
            <Field
              label="Provider or effort owner key"
              name="provider"
              required
            />
            <Choice label="Category" name="category" required>
              <option value="">Choose category</option>
              {costCategorySchema.options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Choice>
            <Choice label="Record type" name="kind" required>
              <option value="">Choose accounting treatment</option>
              {[
                "consumption",
                "commitment",
                "cash_topup",
                "subscription_allocation",
                "customer_paid_meta",
                "plan_change",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Choice>
            <Choice label="Funding source" name="funding" required>
              <option value="">Choose funding evidence</option>
              {[
                "cash",
                "openai_linked_credits",
                "openai_purchased_credits",
                "gateway_prepaid",
                "existing_subscription",
                "byok",
                "fallback",
                "customer_meta",
                "unknown",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Choice>
            <Choice label="Source currency" name="currency">
              <option>INR</option>
              <option>USD</option>
            </Choice>
            <Field
              label="Attributed amount; plan changes may use a signed delta; blank means unpriced"
              name="amount"
              inputMode="decimal"
            />
            <Field
              label="Usage quantity or effort duration"
              name="quantity"
              type="number"
              min="0"
              step="1"
            />
            <Field
              label="Unit, such as minutes or compute_hours"
              name="unit"
              required
            />
            <Field
              label="Allocation method and platform share"
              name="allocation"
              required
              maxLength={300}
            />
            <Field
              label="Business ID; blank for shared platform"
              name="business"
            />
            <Field label="Run ID, if attributable" name="run" />
            <Field
              label="Exact nonsecret statement or evidence reference"
              name="evidence"
              required
              maxLength={300}
            />
            <Field
              label="Selected plan or change description, if applicable"
              name="plan"
              maxLength={300}
            />
            <Field
              label="Observed or effective time"
              name="observed"
              type="datetime-local"
              required
            />
            <Field
              label="Evidence fresh through"
              name="fresh"
              type="datetime-local"
              required
            />
            <Field
              label="Reason or correction evidence"
              name="reason"
              required
              maxLength={300}
            />
            <Field
              label="Minimum evidence retention, seconds"
              name="retention"
              type="number"
              min="60"
              max="2147483647"
              required
            />
            <Field
              label="Covered native or planned-change source IDs, separated by commas"
              name="covers"
            />
          </div>
          <p className="text-sm">
            A statement covering imported usage replaces its listed native costs
            in the total. Payment fees retain their authoritative gateway
            observation; bank settlement and fee reconciliation remain separate.
            Plan-change amounts are future incremental commitments, included
            only in the forecast; record actual charges separately.
          </p>
          <Button disabled={busy}>Save evidence version</Button>
        </form>
      </details>
      <details className="rounded-xl border border-border bg-card p-6">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Configure planning assumptions and evidenced rates
        </summary>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              const provider = text(f, "rateProvider"),
                input = text(f, "inputRate"),
                output = text(f, "outputRate"),
                unitRate = text(f, "unitRate");
              const newRate = provider
                ? {
                    provider,
                    unit: text(f, "rateUnit"),
                    model: text(f, "model") || null,
                    pricePerUnit: unitRate
                      ? {
                          currency: currency(f, "rateCurrency"),
                          micros: micros(unitRate),
                        }
                      : null,
                    inputPerMillion: input
                      ? {
                          currency: currency(f, "rateCurrency"),
                          micros: micros(input),
                        }
                      : null,
                    outputPerMillion: output
                      ? {
                          currency: currency(f, "rateCurrency"),
                          micros: micros(output),
                        }
                      : null,
                    effectiveAt: instant(f, "rateStart"),
                    freshUntil: instant(f, "rateEnd"),
                    evidence: text(f, "rateEvidence"),
                  }
                : null;
              let rates = state.planning?.rates ?? [];
              if (newRate)
                rates = [
                  ...rates.filter(
                    (r) =>
                      r.provider !== newRate.provider ||
                      r.unit !== newRate.unit ||
                      r.model !== newRate.model,
                  ),
                  newRate,
                ];
              await command("configure", {
                month: state.month,
                expectedVersion: state.planning?.version ?? 0,
                usdToInr: text(f, "fx") || null,
                conversionEvidence: text(f, "fxEvidence") || null,
                conversionObservedAt: text(f, "fxDate")
                  ? instant(f, "fxDate")
                  : null,
                forecast: text(f, "forecast"),
                assumptions: text(f, "assumptions"),
                rates,
                retentionSeconds: Number(text(f, "retention")),
              });
            }, "Planning version saved. Earlier assumptions remain in history.");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Assumed USD to INR rate; blank leaves USD separate"
              name="fx"
              inputMode="decimal"
              defaultValue={state.planning?.usdToInr ?? ""}
            />
            <Field
              label="Planning conversion evidence"
              name="fxEvidence"
              defaultValue={state.planning?.conversionEvidence ?? ""}
            />
            <Field
              label="Planning conversion checked at"
              name="fxDate"
              type="datetime-local"
            />
            <Choice
              label="Variable forecast model"
              name="forecast"
              defaultValue={state.planning?.forecast ?? "none"}
            >
              <option value="none">No forecast</option>
              <option value="linear_elapsed_utc">
                Linear usage over elapsed UTC month, plus fixed commitments
              </option>
            </Choice>
            <Field
              label="Assumptions, time basis and coverage limits"
              name="assumptions"
              required
              maxLength={300}
              defaultValue={state.planning?.assumptions ?? ""}
            />
            <Field
              label="Minimum planning evidence retention, seconds"
              name="retention"
              required
              type="number"
              min="60"
              max="2147483647"
            />
          </div>
          <fieldset className="space-y-4 rounded-xl border border-border p-4">
            <legend className="px-2 font-medium">
              Optional rate addition or correction
            </legend>
            <p className="text-sm">
              An effective rate estimates missing provider amounts. It never
              replaces observed money. Enter a unit rate, or both token rates
              per million; no rate or free band is supplied.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider key" name="rateProvider" />
              <Field label="Exact usage unit" name="rateUnit" />
              <Field label="Model ID, if specific" name="model" />
              <Choice label="Rate currency" name="rateCurrency">
                <option>INR</option>
                <option>USD</option>
              </Choice>
              <Field
                label="Cost per unit"
                name="unitRate"
                inputMode="decimal"
              />
              <Field
                label="Input token cost per million"
                name="inputRate"
                inputMode="decimal"
              />
              <Field
                label="Output token cost per million"
                name="outputRate"
                inputMode="decimal"
              />
              <Field label="Exact rate evidence" name="rateEvidence" />
              <Field
                label="Rate effective at"
                name="rateStart"
                type="datetime-local"
              />
              <Field
                label="Rate valid through"
                name="rateEnd"
                type="datetime-local"
              />
            </div>
          </fieldset>
          <Button disabled={busy}>Save planning version</Button>
        </form>
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-3 text-primary">
            Review versioned assumptions and rates
          </summary>
          <pre className="overflow-auto whitespace-pre-wrap text-sm">
            {JSON.stringify(state.planningHistory, null, 2)}
          </pre>
        </details>
      </details>
    </div>
  );
}
