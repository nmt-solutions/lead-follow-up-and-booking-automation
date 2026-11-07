"use client";
import Link from "next/link";
import { z } from "zod";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  taxPeriodScreenSchema,
  saveObligationSchema,
  decideObligationSchema,
  openTaxPeriodSchema,
  prepareTaxReportSchema,
  taxReportActionSchema,
  type TaxPeriodScreen,
  type LiabilityReport,
} from "@/models/tax-periods";
import { readTaxResponse } from "./tax-shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";

function Field({
  label,
  name,
  value = "",
  type = "text",
  required = true,
}: {
  label: string;
  name: string;
  value?: string;
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
        defaultValue={value}
        required={required}
      />
    </div>
  );
}
function Choice({
  label,
  name,
  value = "",
  children,
}: {
  label: string;
  name: string;
  value?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} name={name} defaultValue={value} required>
        <option value="">Choose explicitly</option>
        {children}
      </NativeSelect>
    </div>
  );
}
function Evidence({
  label = "Supporting evidence (one reference per line)",
  name = "evidence",
  value = "",
}: {
  label?: string;
  name?: string;
  value?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} name={name} defaultValue={value} required />
    </div>
  );
}
const text = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
const lines = (data: FormData, name: string) =>
  text(data, name)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const readable = (value: string) => value.replaceAll("_", " ");
const commandSchemas: Record<string, z.ZodType> = {
  save_obligation: saveObligationSchema,
  decide_obligation: decideObligationSchema,
  open_period: openTaxPeriodSchema,
  prepare: prepareTaxReportSchema,
  review: taxReportActionSchema,
};
const fieldLabels: Record<string, string> = {
  mode: "evidence mode",
  key: "stable reference",
  name: "obligation name",
  jurisdiction: "jurisdiction",
  timeZone: "reporting timezone",
  currency: "reporting currency",
  effectiveFrom: "coverage start (UTC)",
  effectiveUntil: "coverage end (UTC)",
  identifier: "registration identifier",
  status: "registration status",
  evidence: "supporting evidence",
  basis: "reporting basis",
  unissuedCharges: "unissued-charge policy",
  preparerIds: "assigned preparers",
  reviewerIds: "assigned reviewers",
  distinctReviewer: "reviewer policy",
  startDate: "first local date",
  endDate: "excluded next local date",
  dueAt: "due instant (UTC)",
  reminders: "reminder labels and UTC times",
  at: "UTC instant",
  cutoff: "evidence cutoff (UTC)",
  note: "reason",
  obligationId: "approved obligation",
  issueId: "review issue",
};
function money(value: string, currency: string) {
  const n = BigInt(value),
    negative = n < 0n,
    absolute = negative ? -n : n;
  return `${currency} ${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function TaxPeriodManager({ initial }: { initial: TaxPeriodScreen }) {
  const [screen, setScreen] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState("");
  const requests = useRef(new Map<string, { payload: string; key: string }>());
  const focusOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!busy && focusOrigin.current) {
      if (focusOrigin.current.isConnected) focusOrigin.current.focus();
      else document.getElementById("tax-due-title")?.focus();
      focusOrigin.current = null;
    }
  }, [busy]);
  const rememberFocus = () => {
    focusOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const { workspace, emailPreference } = screen;
  const current = workspace.obligations.filter(
    (r) =>
      !workspace.obligations.some(
        (next) => next.key === r.key && next.version > r.version,
      ),
  );
  const selected = current.find((r) => r.id === editing),
    definition = selected?.definition;
  function requestKey(namespace: string, input: unknown) {
    const payload = JSON.stringify(input),
      previous = requests.current.get(namespace);
    if (previous?.payload === payload) return previous.key;
    const key = crypto.randomUUID();
    requests.current.set(namespace, { payload, key });
    return key;
  }
  async function command(
    action: string,
    input: Record<string, unknown>,
    message: string,
    namespace = action,
  ) {
    rememberFocus();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const value = [
        "save_obligation",
        "decide_obligation",
        "open_period",
        "prepare",
        "review",
      ].includes(action)
        ? { ...input, requestKey: requestKey(namespace, input) }
        : input;
      const parsed = commandSchemas[action]?.safeParse(value);
      if (parsed && !parsed.success) {
        const fields = [
          ...new Set(
            parsed.error.issues.map((issue) => {
              const last = issue.path
                .filter((p) => typeof p === "string")
                .at(-1);
              return typeof last === "string"
                ? (fieldLabels[last] ?? "required configuration fields")
                : "coverage dates and distinct reminder stages";
            }),
          ),
        ];
        setError(
          `Check ${fields.join(", ")}. Dates and times need the displayed formats; earlier entries are preserved.`,
        );
        return;
      }
      const response = await fetch("/api/platform/tax/periods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, input: value }),
      });
      setScreen(await readTaxResponse(response, taxPeriodScreenSchema));
      setStatus(message);
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "The action could not be completed. Refresh current tax status.",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveObligation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void command(
      "save_obligation",
      {
        key: text(data, "key"),
        expectedVersion: selected?.version ?? 0,
        note: text(data, "note"),
        definition: {
          mode: text(data, "mode"),
          name: text(data, "name"),
          jurisdiction: text(data, "jurisdiction"),
          timeZone: text(data, "timeZone"),
          currency: text(data, "currency"),
          effectiveFrom: text(data, "effectiveFrom"),
          effectiveUntil: text(data, "effectiveUntil") || null,
          registration: {
            key: text(data, "registrationKey"),
            identifier: text(data, "registrationId"),
            status: text(data, "registrationStatus"),
            effectiveFrom: text(data, "registrationFrom"),
            effectiveUntil: text(data, "registrationUntil") || null,
            evidence: lines(data, "registrationEvidence"),
          },
          basis: text(data, "basis"),
          unissuedCharges: text(data, "unissuedCharges"),
          distinctReviewer: text(data, "reviewPolicy") === "distinct",
          preparerIds: data.getAll("preparer"),
          reviewerIds: data.getAll("reviewer"),
          evidence: lines(data, "evidence"),
        },
      },
      "Obligation revision saved. Review its exact version before use.",
    );
  }
  async function download(report: LiabilityReport) {
    rememberFocus();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/platform/tax/periods/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId: report.id, digest: report.digest }),
      });
      if (!response.ok) {
        await readTaxResponse(response, taxPeriodScreenSchema);
        return;
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `tax-report-${report.id}-r${report.revision}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(
        "Approved report exported. Filing and payment remain separate records.",
      );
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : "Export could not be completed. Refresh review status.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8" aria-busy={busy}>
      {error && (
        <Alert>
          <p>{error}</p>
          <Link href="/security" className="underline">
            Review sign-in and MFA
          </Link>
        </Alert>
      )}
      {status && (
        <p
          role="status"
          className="rounded-xl border border-border bg-muted p-4"
        >
          {status}
        </p>
      )}
      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-6"
        aria-labelledby="tax-due-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="tax-due-title"
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            Due periods and review
          </h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void command(
                "evaluate_reminders",
                {},
                "Configured reminder stages evaluated.",
              )
            }
          >
            Check configured reminders
          </Button>
        </div>
        <p className="text-muted-foreground">
          Each total uses original issued components and a frozen cutoff.
          Collected tax stays separate from revenue. No preparation, approval or
          export confirms filing or payment.
        </p>
        {!workspace.periods.length && (
          <p>
            No reporting periods yet. Approve an evidenced obligation, then add
            its exact dates below.
          </p>
        )}
        <ul className="space-y-6">
          {workspace.periods.map(
            ({ period, report, reports, status: state, overdue }) => (
              <li
                key={period.id}
                className="space-y-4 rounded-xl border border-border p-4 wrap-anywhere"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">
                      {period.obligationKey}: {period.startDate} to{" "}
                      {period.endDate} (end excluded)
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {period.timeZone} · Due {period.dueAt}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{readable(state)}</Badge>
                    {overdue && (
                      <Badge>
                        Due date passed · filing/payment unconfirmed
                      </Badge>
                    )}
                  </div>
                </div>
                <details>
                  <summary className="cursor-pointer py-2 font-medium">
                    Period boundaries and configured evidence
                  </summary>
                  <p>
                    {period.start} inclusive to {period.end} exclusive
                  </p>
                  <p>{period.evidence.join(" · ")}</p>
                  <p>
                    Created by {period.actorName || period.actorId} ·{" "}
                    {period.at}
                  </p>
                </details>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void command(
                      "prepare",
                      {
                        periodId: period.id,
                        expectedRevision: report?.revision ?? 0,
                        cutoff: text(data, "cutoff"),
                        note: text(data, "note"),
                      },
                      "A frozen report revision was prepared.",
                      `prepare:${period.id}`,
                    );
                  }}
                >
                  <fieldset
                    disabled={busy || state === "superseded"}
                    className="grid gap-4 md:grid-cols-2"
                  >
                    <Field
                      name="cutoff"
                      label="Evidence cutoff (UTC, ending in Z)"
                    />
                    <Field name="note" label="Preparation reason" />
                    <div className="md:col-span-2">
                      <Button type="submit">
                        {report
                          ? "Prepare successor revision"
                          : "Prepare report"}
                      </Button>
                    </div>
                  </fieldset>
                </form>
                {report && (
                  <ReportDetails
                    report={report}
                    busy={busy}
                    canReview={report.snapshot.obligation.definition.reviewerIds.includes(
                      workspace.actorId,
                    )}
                    review={(input) =>
                      command(
                        "review",
                        {
                          ...input,
                          reportId: report.id,
                          expectedVersion: report.actions.length,
                        },
                        "Review action recorded.",
                        `review:${report.id}`,
                      )
                    }
                    download={() => void download(report)}
                  />
                )}
                {reports.length > 1 && (
                  <details>
                    <summary className="cursor-pointer py-2 font-medium">
                      Preserved earlier revisions ({reports.length - 1})
                    </summary>
                    {reports.slice(0, -1).map((r) => (
                      <ReportDetails
                        key={r.id}
                        report={r}
                        busy={true}
                        canReview={false}
                        review={async () => {}}
                        download={() => {}}
                      />
                    ))}
                  </details>
                )}
              </li>
            ),
          )}
        </ul>
      </section>
      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-6"
        aria-labelledby="tax-reminder-title"
      >
        <h2 id="tax-reminder-title" className="text-xl font-semibold">
          Reminders
        </h2>
        <p className="text-muted-foreground">
          In-app stages persist once per configured time. Optional email uses
          your verified account and current tax responsibility. Native
          acceptance and delivery remain separate.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void command(
              "email_preference",
              {
                enabled: !emailPreference?.enabled,
                expectedVersion: emailPreference?.version ?? 0,
              },
              "Your tax email preference was saved.",
            )
          }
        >
          {emailPreference?.enabled
            ? "Use in-app reminders only"
            : "Enable my tax reminder emails"}
        </Button>
        <ul className="space-y-2">
          {workspace.reminders.map((r) => (
            <li key={r.id} className="rounded-xl bg-muted p-4 wrap-anywhere">
              <Badge>
                {r.current ? "Available in app" : "Superseded source"}
              </Badge>
              <p>
                {r.stage} · configured for {r.stageAt} ·{" "}
                {readable(r.source.status)}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6"
        aria-labelledby="tax-obligation-title"
      >
        <h2 id="tax-obligation-title" className="text-xl font-semibold">
          Registrations and obligations
        </h2>
        <p className="text-muted-foreground">
          Enter reviewed legal/account inputs explicitly. These records do not
          create a registration, exemption, legal deadline or authority
          integration. Drafts and their exact approval histories are retained.
        </p>
        <Label htmlFor="tax-edit-obligation">
          Edit an obligation or create a new one
        </Label>
        <NativeSelect
          id="tax-edit-obligation"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
        >
          <option value="">New obligation</option>
          {current.map((r) => (
            <option key={r.id} value={r.id}>
              {r.definition.name} · revision {r.version}
            </option>
          ))}
        </NativeSelect>
        <form key={selected?.id ?? "new"} onSubmit={saveObligation}>
          <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
            <Field
              name="key"
              label="Stable obligation reference (lowercase letters, numbers, hyphens)"
              value={selected?.key}
            />
            <Field
              name="name"
              label="Obligation name"
              value={definition?.name}
            />
            <Choice name="mode" label="Evidence mode" value={definition?.mode}>
              <option value="fixture">Fixture</option>
              <option value="live">Live</option>
            </Choice>
            <Field
              name="jurisdiction"
              label="Exact jurisdiction reference from original tax rules"
              value={definition?.jurisdiction}
            />
            <Field
              name="timeZone"
              label="Reporting timezone (IANA name)"
              value={definition?.timeZone}
            />
            <Choice
              name="currency"
              label="Reporting currency"
              value={definition?.currency}
            >
              <option>INR</option>
              <option>USD</option>
            </Choice>
            <Field
              name="effectiveFrom"
              label="Obligation starts (UTC)"
              value={definition?.effectiveFrom}
            />
            <Field
              name="effectiveUntil"
              label="Obligation ends (UTC, optional)"
              value={definition?.effectiveUntil ?? ""}
              required={false}
            />
            <Field
              name="registrationKey"
              label="Registration record reference"
              value={definition?.registration.key}
            />
            <Field
              name="registrationId"
              label="Original registration identifier or reviewed non-requirement reference"
              value={definition?.registration.identifier}
            />
            <Choice
              name="registrationStatus"
              label="Reviewed registration status"
              value={definition?.registration.status}
            >
              <option value="registered">Registered</option>
              <option value="not_required">
                Evidence-backed non-requirement
              </option>
            </Choice>
            <Evidence
              name="registrationEvidence"
              label="Registration review evidence (one reference per line)"
              value={definition?.registration.evidence.join("\n")}
            />
            <Field
              name="registrationFrom"
              label="Registration starts (UTC)"
              value={definition?.registration.effectiveFrom}
            />
            <Field
              name="registrationUntil"
              label="Registration ends (UTC, optional)"
              value={definition?.registration.effectiveUntil ?? ""}
              required={false}
            />
            <Choice
              name="basis"
              label="Reviewed reporting basis"
              value={definition?.basis}
            >
              <option value="document_issue_date">
                Original invoice/credit issue dates
              </option>
            </Choice>
            <Choice
              name="unissuedCharges"
              label="Captured charges without invoices"
              value={definition?.unissuedCharges}
            >
              <option value="require_invoice">
                Require a permanent invoice before approval
              </option>
              <option value="review_exclusion">
                Require evidenced review of exclusion under this basis
              </option>
            </Choice>
            <Choice
              name="reviewPolicy"
              label="Approving reviewer policy"
              value={
                definition
                  ? definition.distinctReviewer
                    ? "distinct"
                    : "same_allowed"
                  : ""
              }
            >
              <option value="distinct">Must differ from the preparer</option>
              <option value="same_allowed">Same person permitted</option>
            </Choice>
            <Field name="note" label="Configuration change reason" />
            {(["preparer", "reviewer"] as const).map((role) => (
              <fieldset
                key={role}
                className="space-y-3 rounded-xl border border-border p-4"
              >
                <legend className="px-1 font-medium">
                  {role === "preparer" ? "Preparers" : "Reviewers"}
                </legend>
                {workspace.operators.map((person) => (
                  <Label
                    key={person.id}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <Checkbox
                      name={role}
                      value={person.id}
                      defaultChecked={Boolean(
                        definition &&
                        (role === "preparer"
                          ? definition.preparerIds
                          : definition.reviewerIds
                        ).includes(person.id),
                      )}
                    />
                    <span className="wrap-anywhere">{person.name}</span>
                  </Label>
                ))}
              </fieldset>
            ))}
            <div className="md:col-span-2">
              <Evidence value={definition?.evidence.join("\n")} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save obligation revision</Button>
            </div>
          </fieldset>
        </form>
        <details>
          <summary className="cursor-pointer py-3 font-medium">
            Versioned obligations and exact decisions
          </summary>
          <ul className="space-y-4">
            {workspace.obligations.map((r) => {
              const ds = workspace.decisions.filter(
                  (d) => d.revisionId === r.id,
                ),
                latest = ds.at(-1);
              return (
                <li
                  key={r.id}
                  className="space-y-3 rounded-xl border border-border p-4 wrap-anywhere"
                >
                  <p className="font-medium">
                    {r.definition.name} · {r.definition.mode} · revision{" "}
                    {r.version} · {latest?.outcome ?? "draft"}
                  </p>
                  <p>
                    {r.definition.jurisdiction} ·{" "}
                    {r.definition.registration.identifier} ·{" "}
                    {r.definition.evidence.join(" · ")}
                  </p>
                  <p className="text-sm">
                    Saved by {r.actorName || r.actorId} · {r.at} · {r.note}
                  </p>
                  <ul>
                    {ds.map((d) => (
                      <li key={d.id}>
                        {d.outcome} · {d.actorName || d.actorId} · {d.at} ·{" "}
                        {d.note}
                      </li>
                    ))}
                  </ul>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const data = new FormData(event.currentTarget);
                      void command(
                        "decide_obligation",
                        {
                          revisionId: r.id,
                          expectedVersion: latest?.version ?? 0,
                          outcome: text(data, "outcome"),
                          note: text(data, "note"),
                        },
                        "Exact configuration decision saved.",
                        `decision:${r.id}`,
                      );
                    }}
                  >
                    <fieldset
                      disabled={busy}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <Choice name="outcome" label="Decision">
                        <option value="approved">
                          Approve this exact revision
                        </option>
                        <option value="withdrawn">
                          Withdraw this revision
                        </option>
                      </Choice>
                      <Field name="note" label="Decision reason" />
                      <Button variant="outline" type="submit">
                        Record configuration decision
                      </Button>
                    </fieldset>
                  </form>
                </li>
              );
            })}
          </ul>
        </details>
      </section>
      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-6"
        aria-labelledby="tax-period-add"
      >
        <h2 id="tax-period-add" className="text-xl font-semibold">
          Add a reporting period
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const reminders = lines(data, "reminders").map((line) => {
              const [key, at] = line.split("|").map((s) => s.trim());
              return { key, at };
            });
            void command(
              "open_period",
              {
                obligationId: text(data, "obligationId"),
                supersedesId: text(data, "supersedesId") || null,
                startDate: text(data, "startDate"),
                endDate: text(data, "endDate"),
                dueAt: text(data, "dueAt"),
                evidence: lines(data, "evidence"),
                reminders,
                note: text(data, "note"),
              },
              "Reporting period saved with explicit dates and reminder stages.",
            );
          }}
        >
          <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
            <Choice name="obligationId" label="Approved current obligation">
              {current
                .filter(
                  (r) =>
                    workspace.decisions
                      .filter((d) => d.revisionId === r.id)
                      .at(-1)?.outcome === "approved",
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.definition.name} · {r.definition.mode}
                  </option>
                ))}
            </Choice>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="tax-timing-successor">
                Correct timing for an existing period (optional)
              </Label>
              <NativeSelect
                id="tax-timing-successor"
                name="supersedesId"
                defaultValue=""
              >
                <option value="">New coverage period</option>
                {workspace.periods
                  .filter((p) => p.status !== "superseded")
                  .map((p) => (
                    <option key={p.period.id} value={p.period.id}>
                      {p.period.obligationKey}: {p.period.startDate} to{" "}
                      {p.period.endDate}
                    </option>
                  ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                A timing correction must keep the same obligation and local
                boundaries. It preserves the old period and approval, supersedes
                old reminders and requires a newly prepared report with explicit
                correction evidence.
              </p>
            </div>
            <Field name="dueAt" label="Configured due date and time (UTC)" />
            <Field
              name="startDate"
              label="First local date (included)"
              type="date"
            />
            <Field
              name="endDate"
              label="Next local date (excluded)"
              type="date"
            />
            <Evidence label="Due-date and boundary evidence (one reference per line)" />
            <Field name="note" label="Period preparation instruction" />
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="tax-reminder-schedule">
                Optional reminder schedule: stage-label | UTC time, one per line
              </Label>
              <Textarea id="tax-reminder-schedule" name="reminders" />
              <p className="text-sm text-muted-foreground">
                Leave blank for no reminders. Every stage needs an explicit
                label and time; no legal interval is inferred.
              </p>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Add reporting period</Button>
            </div>
          </fieldset>
        </form>
      </section>
      <p className="text-muted-foreground">
        Record actual evidenced tax administration or filing costs in{" "}
        <Link href="/platform/costs" className="text-primary underline">
          Operator costs
        </Link>
        . No effort, rate or tax payment is inferred here.
      </p>
    </div>
  );
}

function ReportDetails({
  report,
  busy,
  canReview,
  review,
  download,
}: {
  report: LiabilityReport;
  busy: boolean;
  canReview: boolean;
  review(input: Record<string, unknown>): Promise<void>;
  download(): void;
}) {
  const [kind, setKind] = useState("review"),
    snapshot = report.snapshot;
  return (
    <div className="space-y-4 rounded-xl bg-muted p-4 wrap-anywhere">
      <h4 className="font-semibold">
        Report revision {report.revision} · {readable(report.status)}
      </h4>
      <p className="text-sm">
        Prepared by {report.actorName || report.actorId} · {report.at} · cutoff{" "}
        {snapshot.cutoff}
      </p>
      <dl className="grid gap-4 md:grid-cols-3">
        <div>
          <dt>Net revenue components</dt>
          <dd className="font-semibold tabular-nums">
            {money(snapshot.totals.netMinor, snapshot.currency)}
          </dd>
        </div>
        <div>
          <dt>Collected tax liability</dt>
          <dd className="font-semibold tabular-nums">
            {money(snapshot.totals.taxMinor, snapshot.currency)}
          </dd>
        </div>
        <div>
          <dt>Gross document components</dt>
          <dd className="font-semibold tabular-nums">
            {money(snapshot.totals.totalMinor, snapshot.currency)}
          </dd>
        </div>
      </dl>
      {!snapshot.totalsKnown && (
        <p className="font-medium text-warning">
          Known subtotal only. Required source or currency evidence is missing;
          this is not a complete zero liability.
        </p>
      )}
      <p>Filing unconfirmed · Payment unconfirmed</p>
      <p className="text-sm">
        {snapshot.obligation.definition.distinctReviewer
          ? "Approval requires an assigned reviewer distinct from this preparer."
          : "The configured policy permits the preparer to approve when they are also an assigned reviewer."}
        {!canReview && " Review actions belong to the configured reviewers."}
      </p>
      <p className="text-xs">
        Report {report.id} · SHA-256 {report.digest}
      </p>
      {report.unresolved.length > 0 && (
        <ul className="space-y-2">
          {report.unresolved.map((i) => (
            <li key={i.id}>
              <Badge>Required review</Badge> {readable(i.code)} ·{" "}
              {i.sourceId ?? "period"}
              {!i.resolvable &&
                " · correct the source/configuration and prepare a successor"}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer py-2 font-medium">
          Original tax components and complete source population (
          {snapshot.sources.length})
        </summary>
        <ul className="space-y-4">
          {snapshot.components.map((c, index) => (
            <li key={index}>
              {c.name}: {money(c.amountMinor, snapshot.currency)} ·{" "}
              {c.jurisdiction} · {c.registration} · {readable(c.treatment)} ·
              original rule {c.ruleRevisionId}
            </li>
          ))}
        </ul>
        <ul className="mt-4 space-y-3">
          {snapshot.sources.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-border bg-card p-3"
            >
              <p className="font-medium">
                {s.number ??
                  (s.coveredByDocumentId
                    ? "Invoiced capture"
                    : "Unissued capture")}{" "}
                · {readable(s.kind)} ·{" "}
                {s.included ? "Included" : readable(s.reason)}
              </p>
              <p>
                {s.at ?? "Issue/capture date unknown"} · {s.currency} · artifact{" "}
                {s.artifactState ?? "not issued"}
              </p>
              <p className="text-xs">
                Source {s.id} · Original {s.originalId ?? "none"} · Paid period{" "}
                {s.periodId} · Native payment {s.nativePaymentId ?? "unknown"}
              </p>
              <ul>
                {s.lines.map((l) => (
                  <li key={l.input.id}>
                    {l.input.description}: net {money(l.netMinor, s.currency)},
                    tax {money(l.taxMinor, s.currency)} ·{" "}
                    {l.rule.revision.rule.jurisdiction.code} ·{" "}
                    {l.rule.revision.rule.registration.identifier} ·{" "}
                    {l.components
                      .map(
                        (c) => `${c.name} ${money(c.amountMinor, s.currency)}`,
                      )
                      .join("; ")}
                  </li>
                ))}
              </ul>
              {s.adjustment && (
                <details>
                  <summary className="cursor-pointer py-2 font-medium">
                    Original cumulative credit allocation
                  </summary>
                  <p>{s.adjustment.reason}</p>
                  <p>{s.adjustment.evidence.join(" · ")}</p>
                  <ul>
                    {s.adjustment.cumulative.map((line) => (
                      <li key={line.lineId}>
                        Line {line.lineId}: original net credited{" "}
                        {line.netBefore} to {line.netAfter} minor units;{" "}
                        {line.components
                          .map(
                            (c) =>
                              `${c.name}: ${c.before} to ${c.after} minor units`,
                          )
                          .join("; ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </details>
      {snapshot.adjustments.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 font-medium">
            Confirmed cash and linked credits
          </summary>
          <ul className="space-y-3">
            {snapshot.adjustments.map((a) => (
              <li key={a.id}>
                Actual cash: {money(a.actualMinor, a.currency)} · Permanent
                document credit:{" "}
                {a.creditMinor === null
                  ? "not issued"
                  : money(a.creditMinor, a.currency)}{" "}
                · Unclassified difference:{" "}
                {a.uncreditedDifferenceMinor === null
                  ? "pending credit evidence"
                  : money(a.uncreditedDifferenceMinor, a.currency)}
                <p className="text-sm">
                  {a.source} · {a.nativeId} · credit{" "}
                  {a.creditDocumentId ?? "none"}. Only the linked credit affects
                  the tax aggregate.
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="cursor-pointer py-2 font-medium">
          Attributable review history ({report.actions.length})
        </summary>
        <ol className="space-y-3">
          {report.actions.map((a) => (
            <li key={a.id}>
              {readable(a.kind)} · {a.actorName || a.actorId || "System"} ·{" "}
              {a.at}
              <p>{a.note}</p>
              <p>{a.detail.evidence.join(" · ")}</p>
            </li>
          ))}
        </ol>
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void review({
            kind,
            issueId: text(data, "issueId") || null,
            note: text(data, "note"),
            evidence: lines(data, "evidence"),
          });
        }}
      >
        <fieldset
          disabled={
            busy ||
            !canReview ||
            !report.current ||
            report.status === "superseded"
          }
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="space-y-2">
            <Label htmlFor={`review-kind-${report.id}`}>Review action</Label>
            <NativeSelect
              id={`review-kind-${report.id}`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="review">Record review</option>
              <option value="raise_issue">Raise a required issue</option>
              <option value="resolve_issue">
                Resolve an evidenced review issue
              </option>
              <option value="approve">Approve this frozen revision</option>
            </NativeSelect>
          </div>
          {kind === "resolve_issue" ? (
            <Choice name="issueId" label="Issue to resolve">
              {report.unresolved
                .filter((i) => i.resolvable)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {readable(i.code)} · {i.sourceId}
                  </option>
                ))}
            </Choice>
          ) : kind === "raise_issue" ? (
            <Choice name="issueId" label="Source to review">
              <option value="period">Entire reporting period</option>
              {snapshot.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number ?? s.nativePaymentId ?? s.id}
                </option>
              ))}
            </Choice>
          ) : null}
          <Field name="note" label="Review findings or resolution reason" />
          <Evidence />
          <div className="md:col-span-2">
            <Button type="submit">Record review action</Button>
          </div>
        </fieldset>
      </form>
      <Button
        variant="outline"
        disabled={busy || report.status !== "approved" || !report.current}
        onClick={download}
      >
        Export approved frozen report
      </Button>
    </div>
  );
}
