"use client";
import { WorkspaceTabs } from "./workspace-tabs";
import { FieldGroup } from "./ui/field";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { countries } from "@/lib/countries";
import { z } from "zod";
import {
  addEmailSuppressionSchema,
  contentRequirements,
  emailContentReviewSchema,
  emailEligibilityWorkspaceSchema,
  emailPurposes,
  evidenceKinds,
  publishEmailPolicySchema,
  recipientClasses,
  saveRecipientFactsSchema,
  suppressionScopes,
  sameEmailAction,
  type EmailEligibilityWorkspace,
} from "@/models/email-eligibility";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";

const permissionLabels: Record<string, string> = {
  corporate: "Registered company",
  individual: "Individual",
  sole_trader: "Sole proprietor",
  partnership: "Partnership",
  unknown: "Not known",
  inquiry_response: "Reply to an inquiry",
  sales_outreach: "First sales email",
  sales_follow_up: "Sales follow-up",
  documented_relationship: "Existing business relationship",
  consent: "Consent",
  direct_inquiry: "They contacted you",
  recipient_outreach: "Stop sales outreach to this contact",
  opportunity_outreach: "Stop outreach about this opportunity",
  recipient_email: "Stop all email to this contact",
  postal_address: "Postal address included",
  advertising_disclosure: "Advertising clearly identified",
  unsubscribe_instructions: "Instructions to stop email",
  one_click_unsubscribe: "One-click unsubscribe",
  purpose_review: "Message purpose reviewed",
};
const label = (s: string) => permissionLabels[s] ?? s.replaceAll("_", " ");
const fieldNames: Record<string, string> = {
  recipient: "Recipient email",
  market: "Contact's country",
  recipientClass: "Recipient type",
  reference: "Where the permission is recorded",
  effectiveAt: "Effective time",
  validUntil: "Valid until",
  acceptedEvidence: "Accepted permission evidence",
  requiredContent: "Required content review",
  purpose: "Message purpose",
  policyId: "Reviewed policy revision",
  observedAt: "Permission observed time",
  opportunityId: "Covered Opportunity",
  sources: "Primary guidance URLs",
  rationale: "Reviewed rules",
  permissions: "Permission evidence",
  scope: "Suppression scope",
  requirements: "Verified content requirements",
};
const text = (f: FormData, key: string) => String(f.get(key) ?? "");
const date = (f: FormData, key: string) => new Date(text(f, key)).toISOString();
function localDate(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function Field({
  name,
  title,
  children,
}: {
  name: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{title}</Label>
      {children}
    </div>
  );
}
function Checks({
  name,
  values,
  selected = [],
}: {
  name: string;
  values: readonly string[];
  selected?: readonly string[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {values.map((v) => (
        <label key={v} className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name={name}
            value={v}
            defaultChecked={selected.includes(v)}
            className="size-5 accent-primary"
          />
          {label(v)}
        </label>
      ))}
    </div>
  );
}

export function EmailEligibilityManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: EmailEligibilityWorkspace;
}) {
  const [state, setState] = useState(initialState),
    [pending, setPending] = useState(false),
    [feedback, setFeedback] = useState({
      scope: "",
      error: false,
      message: "",
      recovery: "",
    });
  const [recipient, setRecipient] = useState(""),
    [policyId, setPolicyId] = useState("");
  const [suppressionRequestKey, setSuppressionRequestKey] = useState(() =>
    crypto.randomUUID(),
  );
  const current = state.recipients.find((r) => r.facts.recipient === recipient),
    selectedPolicy = state.policies.find((r) => r.id === policyId);
  const recipientOptions = [
    ...new Set([
      ...state.actions.map((a) => a.recipient),
      ...state.recipients.map((r) => r.facts.recipient),
    ]),
  ];
  const opportunities = [
    ...new Set(
      state.actions
        .map((a) => a.opportunityId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const base = `/api/businesses/${businessId}/email-eligibility`;
  async function command(scope: string, commandName?: string, input?: unknown) {
    if (pending) return;
    setPending(true);
    setFeedback({ scope, error: false, message: "", recovery: "" });
    try {
      const response = await fetch(
        base,
        commandName
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: commandName, input }),
            }
          : { cache: "no-store" },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const p = z.object({ code: z.string() }).safeParse(raw),
          code = p.success ? p.data.code : "";
        setFeedback({
          scope,
          error: true,
          recovery:
            code === "MFA_REQUIRED"
              ? "/security"
              : code === "UNAUTHENTICATED"
                ? "/sign-in"
                : "",
          message:
            code === "CONFLICT"
              ? "The evidence or action changed. Refresh status, review the current version and retry."
              : code === "MFA_REQUIRED"
                ? "Verify your authenticator in Security, then retry. Your form is preserved."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again, then retry. Your form is preserved."
                  : code === "FORBIDDEN"
                    ? "Your current role cannot make this change. Policy publication requires a separately authorized platform operator."
                    : "Could not complete this request. Check the evidence, Business scope and selected action, then retry.",
        });
        return;
      }
      const envelope = z
        .object({
          success: z.literal(true),
          data: emailEligibilityWorkspaceSchema,
        })
        .safeParse(raw);
      if (!envelope.success) throw new Error("invalid_response");
      setState(envelope.data.data);
      if (!commandName || commandName === "suppression")
        setSuppressionRequestKey(crypto.randomUUID());
      setFeedback({
        scope,
        error: false,
        message: commandName
          ? "Saved. Eligibility is checked again immediately before dispatch."
          : "Current status refreshed.",
        recovery: "",
      });
    } catch {
      setFeedback({
        scope,
        error: true,
        message:
          "The request could not be verified. Refresh status before retrying; records may already be saved.",
        recovery: "",
      });
    } finally {
      setPending(false);
    }
  }
  function submit<T>(
    e: FormEvent<HTMLFormElement>,
    scope: string,
    commandName: string,
    schema: z.ZodType<T>,
    input: (f: FormData) => unknown,
  ) {
    e.preventDefault();
    try {
      const p = schema.safeParse(input(new FormData(e.currentTarget)));
      if (!p.success) {
        setFeedback({
          scope,
          error: true,
          message: p.error.issues
            .map((issue) => {
              const field = issue.path
                .map(String)
                .reverse()
                .find((part) => fieldNames[part]);
              return `${field ? `${fieldNames[field]}: ` : ""}${issue.message}`;
            })
            .join(" · "),
          recovery: "",
        });
        return;
      }
      void command(scope, commandName, p.data);
    } catch {
      setFeedback({
        scope,
        error: true,
        message:
          "Enter valid local dates and complete all required evidence fields.",
        recovery: "",
      });
    }
  }
  function feedbackFor(scope: string) {
    return feedback.scope === scope && feedback.message ? (
      <Alert variant={feedback.error ? "destructive" : "success"}>
        {feedback.message}
        {feedback.recovery && (
          <Link
            className="ml-2 underline"
            href={feedback.recovery}
            target="_blank"
            rel="noreferrer"
          >
            Continue to{" "}
            {feedback.recovery === "/security" ? "Security" : "sign in"}
            {" (new tab)"}
          </Link>
        )}
      </Alert>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-6 wrap-anywhere">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void command("refresh")}
        >
          {pending ? "Working…" : "Refresh status"}
        </Button>
        <Link
          className="text-primary underline underline-offset-4"
          href={`/businesses/${businessId}/senders`}
        >
          Review sending identities
        </Link>
      </div>
      {feedbackFor("refresh")}
      <WorkspaceTabs
        label="Contact permissions sections"
        tabs={[
          {
            id: "checks",
            label: "Ready to email?",
            description:
              "Review the contacts and messages that are waiting for an email permission check.",
            content: (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Emails to check</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <p className="text-muted-foreground">
                      Review the exact recipient, purpose and evidence. Allowed
                      is a dated eligibility result; authority, ownership,
                      sender readiness and provider setup still apply at
                      dispatch. Public addresses and paid discovery reach grant
                      no permission.
                    </p>
                    {!state.actions.length && (
                      <p>
                        Prepare an inquiry response or commercial action in the
                        shared inbox, then return here to evaluate it.
                      </p>
                    )}
                    {state.actions.map((a) => {
                      const actionKey =
                        a.action.kind === "campaign"
                          ? `${a.action.id}-${a.action.recipientKey}-${a.action.stepIndex}`
                          : a.action.id;
                      const result = state.evaluations.find((r) =>
                        sameEmailAction(r.action, a.action),
                      );
                      return (
                        <section
                          key={actionKey}
                          className="flex flex-col gap-3 rounded-xl border p-4"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <h2 className="font-semibold">{a.recipient}</h2>
                            <Badge>
                              {result
                                ? result.status.toUpperCase()
                                : "Not evaluated"}
                            </Badge>
                          </div>
                          <p>
                            Purpose: {label(a.purpose)} ·{" "}
                            {a.opportunityId
                              ? `Opportunity ${a.opportunityId}`
                              : "Discovered prospect campaign"}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Action {a.action.id}
                          </p>
                          <details>
                            <summary className="min-h-11 cursor-pointer py-2 font-medium">
                              Review this email
                            </summary>
                            <p className="my-3 whitespace-pre-wrap">
                              {a.description}
                            </p>
                            {state.canManage && (
                              <form
                                className="flex flex-col gap-3"
                                onSubmit={(e) =>
                                  submit(
                                    e,
                                    actionKey,
                                    "review",
                                    emailContentReviewSchema,
                                    (f) => ({
                                      action: a.action,
                                      requirements: f.getAll("requirements"),
                                      reference: text(f, "reference"),
                                    }),
                                  )
                                }
                              >
                                <FieldGroup className="gap-3">
                                  <fieldset
                                    disabled={pending}
                                    className="flex flex-col gap-3"
                                  >
                                    <legend className="mb-2 font-medium">
                                      Record the requirements you verified for
                                      this exact content
                                    </legend>
                                    <Checks
                                      name="requirements"
                                      values={contentRequirements}
                                    />
                                    <Field
                                      name={`review-${actionKey}`}
                                      title="Review evidence or reference"
                                    >
                                      <Textarea
                                        id={`review-${actionKey}`}
                                        name="reference"
                                        required
                                        maxLength={2000}
                                      />
                                    </Field>
                                    <Button variant="outline">
                                      Record content review
                                    </Button>
                                  </fieldset>
                                </FieldGroup>
                              </form>
                            )}
                          </details>
                          <Button
                            disabled={pending}
                            onClick={() =>
                              void command(actionKey, "evaluate", a.action)
                            }
                          >
                            Evaluate eligibility
                          </Button>
                          {feedbackFor(actionKey)}
                          {result && (
                            <div className="flex flex-col gap-3">
                              <p className="text-sm text-muted-foreground">
                                Evaluated {new Date(result.at).toLocaleString()}
                                . A later restriction can stop this action.
                              </p>
                              {result.checks.map((c) => (
                                <div
                                  key={c.code}
                                  className="rounded-lg bg-muted p-3"
                                >
                                  <p className="font-medium">
                                    {label(c.code)}: {c.status.toUpperCase()}
                                  </p>
                                  <p>{c.detail}</p>
                                  {c.status !== "allowed" && (
                                    <p className="mt-2 font-medium">
                                      Next: {c.nextAction}
                                    </p>
                                  )}
                                </div>
                              ))}
                              <details>
                                <summary className="min-h-11 cursor-pointer py-2">
                                  Sources and previous checks
                                </summary>
                                <p>
                                  Policy {result.policyId ?? "missing"};
                                  recipient revision{" "}
                                  {result.recipientRevisionId ?? "missing"};
                                  sender {result.senderIdentityId ?? "missing"}
                                </p>
                                {result.evidence.map((e, i) => (
                                  <p key={i}>
                                    {label(e.kind)} · {e.reference} ·{" "}
                                    {e.observedAt} ·{" "}
                                    {e.actorId ?? "received message"}
                                  </p>
                                ))}
                                <p>
                                  Covered suppression records:{" "}
                                  {result.suppressionIds.join(", ") || "none"}
                                </p>
                              </details>
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </CardContent>
                </Card>
              </>
            ),
          },
          {
            id: "contacts",
            label: "Contact permissions",
            description:
              "Record a contact's location and the reason you may email them. Save evidence only for the purpose it supports.",
            content: (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Contact details and permission</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-muted-foreground">
                      Destination and legal recipient class need evidence
                      independent of buyer category. An inquiry supports its own
                      response only when the configured policy accepts it.
                      Consent and relationship records are limited to their
                      stated purpose and Opportunity.
                    </p>
                    {!state.canManage ? (
                      <p>
                        An Owner or Admin records or withdraws permission
                        evidence. You can inspect history and record an opt-out
                        below.
                      </p>
                    ) : (
                      <>
                        <Field
                          name="select-recipient"
                          title="Choose recipient or add a new record"
                        >
                          <NativeSelect
                            id="select-recipient"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                          >
                            <option value="">New recipient</option>
                            {recipientOptions.map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <form
                          key={current?.id ?? recipient}
                          className="flex flex-col gap-4"
                          onSubmit={(e) =>
                            submit(
                              e,
                              "recipient",
                              "recipient",
                              saveRecipientFactsSchema,
                              (f) => ({
                                expectedVersion: current?.version ?? 0,
                                facts: {
                                  recipient: text(f, "recipient"),
                                  market: text(f, "market") || null,
                                  recipientClass: text(f, "recipientClass"),
                                  reference: text(f, "reference"),
                                  effectiveAt: date(f, "effectiveAt"),
                                  validUntil: date(f, "validUntil"),
                                  permissions: [
                                    ...(f.has("retain")
                                      ? (current?.facts.permissions ?? [])
                                      : []),
                                    ...(f.has("addPermission")
                                      ? [
                                          {
                                            kind: text(f, "kind"),
                                            purpose: text(f, "purpose"),
                                            policyId: text(f, "policyId"),
                                            opportunityId:
                                              text(f, "opportunityId") || null,
                                            ...(text(f, "prospectId")
                                              ? {
                                                  prospectId: text(
                                                    f,
                                                    "prospectId",
                                                  ),
                                                }
                                              : {}),
                                            reference: text(
                                              f,
                                              "permissionReference",
                                            ),
                                            observedAt: date(f, "observedAt"),
                                            validUntil: date(
                                              f,
                                              "permissionUntil",
                                            ),
                                          },
                                        ]
                                      : []),
                                  ],
                                },
                              }),
                            )
                          }
                        >
                          <FieldGroup className="gap-4">
                            <fieldset
                              disabled={pending}
                              className="flex flex-col gap-4"
                            >
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Field
                                  name="recipient-email"
                                  title="Exact recipient email"
                                >
                                  <Input
                                    id="recipient-email"
                                    name="recipient"
                                    type="email"
                                    required
                                    defaultValue={recipient}
                                  />
                                </Field>
                                <Field
                                  name="recipient-market"
                                  title="Evidenced destination country code (or blank if unknown)"
                                >
                                  <NativeSelect
                                    id="recipient-market"
                                    name="market"
                                    defaultValue={current?.facts.market ?? ""}
                                  >
                                    <option value="">Country not known</option>
                                    {countries.map((country) => (
                                      <option
                                        key={country.code}
                                        value={country.code}
                                      >
                                        {country.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                </Field>
                              </div>
                              <Field
                                name="recipient-class"
                                title="Recipient type"
                              >
                                <NativeSelect
                                  id="recipient-class"
                                  name="recipientClass"
                                  defaultValue={
                                    current?.facts.recipientClass ?? "unknown"
                                  }
                                >
                                  {recipientClasses.map((v) => (
                                    <option key={v} value={v}>
                                      {label(v)}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Field>
                              <Field
                                name="recipient-reference"
                                title="Destination and legal class evidence"
                              >
                                <Textarea
                                  id="recipient-reference"
                                  name="reference"
                                  required
                                  maxLength={2000}
                                  defaultValue={current?.facts.reference}
                                />
                              </Field>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Field
                                  name="recipient-effective"
                                  title="Effective time (local)"
                                >
                                  <Input
                                    id="recipient-effective"
                                    type="datetime-local"
                                    name="effectiveAt"
                                    required
                                    defaultValue={localDate(
                                      current?.facts.effectiveAt,
                                    )}
                                  />
                                </Field>
                                <Field
                                  name="recipient-until"
                                  title="Evidence valid until (local)"
                                >
                                  <Input
                                    id="recipient-until"
                                    type="datetime-local"
                                    name="validUntil"
                                    required
                                    defaultValue={localDate(
                                      current?.facts.validUntil,
                                    )}
                                  />
                                </Field>
                              </div>
                              <label className="flex min-h-11 items-center gap-3">
                                <input
                                  type="checkbox"
                                  name="retain"
                                  defaultChecked
                                  className="size-5 accent-primary"
                                />
                                Retain existing permission evidence in the new
                                revision
                              </label>
                              <p className="text-sm text-muted-foreground">
                                Clear this to withdraw prior permission from the
                                new effective time. Historical records remain
                                available.
                              </p>
                              <details>
                                <summary className="min-h-11 cursor-pointer py-2 font-medium">
                                  Record permission for this type of email
                                </summary>
                                <div className="flex flex-col gap-4">
                                  <label className="flex min-h-11 items-center gap-3">
                                    <input
                                      name="addPermission"
                                      type="checkbox"
                                      className="size-5 accent-primary"
                                    />
                                    Include this evidence in the new revision
                                  </label>
                                  <Field
                                    name="permission-kind"
                                    title="Evidence kind"
                                  >
                                    <NativeSelect
                                      id="permission-kind"
                                      name="kind"
                                    >
                                      <option value="consent">Consent</option>
                                      <option value="documented_relationship">
                                        Documented relationship
                                      </option>
                                    </NativeSelect>
                                  </Field>
                                  <Field
                                    name="permission-purpose"
                                    title="Covered purpose"
                                  >
                                    <NativeSelect
                                      id="permission-purpose"
                                      name="purpose"
                                    >
                                      {emailPurposes.map((p) => (
                                        <option key={p} value={p}>
                                          {label(p)}
                                        </option>
                                      ))}
                                    </NativeSelect>
                                  </Field>
                                  <Field
                                    name="permission-policy"
                                    title="Policy revision this evidence was reviewed against"
                                  >
                                    <NativeSelect
                                      id="permission-policy"
                                      name="policyId"
                                    >
                                      <option value="">
                                        Choose applicable policy
                                      </option>
                                      {state.policies.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.policy.market} ·{" "}
                                          {label(p.policy.recipientClass)} ·{" "}
                                          {label(p.policy.purpose)} · Revision{" "}
                                          {p.version}
                                        </option>
                                      ))}
                                    </NativeSelect>
                                  </Field>
                                  <Field
                                    name="permission-opportunity"
                                    title="Covered Opportunity"
                                  >
                                    <Input
                                      id="permission-opportunity"
                                      name="opportunityId"
                                      list="eligibility-opportunities"
                                    />
                                  </Field>
                                  <Field
                                    name="permission-prospect"
                                    title="Covered prospect (for first outreach without an Opportunity)"
                                  >
                                    <Input
                                      id="permission-prospect"
                                      name="prospectId"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                      Use the prospect ID shown in campaign
                                      review. Leave Opportunity blank when
                                      recording prospect permission.
                                    </p>
                                  </Field>
                                  <Field
                                    name="permission-reference"
                                    title="Permission provenance and covered use"
                                  >
                                    <Textarea
                                      id="permission-reference"
                                      name="permissionReference"
                                      maxLength={2000}
                                    />
                                  </Field>
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <Field
                                      name="permission-observed"
                                      title="Observed time (local)"
                                    >
                                      <Input
                                        id="permission-observed"
                                        name="observedAt"
                                        type="datetime-local"
                                      />
                                    </Field>
                                    <Field
                                      name="permission-until"
                                      title="Permission valid until (local)"
                                    >
                                      <Input
                                        id="permission-until"
                                        name="permissionUntil"
                                        type="datetime-local"
                                      />
                                    </Field>
                                  </div>
                                </div>
                              </details>
                              <Button>Save recipient evidence revision</Button>
                            </fieldset>
                            {feedbackFor("recipient")}
                          </FieldGroup>
                        </form>
                      </>
                    )}
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 font-medium">
                        Saved contact permissions ({state.recipients.length})
                      </summary>
                      <div className="flex flex-col gap-3">
                        {state.recipients.map((r) => (
                          <div key={r.id} className="rounded-lg border p-3">
                            <p>
                              {r.facts.recipient} · Revision {r.version} ·{" "}
                              {r.facts.market ?? "unknown destination"} ·{" "}
                              {label(r.facts.recipientClass)}
                            </p>
                            <p>{r.facts.reference}</p>
                            <p className="text-sm">
                              Effective {r.facts.effectiveAt}; valid until{" "}
                              {r.facts.validUntil}; recorded by {r.actorId} at{" "}
                              {r.at}
                            </p>
                            {r.facts.permissions.map((p, i) => (
                              <p key={i}>
                                {label(p.kind)}: {label(p.purpose)} ·{" "}
                                {p.opportunityId ? "Opportunity" : "Prospect"}{" "}
                                {p.opportunityId ?? p.prospectId} ·{" "}
                                {p.reference} · {p.observedAt} to {p.validUntil}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              </>
            ),
          },
          {
            id: "opt-outs",
            label: "Opt-outs",
            description:
              "Record a request to stop email. Check its scope before saving.",
            content: (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Do not contact</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-muted-foreground">
                      Record the covered scope and effective time. Effective
                      restrictions apply at dispatch, including to queued work.
                      Ownership and conversation history are retained. No
                      notification is sent by this form.
                    </p>
                    <form
                      onSubmit={(e) =>
                        submit(
                          e,
                          "suppression",
                          "suppression",
                          addEmailSuppressionSchema,
                          (f) => ({
                            requestKey: suppressionRequestKey,
                            recipient: text(f, "recipient"),
                            scope: text(f, "scope"),
                            opportunityId: text(f, "opportunityId") || null,
                            effectiveAt: date(f, "effectiveAt"),
                            reference: text(f, "reference"),
                          }),
                        )
                      }
                      className="flex flex-col gap-4"
                    >
                      <FieldGroup className="gap-4">
                        <fieldset
                          disabled={pending}
                          className="flex flex-col gap-4"
                        >
                          <Field
                            name="suppression-recipient"
                            title="Recipient email"
                          >
                            <Input
                              id="suppression-recipient"
                              name="recipient"
                              type="email"
                              required
                            />
                          </Field>
                          <Field name="suppression-scope" title="Covered scope">
                            <NativeSelect id="suppression-scope" name="scope">
                              <option value="recipient_outreach">
                                This recipient&apos;s outreach across this
                                Business
                              </option>
                              <option value="opportunity_outreach">
                                This recipient&apos;s outreach for one
                                Opportunity
                              </option>
                              <option value="recipient_email">
                                All sales email to this recipient in this
                                Business
                              </option>
                            </NativeSelect>
                          </Field>
                          <Field
                            name="suppression-opportunity"
                            title="Opportunity (only for one-Opportunity scope)"
                          >
                            <Input
                              id="suppression-opportunity"
                              name="opportunityId"
                              list="eligibility-opportunities"
                            />
                          </Field>
                          <Field
                            name="suppression-effective"
                            title="Effective time (local)"
                          >
                            <Input
                              id="suppression-effective"
                              name="effectiveAt"
                              type="datetime-local"
                              required
                            />
                          </Field>
                          <Field
                            name="suppression-reference"
                            title="Opt-out source and responsible next action"
                          >
                            <Textarea
                              id="suppression-reference"
                              name="reference"
                              required
                              maxLength={2000}
                            />
                          </Field>
                          <Button>Record suppression</Button>
                        </fieldset>
                        {feedbackFor("suppression")}
                      </FieldGroup>
                    </form>
                    {!state.suppressions.length ? (
                      <p>
                        No suppression records yet. New opt-outs are still
                        checked at dispatch.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {state.suppressions.map((s) => (
                          <li key={s.id} className="rounded-xl border p-4">
                            <p className="font-medium">
                              {s.recipient} · {label(s.scope)}
                            </p>
                            <p>
                              Effective{" "}
                              {new Date(s.effectiveAt).toLocaleString()}
                              {s.opportunityId &&
                                ` · Opportunity ${s.opportunityId}`}
                            </p>
                            <p>{s.reference}</p>
                            <p className="text-sm text-muted-foreground">
                              {label(s.source)} · recorded by {s.actorId} at{" "}
                              {s.at}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </>
            ),
          },
          {
            id: "rules",
            label: "Sending rules",
            description:
              "Review the rules that apply to each destination and message purpose.",
            content: (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Rules by country and email purpose</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <p className="text-muted-foreground">
                      No market is preapproved. A separately authorized platform
                      operator records applicable guidance, accepted evidence,
                      content requirements and a review expiry for each
                      destination, legal class and purpose. Publication
                      configures the evaluator; it does not establish legal
                      approval or activate sending.
                    </p>
                    {!state.canPublish ? (
                      <p>
                        Ask the platform policy operator to configure missing
                        coverage. Business access alone cannot publish platform
                        policy.
                      </p>
                    ) : (
                      <>
                        <Field
                          name="select-policy"
                          title="Create a policy or revise existing coverage"
                        >
                          <NativeSelect
                            id="select-policy"
                            value={policyId}
                            onChange={(e) => setPolicyId(e.target.value)}
                          >
                            <option value="">New market/purpose policy</option>
                            {state.policies
                              .filter(
                                (p, i, all) =>
                                  all.findIndex((r) => r.key === p.key) === i,
                              )
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.policy.market} ·{" "}
                                  {label(p.policy.recipientClass)} ·{" "}
                                  {label(p.policy.purpose)} · v{p.version}
                                </option>
                              ))}
                          </NativeSelect>
                        </Field>
                        <form
                          key={selectedPolicy?.id ?? "new"}
                          className="flex flex-col gap-4"
                          onSubmit={(e) =>
                            submit(
                              e,
                              "policy",
                              "policy",
                              publishEmailPolicySchema,
                              (f) => ({
                                expectedVersion: selectedPolicy?.version ?? 0,
                                policy: {
                                  market: text(f, "market"),
                                  recipientClass: text(f, "recipientClass"),
                                  purpose: text(f, "purpose"),
                                  enabled: f.has("enabled"),
                                  effectiveAt: date(f, "effectiveAt"),
                                  validUntil: date(f, "validUntil"),
                                  acceptedEvidence:
                                    f.getAll("acceptedEvidence"),
                                  requiredContent: f.getAll("requiredContent"),
                                  incomingOptOutScope: text(
                                    f,
                                    "incomingOptOutScope",
                                  ),
                                  sources: text(f, "sources")
                                    .split(/\r?\n/)
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                  rationale: text(f, "rationale"),
                                },
                              }),
                            )
                          }
                        >
                          <FieldGroup className="gap-4">
                            <fieldset
                              disabled={pending}
                              className="flex flex-col gap-4"
                            >
                              <Field
                                name="policy-market"
                                title="Contact's country"
                              >
                                <>
                                  <NativeSelect
                                    id="policy-market"
                                    name={selectedPolicy ? undefined : "market"}
                                    required
                                    defaultValue={
                                      selectedPolicy?.policy.market ?? ""
                                    }
                                    disabled={Boolean(selectedPolicy)}
                                  >
                                    <option value="">Choose a country</option>
                                    {countries.map((country) => (
                                      <option
                                        key={country.code}
                                        value={country.code}
                                      >
                                        {country.name}
                                      </option>
                                    ))}
                                  </NativeSelect>
                                  {selectedPolicy && (
                                    <input
                                      type="hidden"
                                      name="market"
                                      value={selectedPolicy.policy.market}
                                    />
                                  )}
                                </>
                              </Field>
                              <Field
                                name="policy-class"
                                title="Legal recipient class"
                              >
                                <NativeSelect
                                  id="policy-class"
                                  name="recipientClass"
                                  defaultValue={
                                    selectedPolicy?.policy.recipientClass
                                  }
                                >
                                  {recipientClasses
                                    .filter((v) => v !== "unknown")
                                    .map((v) => (
                                      <option key={v} value={v}>
                                        {label(v)}
                                      </option>
                                    ))}
                                </NativeSelect>
                              </Field>
                              <Field
                                name="policy-purpose"
                                title="Message purpose"
                              >
                                <NativeSelect
                                  id="policy-purpose"
                                  name="purpose"
                                  defaultValue={selectedPolicy?.policy.purpose}
                                >
                                  {emailPurposes.map((v) => (
                                    <option key={v} value={v}>
                                      {label(v)}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Field>
                              <label className="flex min-h-11 items-center gap-3">
                                <input
                                  type="checkbox"
                                  name="enabled"
                                  defaultChecked={
                                    selectedPolicy?.policy.enabled ?? false
                                  }
                                  className="size-5 accent-primary"
                                />
                                Enable this exact policy coverage
                              </label>
                              <div className="grid gap-4 sm:grid-cols-2">
                                <Field
                                  name="policy-effective"
                                  title="Effective time (local)"
                                >
                                  <Input
                                    id="policy-effective"
                                    name="effectiveAt"
                                    type="datetime-local"
                                    required
                                    defaultValue={localDate(
                                      selectedPolicy?.policy.effectiveAt,
                                    )}
                                  />
                                </Field>
                                <Field
                                  name="policy-until"
                                  title="Policy valid until (local)"
                                >
                                  <Input
                                    id="policy-until"
                                    name="validUntil"
                                    type="datetime-local"
                                    required
                                    defaultValue={localDate(
                                      selectedPolicy?.policy.validUntil,
                                    )}
                                  />
                                </Field>
                              </div>
                              <fieldset>
                                <legend className="font-medium">
                                  Accepted permission evidence (direct inquiry
                                  applies only to its response)
                                </legend>
                                <Checks
                                  name="acceptedEvidence"
                                  values={evidenceKinds}
                                  selected={
                                    selectedPolicy?.policy.acceptedEvidence
                                  }
                                />
                              </fieldset>
                              <fieldset>
                                <legend className="font-medium">
                                  Required content review
                                </legend>
                                <Checks
                                  name="requiredContent"
                                  values={contentRequirements}
                                  selected={
                                    selectedPolicy?.policy.requiredContent
                                  }
                                />
                              </fieldset>
                              <Field
                                name="policy-optout"
                                title="Scope of incoming opt-out requests"
                              >
                                <NativeSelect
                                  id="policy-optout"
                                  name="incomingOptOutScope"
                                  defaultValue={
                                    selectedPolicy?.policy
                                      .incomingOptOutScope ??
                                    "recipient_outreach"
                                  }
                                >
                                  {suppressionScopes.map((v) => (
                                    <option key={v} value={v}>
                                      {label(v)}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Field>
                              <Field
                                name="policy-sources"
                                title="Applicable primary guidance URLs (one HTTPS URL per line)"
                              >
                                <Textarea
                                  id="policy-sources"
                                  name="sources"
                                  required
                                  defaultValue={selectedPolicy?.policy.sources.join(
                                    "\n",
                                  )}
                                />
                              </Field>
                              <Field
                                name="policy-rationale"
                                title="Reviewed rules, evidence conditions and provider requirements"
                              >
                                <Textarea
                                  id="policy-rationale"
                                  name="rationale"
                                  required
                                  maxLength={2000}
                                  defaultValue={
                                    selectedPolicy?.policy.rationale
                                  }
                                />
                              </Field>
                              <Button>Publish policy revision</Button>
                            </fieldset>
                            {feedbackFor("policy")}
                          </FieldGroup>
                        </form>
                      </>
                    )}
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 font-medium">
                        Policy history ({state.policies.length})
                      </summary>
                      {state.policies.map((p) => (
                        <div key={p.id} className="my-3 rounded-lg border p-3">
                          <p className="font-medium">
                            {p.policy.market} · {label(p.policy.recipientClass)}{" "}
                            · {label(p.policy.purpose)} · Revision {p.version} ·{" "}
                            {p.policy.enabled ? "Enabled" : "Restricted"}
                          </p>
                          <p>{p.policy.rationale}</p>
                          <p>
                            Effective {p.policy.effectiveAt}; valid until{" "}
                            {p.policy.validUntil}
                          </p>
                          <p>
                            Evidence:{" "}
                            {p.policy.acceptedEvidence.map(label).join(", ")};
                            content:{" "}
                            {p.policy.requiredContent.map(label).join(", ") ||
                              "No configured review checks"}
                          </p>
                          <p className="text-sm">
                            Recorded by {p.actorId} at {p.at}
                          </p>
                          {p.policy.sources.map((url) => (
                            <a
                              className="block min-h-11 py-2 text-primary underline"
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {url}
                            </a>
                          ))}
                        </div>
                      ))}
                    </details>
                  </CardContent>
                </Card>
              </>
            ),
          },
          {
            id: "history",
            label: "Check history",
            description:
              "Review previous email checks and the facts used for each decision.",
            content: (
              <>
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">
                    Recent email checks
                  </summary>
                  {state.evaluations.map((r) => (
                    <p key={r.id} className="border-b py-3">
                      {r.at} · {r.recipient} · {label(r.purpose)} ·{" "}
                      {r.status.toUpperCase()} · Action {r.action.id} · Decision{" "}
                      {r.id}
                    </p>
                  ))}
                </details>
              </>
            ),
          },
        ]}
      />
      <datalist id="eligibility-opportunities">
        {opportunities.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
    </div>
  );
}
