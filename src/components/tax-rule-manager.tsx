"use client";
import { Field as UiField, FieldGroup } from "./ui/field";
import { RecoveryLink } from "./recovery-link";
import { useRef, useState } from "react";
import {
  taxCatalogSchema,
  taxRuleSaveSchema,
  type TaxCatalog,
  type TaxRule,
} from "@/models/tax";
import { TaxRuleDetails, readTaxResponse } from "./tax-shared";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const empty: TaxRule = {
  mode: "live",
  customerCountry: "",
  customerRegion: null,
  buyerStatus: "business",
  currency: "INR",
  productCode: "",
  effectiveFrom: "",
  effectiveUntil: null,
  jurisdiction: { code: "", name: "", country: "" },
  registration: {
    status: "registered",
    identifier: "",
    effectiveFrom: "",
    effectiveUntil: null,
  },
  treatment: "taxable",
  rationale: "",
  requiredEvidence: ["legal_identity", "billing_address", "business_status"],
  rates: [],
  rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
  evidence: [],
};
function Field({
  id,
  label,
  value,
  change,
  optional = false,
  date = false,
}: {
  id: string;
  label: string;
  value: string;
  change(value: string): void;
  optional?: boolean;
  date?: boolean;
}) {
  return (
    <UiField className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {date && " (UTC)"}
        {optional && " (optional)"}
      </Label>
      <Input
        id={id}
        value={date ? value.slice(0, 16) : value}
        required={!optional}
        type={date ? "datetime-local" : "text"}
        maxLength={date ? undefined : 1000}
        onChange={(event) => {
          const raw = event.target.value;
          change(date && raw ? new Date(`${raw}Z`).toISOString() : raw);
        }}
      />
    </UiField>
  );
}
function Choice({
  id,
  label,
  value,
  choices,
  change,
}: {
  id: string;
  label: string;
  value: string;
  choices: readonly string[];
  change(value: string): void;
}) {
  return (
    <UiField className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice.replaceAll("_", " ")}
          </option>
        ))}
      </NativeSelect>
    </UiField>
  );
}
export function TaxRuleManager({ initial }: { initial: TaxCatalog }) {
  const [catalog, setCatalog] = useState(initial),
    [rule, setRule] = useState(empty),
    [key, setKey] = useState(""),
    [expectedVersion, setExpectedVersion] = useState(0),
    [note, setNote] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
      {},
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  function field<K extends keyof TaxRule>(name: K, value: TaxRule[K]) {
    setRule((current) => ({ ...current, [name]: value }));
  }
  async function act(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (error: unknown) {
      setError(
        error instanceof Error &&
          [
            "Verify",
            "Sign in",
            "The saved",
            "Check",
            "Your current",
            "This record",
            "Unable",
          ].some((prefix) => error.message.startsWith(prefix))
          ? error.message
          : "Unable to confirm the operation. Refresh saved status before retrying.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    const parsed = taxRuleSaveSchema.safeParse({
      key,
      expectedVersion,
      rule,
      note,
    });
    if (!parsed.success)
      throw new Error(
        "Check all fields: use supported country codes, valid effective windows, evidence references and positive integer tax fractions. Only taxable treatment has rate components.",
      );
    setCatalog(
      await readTaxResponse(
        await fetch("/api/platform/tax/rules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        }),
        taxCatalogSchema,
      ),
    );
    setExpectedVersion(expectedVersion + 1);
    setMessage(
      "Draft revision saved. Review its exact contents and record an approval before calculations may use it.",
    );
  }
  async function decide(revisionId: string, outcome: "approved" | "withdrawn") {
    const latest = catalog.decisions
      .filter((row) => row.revisionId === revisionId)
      .at(-1);
    setCatalog(
      await readTaxResponse(
        await fetch("/api/platform/tax/rules/decisions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revisionId,
            expectedDecisionVersion: latest?.version ?? 0,
            outcome,
            note: decisionNotes[revisionId] ?? "",
          }),
        }),
        taxCatalogSchema,
      ),
    );
    setMessage(
      outcome === "approved"
        ? "Exact rule revision approved. Effective dates, evidence and competing coverage still apply."
        : "Withdrawal recorded. Existing calculation snapshots remain unchanged.",
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            act(async () => {
              setCatalog(
                await readTaxResponse(
                  await fetch("/api/platform/tax/rules", { cache: "no-store" }),
                  taxCatalogSchema,
                ),
              );
              setMessage(
                "Saved rule status refreshed. Your draft remains here; reload a revision to adopt a newer base.",
              );
            })
          }
        >
          Refresh saved status
        </Button>
        <RecoveryLink
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Security
        </RecoveryLink>
      </div>
      {error && <Alert>{error}</Alert>}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-border bg-card p-4"
        >
          {message}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(save);
        }}
        className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-busy={busy}
      >
        <FieldGroup className="gap-6">
          <h2 className="text-xl font-semibold">Draft rule revision</h2>
          <p className="text-muted-foreground">
            No legal rates or jurisdictions are preconfigured. Supply evidence
            for supported customer coverage, seller registration and treatment.
            Amounts are exclusive of tax. Fixture configuration is excluded from
            live calculations.
          </p>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-4 font-semibold">
              Coverage and effective dates
            </legend>
            <Field
              id="rule-key"
              label="Rule key (lowercase letters, numbers, hyphens)"
              value={key}
              change={setKey}
            />
            <p className="self-center text-sm text-muted-foreground">
              Base version {expectedVersion}. To revise an existing rule, load
              its starting point below. Saving always appends a new draft.
            </p>
            <Choice
              id="rule-mode"
              label="Configuration use"
              value={rule.mode}
              choices={["live", "fixture"]}
              change={(value) => {
                if (value === "live" || value === "fixture")
                  field("mode", value);
              }}
            />
            <Field
              id="rule-country"
              label="Customer country code"
              value={rule.customerCountry}
              change={(value) => field("customerCountry", value.toUpperCase())}
            />
            <Field
              id="rule-region"
              label="Exact customer region; blank covers entire country"
              optional
              value={rule.customerRegion ?? ""}
              change={(value) => field("customerRegion", value || null)}
            />
            <Choice
              id="rule-buyer"
              label="Purchasing status"
              value={rule.buyerStatus}
              choices={["business", "individual"]}
              change={(value) => {
                if (value === "business" || value === "individual")
                  field("buyerStatus", value);
              }}
            />
            <Choice
              id="rule-currency"
              label="Billing currency"
              value={rule.currency}
              choices={["INR", "USD"]}
              change={(value) => {
                if (value === "INR" || value === "USD")
                  field("currency", value);
              }}
            />
            <Field
              id="rule-product"
              label="Product code"
              value={rule.productCode}
              change={(value) => field("productCode", value)}
            />
            <Field
              id="rule-from"
              label="Effective from"
              date
              value={rule.effectiveFrom}
              change={(value) => field("effectiveFrom", value)}
            />
            <Field
              id="rule-until"
              label="Effective until, end excluded"
              date
              optional
              value={rule.effectiveUntil ?? ""}
              change={(value) => field("effectiveUntil", value || null)}
            />
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-4 font-semibold">
              Jurisdiction and seller registration
            </legend>
            {(
              [
                ["code", "Jurisdiction code"],
                ["name", "Jurisdiction name"],
                ["country", "Jurisdiction country code"],
              ] as const
            ).map(([name, label]) => (
              <Field
                key={name}
                id={`jurisdiction-${name}`}
                label={label}
                value={rule.jurisdiction[name]}
                change={(value) =>
                  field("jurisdiction", {
                    ...rule.jurisdiction,
                    [name]: name === "country" ? value.toUpperCase() : value,
                  })
                }
              />
            ))}
            <Choice
              id="registration-status"
              label="Reviewed registration position"
              value={rule.registration.status}
              choices={["registered", "not_required"]}
              change={(value) => {
                if (value === "registered" || value === "not_required")
                  field("registration", {
                    ...rule.registration,
                    status: value,
                  });
              }}
            />
            <Field
              id="registration-reference"
              label="Seller registration number or non-requirement evidence reference"
              value={rule.registration.identifier}
              change={(value) =>
                field("registration", {
                  ...rule.registration,
                  identifier: value,
                })
              }
            />
            <Field
              id="registration-from"
              label="Registration effective from"
              date
              value={rule.registration.effectiveFrom}
              change={(value) =>
                field("registration", {
                  ...rule.registration,
                  effectiveFrom: value,
                })
              }
            />
            <Field
              id="registration-until"
              label="Registration effective until, end excluded"
              date
              optional
              value={rule.registration.effectiveUntil ?? ""}
              change={(value) =>
                field("registration", {
                  ...rule.registration,
                  effectiveUntil: value || null,
                })
              }
            />
          </fieldset>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-4 font-semibold">
              Treatment and required evidence
            </legend>
            <Choice
              id="rule-treatment"
              label="Reviewed treatment"
              value={rule.treatment}
              choices={[
                "taxable",
                "zero_rated",
                "exempt",
                "reverse_charge",
                "export",
              ]}
              change={(value) => {
                if (
                  value === "taxable" ||
                  value === "zero_rated" ||
                  value === "exempt" ||
                  value === "reverse_charge" ||
                  value === "export"
                )
                  field("treatment", value);
              }}
            />
            <Field
              id="rule-rationale"
              label="Treatment and registration rationale"
              value={rule.rationale}
              change={(value) => field("rationale", value)}
            />
            <p className="text-sm text-muted-foreground">
              Legal identity, address and purchasing status are always required
              by billing review. Add tax-identifier evidence when this treatment
              requires it.
            </p>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="rule-tax-claim"
                checked={rule.requiredEvidence.includes("tax_identifier")}
                onCheckedChange={(checked) =>
                  field(
                    "requiredEvidence",
                    checked === true
                      ? [
                          "legal_identity",
                          "billing_address",
                          "business_status",
                          "tax_identifier",
                        ]
                      : [
                          "legal_identity",
                          "billing_address",
                          "business_status",
                        ],
                  )
                }
              />
              <Label htmlFor="rule-tax-claim">
                Require reviewed tax-identifier evidence
              </Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Enter each additive tax as an exact fraction of the amount before
              tax. Non-taxable treatments must have no rate rows.
            </p>
            {rule.rates.map((rate, index) => (
              <fieldset
                key={index}
                className="flex flex-col gap-4 rounded-xl border border-border p-4"
              >
                <legend className="px-2">Tax component {index + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  {(
                    [
                      ["name", "Tax name"],
                      ["numerator", "Fraction numerator"],
                      ["denominator", "Fraction denominator"],
                    ] as const
                  ).map(([name, label]) => (
                    <Field
                      key={name}
                      id={`rate-${index}-${name}`}
                      label={label}
                      value={rate[name]}
                      change={(value) =>
                        field(
                          "rates",
                          rule.rates.map((row, i) =>
                            i === index ? { ...row, [name]: value } : row,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    field(
                      "rates",
                      rule.rates.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove tax component {index + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={rule.rates.length >= 10}
              onClick={() =>
                field("rates", [
                  ...rule.rates,
                  { name: "", numerator: "", denominator: "" },
                ])
              }
            >
              Add tax component
            </Button>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-4 font-semibold">
              Tax rounding (INR and USD have two decimal places)
            </legend>
            <Choice
              id="rounding-mode"
              label="Rounding mode"
              value={rule.rounding.mode}
              choices={["half_up", "half_even", "down"]}
              change={(value) => {
                if (
                  value === "half_up" ||
                  value === "half_even" ||
                  value === "down"
                )
                  field("rounding", { ...rule.rounding, mode: value });
              }}
            />
            <Choice
              id="rounding-scope"
              label="Round each tax component by"
              value={rule.rounding.scope}
              choices={["per_line", "subtotal"]}
              change={(value) => {
                if (value === "per_line" || value === "subtotal")
                  field("rounding", { ...rule.rounding, scope: value });
              }}
            />
            <Choice
              id="rounding-increment"
              label="Rounding increment in minor units (1 = 0.01)"
              value={rule.rounding.incrementMinor}
              choices={["1", "5", "10", "100"]}
              change={(value) => {
                if (
                  value === "1" ||
                  value === "5" ||
                  value === "10" ||
                  value === "100"
                )
                  field("rounding", {
                    ...rule.rounding,
                    incrementMinor: value,
                  });
              }}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-4 font-semibold">
              Configuration evidence
            </legend>
            <p className="text-sm text-muted-foreground">
              Record the verified source or retained document reference and
              check time for coverage, registration, rates and treatment. A
              fixture reference is synthetic evidence only.
            </p>
            {rule.evidence.map((evidence, index) => (
              <fieldset
                key={index}
                className="flex flex-col gap-4 rounded-xl border border-border p-4"
              >
                <legend className="px-2">Evidence {index + 1}</legend>
                {(
                  [
                    ["title", "Source title"],
                    ["reference", "Source or document reference"],
                    ["checkedAt", "Verified at"],
                  ] as const
                ).map(([name, label]) => (
                  <Field
                    key={name}
                    id={`evidence-${index}-${name}`}
                    label={label}
                    date={name === "checkedAt"}
                    value={evidence[name]}
                    change={(value) =>
                      field(
                        "evidence",
                        rule.evidence.map((row, i) =>
                          i === index ? { ...row, [name]: value } : row,
                        ),
                      )
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    field(
                      "evidence",
                      rule.evidence.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove evidence {index + 1}
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={rule.evidence.length >= 20}
              onClick={() =>
                field("evidence", [
                  ...rule.evidence,
                  { title: "", reference: "", checkedAt: "" },
                ])
              }
            >
              Add evidence reference
            </Button>
          </fieldset>
          <UiField className="flex flex-col gap-2">
            <Label htmlFor="rule-note">Revision reason</Label>
            <Textarea
              id="rule-note"
              required
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </UiField>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save draft revision"}
          </Button>
        </FieldGroup>
      </form>
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">
          Rule revisions and approval history
        </h2>
        <p className="text-muted-foreground">
          For each key and calculation time, the highest approved or withdrawn
          revision effective by that time supersedes earlier revisions.
          Withdrawal or expiry does not restore older coverage. Overlapping keys
          require review.
        </p>
        {!catalog.revisions.length && (
          <p>
            No rules configured. Calculations require review until explicit
            supported coverage is approved.
          </p>
        )}
        {[...catalog.revisions].reverse().map((revision) => {
          const decisions = catalog.decisions.filter(
              (decision) => decision.revisionId === revision.id,
            ),
            latest = decisions.at(-1);
          return (
            <article
              key={revision.id}
              className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8 wrap-anywhere"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <h3 className="text-lg font-semibold">
                  {revision.key} v{revision.version}
                </h3>
                <Badge>
                  {latest?.outcome ?? "Draft"} · {revision.rule.mode}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {revision.actorName} · {revision.at} · {revision.note}
              </p>
              <TaxRuleDetails rule={revision.rule} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    Use as starting point
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>
                    Replace the current draft?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Your unsaved draft fields will be replaced. Saved revisions
                    and approval history remain available.
                  </AlertDialogDescription>
                  <div className="flex flex-wrap justify-end gap-3">
                    <AlertDialogCancel>Keep draft</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setRule(revision.rule);
                        setKey(revision.key);
                        setExpectedVersion(
                          catalog.revisions
                            .filter((row) => row.key === revision.key)
                            .at(-1)?.version ?? 0,
                        );
                        setNote("");
                        setMessage(
                          "Starting point loaded. Edit the draft above and save a new revision.",
                        );
                      }}
                    >
                      Load starting point
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
              <ul className="flex flex-col gap-2">
                {decisions.map((decision) => (
                  <li key={decision.id}>
                    Decision {decision.version}: {decision.outcome} ·{" "}
                    {decision.actorName} · {decision.at} · {decision.note}
                  </li>
                ))}
              </ul>
              <UiField className="flex flex-col gap-2">
                <Label htmlFor={`decision-${revision.id}`}>
                  Approval or withdrawal reason for this exact revision
                </Label>
                <Textarea
                  id={`decision-${revision.id}`}
                  maxLength={1000}
                  value={decisionNotes[revision.id] ?? ""}
                  onChange={(event) =>
                    setDecisionNotes((current) => ({
                      ...current,
                      [revision.id]: event.target.value,
                    }))
                  }
                />
              </UiField>
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={busy || !decisionNotes[revision.id]?.trim()}
                  onClick={() => act(() => decide(revision.id, "approved"))}
                >
                  Approve exact revision
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !decisionNotes[revision.id]?.trim()}
                  onClick={() => act(() => decide(revision.id, "withdrawn"))}
                >
                  Withdraw exact revision
                </Button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
