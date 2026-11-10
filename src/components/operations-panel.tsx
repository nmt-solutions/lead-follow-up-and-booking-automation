"use client";
import { WorkspaceTabs } from "./workspace-tabs";
import { FieldGroup } from "./ui/field";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  operationWorkspaceSchema,
  recoveryResultSchema,
  diagnosticRetentionSchema,
  type OperationWorkspace,
  type RecoveryCommand,
} from "@/models/operations";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
class OperationsFormError extends Error {}
const diagnosticsSchema = z.array(
  z.object({
    id: z.uuid(),
    eventId: z.uuid(),
    kind: z.enum(["audit", "diagnostic"]),
    requestId: z.uuid(),
    code: z.string().regex(/^[A-Z_]{1,80}$/),
    expiresAt: z.string(),
  }),
);
const groups = [
  {
    id: "actions",
    label: "Actions",
    sources: [
      "action",
      "appointment",
      "payment",
      "document",
      "approval",
      "authority",
      "ownership",
    ],
  },
  { id: "runs", label: "Runs", sources: ["discovery", "sequence", "inquiry"] },
  { id: "queue", label: "Queue", sources: ["queue", "sequence_action"] },
  {
    id: "channels",
    label: "Channels",
    sources: [
      "mailbox",
      "mailbox_scope",
      "whatsapp",
      "whatsapp_intake",
      "whatsapp_action_history",
      "channel_observation",
    ],
  },
  { id: "health", label: "Health", sources: ["sender_health"] },
];
const outcomeMessages: Record<string, string> = {
  queued:
    "Existing work was queued. The worker will recheck current authorization and limits.",
  checked:
    "Evidence was checked. Review the recorded state; this does not establish sending, delivery or booking unless the source confirms it.",
  escalated:
    "An attributable escalation is available in the responsible Business and operator queues.",
  unavailable:
    "Recovery is unavailable with the current provider or worker configuration. Review the source and next action.",
  blocked:
    "Recovery was blocked. Review the source and current authority, ownership and limits.",
  reconciliation_required:
    "The recovery outcome is unresolved. Inspect the source before requesting further work.",
  acknowledged_in_app:
    "Acknowledged in the app. The underlying failure remains until its source is repaired.",
};

export function OperationsPanel({
  initialState,
  businessId,
}: {
  initialState: OperationWorkspace;
  businessId?: string;
}) {
  const [state, setState] = useState(initialState),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recovery, setRecovery] = useState("");
  const [diagnostics, setDiagnostics] = useState<z.infer<
    typeof diagnosticsSchema
  > | null>(null);
  const keys = useRef(new Map<string, string>());
  const base = state.operator
    ? "/api/platform/operations"
    : `/api/businesses/${businessId}/operations`;
  const commandBase = (b: string) => (state.operator ? `${base}/${b}` : base);
  async function request(url: string, input?: unknown) {
    const response = await fetch(
      url,
      input === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          },
    );
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new OperationsFormError(
        "The response could not be verified. Refresh the source before another recovery request.",
      );
    if (!parsed.data.success || !response.ok) {
      const code = parsed.data.success ? "" : parsed.data.code;
      setRecovery(
        code === "MFA_REQUIRED"
          ? "/security"
          : code === "UNAUTHENTICATED"
            ? "/sign-in"
            : "",
      );
      throw new OperationsFormError(
        code === "MFA_REQUIRED"
          ? "Verify your authenticator in Security, then retry. Your entries are preserved."
          : code === "UNAUTHENTICATED"
            ? "Sign in again, then retry. Your entries are preserved."
            : "This command could not complete. Review your current access, source state and domain requirements.",
      );
    }
    return parsed.data.data;
  }
  async function refresh(before?: number) {
    const fresh = operationWorkspaceSchema.parse(
      await request(`${base}${before ? `?before=${before}` : ""}`),
    );
    setState((previous) =>
      before
        ? {
            ...fresh,
            history: [
              ...previous.history,
              ...fresh.history.filter(
                (e) => !previous.history.some((p) => p.id === e.id),
              ),
            ],
          }
        : fresh,
    );
  }
  async function perform(key: string, operation: () => Promise<void>) {
    setBusy(key);
    setError("");
    setNotice("");
    setRecovery("");
    try {
      await operation();
    } catch (caught: unknown) {
      setError(
        caught instanceof OperationsFormError
          ? caught.message
          : "The action could not complete. Review the source.",
      );
    } finally {
      setBusy("");
    }
  }
  async function recover(
    row: OperationWorkspace["resources"][number],
    action: RecoveryCommand["action"],
  ) {
    const key = `${row.source}:${row.id}:${action}`;
    await perform(key, async () => {
      const requestKey = keys.current.get(key) ?? crypto.randomUUID();
      keys.current.set(key, requestKey);
      const result = recoveryResultSchema.parse(
        await request(commandBase(row.businessId), {
          source: row.source,
          targetId: row.id,
          action,
          requestKey,
        }),
      );
      keys.current.delete(key);
      setNotice(
        outcomeMessages[result.outcome] ??
          "Request recorded. Inspect its source before further recovery.",
      );
      await refresh();
    });
  }
  async function retention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform("retention", async () => {
      const input = diagnosticRetentionSchema.safeParse({
        expectedVersion: state.retention?.version ?? 0,
        diagnosticSeconds: Number(form.get("diagnosticSeconds")),
        auditDetailSeconds: Number(form.get("auditDetailSeconds")),
        evidenceRef: form.get("evidenceRef"),
        confirmPolicy: form.get("confirmPolicy") === "on",
      });
      if (!input.success)
        throw new OperationsFormError(
          "Enter positive retention periods, the authorized policy evidence reference and confirm the reviewed policy.",
        );
      await request(`${base}/retention`, input.data);
      await refresh();
      setNotice(
        "The explicit retention policy was recorded. New details use this version; existing protected history keeps its original policy.",
      );
    });
  }
  return (
    <div className="flex flex-col gap-8" aria-busy={Boolean(busy)}>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          disabled={Boolean(busy)}
          onClick={() => perform("refresh", () => refresh())}
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh recorded state"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Recovery rechecks current domain requirements. Source records
          distinguish acceptance, delivery and confirmed outcomes.
        </p>
      </div>
      {error && (
        <Alert role="alert">
          <p>{error}</p>
          {recovery && (
            <Link
              className="inline-flex min-h-11 items-center text-primary underline"
              href={recovery}
              target="_blank"
              rel="noreferrer noopener"
            >
              Restore access in a new tab
            </Link>
          )}
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <WorkspaceTabs
        label="Activity and fixes sections"
        tabs={[
          {
            id: "activity",
            label: "Work and next actions",
            description:
              "Start with work that needs attention. Review its status before retrying an action.",
            content: (
              <>
                <section
                  aria-labelledby="operation-alerts"
                  className="flex flex-col gap-4"
                >
                  <h2 id="operation-alerts" className="text-xl font-semibold">
                    Needs your attention
                  </h2>
                  {!state.notifications.some((n) => !n.resolved) && (
                    <p className="text-muted-foreground">
                      No unresolved alerts in the recent observations. Missing
                      telemetry does not establish provider health.
                    </p>
                  )}
                  {state.notifications
                    .filter((n) => !n.resolved)
                    .map((n) => (
                      <Card key={n.id}>
                        <CardContent className="flex flex-col gap-3 pt-6">
                          <p className="font-medium">
                            {n.source.replaceAll("_", " ")} ·{" "}
                            {n.delivery === "available_in_app"
                              ? "Available in app"
                              : "Acknowledged in app"}
                          </p>
                          <p className="text-sm wrap-anywhere text-muted-foreground">
                            Business {n.businessId} · Responsible person{" "}
                            {n.responsibleUserId ??
                              "unassigned; ask the Business Owner or relevant operator"}
                          </p>
                          <p>{n.nextAction}</p>
                          {n.delivery === "available_in_app" && (
                            <Button
                              variant="outline"
                              disabled={Boolean(busy)}
                              onClick={() =>
                                perform(n.id, async () => {
                                  await request(
                                    `${commandBase(n.businessId)}/acknowledge`,
                                    {
                                      eventId: n.id,
                                      requestKey: crypto.randomUUID(),
                                    },
                                  );
                                  await refresh();
                                  setNotice(
                                    outcomeMessages.acknowledged_in_app,
                                  );
                                })
                              }
                            >
                              {busy === n.id
                                ? "Acknowledging…"
                                : "Acknowledge in app"}
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </section>
                <Tabs defaultValue="actions">
                  <TabsList
                    aria-label={
                      state.operator
                        ? "Operator views"
                        : "Business action views"
                    }
                  >
                    {groups.map((g) => (
                      <TabsTrigger value={g.id} key={g.id}>
                        {g.label}
                      </TabsTrigger>
                    ))}
                    <TabsTrigger value="history">History</TabsTrigger>
                  </TabsList>
                  {groups.map((g) => (
                    <TabsContent
                      value={g.id}
                      key={g.id}
                      className="flex flex-col gap-4"
                    >
                      <h2 className="text-xl font-semibold">{g.label}</h2>
                      {!state.resources.some((r) =>
                        g.sources.includes(r.source),
                      ) && (
                        <p className="text-muted-foreground">
                          No recorded {g.label.toLowerCase()} in this scope.
                          Configure the real connection or workflow before
                          expecting observations.
                        </p>
                      )}
                      {state.resources
                        .filter((r) => g.sources.includes(r.source))
                        .map((row) => (
                          <Card key={`${row.source}:${row.id}`}>
                            <CardHeader>
                              <CardTitle className="flex flex-wrap items-center gap-3">
                                {row.source.replaceAll("_", " ")}
                                <Badge>{row.status.replaceAll("_", " ")}</Badge>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-4">
                              <p className="text-sm wrap-anywhere text-muted-foreground">
                                Business {row.businessId} · Responsible person{" "}
                                {row.responsibleUserId ?? "unassigned"}
                              </p>
                              {row.reason && (
                                <p className="font-medium">
                                  Source reason:{" "}
                                  {row.reason.replaceAll("_", " ")}
                                </p>
                              )}
                              {row.handoff && (
                                <p>Handoff: {row.handoff.reason}</p>
                              )}
                              <p>{row.nextAction}</p>
                              <div className="flex flex-wrap items-center gap-3">
                                <Link
                                  className="inline-flex min-h-11 items-center text-primary underline"
                                  href={row.href}
                                >
                                  Review attributed source
                                </Link>
                                {row.controls.map((action) => (
                                  <Button
                                    variant="outline"
                                    disabled={Boolean(busy)}
                                    key={action}
                                    onClick={() => recover(row, action)}
                                  >
                                    {busy ===
                                    `${row.source}:${row.id}:${action}`
                                      ? "Checking…"
                                      : action === "retry"
                                        ? row.source === "discovery"
                                          ? "Resume unfinished discovery"
                                          : "Queue existing work"
                                        : action === "reconcile"
                                          ? "Check exact evidence"
                                          : "Escalate to owner"}
                                  </Button>
                                ))}
                              </div>
                              <details>
                                <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
                                  Why this action is available
                                </summary>
                                <dl className="grid gap-2 text-sm sm:grid-cols-[minmax(8rem,1fr)_2fr]">
                                  <dt>Source record</dt>
                                  <dd className="wrap-anywhere">
                                    {row.source} / {row.id}
                                  </dd>
                                  <dt>Source time</dt>
                                  <dd>{row.sourceAt ?? "Unavailable"}</dd>
                                  <dt>Observation time</dt>
                                  <dd>{row.observedAt}</dd>
                                  {Object.entries(row.context).map(
                                    ([key, value]) => (
                                      <div key={key} className="contents">
                                        <dt className="wrap-anywhere text-muted-foreground">
                                          {key}
                                        </dt>
                                        <dd className="wrap-anywhere">
                                          {value === null
                                            ? "Unavailable"
                                            : String(value)}
                                        </dd>
                                      </div>
                                    ),
                                  )}
                                </dl>
                              </details>
                            </CardContent>
                          </Card>
                        ))}
                    </TabsContent>
                  ))}
                  <TabsContent value="history" className="flex flex-col gap-4">
                    <h2 className="text-xl font-semibold">Change history</h2>
                    <p className="text-sm text-muted-foreground">
                      Observations are separate from requested commands and
                      confirmed recovery outcomes. Earlier financial and
                      document records remain with their protected source.
                    </p>
                    {!state.history.length && (
                      <p>No actions have been observed in this scope.</p>
                    )}
                    <ol className="flex flex-col gap-3">
                      {state.history.map((e) => (
                        <li
                          key={e.id}
                          className="rounded-xl border border-border bg-card p-4"
                        >
                          <p>
                            {e.source.replaceAll("_", " ")} · {e.action} ·{" "}
                            {e.outcome}
                          </p>
                          <p className="mt-2 text-sm wrap-anywhere text-muted-foreground">
                            {e.at} · Actor {e.actorId ?? "source observation"} ·{" "}
                            {e.targetId}
                          </p>
                          <p className="mt-2 text-sm">
                            Recorded {e.status.replaceAll("_", " ")}
                            {e.reason
                              ? ` · ${e.reason.replaceAll("_", " ")}`
                              : ""}
                          </p>
                          <details className="mt-2 text-sm">
                            <summary className="min-h-11 cursor-pointer py-3 font-medium">
                              Previous approvals and retries
                            </summary>
                            <dl className="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_2fr]">
                              <dt>Source time</dt>
                              <dd>{e.sourceAt ?? "Unavailable"}</dd>
                              <dt>Responsible person</dt>
                              <dd className="wrap-anywhere">
                                {e.responsibleUserId ?? "Unassigned"}
                              </dd>
                              <dt>Recovery request</dt>
                              <dd className="wrap-anywhere">
                                {e.requestKey ?? "Source observation"}
                              </dd>
                              {Object.entries(e.context).map(([key, value]) => (
                                <div key={key} className="contents">
                                  <dt className="wrap-anywhere text-muted-foreground">
                                    {key}
                                  </dt>
                                  <dd className="wrap-anywhere">
                                    {value === null
                                      ? "Unavailable"
                                      : String(value)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        </li>
                      ))}
                    </ol>
                    {state.nextHistoryBefore && (
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          perform("history", () =>
                            refresh(state.nextHistoryBefore ?? undefined),
                          )
                        }
                      >
                        {busy === "history"
                          ? "Loading…"
                          : "Load earlier history"}
                      </Button>
                    )}
                  </TabsContent>
                </Tabs>
              </>
            ),
          },
          {
            id: "details",
            label: "Service details",
            description:
              "Check service availability and the recorded information used to investigate a problem.",
            content: (
              <>
                {state.operator && (
                  <section
                    aria-labelledby="diagnostic-policy"
                    className="flex flex-col gap-4"
                  >
                    <h2
                      id="diagnostic-policy"
                      className="text-xl font-semibold"
                    >
                      Diagnostics and retention
                    </h2>
                    <p className="text-muted-foreground">
                      Configure authorized periods explicitly. Expiry cleanup
                      removes only optional diagnostic and audit details;
                      identity, takeover, financial and document history remain
                      protected.
                    </p>
                    <Card>
                      <CardContent className="pt-6">
                        <form
                          onSubmit={retention}
                          className="flex flex-col gap-4"
                        >
                          <FieldGroup className="gap-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <Label htmlFor="diagnostic-seconds">
                                  Diagnostic retention (seconds)
                                </Label>
                                <Input
                                  id="diagnostic-seconds"
                                  name="diagnosticSeconds"
                                  type="number"
                                  min="1"
                                  step="1"
                                  required
                                  defaultValue={
                                    state.retention?.diagnosticSeconds ?? ""
                                  }
                                />
                              </div>
                              <div>
                                <Label htmlFor="audit-seconds">
                                  Audit detail retention (seconds)
                                </Label>
                                <Input
                                  id="audit-seconds"
                                  name="auditDetailSeconds"
                                  type="number"
                                  min="1"
                                  step="1"
                                  required
                                  defaultValue={
                                    state.retention?.auditDetailSeconds ?? ""
                                  }
                                />
                              </div>
                            </div>
                            <Label htmlFor="policy-evidence">
                              Authorized policy evidence reference
                            </Label>
                            <Input
                              id="policy-evidence"
                              name="evidenceRef"
                              required
                              autoComplete="off"
                              defaultValue={state.retention?.evidenceRef ?? ""}
                            />
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id="confirm-retention"
                                name="confirmPolicy"
                                required
                              />
                              <Label htmlFor="confirm-retention">
                                I reviewed the authorized diagnostic and audit
                                detail retention policy.
                              </Label>
                            </div>
                            <Button disabled={Boolean(busy)}>
                              {busy === "retention"
                                ? "Saving…"
                                : "Record reviewed policy"}
                            </Button>
                          </FieldGroup>
                        </form>
                      </CardContent>
                    </Card>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          perform("diagnostics", async () => {
                            setDiagnostics(
                              diagnosticsSchema.parse(
                                await request(`${base}/diagnostics`),
                              ),
                            );
                          })
                        }
                      >
                        Inspect safe diagnostics
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={Boolean(busy)}>
                            Delete expired details
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <div className="flex flex-col gap-3">
                            <AlertDialogTitle>
                              Delete expired diagnostic details?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Only details whose saved expiry has passed on the
                              database clock are removed. Action identity,
                              financial, document and essential ownership
                              history remain.
                            </AlertDialogDescription>
                          </div>
                          <div className="flex flex-wrap justify-end gap-3">
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="border border-input bg-card text-destructive hover:bg-muted active:bg-muted"
                              onClick={() =>
                                perform("prune", async () => {
                                  const result = z
                                    .object({ deleted: z.number() })
                                    .parse(await request(`${base}/prune`, {}));
                                  setDiagnostics(null);
                                  setNotice(
                                    `${result.deleted} expired details deleted.`,
                                  );
                                })
                              }
                            >
                              Delete expired details
                            </AlertDialogAction>
                          </div>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {diagnostics && (
                      <ul className="flex flex-col gap-2">
                        {diagnostics.length === 0 && (
                          <li>
                            No unexpired diagnostic details are available under
                            the configured policy.
                          </li>
                        )}
                        {diagnostics.map((d) => (
                          <li
                            key={d.id}
                            className="rounded-lg border border-border p-4 text-sm wrap-anywhere"
                          >
                            {d.code} · {d.kind} · Request {d.requestId} ·
                            Expires {d.expiresAt}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    Service status and logs
                  </summary>
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    {state.unavailable.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {state.providerLogs.map((link) => (
                    <a
                      className="mr-5 inline-flex min-h-11 items-center text-primary underline"
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {link.label}
                    </a>
                  ))}
                </details>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
