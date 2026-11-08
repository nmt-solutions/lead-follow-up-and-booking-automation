"use client";
import { useId, useState } from "react";
import {
  issuerCatalogSchema,
  issuerConfigurationSchema,
  type IssuerCatalog,
  type IssuerConfiguration,
} from "@/models/seller-documents";
import { sellerResponse } from "./seller-document-manager";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

export function SellerIssuerManager({ initial }: { initial: IssuerCatalog }) {
  const [state, setState] = useState(initial),
    [seed, setSeed] = useState<IssuerConfiguration | null>(null),
    [formVersion, setFormVersion] = useState(0),
    [replacement, setReplacement] = useState<IssuerConfiguration | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const base = "/api/platform/seller-documents/configuration";
  const post = async (path: string, input: unknown) =>
    sellerResponse(
      await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      issuerCatalogSchema,
    );
  async function save(configuration: IssuerConfiguration, note: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setState(
        await post(base, {
          expectedVersion: state.revisions.length,
          configuration,
          note,
        }),
      );
      setStatus("Draft saved. Review and approve its exact version below.");
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Unable to save issuer configuration",
      );
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    revisionId: string,
    note: string,
    outcome: "approved" | "withdrawn",
  ) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setState(
        await post(`${base}/decisions`, {
          revisionId,
          expectedVersion: state.decisions.filter(
            (d) => d.revisionId === revisionId,
          ).length,
          outcome,
          note,
        }),
      );
      setStatus(
        `Version ${outcome}. Issued documents keep their saved configuration.`,
      );
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Unable to record issuer decision",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setState(
              await sellerResponse(
                await fetch(base, { cache: "no-store" }),
                issuerCatalogSchema,
              ),
            );
            setStatus(
              "Saved configuration refreshed. Unsaved form entries remain here.",
            );
          } catch (e: unknown) {
            setError(
              e instanceof Error
                ? e.message
                : "Unable to refresh configuration",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh saved configuration
      </Button>
      <p className="text-muted-foreground">
        Configure the actual seller requirements before approving a version.
        Nothing here supplies legal requirements, rates, identities or
        production numbering. Effective dates apply to the confirmed paid
        period; corrections select a current approved issuer version while
        preserving original financial allocations.
      </p>
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      {status && <p role="status">{status}</p>}
      <IssuerForm key={formVersion} seed={seed} busy={busy} onSave={save} />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Versioned issuer review</h2>
        {!state.revisions.length && (
          <p>
            No issuer configuration yet. Save the reviewed seller details above.
          </p>
        )}
        {state.revisions.toReversed().map((r) => {
          const decision = state.decisions
              .filter((d) => d.revisionId === r.id)
              .at(-1),
            c = r.configuration;
          return (
            <article
              key={r.id}
              className="space-y-4 rounded-xl border border-border bg-card p-6 wrap-anywhere"
            >
              <h3 className="text-lg font-semibold">
                Version {r.version} · {c.seller.legalName} ·{" "}
                {decision?.outcome ?? "Draft · approval required"}
              </h3>
              <p>
                {c.mode} · {c.effectiveFrom} to{" "}
                {c.effectiveUntil ?? "No configured end"}
              </p>
              <p>
                {c.seller.address} · {c.seller.country} · {c.seller.contact}
              </p>
              {c.legalFields.map((f, i) => (
                <p key={i}>
                  {f.label}: {f.value}
                </p>
              ))}
              <p>
                Required customer fields: {c.requiredCustomerFields.join(", ")}
              </p>
              <p>
                Invoice series {c.series.invoice.key}: {c.series.invoice.prefix}
                , first {c.series.invoice.first}, width {c.series.invoice.width}
                . Credit series {c.series.credit_note.key}:{" "}
                {c.series.credit_note.prefix}, first{" "}
                {c.series.credit_note.first}, width {c.series.credit_note.width}
                .
              </p>
              {c.currencies.map((x) => (
                <p key={x.currency}>
                  {x.currency} · {x.precision} decimal places ·{" "}
                  {x.rounding.mode} / {x.rounding.scope} / increment{" "}
                  {x.rounding.incrementMinor}
                  {x.additionalRoundings.map((rounding, i) => (
                    <span className="block" key={i}>
                      Also approved: {rounding.mode} / {rounding.scope} /
                      increment {rounding.incrementMinor}
                    </span>
                  ))}
                </p>
              ))}
              <p>
                Template {c.template.format}: {c.template.invoiceTitle} /{" "}
                {c.template.creditTitle}. Footer: {c.template.footer}
              </p>
              <p>
                Protected history · minimum {c.retention.minimumSeconds} seconds
                · {c.retention.policyReference}
              </p>
              {c.evidence.map((e, i) => (
                <p key={i}>
                  {e.title}: {e.reference} · checked {e.checkedAt}
                </p>
              ))}
              <p className="text-sm text-muted-foreground">
                Saved by {r.actorId} at {r.at}. {r.note}
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setReplacement(c)}
              >
                Copy as new draft
              </Button>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget),
                    outcome = data.get("outcome");
                  if (outcome === "approved" || outcome === "withdrawn")
                    void decide(r.id, String(data.get("note")), outcome);
                }}
              >
                <Label htmlFor={`decision-${r.id}`}>
                  Review reason and evidence for this exact version
                </Label>
                <Textarea
                  id={`decision-${r.id}`}
                  required
                  name="note"
                  maxLength={1000}
                />
                <Label htmlFor={`outcome-${r.id}`}>Decision</Label>
                <NativeSelect
                  required
                  name="outcome"
                  id={`outcome-${r.id}`}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose a decision
                  </option>
                  <option value="approved">Approve this version</option>
                  <option value="withdrawn">Withdraw this version</option>
                </NativeSelect>
                <Button disabled={busy}>Record issuer decision</Button>
              </form>
              <details>
                <summary className="min-h-11 cursor-pointer py-3">
                  Decision history
                </summary>
                {state.decisions
                  .filter((d) => d.revisionId === r.id)
                  .map((d) => (
                    <p key={d.id}>
                      {d.outcome} · {d.at} · {d.actorId}: {d.note}
                    </p>
                  ))}
              </details>
            </article>
          );
        })}
      </section>
      <AlertDialog
        open={!!replacement}
        onOpenChange={(open) => {
          if (!open) setReplacement(null);
        }}
      >
        <AlertDialogContent>
          <div className="space-y-3">
            <AlertDialogTitle>Replace the unsaved draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The selected version will populate the form. Unsaved entries in
              the form will be replaced. Saved versions and issued documents
              remain available.
            </AlertDialogDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSeed(replacement);
                setFormVersion((v) => v + 1);
                setReplacement(null);
              }}
            >
              Use selected version
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function IssuerForm({
  seed,
  busy,
  onSave,
}: {
  seed: IssuerConfiguration | null;
  busy: boolean;
  onSave(c: IssuerConfiguration, note: string): Promise<void>;
}) {
  const prefix = useId(),
    [error, setError] = useState(""),
    [currencies, setCurrencies] = useState(
      seed?.currencies.map((c) => c.currency) ?? [],
    );
  const field = (
    name: string,
    label: string,
    value: string | number | undefined,
    type = "text",
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`${prefix}-${name}`}>{label}</Label>
      <Input
        required
        id={`${prefix}-${name}`}
        name={name}
        type={type}
        defaultValue={value ?? ""}
        maxLength={1000}
      />
    </div>
  );
  const select = (
    name: string,
    label: string,
    options: readonly string[],
    value: string | undefined,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`${prefix}-${name}`}>{label}</Label>
      <NativeSelect
        required
        id={`${prefix}-${name}`}
        name={name}
        defaultValue={value ?? ""}
      >
        <option value="" disabled>
          Choose a value
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replaceAll("_", " ")}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
  return (
    <form
      className="space-y-6 rounded-xl border border-border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const f = new FormData(e.currentTarget),
          v = (name: string) => String(f.get(name) ?? "");
        const rows = (name: string) =>
          v(name)
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => s.split("|").map((p) => p.trim()));
        const series = (kind: string) => ({
          key: v(`${kind}-key`),
          prefix: v(`${kind}-prefix`),
          first: v(`${kind}-first`),
          width: Number(v(`${kind}-width`)),
        });
        if (
          rows("legal").some((r) => r.length !== 2) ||
          rows("evidence").some((r) => r.length !== 3) ||
          currencies.some((currency) =>
            rows(`${currency}-additional`).some((r) => r.length !== 3),
          )
        ) {
          setError(
            "Use two columns for legal fields and three for evidence or additional rounding policies. Separate columns with | and keep each entry on one line.",
          );
          return;
        }
        const parsed = issuerConfigurationSchema.safeParse({
          mode: v("mode"),
          effectiveFrom: v("from"),
          effectiveUntil: v("until") || null,
          seller: {
            legalName: v("name"),
            address: v("address"),
            country: v("country"),
            contact: v("contact"),
          },
          legalFields: rows("legal").map(([label, value]) => ({
            label,
            value,
          })),
          requiredCustomerFields: f.getAll("required"),
          series: { invoice: series("invoice"), credit_note: series("credit") },
          currencies: currencies.map((currency) => ({
            currency,
            precision: Number(v(`${currency}-precision`)),
            rounding: {
              mode: v(`${currency}-rounding`),
              scope: v(`${currency}-scope`),
              incrementMinor: v(`${currency}-increment`),
            },
            additionalRoundings: rows(`${currency}-additional`).map(
              ([mode, scope, incrementMinor]) => ({
                mode,
                scope,
                incrementMinor,
              }),
            ),
          })),
          template: {
            format: v("format"),
            invoiceTitle: v("invoice-title"),
            creditTitle: v("credit-title"),
            footer: v("footer"),
          },
          retention: {
            minimumSeconds: Number(v("retention")),
            policyReference: v("retention-reference"),
            disposition: v("disposition"),
          },
          creditAllocation: v("allocation"),
          evidence: rows("evidence").map(([title, reference, checkedAt]) => ({
            title,
            reference,
            checkedAt,
          })),
        });
        if (!parsed.success) {
          setError(
            "Check all fields: UTC timestamps must use ISO format, list rows need the displayed separators, series must be distinct and at least one currency and required customer field must be selected.",
          );
          return;
        }
        void onSave(parsed.data, v("note"));
      }}
    >
      <h2 className="text-xl font-semibold">New issuer version</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {select("mode", "Execution mode", ["live", "fixture"], seed?.mode)}
        {field(
          "from",
          "Effective from · ISO UTC timestamp",
          seed?.effectiveFrom,
        )}
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-until`}>
            Effective until · optional ISO UTC timestamp
          </Label>
          <Input
            id={`${prefix}-until`}
            name="until"
            defaultValue={seed?.effectiveUntil ?? ""}
          />
        </div>
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">Seller legal identity</legend>
        {field("name", "Legal name", seed?.seller.legalName)}
        {field("address", "Legal address", seed?.seller.address)}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("country", "Two-letter country code", seed?.seller.country)}
          {field("contact", "Seller contact", seed?.seller.contact)}
        </div>
        <Label htmlFor={`${prefix}-legal`}>
          Applicable legal fields · one label | value per line
        </Label>
        <Textarea
          required
          id={`${prefix}-legal`}
          name="legal"
          defaultValue={
            seed?.legalFields
              .map((f) => `${f.label} | ${f.value}`)
              .join("\n") ?? ""
          }
        />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-3 font-semibold">Required customer fields</legend>
        {(
          [
            "legalName",
            "address",
            "invoiceContact",
            "registrationNumber",
            "taxIdentifiers",
          ] as const
        ).map((name) => (
          <label key={name} className="flex min-h-11 items-center gap-3">
            <Checkbox
              name="required"
              value={name}
              defaultChecked={
                seed?.requiredCustomerFields.some((f) => f === name) ?? false
              }
            />
            {
              {
                legalName: "Legal name",
                address: "Billing address",
                invoiceContact: "Invoice contact",
                registrationNumber: "Registration number",
                taxIdentifiers: "Tax identifiers",
              }[name]
            }
          </label>
        ))}
      </fieldset>
      {(["invoice", "credit_note"] as const).map((kind) => (
        <fieldset key={kind} className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 font-semibold">
            {kind === "invoice" ? "Invoice" : "Credit note"} numbering
          </legend>
          {field(
            `${kind === "invoice" ? "invoice" : "credit"}-key`,
            "Stable series key",
            seed?.series[kind].key,
          )}
          {field(
            `${kind === "invoice" ? "invoice" : "credit"}-prefix`,
            "Number prefix · letters, digits, dash or underscore",
            seed?.series[kind].prefix,
          )}
          {field(
            `${kind === "invoice" ? "invoice" : "credit"}-first`,
            "First number",
            seed?.series[kind].first,
          )}
          {field(
            `${kind === "invoice" ? "invoice" : "credit"}-width`,
            "Minimum digit width",
            seed?.series[kind].width,
            "number",
          )}
        </fieldset>
      ))}
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">
          Supported currency precision and rounding
        </legend>
        <p className="text-sm text-muted-foreground">
          The current financial calculator supports two decimal places. Select
          and review each supported currency explicitly.
        </p>
        {(["INR", "USD"] as const).map((currency) => {
          const c = seed?.currencies.find((c) => c.currency === currency),
            enabled = currencies.includes(currency);
          return (
            <div key={currency} className="space-y-3 rounded-lg bg-muted p-4">
              <label className="flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    setCurrencies((values) =>
                      checked === true
                        ? [...values, currency]
                        : values.filter((v) => v !== currency),
                    )
                  }
                />
                {currency}
              </label>
              <fieldset
                disabled={!enabled}
                className="grid gap-4 sm:grid-cols-2"
              >
                {field(
                  `${currency}-precision`,
                  "Decimal places",
                  c?.precision,
                  "number",
                )}
                {select(
                  `${currency}-rounding`,
                  "Rounding mode",
                  ["half_up", "half_even", "down"],
                  c?.rounding.mode,
                )}
                {select(
                  `${currency}-scope`,
                  "Rounding scope",
                  ["per_line", "subtotal"],
                  c?.rounding.scope,
                )}
                {select(
                  `${currency}-increment`,
                  "Rounding increment in minor units",
                  ["1", "5", "10", "100"],
                  c?.rounding.incrementMinor,
                )}
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`${prefix}-${currency}-additional`}>
                    Additional approved rounding policies · optional · mode |
                    scope | increment per line
                  </Label>
                  <Textarea
                    id={`${prefix}-${currency}-additional`}
                    name={`${currency}-additional`}
                    defaultValue={
                      c?.additionalRoundings
                        .map(
                          (r) => `${r.mode} | ${r.scope} | ${r.incrementMinor}`,
                        )
                        .join("\n") ?? ""
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Modes: half_up, half_even, down. Scopes: per_line, subtotal.
                    Increments: 1, 5, 10, 100. Each captured line must match an
                    explicitly approved policy; its original amount stays
                    unchanged.
                  </p>
                </div>
              </fieldset>
            </div>
          );
        })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">
          Artifact template and protected retention
        </legend>
        {select(
          "format",
          "Artifact format",
          ["text_v1"],
          seed?.template.format,
        )}
        {field("invoice-title", "Invoice title", seed?.template.invoiceTitle)}
        {field("credit-title", "Credit note title", seed?.template.creditTitle)}
        {field(
          "footer",
          "Required footer / legal wording",
          seed?.template.footer,
        )}
        {field(
          "retention",
          "Minimum retention in seconds",
          seed?.retention.minimumSeconds,
          "number",
        )}
        {field(
          "retention-reference",
          "Reviewed retention policy reference",
          seed?.retention.policyReference,
        )}
        {select(
          "disposition",
          "History disposition",
          ["protected_history"],
          seed?.retention.disposition,
        )}
        {select(
          "allocation",
          "Partial credit allocation policy",
          ["cumulative_original_components_v1"],
          seed?.creditAllocation,
        )}
        <p className="text-sm text-muted-foreground">
          Protected history is excluded from ordinary file expiry and deletion.
          Partial credits round cumulative original tax components and preserve
          the exact final remainder.
        </p>
      </fieldset>
      <Label htmlFor={`${prefix}-evidence`}>
        Reviewed legal/configuration evidence · title | reference | checked-at
        ISO UTC · one per line
      </Label>
      <Textarea
        required
        id={`${prefix}-evidence`}
        name="evidence"
        defaultValue={
          seed?.evidence
            .map((e) => `${e.title} | ${e.reference} | ${e.checkedAt}`)
            .join("\n") ?? ""
        }
      />
      <Label htmlFor={`${prefix}-note`}>Reason for this version</Label>
      <Textarea required id={`${prefix}-note`} name="note" maxLength={1000} />
      {error && (
        <Alert role="alert" variant="destructive">
          {error}
        </Alert>
      )}
      <Button disabled={busy}>{busy ? "Saving…" : "Save issuer draft"}</Button>
    </form>
  );
}
