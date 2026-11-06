"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  pricingCatalogSchema,
  pricingConfigureSchema,
  type PricingCatalog,
  type SubscriptionOffer,
} from "@/models/subscription-quotes";
import { readCommercialResponse } from "./subscription-quote-client";
import {
  SubscriptionDisclosures,
  OfferScope,
  quoteMoney,
} from "./subscription-quote-summary";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type AllowanceDraft = { quantity: string; unit: string };
type PricesDraft = { monthly: string; pilot: string };
type CapacityDraft = {
  id: string;
  label: string;
  quantity: string;
  unit: string;
  INR: PricesDraft;
  USD: PricesDraft;
};
type OfferDraft = {
  id: string;
  label: string;
  markets: string;
  discovery: AllowanceDraft;
  automation: AllowanceDraft;
  INR: PricesDraft;
  USD: PricesDraft;
  pilotEnabled: boolean;
  pilotDays: string;
  pilotDiscovery: AllowanceDraft;
  pilotAutomation: AllowanceDraft;
  renewalTerms: string;
  reserved: CapacityDraft[];
};
const emptyAllowance = (): AllowanceDraft => ({ quantity: "", unit: "" });
const emptyPrices = (): PricesDraft => ({ monthly: "", pilot: "" });
const allowanceDraft = (value: SubscriptionOffer["discovery"]) =>
  value
    ? { quantity: String(value.quantity), unit: value.unit }
    : emptyAllowance();
const pricesDraft = (value: SubscriptionOffer["prices"]["INR"]) => ({
  monthly:
    value?.monthlyMinor == null ? "" : (value.monthlyMinor / 100).toFixed(2),
  pilot: value?.pilotMinor == null ? "" : (value.pilotMinor / 100).toFixed(2),
});
function draft(value?: SubscriptionOffer): OfferDraft {
  return value
    ? {
        id: value.id,
        label: value.label,
        markets: value.markets.join("\n"),
        discovery: allowanceDraft(value.discovery),
        automation: allowanceDraft(value.automation),
        INR: pricesDraft(value.prices.INR),
        USD: pricesDraft(value.prices.USD),
        pilotEnabled: Boolean(value.pilot),
        pilotDays: value.pilot ? String(value.pilot.days) : "",
        pilotDiscovery: allowanceDraft(value.pilot?.discovery ?? null),
        pilotAutomation: allowanceDraft(value.pilot?.automation ?? null),
        renewalTerms: value.renewalTerms,
        reserved: value.reservedCapacity.map((item) => ({
          id: item.id,
          label: item.label,
          quantity: String(item.capacity.quantity),
          unit: item.capacity.unit,
          INR: pricesDraft(item.prices.INR),
          USD: pricesDraft(item.prices.USD),
        })),
      }
    : {
        id: "",
        label: "",
        markets: "",
        discovery: emptyAllowance(),
        automation: emptyAllowance(),
        INR: emptyPrices(),
        USD: emptyPrices(),
        pilotEnabled: false,
        pilotDays: "",
        pilotDiscovery: emptyAllowance(),
        pilotAutomation: emptyAllowance(),
        renewalTerms: "",
        reserved: [],
      };
}
function integer(value: string) {
  return /^\d+$/.test(value) ? Number(value) : NaN;
}
function fieldLocation(path: PropertyKey[]) {
  const labels: Record<string, string> = {
    offers: "Reach offers",
    id: "Identifier",
    label: "Name",
    markets: "Discovery markets",
    discovery: "Discovery allowance",
    automation: "Automation allowance",
    quantity: "Quantity",
    unit: "Unit",
    prices: "Prices",
    monthlyMinor: "Monthly price",
    pilotMinor: "Paid pilot price",
    pilot: "Paid pilot",
    days: "Duration in days",
    renewalTerms: "Renewal terms",
    reservedCapacity: "Reserved capacity",
    note: "Reason and approval reference",
    effectiveFrom: "Effective date and time",
  };
  return path
    .map((part) =>
      typeof part === "number"
        ? String(part + 1)
        : (labels[String(part)] ?? String(part)),
    )
    .join(" · ");
}
function minor(value: string) {
  if (!value) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function allowance(value: AllowanceDraft) {
  return !value.quantity && !value.unit
    ? null
    : { quantity: integer(value.quantity), unit: value.unit };
}
function prices(value: PricesDraft) {
  return !value.monthly && !value.pilot
    ? null
    : { monthlyMinor: minor(value.monthly), pilotMinor: minor(value.pilot) };
}
function offerInput(value: OfferDraft) {
  return {
    id: value.id,
    label: value.label,
    markets: value.markets
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    discovery: allowance(value.discovery),
    automation: allowance(value.automation),
    prices: { INR: prices(value.INR), USD: prices(value.USD) },
    pilot: value.pilotEnabled
      ? {
          days: integer(value.pilotDays),
          discovery: allowance(value.pilotDiscovery),
          automation: allowance(value.pilotAutomation),
        }
      : null,
    renewalTerms: value.renewalTerms,
    reservedCapacity: value.reserved.map((item) => ({
      id: item.id,
      label: item.label,
      capacity: { quantity: integer(item.quantity), unit: item.unit },
      prices: { INR: prices(item.INR), USD: prices(item.USD) },
    })),
  };
}
function Field({
  id,
  label,
  value,
  onChange,
  numeric = false,
  multiline = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          maxLength={6000}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          inputMode={numeric ? "decimal" : "text"}
          maxLength={numeric ? 24 : 200}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
function AllowanceFields({
  prefix,
  title,
  value,
  onChange,
}: {
  prefix: string;
  title: string;
  value: AllowanceDraft;
  onChange(value: AllowanceDraft): void;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-2 font-medium">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-quantity`}
          label="Included quantity"
          value={value.quantity}
          numeric
          onChange={(quantity) => onChange({ ...value, quantity })}
        />
        <Field
          id={`${prefix}-unit`}
          label="Allowance unit"
          value={value.unit}
          onChange={(unit) => onChange({ ...value, unit })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Leave both blank for missing configuration. An explicit zero means no
        included units; it never means unlimited.
      </p>
    </fieldset>
  );
}
function PriceFields({
  prefix,
  currency,
  value,
  onChange,
  pilot,
}: {
  prefix: string;
  currency: "INR" | "USD";
  value: PricesDraft;
  onChange(value: PricesDraft): void;
  pilot: boolean;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border p-4">
      <legend className="px-2 font-medium">{currency} platform prices</legend>
      <Field
        id={`${prefix}-monthly`}
        label={`${currency} per monthly renewal`}
        value={value.monthly}
        numeric
        onChange={(monthly) => onChange({ ...value, monthly })}
      />
      {pilot && (
        <Field
          id={`${prefix}-pilot`}
          label={`${currency} for the whole paid pilot`}
          value={value.pilot}
          numeric
          onChange={(next) => onChange({ ...value, pilot: next })}
        />
      )}
      <p className="text-sm text-muted-foreground">
        Enter a positive amount with up to two decimal places. Blank means
        unconfigured. Prices exclude tax and customer-paid Meta messaging.
      </p>
    </fieldset>
  );
}
function OfferEditor({
  value,
  index,
  onChange,
  remove,
}: {
  value: OfferDraft;
  index: number;
  onChange(value: OfferDraft): void;
  remove(): void;
}) {
  const prefix = `offer-${index}`;
  function update<K extends keyof OfferDraft>(key: K, next: OfferDraft[K]) {
    onChange({ ...value, [key]: next });
  }
  return (
    <fieldset className="space-y-5 rounded-2xl border border-border p-5">
      <legend className="px-2 text-xl font-semibold">
        {value.label || `Reach offer ${index + 1}`}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-id`}
          label="Stable offer identifier (lowercase letters, digits, hyphens)"
          value={value.id}
          onChange={(next) => update("id", next)}
        />
        <Field
          id={`${prefix}-label`}
          label="Business-facing offer name"
          value={value.label}
          onChange={(next) => update("label", next)}
        />
      </div>
      <Field
        id={`${prefix}-markets`}
        label="Discovery markets, one per line"
        value={value.markets}
        multiline
        onChange={(next) => update("markets", next)}
      />
      <AllowanceFields
        prefix={`${prefix}-discovery`}
        title="Monthly discovery allowance"
        value={value.discovery}
        onChange={(next) => update("discovery", next)}
      />
      <AllowanceFields
        prefix={`${prefix}-automation`}
        title="Monthly automation allowance"
        value={value.automation}
        onChange={(next) => update("automation", next)}
      />
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-pilot`}>Paid pilot</Label>
        <NativeSelect
          id={`${prefix}-pilot`}
          value={value.pilotEnabled ? "offered" : "unavailable"}
          onChange={(event) =>
            update("pilotEnabled", event.target.value === "offered")
          }
        >
          <option value="unavailable">Not offered</option>
          <option value="offered">Offer a bounded paid pilot</option>
        </NativeSelect>
      </div>
      {value.pilotEnabled && (
        <div className="space-y-5">
          <Field
            id={`${prefix}-days`}
            label="Paid pilot duration in days"
            value={value.pilotDays}
            numeric
            onChange={(next) => update("pilotDays", next)}
          />
          <AllowanceFields
            prefix={`${prefix}-pilot-discovery`}
            title="Total discovery allowance during the pilot"
            value={value.pilotDiscovery}
            onChange={(next) => update("pilotDiscovery", next)}
          />
          <AllowanceFields
            prefix={`${prefix}-pilot-automation`}
            title="Total automation allowance during the pilot"
            value={value.pilotAutomation}
            onChange={(next) => update("pilotAutomation", next)}
          />
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {(["INR", "USD"] as const).map((currency) => (
          <PriceFields
            key={currency}
            prefix={`${prefix}-${currency}`}
            currency={currency}
            value={value[currency]}
            pilot={value.pilotEnabled}
            onChange={(next) => update(currency, next)}
          />
        ))}
      </div>
      <Field
        id={`${prefix}-renewal`}
        label="Monthly renewal and cancellation terms shown to the Business"
        value={value.renewalTerms}
        multiline
        onChange={(next) => update("renewalTerms", next)}
      />
      <fieldset className="space-y-5 rounded-xl border border-border p-4">
        <legend className="px-2 font-semibold">
          Optional reserved discovery capacity
        </legend>
        <p className="text-sm text-muted-foreground">
          Pooled capacity needs no add-on. Define offered execution capacity and
          its separate price; do not use privacy or guaranteed leads as a
          capacity unit.
        </p>
        {value.reserved.map((item, i) => {
          const itemPrefix = `${prefix}-reserved-${i}`;
          const change = (next: CapacityDraft) =>
            update(
              "reserved",
              value.reserved.map((entry, n) => (n === i ? next : entry)),
            );
          return (
            <fieldset
              key={i}
              className="space-y-4 rounded-xl border border-border p-4"
            >
              <legend className="px-2 font-medium">
                Reserved option {i + 1}
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id={`${itemPrefix}-id`}
                  label="Stable capacity identifier"
                  value={item.id}
                  onChange={(id) => change({ ...item, id })}
                />
                <Field
                  id={`${itemPrefix}-label`}
                  label="Business-facing capacity name"
                  value={item.label}
                  onChange={(label) => change({ ...item, label })}
                />
                <Field
                  id={`${itemPrefix}-quantity`}
                  label="Reserved capacity quantity"
                  value={item.quantity}
                  numeric
                  onChange={(quantity) => change({ ...item, quantity })}
                />
                <Field
                  id={`${itemPrefix}-unit`}
                  label="Capacity unit"
                  value={item.unit}
                  onChange={(unit) => change({ ...item, unit })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["INR", "USD"] as const).map((currency) => (
                  <PriceFields
                    key={currency}
                    prefix={`${itemPrefix}-${currency}`}
                    currency={currency}
                    value={item[currency]}
                    pilot={value.pilotEnabled}
                    onChange={(next) => change({ ...item, [currency]: next })}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  update(
                    "reserved",
                    value.reserved.filter((_, n) => n !== i),
                  )
                }
              >
                Remove reserved option {i + 1}
              </Button>
            </fieldset>
          );
        })}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            update("reserved", [
              ...value.reserved,
              {
                id: "",
                label: "",
                quantity: "",
                unit: "",
                INR: emptyPrices(),
                USD: emptyPrices(),
              },
            ])
          }
          disabled={value.reserved.length >= 20}
        >
          Add reserved option
        </Button>
      </fieldset>
      <Button type="button" variant="outline" onClick={remove}>
        Remove this offer from the next version
      </Button>
    </fieldset>
  );
}

export function SubscriptionPricingManager({
  initial,
}: {
  initial: PricingCatalog;
}) {
  const [state, setState] = useState(initial);
  const [offers, setOffers] = useState<OfferDraft[]>(() =>
    (initial.history.at(-1)?.offers ?? []).map((item) => draft(item)),
  );
  const [timing, setTiming] = useState("immediate");
  const [schedule, setSchedule] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const input = {
    expectedVersion: state.version,
    effectiveFrom:
      timing === "immediate" ? null : schedule ? `${schedule}:00.000Z` : "",
    note,
    offers: offers.map(offerInput),
  };
  const parsed = pricingConfigureSchema.safeParse(input);
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
        error instanceof Error
          ? error.message
          : "Unable to save pricing. Your edits remain here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-xl font-semibold">
          Effective commercial configuration
        </h2>
        <p>
          Effective version: {state.current?.version ?? "Not configured"}.
          Latest saved version: {state.version}.
        </p>
        <p className="text-sm text-muted-foreground">
          Each version replaces the whole catalog from its effective time. An
          empty catalog withdraws new offers. Existing quote values are
          preserved and assessed against current configuration; publishing never
          charges a Business.
        </p>
        <Link
          href="/security"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Security and operator verification
        </Link>
      </section>
      <SubscriptionDisclosures />
      <form
        className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.success) return;
          void act(async () => {
            const saved = await readCommercialResponse(
              await fetch("/api/platform/pricing", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(parsed.data),
              }),
              pricingCatalogSchema,
            );
            setState(saved);
            setNote("");
            setMessage(
              `Price version ${saved.version} saved. Its effective date determines when new quotes use it.`,
            );
          });
        }}
      >
        <h2 className="text-2xl font-semibold">Next price version</h2>
        <p className="text-sm text-muted-foreground">
          Enter approved commercial inputs only. There are no production prices,
          FX rates, allowance quantities or tax defaults. Unconfigured currency
          prices and allowances keep affected quotes unavailable.
        </p>
        <fieldset disabled={busy} className="space-y-6">
          {offers.map((offer, index) => (
            <OfferEditor
              key={index}
              value={offer}
              index={index}
              onChange={(next) =>
                setOffers((current) =>
                  current.map((item, n) => (n === index ? next : item)),
                )
              }
              remove={() =>
                setOffers((current) => current.filter((_, n) => n !== index))
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={offers.length >= 50}
            onClick={() => setOffers((current) => [...current, draft()])}
          >
            Add reach offer
          </Button>
          <div className="space-y-2">
            <Label htmlFor="pricing-timing">Effective time</Label>
            <NativeSelect
              id="pricing-timing"
              value={timing}
              onChange={(event) => setTiming(event.target.value)}
            >
              <option value="immediate">Immediately when saved</option>
              <option value="scheduled">Scheduled in UTC</option>
            </NativeSelect>
            {state.history.at(-1) && (
              <p className="text-sm text-muted-foreground">
                The next effective time must be at or after{" "}
                {new Date(state.history.at(-1)!.effectiveFrom).toLocaleString(
                  "en",
                  { timeZone: "UTC" },
                )}{" "}
                UTC. Use scheduled timing while that date is in the future.
              </p>
            )}
          </div>
          {timing === "scheduled" && (
            <div className="space-y-2">
              <Label htmlFor="pricing-schedule">
                Effective date and time (UTC)
              </Label>
              <Input
                id="pricing-schedule"
                type="datetime-local"
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Use a future UTC time at or after the latest saved effective
                date. This is not your local time zone.
              </p>
            </div>
          )}
          <Field
            id="pricing-note"
            label="Reason and approval reference for this price version"
            value={note}
            multiline
            onChange={setNote}
          />
        </fieldset>
        {!parsed.success && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p>Complete or correct these fields before publishing:</p>
            <ul className="list-disc pl-5">
              {parsed.error.issues.slice(0, 12).map((issue, i) => (
                <li key={i}>
                  {fieldLocation(issue.path)}:{" "}
                  {issue.code === "invalid_type"
                    ? "Enter the requested quantity or amount in the indicated format."
                    : issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy || !parsed.success}>
            {busy ? "Saving…" : "Publish price version"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={busy}>
                Load latest saved catalog
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>
                Replace unsaved pricing edits?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This loads the latest saved catalog, including any future
                version. Unsaved offer edits, timing and note will be discarded.
              </AlertDialogDescription>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void act(async () => {
                      const saved = await readCommercialResponse(
                        await fetch("/api/platform/pricing", {
                          cache: "no-store",
                        }),
                        pricingCatalogSchema,
                      );
                      setState(saved);
                      setOffers(
                        (saved.history.at(-1)?.offers ?? []).map((item) =>
                          draft(item),
                        ),
                      );
                      setTiming("immediate");
                      setSchedule("");
                      setNote("");
                      setMessage(
                        "Latest saved catalog loaded. Review the effective time before publishing.",
                      );
                    })
                  }
                >
                  Load saved catalog
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}
      </form>
      <section className="space-y-4" aria-labelledby="price-history">
        <h2 id="price-history" className="text-2xl font-semibold">
          Price history
        </h2>
        {!state.history.length && (
          <p>No price versions have been configured.</p>
        )}
        {state.history.toReversed().map((revision) => (
          <details
            key={revision.id}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <summary className="cursor-pointer font-medium">
              Version {revision.version} — effective{" "}
              {new Date(revision.effectiveFrom).toLocaleString("en", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </summary>
            <div className="mt-4 space-y-5">
              <p className="text-sm text-muted-foreground">
                {revision.actorName} · {revision.note}
              </p>
              {!revision.offers.length && (
                <p>No offers from this version’s effective time.</p>
              )}
              {revision.offers.map((offer) => (
                <section key={offer.id} className="space-y-3">
                  <h3 className="font-semibold">{offer.label}</h3>
                  <OfferScope offer={offer} />
                  {(["INR", "USD"] as const).map((currency) => (
                    <p key={currency}>
                      {currency}:{" "}
                      {quoteMoney(
                        offer.prices[currency]?.monthlyMinor,
                        currency,
                      )}{" "}
                      / month
                      {offer.pilot
                        ? `; ${quoteMoney(offer.prices[currency]?.pilotMinor, currency)} for ${offer.pilot.days} pilot days`
                        : "; no pilot offered"}
                    </p>
                  ))}
                  {offer.reservedCapacity.map((capacity) => (
                    <div
                      key={capacity.id}
                      className="space-y-2 rounded-xl border border-border p-4"
                    >
                      <p>
                        {capacity.label}: {capacity.capacity.quantity}{" "}
                        {capacity.capacity.unit}
                      </p>
                      {(["INR", "USD"] as const).map((currency) => (
                        <p key={currency}>
                          {currency}:{" "}
                          {quoteMoney(
                            capacity.prices[currency]?.monthlyMinor,
                            currency,
                          )}{" "}
                          / month
                          {offer.pilot
                            ? `; ${quoteMoney(capacity.prices[currency]?.pilotMinor, currency)} for the whole pilot`
                            : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
