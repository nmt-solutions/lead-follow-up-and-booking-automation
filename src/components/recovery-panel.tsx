"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import type { createRecoveryApplication } from "@/application/infrastructure-recovery";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type Workspace = Awaited<
  ReturnType<ReturnType<typeof createRecoveryApplication<Headers>>["workspace"]>
>;
const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const stageLabels: Record<string, string> = {
  requested: "Requested",
  target_verified: "Disposable target verified",
  restored: "Schema and data restored",
  secured: "Restricted security verified",
  verified: "Application records verified",
  quarantined: "File coverage recorded; work quarantined",
  reconciled: "Native outcomes reviewed",
  inspection_ready: "Recovered for private inspection",
};
export function RecoveryPanel({
  state,
  canReconcileCosts,
}: {
  state: Workspace;
  canReconcileCosts: boolean;
}) {
  const router = useRouter(),
    keys = useRef(new Map<string, string>()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function command(path: string, input: unknown) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/platform/recovery/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        result = responseSchema.parse(await response.json());
      if (!result.success) {
        setError(
          result.code === "MFA_REQUIRED"
            ? "Verify your current session in Security, then retry this same operation."
            : result.code === "FORBIDDEN"
              ? "Your current recovery or cost authority is unavailable. Ask the responsible operator to review access."
              : "The operation is incomplete. Review its saved stage, current configuration and worker history, then retry the same operation.",
        );
        return;
      }
      setMessage(
        path === "costs"
          ? "Selected cost evidence reconciled. Unpriced usage remains unpriced."
          : "Recovery request saved. The dedicated worker will recheck its exact target and current authority.",
      );
      router.refresh();
    } catch {
      setError(
        "The response could not be confirmed. Refresh history before retrying; the original request identity is retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6" aria-busy={busy}>
      {state.setupIssues.map((issue) => (
        <Alert key={issue} variant="destructive">
          {issue}
        </Alert>
      ))}
      <Alert>
        Restored state stays private and external work stays disabled. A
        successful local drill does not verify production deployment or
        guarantee a recovery time.
      </Alert>
      {error && (
        <Alert variant="destructive" role="alert">
          {error}{" "}
          <Link href="/security" className="underline">
            Open Security
          </Link>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-success">
          {message}
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => router.refresh()}
      >
        Refresh recovery evidence
      </Button>
      {!state.plans.length && (
        <Card>
          <CardHeader>
            <CardTitle>No reviewed recovery plan</CardTitle>
          </CardHeader>
          <CardContent>
            <p>
              Ask the infrastructure owner to review the isolated source and
              target identities, schema bundle, actual backup cutoff, retained
              file copies, objectives and costs. Configure the dedicated worker
              before requesting a drill.
            </p>
          </CardContent>
        </Card>
      )}
      {state.readiness.map((r) => (
        <Card key={r.planId}>
          <CardHeader>
            <CardTitle>Environment evidence</CardTitle>
            <Badge>
              {r.fresh
                ? "Current reviewed observation"
                : "Observation missing or stale"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {[r.vercel, r.neon, r.trigger, r.r2].map((s, i) => (
              <div key={i}>
                <p className="font-medium">
                  {["Vercel", "Neon", "Trigger", "Private R2"][i]} ·{" "}
                  {s.status.replaceAll("_", " ")}
                </p>
                <p className="text-sm text-muted-foreground">{s.next}</p>
              </div>
            ))}
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {r.launchGates.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {state.plans.map((plan) => (
        <Card key={plan.id}>
          <CardHeader>
            <CardTitle>Business recovery plan</CardTitle>
            <p className="break-all text-sm text-muted-foreground">
              Business {plan.businessId} · {plan.mode} · review{" "}
              {plan.reviewedId}
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  Frozen backup cutoff
                </dt>
                <dd>{plan.cutoff}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Reviewed recovery objectives
                </dt>
                <dd>
                  Point loss objective {plan.objectives.rpoSeconds}s · time
                  objective {plan.objectives.rtoSeconds}s
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Selected retention
                </dt>
                <dd>
                  Backup {plan.objectives.backupRetentionSeconds}s · files{" "}
                  {plan.objectives.fileRetentionSeconds}s
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  File limits and coverage
                </dt>
                <dd>
                  {plan.files.filter((f) => f.retained).length} retained copies
                  of {plan.files.length} selected files; {plan.limits.fileBytes}{" "}
                  bytes per file, {plan.limits.totalFileBytes} bytes total
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  Backup and temporary restore limits
                </dt>
                <dd>
                  {plan.limits.backupBytes} backup bytes;{" "}
                  {plan.limits.restoreSqlBytes} bytes for the temporary restore
                  file
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              Objectives are reviewed inputs. Only completed stage evidence
              establishes an observed result. R2 is selected for the US
              jurisdiction; its location hint does not establish a state.
            </p>
            <details>
              <summary className="cursor-pointer font-medium">
                Reviewed source, target and bundle
              </summary>
              <dl className="mt-3 space-y-3 break-all text-sm">
                <div>
                  <dt className="font-medium">Source</dt>
                  <dd>
                    {plan.source.project} / {plan.source.branch} /{" "}
                    {plan.source.database}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Disposable target</dt>
                  <dd>
                    {plan.target.project} / {plan.target.branch} /{" "}
                    {plan.target.database}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Backup identity and SHA-256</dt>
                  <dd>
                    {plan.backupId} · {plan.backupHash}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">
                    Reviewed schema/recovery bundle
                  </dt>
                  <dd>{plan.schemaHash}</dd>
                </div>
                <div>
                  <dt className="font-medium">Reviewed target schema shape</dt>
                  <dd>{plan.appliedSchemaHash}</dd>
                </div>
                <div>
                  <dt className="font-medium">
                    Frozen environment observation
                  </dt>
                  <dd>{plan.inventoryHash}</dd>
                </div>
              </dl>
            </details>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={
                    busy ||
                    !state.configured ||
                    state.operations.some((op) => op.plan.id === plan.id)
                  }
                >
                  Start isolated recovery
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Restore this reviewed Business snapshot?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The worker accepts only the frozen backup and schema bundle
                  for this plan. It verifies the expressly disposable target
                  before restoring. Source data stays intact; restored sessions,
                  credentials and queued effects remain quarantined.
                </AlertDialogDescription>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={() => {
                    let key = keys.current.get(plan.id);
                    if (!key) {
                      key = crypto.randomUUID();
                      keys.current.set(plan.id, key);
                    }
                    void command("request", {
                      planId: plan.id,
                      requestKey: key,
                    });
                  }}
                >
                  Start isolated recovery
                </AlertDialogAction>
              </AlertDialogContent>
            </AlertDialog>
            <details>
              <summary className="cursor-pointer font-medium">
                Service and retention cost evidence
              </summary>
              <ul className="mt-3 space-y-2 text-sm">
                {plan.costs.map((c) => (
                  <li key={c.id} className="break-words">
                    {c.provider} · {c.kind} · {c.basis.replaceAll("_", " ")} ·{" "}
                    {c.status} · {c.quantity} {c.unit} ·{" "}
                    {c.micros === null
                      ? "Unpriced"
                      : `${c.micros} micros ${c.currency}`}{" "}
                    · {c.evidence}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">
                Shared commitments, observed requests and billed charges retain
                separate stable identities and original currencies.
              </p>

              {state.operations.some((op) => op.plan.id === plan.id) && (
                <p className="text-sm text-muted-foreground">
                  This reviewed plan already has a saved operation. Resume it in
                  the history below.
                </p>
              )}
              {canReconcileCosts && (
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void command("costs", { planId: plan.id })}
                >
                  Reconcile selected costs
                </Button>
              )}
            </details>
          </CardContent>
        </Card>
      ))}
      {state.operations.map((op) => {
        const verified = op.events.find(
          (e) => e.stage === "verified" && e.outcome === "completed",
        );
        const observedSeconds = verified
          ? Math.max(
              0,
              (new Date(verified.at).getTime() - new Date(op.at).getTime()) /
                1000,
            )
          : null;
        return (
          <Card key={op.id}>
            <CardHeader>
              <CardTitle>{stageLabels[op.stage]}</CardTitle>
              <p className="break-all text-sm text-muted-foreground">
                Operation {op.id} · requested by {op.actorId}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                {observedSeconds === null
                  ? "Restoration has not established verified application records."
                  : `Observed request-to-verification time: ${observedSeconds}s. Snapshot cutoff: ${op.plan.cutoff}.`}
              </p>
              <p className="text-sm">
                External effects remain disabled. Current native facts and
                target access require their own authority; stale sessions and
                prior sender approvals grant no access.
              </p>
              {op.stage !== "inspection_ready" && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void command("resume", {
                      businessId: op.businessId,
                      operationId: op.id,
                    })
                  }
                >
                  Resume this recovery
                </Button>
              )}
              <details>
                <summary className="cursor-pointer font-medium">
                  Stage evidence and unresolved work
                </summary>
                <ol className="mt-4 space-y-4">
                  {op.events.map((e, i) => (
                    <li key={i} className="space-y-2">
                      <p className="font-medium">
                        {stageLabels[e.stage]} · {e.outcome}
                      </p>
                      <p className="text-sm text-muted-foreground">{e.at}</p>
                      {e.evidence.incurredStage && (
                        <p className="text-sm">
                          Verified incurred result:{" "}
                          {stageLabels[e.evidence.incurredStage]}. This fact
                          preserves the original attempt; it does not advance
                          the operation. Current authority is required to
                          continue.
                        </p>
                      )}
                      {e.evidence.unresolved?.map((u) => (
                        <p key={u} className="text-sm">
                          {u}
                        </p>
                      ))}
                      {e.evidence.files?.map((f) => (
                        <p key={f.id} className="break-all text-sm">
                          {f.id}: {f.status} · {f.bytes} bytes · SHA-256{" "}
                          {f.hash}
                        </p>
                      ))}
                      {e.evidence.facts && (
                        <p className="text-sm">
                          {e.evidence.facts.length} application record
                          identities and source hashes verified.
                        </p>
                      )}
                      {e.evidence.native?.map((n) => (
                        <p
                          key={`${n.source}:${n.id}`}
                          className="break-all text-sm"
                        >
                          {n.source} {n.id}: {n.outcome} ·{" "}
                          {n.status ?? "unresolved native status"} · native{" "}
                          {n.nativeId ?? "unresolved"} ·{" "}
                          {n.amountMinor ?? "unknown"} {n.currency ?? ""} minor
                          units in the native record; acceptance is separate
                          from a completed money effect
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
              </details>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
