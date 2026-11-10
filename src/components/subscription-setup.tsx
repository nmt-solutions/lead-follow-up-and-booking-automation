"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import type { BillingProfile, BillingWorkspace } from "@/models/billing";
import { billingWorkspaceSchema } from "@/models/billing";
import { indiaStates, indiaStateCode, validGstin } from "@/models/india-gst";
import {
  paymentActionSchema,
  type PaymentAction,
} from "@/models/subscription-payments";
import { formatTaxMoney } from "@/models/tax";
import { plans, type PlanId, formatPlanPrice } from "@/content/plans";
import { PlanCards } from "./plan-cards";
import { readCommercialResponse } from "./subscription-quote-client";
import { subscriptionCheckoutUrl } from "@/subscription-payments/razorpay-checkout";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertDescription } from "./ui/alert";

export function SubscriptionSetup({
  businessId,
  selected,
  initial,
  defaults,
  available,
  existing,
  onboarding = false,
}: {
  businessId: string;
  selected?: PlanId;
  initial: BillingWorkspace;
  defaults: BillingProfile;
  available: boolean;
  existing: boolean;
  onboarding?: boolean;
}) {
  const [billing, setBilling] = useState(initial);
  const [action, setAction] = useState<PaymentAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const pending = useRef(false);
  const requestKey = useRef<string | null>(null);
  const confirmedForm = useRef<string | null>(null);
  const plan = plans.find((value) => value.id === selected);
  const base = `/api/businesses/${businessId}`;
  const home = `/businesses/${businessId}/plan`;
  useEffect(() => {
    if (onboarding)
      document.cookie = `lr_setup=${businessId}.plan; Path=/; SameSite=Lax; Max-Age=604800${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [businessId, onboarding]);
  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to complete this step. Try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function review(form: HTMLFormElement) {
    if (!plan) return;
    const data = new FormData(form);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    const gstin = text("gstin").toUpperCase();
    if (
      gstin &&
      (!validGstin(gstin) ||
        gstin.slice(0, 2) !== indiaStateCode(text("region")))
    )
      throw new Error(
        "Check the GSTIN and choose its registered billing state.",
      );
    const facts = {
      indiaTaxTreatment:
        data.get("standardDomestic") === "on" ? "standard" : "needs_review",
      legalName: text("legalName"),
      registrationNumber: defaults.registrationNumber,
      address: {
        line1: text("line1"),
        line2: text("line2"),
        city: text("city"),
        region: text("region"),
        postalCode: text("postalCode"),
        country: "IN",
      },
      invoiceContact: { name: text("contactName"), email: text("email") },
      businessStatus: text("businessStatus"),
      taxIdentifierStatus: gstin ? "provided" : "not_applicable",
      taxIdentifiers: gstin
        ? [{ kind: "GSTIN", country: "IN", value: gstin }]
        : [],
    };
    const fingerprint = JSON.stringify(facts);
    if (confirmedForm.current !== fingerprint) {
      const saved = await readCommercialResponse(
        await fetch(`${base}/billing/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: billing.version,
            expectedReviewVersion: billing.reviewVersion,
            acceptedTerms: true,
            profile: facts,
          }),
        }),
        billingWorkspaceSchema,
      );
      setBilling(saved);
      confirmedForm.current = fingerprint;
      requestKey.current = null;
    }
    requestKey.current ??= crypto.randomUUID();
    const prepared = await readCommercialResponse(
      await fetch(`${base}/subscribe/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          requestKey: requestKey.current,
          acceptedTerms: true,
        }),
      }),
      paymentActionSchema,
    );
    setAction(prepared);
  }
  async function checkout() {
    if (!action || !accepted) return;
    const saved = await readCommercialResponse(
      await fetch(`${base}/subscription-payments/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId: action.id }),
      }),
      paymentActionSchema,
    );
    setAction(saved);
    if (saved.checkout?.url)
      window.location.assign(subscriptionCheckoutUrl(saved.checkout.url));
  }
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 py-8 sm:py-12"
      aria-busy={busy}
    >
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {action
            ? "3 of 3 · Review & pay"
            : plan
              ? "2 of 3 · Billing details"
              : "1 of 3 · Choose a plan"}
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          {action
            ? "Review your subscription"
            : plan
              ? `Set up ${plan.label}`
              : "Choose a plan for your business"}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {action
            ? "Check the total and monthly renewal before opening secure checkout."
            : plan
              ? "Confirm the details for your invoice. We’ve filled in the information you already shared."
              : "Monthly allowances for your business, shared by your team. Choose a plan when you’re ready."}
        </p>
      </header>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {existing ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <h2 className="font-display text-xl">
              Your subscription is already saved
            </h2>
            <p className="text-sm text-muted-foreground">
              Check the current payment or manage your subscription before
              starting another purchase.
            </p>
            <Button asChild className="w-fit">
              <Link href={home}>Open Plan &amp; billing</Link>
            </Button>
          </CardContent>
        </Card>
      ) : !plan ? (
        <PlanCards businessId={businessId} onboarding={onboarding} />
      ) : action ? (
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
            <h2 className="font-display text-2xl">{plan.label} · monthly</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <dt>Subscription</dt>
              <dd className="text-right">
                {formatPlanPrice(plan.monthlyMinor)}
              </dd>
              <dt>Applicable tax</dt>
              <dd className="text-right">
                {action.snapshot.tax.totals
                  ? formatTaxMoney(action.snapshot.tax.totals.taxMinor, "INR")
                  : "Needs confirmation"}
              </dd>
              <dt className="font-semibold">Total per month</dt>
              <dd className="text-right font-semibold">
                {action.snapshot.tax.totals
                  ? formatTaxMoney(action.snapshot.tax.totals.totalMinor, "INR")
                  : "Not yet available"}
              </dd>
            </dl>
            <p className="text-sm leading-7 text-muted-foreground">
              Includes {plan.discovery.toLocaleString("en-IN")} discovery
              credits and {plan.automation.toLocaleString("en-IN")} outreach
              actions per month for India. Your team shares these allowances.
              Unused allowance expires at period end; there are no automatic
              overage charges. Mailbox and Meta charges are separate.
            </p>
            {action.state === "reviewed" && action.snapshot.tax.totals ? (
              <>
                <Field orientation="horizontal">
                  <Checkbox
                    id="subscription-consent"
                    checked={accepted}
                    onCheckedChange={(value) => setAccepted(value === true)}
                  />
                  <FieldLabel
                    htmlFor="subscription-consent"
                    className="text-sm leading-6"
                  >
                    I authorize monthly renewal at the total above until
                    cancelled. I agree to the{" "}
                    <Link
                      className="underline"
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                    >
                      terms
                    </Link>
                    ,{" "}
                    <Link
                      className="underline"
                      href="/cancellation-policy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      cancellation policy
                    </Link>{" "}
                    and{" "}
                    <Link
                      className="underline"
                      href="/refund-policy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      refund policy
                    </Link>
                    .
                  </FieldLabel>
                </Field>
                <Button
                  disabled={busy || !accepted}
                  onClick={() => void run(checkout)}
                >
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <LockKeyhole className="size-4" aria-hidden="true" />
                  )}
                  Continue to secure checkout
                </Button>
              </>
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                {action.checkout
                  ? "Checkout has been saved. Open Plan & billing to continue or check payment status."
                  : "We need to confirm the tax or payment setup for this subscription. Contact support; no payment has been taken."}
              </p>
            )}
            <p className="text-xs leading-6 text-muted-foreground">
              Cancel in Plan &amp; billing before the next renewal. Confirmed
              cancellation keeps access through the paid period. Payment details
              stay with Razorpay. Access starts after verified payment.
            </p>
            <Link href={home} className="text-sm text-primary underline">
              Check payment status
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-3xl">
          <CardContent className="p-6 sm:p-8">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void run(() => review(form));
              }}
            >
              <FieldGroup>
                <div className="flex items-center justify-between gap-4">
                  <p className="font-display text-xl">
                    {formatPlanPrice(plan.monthlyMinor)}{" "}
                    <span className="text-sm text-muted-foreground">
                      / month, plus tax
                    </span>
                  </p>
                  <Link
                    href={
                      onboarding
                        ? `/onboarding/${businessId}?step=plan&plan=choose`
                        : `/businesses/${businessId}/subscribe?plan=choose`
                    }
                    className="text-sm text-primary underline"
                  >
                    Change plan
                  </Link>
                </div>
                <Field>
                  <FieldLabel htmlFor="billing-legal-name">
                    Name on invoice
                  </FieldLabel>
                  <Input
                    id="billing-legal-name"
                    name="legalName"
                    required
                    maxLength={300}
                    autoComplete="organization"
                    placeholder="Your legal business name or full name"
                    defaultValue={defaults.legalName}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="billing-status">Buying as</FieldLabel>
                  <NativeSelect
                    id="billing-status"
                    name="businessStatus"
                    defaultValue={
                      defaults.businessStatus === "unknown"
                        ? "business"
                        : defaults.businessStatus
                    }
                  >
                    <option value="business">A business</option>
                    <option value="individual">An individual</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="billing-line1">
                    Billing address
                  </FieldLabel>
                  <Input
                    id="billing-line1"
                    name="line1"
                    required
                    maxLength={300}
                    autoComplete="address-line1"
                    placeholder="Building and street"
                    defaultValue={defaults.address.line1}
                  />
                  <Input
                    name="line2"
                    aria-label="Address line 2"
                    maxLength={300}
                    autoComplete="address-line2"
                    placeholder="Apartment, floor or landmark (optional)"
                    defaultValue={defaults.address.line2}
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  {[
                    ["city", "City", "Pune", "address-level2"],
                    ["postalCode", "PIN code", "411001", "postal-code"],
                  ].map(([key, label, placeholder, autoComplete]) => (
                    <Field key={key}>
                      <FieldLabel htmlFor={`billing-${key}`}>
                        {label}
                      </FieldLabel>
                      <Input
                        id={`billing-${key}`}
                        name={key}
                        required
                        maxLength={300}
                        autoComplete={autoComplete}
                        placeholder={placeholder}
                        defaultValue={
                          key === "city"
                            ? defaults.address.city
                            : defaults.address.postalCode
                        }
                      />
                    </Field>
                  ))}
                  <Field>
                    <FieldLabel htmlFor="billing-region">
                      State or union territory
                    </FieldLabel>
                    <NativeSelect
                      id="billing-region"
                      name="region"
                      required
                      autoComplete="address-level1"
                      defaultValue={
                        indiaStateCode(defaults.address.region) ?? ""
                      }
                    >
                      <option value="" disabled>
                        Choose your state
                      </option>
                      {indiaStates.map((state) => (
                        <option key={state.code} value={state.code}>
                          {state.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>Country</FieldLabel>
                    <Input
                      aria-label="Billing country"
                      value={
                        defaults.address.country === "IN"
                          ? "India"
                          : defaults.address.country ||
                            "Country needs confirmation"
                      }
                      readOnly
                    />
                  </Field>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="billing-contact">
                      Invoice contact
                    </FieldLabel>
                    <Input
                      id="billing-contact"
                      name="contactName"
                      required
                      maxLength={300}
                      autoComplete="name"
                      placeholder="First and last name"
                      defaultValue={defaults.invoiceContact.name}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="billing-email">
                      Invoice email
                    </FieldLabel>
                    <Input
                      id="billing-email"
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      placeholder="accounts@yourcompany.com"
                      defaultValue={defaults.invoiceContact.email}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="billing-gstin">
                    GSTIN (optional)
                  </FieldLabel>
                  <Input
                    id="billing-gstin"
                    name="gstin"
                    maxLength={15}
                    placeholder="27ABCDE1234F1Z5"
                    defaultValue={
                      defaults.taxIdentifiers.find(
                        (entry) => entry.kind === "GSTIN",
                      )?.value ?? ""
                    }
                  />
                  <p className="text-xs leading-6 text-muted-foreground">
                    Leave blank if you are not GST registered. These are your
                    declared details; tax treatment still requires supported
                    billing rules.
                  </p>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="billing-accuracy"
                    name="standardDomestic"
                    required
                  />
                  <FieldLabel
                    htmlFor="billing-accuracy"
                    className="text-sm leading-6"
                  >
                    These details are accurate. This is not an SEZ purchase or a
                    claim for special GST treatment. I accept the{" "}
                    <Link
                      className="underline"
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                    >
                      terms
                    </Link>
                    .
                  </FieldLabel>
                </Field>
                <p className="text-xs leading-6 text-muted-foreground">
                  For an SEZ purchase or another special GST case,{" "}
                  <Link href="/contact" className="text-primary underline">
                    contact us
                  </Link>{" "}
                  before paying.
                </p>
                {!available && (
                  <Alert>
                    <AlertDescription>
                      Payments are not available yet. You can keep setting up
                      your business and return here when payments open. No
                      payment is taken during setup.
                    </AlertDescription>
                  </Alert>
                )}
                <Button disabled={busy || !available} type="submit">
                  {busy ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Review total
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="ghost" asChild>
          <Link
            href={onboarding ? `/onboarding/${businessId}?step=calendar` : home}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Link>
        </Button>
        {onboarding && (
          <Button variant="outline" asChild>
            <Link href={`/onboarding/${businessId}?step=search`}>
              Set up a plan later
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
        <Link href="/contact" className="text-sm text-primary underline">
          Need help?
        </Link>
      </div>
    </div>
  );
}
