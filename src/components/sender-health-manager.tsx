"use client";
import { WorkspaceTabs } from "./workspace-tabs";
import { FieldGroup } from "./ui/field";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RecoveryLink } from "./recovery-link";
import { z } from "zod";
import type { createSenderHealthApplication } from "@/application/sender-health";
import {
  healthCommandSchema,
  healthMetrics,
  metricMeaning,
} from "@/models/sender-health";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Alert } from "./ui/alert";

type Workspace = Awaited<
  ReturnType<
    ReturnType<typeof createSenderHealthApplication<Headers>>["workspace"]
  >
>;
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
const dateLabel = (value: string) => `${value} (UTC offset included)`;
export function SenderHealthManager({
  state,
  operator = false,
}: {
  state: Workspace;
  operator?: boolean;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function command(input: unknown) {
    setError("");
    setMessage("");
    const parsed = healthCommandSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        "Check the required fields, ISO times, sample counts, thresholds and source reference. Rate thresholds are fractions greater than zero and at most one.",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        operator
          ? `/api/platform/sender-health/${state.businessId}`
          : `/api/businesses/${state.businessId}/sender-health`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!response.ok) {
        const raw: unknown = await response.json(),
          failure = z.object({ code: z.string() }).safeParse(raw);
        const code = failure.success ? failure.data.code : "";
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your authenticator in Security and retry. Your entries are preserved."
            : code === "CONFLICT"
              ? "The policy, binding, event or repair evidence conflicts with current state. Refresh status, review the exact sender and obtain a newer complete window."
              : code === "FORBIDDEN"
                ? "Your current role does not permit this action. Ask the sender-health operator for help."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again and retry. Your entries are preserved."
                  : "The evidence could not be recorded. Check its source, window and current sender binding, then retry.",
        );
        return;
      }
      setMessage(
        parsed.data.command === "acknowledge"
          ? "Alert acknowledged. Sender health is unchanged."
          : parsed.data.command === "prune"
            ? "Expired source artifacts removed. Incident safety and replay fingerprints are retained."
            : "Recorded. Readiness uses current evidence; cancelled and uncertain work are unchanged.",
      );
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Refresh status before retrying with the same event key.",
      );
    } finally {
      setPending(false);
    }
  }
  function policySubmit(
    event: FormEvent<HTMLFormElement>,
    identity: Workspace["identities"][number],
  ) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      number = (key: string) => Number(f.get(key));
    const thresholds = Object.fromEntries(
      healthMetrics.map((m) => [
        m,
        {
          unit: f.get(`${m}-unit`),
          limit: number(`${m}-limit`),
          minimumSample: number(`${m}-sample`),
        },
      ]),
    );
    void command({
      command: "configure",
      identityId: identity.id,
      expectedVersion: identity.policy?.version ?? 0,
      policy: {
        source: "assisted_review",
        sourceAuthority: f.get("sourceAuthority"),
        sourceOrigin: f.get("sourceOrigin"),
        population: f.get("population"),
        windowSeconds: number("windowSeconds"),
        freshnessSeconds: number("freshnessSeconds"),
        maximumLatenessSeconds: number("maximumLatenessSeconds"),
        retentionDays: number("retentionDays"),
        thresholds,
      },
    });
  }
  function evidenceSubmit(
    event: FormEvent<HTMLFormElement>,
    identity: Workspace["identities"][number],
  ) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void command({
      command: "ingest",
      identityId: identity.id,
      evidence: {
        eventKey: f.get("eventKey"),
        policyVersion: identity.policy?.version,
        binding: identity.binding,
        observedAt: f.get("observedAt"),
        windowStart: f.get("windowStart"),
        windowEnd: f.get("windowEnd"),
        reference: f.get("reference"),
        artifactSha256: f.get("artifactSha256"),
        metrics: Object.fromEntries(
          healthMetrics.map((m) => [
            m,
            {
              failed: Number(f.get(`${m}-failed`)),
              total: Number(f.get(`${m}-total`)),
            },
          ]),
        ),
        repairs: f.getAll("repairs"),
      },
    });
  }
  return (
    <div className="flex flex-col gap-8" aria-busy={pending}>
      {pending && <p role="status">Recording sender health…</p>}
      {error && (
        <Alert role="alert">
          <p>{error}</p>
          <RecoveryLink
            href="/security"
            className="inline-flex min-h-11 items-center text-primary underline"
          >
            Open Security
          </RecoveryLink>
        </Alert>
      )}
      {message && <p role="status">{message}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Delivery problems</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            These are durable in-app alerts for the{" "}
            {operator ? "responsible sender-health operator" : "Business team"}.
            No email or external notification is sent. Acknowledging records
            receipt and never repairs a sender.
          </p>
          {!state.alerts.length && (
            <p>No sender incidents have been reported.</p>
          )}
          {state.alerts.map((a) => (
            <div
              key={a.id}
              className="flex flex-col gap-2 rounded-xl border p-4"
            >
              <p className="break-all">
                Sender{" "}
                {state.identities.find((i) => i.id === a.identityId)?.address ??
                  a.identityId}
              </p>
              <p className="text-sm">
                Incident {a.incidentId} · {a.at}
              </p>
              <a
                className="inline-flex min-h-11 items-center text-primary underline"
                href={`#sender-${a.identityId}`}
              >
                Review failure and remediation
              </a>
              <div>
                {a.acknowledged ? (
                  <Badge>Acknowledged</Badge>
                ) : (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void command({ command: "acknowledge", alertId: a.id })
                    }
                  >
                    Acknowledge alert
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {!state.identities.length && (
        <p>Configure a sending identity and its exact connection first.</p>
      )}
      {state.identities.map((identity) => {
        const p = identity.policy?.configuration,
          prefix = identity.id;
        return (
          <Card key={identity.id} id={`sender-${identity.id}`}>
            <CardHeader>
              <CardTitle className="break-all">{identity.address}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Badge>
                {identity.issues.length
                  ? "Sending paused, review needed"
                  : "Delivery checks up to date"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                Health permits only this sender’s affected outbound work.
                Incoming mail, selected scope and history settings remain
                available. Overall sending still requires the current
                connection, reply visibility, approval and eligibility checks.
              </p>
              {identity.issues.map((i) => (
                <p key={i.code}>{i.action}</p>
              ))}
              <WorkspaceTabs
                tabs={[
                  {
                    id: "checks",
                    label: "Delivery checks",
                    description:
                      "Review this address's authentication and recent delivery evidence.",
                    content: (
                      <>
                        <dl className="grid gap-2 break-words text-sm">
                          <div>
                            <dt className="font-medium">
                              Exact account and connection generation
                            </dt>
                            <dd>
                              {identity.binding.provider} ·{" "}
                              {identity.binding.account} · generation{" "}
                              {identity.binding.generation ?? "no native grant"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium">Policy</dt>
                            <dd>
                              {identity.policy
                                ? `Version ${identity.policy.version} · reviewed ${identity.policy.at} · actor ${identity.policy.actorId}`
                                : "Operator configuration required; no production thresholds are assumed."}
                            </dd>
                          </div>
                          {p && (
                            <>
                              <div>
                                <dt className="font-medium">
                                  Measured population and source authority
                                </dt>
                                <dd>
                                  {p.population} · {p.sourceAuthority} ·{" "}
                                  {p.sourceOrigin}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium">
                                  Timing and artifact retention
                                </dt>
                                <dd>
                                  Window {p.windowSeconds}s · fresh for{" "}
                                  {p.freshnessSeconds}s · maximum reporting
                                  delay {p.maximumLatenessSeconds}s · source
                                  artifacts retained {p.retentionDays} days.
                                  Minimal incident, policy and replay audit
                                  remains for dispatch safety.
                                </dd>
                              </div>
                            </>
                          )}
                        </dl>
                        {identity.evidence && (
                          <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
                            <p>Observed {identity.evidence.observedAt}</p>
                            <p className="break-words text-sm">
                              Reviewed by {identity.evidence.actorId} · recorded{" "}
                              {identity.evidence.recordedAt}
                            </p>
                            <p>
                              Window {identity.evidence.windowStart} to{" "}
                              {identity.evidence.windowEnd}
                            </p>
                            <p className="break-all">
                              Source: {identity.evidence.reference}
                            </p>
                            <p className="break-all text-sm">
                              Artifact SHA-256:{" "}
                              {identity.evidence.artifactSha256}
                            </p>
                            {healthMetrics.map((m) => (
                              <p key={m}>
                                {metricMeaning[m]}:{" "}
                                {identity.evidence!.metrics[m].failed} /{" "}
                                {identity.evidence!.metrics[m].total}
                                {p &&
                                  ` · fail at ≥ ${p.thresholds[m].limit} ${p.thresholds[m].unit} · minimum ${p.thresholds[m].minimumSample}`}
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    ),
                  },
                  {
                    id: "issues",
                    label: "Issues",
                    description:
                      "Review delivery incidents and what needs to be repaired.",
                    content: (
                      <>
                        {identity.incidents.map((i) => (
                          <div
                            key={i.id}
                            className="flex flex-col gap-2 rounded-xl border p-4"
                          >
                            <p className="font-medium">
                              {i.resolved ? "Repaired" : "Open incident"}:{" "}
                              {i.failures.join(", ")}
                            </p>
                            <p className="break-all text-sm">
                              {i.id} · {i.observedAt} · {i.reason}
                            </p>
                            <p>
                              Repair needs newer attributable evidence for the
                              current bindings, covering a full window after{" "}
                              {i.lastWindowEnd}, satisfying the original failed
                              policy and the current policy. Reconnect revoked
                              sending permission separately. A refresh or
                              acknowledgement cannot resolve this incident.
                            </p>
                            {i.metrics &&
                              i.policy &&
                              i.failures.map((m) =>
                                m === "sending_authorization" ? null : (
                                  <p key={m} className="text-sm">
                                    {m}: {i.metrics![m].failed}/
                                    {i.metrics![m].total} · fail at ≥{" "}
                                    {i.policy!.thresholds[m].limit}{" "}
                                    {i.policy!.thresholds[m].unit} · minimum{" "}
                                    {i.policy!.thresholds[m].minimumSample}
                                  </p>
                                ),
                              )}
                          </div>
                        ))}
                      </>
                    ),
                  },
                  ...(operator
                    ? [
                        {
                          id: "repair",
                          label: "Advanced repair",
                          description:
                            "Operator controls for reviewed delivery evidence and alert thresholds.",
                          content: (
                            <>
                              {operator && (
                                <>
                                  <details>
                                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                                      Configure reviewed source and thresholds
                                    </summary>
                                    <form
                                      key={identity.policy?.version ?? 0}
                                      onSubmit={(e) =>
                                        policySubmit(e, identity)
                                      }
                                      className="flex flex-col gap-4 pt-4"
                                    >
                                      <FieldGroup className="gap-4">
                                        <p>
                                          Only submit an authorized source
                                          policy with actual reviewed inputs.
                                          Rates are fractions; equality fails.
                                          Snapshots are never added together.
                                          Missing or undersized samples remain
                                          unknown.
                                        </p>
                                        {(
                                          [
                                            [
                                              "sourceAuthority",
                                              "Source authority",
                                            ],
                                            [
                                              "sourceOrigin",
                                              "HTTPS source origin (no path)",
                                            ],
                                            [
                                              "population",
                                              "Exact sender population",
                                            ],
                                          ] as const
                                        ).map(([name, label]) => (
                                          <Field
                                            key={name}
                                            id={`${prefix}-${name}`}
                                            label={label}
                                          >
                                            <Input
                                              id={`${prefix}-${name}`}
                                              name={name}
                                              defaultValue={p?.[name] ?? ""}
                                              required
                                              maxLength={240}
                                            />
                                          </Field>
                                        ))}
                                        <div className="grid gap-4 sm:grid-cols-2">
                                          {(
                                            [
                                              [
                                                "windowSeconds",
                                                "Evidence window (seconds)",
                                              ],
                                              [
                                                "freshnessSeconds",
                                                "Freshness (seconds)",
                                              ],
                                              [
                                                "maximumLatenessSeconds",
                                                "Maximum reporting delay (seconds)",
                                              ],
                                              [
                                                "retentionDays",
                                                "Artifact retention (days)",
                                              ],
                                            ] as const
                                          ).map(([name, label]) => (
                                            <Field
                                              key={name}
                                              id={`${prefix}-${name}`}
                                              label={label}
                                            >
                                              <Input
                                                id={`${prefix}-${name}`}
                                                name={name}
                                                type="number"
                                                min={
                                                  name ===
                                                  "maximumLatenessSeconds"
                                                    ? 0
                                                    : 1
                                                }
                                                step="1"
                                                defaultValue={p?.[name] ?? ""}
                                                required
                                              />
                                            </Field>
                                          ))}
                                        </div>
                                        {healthMetrics.map((m) => (
                                          <fieldset
                                            key={m}
                                            className="flex flex-col gap-3 rounded-xl border p-4"
                                          >
                                            <legend className="px-2 text-sm">
                                              {metricMeaning[m]}
                                            </legend>
                                            <div className="grid gap-4 sm:grid-cols-3">
                                              <Field
                                                id={`${prefix}-${m}-unit`}
                                                label="Threshold unit"
                                              >
                                                <NativeSelect
                                                  id={`${prefix}-${m}-unit`}
                                                  name={`${m}-unit`}
                                                  defaultValue={
                                                    p?.thresholds[m].unit ?? ""
                                                  }
                                                  required
                                                >
                                                  <option value="">
                                                    Choose unit
                                                  </option>
                                                  <option value="count">
                                                    Failure count
                                                  </option>
                                                  <option value="rate">
                                                    Failure fraction
                                                  </option>
                                                </NativeSelect>
                                              </Field>
                                              <Field
                                                id={`${prefix}-${m}-limit`}
                                                label="Fail at or above"
                                              >
                                                <Input
                                                  id={`${prefix}-${m}-limit`}
                                                  name={`${m}-limit`}
                                                  type="number"
                                                  step="any"
                                                  min="0.000000001"
                                                  defaultValue={
                                                    p?.thresholds[m].limit ?? ""
                                                  }
                                                  required
                                                />
                                              </Field>
                                              <Field
                                                id={`${prefix}-${m}-sample`}
                                                label="Minimum denominator"
                                              >
                                                <Input
                                                  id={`${prefix}-${m}-sample`}
                                                  name={`${m}-sample`}
                                                  type="number"
                                                  min="1"
                                                  step="1"
                                                  defaultValue={
                                                    p?.thresholds[m]
                                                      .minimumSample ?? ""
                                                  }
                                                  required
                                                />
                                              </Field>
                                            </div>
                                          </fieldset>
                                        ))}
                                        <Button disabled={pending}>
                                          Save policy version
                                        </Button>
                                      </FieldGroup>
                                    </form>
                                  </details>
                                  {p && (
                                    <details>
                                      <summary className="min-h-11 cursor-pointer py-3 font-medium">
                                        Record provider evidence or repair
                                      </summary>
                                      <form
                                        onSubmit={(e) =>
                                          evidenceSubmit(e, identity)
                                        }
                                        className="flex flex-col gap-4 pt-4"
                                      >
                                        <FieldGroup className="gap-4">
                                          <p>
                                            Review actual provider reports or
                                            trusted receiver authentication
                                            results and attributable
                                            delivery/complaint records for this
                                            exact account. Do not infer zero
                                            complaints from no data. This
                                            records your authenticated assisted
                                            review, not an automated Gmail or
                                            Graph telemetry feed. Include no
                                            message bodies, recipient
                                            identities, tokens or sensitive URL
                                            parameters.
                                          </p>
                                          <p className="text-sm">
                                            SPF/DKIM/DMARC use trusted receiver
                                            results. Bounces count permanent
                                            failures among accepted submissions.
                                            Complaints count attributable
                                            recipient reports among delivered
                                            messages in the stated reviewed
                                            population. Different populations
                                            require a different approved source
                                            policy.
                                          </p>
                                          {(
                                            [
                                              [
                                                "eventKey",
                                                "Stable source report key",
                                              ],
                                              [
                                                "reference",
                                                "HTTPS artifact reference (no query or credentials)",
                                              ],
                                              [
                                                "artifactSha256",
                                                "Reviewed artifact SHA-256",
                                              ],
                                              [
                                                "observedAt",
                                                dateLabel("Observed at"),
                                              ],
                                              [
                                                "windowStart",
                                                dateLabel("Window start"),
                                              ],
                                              [
                                                "windowEnd",
                                                dateLabel("Window end"),
                                              ],
                                            ] as const
                                          ).map(([name, label]) => (
                                            <Field
                                              key={name}
                                              id={`${prefix}-${name}`}
                                              label={label}
                                            >
                                              <Input
                                                id={`${prefix}-${name}`}
                                                name={name}
                                                required
                                                autoComplete="off"
                                                maxLength={
                                                  name === "reference"
                                                    ? 512
                                                    : 128
                                                }
                                                placeholder={
                                                  name.endsWith("At") ||
                                                  name.startsWith("window")
                                                    ? "YYYY-MM-DDTHH:mm:ssZ"
                                                    : undefined
                                                }
                                              />
                                            </Field>
                                          ))}
                                          {healthMetrics.map((m) => (
                                            <fieldset
                                              key={m}
                                              className="flex flex-col gap-3 rounded-xl border p-4"
                                            >
                                              <legend className="px-2 text-sm">
                                                {metricMeaning[m]}
                                              </legend>
                                              <div className="grid gap-4 sm:grid-cols-2">
                                                {(
                                                  ["failed", "total"] as const
                                                ).map((n) => (
                                                  <Field
                                                    key={n}
                                                    id={`${prefix}-${m}-${n}`}
                                                    label={
                                                      n === "failed"
                                                        ? "Failures"
                                                        : "Assessed denominator"
                                                    }
                                                  >
                                                    <Input
                                                      id={`${prefix}-${m}-${n}`}
                                                      name={`${m}-${n}`}
                                                      type="number"
                                                      min="0"
                                                      step="1"
                                                      required
                                                    />
                                                  </Field>
                                                ))}
                                              </div>
                                            </fieldset>
                                          ))}
                                          <fieldset className="flex flex-col gap-2">
                                            <legend className="font-medium">
                                              Incidents this evidence repairs
                                            </legend>
                                            {identity.incidents
                                              .filter((i) => !i.resolved)
                                              .map((i) => (
                                                <label
                                                  key={i.id}
                                                  htmlFor={`${prefix}-repair-${i.id}`}
                                                  className="flex min-h-11 items-center gap-3"
                                                >
                                                  <Checkbox
                                                    id={`${prefix}-repair-${i.id}`}
                                                    name="repairs"
                                                    value={i.id}
                                                  />
                                                  <span className="break-all">
                                                    {i.failures.join(", ")} ·{" "}
                                                    {i.id}
                                                  </span>
                                                </label>
                                              ))}
                                            <p className="text-sm text-muted-foreground">
                                              Select only incidents whose failed
                                              condition this newer window
                                              addresses. Healthy evidence alone
                                              never silently repairs an
                                              incident.
                                            </p>
                                          </fieldset>
                                          <Button disabled={pending}>
                                            Record reviewed evidence
                                          </Button>
                                        </FieldGroup>
                                      </form>
                                    </details>
                                  )}
                                  <Button
                                    variant="outline"
                                    disabled={pending}
                                    onClick={() =>
                                      void command({
                                        command: "prune",
                                        identityId: identity.id,
                                      })
                                    }
                                  >
                                    Remove expired source artifacts
                                  </Button>
                                </>
                              )}
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </CardContent>
          </Card>
        );
      })}
      <Link
        href={`/businesses/${state.businessId}/senders`}
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Review all sending and reply readiness
      </Link>
    </div>
  );
}
