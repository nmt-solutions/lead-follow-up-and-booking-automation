"use client";
import Link from "next/link";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import {
  taxFilingWorkspaceSchema,
  type TaxFilingWorkspace,
  type FilingIntent,
} from "@/models/tax-filings";
import { readTaxResponse } from "./tax-shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const readable = (s: string) => s.replaceAll("_", " ");
function Field({
  name,
  label,
  value = "",
  type = "text",
  required = true,
}: {
  name: string;
  label: string;
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
  name,
  label,
  children,
  value = "",
}: {
  name: string;
  label: string;
  children: ReactNode;
  value?: string;
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
function Note({
  name = "note",
  label = "Action reason",
}: {
  name?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} name={name} required maxLength={1000} />
    </div>
  );
}
type Command = (
  action: string,
  input: Record<string, unknown>,
) => Promise<void>;
const endpoint = "/api/platform/tax/filings";
export function TaxFilingManager({ initial }: { initial: TaxFilingWorkspace }) {
  const [workspace, setWorkspace] = useState(initial),
    [periodId, setPeriodId] = useState(initial.periods[0]?.period.id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const keys = useRef(new Map<string, string>());
  const selectionId = useId();
  const period = workspace.periods.find((p) => p.period.id === periodId),
    report = period?.report,
    obligationId =
      report?.snapshot.obligation.id ?? period?.period.obligationId,
    policy = workspace.policies
      .filter((p) => p.obligationId === obligationId)
      .at(-1),
    decision = workspace.policyDecisions
      .filter((d) => d.policyId === policy?.id)
      .at(-1),
    approval = report?.actions.filter((a) => a.kind === "approve").at(-1);
  function request(input: Record<string, unknown>, action: string) {
    const fingerprint = JSON.stringify({ action, input });
    let key = keys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(fingerprint, key);
    }
    return { ...input, requestKey: key };
  }
  const command: Command = async (action, input) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const saved = await readTaxResponse(
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, input: request(input, action) }),
        }),
        taxFilingWorkspaceSchema,
      );
      setWorkspace(saved);
      setStatus(
        "Action recorded. Review the saved status and attributable history.",
      );
      keys.current.delete(JSON.stringify({ action, input }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to record this action. Refresh saved status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  function identity() {
    if (!report || !approval)
      throw new Error("Approve the exact current report first.");
    return {
      reportId: report.id,
      periodId: report.periodId,
      revision: report.revision,
      digest: report.digest,
      approvalId: approval.id,
    };
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setWorkspace(
        await readTaxResponse(
          await fetch(endpoint, { cache: "no-store" }),
          taxFilingWorkspaceSchema,
        ),
      );
      setStatus("Saved status refreshed. Form edits remain available.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to refresh saved status.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportReport() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          request(
            {
              ...identity(),
              note: "Approved accounting and filing preparation export",
            },
            "export",
          ),
        ),
      });
      if (!response.ok) {
        await readTaxResponse(response, z.unknown());
        return;
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `tax-accounting-${report?.id}-r${report?.revision}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus(
        "Approved report exported. The export is not filing or payment proof.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to export the approved report.",
      );
    } finally {
      setBusy(false);
    }
  }
  function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void command("save_policy", {
      obligationId,
      expectedVersion: policy?.version ?? 0,
      note: text(f, "note"),
      definition: {
        adapter: "manual_evidence_v1",
        authorityAccount: text(f, "authorityAccount"),
        fundingAccount: text(f, "fundingAccount"),
        returnType: text(f, "returnType"),
        filingRequired: text(f, "filingRequired") === "yes",
        paymentRequired: text(f, "paymentRequired") === "yes",
        effectiveFrom: text(f, "effectiveFrom"),
        effectiveUntil: text(f, "effectiveUntil") || null,
        retention: {
          disposition: "protected_history",
          policyReference: text(f, "retention"),
        },
        evidence: text(f, "evidence").split("\n").filter(Boolean),
      },
    });
  }
  const records = workspace.intents.filter(
    (i) => i.target.periodId === periodId,
  );
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
      <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Period confirmations</h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh saved status
          </Button>
        </div>
        <Label htmlFor={selectionId}>Reporting period</Label>
        <NativeSelect
          id={selectionId}
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          disabled={busy}
        >
          <option value="">Choose a period</option>
          {workspace.periods.map((p) => (
            <option key={p.period.id} value={p.period.id}>
              {p.period.obligationKey} · {p.period.startDate} to{" "}
              {p.period.endDate} · {p.status}
            </option>
          ))}
        </NativeSelect>
        {!period && (
          <p>
            Prepare and approve a period in{" "}
            <Link
              className="text-primary underline"
              href="/platform/tax/periods"
            >
              Tax periods
            </Link>{" "}
            to begin.
          </p>
        )}
        {period && (
          <div className="space-y-3 wrap-anywhere">
            <p>
              {report?.snapshot.obligation.definition.jurisdiction} ·
              Registration{" "}
              {report?.snapshot.obligation.definition.registration.identifier} ·{" "}
              {report?.snapshot.currency} ·{" "}
              {report?.snapshot.obligation.definition.mode}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge>
                {period.filed
                  ? "Filing confirmed by evidence review"
                  : period.filingRequired === false
                    ? "Filing not required by this procedure"
                    : "Filing unconfirmed"}
              </Badge>
              <Badge>
                {period.paid
                  ? "Remittance confirmed"
                  : period.paymentRequired === false
                    ? "Remittance not required by this procedure"
                    : "Remittance incomplete"}
              </Badge>
              <Badge>
                {period.fulfilled
                  ? "Configured requirements satisfied"
                  : "Requirements remain due"}
              </Badge>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt>Liability (minor units)</dt>
                <dd>{period.liabilityMinor ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Confirmed allocation</dt>
                <dd>{period.confirmedPaidMinor}</dd>
              </div>
              <div>
                <dt>Remaining liability</dt>
                <dd>{period.remainingMinor ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Overpayment / unallocated prior payment</dt>
                <dd>
                  {period.overpaidMinor} / {period.unallocatedPaidMinor}
                </dd>
              </div>
            </dl>
            {period.correctionRequired && (
              <p className="font-medium text-warning">
                An earlier revision was filed. Review the correction and create
                an explicit amendment; the original filing remains recorded.
              </p>
            )}
            {period.unresolvedEvidenceCount > 0 && (
              <p className="font-medium text-warning">
                {period.unresolvedEvidenceCount} required evidence issues need
                independent resolution.
              </p>
            )}
            <p className="text-sm">
              Report {report?.id ?? "not prepared"} · revision{" "}
              {report?.revision ?? "—"} · {report?.digest}
            </p>
            <Button
              disabled={
                busy || report?.status !== "approved" || !report.current
              }
              onClick={() => void exportReport()}
            >
              Export approved accounting report
            </Button>
            <p className="text-sm text-muted-foreground">
              This JSON export contains the frozen source evidence and original
              review identities. It is not an authority-specific return format
              or submission receipt.
            </p>
          </div>
        )}
      </section>
      {period && (
        <>
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Supported manual procedure
            </h2>
            <p>
              {period.readiness === "configured"
                ? "A reviewed manual procedure is configured."
                : "Filing and remittance are unavailable until the exact procedure is configured and approved."}{" "}
              No automatic authority or bank connector is enabled.
            </p>
            {policy && (
              <div className="space-y-2">
                <p>
                  Procedure revision {policy.version} ·{" "}
                  {decision?.outcome ?? "Awaiting review"} ·{" "}
                  {policy.definition.authorityAccount} /{" "}
                  {policy.definition.fundingAccount}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void command("decide_policy", {
                      policyId: policy.id,
                      expectedVersion: decision?.version ?? 0,
                      outcome: text(f, "outcome"),
                      note: text(f, "note"),
                    });
                  }}
                >
                  <fieldset
                    disabled={busy}
                    className="grid gap-4 md:grid-cols-2"
                  >
                    <Choice name="outcome" label="Procedure review decision">
                      <option value="approved">Approve exact procedure</option>
                      <option value="withdrawn">Withdraw procedure</option>
                    </Choice>
                    <Field name="note" label="Procedure review reason" />
                    <Button type="submit">Record procedure decision</Button>
                  </fieldset>
                </form>
              </div>
            )}
            <details>
              <summary className="cursor-pointer py-2 font-medium">
                {policy
                  ? "Revise the procedure and retain its earlier versions"
                  : "Configure supported scope"}
              </summary>
              <form
                key={policy?.id ?? obligationId}
                onSubmit={savePolicy}
                className="mt-4"
              >
                <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
                  <Field
                    name="authorityAccount"
                    label="Exact authority account reference"
                    value={policy?.definition.authorityAccount}
                  />
                  <Field
                    name="fundingAccount"
                    label="Exact remitting account reference (no credentials)"
                    value={policy?.definition.fundingAccount}
                  />
                  <Field
                    name="returnType"
                    label="Supported return or obligation type"
                    value={policy?.definition.returnType}
                  />
                  <Field
                    name="effectiveFrom"
                    label="Procedure effective from (UTC, ending in Z)"
                    value={policy?.definition.effectiveFrom}
                  />
                  <Field
                    name="effectiveUntil"
                    label="Effective until (UTC, optional)"
                    value={policy?.definition.effectiveUntil ?? ""}
                    required={false}
                  />
                  <Choice
                    name="filingRequired"
                    label="Does this obligation require a filed return?"
                    value={
                      policy
                        ? policy.definition.filingRequired
                          ? "yes"
                          : "no"
                        : ""
                    }
                  >
                    <option value="yes">Yes, confirmed return required</option>
                    <option value="no">
                      No, explicitly reviewed non-requirement
                    </option>
                  </Choice>
                  <Choice
                    name="paymentRequired"
                    label="Does this obligation require confirmed remittance?"
                    value={
                      policy
                        ? policy.definition.paymentRequired
                          ? "yes"
                          : "no"
                        : ""
                    }
                  >
                    <option value="yes">
                      Yes, full liability must be reconciled
                    </option>
                    <option value="no">
                      No, explicitly reviewed non-requirement
                    </option>
                  </Choice>
                  <Field
                    name="retention"
                    label="Approved preservation and hold policy reference"
                    value={policy?.definition.retention.policyReference}
                  />
                  <Note
                    name="evidence"
                    label="Legal and procedure review evidence (one reference per line)"
                  />
                  <Note label="Configuration reason" />
                  <p className="text-sm text-muted-foreground md:col-span-2">
                    Original filing evidence is protected history. Completion
                    does not delete it or establish a universal legal retention
                    period. Assigned current tax reviewers approve this
                    procedure.
                  </p>
                  <Button type="submit">Save procedure revision</Button>
                </fieldset>
              </form>
            </details>
          </section>
          <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">
              Approve a manual work order
            </h2>
            <p>
              Save the exact report, accounts and amount before any manual
              portal or bank action. An uncertain outcome must be reconciled
              under the same work order.
            </p>
            <form
              key={report?.id ?? periodId}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void command("prepare", {
                  ...identity(),
                  policyId: policy?.id,
                  kind: text(f, "kind"),
                  amountMinor: text(f, "amountMinor"),
                  amendmentOf:
                    text(f, "amendmentOf") === "none"
                      ? null
                      : text(f, "amendmentOf"),
                  supersedesId:
                    text(f, "supersedesId") === "none"
                      ? null
                      : text(f, "supersedesId"),
                  note: text(f, "note"),
                });
              }}
            >
              <fieldset
                disabled={
                  busy ||
                  period.readiness !== "configured" ||
                  report?.status !== "approved" ||
                  !report.current
                }
                className="grid gap-4 md:grid-cols-2"
              >
                <Choice name="kind" label="Manual action">
                  <option value="submission">
                    Submit exact return revision
                  </option>
                  <option value="remittance">
                    Remit an explicit tax amount
                  </option>
                </Choice>
                <Field
                  name="amountMinor"
                  label={`Amount in ${report?.snapshot.currency ?? "original currency"} minor units`}
                  value={report?.snapshot.totals.taxMinor}
                />
                <Choice
                  name="amendmentOf"
                  label="Amendment lineage"
                  value="none"
                >
                  <option value="none">
                    Original submission or remittance
                  </option>
                  {workspace.intents
                    .filter((i) => i.kind === "submission" && i.filed)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        Amend filed report {i.report.id} revision{" "}
                        {i.report.revision}
                      </option>
                    ))}
                </Choice>
                <Choice
                  name="supersedesId"
                  label="Conclusive no-effect replacement lineage"
                  value="none"
                >
                  <option value="none">No superseded work order</option>
                  {workspace.intents
                    .filter(
                      (i) =>
                        i.status === "superseded" &&
                        i.target.periodId === periodId,
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        Replace reviewed no-effect work order {i.id}
                      </option>
                    ))}
                </Choice>
                <Field name="note" label="Work order reason" />
                <Button type="submit">Save work order for approval</Button>
              </fieldset>
            </form>
          </section>
          {records.map((intent) => (
            <IntentPanel
              key={intent.id}
              intent={intent}
              workspace={workspace}
              busy={busy}
              command={command}
              onError={setError}
            />
          ))}
          {workspace.allocations
            .filter(
              (a) =>
                a.currentReportId !== report?.id &&
                workspace.intents.some(
                  (i) =>
                    i.id === a.intentId &&
                    i.target.start === period.period.start &&
                    i.target.end === period.period.end,
                ),
            )
            .map((a) => (
              <section
                key={a.id}
                className="space-y-4 rounded-2xl border border-border bg-card p-6"
              >
                <h2 className="text-xl font-semibold">
                  Review prior remittance allocation
                </h2>
                <p>
                  {a.amountMinor} {a.currency} minor units remain attributed to
                  report {a.currentReportId}. Reallocation retains one actual
                  payment and requires current approved scope.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void command("reconcile_remittance", {
                      ...identity(),
                      allocationId: a.id,
                      expectedVersion:
                        workspace.allocationReviews
                          .filter((r) => r.allocationId === a.id)
                          .at(-1)?.version ?? 0,
                      expectedReportId: a.currentReportId,
                      policyId: policy?.id,
                      note: text(f, "note"),
                    });
                  }}
                >
                  <fieldset
                    disabled={busy || report?.status !== "approved"}
                    className="space-y-4"
                  >
                    <Field
                      name="note"
                      label="Evidence-backed reallocation reason"
                    />
                    <Button type="submit">
                      Reconcile existing payment to this revision
                    </Button>
                  </fieldset>
                </form>
              </section>
            ))}
        </>
      )}
    </div>
  );
}
function IntentPanel({
  intent,
  workspace,
  busy,
  command,
  onError,
}: {
  intent: FilingIntent;
  workspace: TaxFilingWorkspace;
  busy: boolean;
  command: Command;
  onError: (s: string) => void;
}) {
  const [kind, setKind] = useState("approve"),
    [reading, setReading] = useState(false),
    id = useId();
  const artifacts = workspace.evidence.filter(
    (e) => e.reportId === intent.target.reportId,
  );
  const initiationObserved = intent.events.some(
    (e) =>
      e.kind === "attempt" || (e.kind === "acknowledge" && e.detail.matches),
  );
  const canApprove =
    !initiationObserved &&
    intent.authorizationCurrent &&
    !intent.filed &&
    !intent.paid &&
    intent.status !== "superseded" &&
    (intent.status === "awaiting_approval" || intent.reviewRequired) &&
    !intent.unresolvedIssueIds.length;
  const canAttempt =
    !initiationObserved &&
    intent.status === "approved" &&
    !intent.reviewRequired &&
    intent.authorizationCurrent;
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      file = f.get("file");
    if (!(file instanceof File) || !file.size || file.size > 2097152) {
      onError("Choose an original file up to 2 MiB.");
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()),
        chunks: string[] = [];
      for (let at = 0; at < bytes.length; at += 32768)
        chunks.push(String.fromCharCode(...bytes.subarray(at, at + 32768)));
      const digest = await crypto.subtle.digest("SHA-256", bytes),
        sha256 = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      await command("store_evidence", {
        reportId: intent.target.reportId,
        target:
          text(f, "scope") === "unknown"
            ? null
            : { ...intent.target, currency: text(f, "originalCurrency") },
        kind: text(f, "evidenceKind"),
        result: text(f, "result"),
        reference: text(f, "reference"),
        amountMinor: text(f, "amountMinor"),
        occurredAt: text(f, "occurredAt"),
        name: file.name,
        contentType: text(f, "contentType"),
        bytesBase64: btoa(chunks.join("")),
        sha256,
        note: text(f, "note"),
      });
    } catch {
      onError(
        "Unable to read the original file. Your form edits remain available.",
      );
    } finally {
      setReading(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-6 wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {intent.kind === "submission"
            ? "Manual submission"
            : "Manual remittance"}
        </h2>
        <Badge>{readable(intent.status)}</Badge>
      </div>
      <p>
        {intent.amountMinor} {intent.target.currency} minor units ·{" "}
        {intent.target.registration} · {intent.target.authorityAccount} /{" "}
        {intent.target.fundingAccount}
      </p>
      <p className="text-sm">
        {intent.target.jurisdiction} · {intent.target.start} inclusive to{" "}
        {intent.target.end} exclusive · report {intent.report.id} revision{" "}
        {intent.report.revision}
      </p>
      <p className="text-sm">
        Work order {intent.id} · {intent.actorName} · {intent.at}
        {intent.amendmentOf && ` · Amends ${intent.amendmentOf}`}
      </p>
      <p className="text-muted-foreground">
        Operator-entered assertions and reviewed original evidence. The
        application does not verify an authority portal or bank API. Recording
        an attempt or an acknowledgement does not complete this work order.
      </p>
      {intent.reviewRequired && (
        <p className="font-medium text-warning">
          Current source, procedure or evidence review is required. Refresh the
          approved report and confirmed allocation before authorizing any new
          action. Original acknowledgements and actual payments remain recorded.
        </p>
      )}
      {!!intent.unresolvedIssueIds.length && (
        <p className="text-warning">
          Required issues: {intent.unresolvedIssueIds.join(", ")}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            input: Record<string, unknown> = {
              intentId: intent.id,
              expectedVersion: intent.version,
              kind,
              note: text(f, "note"),
            };
          if (kind === "approve") input.basisDigest = intent.currentBasisDigest;
          if (kind === "attempt")
            Object.assign(input, {
              outcome: text(f, "outcome"),
              reference: text(f, "reference"),
              occurredAt: text(f, "occurredAt"),
            });
          if (
            kind === "acknowledge" ||
            kind === "raise_issue" ||
            kind === "resolve_issue" ||
            kind === "supersede"
          )
            input.evidenceId = text(f, "evidenceId");
          if (kind === "confirm")
            input.acknowledgementId = text(f, "acknowledgementId");
          if (kind === "resolve_issue") input.issueId = text(f, "issueId");
          void command("act", input);
        }}
      >
        <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={id}>Next attributable action</Label>
            <NativeSelect
              id={id}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="approve">Approve exact work order</option>
              <option value="attempt">
                Record manual attempt or initiation
              </option>
              <option value="acknowledge">
                Record evidence acknowledgement
              </option>
              <option value="confirm">
                Independently confirm original evidence
              </option>
              <option value="raise_issue">Raise a required review issue</option>
              <option value="resolve_issue">Resolve a required issue</option>
              <option value="supersede">
                Supersede using conclusive no-effect evidence
              </option>
            </NativeSelect>
          </div>
          <Field name="note" label="Action reason" />
          {kind === "attempt" && (
            <>
              <Choice name="outcome" label="Observed attempt outcome">
                <option value="pending">Pending; no completion proof</option>
                <option value="unknown">
                  Unknown; reconcile this work order
                </option>
                <option value="failed">
                  Failed attempt; no completion proof
                </option>
              </Choice>
              <Field
                name="reference"
                label="Original submission or initiation reference"
              />
              <Field
                name="occurredAt"
                label="Actual attempt time (UTC, ending in Z)"
              />
            </>
          )}
          {(kind === "acknowledge" ||
            kind === "raise_issue" ||
            kind === "resolve_issue" ||
            kind === "supersede") && (
            <Choice name="evidenceId" label="Retained original supporting file">
              {artifacts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.reference} · {a.result} · {a.amountMinor}{" "}
                  {a.target?.currency ?? "Unknown currency"}
                </option>
              ))}
            </Choice>
          )}
          {kind === "supersede" && (
            <p className="text-sm">
              Only an independent reviewer can supersede this authorization
              using an original source that conclusively establishes no
              submission or transfer. Generic failure or uncertainty is
              insufficient. A previously confirmed filing or payment remains
              recorded.
            </p>
          )}
          {kind === "confirm" && (
            <>
              <Choice
                name="acknowledgementId"
                label="Exact acknowledgement to independently review"
              >
                {intent.events
                  .filter((e) => e.kind === "acknowledge")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {String(e.detail.reference)} · {String(e.detail.result)} ·{" "}
                      {e.actorName}
                    </option>
                  ))}
              </Choice>
              <p className="text-sm">
                A different assigned reviewer must inspect the original file and
                its exact account, period, revision, currency and amount.
                Accepted for processing cannot establish filing; initiation
                cannot establish settled remittance.
              </p>
            </>
          )}
          {kind === "resolve_issue" && (
            <Choice name="issueId" label="Required issue being resolved">
              {intent.unresolvedIssueIds.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Choice>
          )}
          <Button
            type="submit"
            disabled={
              (kind === "approve" && !canApprove) ||
              (kind === "attempt" && !canAttempt)
            }
          >
            Record {readable(kind)}
          </Button>
        </fieldset>
      </form>
      <details>
        <summary className="cursor-pointer py-2 font-medium">
          Retain original evidence and provenance
        </summary>
        {reading && <p role="status">Reading and hashing the original file…</p>}
        <form onSubmit={(e) => void upload(e)} className="mt-4">
          <fieldset
            disabled={busy || reading}
            className="grid gap-4 md:grid-cols-2"
          >
            <Field
              name="file"
              label="Original file (up to 2 MiB)"
              type="file"
            />
            <Choice
              name="scope"
              label="Does the original evidence identify the displayed scope?"
            >
              <option value="known">
                Known account, period and revision; review each displayed
                identity
              </option>
              <option value="unknown">
                Unknown scope; retain unmatched for review
              </option>
            </Choice>
            <Field
              name="originalCurrency"
              label="Original evidence currency (three-letter code; no conversion)"
              value={intent.target.currency}
            />
            <Choice name="contentType" label="Original content type">
              <option value="text/plain">UTF-8 text</option>
              <option value="application/pdf">PDF</option>
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
            </Choice>
            <Choice name="evidenceKind" label="Original evidence source">
              <option value="authority_acknowledgement">
                Authority acknowledgement
              </option>
              <option value="bank_confirmation">
                Bank remittance confirmation
              </option>
              <option value="supporting">
                Other supporting evidence or actual administration expense
              </option>
            </Choice>
            <Choice
              name="result"
              label="What does the original evidence establish?"
            >
              <option value="accepted_for_processing">
                Accepted for processing only
              </option>
              <option value="filed">Final filing acknowledgement</option>
              <option value="settled">Settled bank remittance</option>
              <option value="failed">Failure without conclusive absence</option>
              <option value="unknown">Unresolved or supporting evidence</option>
              <option value="no_effect">
                Conclusive no-submission / no-transfer source
              </option>
            </Choice>
            <Field name="reference" label="Original evidence reference" />
            <Field
              name="occurredAt"
              label="Original fact time (UTC, ending in Z)"
            />
            <Field
              name="amountMinor"
              label="Original amount (minor units)"
              value={intent.amountMinor}
            />
            <Note label="Provenance: actual source and how this original was obtained" />
            <p className="text-sm text-muted-foreground md:col-span-2">
              The file is bound to the displayed work order scope and retained
              with its original bytes and SHA-256. Upload only evidence for this
              registration, authority account, remitting account, period and
              report revision. Incorrect or unknown evidence must be recorded as
              a review issue.
            </p>
            <Button type="submit">Retain original evidence</Button>
          </fieldset>
        </form>
      </details>
      <ul className="space-y-3">
        {artifacts.map((a) => (
          <li key={a.id} className="space-y-1 text-sm">
            <a
              href={`${endpoint}/evidence/${a.id}/content`}
              className="inline-flex min-h-11 items-center text-primary underline"
            >
              Download original {a.name}
            </a>
            <p>
              {a.reference} · {a.verification} · {a.actorName} · {a.occurredAt}
            </p>
            <p>
              SHA-256 {a.sha256} · {a.size} bytes ·{" "}
              {a.retention.policyReference}
            </p>
            <p>
              Original source: {readable(a.kind)} · {readable(a.result)} ·{" "}
              {a.amountMinor} {a.target?.currency ?? "Unknown currency"} minor
              units
            </p>
            <p>Source and provenance: {a.note}</p>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                Review original evidence scope
              </summary>
              {a.target ? (
                <div className="space-y-2">
                  <p>
                    {a.target.jurisdiction} · {a.target.registration} ·{" "}
                    {a.target.mode} · {a.target.returnType}
                  </p>
                  <p>
                    Authority {a.target.authorityAccount} · Remitting account{" "}
                    {a.target.fundingAccount}
                  </p>
                  <p>
                    {a.target.start} inclusive to {a.target.end} exclusive ·{" "}
                    Report {a.target.reportId} revision {a.target.revision}
                  </p>
                </div>
              ) : (
                <p>
                  Unknown account, period or revision scope. This original
                  cannot confirm the displayed work order.
                </p>
              )}
            </details>
            {a.kind === "supporting" && (
              <details>
                <summary className="cursor-pointer py-2 font-medium">
                  Attribute actual administration expense
                </summary>
                <p>
                  {a.amountMinor} {a.target?.currency ?? "Unknown currency"}{" "}
                  minor units · {a.occurredAt}. Separate current cost authority
                  is required. Record only actual filing/preparation expense
                  supported by this original; remitted collected tax is not an
                  operating cost. This evidence identity can be attributed once.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void command("record_expense", {
                      evidenceId: a.id,
                      quantity: Number(text(f, "quantity")),
                      unit: text(f, "unit"),
                      funding: text(f, "funding"),
                      retentionSeconds: Number(text(f, "retentionSeconds")),
                      note: text(f, "note"),
                    });
                  }}
                >
                  <fieldset
                    disabled={busy}
                    className="grid gap-4 md:grid-cols-2"
                  >
                    <Field
                      name="quantity"
                      label="Actual evidenced quantity (no assumed duration)"
                      type="number"
                    />
                    <Choice name="unit" label="Evidenced unit">
                      <option value="filing">Filing</option>
                      <option value="document">Document</option>
                      <option value="service">Service</option>
                      <option value="minute">Measured minute</option>
                      <option value="hour">Measured hour</option>
                    </Choice>
                    <Choice name="funding" label="Actual expense funding">
                      <option value="cash">Operator cash</option>
                      <option value="existing_subscription">
                        Existing subscription allocation
                      </option>
                      <option value="unknown">Unresolved funding</option>
                    </Choice>
                    <Field
                      name="retentionSeconds"
                      label="Approved cost-detail retention (seconds)"
                      type="number"
                    />
                    <Field name="note" label="Actual cost attribution reason" />
                    <Button type="submit">
                      Record evidenced administration expense
                    </Button>
                  </fieldset>
                </form>
                <Link
                  href="/platform/costs"
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  Review original-currency operator costs
                </Link>
              </details>
            )}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer py-2 font-medium">
          Attributable history and frozen report
        </summary>
        <ol className="space-y-4">
          {intent.events.map((e) => (
            <li key={e.id} className="rounded-xl border border-border p-4">
              <p>
                {e.version}. {readable(e.kind)} · {e.actorName} · {e.at}
              </p>
              <p>{e.note}</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs wrap-anywhere">
                {JSON.stringify(e.detail, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
        <pre className="mt-4 whitespace-pre-wrap text-xs wrap-anywhere">
          {JSON.stringify(intent.report, null, 2)}
        </pre>
      </details>
    </section>
  );
}
