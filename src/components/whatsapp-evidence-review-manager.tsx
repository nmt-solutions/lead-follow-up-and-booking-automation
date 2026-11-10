"use client";
import { Field, FieldGroup } from "./ui/field";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  metaEvidenceReviewSchema,
  whatsAppViewSchema,
  type WhatsAppView,
} from "@/models/whatsapp";
import { WhatsAppEvidenceStatus } from "./whatsapp-evidence-status";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
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

export function WhatsAppEvidenceReviewManager({
  businessId,
  initial,
}: {
  businessId: string;
  initial: WhatsAppView;
}) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
    recovery?: "security" | "sign-in";
  } | null>(null);
  const [reason, setReason] = useState("evidence_incorrect");
  const base = `/api/platform/whatsapp/${businessId}`;
  async function request(
    action?: "approveEvidence" | "revokeEvidence",
    input?: unknown,
  ) {
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(
        base,
        action
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action, input }),
            }
          : { cache: "no-store" },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const result = z.object({ code: z.string() }).safeParse(raw);
        const code = result.success ? result.data.code : "";
        setFeedback({
          error: true,
          text:
            code === "MFA_REQUIRED"
              ? "Verify your authenticator in Security, then retry. Your form is preserved."
              : code === "UNAUTHENTICATED"
                ? "Sign in in a new tab, then retry. Your form is preserved."
                : code === "FORBIDDEN"
                  ? "A separately provisioned WhatsApp reviewer outside this customer Business is required. Ask the operator administrator to check your grant."
                  : code === "CONFLICT"
                    ? "The account or review history changed. Reload the account, verify its exact assets and enter a new review."
                    : code === "CHANNEL_SETUP_REQUIRED"
                      ? "The customer must obtain a current successful Meta ownership, permission and number check before review."
                      : "Review could not be recorded. Check the evidence identifiers, digests, observation dates and expiry, then retry.",
          ...(code === "MFA_REQUIRED"
            ? { recovery: "security" as const }
            : code === "UNAUTHENTICATED"
              ? { recovery: "sign-in" as const }
              : {}),
        });
        return;
      }
      setState(z.object({ data: whatsAppViewSchema }).parse(raw).data);
      setFeedback({
        error: false,
        text:
          action === "approveEvidence"
            ? "Evidence review recorded. The customer can reload saved status to see the result. Independent provider and automation checks still apply."
            : action === "revokeEvidence"
              ? "Review revoked. Its history is retained and it cannot establish readiness."
              : "Account reloaded. If the selected connection changed, the pending review form was cleared; verify the displayed assets again.",
      });
    } catch {
      setFeedback({
        error: true,
        text: "The result could not be confirmed. Reload the account before retrying to avoid a duplicate review.",
      });
    } finally {
      setPending(false);
    }
  }
  const c = state.connection;
  const latest = state.paymentEvidence.history.filter((e) => e.review).at(-1);
  const revoked =
    latest &&
    state.paymentEvidence.history.some(
      (e) => e.revocation?.reviewId === latest.id,
    );
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!c?.assets || !c.providerKey) return;
    const fields = new FormData(event.currentTarget);
    const date = (name: string) => {
      const value = new Date(String(fields.get(name)));
      return Number.isNaN(value.getTime()) ? "" : value.toISOString();
    };
    const evidence = (name: string) => ({
      reference: fields.get(`${name}Reference`),
      sha256: fields.get(`${name}Sha256`),
      observedAt: date(`${name}ObservedAt`),
    });
    const input = metaEvidenceReviewSchema.safeParse({
      expectedVersion: c.version,
      expectedEvidenceVersion: state.paymentEvidence.version,
      connectionId: c.id,
      assets: c.assets,
      providerKey: c.providerKey,
      requestedNumber: c.configuration.requestedNumber,
      controlEvidence: evidence("control"),
      paymentEvidence: evidence("payment"),
      validUntil: date("validUntil"),
      customerControlsAssets: fields.get("customerControlsAssets") === "on",
      customerPaysMetaDirectly: fields.get("customerPaysMetaDirectly") === "on",
      noPlatformCreditLine: fields.get("noPlatformCreditLine") === "on",
    });
    if (!input.success) {
      setFeedback({
        error: true,
        text: "Complete both evidence case IDs, 64-character SHA-256 digests, observation dates, expiry and all three review confirmations.",
      });
      return;
    }
    await request("approveEvidence", input.data);
  }
  const canReview =
    c?.status === "connected" &&
    c.assets &&
    c.providerKey &&
    c.observation?.checks.customer_ownership === "confirmed" &&
    c.observation.checks.permissions === "confirmed" &&
    c.observation.checks.number_verified === "confirmed";
  return (
    <div className="flex flex-col gap-8" aria-busy={pending}>
      <Card>
        <CardHeader>
          <CardTitle>Selected customer account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="wrap-anywhere">Business {businessId}</p>
          {c ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {[
                ["Connection", c.id],
                ["Connection version", String(c.version)],
                [
                  "Control terms saved",
                  new Date(c.termsAcceptedAt).toLocaleString(),
                ],
                ["Customer number", c.configuration.requestedNumber],
                [
                  "Customer portfolio",
                  c.assets?.portfolioId ?? c.configuration.portfolioId,
                ],
                ["WhatsApp account", c.assets?.wabaId ?? "Not selected"],
                ["Number ID", c.assets?.phoneNumberId ?? "Not selected"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium wrap-anywhere">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>
              The customer must save an arrangement and complete Meta sign-in
              first.
            </p>
          )}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void request()}
          >
            Reload account and reviews
          </Button>
          <WhatsAppEvidenceStatus evidence={state.paymentEvidence} />
        </CardContent>
      </Card>
      {feedback && (
        <div className="flex flex-col gap-2">
          <Alert
            variant={feedback.error ? "destructive" : "default"}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.text}
          </Alert>
          {feedback.recovery && (
            <Link
              href={feedback.recovery === "security" ? "/security" : "/sign-in"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            >
              {feedback.recovery === "security" ? "Open Security" : "Sign in"}{" "}
              in a new tab
            </Link>
          )}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Record an assisted evidence review</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p>
            Inspect redacted, account-specific records showing customer control
            of this portfolio, WhatsApp account and number, and Meta payment
            settings showing the customer pays Meta directly. Match every
            identifier above before approving.
          </p>
          <p className="text-sm text-muted-foreground">
            Keep the reviewed documents in the agreed access-controlled case
            archive. Enter its case IDs and the SHA-256 digests of those exact
            redacted records. Case IDs use an uppercase prefix and hyphen, for
            example META-CONTROL-2026-001. This form stores references only;
            never enter card details, credentials, OTPs or document contents.
            Observation dates must be after the current control terms were
            saved; choose an explicit expiry appropriate to the reviewed
            evidence.
          </p>
          {!canReview ? (
            <p className="rounded-lg bg-muted p-4 text-sm">
              A connected, customer-owned account and verified number are
              required. Ask the customer to complete sign-in and check the
              connection before this review.
            </p>
          ) : (
            <form
              key={`${c.id}:${c.version}:${c.providerKey}:${state.paymentEvidence.version}`}
              onSubmit={approve}
              className="flex flex-col gap-6"
            >
              <FieldGroup className="gap-6">
                {[
                  { name: "control", title: "Customer control evidence" },
                  { name: "payment", title: "Direct Meta payment evidence" },
                ].map(({ name, title }) => (
                  <fieldset
                    key={name}
                    disabled={pending}
                    className="flex flex-col gap-4 rounded-xl border border-border p-4"
                  >
                    <legend className="px-1 font-medium">{title}</legend>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor={`${name}Reference`}>
                        Secure case reference
                      </Label>
                      <Input
                        id={`${name}Reference`}
                        name={`${name}Reference`}
                        required
                        pattern="[A-Z][A-Z0-9]{1,15}(-[A-Z0-9]+)+"
                        maxLength={81}
                        autoComplete="off"
                      />
                    </Field>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor={`${name}Sha256`}>
                        Redacted record SHA-256 digest
                      </Label>
                      <Input
                        id={`${name}Sha256`}
                        name={`${name}Sha256`}
                        required
                        pattern="[a-f0-9]{64}"
                        minLength={64}
                        maxLength={64}
                        autoComplete="off"
                        className="font-mono"
                      />
                    </Field>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor={`${name}ObservedAt`}>
                        Evidence observed at (your local time)
                      </Label>
                      <Input
                        id={`${name}ObservedAt`}
                        name={`${name}ObservedAt`}
                        type="datetime-local"
                        required
                      />
                    </Field>
                  </fieldset>
                ))}
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="validUntil">
                    Review expires at (your local time)
                  </Label>
                  <Input
                    id="validUntil"
                    name="validUntil"
                    type="datetime-local"
                    required
                    disabled={pending}
                  />
                </Field>
                <fieldset disabled={pending} className="flex flex-col gap-3">
                  <legend className="mb-2 font-medium">
                    I verified in the referenced evidence
                  </legend>
                  {[
                    [
                      "customerControlsAssets",
                      "The customer controls this exact portfolio, WhatsApp account and number.",
                    ],
                    [
                      "customerPaysMetaDirectly",
                      "The customer's own payment arrangement pays Meta directly for this account.",
                    ],
                    [
                      "noPlatformCreditLine",
                      "No platform credit line or paid BSP is attached as the payer.",
                    ],
                  ].map(([name, text]) => (
                    <Label
                      key={name}
                      htmlFor={name}
                      className="flex min-h-11 items-start gap-3 py-2 leading-relaxed"
                    >
                      <Checkbox
                        id={name}
                        name={name}
                        required
                        className="mt-1"
                      />
                      {text}
                    </Label>
                  ))}
                </fieldset>
                <Button disabled={pending} type="submit">
                  {pending ? "Recording review…" : "Record evidence review"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
      {c && latest && !revoked && (
        <Card>
          <CardHeader>
            <CardTitle>Revoke the latest review</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              Revocation immediately removes this review&apos;s effective proof.
              The original record and revocation remain in history. A new review
              is required to restore proof.
            </p>
            <Field className="flex flex-col gap-2">
              <Label htmlFor="revoke-reason">Revocation reason</Label>
              <NativeSelect
                id="revoke-reason"
                value={reason}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="evidence_incorrect">Evidence incorrect</option>
                <option value="payment_changed">Payment changed</option>
                <option value="control_changed">
                  Customer control changed
                </option>
                <option value="customer_request">
                  Customer requested revocation
                </option>
              </NativeSelect>
            </Field>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={pending}
                >
                  Revoke review
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Revoke this evidence review?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The review will stop establishing customer control and direct
                  payment. Its history is retained and readiness will be checked
                  again.
                </AlertDialogDescription>
                <div className="flex flex-wrap gap-3">
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void request("revokeEvidence", {
                        expectedVersion: c.version,
                        expectedEvidenceVersion: state.paymentEvidence.version,
                        reviewId: latest.id,
                        reason,
                      })
                    }
                  >
                    Revoke review
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
