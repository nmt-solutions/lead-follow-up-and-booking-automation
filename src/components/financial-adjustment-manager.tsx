"use client";
import { Field, FieldGroup } from "./ui/field";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  adjustmentWorkspaceSchema,
  adjustmentViewSchema,
  adjustmentDetailsSchema,
  disputeActionSchema,
  type AdjustmentView,
} from "@/models/financial-adjustments";
import { formatTaxMoney } from "@/models/tax";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";

type Workspace = z.infer<typeof adjustmentWorkspaceSchema>;
type DisputeForm = {
  summary: string;
  docId: string;
  docHash: string;
  category: z.infer<
    typeof disputeActionSchema
  >["documents"][number]["category"];
};
async function response<T>(r: Response, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await r.json();
  } catch {
    throw Error(
      "The result is unconfirmed. Refresh the saved status before another action. Your edits remain here.",
    );
  }
  if (!r.ok) {
    const code = z.object({ code: z.string() }).safeParse(raw);
    throw Error(
      code.success && code.data.code === "MFA_REQUIRED"
        ? "Verify in Security, then retry. Your edits remain here."
        : code.success &&
            ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(
              code.data.code,
            )
          ? "Current access does not allow this action. Sign in or ask the responsible operator. Your edits remain here."
          : code.success && code.data.code === "CONFLICT"
            ? "The current native status, deadline, reserved amount or saved credit allocation prevents this change. Refresh status and review the original request and credit basis before continuing."
            : "The action could not be confirmed. Check the selected evidence and approved configuration, then refresh status.",
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(raw);
  if (!parsed.success)
    throw Error(
      "The result is unconfirmed. Refresh the saved status before continuing.",
    );
  return parsed.data.data;
}
function Status({ c }: { c: AdjustmentView }) {
  return (
    <div className="flex flex-col gap-3 wrap-anywhere">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {c.kind === "refund" ? "Refund" : "Dispute"} ·{" "}
          {formatTaxMoney(c.amountMinor, c.currency)}
        </h3>
        <Badge>{c.state.replaceAll("_", " ")}</Badge>
      </div>
      <p>
        Original invoice {c.invoiceNumber} · payment{" "}
        <span className="font-mono text-sm">{c.paymentId}</span>
      </p>
      <p>
        {c.access === "block_period"
          ? "Automation for the original paid period is blocked."
          : "This case preserves access to the original paid period."}{" "}
        Original records remain available.
      </p>
      <p>
        Credit note:{" "}
        {
          {
            issued: "Issued; check its artifact status in seller documents.",
            pending: "Pending issuance with current seller-document authority.",
            review_required:
              "The actual deduction differs from the reviewed credit allocation. Operator review is required.",
            not_required:
              "The reviewed dispute policy does not issue a credit note for this outcome.",
            not_applicable:
              "No credit note is applicable to the current provider status.",
          }[c.creditState]
        }
      </p>
      {c.observation && (
        <p>
          Credit-note basis: {formatTaxMoney(c.creditAmountMinor, c.currency)}.
          Native money and tax-document amounts remain separate records.
        </p>
      )}
      {c.observation && (
        <dl className="grid gap-2 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium">Native reference: </dt>
            <dd className="inline">{c.observation.nativeId}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Created: </dt>
            <dd className="inline">{c.observation.createdAt}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Provider result recorded: </dt>
            <dd className="inline">{c.observation.observedAt}</dd>
          </div>
          {c.observation.phase && (
            <div>
              <dt className="inline font-medium">Dispute phase / deadline: </dt>
              <dd className="inline">
                {c.observation.phase} / {c.observation.respondBy}
              </dd>
            </div>
          )}
          {c.observation.submittedAt && (
            <div>
              <dt className="inline font-medium">Evidence submitted: </dt>
              <dd className="inline">{c.observation.submittedAt}</dd>
            </div>
          )}
          {c.kind === "dispute" && (
            <div>
              <dt className="inline font-medium">Native deduction: </dt>
              <dd className="inline">
                {formatTaxMoney(c.observation.deductedMinor, c.currency)}
              </dd>
            </div>
          )}
        </dl>
      )}
      {c.state === "unknown" && (
        <p className="text-warning">
          Outcome unknown. Keep the original request reserved and reconcile it
          before another refund.
        </p>
      )}
      {c.reviewRequired && (
        <p className="text-warning">
          Native evidence requires operator review. Saved financial facts remain
          intact. Reconcile the original identity before another action.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        A processed refund is the provider result. Creation and observation
        times do not establish bank settlement.
      </p>
      {c.actions.map((a) => (
        <p key={a.requestKey}>
          Dispute {a.action}:{" "}
          {a.state === "not_attempted"
            ? "not sent; final preflight blocked the action"
            : a.state === "confirmed"
              ? a.action === "draft"
                ? "draft saved; not submitted"
                : a.action === "submit"
                  ? "submitted for review"
                  : "outcome confirmed"
              : "outcome unknown; reconcile the saved action"}
        </p>
      ))}
      {c.notices.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3">
            Customer notices in this app
          </summary>
          <ul className="flex flex-col gap-2">
            {c.notices.map((n) => (
              <li key={n.id}>
                {n.message}{" "}
                <span className="text-sm text-muted-foreground">
                  {n.at} · available in app
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            Availability in this app does not establish that a customer read a
            notice or received email.
          </p>
        </details>
      )}
    </div>
  );
}
function Confirm({
  label,
  description,
  disabled,
  onConfirm,
}: {
  label: string;
  description: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{label}?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function FinancialAdjustmentManager({
  businessId,
  initial,
  operator = false,
}: {
  businessId: string;
  initial: Workspace;
  operator?: boolean;
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [invoiceId, setInvoiceId] = useState(initial.invoices[0]?.id ?? ""),
    [kind, setKind] = useState<"refund" | "dispute">("refund"),
    [disputeId, setDisputeId] = useState(""),
    [disputeAmountMinor, setDisputeAmountMinor] = useState(""),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState(""),
    [lines, setLines] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<z.infer<
      typeof adjustmentDetailsSchema
    > | null>(null),
    [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [disputeForms, setDisputeForms] = useState<Record<string, DisputeForm>>(
    {},
  );
  const reviewKey = useRef<string | null>(null),
    disputeKeys = useRef<Record<string, string>>({});
  const creditKeys = useRef<Record<string, string>>({});
  const [creditForms, setCreditForms] = useState<
    Record<
      string,
      { lines: Record<string, string>; reason: string; evidence: string }
    >
  >({});
  function disputeForm(id: string): DisputeForm {
    return (
      disputeForms[id] ?? {
        summary: "",
        docId: "",
        docHash: "",
        category:
          disputeActionSchema.shape.documents.unwrap().element.shape.category
            .options[0],
      }
    );
  }
  function changeDispute(id: string, change: Partial<DisputeForm>) {
    setDisputeForms((s) => ({
      ...s,
      [id]: { ...disputeForm(id), ...s[id], ...change },
    }));
  }
  function creditForm(id: string) {
    return creditForms[id] ?? { lines: {}, reason: "", evidence: "" };
  }
  function changeCredit(
    id: string,
    change: Partial<ReturnType<typeof creditForm>>,
  ) {
    setCreditForms((s) => ({
      ...s,
      [id]: {
        ...(s[id] ?? { lines: {}, reason: "", evidence: "" }),
        ...change,
      },
    }));
  }
  const base = operator
    ? `/api/platform/financial-adjustments/${businessId}`
    : `/api/businesses/${businessId}/financial-adjustments`;
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to confirm the action. Refresh status.",
      );
    } finally {
      setBusy(false);
    }
  }
  const reload = async () =>
    setState(
      await response(
        await fetch(base, { cache: "no-store" }),
        adjustmentWorkspaceSchema,
      ),
    );
  const command = async <T,>(
    action: string,
    input: unknown,
    schema: z.ZodType<T>,
  ) =>
    response(
      await fetch(`${base}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      schema,
    );
  async function act(action: string, c: AdjustmentView) {
    await command(action, { caseId: c.id }, adjustmentViewSchema);
    await reload();
    setNotice(
      "Saved status refreshed. Review the native result and remaining document stages below.",
    );
  }
  async function dispute(
    c: AdjustmentView,
    action: "accept" | "draft" | "submit",
  ) {
    const { summary, docId, docHash, category } = disputeForm(c.id);
    disputeKeys.current[c.id] ??= crypto.randomUUID();
    await command(
      "dispute",
      {
        caseId: c.id,
        requestKey: disputeKeys.current[c.id],
        action,
        summary: action === "accept" ? "" : summary,
        documents:
          action === "accept" || !docId
            ? []
            : [{ category, documentId: docId, sha256: docHash }],
      },
      adjustmentViewSchema,
    );
    await reload();
    delete disputeKeys.current[c.id];
    setNotice(
      "Dispute action saved. Check whether its outcome is confirmed or still unknown.",
    );
  }
  async function reviewCredit(c: AdjustmentView) {
    const form = creditForm(c.id);
    creditKeys.current[c.id] ??= crypto.randomUUID();
    await command(
      "review-credit",
      {
        caseId: c.id,
        requestKey: creditKeys.current[c.id],
        lines: Object.entries(form.lines)
          .filter(([, v]) => v && v !== "0")
          .map(([lineId, netMinor]) => ({ lineId, netMinor })),
        reason: form.reason,
        evidence: form.evidence
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      adjustmentViewSchema,
    );
    await reload();
    delete creditKeys.current[c.id];
    setNotice(
      "Credit basis reviewed. Check the exact note amount and retained difference before issuing the permanent document.",
    );
  }
  const invoice = state.invoices.find((d) => d.id === invoiceId);
  return (
    <div className="flex flex-col gap-8" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(reload)}
        >
          Refresh saved records
        </Button>
        <RecoveryLink
          className="inline-flex min-h-11 items-center text-primary underline"
          href="/security"
        >
          Security and MFA
        </RecoveryLink>
        {!operator && (
          <Link
            className="inline-flex min-h-11 items-center text-primary underline"
            href={`/businesses/${businessId}/notifications`}
          >
            Email preferences and delivery history
          </Link>
        )}
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href={
            operator
              ? `/platform/seller-documents/${businessId}`
              : `/businesses/${businessId}/seller-documents`
          }
        >
          Invoices and credit notes
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <p role="status">{notice}</p>}
      {operator && (
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Review an original charge</h2>
          {!state.ready && (
            <p className="text-warning">
              Configure approved refund, dispute and access terms before new
              actions. Saved native outcomes remain reviewable.
            </p>
          )}
          {state.policy && (
            <p className="text-sm text-muted-foreground">
              Approved policy {state.policy.id}, version {state.policy.version}.
              Partial refund: {state.policy.partialRefundAccess}; full
              cumulative refund: {state.policy.fullRefundAccess}; open dispute:{" "}
              {state.policy.disputeOpenAccess}; lost dispute:{" "}
              {state.policy.disputeLostAccess}; won dispute:{" "}
              {state.policy.disputeWonAccess}; closed dispute:{" "}
              {state.policy.disputeClosedAccess}. Consequences apply to the
              original period.
            </p>
          )}
          {!invoice ? (
            <p>
              Issue the seller invoice for the genuine paid charge before
              reviewing an adjustment.
            </p>
          ) : (
            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  reviewKey.current ??= crypto.randomUUID();
                  await command(
                    "review",
                    {
                      kind,
                      invoiceId,
                      requestKey: reviewKey.current,
                      ...(kind === "dispute"
                        ? { disputeId, disputeAmountMinor }
                        : {}),
                      lines: Object.entries(lines)
                        .filter(([, v]) => v && v !== "0")
                        .map(([lineId, netMinor]) => ({ lineId, netMinor })),
                      reason,
                      evidence: evidence
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                    adjustmentViewSchema,
                  );
                  await reload();
                  reviewKey.current = null;
                  setNotice(
                    "Review saved. Check the exact amount below before requesting the native action.",
                  );
                });
              }}
            >
              <FieldGroup className="gap-5">
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="adjustment-invoice">
                    Original seller invoice
                  </Label>
                  <NativeSelect
                    id="adjustment-invoice"
                    value={invoiceId}
                    onChange={(e) => {
                      setInvoiceId(e.target.value);
                      setLines({});
                    }}
                  >
                    {state.invoices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.number} ·{" "}
                        {formatTaxMoney(
                          d.snapshot.totals.totalMinor,
                          d.snapshot.currency,
                        )}{" "}
                        · {d.snapshot.source.paymentId}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="adjustment-kind">Review type</Label>
                  <NativeSelect
                    id="adjustment-kind"
                    value={kind}
                    onChange={(e) => {
                      if (
                        e.target.value === "refund" ||
                        e.target.value === "dispute"
                      )
                        setKind(e.target.value);
                    }}
                  >
                    <option value="refund">
                      Normal full or partial refund
                    </option>
                    <option value="dispute">Existing native dispute</option>
                  </NativeSelect>
                </Field>
                {kind === "dispute" && (
                  <>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor="adjustment-dispute">
                        Native dispute ID
                      </Label>
                      <Input
                        id="adjustment-dispute"
                        value={disputeId}
                        onChange={(e) => setDisputeId(e.target.value)}
                        required
                        pattern="disp_[A-Za-z0-9]+"
                      />
                    </Field>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor="adjustment-disputed-amount">
                        Reviewed native claim amount, in currency subunits
                      </Label>
                      <Input
                        id="adjustment-disputed-amount"
                        value={disputeAmountMinor}
                        onChange={(e) => setDisputeAmountMinor(e.target.value)}
                        inputMode="numeric"
                        pattern="[1-9][0-9]*"
                        maxLength={15}
                        required
                      />
                      <p className="text-sm text-muted-foreground">
                        Use the exact claimed amount from the dispute in the
                        selected merchant account. Native reads must confirm it
                        against this charge. The original-tax credit basis below
                        is separate; any difference needs an explicit credit
                        review after an actual deduction.
                      </p>
                    </Field>
                  </>
                )}
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-3 font-medium">
                    Original line amounts to adjust
                  </legend>
                  <p className="text-sm text-muted-foreground">
                    Enter net amounts in currency subunits (100 = 1.00). Leave
                    other lines blank. Tax comes from the original cumulative
                    allocation. Saved credits and pending cases reserve their
                    selected amounts.
                  </p>
                  {invoice.snapshot.lines.map((l) => (
                    <Field key={l.input.id} className="flex flex-col gap-2">
                      <Label htmlFor={`adjustment-line-${l.input.id}`}>
                        {l.input.description} · original net {l.netMinor}
                      </Label>
                      <Input
                        id={`adjustment-line-${l.input.id}`}
                        inputMode="numeric"
                        pattern="[0-9]+"
                        value={lines[l.input.id] ?? ""}
                        onChange={(e) =>
                          setLines({ ...lines, [l.input.id]: e.target.value })
                        }
                      />
                    </Field>
                  ))}
                </fieldset>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="adjustment-reason">
                    Private review reason
                  </Label>
                  <Textarea
                    id="adjustment-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    maxLength={1000}
                  />
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="adjustment-evidence">
                    Private evidence references, one per line
                  </Label>
                  <Textarea
                    id="adjustment-evidence"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    Retain attributable request or review references. These
                    private notes do not appear on the customer credit note.
                  </p>
                </Field>
                <Button disabled={busy || !state.ready}>
                  Save review and reserve amount
                </Button>
              </FieldGroup>
            </form>
          )}
        </section>
      )}
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">Refund and dispute history</h2>
        {state.cases.length === 0 && (
          <p>No refund or dispute review is recorded for this Business.</p>
        )}
        {state.cases.map((c) => (
          <article
            key={c.id}
            className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
          >
            <Status c={c} />
            {operator && (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => act("refresh", c))}
                >
                  Reconcile original native result
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDetails(
                        await command(
                          "details",
                          { caseId: c.id },
                          adjustmentDetailsSchema,
                        ),
                      );
                      setSelectedCase(c.id);
                    })
                  }
                >
                  Review private evidence
                </Button>
                {c.kind === "refund" && c.state === "reviewed" && (
                  <>
                    <Confirm
                      label="Request normal refund"
                      disabled={busy || !state.ready}
                      description={`Request ${formatTaxMoney(c.amountMinor, c.currency)} against payment ${c.paymentId} and invoice ${c.invoiceNumber}. The reviewed access policy will apply after the provider confirms processing. Pending or unknown outcomes keep this amount reserved.`}
                      onConfirm={() => void run(() => act("execute", c))}
                    />
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run(() => act("withdraw", c))}
                    >
                      Withdraw unsent review
                    </Button>
                  </>
                )}
                {c.creditState === "pending" && !c.reviewRequired && (
                  <Confirm
                    label="Issue linked original-tax credit"
                    disabled={busy}
                    description={`Issue a numbered credit note for ${formatTaxMoney(c.creditAmountMinor, c.currency)} against ${c.invoiceNumber}, using the confirmed ${c.kind} and its reviewed original tax allocation. The credit note's number and financial history are permanent.`}
                    onConfirm={() => void run(() => act("credit", c))}
                  />
                )}
                {c.kind === "dispute" && c.state === "open" && (
                  <Confirm
                    label="Accept dispute"
                    disabled={
                      busy || c.actions.some((a) => a.state === "unknown")
                    }
                    description={`Accept the dispute against ${c.paymentId}. This can cause a provider balance deduction. The native result and configured credit/access policy determine the next stages.`}
                    onConfirm={() => void run(() => dispute(c, "accept"))}
                  />
                )}
              </div>
            )}
            {operator &&
              !c.creditDocumentId &&
              !c.reviewRequired &&
              ["pending", "review_required"].includes(c.creditState) && (
                <details className="border-t border-border pt-4">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    Review or correct the credit basis
                  </summary>
                  <form
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(() => reviewCredit(c));
                    }}
                  >
                    <FieldGroup className="gap-4">
                      <p className="text-sm text-muted-foreground">
                        Select original net lines for the applicable credit. Tax
                        uses the original cumulative components. The credit
                        cannot exceed the actual refund or deduction. Any
                        difference remains visible for reconciliation. This
                        review requires current refund and seller-document
                        authority and does not issue a document.
                      </p>
                      {state.invoices
                        .find((i) => i.id === c.invoiceId)
                        ?.snapshot.lines.map((line) => (
                          <Field
                            key={line.input.id}
                            className="flex flex-col gap-2"
                          >
                            <Label htmlFor={`credit-${c.id}-${line.input.id}`}>
                              {line.input.description} · net subunits, original{" "}
                              {line.netMinor}
                            </Label>
                            <Input
                              id={`credit-${c.id}-${line.input.id}`}
                              inputMode="numeric"
                              pattern="[0-9]+"
                              value={
                                creditForm(c.id).lines[line.input.id] ?? ""
                              }
                              onChange={(e) =>
                                changeCredit(c.id, {
                                  lines: {
                                    ...creditForm(c.id).lines,
                                    [line.input.id]: e.target.value,
                                  },
                                })
                              }
                            />
                          </Field>
                        ))}
                      <Field className="flex flex-col gap-2">
                        <Label htmlFor={`credit-reason-${c.id}`}>
                          Private rationale for the credit basis and any
                          difference
                        </Label>
                        <Textarea
                          id={`credit-reason-${c.id}`}
                          required
                          maxLength={1000}
                          value={creditForm(c.id).reason}
                          onChange={(e) =>
                            changeCredit(c.id, { reason: e.target.value })
                          }
                        />
                      </Field>
                      <Field className="flex flex-col gap-2">
                        <Label htmlFor={`credit-evidence-${c.id}`}>
                          Private approval evidence, one reference per line
                        </Label>
                        <Textarea
                          id={`credit-evidence-${c.id}`}
                          required
                          value={creditForm(c.id).evidence}
                          onChange={(e) =>
                            changeCredit(c.id, { evidence: e.target.value })
                          }
                        />
                      </Field>
                      <Button variant="outline" disabled={busy}>
                        Save reviewed credit basis
                      </Button>
                    </FieldGroup>
                  </form>
                </details>
              )}
            {operator && c.kind === "dispute" && c.state === "open" && (
              <form
                className="flex flex-col gap-4 border-t border-border pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => dispute(c, "draft"));
                }}
              >
                <FieldGroup className="gap-4">
                  <h4 className="font-semibold">
                    Retain and send dispute evidence
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Use a document already uploaded to the selected merchant for
                    this payment. Its authenticated file content must match the
                    reviewed SHA-256. A saved draft is separate from submission.
                  </p>
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor={`summary-${c.id}`}>Evidence summary</Label>
                    <Textarea
                      id={`summary-${c.id}`}
                      value={disputeForm(c.id).summary}
                      onChange={(e) =>
                        changeDispute(c.id, { summary: e.target.value })
                      }
                      required
                      maxLength={1000}
                    />
                  </Field>
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor={`category-${c.id}`}>Evidence type</Label>
                    <NativeSelect
                      id={`category-${c.id}`}
                      value={disputeForm(c.id).category}
                      onChange={(e) => {
                        const r = disputeActionSchema.shape.documents
                          .unwrap()
                          .element.shape.category.safeParse(e.target.value);
                        if (r.success)
                          changeDispute(c.id, { category: r.data });
                      }}
                    >
                      {disputeActionSchema.shape.documents
                        .unwrap()
                        .element.shape.category.options.map((v) => (
                          <option key={v} value={v}>
                            {v.replaceAll("_", " ")}
                          </option>
                        ))}
                    </NativeSelect>
                  </Field>
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor={`doc-${c.id}`}>Native document ID</Label>
                    <Input
                      id={`doc-${c.id}`}
                      value={disputeForm(c.id).docId}
                      onChange={(e) =>
                        changeDispute(c.id, { docId: e.target.value })
                      }
                      pattern="doc_[A-Za-z0-9]+"
                    />
                  </Field>
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor={`hash-${c.id}`}>
                      Reviewed file SHA-256
                    </Label>
                    <Input
                      id={`hash-${c.id}`}
                      value={disputeForm(c.id).docHash}
                      onChange={(e) =>
                        changeDispute(c.id, { docHash: e.target.value })
                      }
                      pattern="[a-f0-9]{64}"
                    />
                  </Field>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      disabled={
                        busy || c.actions.some((a) => a.state === "unknown")
                      }
                    >
                      Save evidence draft
                    </Button>
                    <Confirm
                      label="Submit evidence for review"
                      disabled={
                        busy ||
                        !disputeForm(c.id).docId ||
                        !disputeForm(c.id).docHash ||
                        !disputeForm(c.id).summary ||
                        c.actions.some((a) => a.state === "unknown")
                      }
                      description="Submit this exact summary and selected native document to Razorpay. Submission starts review; it does not establish a win."
                      onConfirm={() => void run(() => dispute(c, "submit"))}
                    />
                  </div>
                </FieldGroup>
              </form>
            )}
            {operator && selectedCase === c.id && details && (
              <section className="flex flex-col gap-3 border-t border-border pt-5">
                <h4 className="font-semibold">Protected review</h4>
                <p>{details.input.reason}</p>
                {details.creditReviews.map((review) => (
                  <p key={review.input.requestKey}>
                    Credit review {review.at}:{" "}
                    {formatTaxMoney(
                      review.allocation.totals.totalMinor,
                      c.currency,
                    )}
                    ; native amount{" "}
                    {formatTaxMoney(review.actualMinor, c.currency)}; retained
                    difference {review.uncreditedDifferenceMinor} subunits.{" "}
                    {review.input.reason}
                  </p>
                ))}
                <ul>
                  {details.input.evidence.map((e) => (
                    <li key={e} className="wrap-anywhere">
                      {e}
                    </li>
                  ))}
                </ul>
                <p>
                  Reviewed net {details.allocation.totals.netMinor}; original
                  tax {details.allocation.totals.taxMinor}; gross{" "}
                  {details.allocation.totals.totalMinor} subunits.
                </p>
                {c.kind === "refund" && (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3">
                      Exact saved native refund request
                    </summary>
                    <p className="font-mono text-sm wrap-anywhere">
                      Key: {details.key}
                    </p>
                    <pre className="overflow-auto whitespace-pre-wrap text-sm">
                      {details.body}
                    </pre>
                  </details>
                )}
                {details.commands.map((command) => (
                  <div key={command.input.requestKey}>
                    <p>
                      {command.input.action} · {command.input.summary}
                    </p>
                    {command.documents.map((doc) => (
                      <Button
                        key={doc.documentId}
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const r = await fetch(`${base}/evidence`, {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({
                                caseId: c.id,
                                requestKey: command.input.requestKey,
                                documentId: doc.documentId,
                              }),
                            });
                            if (!r.ok)
                              throw Error(
                                "Current access does not allow this retained evidence download.",
                              );
                            const url = URL.createObjectURL(await r.blob()),
                              a = document.createElement("a");
                            a.href = url;
                            a.download = `${doc.documentId}.${doc.contentType === "application/pdf" ? "pdf" : "image"}`;
                            a.click();
                            URL.revokeObjectURL(url);
                          })
                        }
                      >
                        Download retained {doc.documentId}
                      </Button>
                    ))}
                  </div>
                ))}
              </section>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
