"use client";
import { WorkspaceTabs } from "./workspace-tabs";
import { Field as UiField, FieldGroup } from "./ui/field";

import Link from "next/link";
import { useRef, useState } from "react";
import { z } from "zod";
import {
  billingProfileSchema,
  billingSaveSchema,
  billingReviewInputSchema,
  billingWorkspaceSchema,
  type BillingProfile,
  type BillingWorkspace,
} from "@/models/billing";
import type { BusinessProfile } from "@/models/business";
import { countryCode } from "@/lib/countries";
import { CountryPicker } from "./country-picker";

import type { FileListing } from "@/models/files";
import { FileManager } from "./file-manager";
import {
  BillingStatus,
  BillingHistory,
  BillingProfileSummary,
  evidenceKinds,
} from "./billing-summary";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Button } from "./ui/button";
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

const empty: BillingProfile = {
  legalName: "",
  registrationNumber: "",
  address: {
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
  },
  invoiceContact: { name: "", email: "" },
  businessStatus: "unknown",
  taxIdentifierStatus: "unknown",
  taxIdentifiers: [],
  evidence: [],
};
const responseSchema = z.object({
  success: z.literal(true),
  data: billingWorkspaceSchema,
});
function Field({
  label,
  id,
  value,
  onChange,
  autoComplete,
  type = "text",
  maxLength = 300,
}: {
  label: string;
  id: string;
  value: string;
  onChange(value: string): void;
  autoComplete?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <UiField className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </UiField>
  );
}
export function BillingManager({
  businessId,
  initial,
  initialFiles,
  operator = false,
  businessProfile,
}: {
  businessId: string;
  initial: BillingWorkspace;
  initialFiles: FileListing;
  operator?: boolean;
  businessProfile?: Pick<BusinessProfile, "name" | "configuration">;
}) {
  const [state, setState] = useState(initial);
  const businessAddress = businessProfile?.configuration?.address;
  const addressFromSetup = businessAddress
    ? {
        line1: businessAddress.street.slice(0, 300),
        line2: businessAddress.street.slice(300),
        city: businessAddress.locality,
        region: businessAddress.region,
        postalCode: businessAddress.postalCode,
        country: countryCode(businessAddress.country),
      }
    : null;
  const [profile, setProfile] = useState(
    initial.current?.profile ?? {
      ...empty,
      legalName: businessProfile?.name ?? "",
      address: addressFromSetup ?? empty.address,
    },
  );
  const [files, setFiles] = useState(initialFiles);
  const [note, setNote] = useState("");
  const [findings, setFindings] = useState("");
  const [outcome, setOutcome] = useState<
    "missing" | "conflicting" | "reviewed"
  >("missing");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const base = operator
    ? `/api/platform/billing/${businessId}`
    : `/api/businesses/${businessId}/billing`;
  async function read(response: Response) {
    const json: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ code: z.string() }).safeParse(json);
      const code = failure.success ? failure.data.code : "";
      throw new Error(
        code === "CONFLICT"
          ? "The saved profile or review changed, or evidence is incomplete. Load the saved version, resolve the findings and retry."
          : code === "MFA_REQUIRED"
            ? "Verify in Security, then retry. Your edits remain here."
            : code === "UNAUTHENTICATED"
              ? "Sign in again in another tab, then retry to preserve your edits."
              : code === "FORBIDDEN" || code === "NOT_FOUND"
                ? "Your current access does not allow this action. Ask the Business Owner or service operator."
                : "Unable to save. Check the fields and attached document availability, then retry.",
      );
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success)
      throw new Error(
        "Unable to confirm this change. Load the saved version before retrying.",
      );
    return parsed.data.data;
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
        error instanceof Error
          ? error.message
          : "Unable to confirm the change. Load the saved version before retrying.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    const { declaration: priorDeclaration, ...editableProfile } = profile;
    void priorDeclaration;
    const input = operator
      ? billingReviewInputSchema.safeParse({
          expectedVersion: state.version,
          expectedReviewVersion: state.reviewVersion,
          outcome,
          findings: findings
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          note,
        })
      : billingSaveSchema.safeParse({
          expectedVersion: state.version,
          profile: editableProfile,
          note,
        });
    if (!input.success) {
      setError(
        operator
          ? "Enter a reason and findings for unresolved evidence. A completed review must have no unresolved findings."
          : "Check the tax identifier rows, evidence selections and reason. Empty profile fields may be saved for review.",
      );
      return;
    }
    const saved = await read(
      await fetch(base, {
        method: operator ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.data),
      }),
    );
    setState(saved);
    setNote("");
    setFindings("");
    if (!operator && saved.current) setProfile(saved.current.profile);
    setMessage(
      operator
        ? "Review recorded for this exact profile revision."
        : "Billing revision saved. Missing or conflicting information is routed to the tax-review queue.",
    );
  }
  async function reload() {
    const saved = await read(await fetch(base, { cache: "no-store" }));
    setState(saved);
    setProfile(saved.current?.profile ?? empty);
    setNote("");
    setFindings("");
    setMessage("Saved profile and review history loaded.");
  }
  async function filesChanged(listing: FileListing) {
    setFiles(listing);
    try {
      const saved = await read(await fetch(base, { cache: "no-store" }));
      if (
        saved.version === state.version &&
        saved.reviewVersion === state.reviewVersion
      )
        setState(saved);
      else
        setError(
          "A newer profile or review is available. Load the saved version before making another change.",
        );
    } catch {
      /* The selected form and files remain available after session expiry. */
    }
  }
  const available = files.files.filter(
    (file) => file.purpose === "billing" && file.accessAvailable,
  );
  return (
    <div className="flex flex-col gap-8" aria-busy={busy}>
      <BillingStatus state={state} />
      {error && (
        <Alert variant="destructive">
          {error}{" "}
          <Link
            href="/security"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4"
          >
            Open Security
          </Link>{" "}
          or{" "}
          <Link
            href="/sign-in"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4"
          >
            sign in
          </Link>{" "}
          in another tab.
        </Alert>
      )}
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        {message}
      </p>
      <WorkspaceTabs
        label="Billing sections"
        tabs={[
          {
            id: "details",
            label: "Billing details",
            description:
              "Check the legal name, saved address, invoice contact and tax details before saving.",
            content: (
              <>
                <form
                  className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(save);
                  }}
                >
                  <FieldGroup className="gap-6">
                    <h2 className="text-xl font-semibold">
                      {operator
                        ? "Review this billing revision"
                        : "Legal billing details"}
                    </h2>
                    {operator && state.current && (
                      <BillingProfileSummary
                        profile={state.current.profile}
                        evidence={state.current.evidence}
                      />
                    )}
                    <fieldset disabled={busy} className="flex flex-col gap-6">
                      {!operator && (
                        <>
                          <p className="text-sm text-muted-foreground">
                            Save the details you have. Missing fields stay
                            visible for review. Upload billing documents above,
                            then attach them to the claims they support.
                          </p>
                          {addressFromSetup && (
                            <div className="rounded-xl bg-muted p-4 text-sm">
                              <p className="text-muted-foreground">
                                {initial.current
                                  ? "Use your saved business address if it is also your billing address."
                                  : "Filled from your business setup. Check the legal name and billing address before saving."}
                              </p>
                              {initial.current && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="mt-3"
                                  onClick={() =>
                                    setProfile({
                                      ...profile,
                                      address: addressFromSetup,
                                    })
                                  }
                                >
                                  Use business address
                                </Button>
                              )}
                            </div>
                          )}
                          <div className="grid gap-5 sm:grid-cols-2">
                            <Field
                              label="Legal name"
                              id="legal-name"
                              value={profile.legalName}
                              autoComplete="organization"
                              onChange={(legalName) =>
                                setProfile({ ...profile, legalName })
                              }
                            />
                            <Field
                              label="Business registration number (if applicable)"
                              id="registration"
                              value={profile.registrationNumber}
                              onChange={(registrationNumber) =>
                                setProfile({ ...profile, registrationNumber })
                              }
                            />
                            {(
                              [
                                ["line1", "Address line 1", "address-line1"],
                                ["line2", "Address line 2", "address-line2"],
                                ["city", "City", "address-level2"],
                                [
                                  "region",
                                  "State, province or region",
                                  "address-level1",
                                ],
                                ["postalCode", "Postal code", "postal-code"],
                              ] as const
                            ).map(([key, label, autoComplete]) => (
                              <Field
                                key={key}
                                label={label}
                                id={`billing-${key}`}
                                autoComplete={autoComplete}
                                maxLength={300}
                                value={profile.address[key]}
                                onChange={(value) =>
                                  setProfile({
                                    ...profile,
                                    address: {
                                      ...profile.address,
                                      [key]: value,
                                    },
                                  })
                                }
                              />
                            ))}
                            <UiField className="flex flex-col gap-2">
                              <Label htmlFor="billing-country">
                                Billing country
                              </Label>
                              <CountryPicker
                                id="billing-country"
                                format="code"
                                allowEmpty
                                value={profile.address.country}
                                onChange={(country) =>
                                  setProfile({
                                    ...profile,
                                    address: { ...profile.address, country },
                                  })
                                }
                              />
                            </UiField>
                            <Field
                              label="Invoice contact name"
                              id="invoice-name"
                              autoComplete="section-invoice name"
                              value={profile.invoiceContact.name}
                              onChange={(name) =>
                                setProfile({
                                  ...profile,
                                  invoiceContact: {
                                    ...profile.invoiceContact,
                                    name,
                                  },
                                })
                              }
                            />
                            <Field
                              label="Invoice email"
                              id="invoice-email"
                              type="email"
                              autoComplete="section-invoice email"
                              maxLength={254}
                              value={profile.invoiceContact.email}
                              onChange={(email) =>
                                setProfile({
                                  ...profile,
                                  invoiceContact: {
                                    ...profile.invoiceContact,
                                    email,
                                  },
                                })
                              }
                            />
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Use IN for India or the billing country’s two-letter
                            code, such as US. Leave it blank if unknown.
                          </p>
                          <div className="grid gap-5 sm:grid-cols-2">
                            <UiField className="flex flex-col gap-2">
                              <Label htmlFor="business-status">
                                Purchasing status
                              </Label>
                              <NativeSelect
                                id="business-status"
                                value={profile.businessStatus}
                                onChange={(event) => {
                                  const parsed =
                                    billingProfileSchema.shape.businessStatus.safeParse(
                                      event.target.value,
                                    );
                                  if (parsed.success)
                                    setProfile({
                                      ...profile,
                                      businessStatus: parsed.data,
                                    });
                                }}
                              >
                                <option value="unknown">Unknown</option>
                                <option value="business">Business use</option>
                                <option value="individual">
                                  Individual use
                                </option>
                              </NativeSelect>
                            </UiField>
                            <UiField className="flex flex-col gap-2">
                              <Label htmlFor="identifier-status">
                                Tax identifier applicability
                              </Label>
                              <NativeSelect
                                id="identifier-status"
                                value={profile.taxIdentifierStatus}
                                onChange={(event) => {
                                  const parsed =
                                    billingProfileSchema.shape.taxIdentifierStatus.safeParse(
                                      event.target.value,
                                    );
                                  if (parsed.success)
                                    setProfile({
                                      ...profile,
                                      taxIdentifierStatus: parsed.data,
                                    });
                                }}
                              >
                                <option value="unknown">
                                  Unknown; needs review
                                </option>
                                <option value="provided">
                                  Identifiers supplied below
                                </option>
                                <option value="not_applicable">
                                  Customer states not applicable
                                </option>
                              </NativeSelect>
                            </UiField>
                          </div>
                          <section
                            className="flex flex-col gap-4"
                            aria-labelledby="tax-identifiers"
                          >
                            <h3 id="tax-identifiers" className="font-semibold">
                              Tax identifiers
                            </h3>
                            {profile.taxIdentifiers.map((entry, index) => (
                              <div
                                key={index}
                                className="flex flex-col gap-4 rounded-xl border border-border p-4"
                              >
                                {(
                                  [
                                    [
                                      "kind",
                                      "Identifier type (for example GSTIN or VAT)",
                                    ],
                                    [
                                      "country",
                                      "Issuing country (two-letter code)",
                                    ],
                                    ["value", "Identifier value"],
                                  ] as const
                                ).map(([key, label]) => (
                                  <Field
                                    key={key}
                                    label={label}
                                    id={`identifier-${index}-${key}`}
                                    value={entry[key]}
                                    maxLength={key === "country" ? 2 : 300}
                                    onChange={(value) =>
                                      setProfile({
                                        ...profile,
                                        taxIdentifiers:
                                          profile.taxIdentifiers.map(
                                            (item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    [key]:
                                                      key === "country"
                                                        ? value.toUpperCase()
                                                        : value,
                                                  }
                                                : item,
                                          ),
                                      })
                                    }
                                  />
                                ))}
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    setProfile({
                                      ...profile,
                                      taxIdentifiers:
                                        profile.taxIdentifiers.filter(
                                          (_, i) => i !== index,
                                        ),
                                    })
                                  }
                                >
                                  Remove identifier {index + 1}
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              disabled={profile.taxIdentifiers.length >= 20}
                              onClick={() =>
                                setProfile({
                                  ...profile,
                                  taxIdentifiers: [
                                    ...profile.taxIdentifiers,
                                    { kind: "", country: "", value: "" },
                                  ],
                                })
                              }
                            >
                              Add tax identifier
                            </Button>
                          </section>
                          <section
                            className="flex flex-col gap-4"
                            aria-labelledby="billing-evidence"
                          >
                            <h3 id="billing-evidence" className="font-semibold">
                              Supporting documents for this update
                            </h3>
                            {profile.evidence.map((entry, index) => (
                              <UiField
                                key={index}
                                className="flex flex-col gap-4 rounded-xl border border-border p-4"
                              >
                                <Label htmlFor={`evidence-${index}-kind`}>
                                  Claim supported
                                </Label>
                                <NativeSelect
                                  id={`evidence-${index}-kind`}
                                  value={entry.kind}
                                  onChange={(event) => {
                                    const parsed =
                                      billingProfileSchema.shape.evidence.element.shape.kind.safeParse(
                                        event.target.value,
                                      );
                                    if (parsed.success)
                                      setProfile({
                                        ...profile,
                                        evidence: profile.evidence.map(
                                          (item, i) =>
                                            i === index
                                              ? { ...item, kind: parsed.data }
                                              : item,
                                        ),
                                      });
                                  }}
                                >
                                  {Object.entries(evidenceKinds).map(
                                    ([key, label]) => (
                                      <option key={key} value={key}>
                                        {label}
                                      </option>
                                    ),
                                  )}
                                </NativeSelect>
                                <Label htmlFor={`evidence-${index}-file`}>
                                  Private billing document
                                </Label>
                                <NativeSelect
                                  id={`evidence-${index}-file`}
                                  value={entry.fileId}
                                  onChange={(event) =>
                                    setProfile({
                                      ...profile,
                                      evidence: profile.evidence.map(
                                        (item, i) =>
                                          i === index
                                            ? {
                                                ...item,
                                                fileId: event.target.value,
                                              }
                                            : item,
                                      ),
                                    })
                                  }
                                >
                                  <option value="">
                                    Choose a completed document
                                  </option>
                                  {!available.some(
                                    (file) => file.id === entry.fileId,
                                  ) &&
                                    entry.fileId && (
                                      <option value={entry.fileId}>
                                        Previously attached document;
                                        unavailable
                                      </option>
                                    )}
                                  {available.map((file) => (
                                    <option key={file.id} value={file.id}>
                                      {file.name}
                                    </option>
                                  ))}
                                </NativeSelect>
                                <Field
                                  label="What this document supports"
                                  id={`evidence-${index}-note`}
                                  value={entry.note}
                                  maxLength={1000}
                                  onChange={(note) =>
                                    setProfile({
                                      ...profile,
                                      evidence: profile.evidence.map(
                                        (item, i) =>
                                          i === index
                                            ? { ...item, note }
                                            : item,
                                      ),
                                    })
                                  }
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    setProfile({
                                      ...profile,
                                      evidence: profile.evidence.filter(
                                        (_, i) => i !== index,
                                      ),
                                    })
                                  }
                                >
                                  Remove evidence {index + 1} from this revision
                                </Button>
                              </UiField>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              disabled={profile.evidence.length >= 40}
                              onClick={() =>
                                setProfile({
                                  ...profile,
                                  evidence: [
                                    ...profile.evidence,
                                    {
                                      kind: "legal_identity",
                                      fileId: "",
                                      note: "",
                                    },
                                  ],
                                })
                              }
                            >
                              Attach supporting evidence
                            </Button>
                          </section>
                        </>
                      )}
                      {operator && (
                        <>
                          <UiField className="flex flex-col gap-2">
                            <Label htmlFor="review-outcome">
                              Evidence review outcome
                            </Label>
                            <NativeSelect
                              id="review-outcome"
                              value={outcome}
                              onChange={(event) => {
                                const parsed =
                                  billingReviewInputSchema.shape.outcome.safeParse(
                                    event.target.value,
                                  );
                                if (parsed.success) setOutcome(parsed.data);
                              }}
                            >
                              <option value="missing">Missing evidence</option>
                              <option value="conflicting">
                                Conflicting evidence
                              </option>
                              <option value="reviewed">
                                Evidence reviewed; no unresolved findings
                              </option>
                            </NativeSelect>
                          </UiField>
                          <UiField className="flex flex-col gap-2">
                            <Label htmlFor="review-findings">
                              Unresolved findings (one per line)
                            </Label>
                            <Textarea
                              id="review-findings"
                              value={findings}
                              maxLength={40000}
                              onChange={(event) =>
                                setFindings(event.target.value)
                              }
                            />
                            <p className="text-sm text-muted-foreground">
                              Record what the Business must resolve. Leave empty
                              only for a completed evidence review.
                            </p>
                          </UiField>
                        </>
                      )}
                      <UiField className="flex flex-col gap-2">
                        <Label htmlFor="billing-note">
                          {operator
                            ? "Review reason and evidence basis"
                            : "Reason for this revision"}
                        </Label>
                        <Textarea
                          id="billing-note"
                          required
                          maxLength={1000}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="For example, updated registered billing address"
                        />
                      </UiField>
                      <Button type="submit">
                        {busy
                          ? "Saving…"
                          : operator
                            ? "Record evidence review"
                            : "Save billing revision"}
                      </Button>
                    </fieldset>
                  </FieldGroup>
                </form>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={busy}>
                      Load saved version…
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>
                      Load the saved billing version?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Unsaved form edits and review notes will be discarded.
                      Uploaded documents and saved history remain available.
                    </AlertDialogDescription>
                    <div className="flex flex-wrap justify-end gap-3">
                      <AlertDialogCancel>Keep editing</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void act(reload)}>
                        Load saved version
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ),
          },
          {
            id: "documents",
            label: "Supporting documents",
            description:
              "Upload supporting evidence only when it is needed for your billing review.",
            content: (
              <>
                <FileManager
                  businessId={businessId}
                  initial={initialFiles}
                  purpose="billing"
                  apiBase={
                    operator
                      ? `/api/platform/billing/${businessId}/files`
                      : undefined
                  }
                  onListingChange={(listing) => void filesChanged(listing)}
                />
              </>
            ),
          },
          {
            id: "history",
            label: "Change history",
            description:
              "Review previous billing details and their review status.",
            content: (
              <>
                <BillingHistory state={state} />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
