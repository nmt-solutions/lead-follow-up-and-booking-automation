"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  dataWorkspaceSchema,
  type DataWorkspace,
} from "@/models/data-governance";
import { Button, buttonVariants } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
const envelope = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({
    success: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);
export type DataCancellationChoice = {
  id: string;
  status: string;
  timing: string | null;
  access: string | null;
  policy: string | null;
};
export function BusinessDataPanel({
  businessId,
  initial,
  cancellations,
}: {
  businessId: string;
  initial: DataWorkspace;
  cancellations: DataCancellationChoice[];
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [deleteFiles, setDeleteFiles] = useState(false),
    [cancelId, setCancelId] = useState("");
  const [exportPart, setExportPart] = useState(1);
  const key = useRef(crypto.randomUUID()),
    base = `/api/businesses/${businessId}/data`,
    p = state.policy;
  async function json(url: string, input?: unknown) {
    const r = await fetch(url, {
      method: input === undefined ? "GET" : "POST",
      headers:
        input === undefined ? {} : { "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
      cache: "no-store",
    });
    const v = envelope.parse(await r.json());
    if (!v.success) throw new Error(v.message);
    return v.data;
  }
  async function refresh() {
    setState(dataWorkspaceSchema.parse(await json(base)));
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error && e.message.length < 400
          ? e.message
          : "Unable to complete the action. Refresh and review your access and policy.",
      );
      try {
        await refresh();
      } catch {
        /* Keep the form and safe error when current access is unavailable. */
      }
    } finally {
      setBusy(false);
    }
  }
  async function command(command: string, input: unknown) {
    return json(base, { command, input });
  }
  const selected = cancellations.find((c) => c.id === cancelId);
  return (
    <div className="space-y-8" aria-busy={busy}>
      {error && (
        <Alert role="alert">
          {error}{" "}
          <Link className="underline" href="/security">
            Review security
          </Link>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Retained records</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            Export permitted prospects, evidence, conversations, calls and
            immutable financial history. Reach reductions and subscription
            cancellation do not remove agreed retained records.
          </p>
          <p className="text-sm text-muted-foreground">
            The JSON package names its sources, IDs, relations, hashes and
            omissions. Approved source rights and size limits apply. Private
            files use separate downloads; available invoice and credit-note
            attachments are included within the limit.
          </p>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="export-part">Export part</Label>
            <Input
              id="export-part"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000000}
              step={1}
              value={exportPart}
              disabled={busy}
              onChange={(e) => setExportPart(Number(e.target.value))}
            />
            <p className="text-sm text-muted-foreground">
              Each part uses the approved row bound per source. The manifest
              names remaining records. New arrivals can change later parts;
              these packages are not a database snapshot.
            </p>
          </div>
          <Button
            disabled={
              busy ||
              !p ||
              !Number.isInteger(exportPart) ||
              exportPart < 1 ||
              exportPart > 1000000
            }
            onClick={() =>
              run(async () => {
                await command("export", {
                  requestKey: crypto.randomUUID(),
                  part: exportPart,
                });
                setMessage(
                  "Export prepared. Review its coverage before relying on it.",
                );
              })
            }
          >
            {busy ? "Working..." : "Prepare export"}
          </Button>
          {!state.exports.length && (
            <p className="text-sm text-muted-foreground">
              Your prepared exports will appear here. Downloads expire and
              require your current access.
            </p>
          )}
          <ul className="space-y-4">
            {state.exports.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-border p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge>{e.state}</Badge>
                  <span className="text-sm">
                    Part {e.part} - created{" "}
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">
                  Expires {new Date(e.expiresAt).toLocaleString()} -{" "}
                  {e.bytes ?? 0} bytes
                </p>
                {e.state === "deleting" && (
                  <p className="text-sm text-warning">
                    Artifact cleanup: {e.cleanupAttempts} of {e.cleanupLimit}{" "}
                    attempts.{" "}
                    {e.cleanupAttempts >= e.cleanupLimit
                      ? "Automatic attempts exhausted; ask the operator to investigate the private object."
                      : `Next check ${new Date(e.nextCleanupAt).toLocaleString()}.`}
                  </p>
                )}
                {e.sha256 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer">
                      Package verification
                    </summary>
                    <p className="mt-2 font-mono wrap-anywhere">
                      SHA-256 {e.sha256}
                    </p>
                  </details>
                )}
                <Button
                  variant="outline"
                  disabled={busy || e.state !== "ready" || !p}
                  onClick={() =>
                    run(async () => {
                      const grant = z
                        .object({ token: z.string() })
                        .parse(await json(`${base}/${e.id}/access`, {}));
                      const r = await fetch(`${base}/${e.id}/content`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ token: grant.token }),
                        cache: "no-store",
                      });
                      if (!r.ok) {
                        const v = envelope.parse(await r.json());
                        throw new Error(
                          v.success ? "Download unavailable" : v.message,
                        );
                      }
                      const url = URL.createObjectURL(await r.blob()),
                        a = document.createElement("a");
                      a.href = url;
                      a.download = `business-${businessId}-${e.id}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setMessage(
                        "Download prepared. Inspect the manifest for coverage and omissions.",
                      );
                    })
                  }
                >
                  Download export
                </Button>
              </li>
            ))}
          </ul>
          <Link
            href={`/businesses/${businessId}/seller-documents`}
            className="inline-flex min-h-11 items-center text-primary underline"
          >
            View invoices and credit notes
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agreed access and retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!p ? (
            <Alert>
              Production policy is missing, expired or withdrawn. Ask the
              operator to record approved access, source rights, retention,
              legal holds and cancellation terms before exporting or destroying
              affected data.
            </Alert>
          ) : (
            <>
              <p className="font-medium wrap-anywhere">
                {p.id} - version {p.version}
              </p>
              <p className="text-sm">
                Reviewed by {p.reviewedBy}. Effective until{" "}
                {new Date(p.effectiveUntil).toLocaleString()}.
              </p>
              <p>
                Owner/Admin access and current MFA are required. Permitted
                retained records stay available after cancellation. Issued
                financial history and required billing/tax evidence remain
                protected.
              </p>
              {p.deletion ? (
                <p className="text-sm">
                  General-file deletion{" "}
                  {p.deletion.generalFiles
                    ? "permitted with confirmation"
                    : "not approved"}
                  ; earliest {new Date(p.deletion.notBefore).toLocaleString()}.{" "}
                  {p.deletion.holdCount} configured holds. Basis:{" "}
                  {p.deletion.evidence}
                </p>
              ) : (
                <p className="text-sm text-warning">
                  General-file deletion has no approved policy and remains
                  blocked.
                </p>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer">Policy evidence</summary>
                <ul className="mt-2 list-disc pl-5">
                  {p.evidence.map((e) => (
                    <li className="wrap-anywhere" key={e}>
                      {e}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Stop and offboard connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Badge>
            {state.stopped
              ? "Application work stopped"
              : "Application available"}
          </Badge>
          <p>
            Stop discovery, synchronization and automated messages before
            disconnecting native connections. Provider revocation and token
            cleanup have separate recorded outcomes. Messages already committed
            to providers need reconciliation.
          </p>
          <p className="text-sm text-muted-foreground">
            Your Meta account, number and payment account remain under customer
            control. This action does not transfer or delete them, close
            provider billing, refund a payment or erase financial history.
            Microsoft consent removal requires action in the provider account.
          </p>
          <Label
            htmlFor="delete-general"
            className="flex min-h-11 cursor-pointer items-center gap-3"
          >
            <Checkbox
              id="delete-general"
              checked={deleteFiles}
              disabled={busy || !p?.deletion?.generalFiles}
              onCheckedChange={(v) => {
                setDeleteFiles(v === true);
                key.current = crypto.randomUUID();
              }}
            />
            <span>
              Also delete general files allowed by this policy. Protected
              evidence and legal holds are preserved.
            </span>
          </Label>
          <div className="space-y-2">
            <Label htmlFor="cancel-subscription">
              Subscription cancellation
            </Label>
            <NativeSelect
              id="cancel-subscription"
              value={cancelId}
              disabled={busy}
              onChange={(e) => {
                setCancelId(e.target.value);
                key.current = crypto.randomUUID();
              }}
            >
              <option value="">Keep billing unchanged</option>
              {cancellations.map((c) => (
                <option disabled={!c.policy} value={c.id} key={c.id}>
                  {c.status} - {c.id.slice(0, 8)}
                  {c.policy ? `  -  ${c.timing}` : "  -  policy required"}
                </option>
              ))}
            </NativeSelect>
            {selected && (
              <p className="text-sm">
                Request cancellation under {selected.policy}: {selected.timing},
                access {selected.access}. Provider confirmation is required.
                Review the exact terms in{" "}
                <Link
                  className="text-primary underline"
                  href={`/businesses/${businessId}/subscription-payments`}
                >
                  Subscription payments
                </Link>
                .
              </p>
            )}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy || !p || state.stopped}>
                Review offboarding
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>
                Stop this Business&apos;s connections?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Application work stops immediately. General files{" "}
                {deleteFiles
                  ? "will be deleted only under the approved policy and holds"
                  : "are retained"}
                .{" "}
                {selected
                  ? `You also confirm the subscription cancellation request: ${selected.timing}, access ${selected.access}.`
                  : "Subscription billing stays unchanged."}{" "}
                Permitted records and protected invoice/tax evidence remain.
                Provider revocation can remain incomplete and customer assets
                are not transferred.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Go back</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: "outline" })}
                  onClick={() =>
                    run(async () => {
                      await command("offboard", {
                        requestKey: key.current,
                        policyId: p!.id,
                        policyVersion: p!.version,
                        confirmStop: true,
                        deleteGeneralFiles: deleteFiles,
                        cancellation: selected
                          ? {
                              actionId: selected.id,
                              requestKey: key.current,
                              confirmed: true,
                            }
                          : null,
                      });
                      setMessage(
                        "Application work stopped. Review individual provider and cleanup outcomes below.",
                      );
                    })
                  }
                >
                  Stop connections
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
          {state.stopped && (
            <Button
              variant="outline"
              disabled={busy || !p}
              onClick={() =>
                run(async () => {
                  await command("reopen", {
                    requestKey: crypto.randomUUID(),
                    policyId: p!.id,
                    policyVersion: p!.version,
                    confirm: true,
                  });
                  key.current = crypto.randomUUID();
                  setMessage(
                    "New setup is available. Old connections, jobs and approvals remain stopped; reconnect and approve new work explicitly.",
                  );
                })
              }
            >
              Allow new setup
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(refresh)}
          >
            Refresh outcomes
          </Button>
          <ul className="space-y-4">
            {state.offboarding.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border p-4 space-y-3"
              >
                <p className="font-medium">
                  {r.kind === "offboard"
                    ? "Offboarding approved"
                    : "New setup allowed"}{" "}
                  - {new Date(r.createdAt).toLocaleString()}
                </p>
                <p className="text-sm wrap-anywhere">
                  Policy {r.policyId} v{r.policyVersion}
                </p>
                {r.cancellation != null && (
                  <p className="text-sm">
                    Cancellation was selected in this plan. Check Subscription
                    payments for requested, confirmed and effective status.
                  </p>
                )}
                <ul className="space-y-3">
                  {r.steps.map((s) => (
                    <li key={s.id} className="space-y-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          {s.kind.replaceAll("_", " ")}
                        </span>{" "}
                        - {s.state} -{" "}
                        {s.outcome?.replaceAll("_", " ") ?? "awaiting worker"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {s.attempts} attempts - token copy{" "}
                        {s.tokenWiped
                          ? "cleared or not applicable"
                          : "awaiting cleanup"}
                      </p>
                      {s.control && <p className="text-sm">{s.control}</p>}
                      {!!s.history.length && (
                        <details className="text-sm">
                          <summary className="cursor-pointer">
                            Step history and evidence
                          </summary>
                          <ul className="mt-2 space-y-2">
                            {s.history.map((e) => (
                              <li key={e.id} className="wrap-anywhere">
                                {new Date(e.at).toLocaleString()} -{" "}
                                {e.outcome.replaceAll("_", " ")}
                                {e.evidence ? ` - ${e.evidence}` : ""}
                                {e.actorId ? ` - recorded by ${e.actorId}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {s.state === "incomplete" && (
                        <p className="text-sm text-warning">
                          Provider confirmation is incomplete. Review the
                          provider account with the operator; do not assume
                          access was revoked.
                        </p>
                      )}
                      {s.kind !== "file" && s.kind !== "local" && (
                        <form
                          className="space-y-3 rounded-lg bg-muted p-4"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = new FormData(e.currentTarget);
                            void run(async () => {
                              await command("recordEvidence", {
                                stepId: s.id,
                                fact: form.get("fact"),
                                reference: form.get("reference"),
                              });
                              setMessage(
                                "External evidence recorded as your report. Provider confirmation and transfer remain separate.",
                              );
                            });
                          }}
                        >
                          <p className="text-sm">
                            Record an externally completed review or provider
                            action. This report preserves accountability and
                            does not establish native provider confirmation.
                          </p>
                          <Label htmlFor={`fact-${s.id}`}>
                            Completed external action
                          </Label>
                          <NativeSelect
                            id={`fact-${s.id}`}
                            name="fact"
                            disabled={busy}
                          >
                            <option value="external_consent_removal_reported">
                              Provider consent removal reported
                            </option>
                            {s.kind === "meta" && (
                              <>
                                <option value="number_control_reviewed">
                                  Number/account control reviewed
                                </option>
                                <option value="number_transfer_reported">
                                  External number transfer reported
                                </option>
                              </>
                            )}
                          </NativeSelect>
                          <Label htmlFor={`reference-${s.id}`}>
                            Supporting record reference
                          </Label>
                          <Input
                            id={`reference-${s.id}`}
                            name="reference"
                            required
                            maxLength={500}
                            disabled={busy}
                            placeholder="Reviewed support record or document ID"
                          />
                          <p className="text-sm text-muted-foreground">
                            Use a record ID. Keep passwords, bearer values and
                            private links out of this reference.
                          </p>
                          <Button variant="outline" disabled={busy}>
                            Record external evidence
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
