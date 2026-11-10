"use client";
import { Field, FieldGroup } from "./ui/field";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  capacityConfigurationSchema,
  capacityPolicySchema,
  capacityDeclarationSchema,
  capacityRevisionSchema,
} from "@/models/discovery-capacity";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertDescription } from "./ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type Configuration = z.infer<typeof capacityConfigurationSchema>;
type Allocation = {
  key: string;
  businessId: string;
  offerId: string;
  reservedCapacityId: string;
  quantity: string;
  unit: string;
  concurrentRuns: string;
  mappingEvidence: string;
};
export function DiscoveryCapacityManager({
  initial,
}: {
  initial: Configuration;
}) {
  const [configuration, setConfiguration] = useState(initial);
  const latest = configuration.revisions[0];
  const prior = initial.revisions[0]?.policy;
  const [draft, setDraft] = useState({
    allocationKey: "",
    projectRef: prior?.projectRef ?? "",
    environmentId: prior?.environmentId ?? "",
    deploymentRef: prior?.deploymentRef ?? "",
    deploymentId: "",
    deploymentVersion: "",
    providerEvidence: prior?.providerEvidence ?? "",
    validUntil: prior?.validUntil ?? "",
    total: prior ? String(prior.total) : "",
    pooled: prior ? String(prior.pooled) : "",
    maxObservationAgeMs: prior ? String(prior.maxObservationAgeMs) : "",
  });
  const [allocations, setAllocations] = useState<Allocation[]>(
    prior?.allocations.map((a) => ({
      ...a,
      key: a.businessId,
      quantity: String(a.quantity),
      concurrentRuns: String(a.concurrentRuns),
    })) ?? [],
  );
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [manifest, setManifest] = useState("");
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  function edit(key: keyof typeof draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setApproved(false);
    setMessage("");
    setManifest("");
  }
  function editAllocation(
    key: string,
    field: keyof Omit<Allocation, "key">,
    value: string,
  ) {
    setAllocations((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
    setApproved(false);
    setMessage("");
    setManifest("");
  }
  function draftPolicy() {
    return {
      ...draft,
      total: Number(draft.total),
      pooled: Number(draft.pooled),
      maxObservationAgeMs: Number(draft.maxObservationAgeMs),
      fallback: "wait",
      allocations: allocations.map((row) => ({
        businessId: row.businessId,
        offerId: row.offerId,
        reservedCapacityId: row.reservedCapacityId,
        unit: row.unit,
        mappingEvidence: row.mappingEvidence,
        quantity: Number(row.quantity),
        concurrentRuns: Number(row.concurrentRuns),
      })),
    };
  }
  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Approve provider allocation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">
            Reserve concurrent discovery runs within a paid, reviewed provider
            environment. Names and queue keys alone do not purchase compute.
            Leave enough capacity for the pooled lane. Each allocation must
            match the Business&apos;s confirmed subscription option exactly.
            Include reviewed evidence mapping its contract quantity and unit to
            the allocated concurrent runs.
          </p>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                setError("");
                setMessage("");
                const parsed = capacityPolicySchema.safeParse(draftPolicy());
                if (!parsed.success || !approved) {
                  setError(
                    "Check the policy fields and finite allocations, then confirm approval.",
                  );
                  return;
                }
                const payload = {
                  expectedVersion: latest?.version ?? 0,
                  policy: parsed.data,
                };
                const fingerprint = JSON.stringify(payload);
                if (request.current?.fingerprint !== fingerprint)
                  request.current = { fingerprint, key: crypto.randomUUID() };
                setBusy(true);
                try {
                  const response = await fetch(
                    "/api/platform/discovery-capacity",
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        ...payload,
                        requestKey: request.current.key,
                      }),
                    },
                  );
                  const body: unknown = await response.json();
                  if (!response.ok) {
                    const failure = z
                      .object({ code: z.string() })
                      .safeParse(body);
                    const code = failure.success ? failure.data.code : "";
                    setError(
                      code === "MFA_REQUIRED"
                        ? "Verify your authenticator in Security, then retry. Your form is preserved."
                        : code === "CONFLICT"
                          ? "The approved allocation changed. Reload and review the latest revision before approving again."
                          : code === "FORBIDDEN"
                            ? "A service operator with discovery configuration access must approve this allocation."
                            : "Capacity approval failed. Check the fields and your session, then retry.",
                    );
                    return;
                  }
                  const result = z
                    .object({
                      success: z.literal(true),
                      data: capacityRevisionSchema,
                    })
                    .parse(body);
                  setConfiguration((c) => ({
                    revisions: [
                      result.data,
                      ...c.revisions.filter((r) => r.id !== result.data.id),
                    ],
                  }));
                  setApproved(false);
                  request.current = null;
                  setMessage(
                    "Approval recorded for the exact deployed version. Existing runs do not automatically move to this allocation.",
                  );
                } catch {
                  setError(
                    "Capacity approval could not be confirmed. Retry the unchanged form to reconcile the same request.",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <FieldGroup className="gap-5">
              <fieldset className="grid gap-4 sm:grid-cols-2" disabled={busy}>
                {(
                  [
                    ["projectRef", "Trigger project reference", "text"],
                    ["environmentId", "Trigger environment ID", "text"],
                    [
                      "allocationKey",
                      "Allocation UUID (new for each deployment)",
                      "text",
                    ],
                    [
                      "deploymentRef",
                      "Build external ID (deploy --external-id)",
                      "text",
                    ],
                    [
                      "deploymentId",
                      "Native deployment ID (after deployment)",
                      "text",
                    ],
                    [
                      "deploymentVersion",
                      "Native deployed version (after deployment)",
                      "text",
                    ],
                    [
                      "validUntil",
                      "Approval expires at (UTC ISO date and time)",
                      "text",
                    ],
                    ["total", "Approved provider concurrency", "number"],
                    [
                      "pooled",
                      "Concurrency allocated to pooled discovery",
                      "number",
                    ],
                    [
                      "maxObservationAgeMs",
                      "Maximum observation age (milliseconds, 100–30000)",
                      "number",
                    ],
                  ] as const
                ).map(([key, label, type]) => (
                  <Field key={key} className="flex flex-col gap-2">
                    <Label htmlFor={`capacity-${key}`}>{label}</Label>
                    <Input
                      id={`capacity-${key}`}
                      value={draft[key]}
                      type={type}
                      min={type === "number" ? 1 : undefined}
                      step={type === "number" ? 1 : undefined}
                      required
                      onChange={(e) => edit(key, e.target.value)}
                    />
                  </Field>
                ))}
                <Field className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="capacity-evidence">
                    Reviewed provider purchase and allocation evidence
                  </Label>
                  <Textarea
                    id="capacity-evidence"
                    required
                    maxLength={2000}
                    value={draft.providerEvidence}
                    onChange={(e) => edit("providerEvidence", e.target.value)}
                  />
                </Field>
              </fieldset>
              <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
                <p className="text-sm">
                  Prepare the declaration, deploy it under the build external
                  ID, then enter the resulting native deployment ID and version
                  above. Preparing a declaration grants no execution authority.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => edit("allocationKey", crypto.randomUUID())}
                >
                  Generate new allocation UUID
                </Button>{" "}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const parsed = capacityDeclarationSchema
                      .strip()
                      .safeParse(draftPolicy());
                    if (!parsed.success) {
                      setError(
                        "Complete the allocation fields before preparing its declaration. Native deployment ID and version are supplied after deployment.",
                      );
                      return;
                    }
                    setError("");
                    setManifest(
                      JSON.stringify({ policy: parsed.data }, null, 2),
                    );
                  }}
                >
                  Prepare deployment declaration
                </Button>
                {manifest && (
                  <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs">
                    {manifest}
                  </pre>
                )}
              </div>
              <fieldset className="flex flex-col gap-4" disabled={busy}>
                <legend className="mb-3 font-semibold">
                  Reserved allocations
                </legend>
                {allocations.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No reserved allocations. Paid Businesses without a reserved
                    option use the pooled lane.
                  </p>
                )}
                {allocations.map((row, index) => (
                  <div
                    key={row.key}
                    className="flex flex-col gap-4 rounded-xl border border-border p-4"
                  >
                    <h3 className="font-medium">Allocation {index + 1}</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(
                        [
                          ["businessId", "Business ID"],
                          ["offerId", "Subscription offer ID"],
                          ["reservedCapacityId", "Reserved option ID"],
                          ["quantity", "Contract capacity quantity"],
                          ["unit", "Exact contract capacity unit"],
                          [
                            "concurrentRuns",
                            "Allocated concurrent discovery runs",
                          ],
                          [
                            "mappingEvidence",
                            "Reviewed contract-to-concurrency mapping evidence",
                          ],
                        ] as const
                      ).map(([field, label]) => (
                        <Field key={field} className="flex flex-col gap-2">
                          <Label htmlFor={`${row.key}-${field}`}>{label}</Label>
                          <Input
                            id={`${row.key}-${field}`}
                            required
                            type={
                              field === "quantity" || field === "concurrentRuns"
                                ? "number"
                                : "text"
                            }
                            min={
                              field === "quantity" || field === "concurrentRuns"
                                ? 1
                                : undefined
                            }
                            step={
                              field === "quantity" || field === "concurrentRuns"
                                ? 1
                                : undefined
                            }
                            value={row[field]}
                            onChange={(e) =>
                              editAllocation(row.key, field, e.target.value)
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAllocations((rows) =>
                          rows.filter((r) => r.key !== row.key),
                        );
                        setApproved(false);
                        setManifest("");
                      }}
                    >
                      Remove allocation {index + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAllocations((rows) => [
                      ...rows,
                      {
                        key: crypto.randomUUID(),
                        businessId: "",
                        offerId: "",
                        reservedCapacityId: "",
                        quantity: "",
                        unit: "",
                        concurrentRuns: "",
                        mappingEvidence: "",
                      },
                    ]);
                    setApproved(false);
                    setManifest("");
                  }}
                >
                  Add reserved allocation
                </Button>
              </fieldset>
              <p className="text-sm text-muted-foreground">
                When capacity is busy, queued runs wait under the same approved
                budget. Unavailable, stale or changed allocations pause
                execution. Moving reserved work to the pooled lane is
                unsupported. Reapproval and explicit run resume are required
                after a policy change. Capacity does not guarantee leads or
                throughput.
              </p>
              <label className="flex min-h-11 items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={approved}
                  disabled={busy}
                  onCheckedChange={(value) => setApproved(value === true)}
                />
                <span>
                  I reviewed the finite provider capacity, evidence and
                  allocations, and approve this configuration. A new revision
                  stops execution under earlier revisions.
                </span>
              </label>
              <Button disabled={busy || !approved} type="submit">
                {busy
                  ? "Recording approval…"
                  : "Approve capacity configuration"}
              </Button>
            </FieldGroup>
          </form>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}{" "}
                <Link
                  href="/security"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Verify in Security (new tab)
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Approved revisions</h2>
        {!configuration.revisions.length && (
          <p>
            No capacity has been approved. Execution remains unavailable until
            configuration and deployment are verified.
          </p>
        )}
        {configuration.revisions.map((revision, index) => (
          <article
            key={revision.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6"
          >
            <h3 className="font-semibold">
              Revision {revision.version}
              {index === 0 ? " · Current" : " · Historical"}
            </h3>
            <p>
              {revision.policy.total} total concurrent runs ·{" "}
              {revision.policy.pooled} pooled ·{" "}
              {revision.policy.allocations.reduce(
                (n, a) => n + a.concurrentRuns,
                0,
              )}{" "}
              allocated to reservations
            </p>
            <p className="text-sm text-muted-foreground">
              Approved by {revision.actorId} at {revision.at}. Expires{" "}
              {revision.policy.validUntil}.
            </p>
            <p className="break-all text-sm text-muted-foreground">
              Native deployment {revision.policy.deploymentId}, version{" "}
              {revision.policy.deploymentVersion}; environment{" "}
              {revision.policy.environmentId}.
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer py-3">
                Deployment manifest for revision {revision.version}
              </summary>
              <p className="mb-3 text-sm text-muted-foreground">
                The service operator deploys this manifest to the approved
                project and verifies the declared provider and lane limits.
                Saving approval does not activate a deployment.
              </p>
              <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs">
                {JSON.stringify(
                  {
                    policy: capacityDeclarationSchema
                      .strip()
                      .parse(revision.policy),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
