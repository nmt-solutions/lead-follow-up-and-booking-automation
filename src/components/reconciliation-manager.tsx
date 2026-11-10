"use client";
import { FieldGroup } from "./ui/field";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { useId, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  reconciliationEvidenceViewSchema,
  reconciliationWorkspaceSchema,
  type ReconciliationWorkspace,
  type ReconciliationEntry,
  type ReconciliationSource,
} from "@/models/reconciliation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";

function Field({
  title,
  children,
}: {
  title: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{title}</Label>
      {children(id)}
    </div>
  );
}
const optional = (v: string) => v.trim() || null;
const now = () => new Date().toISOString();
async function response<T>(r: Response, schema: z.ZodType<T>) {
  const raw: unknown = await r.json().catch(() => null);
  if (!r.ok) {
    const parsed = z.object({ code: z.string() }).safeParse(raw);
    throw Error(
      parsed.success && parsed.data.code === "MFA_REQUIRED"
        ? "Verify in Security and retry. Your entries remain here."
        : parsed.success && parsed.data.code === "CONFLICT"
          ? "Saved evidence or review state changed. Refresh and review the retained history before retrying."
          : "This action could not be confirmed. Check current access and the original evidence, then retry. Your entries remain here.",
    );
  }
  const result = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(raw);
  if (!result.success)
    throw Error(
      "The result could not be read. Refresh saved history before another action.",
    );
  return result.data.data;
}
async function post(action: string, data: unknown) {
  return fetch(`/api/platform/reconciliation/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
type LineForm = {
  sourceId: string;
  nativeId: string;
  converted: string;
  credit: string;
  debit: string;
  fee: string;
  tax: string;
  presentation: string;
  fxNumerator: string;
  fxDenominator: string;
  fxAt: string;
  fxReference: string;
  fxEvidence: string;
  rounding: string;
};
const emptyLine = (): LineForm => ({
  sourceId: "",
  nativeId: "",
  converted: "",
  credit: "",
  debit: "",
  fee: "",
  tax: "",
  presentation: "unavailable",
  fxNumerator: "",
  fxDenominator: "",
  fxAt: "",
  fxReference: "",
  fxEvidence: "",
  rounding: "",
});
type Header = {
  settlementId: string;
  account: string;
  mode: string;
  bankAccountRef: string;
  transferReference: string;
  transferAt: string;
  observedAt: string;
  reference: string;
  note: string;
  currency: string;
  amount: string;
  credit: string;
  debit: string;
  status: string;
  coverage: string;
  fee: string;
  tax: string;
  presentation: string;
  evidenceId: string;
  supersedes: string | null;
};
const emptyHeader = (): Header => ({
  settlementId: "",
  account: "",
  mode: "test",
  bankAccountRef: "",
  transferReference: "",
  transferAt: "",
  observedAt: now(),
  reference: "",
  note: "",
  currency: "INR",
  amount: "",
  credit: "",
  debit: "",
  status: "processed",
  coverage: "unavailable",
  fee: "",
  tax: "",
  presentation: "inclusive",
  evidenceId: "",
  supersedes: null,
});
function sourceChoice(sources: ReconciliationSource[], id: string) {
  for (const source of sources) {
    if (source.periodId === id)
      return {
        source,
        kind: "capture",
        nativeId: source.paymentId,
        minor: source.totals.totalMinor,
      };
    const effect = source.effects.find((e) => e.id === id);
    if (effect)
      return {
        source,
        kind: effect.source,
        nativeId: effect.nativeId,
        minor: effect.actualMinor,
      };
  }
  return null;
}
function amount(value: string | null, currency: string) {
  if (value === null) return "Unavailable";
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return `${currency} ${n < 0n ? "−" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export function ReconciliationManager({
  initial,
}: {
  initial: ReconciliationWorkspace;
}) {
  const [view, setView] = useState(initial),
    [from, setFrom] = useState(initial.period.from),
    [until, setUntil] = useState(initial.period.until),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [header, setHeader] = useState(emptyHeader),
    [lines, setLines] = useState<LineForm[]>([emptyLine()]),
    [extraEvidence, setExtraEvidence] = useState<
      z.infer<typeof reconciliationEvidenceViewSchema>[]
    >([]);
  const [settlementDuplicates, setSettlementDuplicates] = useState<string[]>(
      [],
    ),
    [bankDuplicates, setBankDuplicates] = useState<string[]>([]);
  const [evidenceSource, setEvidenceSource] = useState("provider_statement"),
    [evidenceReference, setEvidenceReference] = useState(""),
    [evidenceNote, setEvidenceNote] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState({
    settlementRecordId: "",
    bankTransactionId: "",
    reference: "",
    transferReference: "",
    bankAccountRef: "",
    valueAt: "",
    observedAt: now(),
    amount: "",
    currency: "INR",
    note: "",
    evidenceId: "",
    supersedes: null as string | null,
  });
  const requests = useRef(new Map<string, string>());
  const evidence = [
    ...view.evidence,
    ...extraEvidence.filter((e) => !view.evidence.some((x) => x.id === e.id)),
  ];
  const sources = [
    ...view.sources,
    ...view.linkedSources.filter(
      (s) => !view.sources.some((x) => x.periodId === s.periodId),
    ),
  ];
  const change = (key: keyof Header, value: string) =>
    setHeader((h) => ({ ...h, [key]: value }));
  const changeLine = (index: number, key: keyof LineForm, value: string) =>
    setLines((old) =>
      old.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    );
  async function refresh() {
    const q = new URLSearchParams({ from, until });
    setView(
      await response(
        await fetch(`/api/platform/reconciliation?${q}`, { cache: "no-store" }),
        reconciliationWorkspaceSchema,
      ),
    );
  }
  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "The action could not be confirmed. Your entries remain here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function command(action: string, payload: Record<string, unknown>) {
    const serialized = JSON.stringify({ action, payload });
    const key = requests.current.get(serialized) ?? crypto.randomUUID();
    requests.current.set(serialized, key);
    const r = await post(action, {
      ...payload,
      requestKey: key,
    });
    const result = await response(r, z.object({ id: z.uuid() }));
    return result;
  }
  function evidenceOptions(source?: string) {
    return (
      <>
        <option value="">Select retained original evidence</option>
        {evidence
          .filter((e) => !source || e.source === source)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.reference} · {e.sha256.slice(0, 12)}
            </option>
          ))}
      </>
    );
  }
  function correct(data: ReconciliationEntry, id: string) {
    if (data.kind === "settlement") {
      setSettlementDuplicates([]);
      setHeader({
        settlementId: data.settlementId,
        account: data.account,
        mode: data.mode,
        bankAccountRef: data.bankAccountRef,
        transferReference: data.transferReference ?? "",
        transferAt: data.transferAt ?? "",
        observedAt: data.observedAt,
        reference: data.reference,
        note: data.note,
        currency: data.money.currency,
        amount: data.money.minor,
        credit: data.creditMinor ?? "",
        debit: data.debitMinor ?? "",
        status: data.status,
        coverage: data.fees.coverage,
        fee: data.fees.amountMinor ?? "",
        tax: data.fees.taxMinor ?? "",
        presentation: data.fees.presentation,
        evidenceId: data.evidenceId,
        supersedes: id,
      });
      setLines(
        data.lines.map((l) => ({
          sourceId: l.sourceId ?? "",
          nativeId: l.nativeId,
          converted: l.convertedMinor ?? "",
          credit: l.creditMinor,
          debit: l.debitMinor,
          fee: l.feeMinor ?? "",
          tax: l.feeTaxMinor ?? "",
          presentation: l.feePresentation,
          fxNumerator: l.conversion?.numerator ?? "",
          fxDenominator: l.conversion?.denominator ?? "",
          fxAt: l.conversion?.effectiveAt ?? "",
          fxReference: l.conversion?.reference ?? "",
          fxEvidence: l.conversion?.evidenceId ?? "",
          rounding: l.conversion?.rounding ?? "half_up",
        })),
      );
      document
        .getElementById("settlement-entry")
        ?.scrollIntoView({ block: "start" });
      document
        .getElementById("settlement-entry")
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true });
    } else {
      setBankDuplicates([]);
      const selected = view.settlements.find(
        (s) =>
          s.data.settlementId === data.settlementId &&
          s.data.account === data.account &&
          s.data.mode === data.mode,
      );
      setReceipt({
        settlementRecordId: selected?.id ?? "",
        bankTransactionId: data.bankTransactionId,
        reference: data.reference,
        transferReference: data.transferReference ?? "",
        bankAccountRef: data.bankAccountRef,
        valueAt: data.valueAt,
        observedAt: data.observedAt,
        amount: data.money.minor,
        currency: data.money.currency,
        note: data.note,
        evidenceId: data.evidenceId,
        supersedes: id,
      });
      document.getElementById("bank-entry")?.scrollIntoView({ block: "start" });
      document
        .getElementById("bank-entry")
        ?.querySelector<HTMLSelectElement>("select")
        ?.focus({ preventScroll: true });
    }
  }
  function duplicateOptions(primary: string | null) {
    const original = view.history.find((r) => r.id === primary);
    if (!original) return [];
    return view.history.filter(
      (r) =>
        r.id !== primary &&
        !view.history.some(
          (x) => x.supersedes === r.id || x.data.supersedesAlso.includes(r.id),
        ) &&
        r.data.kind === original.data.kind &&
        (r.data.kind === "settlement"
          ? r.data.provider === original.data.provider &&
            r.data.account === original.data.account &&
            r.data.mode === original.data.mode &&
            r.data.settlementId === original.data.settlementId
          : original.data.kind === "bank_receipt" &&
            r.data.bankAccountRef === original.data.bankAccountRef &&
            r.data.bankTransactionId === original.data.bankTransactionId),
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <Alert>
        Manual evidence entry records an attributable operator assertion. A
        processed provider settlement is transfer initiation. Bank matching uses
        separately retained bank evidence and never claims native bank
        verification.
      </Alert>
      <div className="flex flex-wrap gap-4">
        <RecoveryLink
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security and MFA
        </RecoveryLink>
        <Link
          href="/platform/subscription-payments"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Original payments
        </Link>
        <Link
          href="/platform/financial-adjustments"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Refunds and disputes
        </Link>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {message && <Alert>{message}</Alert>}
      {busy && <p role="status">Working with retained evidence…</p>}
      <section
        className="flex flex-col gap-4 rounded-2xl border bg-card p-6"
        aria-busy={busy}
      >
        <h2 className="text-xl font-semibold">Report period</h2>
        <p className="text-muted-foreground">
          UTC start inclusive, end exclusive; up to 366 days. Charges use
          capture time; settlements use observation time. Linked original
          charges, lifetime credits, actual deductions and all receipts for
          selected settlements remain visible. Exports include the complete
          selected cohort and correction/review history.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field title="From (UTC ISO timestamp)">
            {(id) => (
              <Input
                id={id}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field title="Until (UTC ISO timestamp)">
            {(id) => (
              <Input
                id={id}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy}
            onClick={() => run(refresh, "Report refreshed.")}
          >
            Load report
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await post("export", { from, until });
                if (!r.ok)
                  throw Error(
                    "Export unavailable. Check current access and the report period.",
                  );
                saveFile(await r.blob(), "subscription-reconciliation.json");
              }, "Complete accounting export downloaded.")
            }
          >
            Download accounting export
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {view.expected.map((t) => (
            <div
              key={t.currency}
              className="flex flex-col gap-2 rounded-xl bg-muted p-4"
            >
              <h3 className="font-semibold">Original {t.currency} charges</h3>
              <p>Gross {amount(t.grossMinor, t.currency)}</p>
              <p>Collected sales tax {amount(t.salesTaxMinor, t.currency)}</p>
              <p>
                Revenue before later credits{" "}
                {amount(t.revenueMinor, t.currency)}
              </p>
              <p>
                Actual refunded cash {amount(t.refundCashMinor, t.currency)}
              </p>
              <p>
                Actual dispute deductions{" "}
                {amount(t.disputeDeductionMinor, t.currency)}
              </p>
              <p>
                Permanent credits {amount(t.creditGrossMinor, t.currency)} ·
                original tax credited {amount(t.creditTaxMinor, t.currency)}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {view.observed.map((t) => (
            <div
              key={`${t.provider}-${t.account}-${t.mode}-${t.currency}`}
              className="flex flex-col gap-2 rounded-xl border p-4 wrap-anywhere"
            >
              <h3 className="font-semibold">
                Observed {t.currency} settlement cohort
              </h3>
              <p className="text-sm text-muted-foreground">
                {t.account} · {t.mode} · {t.recordIds.length} settlements ·{" "}
                {t.coverage.replaceAll("_", " ")}
              </p>
              <p>Expected net {amount(t.expectedNetMinor, t.currency)}</p>
              <p>
                Provider net {amount(t.providerNetMinor, t.currency)} ·
                difference {amount(t.providerDifferenceMinor, t.currency)}
              </p>
              <p>
                Bank observed {amount(t.bankMinor, t.currency)} · difference{" "}
                {amount(t.bankDifferenceMinor, t.currency)}
              </p>
              <p>
                Processing cost {amount(t.processingCostMinor, t.currency)} ·
                fee tax {amount(t.feeTaxMinor, t.currency)}
              </p>
            </div>
          ))}
        </div>
        {!view.sources.length && (
          <p>
            No captured charge falls in this period. Choose the original capture
            period to find a transaction.
          </p>
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Original sources and unresolved coverage ({view.unresolved.length})
          </summary>
          <ul className="flex flex-col gap-3">
            {sources.map((s) => (
              <li
                key={s.periodId}
                className="rounded-xl border p-4 wrap-anywhere"
              >
                {s.businessName} · {s.kind.replaceAll("_", " ")} · {s.paymentId}{" "}
                · {amount(s.totals.totalMinor, s.currency)}
                <p className="text-sm text-muted-foreground">
                  {s.account} · {s.mode} · order {s.orderId} · native invoice{" "}
                  {s.nativeInvoiceId ?? "not applicable to standalone order"} ·
                  seller invoice {s.invoice?.number ?? "unavailable"}
                </p>
                {s.effects.map((e) => (
                  <div key={e.id} className="flex flex-col gap-1">
                    <p>
                      {e.source}: actual {amount(e.actualMinor, e.currency)} ·{" "}
                      {e.nativeId}
                    </p>
                    {e.approvedCredit && (
                      <p>
                        Reviewed original-tax credit basis{" "}
                        {amount(
                          e.approvedCredit.allocation.totals.totalMinor,
                          e.currency,
                        )}{" "}
                        · unclassified residual{" "}
                        {amount(
                          e.approvedCredit.uncreditedDifferenceMinor,
                          e.currency,
                        )}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {e.creditDocumentId
                        ? `Permanent credit document ${e.creditDocumentId}`
                        : "No permanent credit document recorded for this effect."}
                    </p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <ul>
            {view.unresolved.map((u, i) => (
              <li key={`${u.sourceId}-${i}`} className="py-2 wrap-anywhere">
                {u.reason.replaceAll("_", " ")} · {u.sourceId}
              </li>
            ))}
          </ul>
        </details>
      </section>
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Retain original evidence</h2>
        <p className="text-muted-foreground">
          Upload the exact original statement or conversion confirmation (PDF,
          UTF-8 text or CSV, up to 256 KiB). Evidence stays private and is
          retained with its original hash. Use a masked bank account reference
          elsewhere.
        </p>
        <fieldset disabled={busy} className="contents">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!file || file.size > 262144)
                  throw Error("Choose an original file up to 256 KiB.");
                const bytes = new Uint8Array(await file.arrayBuffer());
                let raw = "";
                for (const b of bytes) raw += String.fromCharCode(b);
                const contentType = file.name.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : file.name.toLowerCase().endsWith(".csv")
                    ? "text/csv"
                    : "text/plain";
                const payload = {
                  source: evidenceSource,
                  reference: evidenceReference,
                  note: evidenceNote,
                  name: file.name,
                  contentType,
                  contentBase64: btoa(raw),
                };
                const serialized = JSON.stringify(payload);
                const key =
                  requests.current.get(serialized) ?? crypto.randomUUID();
                requests.current.set(serialized, key);
                const saved = await response(
                  await post("evidence", {
                    ...payload,
                    requestKey: key,
                  }),
                  reconciliationEvidenceViewSchema,
                );
                setExtraEvidence((old) => [
                  ...old.filter((x) => x.id !== saved.id),
                  saved,
                ]);
              }, "Original evidence retained. Select it in the corresponding entry.");
            }}
          >
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field title="Evidence source">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={evidenceSource}
                      onChange={(e) => setEvidenceSource(e.target.value)}
                    >
                      <option value="provider_statement">
                        Provider statement
                      </option>
                      <option value="bank_statement">
                        Independently observed bank statement
                      </option>
                      <option value="conversion_confirmation">
                        Authoritative conversion confirmation
                      </option>
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Original source / statement reference">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      maxLength={200}
                      value={evidenceReference}
                      onChange={(e) => setEvidenceReference(e.target.value)}
                    />
                  )}
                </Field>
                <Field title="Original file">
                  {(id) => (
                    <Input
                      id={id}
                      type="file"
                      accept=".pdf,.txt,.csv"
                      required
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  )}
                </Field>
                <Field title="Attributable evidence note">
                  {(id) => (
                    <Textarea
                      id={id}
                      required
                      maxLength={2000}
                      value={evidenceNote}
                      onChange={(e) => setEvidenceNote(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button disabled={busy}>Retain original evidence</Button>
            </FieldGroup>
          </form>
        </fieldset>
        <ul className="flex flex-col gap-3">
          {evidence.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-2 rounded-xl border p-4 wrap-anywhere"
            >
              <p>
                {e.reference} · {e.source.replaceAll("_", " ")} · {e.bytes}{" "}
                bytes
              </p>
              <p className="font-mono text-xs">SHA-256 {e.sha256}</p>
              <p className="text-sm text-muted-foreground">
                Asserted by {e.actorId} · {e.at}
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const grant = await response(
                      await post("access", { evidenceId: e.id }),
                      z.object({
                        token: z.string(),
                        evidenceId: z.uuid(),
                        expiresAt: z.string(),
                      }),
                    );
                    const r = await post("content", {
                      evidenceId: e.id,
                      token: grant.token,
                    });
                    if (!r.ok)
                      throw Error(
                        "Evidence access expired or current reconciliation authority is unavailable. Request a fresh download.",
                      );
                    saveFile(await r.blob(), e.name);
                  }, "Original evidence downloaded under current access.")
                }
              >
                Download original evidence
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section
        id="settlement-entry"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-6"
      >
        <h2 className="text-xl font-semibold">
          {header.supersedes
            ? "Correct retained settlement"
            : "Record provider settlement"}
        </h2>
        <p className="text-muted-foreground">
          Transcribe authoritative debit/credit totals and their coverage. Fee
          tax is a processing expense component, separate from collected sales
          tax. Select aggregate or line coverage once; included lines are never
          charged again. Empty evidence fields mean unavailable.
        </p>
        <fieldset disabled={busy} className="contents">
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const payload = {
                  kind: "settlement",
                  supersedes: header.supersedes,
                  supersedesAlso: header.supersedes ? settlementDuplicates : [],
                  evidenceId: header.evidenceId,
                  provider: "razorpay",
                  account: header.account,
                  mode: header.mode,
                  observedAt: header.observedAt,
                  reference: header.reference,
                  note: header.note,
                  settlementId: header.settlementId,
                  bankAccountRef: header.bankAccountRef,
                  transferReference: optional(header.transferReference),
                  transferAt: optional(header.transferAt),
                  status: header.status,
                  period: view.period,
                  money: {
                    currency: header.currency,
                    precision: 2,
                    minor: header.amount,
                  },
                  creditMinor: optional(header.credit),
                  debitMinor: optional(header.debit),
                  fees: {
                    coverage: header.coverage,
                    amountMinor: optional(header.fee),
                    taxMinor: optional(header.tax),
                    presentation: header.presentation,
                  },
                  lines: lines.map((l) => {
                    const selected = sourceChoice(sources, l.sourceId);
                    return {
                      kind: selected?.kind ?? "unclassified",
                      sourceId: selected ? l.sourceId : null,
                      businessId: selected?.source.businessId ?? null,
                      paymentId: selected?.source.paymentId ?? null,
                      nativeId: selected?.nativeId ?? l.nativeId,
                      nativeInvoiceId: selected?.source.nativeInvoiceId ?? null,
                      orderId: selected?.source.orderId ?? null,
                      original: selected
                        ? {
                            currency: selected.source.currency,
                            precision: 2,
                            minor: selected.minor,
                          }
                        : null,
                      convertedMinor: optional(l.converted),
                      conversion:
                        l.fxNumerator || l.fxDenominator
                          ? {
                              numerator: l.fxNumerator,
                              denominator: l.fxDenominator,
                              units: "target_minor_per_source_minor",
                              effectiveAt: l.fxAt,
                              rounding: l.rounding,
                              evidenceId: l.fxEvidence,
                              reference: l.fxReference,
                            }
                          : null,
                      creditMinor: l.credit,
                      debitMinor: l.debit,
                      feeMinor: optional(l.fee),
                      feeTaxMinor: optional(l.tax),
                      feePresentation: l.presentation,
                    };
                  }),
                };
                await command("record", payload);
                await refresh();
                setHeader(emptyHeader());
                setLines([emptyLine()]);
              }, "Settlement assertion retained. Review differences against the independent bank statement.");
            }}
          >
            <FieldGroup className="gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["settlementId", "Native settlement ID"],
                    ["account", "Original provider account identity"],
                    ["bankAccountRef", "Masked bank account reference"],
                    [
                      "transferReference",
                      "UTR / transfer reference (if available)",
                    ],
                    [
                      "transferAt",
                      "Transfer initiation time (UTC ISO, if available)",
                    ],
                    ["observedAt", "Statement observation time (UTC ISO)"],
                    ["reference", "Original statement row reference"],
                    ["amount", "Transfer amount in minor units"],
                    [
                      "credit",
                      "Authoritative total credits in minor units (if available)",
                    ],
                    [
                      "debit",
                      "Authoritative total debits in minor units (if available)",
                    ],
                  ] satisfies [keyof Header, string][]
                ).map(([key, title]) => (
                  <Field key={key} title={title}>
                    {(id) => (
                      <Input
                        id={id}
                        value={header[key] ?? ""}
                        onChange={(e) => change(key, e.target.value)}
                        required={[
                          "settlementId",
                          "account",
                          "bankAccountRef",
                          "observedAt",
                          "reference",
                          "amount",
                        ].includes(key)}
                      />
                    )}
                  </Field>
                ))}
                <Field title="Provider mode">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={header.mode}
                      onChange={(e) => change("mode", e.target.value)}
                    >
                      {["test", "live", "fixture"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Settlement currency">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={header.currency}
                      onChange={(e) => change("currency", e.target.value)}
                    >
                      <option>INR</option>
                      <option>USD</option>
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Native settlement status">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={header.status}
                      onChange={(e) => change("status", e.target.value)}
                    >
                      {["created", "processed", "failed"].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Retained provider statement">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      required
                      value={header.evidenceId}
                      onChange={(e) => change("evidenceId", e.target.value)}
                    >
                      {evidenceOptions("provider_statement")}
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Fee coverage used once">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={header.coverage}
                      onChange={(e) => change("coverage", e.target.value)}
                    >
                      <option value="unavailable">Unavailable</option>
                      <option value="lines">Transaction lines</option>
                      <option value="aggregate">
                        Settlement aggregate (included lines are context)
                      </option>
                    </NativeSelect>
                  )}
                </Field>
                {header.coverage === "aggregate" && (
                  <>
                    <Field title="Aggregate reported fee minor units">
                      {(id) => (
                        <Input
                          id={id}
                          value={header.fee}
                          onChange={(e) => change("fee", e.target.value)}
                        />
                      )}
                    </Field>
                    <Field title="Aggregate fee tax minor units">
                      {(id) => (
                        <Input
                          id={id}
                          value={header.tax}
                          onChange={(e) => change("tax", e.target.value)}
                        />
                      )}
                    </Field>
                    <Field title="Aggregate fee presentation">
                      {(id) => (
                        <NativeSelect
                          id={id}
                          value={header.presentation}
                          onChange={(e) =>
                            change("presentation", e.target.value)
                          }
                        >
                          <option value="inclusive">
                            Reported fee includes fee tax
                          </option>
                          <option value="exclusive">
                            Reported fee excludes fee tax
                          </option>
                          <option value="unavailable">Unavailable</option>
                        </NativeSelect>
                      )}
                    </Field>
                  </>
                )}
              </div>
              {lines.map((l, index) => (
                <fieldset
                  key={index}
                  className="flex flex-col gap-4 rounded-xl border p-4"
                >
                  <legend className="px-2 font-medium">
                    Transaction {index + 1}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field title="Canonical original charge or actual deduction">
                      {(id) => (
                        <NativeSelect
                          id={id}
                          value={l.sourceId}
                          onChange={(e) => {
                            changeLine(index, "sourceId", e.target.value);
                            const selected = sourceChoice(
                              sources,
                              e.target.value,
                            );
                            if (selected) {
                              change("account", selected.source.account);
                              change("mode", selected.source.mode);
                            }
                          }}
                        >
                          <option value="">
                            Unclassified provider movement (requires review)
                          </option>
                          {sources.flatMap((s) => [
                            <option key={s.periodId} value={s.periodId}>
                              {s.businessName} · {s.paymentId} · {s.currency}{" "}
                              {s.totals.totalMinor} minor
                            </option>,
                            ...s.effects.map((e) => (
                              <option key={e.id} value={e.id}>
                                {s.businessName} · {e.source} {e.nativeId} ·{" "}
                                {e.currency} {e.actualMinor} minor
                              </option>
                            )),
                          ])}
                        </NativeSelect>
                      )}
                    </Field>
                    {!l.sourceId && (
                      <Field title="Unclassified native row reference">
                        {(id) => (
                          <Input
                            id={id}
                            required
                            value={l.nativeId}
                            onChange={(e) =>
                              changeLine(index, "nativeId", e.target.value)
                            }
                          />
                        )}
                      </Field>
                    )}
                    {(
                      [
                        [
                          "converted",
                          "Observed gross in settlement minor units (if available)",
                        ],
                        ["credit", "Observed row credit minor units"],
                        ["debit", "Observed row debit minor units"],
                        ["fee", "Reported row fee minor units (if available)"],
                        [
                          "tax",
                          "Reported row fee tax minor units (if available)",
                        ],
                      ] satisfies [keyof LineForm, string][]
                    ).map(([key, title]) => (
                      <Field key={key} title={title}>
                        {(id) => (
                          <Input
                            id={id}
                            value={l[key]}
                            required={key === "credit" || key === "debit"}
                            onChange={(e) =>
                              changeLine(index, key, e.target.value)
                            }
                          />
                        )}
                      </Field>
                    ))}
                    <Field title="Row fee presentation">
                      {(id) => (
                        <NativeSelect
                          id={id}
                          value={l.presentation}
                          onChange={(e) =>
                            changeLine(index, "presentation", e.target.value)
                          }
                        >
                          <option value="unavailable">Unavailable</option>
                          <option value="inclusive">
                            Fee includes its tax
                          </option>
                          <option value="exclusive">
                            Fee excludes its tax
                          </option>
                        </NativeSelect>
                      )}
                    </Field>
                  </div>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3">
                      Explicit actual FX evidence
                    </summary>
                    <p className="mb-4 text-sm text-muted-foreground">
                      Native captured base amounts may establish capture
                      conversion. Refund conversion needs its own evidence.
                      Planning rates never qualify. Enter target minor units per
                      source minor unit as an exact rational rate.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(
                        [
                          ["fxNumerator", "Target minor-unit numerator"],
                          ["fxDenominator", "Source minor-unit denominator"],
                          ["fxAt", "Conversion effective time (UTC ISO)"],
                          ["fxReference", "Conversion source reference"],
                        ] satisfies [keyof LineForm, string][]
                      ).map(([key, title]) => (
                        <Field key={key} title={title}>
                          {(id) => (
                            <Input
                              id={id}
                              value={l[key]}
                              onChange={(e) =>
                                changeLine(index, key, e.target.value)
                              }
                            />
                          )}
                        </Field>
                      ))}
                      <Field title="Retained authoritative conversion evidence">
                        {(id) => (
                          <NativeSelect
                            id={id}
                            value={l.fxEvidence}
                            onChange={(e) =>
                              changeLine(index, "fxEvidence", e.target.value)
                            }
                          >
                            {evidenceOptions("conversion_confirmation")}
                          </NativeSelect>
                        )}
                      </Field>
                      <Field title="Original conversion rounding">
                        {(id) => (
                          <NativeSelect
                            id={id}
                            value={l.rounding}
                            onChange={(e) =>
                              changeLine(index, "rounding", e.target.value)
                            }
                          >
                            <option value="">
                              Select the original conversion rounding
                            </option>
                            <option value="half_up">Half up</option>
                            <option value="floor">Floor</option>
                          </NativeSelect>
                        )}
                      </Field>
                    </div>
                  </details>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setLines((old) => old.filter((_, i) => i !== index))
                      }
                    >
                      Remove transaction {index + 1}
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={busy || lines.length >= 1000}
                onClick={() => setLines((old) => [...old, emptyLine()])}
              >
                Add transaction
              </Button>
              {header.supersedes &&
                duplicateOptions(header.supersedes).length > 0 && (
                  <Field title="Additional retained duplicate copies replaced by this complete correction (optional)">
                    {(id) => (
                      <NativeSelect
                        id={id}
                        multiple
                        value={settlementDuplicates}
                        onChange={(e) =>
                          setSettlementDuplicates(
                            [...e.target.selectedOptions].map((o) => o.value),
                          )
                        }
                      >
                        {duplicateOptions(header.supersedes).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.data.reference} · {r.id}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              <Field title="Assertion / correction explanation">
                {(id) => (
                  <Textarea
                    id={id}
                    required
                    maxLength={2000}
                    value={header.note}
                    onChange={(e) => change("note", e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy}>Retain settlement assertion</Button>
                {header.supersedes && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setHeader(emptyHeader());
                      setLines([emptyLine()]);
                    }}
                  >
                    Cancel correction
                  </Button>
                )}
              </div>
            </FieldGroup>
          </form>
        </fieldset>
      </section>
      <section
        id="bank-entry"
        className="flex flex-col gap-4 rounded-2xl border bg-card p-6"
      >
        <h2 className="text-xl font-semibold">
          {receipt.supersedes
            ? "Correct retained bank receipt"
            : "Record independent bank receipt"}
        </h2>
        <p className="text-muted-foreground">
          Enter each observed bank transaction once. Partial credits accumulate
          only when provider account, mode, masked account, currency, transfer
          reference and value date support the link. Equal amounts alone never
          establish a match.
        </p>
        <fieldset disabled={busy} className="contents">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const selected = view.settlements.find(
                  (s) => s.id === receipt.settlementRecordId,
                );
                if (!selected) throw Error("Select the original settlement.");
                await command("record", {
                  kind: "bank_receipt",
                  provider: "razorpay",
                  account: selected.data.account,
                  mode: selected.data.mode,
                  settlementId: selected.data.settlementId,
                  supersedes: receipt.supersedes,
                  supersedesAlso: receipt.supersedes ? bankDuplicates : [],
                  evidenceId: receipt.evidenceId,
                  observedAt: receipt.observedAt,
                  reference: receipt.reference,
                  note: receipt.note,
                  bankTransactionId: receipt.bankTransactionId,
                  bankAccountRef: receipt.bankAccountRef,
                  transferReference: optional(receipt.transferReference),
                  valueAt: receipt.valueAt,
                  money: {
                    currency: receipt.currency,
                    precision: 2,
                    minor: receipt.amount,
                  },
                });
                await refresh();
                setReceipt((old) => ({
                  ...old,
                  bankTransactionId: "",
                  reference: "",
                  amount: "",
                  supersedes: null,
                }));
              }, "Bank observation retained; differences remain visible.");
            }}
          >
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field title="Original provider settlement">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      required
                      value={receipt.settlementRecordId}
                      onChange={(e) =>
                        setReceipt((old) => ({
                          ...old,
                          settlementRecordId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select settlement</option>
                      {view.settlements.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.data.settlementId} · {s.data.account} ·{" "}
                          {s.data.mode}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field title="Retained independent bank statement">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      required
                      value={receipt.evidenceId}
                      onChange={(e) =>
                        setReceipt((old) => ({
                          ...old,
                          evidenceId: e.target.value,
                        }))
                      }
                    >
                      {evidenceOptions("bank_statement")}
                    </NativeSelect>
                  )}
                </Field>
                {(
                  [
                    ["bankTransactionId", "Unique bank transaction ID"],
                    ["reference", "Original bank statement row reference"],
                    [
                      "bankAccountRef",
                      "Observed masked bank account reference",
                    ],
                    ["transferReference", "Observed UTR / transfer reference"],
                    ["valueAt", "Bank value date (YYYY-MM-DD) or UTC ISO time"],
                    ["observedAt", "Observation time (UTC ISO)"],
                    ["amount", "Observed credit in minor units"],
                  ] satisfies [keyof typeof receipt, string][]
                ).map(([key, title]) => (
                  <Field key={key} title={title}>
                    {(id) => (
                      <Input
                        id={id}
                        required
                        value={receipt[key] ?? ""}
                        onChange={(e) =>
                          setReceipt((old) => ({
                            ...old,
                            [key]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </Field>
                ))}
                <Field title="Observed bank currency">
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={receipt.currency}
                      onChange={(e) =>
                        setReceipt((old) => ({
                          ...old,
                          currency: e.target.value,
                        }))
                      }
                    >
                      <option>INR</option>
                      <option>USD</option>
                    </NativeSelect>
                  )}
                </Field>
              </div>
              {receipt.supersedes &&
                duplicateOptions(receipt.supersedes).length > 0 && (
                  <Field title="Additional retained duplicate bank copies replaced by this complete correction (optional)">
                    {(id) => (
                      <NativeSelect
                        id={id}
                        multiple
                        value={bankDuplicates}
                        onChange={(e) =>
                          setBankDuplicates(
                            [...e.target.selectedOptions].map((o) => o.value),
                          )
                        }
                      >
                        {duplicateOptions(receipt.supersedes).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.data.reference} · {r.id}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                )}
              <Field title="Bank observation / correction explanation">
                {(id) => (
                  <Textarea
                    id={id}
                    required
                    maxLength={2000}
                    value={receipt.note}
                    onChange={(e) =>
                      setReceipt((old) => ({ ...old, note: e.target.value }))
                    }
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy}>Retain bank receipt assertion</Button>
                {receipt.supersedes && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() =>
                      setReceipt((old) => ({ ...old, supersedes: null }))
                    }
                  >
                    Cancel correction
                  </Button>
                )}
              </div>
            </FieldGroup>
          </form>
        </fieldset>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">
          Expected, observed and differences
        </h2>
        {!view.settlements.length && (
          <p>
            No settlement observation in this period. Retain the original
            statement and record its settlement above.
          </p>
        )}
        {view.settlements.map((s) => (
          <SettlementReview
            key={s.id}
            settlement={s}
            evidence={evidence}
            busy={busy}
            run={run}
            review={async (outcome, note, evidenceId) => {
              await command("review", {
                recordId: s.id,
                reportHash: s.reportHash,
                outcome,
                note,
                evidenceIds: [evidenceId],
              });
              await refresh();
            }}
            correct={() => correct(s.data, s.id)}
          />
        ))}
      </section>
      <details className="rounded-2xl border bg-card p-6">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Retained corrections, duplicate evidence and unlinked receipts
        </summary>
        <p className="mb-4 text-muted-foreground">
          Corrections append a superseding record. Original statements and
          review discrepancies remain in the accounting export.
        </p>
        <ul className="flex flex-col gap-3">
          {view.history.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-xl border p-4 wrap-anywhere"
            >
              <p>
                {r.data.kind.replaceAll("_", " ")} · {r.data.reference} · {r.at}{" "}
                · asserted by {r.actorId}
              </p>
              {r.supersedes && <p>Supersedes {r.supersedes}</p>}
              {r.data.supersedesAlso.length > 0 && (
                <p>Also supersedes {r.data.supersedesAlso.join(", ")}</p>
              )}
              {view.reviews
                .filter((x) => x.recordId === r.id)
                .map((review) => (
                  <details key={review.id}>
                    <summary className="min-h-11 cursor-pointer py-3">
                      Original {review.outcome} · {review.at} · {review.actorId}
                    </summary>
                    <p>{review.note}</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                      {JSON.stringify(review.discrepancy, null, 2)}
                    </pre>
                  </details>
                ))}
              <Button
                variant="outline"
                disabled={
                  busy ||
                  view.history.some(
                    (x) =>
                      x.supersedes === r.id ||
                      x.data.supersedesAlso.includes(r.id),
                  )
                }
                onClick={() => correct(r.data, r.id)}
              >
                Prepare correction
              </Button>
            </li>
          ))}
          {view.unlinkedReceipts.map((r) => (
            <li key={r.id}>
              Unlinked bank receipt: {r.data.reference}. Select the original
              settlement period to investigate.
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
function SettlementReview({
  settlement: s,
  evidence,
  busy,
  run,
  review,
  correct,
}: {
  settlement: ReconciliationWorkspace["settlements"][number];
  evidence: z.infer<typeof reconciliationEvidenceViewSchema>[];
  busy: boolean;
  run: (work: () => Promise<void>, success: string) => Promise<void>;
  review: (outcome: string, note: string, evidenceId: string) => Promise<void>;
  correct: () => void;
}) {
  const [note, setNote] = useState(""),
    [evidenceId, setEvidenceId] = useState("");
  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-card p-6 wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          Settlement {s.data.settlementId}
        </h3>
        <Badge>{s.status.replaceAll("_", " ")}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Operator assertion · {s.data.account} · {s.data.mode} · {s.actorId} ·{" "}
        {s.at}
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ["Expected converted net", s.expectedNetMinor],
          ["Observed provider net", s.observedNetMinor],
          ["Provider difference", s.providerDifferenceMinor],
          ["Transfer difference", s.transferDifferenceMinor],
          ["Processing cost excluding fee tax", s.processingCostMinor],
          ["Processing fee tax", s.feeTaxMinor],
          ["Observed matched bank credits", s.bankObservedMinor],
          ["Bank difference", s.bankDifferenceMinor],
        ].map(([title, value]) => (
          <div key={title}>
            <dt className="text-sm text-muted-foreground">{title}</dt>
            <dd className="font-medium tabular-nums">
              {amount(value, s.data.money.currency)}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-2">
        {s.reasons.map((reason) => (
          <li key={reason}>{reason.replaceAll("_", " ")}</li>
        ))}
      </ul>
      <details>
        <summary className="min-h-11 cursor-pointer py-3">
          Independent bank observations ({s.receipts.length})
        </summary>
        <ul className="flex flex-col gap-3">
          {s.receipts.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 rounded-xl border p-4"
            >
              <p>
                {r.data.reference} ·{" "}
                {amount(r.data.money.minor, r.data.money.currency)} ·{" "}
                {r.matched
                  ? "Matched operator assertion"
                  : "Unmatched operator assertion"}
              </p>
              {r.data.kind === "bank_receipt" && (
                <p>Supplied bank value: {r.data.valueAt}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {r.valueTimePrecision === "date_only"
                  ? "Calendar date only. Bank time and timezone are unknown; matching establishes calendar-date compatibility."
                  : "Supplied UTC time. Matching remains an operator assertion."}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <Button variant="outline" disabled={busy} onClick={correct}>
        Prepare settlement correction
      </Button>
      <fieldset disabled={busy} className="contents">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => review("acknowledged", note, evidenceId),
              "Review acknowledgement retained with the original discrepancy.",
            );
          }}
        >
          <FieldGroup className="gap-4">
            <Field title="Review explanation">
              {(id) => (
                <Textarea
                  id={id}
                  required
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <Field title="Supporting retained evidence">
              {(id) => (
                <NativeSelect
                  id={id}
                  required
                  value={evidenceId}
                  onChange={(e) => setEvidenceId(e.target.value)}
                >
                  <option value="">Select evidence</option>
                  {evidence.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.reference}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy}>
                Acknowledge discrepancy
              </Button>
              <Button
                type="button"
                disabled={busy || s.reasons.length > 0 || !note || !evidenceId}
                onClick={() =>
                  run(
                    () => review("resolved", note, evidenceId),
                    "Balanced evidence review recorded as an operator assertion.",
                  )
                }
              >
                Record balanced review
              </Button>
            </div>
          </FieldGroup>
        </form>
      </fieldset>
      <details>
        <summary className="min-h-11 cursor-pointer py-3">
          Review history ({s.reviews.length})
        </summary>
        <ul className="flex flex-col gap-3">
          {s.reviews.map((r) => (
            <li key={r.id}>
              <p>
                {r.outcome} · {r.actorId} · {r.at}
              </p>
              <p>{r.note}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-sm">
                {JSON.stringify(r.discrepancy, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
