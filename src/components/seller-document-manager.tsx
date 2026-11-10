"use client";
import { Field, FieldGroup } from "./ui/field";
import { RecoveryLink } from "./recovery-link";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  adjustDocumentSchema,
  documentWorkspaceSchema,
  sellerDocumentSchema,
  type SellerDocument,
} from "@/models/seller-documents";
import { fileGrantSchema } from "@/models/files";
import { formatTaxMoney } from "@/models/tax";
import { allocateCredit } from "@/application/seller-document-credit";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

export async function sellerResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = z.object({ code: z.string() }).safeParse(json),
      code = failure.success ? failure.data.code : "";
    const messages: Record<string, string> = {
      MFA_REQUIRED: "Verify in Security, then retry. Your entries remain here.",
      UNAUTHENTICATED:
        "Sign in in another tab, then retry. Your entries remain here.",
      FORBIDDEN: "Your current role does not allow this action.",
      NOT_FOUND: "This record is unavailable to your current Business or role.",
      SELLER_DOCUMENT_SETUP_REQUIRED:
        "The document needs an approved effective seller configuration matching its currency, required fields and original rounding. Ask the document operator to review setup.",
      FILE_SETUP_REQUIRED:
        "Private document storage needs operator setup. Saved history remains available.",
      FILE_UNAVAILABLE:
        "This artifact or download grant is unavailable. Refresh its status and request a new download.",
      CONFLICT:
        "The request conflicts with saved history, a numbering series or the remaining invoice balance. Refresh and review before starting a new action.",
      INVALID_INPUT: "Check the required fields and amount format.",
    };
    throw new Error(
      messages[code] ??
        "Unable to confirm the result. Refresh saved history before retrying.",
    );
  }
  const parsed = z
    .object({ success: z.literal(true), data: schema })
    .safeParse(json);
  if (!parsed.success)
    throw new Error(
      "Unable to confirm the result. Refresh saved history before retrying.",
    );
  return parsed.data.data;
}
type Workspace = z.infer<typeof documentWorkspaceSchema>;
function Detail({ document: d }: { document: SellerDocument }) {
  const s = d.snapshot,
    c = s.issuer.revision.configuration,
    buyer = s.financial.tax.billing.current;
  return (
    <details className="mt-4">
      <summary className="min-h-11 cursor-pointer py-3 text-primary">
        Review frozen legal details, lines and evidence
      </summary>
      <div className="flex flex-col gap-4 wrap-anywhere">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">
              Seller · configuration v{s.issuer.revision.version}
            </dt>
            <dd>
              {c.seller.legalName}
              <br />
              {c.seller.address}
              <br />
              {c.seller.country} · {c.seller.contact}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              Customer · revision {buyer?.version}
            </dt>
            <dd>
              {buyer?.profile.legalName}
              <br />
              {buyer &&
                Object.values(buyer.profile.address).filter(Boolean).join(", ")}
              <br />
              {buyer?.profile.invoiceContact.email}
            </dd>
          </div>
        </dl>
        {c.legalFields.map((f, i) => (
          <p key={i}>
            {f.label}: {f.value}
          </p>
        ))}
        {buyer?.profile.taxIdentifiers.map((t, i) => (
          <p key={i}>
            {t.kind} ({t.country}): {t.value}
          </p>
        ))}
        <p>
          Payment {s.source.paymentId} · {s.source.start} to {s.source.end}
        </p>
        <p>
          Issued {d.at} by {d.actorId}. Retained at least until {d.retainUntil};
          protected financial history has no automatic deletion.
        </p>
        <ul className="flex flex-col gap-4">
          {s.lines.map((l) => (
            <li key={l.input.id} className="rounded-lg bg-muted p-4">
              <p className="font-medium">{l.input.description}</p>
              <p>
                Net {formatTaxMoney(l.netMinor, s.currency)} · Tax{" "}
                {formatTaxMoney(l.taxMinor, s.currency)} · Total{" "}
                {formatTaxMoney(l.totalMinor, s.currency)}
              </p>
              {l.components.map((t, i) => (
                <p key={i}>
                  {t.name}: {formatTaxMoney(t.amountMinor, s.currency)}
                </p>
              ))}
              <p className="mt-2 text-sm">
                {l.rule.revision.rule.treatment} ·{" "}
                {l.rule.revision.rule.jurisdiction.name} · registration{" "}
                {l.rule.revision.rule.registration.identifier}. Rule{" "}
                {l.rule.revision.key} v{l.rule.revision.version}.
              </p>
              <p className="text-sm">
                Original rounding: {l.rule.revision.rule.rounding.mode},{" "}
                {l.rule.revision.rule.rounding.scope}, increment{" "}
                {l.rule.revision.rule.rounding.incrementMinor} minor units.
              </p>
              {l.rule.revision.rule.evidence.map((e, i) => (
                <p className="text-sm" key={i}>
                  {e.title}: {e.reference} · checked {e.checkedAt}
                </p>
              ))}
            </li>
          ))}
        </ul>
        {s.adjustment && (
          <div className="rounded-lg bg-muted p-4">
            <p>Correction reason: {s.adjustment.reason}</p>
            <p>
              {s.adjustment.source.kind}: {s.adjustment.source.reference}
            </p>
            <p>Evidence: {s.adjustment.evidence.join("; ")}</p>
            <p className="text-sm">
              Partial tax comes from cumulative original component allocations;
              current rates do not change this credit.
            </p>
          </div>
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-3">
            Original source and review snapshots
          </summary>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(s, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}
export function SellerDocumentManager({
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
    [status, setStatus] = useState("");
  const keys = useRef(new Map<string, string>());
  const base = operator
    ? `/api/platform/seller-documents/${businessId}`
    : `/api/businesses/${businessId}/seller-documents`;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      return true;
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Unable to complete the action",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () =>
    setState(
      await sellerResponse(
        await fetch(base, { cache: "no-store" }),
        documentWorkspaceSchema,
      ),
    );
  const post = async (path: string, input: unknown) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const download = async (d: SellerDocument) => {
    const grant = await sellerResponse(
      await post(`${base}/${d.id}/access`, {}),
      fileGrantSchema,
    );
    const response = await fetch(`${base}/${d.id}/content`, {
      headers: { "x-file-token": grant.token },
      cache: "no-store",
    });
    if (!response.ok) {
      await sellerResponse(response, z.unknown());
      return;
    }
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement("a");
    link.href = url;
    link.download = `${d.number}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    await refresh();
    setStatus(`${d.number} downloaded.`);
  };
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await refresh();
              setStatus("Saved history refreshed.");
            })
          }
        >
          Refresh saved history
        </Button>
        <RecoveryLink
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security
        </RecoveryLink>
      </div>
      {!state.storageReady && (
        <Alert>
          Private artifact storage needs operator setup. History remains
          available; ask the document operator to configure protected storage.
        </Alert>
      )}
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      {status && <p role="status">{status}</p>}
      {busy && <p role="status">Saving or retrieving the document…</p>}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Confirmed payments</h2>
        {!state.periods.length && (
          <p>
            No confirmed paid periods yet. Complete a reviewed subscription
            purchase to establish invoice amounts.
          </p>
        )}
        {state.periods.map((p) => {
          const invoice = state.documents.find(
            (d) => d.kind === "invoice" && d.periodId === p.id,
          );
          return (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-card p-6 wrap-anywhere"
            >
              <p className="font-medium">
                {p.totalMinor
                  ? formatTaxMoney(p.totalMinor, p.currency)
                  : "Financial review required"}
              </p>
              <p className="text-sm">
                {p.start} to {p.end}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Payment {p.paymentId}
              </p>
              {invoice ? (
                <a
                  className="mt-3 inline-flex min-h-11 items-center text-primary underline"
                  href={`#document-${invoice.id}`}
                >
                  View {invoice.number}
                </a>
              ) : (
                <Button
                  className="mt-4"
                  disabled={busy || !state.storageReady}
                  onClick={() =>
                    run(async () => {
                      let requestKey = keys.current.get(p.id);
                      if (!requestKey) {
                        requestKey = crypto.randomUUID();
                        keys.current.set(p.id, requestKey);
                      }
                      const d = await sellerResponse(
                        await post(base, { periodId: p.id, requestKey }),
                        sellerDocumentSchema,
                      );
                      await refresh();
                      setStatus(
                        `${d.number} issued. ${d.artifact.state === "ready" ? "The artifact is ready." : "Artifact recovery is required; the number is retained."}`,
                      );
                    })
                  }
                >
                  Issue seller invoice
                </Button>
              )}
            </div>
          );
        })}
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Invoices and credit notes</h2>
        <p className="text-muted-foreground">
          Seller documents preserve the original transaction. Gateway receipts
          are separate payment records.
        </p>
        {!state.documents.length && (
          <p>
            No seller documents have been issued. Choose a confirmed payment
            above.
          </p>
        )}
        {state.documents.map((d) => (
          <article
            id={`document-${d.id}`}
            key={d.id}
            className="rounded-xl border border-border bg-card p-6 wrap-anywhere"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">
                {d.number} · {d.kind === "invoice" ? "Invoice" : "Credit note"}
              </h3>
              <Badge>
                {d.artifact.state === "ready"
                  ? "Download ready"
                  : d.artifact.state === "failed"
                    ? "Artifact recovery required"
                    : "Artifact pending"}
              </Badge>
            </div>
            <p className="mt-3 text-lg font-semibold">
              {d.kind === "credit_note" ? "Credit " : ""}
              {formatTaxMoney(
                d.snapshot.totals.totalMinor,
                d.snapshot.currency,
              )}
            </p>
            {d.snapshot.issuer.revision.configuration.mode === "fixture" && (
              <p className="mt-2 text-sm">
                Fixture document · payment mode{" "}
                {d.snapshot.financial.provider.mode}
              </p>
            )}
            <p>
              Before tax{" "}
              {formatTaxMoney(d.snapshot.totals.netMinor, d.snapshot.currency)}{" "}
              · Tax{" "}
              {formatTaxMoney(d.snapshot.totals.taxMinor, d.snapshot.currency)}
            </p>
            {d.snapshot.original && (
              <a
                href={`#document-${d.snapshot.original.id}`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Original invoice {d.snapshot.original.number}
              </a>
            )}
            {d.artifact.state !== "ready" && (
              <p className="mt-3 text-sm">
                The document and number are saved. Retry artifact recovery; it
                preserves this identity.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                disabled={
                  busy || !state.storageReady || d.artifact.state !== "ready"
                }
                onClick={() => run(() => download(d))}
              >
                Download {d.number}
              </Button>
              {d.artifact.state !== "ready" && (
                <Button
                  variant="outline"
                  disabled={busy || !state.storageReady}
                  onClick={() =>
                    run(async () => {
                      await sellerResponse(
                        await post(`${base}/recover`, { documentId: d.id }),
                        sellerDocumentSchema,
                      );
                      await refresh();
                      setStatus(
                        "Artifact status refreshed. Review its download status.",
                      );
                    })
                  }
                >
                  Recover artifact
                </Button>
              )}
            </div>
            <Detail document={d} />
          </article>
        ))}
      </section>
      {operator && (
        <CreditForm
          documents={state.documents}
          busy={busy}
          onSave={(input) =>
            run(async () => {
              const d = await sellerResponse(
                await post(`${base}/credits`, input),
                sellerDocumentSchema,
              );
              await refresh();
              setStatus(
                `${d.number} recorded. No payment refund was executed.`,
              );
            })
          }
        />
      )}
      <p className="text-sm text-muted-foreground">
        Stored artifact bytes: {state.storageUsage.storedBytes}. Storage
        attempts: {state.storageUsage.putAttempts} writes,{" "}
        {state.storageUsage.getAttempts} reads;{" "}
        {state.storageUsage.uncertainAttempts} unconfirmed. These are
        application observations.
      </p>
    </div>
  );
}
function CreditForm({
  documents,
  busy,
  onSave,
}: {
  documents: SellerDocument[];
  busy: boolean;
  onSave(input: z.infer<typeof adjustDocumentSchema>): Promise<boolean>;
}) {
  const [invoiceId, setInvoiceId] = useState(""),
    [pending, setPending] = useState<z.infer<
      typeof adjustDocumentSchema
    > | null>(null),
    [error, setError] = useState("");
  const identity = useRef({
    requestKey: crypto.randomUUID(),
    adjustmentId: crypto.randomUUID(),
  });
  const invoice = documents.find(
    (d) => d.id === invoiceId && d.kind === "invoice",
  );
  const prior = documents.filter((d) => d.snapshot.original?.id === invoiceId);
  const preview = (() => {
    try {
      return invoice && pending
        ? allocateCredit(invoice, prior, pending)
        : null;
    } catch {
      return null;
    }
  })();
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <h2 className="text-xl font-semibold">Record a linked credit note</h2>
      <p>
        Choose the original invoice, explain the correction and credit exact
        line amounts. This records the adjustment; payment refunds and disputes
        are separate workflows.
      </p>
      <Label htmlFor="credit-invoice">Original invoice</Label>
      <NativeSelect
        id="credit-invoice"
        value={invoiceId}
        onChange={(e) => {
          setInvoiceId(e.target.value);
          identity.current = {
            requestKey: crypto.randomUUID(),
            adjustmentId: crypto.randomUUID(),
          };
        }}
      >
        <option value="">Choose an invoice</option>
        {documents
          .filter((d) => d.kind === "invoice")
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.number} ·{" "}
              {formatTaxMoney(
                d.snapshot.totals.totalMinor,
                d.snapshot.currency,
              )}
            </option>
          ))}
      </NativeSelect>
      {invoice && (
        <form
          key={invoice.id}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            const f = new FormData(e.currentTarget);
            const input = adjustDocumentSchema.safeParse({
              ...identity.current,
              invoiceId: invoice.id,
              periodId: invoice.periodId,
              paymentId: invoice.snapshot.source.paymentId,
              source: { kind: f.get("kind"), reference: f.get("reference") },
              reason: f.get("reason"),
              evidence: String(f.get("evidence"))
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean),
              lines: invoice.snapshot.lines
                .map((l) => ({
                  lineId: l.input.id,
                  netMinor: String(f.get(l.input.id)),
                }))
                .filter((l) => l.netMinor !== ""),
            });
            if (!input.success) {
              setError(
                "Enter a reason, source, evidence and at least one positive amount in minor units.",
              );
              return;
            }
            try {
              allocateCredit(invoice, prior, input.data);
              setPending(input.data);
            } catch {
              setError(
                "A line exceeds the remaining original balance. Review previous credits.",
              );
            }
          }}
        >
          <FieldGroup className="gap-4">
            {invoice.snapshot.lines.map((l) => {
              const used = prior
                .flatMap((d) => d.snapshot.lines)
                .filter((c) => c.input.id === l.input.id)
                .reduce((s, c) => s + BigInt(c.netMinor), 0n);
              return (
                <Field key={l.input.id} className="flex flex-col gap-2">
                  <Label htmlFor={`credit-${l.input.id}`}>
                    {l.input.description} · remaining net{" "}
                    {formatTaxMoney(
                      String(BigInt(l.netMinor) - used),
                      invoice.snapshot.currency,
                    )}
                  </Label>
                  <Input
                    id={`credit-${l.input.id}`}
                    name={l.input.id}
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    placeholder="Exact minor units; leave blank to omit"
                  />
                  <p className="text-sm text-muted-foreground">
                    Minor units have {invoice.snapshot.precision} decimal
                    places. Tax is allocated from the original document.
                  </p>
                </Field>
              );
            })}
            <Label htmlFor="credit-kind">Adjustment source</Label>
            <NativeSelect required id="credit-kind" name="kind" defaultValue="">
              <option value="" disabled>
                Choose a source
              </option>
              <option value="manual">Manual correction</option>
              <option value="refund">Approved refund record</option>
              <option value="dispute">Dispute record</option>
            </NativeSelect>
            <Label htmlFor="credit-reference">Stable source reference</Label>
            <Input
              required
              id="credit-reference"
              name="reference"
              maxLength={1000}
            />
            <Label htmlFor="credit-reason">Correction reason</Label>
            <Textarea
              required
              id="credit-reason"
              name="reason"
              maxLength={1000}
            />
            <Label htmlFor="credit-evidence">
              Supporting evidence references · one per line
            </Label>
            <Textarea required id="credit-evidence" name="evidence" />
            {error && (
              <Alert role="alert" variant="destructive">
                {error}
              </Alert>
            )}
            <Button disabled={busy}>Review credit note</Button>
          </FieldGroup>
        </form>
      )}
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-3">
            <AlertDialogTitle>Record this credit note?</AlertDialogTitle>
            <AlertDialogDescription>
              Original invoice {invoice?.number}. Credit{" "}
              {preview && invoice
                ? formatTaxMoney(
                    preview.totals.totalMinor,
                    invoice.snapshot.currency,
                  )
                : ""}
              , including tax{" "}
              {preview && invoice
                ? formatTaxMoney(
                    preview.totals.taxMinor,
                    invoice.snapshot.currency,
                  )
                : ""}
              . This creates a numbered financial record with your reason and
              evidence. The original remains unchanged.
            </AlertDialogDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !preview}
              onClick={async (event) => {
                event.preventDefault();
                if (pending) {
                  if (!(await onSave(pending))) {
                    setPending(null);
                    return;
                  }
                  identity.current = {
                    requestKey: crypto.randomUUID(),
                    adjustmentId: crypto.randomUUID(),
                  };
                  setPending(null);
                  setInvoiceId("");
                }
              }}
            >
              Record credit note
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
