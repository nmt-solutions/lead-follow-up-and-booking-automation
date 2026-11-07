"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { EmailActionRef } from "@/models/email-eligibility";
import { z } from "zod";
import {
  pilotWorkspaceSchema,
  pilotViewSchema,
  pilotCapabilitySchema,
  type PilotView,
} from "@/models/pilots";
import { readCommercialResponse } from "./subscription-quote-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
export type PilotChoices = {
  metrics: { id: string; label: string; unit: string }[];
  payments: { id: string; label: string; currency: "INR" | "USD" }[];
  senders: { id: string; label: string }[];
  mailboxes: { id: string; label: string }[];
  calendars: { id: string; label: string }[];
  whatsapp: { id: string; label: string }[];
  businesses: { id: string; label: string }[];
  emailActions: { id: string; label: string; action: EmailActionRef }[];
};
const capabilities = {
  discovery: "Prospect discovery",
  inquiry_email: "Inquiry email",
  outreach_email: "First-contact email",
  mailbox: "Mailbox and reply synchronization",
  whatsapp: "Customer-owned WhatsApp",
  calendar: "Native calendar booking",
};
function Field({
  name,
  label,
  type = "text",
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        step={type === "number" ? "any" : undefined}
      />
    </div>
  );
}
function Choice({
  name,
  label,
  options,
  required = false,
}: {
  name: string;
  label: string;
  options: { id: string; label: string }[];
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} required={required}>
        <option value="">
          {required
            ? "Choose an option"
            : "Choose when required by the selected path"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
const date = (value: FormDataEntryValue | null) =>
  new Date(String(value)).toISOString();
const value = (data: FormData, name: string) => String(data.get(name) ?? "");
export function PilotManager({
  businessId,
  initial,
  choices,
}: {
  businessId: string;
  initial: z.infer<typeof pilotWorkspaceSchema>;
  choices: PilotChoices;
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [criteriaCount, setCriteriaCount] = useState(1),
    [baselineCount, setBaselineCount] = useState(1),
    [otherPilots, setOtherPilots] = useState<PilotView[]>([]);
  const commandKeys = useRef(new Map<string, string>());
  const pending = useRef(false),
    key = useRef(crypto.randomUUID());
  const base = `/api/businesses/${businessId}/pilots`;
  async function refresh() {
    setState(
      await readCommercialResponse(
        await fetch(base, { cache: "no-store" }),
        pilotWorkspaceSchema,
      ),
    );
  }
  async function run(task: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage(
        "Saved. Review the current evidence and remaining setup below.",
      );
    } catch {
      setError(
        "The action could not be completed. Review the inputs and current setup, refresh status, or verify your session in Security. Your draft stays here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function command(kind: string, input: Record<string, unknown>) {
    const fingerprint = JSON.stringify([kind, { ...input, requestKey: null }]);
    const requestKey =
      commandKeys.current.get(fingerprint) ?? String(input.requestKey);
    commandKeys.current.set(fingerprint, requestKey);
    await readCommercialResponse(
      await fetch(`${base}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, requestKey }),
      }),
      pilotViewSchema,
    );
    await refresh();
    commandKeys.current.delete(fingerprint);
  }
  function ref(p: PilotView) {
    return { pilotId: p.id, requestKey: crypto.randomUUID() };
  }
  async function prepare(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    await run(async () => {
      const calendar = value(data, "calendar").split("|"),
        payment = choices.payments.find(
          (p) => p.id === value(data, "paymentActionId"),
        );
      if (!payment) throw new Error("Choose an exact paid-pilot quote.");
      const ceiling = (kind: string) =>
        !value(data, `${kind}-evidence`)
          ? null
          : {
              cashMinor: value(data, `${kind}-cash`),
              spendMinor: value(data, `${kind}-spend`),
              seconds: Number(value(data, `${kind}-seconds`)),
              globalSpendInrMicros: value(data, `${kind}-global`) || null,
              evidence: value(data, `${kind}-evidence`),
            };
      await command("prepare", {
        requestKey: key.current,
        plan: {
          paymentActionId: payment.id,
          goal: value(data, "goal"),
          scope: value(data, "scope"),
          startsAt: date(data.get("startsAt")),
          endsAt: date(data.get("endsAt")),
          capabilities: data.getAll("capabilities"),
          baseline: Array.from({ length: baselineCount }, (_, i) => ({
            metric: value(data, `baseline-metric-${i}`),
            value: Number(value(data, `baseline-value-${i}`)),
            unit: value(data, `baseline-unit-${i}`),
            evidence: value(data, `baseline-evidence-${i}`),
          })),
          criteria: Array.from({ length: criteriaCount }, (_, i) => ({
            metric: value(data, `criterion-metric-${i}`),
            comparison: value(data, `criterion-comparison-${i}`),
            target: Number(value(data, `criterion-value-${i}`)),
            unit:
              choices.metrics.find(
                (m) => m.id === value(data, `criterion-metric-${i}`),
              )?.unit ?? "",
          })),
          senderId: value(data, "senderId") || null,
          mailboxId: value(data, "mailboxId") || null,
          emailActions: choices.emailActions
            .filter((a) => data.getAll("emailActions").includes(a.id))
            .map((a) => a.action),
          whatsAppConnectionId: value(data, "whatsAppConnectionId") || null,
          calendarProvider: calendar[0] || null,
          calendarConnectionId: calendar[1] || null,
          calendarId: calendar[2] || null,
          currency: payment.currency,
          cashLimitMinor: value(data, "cashLimitMinor"),
          spendLimitMinor: value(data, "spendLimitMinor"),
          timeLimitSeconds: Number(value(data, "timeLimitSeconds")),
          ceilings: {
            discovery: ceiling("discovery"),
            automation: ceiling("automation"),
            mailbox: ceiling("mailbox"),
            calendar: ceiling("calendar"),
          },
          approvalEvidence: value(data, "approvalEvidence"),
        },
      });
      key.current = crypto.randomUUID();
      form.reset();
    });
  }
  return (
    <div className="space-y-8">
      {error && (
        <Alert role="alert">
          {error}{" "}
          <Link href="/security" className="underline">
            Open Security
          </Link>
        </Alert>
      )}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap gap-4">
        <Button variant="outline" disabled={busy} onClick={() => run(refresh)}>
          Refresh pilot status
        </Button>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/subscription-payments`}
        >
          Review pilot payment and monthly mandate
        </Link>
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}/reports`}
        >
          Open measured Business reports
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Prepare an actual paid pilot</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-5 text-muted-foreground">
            Choose the reviewed pilot or captured monthly continuation quote,
            define the actual baseline and numeric criteria, and record approved
            founder limits. No commercial amount or effort rate is supplied
            automatically. Dates use your local time; paid periods retain their
            original UTC boundaries.
          </p>
          {!state.canRecord && (
            <p className="mb-4 text-muted-foreground">
              A pilot operator with current operator verification must prepare
              and record this evaluation. Owners/admins can review and approve
              the exact plan.
            </p>
          )}
          <form onSubmit={prepare} className="space-y-6">
            <Choice
              name="paymentActionId"
              label="Reviewed pilot or paid monthly continuation"
              required
              options={choices.payments}
            />
            <Field name="goal" label="Actual conversion goal" />
            <Field name="scope" label="Approved workflow scope" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="startsAt"
                label="Operating start"
                type="datetime-local"
              />
              <Field
                name="endsAt"
                label="Operating end"
                type="datetime-local"
              />
            </div>
            <fieldset className="space-y-3">
              <legend className="font-medium">Selected capabilities</legend>
              {pilotCapabilitySchema.options.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-3">
                  <input
                    className="size-5"
                    name="capabilities"
                    type="checkbox"
                    value={c}
                  />
                  {capabilities[c]}
                </label>
              ))}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                name="senderId"
                label="Exact sending identity"
                options={choices.senders}
              />
              <Choice
                name="mailboxId"
                label="Exact mailbox scope"
                options={choices.mailboxes}
              />
              <Choice
                name="calendar"
                label="Exact native calendar account"
                options={choices.calendars}
              />
              <Choice
                name="whatsAppConnectionId"
                label="Exact customer-owned Meta connection"
                options={choices.whatsapp}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Selected email actions are checked individually for market,
              recipient, purpose and current permission. Prepare and approve
              those actions in the existing email workflow before activation.
            </p>
            {choices.emailActions?.map((a) => (
              <label key={a.id} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  name="emailActions"
                  value={a.id}
                  className="size-5"
                />
                {a.label}
              </label>
            ))}
            <fieldset className="space-y-4">
              <legend className="font-medium">
                Baseline with original evidence
              </legend>
              {Array.from({ length: baselineCount }, (_, i) => (
                <div
                  className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2"
                  key={i}
                >
                  <Field
                    name={`baseline-metric-${i}`}
                    label="Canonical metric identifier"
                  />
                  <Field
                    name={`baseline-value-${i}`}
                    label="Measured baseline"
                    type="number"
                  />
                  <Field
                    name={`baseline-unit-${i}`}
                    label="Population and unit"
                  />
                  <Field
                    name={`baseline-evidence-${i}`}
                    label="Baseline evidence reference"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={baselineCount >= 30}
                onClick={() => setBaselineCount((n) => n + 1)}
              >
                Add baseline measure
              </Button>
            </fieldset>
            <fieldset className="space-y-4">
              <legend className="font-medium">Numeric success criteria</legend>
              {Array.from({ length: criteriaCount }, (_, i) => (
                <div
                  className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2"
                  key={i}
                >
                  <Choice
                    name={`criterion-metric-${i}`}
                    required
                    label="Measured outcome"
                    options={choices.metrics}
                  />
                  <Field
                    name={`criterion-value-${i}`}
                    label="Numeric target"
                    type="number"
                  />
                  <Choice
                    name={`criterion-comparison-${i}`}
                    label="Comparison"
                    options={[
                      { id: "at_least", label: "At least" },
                      { id: "at_most", label: "At most" },
                    ]}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={criteriaCount >= 30}
                onClick={() => setCriteriaCount((n) => n + 1)}
              >
                Add success criterion
              </Button>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                name="cashLimitMinor"
                label="Approved cash ceiling (billing-currency minor units)"
              />
              <Field
                name="spendLimitMinor"
                label="Approved spend ceiling (billing-currency minor units)"
              />
              <Field
                name="timeLimitSeconds"
                label="Approved founder time ceiling (seconds)"
                type="number"
              />
            </div>
            <details className="rounded-xl border border-border p-4">
              <summary className="min-h-11 cursor-pointer font-medium">
                Approved operation ceilings
              </summary>
              <p className="mb-4 text-muted-foreground">
                Provide evidenced maximum cash, spend and duration per operation
                unit. These reserve limits before work; they are not measured
                actual costs or hours. An unpriced or unknown-duration path
                stays unavailable. Customer-paid Meta consumption is separate.
                Discovery uses the selected source policy unit. Automation uses
                one dispatch. Mailbox work reserves each provider phase:
                inspection, listing, each message read and grant recheck. Its
                ceiling must cover every native request and credential refresh
                within that phase. Calendar work reserves one bounded operation,
                including its native reads and existing request timeouts.
              </p>
              {["discovery", "automation", "mailbox", "calendar"].map((c) => (
                <fieldset key={c} className="my-5 grid gap-4 sm:grid-cols-2">
                  <legend className="font-medium capitalize">{c}</legend>
                  <Field
                    name={`${c}-cash`}
                    label="Maximum cash per unit (minor units)"
                    required={false}
                  />
                  <Field
                    name={`${c}-spend`}
                    label="Maximum spend per unit (minor units)"
                    required={false}
                  />
                  <Field
                    name={`${c}-seconds`}
                    label="Maximum duration per unit (seconds)"
                    type="number"
                    required={false}
                  />
                  <Field
                    name={`${c}-global`}
                    label="USD paths: approved maximum INR exposure (millionths; independent of actual FX)"
                    required={false}
                  />
                  <Field
                    name={`${c}-evidence`}
                    label="Approved upper-bound evidence"
                    required={false}
                  />
                </fieldset>
              ))}
            </details>
            <Field
              name="approvalEvidence"
              label="Actual scope and founder approval reference"
            />
            <Button disabled={busy || !state.canRecord}>
              {busy ? "Saving..." : "Save pilot for exact review"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {!state.pilots.length && (
        <p>No pilot has been recorded for this Business.</p>
      )}
      {state.pilots.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>
                {p.business.name}: {p.plan.goal}
              </CardTitle>
              <Badge>{p.status.replaceAll("_", " ")}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 wrap-anywhere">
            <p>{p.business.offering}</p>
            {p.payment.term.kind === "calendar_month" && (
              <p className="font-medium">
                Explicitly bounded monthly continuation. Original pilot and
                renewal terms remain preserved.
              </p>
            )}
            <p>{p.plan.scope}</p>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt>Upfront pilot before tax</dt>
                <dd>
                  {p.plan.currency} {p.payment.quote.initial.subtotalMinor}{" "}
                  minor units / {p.payment.quote.initial.days} days
                </dd>
              </div>
              <div>
                <dt>Agreed monthly renewal before tax</dt>
                <dd>
                  {p.plan.currency} {p.payment.quote.renewal.subtotalMinor}{" "}
                  minor units
                </dd>
              </div>
              <div>
                <dt>Approved operating window</dt>
                <dd>
                  {new Date(p.plan.startsAt).toLocaleString()} through{" "}
                  {new Date(p.plan.endsAt).toLocaleString()}
                </dd>
              </div>
            </dl>
            <p>
              Cash reserved/recorded: {p.usage.cashMinor} /{" "}
              {p.plan.cashLimitMinor}; spend: {p.usage.spendMinor} /{" "}
              {p.plan.spendLimitMinor} minor units; time: {p.usage.seconds} /{" "}
              {p.plan.timeLimitSeconds} seconds.
            </p>
            {p.usage.unknowns.map((u) => (
              <p className="text-sm text-muted-foreground" key={u}>
                {u}
              </p>
            ))}
            <details>
              <summary className="min-h-11 cursor-pointer font-medium">
                Original baseline, criteria and allowances
              </summary>
              <ul className="list-inside list-disc space-y-2">
                {p.plan.baseline.map((b, i) => (
                  <li key={i}>
                    {b.metric}: {b.value} {b.unit}; evidence: {b.evidence}
                  </li>
                ))}
                {p.plan.criteria.map((c, i) => (
                  <li key={i}>
                    {c.metric}: {c.comparison.replaceAll("_", " ")} {c.target}{" "}
                    {c.unit}
                  </li>
                ))}
              </ul>
              <p>
                Pilot discovery {p.payment.quote.initial.discovery.quantity}{" "}
                {p.payment.quote.initial.discovery.unit}; monthly{" "}
                {p.payment.quote.renewal.discovery.quantity}{" "}
                {p.payment.quote.renewal.discovery.unit}. Pilot automation{" "}
                {p.payment.quote.initial.automation.quantity}{" "}
                {p.payment.quote.initial.automation.unit}; monthly{" "}
                {p.payment.quote.renewal.automation.quantity}{" "}
                {p.payment.quote.renewal.automation.unit}.
              </p>
              <p>{p.payment.quote.renewal.terms}</p>
            </details>
            <section
              className="space-y-3"
              aria-label="Current financial evidence"
            >
              <h3 className="text-lg font-semibold">
                Current payment validation
              </h3>
              <p>
                Pilot capture eligible:{" "}
                {p.financialEvidence.pilotPaid ? "Yes" : "No"}. Actual monthly
                renewal eligible:{" "}
                {p.financialEvidence.renewalPaid ? "Yes" : "No"}.
              </p>
              {p.financialEvidence.reasons.map((reason) => (
                <p key={reason} className="text-muted-foreground">
                  {reason}
                </p>
              ))}
              {p.financialEvidence.renewal && (
                <p>
                  Monthly payment {p.financialEvidence.renewal.paymentId}:{" "}
                  {p.plan.currency} {p.financialEvidence.renewal.amountMinor}{" "}
                  minor units, paid{" "}
                  {new Date(
                    p.financialEvidence.renewal.paidAt,
                  ).toLocaleString()}
                  .
                </p>
              )}
              {p.financialEvidence.accounting.adjustments.map((a) => (
                <p key={a.caseId}>
                  {a.kind}: {a.status}. Native cash{" "}
                  {a.actualCashMinor ?? "unconfirmed"}; issued credit{" "}
                  {a.issuedCreditMinor}; residual{" "}
                  {a.residualMinor ?? "unconfirmed"} {a.currency} minor units.
                  Cash and seller credit remain distinct.
                </p>
              ))}
              <p className="text-sm text-muted-foreground">
                History describes what was recorded. Current refund, dispute or
                cancellation evidence can make an earlier renewal ineligible.
              </p>
            </section>
            <section className="space-y-3">
              <h3 className="text-lg font-semibold">Current preflight</h3>
              {p.gates.map((g) => (
                <div
                  className="rounded-xl border border-border p-4"
                  key={g.capability}
                >
                  <p className="font-medium">
                    {g.capability.replaceAll("_", " ")}:{" "}
                    {g.ready
                      ? "Ready for the selected scope"
                      : "Setup required"}
                  </p>
                  {g.reasons.map((r) => (
                    <p key={r}>{r}</p>
                  ))}
                  <Link
                    className="inline-flex min-h-11 items-center text-primary underline"
                    href={g.destination}
                  >
                    Review this setup
                  </Link>
                </div>
              ))}
            </section>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => run(() => command("approve", ref(p)))}
              >
                Approve this frozen pilot
              </Button>
              <Button
                disabled={busy || !p.canRecord || p.gates.some((g) => !g.ready)}
                onClick={() => run(() => command("activate", ref(p)))}
              >
                Activate selected paths
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => command("stop", ref(p)))}
              >
                Stop further pilot work
              </Button>
              <Button
                variant="outline"
                disabled={
                  busy || !p.canRecord || !p.financialEvidence.renewalPaid
                }
                onClick={() => run(() => command("renewal", ref(p)))}
              >
                Record verified paid monthly renewal
              </Button>
            </div>
            <details className="rounded-xl border border-border p-4">
              <summary className="min-h-11 cursor-pointer font-medium">
                Record measured effort
              </summary>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    command("effort", {
                      ...ref(p),
                      kind: value(data, "effort-kind"),
                      seconds: Number(value(data, "effort-seconds")),
                      cashMinor: value(data, "effort-cash"),
                      spendMinor: value(data, "effort-spend"),
                      evidence: value(data, "effort-evidence"),
                      occurredAt: date(data.get("effort-at")),
                    }),
                  );
                }}
              >
                <Choice
                  name="effort-kind"
                  required
                  label="Actual effort category"
                  options={[
                    "setup",
                    "support",
                    "sales",
                    "billing_tax",
                    "maintenance",
                  ].map((v) => ({ id: v, label: v.replaceAll("_", " ") }))}
                />
                <p className="text-sm text-muted-foreground">
                  Record actual human effort and its separately attributable
                  expense. Provider charges stay separate. Cost operators
                  normalize these attributed inputs before further work; no
                  hourly rate or bank settlement is inferred.
                </p>
                <Field
                  name="effort-seconds"
                  label="Actual measured seconds"
                  type="number"
                />
                <Field name="effort-cash" label="Actual cash (minor units)" />
                <Field
                  name="effort-spend"
                  label="Actual expense (minor units)"
                />
                <Field
                  name="effort-evidence"
                  label="Timesheet or statement evidence"
                />
                <Field
                  name="effort-at"
                  label="When effort occurred"
                  type="datetime-local"
                />
                <Button disabled={busy || !p.canRecord}>
                  Save actual effort
                </Button>
              </form>
            </details>
            <details className="rounded-xl border border-border p-4">
              <summary className="min-h-11 cursor-pointer font-medium">
                Record canonical measured results and contribution inputs
              </summary>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    command("results", {
                      ...ref(p),
                      from: date(data.get("result-from")),
                      to: date(data.get("result-to")),
                      assessment: value(data, "result-assessment"),
                      contribution: {
                        revenueExcludingTaxMinor: value(data, "result-revenue"),
                        providerExpenseMinor: value(data, "result-provider"),
                        effortExpenseMinor: value(data, "result-effort"),
                        customerPaidMetaMinor:
                          value(data, "result-meta") || null,
                        evidence: [value(data, "result-evidence")],
                        complete: data.get("result-complete") === "on",
                      },
                    }),
                  );
                }}
              >
                <Field
                  name="result-from"
                  label="Measured cohort from"
                  type="datetime-local"
                />
                <Field
                  name="result-to"
                  label="Measured cohort through"
                  type="datetime-local"
                />
                <Field
                  name="result-revenue"
                  label="Actual revenue excluding collected tax (minor units)"
                />
                <Field
                  name="result-provider"
                  label="Actual allocated provider expense (minor units)"
                />
                <Field
                  name="result-effort"
                  label="Actual effort expense (minor units)"
                />
                <Field
                  name="result-meta"
                  label="Customer-paid Meta amount, if known (separate minor units)"
                  required={false}
                />
                <Field
                  name="result-evidence"
                  label="Actual statements and allocation evidence"
                />
                <Field
                  name="result-assessment"
                  label="Measured assessment and incomplete coverage"
                />
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    name="result-complete"
                    className="size-5"
                  />
                  I have recorded the complete attributable contribution inputs
                </label>
                <Button disabled={busy || !p.canRecord}>
                  Save measured results
                </Button>
              </form>
            </details>
            {p.report && (
              <section className="space-y-3">
                <h3 className="font-semibold">Retained measured cohort</h3>
                <p>
                  {p.report.from} through {p.report.to}
                </p>
                {p.report.coverage.map((v) => (
                  <p className="text-sm text-muted-foreground" key={v}>
                    {v}
                  </p>
                ))}
                <dl className="grid gap-3 sm:grid-cols-2">
                  {p.report.metrics.map((m) => (
                    <div key={m.id}>
                      <dt>{m.label}</dt>
                      <dd>
                        {m.value ?? "Unavailable"} {m.unit}; {m.status}
                        {m.denominator !== null
                          ? ` / denominator ${m.denominator}`
                          : ""}
                      </dd>
                      <p className="text-sm text-muted-foreground">
                        {m.definition}
                      </p>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            <details className="rounded-xl border border-border p-4">
              <summary className="min-h-11 cursor-pointer font-medium">
                Record a materially different workflow after paid renewal
              </summary>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    command("reuse", {
                      ...ref(p),
                      secondBusinessId: value(data, "second-business"),
                      secondPilotId: value(data, "second-pilot"),
                      differentNeed: value(data, "second-need"),
                      adaptations: value(data, "second-adaptations"),
                      reusedConfiguration: [
                        {
                          first: value(data, "first-field"),
                          second: value(data, "second-field"),
                          evidence: value(data, "reuse-evidence"),
                        },
                      ],
                    }),
                  );
                }}
              >
                <Label htmlFor={`second-business-${p.id}`}>
                  Second Business
                </Label>
                <NativeSelect
                  name="second-business"
                  id={`second-business-${p.id}`}
                  onChange={(e) => {
                    const id = e.target.value;
                    void run(async () =>
                      setOtherPilots(
                        (
                          await readCommercialResponse(
                            await fetch(`/api/businesses/${id}/pilots`, {
                              cache: "no-store",
                            }),
                            pilotWorkspaceSchema,
                          )
                        ).pilots,
                      ),
                    );
                  }}
                >
                  <option value="">Choose the other configured Business</option>
                  {choices.businesses
                    .filter((b) => b.id !== businessId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                </NativeSelect>
                <Choice
                  name="second-pilot"
                  label="Actual second pilot"
                  options={otherPilots.map((s) => ({
                    id: s.id,
                    label: s.plan.goal,
                  }))}
                />
                <Field
                  name="second-need"
                  label="Materially different purchasing workflow"
                />
                <Choice
                  name="first-field"
                  label="Original configuration to compare"
                  options={[
                    "scope",
                    "goal",
                    "capabilities",
                    "criteria",
                    "ceilings",
                  ].map((v) => ({ id: v, label: v }))}
                />
                <Choice
                  name="second-field"
                  label="Second configuration to compare"
                  options={[
                    "scope",
                    "goal",
                    "capabilities",
                    "criteria",
                    "ceilings",
                  ].map((v) => ({ id: v, label: v }))}
                />
                <Field
                  name="reuse-evidence"
                  label="Actual configuration-reuse evidence"
                />
                <Field
                  name="second-adaptations"
                  label="Adaptations and observed reuse"
                />
                <Button
                  disabled={
                    busy || !p.canRecord || !p.financialEvidence.renewalPaid
                  }
                >
                  Record contrasting workflow evidence
                </Button>
              </form>
            </details>
            <details>
              <summary className="min-h-11 cursor-pointer font-medium">
                Original pilot history
              </summary>
              {p.events.map((e) => (
                <div
                  key={e.id}
                  className="space-y-2 border-b border-border py-4"
                >
                  <p className="font-medium">
                    {e.kind.replaceAll("_", " ")} ?{" "}
                    {new Date(e.at).toLocaleString()}
                  </p>
                  <EventEvidence data={e.data} />
                </div>
              ))}
            </details>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm text-muted-foreground">{state.claims}</p>
    </div>
  );
}

function EventEvidence({ data }: { data: Record<string, unknown> }) {
  const effort = z
    .object({
      seconds: z.number(),
      cashMinor: z.string(),
      spendMinor: z.string(),
      evidence: z.string(),
      kind: z.string(),
    })
    .safeParse(data);
  const result = z
    .object({
      assessment: z.string(),
      contribution: z.object({
        revenueExcludingTaxMinor: z.string(),
        providerExpenseMinor: z.string(),
        effortExpenseMinor: z.string(),
        customerPaidMetaMinor: z.string().nullable(),
        netBeforeUnrecordedInputsMinor: z.string(),
        coverage: z.string(),
        evidence: z.array(z.string()),
      }),
      criteria: z.array(
        z.object({
          metric: z.string(),
          observed: z.number().nullable(),
          status: z.string(),
          met: z.boolean().nullable(),
          definition: z.string(),
        }),
      ),
    })
    .safeParse(data);
  const reuse = z
    .object({
      differentNeed: z.string(),
      adaptations: z.string(),
      configuration: z.array(
        z.object({
          first: z.string(),
          second: z.string(),
          evidence: z.string(),
          equal: z.boolean(),
        }),
      ),
    })
    .safeParse(data);
  return (
    <>
      {effort.success && (
        <p>
          {effort.data.kind}: {effort.data.seconds} actual seconds; cash{" "}
          {effort.data.cashMinor}, spend {effort.data.spendMinor} minor units.
          Evidence: {effort.data.evidence}
        </p>
      )}
      {result.success && (
        <div className="space-y-2">
          <p>{result.data.assessment}</p>
          <p>
            Attributed revenue excluding tax{" "}
            {result.data.contribution.revenueExcludingTaxMinor}; provider
            expense {result.data.contribution.providerExpenseMinor}; effort
            expense {result.data.contribution.effortExpenseMinor}; subtotal
            before unrecorded inputs{" "}
            {result.data.contribution.netBeforeUnrecordedInputsMinor} minor
            units. Customer-paid Meta:{" "}
            {result.data.contribution.customerPaidMetaMinor ?? "not recorded"}.
          </p>
          <p>{result.data.contribution.coverage}</p>
          {result.data.contribution.evidence.map((e) => (
            <p key={e}>Evidence: {e}</p>
          ))}
          {result.data.criteria.map((c, i) => (
            <p key={i}>
              {c.metric}: {c.observed ?? "unavailable"} ({c.status}); criterion{" "}
              {c.met === null ? "not established" : c.met ? "met" : "not met"}.{" "}
              {c.definition}
            </p>
          ))}
        </div>
      )}
      {reuse.success && (
        <div>
          <p>{reuse.data.differentNeed}</p>
          <p>{reuse.data.adaptations}</p>
          {reuse.data.configuration.map((c, i) => (
            <p key={i}>
              {c.first} ? {c.second}:{" "}
              {c.equal
                ? "same recorded configuration"
                : "adapted configuration"}
              ; evidence {c.evidence}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
