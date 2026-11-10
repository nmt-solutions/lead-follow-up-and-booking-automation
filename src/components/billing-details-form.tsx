"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  billingConfirmSchema,
  billingWorkspaceSchema,
  type BillingProfile,
  type BillingWorkspace,
} from "@/models/billing";
import { indiaStates, indiaStateCode } from "@/models/india-gst";
import { FormSteps } from "./form-steps";
import { BillingHistory } from "./billing-summary";
import { WorkspaceTabs } from "./workspace-tabs";
import { readCommercialResponse } from "./subscription-quote-client";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";

export function BillingDetailsForm({
  businessId,
  initial,
  defaults,
}: {
  businessId: string;
  initial: BillingWorkspace;
  defaults: BillingProfile;
}) {
  const [state, setState] = useState(initial);
  const [profile, setProfile] = useState(defaults);
  const [gstin, setGstin] = useState(
    defaults.taxIdentifiers.find((item) => item.kind.toUpperCase() === "GSTIN")
      ?.value ?? "",
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const advanced = `/businesses/${businessId}/billing?view=review`;
  function addressField(
    key: "line1" | "line2" | "city" | "postalCode",
    label: string,
    placeholder: string,
    autoComplete: string,
    required = true,
  ) {
    return (
      <Field>
        <FieldLabel htmlFor={`billing-${key}`}>{label}</FieldLabel>
        <Input
          id={`billing-${key}`}
          value={profile.address[key]}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          maxLength={key === "postalCode" ? 6 : 300}
          inputMode={key === "postalCode" ? "numeric" : undefined}
          pattern={key === "postalCode" ? "[1-9][0-9]{5}" : undefined}
          onChange={(event) => {
            setAccepted(false);
            setProfile({
              ...profile,
              address: { ...profile.address, [key]: event.target.value },
            });
          }}
        />
      </Field>
    );
  }
  const unsupported =
    profile.address.country !== "IN" ||
    profile.indiaTaxTreatment === "needs_review" ||
    defaults.taxIdentifiers.length > 1 ||
    defaults.taxIdentifiers.some(
      (item) => item.kind.toUpperCase() !== "GSTIN" || item.country !== "IN",
    );
  async function save() {
    if (pending.current) return;
    const input = billingConfirmSchema.safeParse({
      expectedVersion: state.version,
      expectedReviewVersion: state.reviewVersion,
      acceptedTerms: accepted,
      profile: {
        legalName: profile.legalName,
        registrationNumber: profile.registrationNumber,
        address: {
          ...profile.address,
          region:
            indiaStateCode(profile.address.region) ?? profile.address.region,
        },
        invoiceContact: profile.invoiceContact,
        businessStatus: profile.businessStatus,
        indiaTaxTreatment: "standard",
        taxIdentifierStatus: gstin.trim() ? "provided" : "not_applicable",
        taxIdentifiers: gstin.trim()
          ? [
              {
                kind: "GSTIN",
                country: "IN",
                value: gstin.trim().toUpperCase(),
              },
            ]
          : [],
      },
    });
    if (!input.success) {
      setError(
        "Check your billing details, GSTIN and confirmation before saving.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await readCommercialResponse(
        await fetch(`/api/businesses/${businessId}/billing/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.data),
        }),
        billingWorkspaceSchema,
      );
      setState(saved);
      setMessage(
        saved.status === "reviewed"
          ? "Billing details saved. Future checkout will use these details."
          : "Details saved. A billing review is still needed before checkout.",
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save billing details. Your edits are still here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const saved = await readCommercialResponse(
        await fetch(`/api/businesses/${businessId}/billing`, {
          cache: "no-store",
        }),
        billingWorkspaceSchema,
      );
      const loaded = saved.current?.profile ?? defaults;
      setState(saved);
      setProfile(loaded);
      setGstin(
        loaded.taxIdentifiers.find(
          (item) => item.kind.toUpperCase() === "GSTIN",
        )?.value ?? "",
      );
      setAccepted(false);
      setError("");
      setMessage(
        "Saved billing details loaded. Review them before saving another update.",
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load saved billing details. Your edits are still here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link href="/security" className="underline">
              Check account security
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Reload saved details
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Reload saved billing details?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This replaces the edits in this form with the latest saved
                  details. Your current edits will be lost.
                </AlertDialogDescription>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel>Keep editing</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void reload()}>
                    Reload saved details
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      <WorkspaceTabs
        tabs={[
          {
            id: "details",
            label: "Billing details",
            description:
              "We reuse your saved business address. Check it and change it only if your billing address is different.",
            content: unsupported ? (
              <Alert>
                <AlertDescription>
                  These billing details need an assisted review.{" "}
                  <Link href={advanced} className="underline">
                    Open billing review
                  </Link>{" "}
                  to save the details and supporting documents.
                </AlertDescription>
              </Alert>
            ) : (
              <Card>
                <CardContent className="p-6 sm:p-8">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                    aria-busy={busy}
                  >
                    <FormSteps
                      disabled={busy}
                      steps={[
                        {
                          id: "address",
                          label: "Name and address",
                          description:
                            "Use the legal name and address that should appear on your invoices.",
                          content: (
                            <FieldGroup>
                              <Field>
                                <FieldLabel htmlFor="billing-legal-name">
                                  Legal name
                                </FieldLabel>
                                <Input
                                  id="billing-legal-name"
                                  required
                                  autoComplete="organization"
                                  placeholder="Registered business or full legal name"
                                  value={profile.legalName}
                                  maxLength={300}
                                  onChange={(event) => {
                                    setAccepted(false);
                                    setProfile({
                                      ...profile,
                                      legalName: event.target.value,
                                    });
                                  }}
                                />
                              </Field>
                              {addressField(
                                "line1",
                                "Address",
                                "Building and street",
                                "address-line1",
                              )}
                              {addressField(
                                "line2",
                                "Address line 2, optional",
                                "Area or landmark",
                                "address-line2",
                                false,
                              )}
                              <div className="grid gap-5 sm:grid-cols-2">
                                {addressField(
                                  "city",
                                  "City",
                                  "Kalyan",
                                  "address-level2",
                                )}
                                <Field>
                                  <FieldLabel htmlFor="billing-state">
                                    State or union territory
                                  </FieldLabel>
                                  <NativeSelect
                                    id="billing-state"
                                    required
                                    value={
                                      indiaStateCode(profile.address.region) ??
                                      ""
                                    }
                                    onChange={(event) => {
                                      setAccepted(false);
                                      setProfile({
                                        ...profile,
                                        address: {
                                          ...profile.address,
                                          region: event.target.value,
                                        },
                                      });
                                    }}
                                  >
                                    <option value="">
                                      Choose your billing state
                                    </option>
                                    {indiaStates.map((item) => (
                                      <option key={item.code} value={item.code}>
                                        {item.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </Field>
                                {addressField(
                                  "postalCode",
                                  "PIN code",
                                  "421301",
                                  "postal-code",
                                )}
                              </div>
                            </FieldGroup>
                          ),
                        },
                        {
                          id: "contact",
                          label: "Contact and GST",
                          description:
                            "Choose who receives invoices. Add a GSTIN if this purchase is for a GST-registered business.",
                          content: (
                            <FieldGroup>
                              <Field>
                                <FieldLabel htmlFor="billing-contact">
                                  Invoice contact
                                </FieldLabel>
                                <Input
                                  id="billing-contact"
                                  required
                                  autoComplete="name"
                                  placeholder="First and last name"
                                  value={profile.invoiceContact.name}
                                  maxLength={300}
                                  onChange={(event) => {
                                    setAccepted(false);
                                    setProfile({
                                      ...profile,
                                      invoiceContact: {
                                        ...profile.invoiceContact,
                                        name: event.target.value,
                                      },
                                    });
                                  }}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="billing-email">
                                  Invoice email
                                </FieldLabel>
                                <Input
                                  id="billing-email"
                                  required
                                  type="email"
                                  autoComplete="email"
                                  placeholder="accounts@company.com"
                                  value={profile.invoiceContact.email}
                                  maxLength={254}
                                  onChange={(event) => {
                                    setAccepted(false);
                                    setProfile({
                                      ...profile,
                                      invoiceContact: {
                                        ...profile.invoiceContact,
                                        email: event.target.value,
                                      },
                                    });
                                  }}
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="billing-buyer-type">
                                  Buying for
                                </FieldLabel>
                                <NativeSelect
                                  id="billing-buyer-type"
                                  required
                                  value={
                                    profile.businessStatus === "unknown"
                                      ? ""
                                      : profile.businessStatus
                                  }
                                  onChange={(event) => {
                                    const parsed =
                                      billingConfirmSchema.shape.profile.shape.businessStatus.safeParse(
                                        event.target.value,
                                      );
                                    if (parsed.success) {
                                      setAccepted(false);
                                      setProfile({
                                        ...profile,
                                        businessStatus: parsed.data,
                                      });
                                    }
                                  }}
                                >
                                  <option value="">Choose account type</option>
                                  <option value="business">A business</option>
                                  <option value="individual">Myself</option>
                                </NativeSelect>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor="billing-gstin">
                                  GSTIN, optional
                                </FieldLabel>
                                <Input
                                  id="billing-gstin"
                                  placeholder="15-character GSTIN"
                                  value={gstin}
                                  maxLength={15}
                                  autoCapitalize="characters"
                                  onChange={(event) => {
                                    setAccepted(false);
                                    setGstin(event.target.value.toUpperCase());
                                  }}
                                />
                              </Field>
                            </FieldGroup>
                          ),
                        },
                        {
                          id: "review",
                          label: "Review and save",
                          description:
                            "These details apply to future checkout. Existing invoices keep the details recorded when they were issued.",
                          content: (
                            <FieldGroup>
                              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                                <div>
                                  <dt className="text-muted-foreground">
                                    Legal name
                                  </dt>
                                  <dd>{profile.legalName}</dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    Billing address
                                  </dt>
                                  <dd>
                                    {[
                                      profile.address.line1,
                                      profile.address.line2,
                                      profile.address.city,
                                      profile.address.region,
                                      profile.address.postalCode,
                                      "India",
                                    ]
                                      .filter(Boolean)
                                      .join(", ")}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    Invoice contact
                                  </dt>
                                  <dd>
                                    {profile.invoiceContact.name}
                                    <br />
                                    {profile.invoiceContact.email}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-muted-foreground">
                                    GSTIN
                                  </dt>
                                  <dd>{gstin || "Not provided"}</dd>
                                </div>
                              </dl>
                              <Field orientation="horizontal">
                                <Checkbox
                                  id="billing-confirm"
                                  checked={accepted}
                                  onCheckedChange={(value) =>
                                    setAccepted(value === true)
                                  }
                                  required
                                />
                                <FieldLabel
                                  htmlFor="billing-confirm"
                                  className="text-sm leading-6"
                                >
                                  These details are accurate. This is not an SEZ
                                  purchase or a claim for special GST treatment.
                                  I accept the{" "}
                                  <Link
                                    href="/terms"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                  >
                                    terms
                                  </Link>
                                  .
                                </FieldLabel>
                              </Field>
                              <p className="text-sm text-muted-foreground">
                                For special GST treatment or a billing issue,{" "}
                                <Link
                                  href={advanced}
                                  className="text-primary underline"
                                >
                                  request a billing review
                                </Link>
                                .
                              </p>
                              <Button
                                type="submit"
                                disabled={busy || !accepted}
                              >
                                {busy
                                  ? "Saving details..."
                                  : "Save billing details"}
                              </Button>
                            </FieldGroup>
                          ),
                        },
                      ]}
                    />
                  </form>
                </CardContent>
              </Card>
            ),
          },
          {
            id: "history",
            label: "Change history",
            description:
              "Review the billing details and decisions saved for this business.",
            content: <BillingHistory state={state} />,
          },
        ]}
      />
    </div>
  );
}
