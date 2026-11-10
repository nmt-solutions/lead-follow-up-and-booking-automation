"use client";
import { Field, FieldGroup } from "./ui/field";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { useRef, useState } from "react";
import {
  taxCalculationInputSchema,
  taxCalculationSchema,
  taxWorkspaceSchema,
  type TaxWorkspace,
} from "@/models/tax";
import { BillingStatus } from "./billing-summary";
import { TaxRecord, readTaxResponse } from "./tax-shared";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";

export function TaxManager({
  businessId,
  initial,
  operator = false,
}: {
  businessId: string;
  initial: TaxWorkspace;
  operator?: boolean;
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [currency, setCurrency] = useState(initial.billing.currency ?? "");
  const [lines, setLines] = useState([
    { id: "1", description: "", productCode: "", amount: "", quantity: "1" },
  ]);
  const [note, setNote] = useState("");
  const pending = useRef(false),
    retry = useRef({ fingerprint: "", key: "" }),
    nextLine = useRef(2);
  const base = operator
    ? `/api/platform/tax/${businessId}`
    : `/api/businesses/${businessId}/tax`;
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
        error instanceof Error && error.message.startsWith("Unable")
          ? error.message
          : error instanceof Error &&
              [
                "Verify",
                "Sign in",
                "The saved",
                "Check",
                "Your current",
                "This record",
              ].some((prefix) => error.message.startsWith(prefix))
            ? error.message
            : "Unable to confirm the change. Refresh saved status, then retry.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function keyFor(value: unknown) {
    const fingerprint = JSON.stringify(value);
    if (retry.current.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    return retry.current.key;
  }
  async function calculate() {
    const amounts = lines.map((line) => {
      if (!/^(0|[1-9][0-9]{0,21})(\.[0-9]{1,2})?$/.test(line.amount))
        throw new Error(
          "Check amounts: use nonnegative currency values with at most two decimal places.",
        );
      const [whole, fraction = ""] = line.amount.split(".");
      return {
        id: line.id,
        description: line.description,
        productCode: line.productCode,
        unitAmountMinor: (
          BigInt(whole) * 100n +
          BigInt(fraction.padEnd(2, "0"))
        ).toString(),
        quantity: Number(line.quantity),
      };
    });
    const value = {
      expectedProfileVersion: state.billing.version,
      expectedReviewVersion: state.billing.reviewVersion,
      currency,
      lines: amounts,
      note,
    };
    const input = taxCalculationInputSchema.safeParse({
      ...value,
      requestKey: keyFor(value),
    });
    if (!input.success)
      throw new Error(
        "Check line descriptions, configured product codes, whole quantities and the calculation reason.",
      );
    const record = await readTaxResponse(
      await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.data),
      }),
      taxCalculationSchema,
    );
    setState((current) => ({
      ...current,
      calculations: [
        ...current.calculations.filter((row) => row.id !== record.id),
        record,
      ].sort((a, b) => a.version - b.version),
    }));
    setMessage(
      record.status === "calculated"
        ? "Tax preview recorded using approved treatment and reviewed billing evidence."
        : "Review request recorded. An authorized operator must resolve the listed reasons.",
    );
  }
  async function resolve(calculationId: string) {
    if (!note.trim())
      throw new Error(
        "Check the resolution reason before recording a successor calculation.",
      );
    const value = {
      calculationId,
      expectedProfileVersion: state.billing.version,
      expectedReviewVersion: state.billing.reviewVersion,
      note,
    };
    const record = await readTaxResponse(
      await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...value, requestKey: keyFor(value) }),
      }),
      taxCalculationSchema,
    );
    setState((current) => ({
      ...current,
      calculations: [
        ...current.calculations.filter((row) => row.id !== record.id),
        record,
      ].sort((a, b) => a.version - b.version),
    }));
    setMessage(
      record.status === "calculated"
        ? "Resolution recorded. The original request is preserved."
        : "Successor review request recorded; the listed reasons remain unresolved.",
    );
  }
  const resolved = new Set(
    state.calculations.map((record) => record.resolvesId),
  );
  return (
    <div className="flex flex-col gap-8">
      <BillingStatus state={state.billing} />
      <div className="flex flex-wrap gap-4">
        <Link
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          href={
            operator
              ? `/platform/billing/${businessId}`
              : `/businesses/${businessId}/billing`
          }
        >
          {operator
            ? "Review billing evidence"
            : "Update billing profile and evidence"}
        </Link>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            act(async () => {
              setState(
                await readTaxResponse(
                  await fetch(base, { cache: "no-store" }),
                  taxWorkspaceSchema,
                ),
              );
              setMessage(
                "Saved status refreshed. Your form entries remain here.",
              );
            })
          }
        >
          {busy ? "Working…" : "Refresh saved status"}
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
      {operator ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Resolve tax review</h2>
          <p>
            Correct and review current billing evidence or approve unambiguous
            effective rules first. Re-evaluation records a successor; it cannot
            override missing evidence or invent treatment.
          </p>
          <Label htmlFor="tax-note">Resolution reason</Label>
          <Textarea
            id="tax-note"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(calculate);
          }}
          className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          aria-busy={busy}
        >
          <FieldGroup className="gap-6">
            <h2 className="text-xl font-semibold">Calculate a tax preview</h2>
            <p className="text-muted-foreground">
              Enter amounts before tax in the billing currency. These are
              calculation inputs; subscription pricing and payment require a
              separate agreed quote.
            </p>
            <Field className="flex flex-col gap-2">
              <Label htmlFor="tax-currency">Billing currency</Label>
              <NativeSelect
                id="tax-currency"
                value={currency}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "INR" || value === "USD") setCurrency(value);
                }}
              >
                <option value="" disabled>
                  Choose billing currency
                </option>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </NativeSelect>
            </Field>
            {lines.map((line, index) => (
              <fieldset
                key={line.id}
                className="flex flex-col gap-4 rounded-xl border border-border p-4"
              >
                <legend className="px-2 font-medium">Line {index + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["description", "Description"],
                      ["productCode", "Configured product code"],
                      ["amount", `Unit amount before tax (${currency})`],
                      ["quantity", "Whole quantity"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} className="flex flex-col gap-2">
                      <Label htmlFor={`tax-${line.id}-${key}`}>{label}</Label>
                      <Input
                        id={`tax-${line.id}-${key}`}
                        value={line[key]}
                        inputMode={
                          key === "amount"
                            ? "decimal"
                            : key === "quantity"
                              ? "numeric"
                              : "text"
                        }
                        maxLength={key === "amount" ? 25 : 200}
                        required
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              row.id === line.id
                                ? { ...row, [key]: event.target.value }
                                : row,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setLines((current) =>
                        current.filter((row) => row.id !== line.id),
                      )
                    }
                  >
                    Remove line {index + 1}
                  </Button>
                )}
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={busy || lines.length >= 40}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    id: String(nextLine.current++),
                    description: "",
                    productCode: "",
                    amount: "",
                    quantity: "1",
                  },
                ])
              }
            >
              Add line
            </Button>
            <Field className="flex flex-col gap-2">
              <Label htmlFor="tax-note">Calculation reason or reference</Label>
              <Textarea
                id="tax-note"
                required
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Button disabled={busy} type="submit">
              {busy ? "Calculating…" : "Record tax preview"}
            </Button>
          </FieldGroup>
        </form>
      )}
      <section className="flex flex-col gap-5" aria-labelledby="tax-history">
        <h2 id="tax-history" className="text-xl font-semibold">
          Calculation and review history
        </h2>
        {!state.calculations.length && (
          <p>
            No tax calculations yet. Submit a preview after completing your
            billing profile.
          </p>
        )}
        {[...state.calculations].reverse().map((record) => (
          <div key={record.id} className="flex flex-col gap-3">
            <TaxRecord record={record} />
            {operator &&
              record.status === "review_required" &&
              !resolved.has(record.id) && (
                <Button
                  disabled={busy || !note.trim()}
                  onClick={() => act(() => resolve(record.id))}
                >
                  Re-evaluate calculation {record.version}
                </Button>
              )}
          </div>
        ))}
      </section>
    </div>
  );
}
