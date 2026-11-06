"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  senderConnectionSchema,
  senderIdentitySchema,
  replyRouteSchema,
  senderSaveSchema,
  senderWorkspaceSchema,
  senderCheckNames,
  senderUseSchema,
  type SenderWorkspace,
  type SenderUse,
} from "@/models/senders";
import { senderCheckLabels } from "@/senders/readiness";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";

const useLabels: Record<SenderUse, string> = {
  first_contact: "First-contact prospecting",
  trial: "Approved trial",
  inbound: "Incoming inquiries",
  existing_conversation: "Existing conversations",
};
const providers = {
  gmail: "Google mailbox",
  microsoft: "Microsoft mailbox",
  customer_domain: "Customer-domain delivery (transport required)",
  service_provided: "Service-provided address (approval required)",
};
const origins = {
  customer_mailbox: "Customer-controlled mailbox",
  customer_domain: "Customer sending domain",
  service_provided: "Service-provided address",
};
const purposes = {
  dedicated_outreach: "Dedicated outreach",
  ordinary_sales: "Ordinary sales",
};
class SenderFormError extends Error {}
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
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
function Enabled({ prefix, value }: { prefix: string; value: boolean }) {
  return (
    <label
      className="flex min-h-11 items-center gap-3"
      htmlFor={`${prefix}-enabled`}
    >
      <input
        id={`${prefix}-enabled`}
        name="enabled"
        type="checkbox"
        defaultChecked={value}
        className="size-5 accent-primary"
      />
      Enabled for readiness evaluation
    </label>
  );
}
function read(form: FormData, name: string) {
  return String(form.get(name) ?? "");
}

export function SenderManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: SenderWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const [feedbackPath, setFeedbackPath] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [identityId, setIdentityId] = useState("");
  const base = `/api/businesses/${businessId}/senders`;
  const connection = state.connections.find((row) => row.id === connectionId);
  const route = state.replyRoutes.find((row) => row.id === routeId);
  const identity = state.identities.find((row) => row.id === identityId);
  async function responseData(response: Response): Promise<unknown> {
    const raw: unknown = await response.json();
    if (!response.ok) {
      const failure = z.object({ code: z.string() }).safeParse(raw);
      const code = failure.success ? failure.data.code : "";
      setRecovery(
        code === "MFA_REQUIRED"
          ? "/security"
          : code === "UNAUTHENTICATED"
            ? "/sign-in"
            : "",
      );
      throw new SenderFormError(
        code === "CONFLICT"
          ? "Setup changed in another session or this reply inbox already has a sender. Refresh status, review your changes and save again."
          : code === "CHANNEL_SETUP_REQUIRED"
            ? "Mail integration is not configured. Settings are saved, but sending and reply capture remain unavailable. Ask the operator to complete the selected connection."
            : code === "MFA_REQUIRED"
              ? "Verify your authenticator in Security, then retry. Your form is preserved."
              : code === "UNAUTHENTICATED"
                ? "Sign in again, then retry. Your form is preserved."
                : code === "FORBIDDEN"
                  ? "An Owner or Admin must manage sending identities."
                  : "The request could not be completed. Check the fields, refresh status and retry.",
      );
    }
    const envelope = z
      .object({ success: z.literal(true), data: z.unknown() })
      .safeParse(raw);
    if (!envelope.success)
      throw new SenderFormError(
        "The setup response could not be read. Refresh status and retry.",
      );
    return envelope.data.data;
  }
  async function command(path?: string, input?: unknown) {
    if (pending) return;
    setFeedbackPath(path ?? null);
    setPending(true);
    setError("");
    setMessage("");
    setRecovery("");
    try {
      let savedId: string | null = null;
      if (path) {
        const saved = await responseData(
          await fetch(`${base}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          }),
        );
        if (["connections", "reply-routes", "identities"].includes(path)) {
          const result = z.object({ id: z.uuid() }).safeParse(saved);
          if (!result.success)
            throw new SenderFormError(
              "The saved settings could not be read. Refresh status and retry.",
            );
          savedId = result.data.id;
        }
      }
      const data = await responseData(await fetch(base, { cache: "no-store" }));
      const parsed = senderWorkspaceSchema.safeParse(data);
      if (!parsed.success)
        throw new SenderFormError(
          "The setup response could not be read. Refresh status and retry.",
        );
      setState(parsed.data);
      if (savedId && path === "connections") setConnectionId(savedId);
      if (savedId && path === "reply-routes") setRouteId(savedId);
      if (savedId && path === "identities") setIdentityId(savedId);
      setMessage(
        path?.endsWith("/check")
          ? "Connection check recorded. Review each intended use and any remaining setup steps below."
          : path
            ? "Settings saved. Refresh connection checks before using this identity."
            : "Status refreshed.",
      );
    } catch (failure: unknown) {
      setError(
        failure instanceof SenderFormError
          ? failure.message
          : "Setup could not be updated. Retry shortly.",
      );
    } finally {
      setPending(false);
    }
  }
  async function save<T>(
    event: FormEvent<HTMLFormElement>,
    schema: z.ZodType<T>,
    path: string,
    input: (form: FormData) => unknown,
  ) {
    event.preventDefault();
    const parsed = schema.safeParse(input(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setFeedbackPath(path);
      setRecovery("");
      setError(
        "Check required fields and selections. Use a valid email address and select at least one intended use.",
      );
      setMessage("");
      return;
    }
    await command(path, parsed.data);
  }
  function feedback(path: string | null) {
    if (feedbackPath !== path || (!pending && !error && !message)) return null;
    return (
      <div className="space-y-3">
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            Updating setup…
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            {error}
            {recovery && (
              <>
                {" "}
                <Link
                  href={recovery}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center underline"
                >
                  Open {recovery === "/security" ? "Security" : "sign in"} (new
                  tab)
                </Link>
              </>
            )}
          </Alert>
        )}
        {message && (
          <p
            role="status"
            className="rounded-lg border border-border bg-card p-4 text-sm"
          >
            {message}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-8" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          First contact requires a working customer-controlled dedicated
          outreach identity. Service-provided addresses are restricted to
          explicitly approved uses. Sender capability is separate from recipient
          eligibility and outreach approval.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void command()}
        >
          {pending ? "Updating…" : "Refresh status"}
        </Button>
      </div>
      {feedback(null)}
      {!state.canManage && (
        <p className="text-sm text-muted-foreground">
          You can review status. Ask an Owner or Admin to change setup or check
          connections.
        </p>
      )}
      <section className="space-y-4" aria-labelledby="sender-status-title">
        <h2 id="sender-status-title" className="text-xl font-semibold">
          Sending and reply readiness
        </h2>
        {!state.identities.length && (
          <Card>
            <CardContent className="pt-6">
              <p>
                No sending identities yet. Save a connection, add a reply route
                and configure a dedicated outreach or ordinary sales identity
                below.
              </p>
            </CardContent>
          </Card>
        )}
        {state.identities.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="wrap-anywhere">
                    {row.identification.fromName}
                  </CardTitle>
                  <p className="mt-2 wrap-anywhere text-sm text-muted-foreground">
                    {row.configuration.fromAddress} ·{" "}
                    {purposes[row.configuration.purpose]} ·{" "}
                    {origins[row.configuration.origin]}
                  </p>
                </div>
                <Badge>
                  {row.readiness.mode === "fixture"
                    ? "Deterministic fixture only"
                    : row.readiness.ready
                      ? "Setup checks passed"
                      : "Not ready"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm">
                Identification: {row.identification.platformDisclosure}
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {senderUseSchema.options.map((use) => (
                  <div key={use} className="rounded-lg bg-muted p-3">
                    <dt className="text-sm font-medium">{useLabels[use]}</dt>
                    <dd className="mt-1 text-sm">
                      {row.readiness.uses[use].ready
                        ? row.readiness.mode === "fixture"
                          ? "Fixture checks passed · no live sending verified"
                          : "Sender checks passed · recipient policy still applies"
                        : row.readiness.uses[use].reasons.includes(
                              "customer_identity_required",
                            )
                          ? "Blocked · customer-controlled identity required"
                          : row.readiness.uses[use].reasons.includes(
                                "use_not_configured",
                              )
                            ? "Not selected for this identity"
                            : row.readiness.uses[use].reasons.includes(
                                  "dedicated_outreach_required",
                                )
                              ? "Blocked · dedicated outreach identity required"
                              : row.readiness.uses[use].reasons.includes(
                                    "use_not_approved",
                                  )
                                ? "Blocked · approved use not established"
                                : "Blocked · complete setup below"}
                    </dd>
                  </div>
                ))}
              </dl>
              {row.readiness.issues.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {row.readiness.issues.map((issue) => (
                    <li key={issue.code}>{issue.action}</li>
                  ))}
                </ul>
              )}
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer font-medium">
                  Authentication, permissions and reply checks
                </summary>
                <dl className="mt-4 space-y-3">
                  {senderCheckNames.map((check) => (
                    <div key={check}>
                      <dt className="text-sm font-medium">
                        {check.replaceAll("_", " ")}
                      </dt>
                      <dd className="text-sm text-muted-foreground">
                        {row.evidence?.checks[check].replaceAll("_", " ") ??
                          "Not checked"}
                        . {senderCheckLabels[check]}
                      </dd>
                    </div>
                  ))}
                </dl>
                {row.evidence && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Checked {row.evidence.observedAt}; valid until{" "}
                    {row.evidence.validUntil}.{" "}
                    {row.evidence.mode === "fixture"
                      ? "Fixture evidence does not verify a live provider."
                      : "Verification alone does not establish two-way mail access."}
                  </p>
                )}
                {row.evidence?.adapterKey === "gmail-sequence-v1" && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Gmail reply readiness covers exact references from approved
                    sequences. General mailbox completeness and historical
                    imports remain separate.
                  </p>
                )}
                {row.evidence?.verificationReference && (
                  <a
                    href={row.evidence.verificationReference}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-sm text-primary underline"
                  >
                    Review sender verification record (new tab)
                  </a>
                )}
              </details>
              {state.canManage && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void command(`${row.id}/check`, {
                        expectedVersion: row.version,
                      })
                    }
                  >
                    Check connection
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setIdentityId(row.id);
                      document
                        .getElementById("identity-editor")
                        ?.scrollIntoView({ block: "start" });
                    }}
                  >
                    Edit identity
                  </Button>
                </div>
              )}
              {feedback(`${row.id}/check`)}
            </CardContent>
          </Card>
        ))}
      </section>
      {state.canManage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connection settings</CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose the intended sending or reply connection. Saving these
                settings does not grant mail access. Gmail and Microsoft mailbox
                authorization and synchronization are separate from calendar
                access. Customer-domain transport is not configured by domain
                verification.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field id="edit-connection" label="Connection to edit">
                <NativeSelect
                  id="edit-connection"
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                >
                  <option value="">Add connection settings</option>
                  {state.connections.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.configuration.label} · {row.configuration.account}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <form
                key={`${connectionId}-${connection?.version ?? 0}`}
                onSubmit={(e) =>
                  void save(
                    e,
                    senderSaveSchema(senderConnectionSchema),
                    "connections",
                    (form) => ({
                      id: connection?.id ?? null,
                      expectedVersion: connection?.version ?? 0,
                      configuration: {
                        label: read(form, "label"),
                        provider: read(form, "provider"),
                        account: read(form, "account"),
                        enabled: form.has("enabled"),
                      },
                    }),
                  )
                }
              >
                <fieldset disabled={pending} className="space-y-4">
                  <Field id="connection-label" label="Connection label">
                    <Input
                      id="connection-label"
                      name="label"
                      required
                      maxLength={120}
                      defaultValue={connection?.configuration.label ?? ""}
                    />
                  </Field>
                  <Field id="connection-provider" label="Connection type">
                    <NativeSelect
                      id="connection-provider"
                      name="provider"
                      defaultValue={connection?.configuration.provider ?? ""}
                      required
                    >
                      <option value="" disabled>
                        Select a connection type
                      </option>
                      {Object.entries(providers).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field
                    id="connection-account"
                    label="Authorized email address"
                  >
                    <Input
                      id="connection-account"
                      name="account"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      defaultValue={connection?.configuration.account ?? ""}
                    />
                  </Field>
                  <Enabled
                    prefix="connection"
                    value={connection?.configuration.enabled ?? true}
                  />
                  <Button type="submit">Save connection settings</Button>
                </fieldset>
                {feedback("connections")}
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reply routing</CardTitle>
              <p className="text-sm text-muted-foreground">
                Route replies to an explicitly selected sales inbox. One
                identity is selected for responses from each routed inbox; no
                fallback sender is chosen. Reply-reading permission,
                synchronization and capture must each be checked.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <Link
                href={`/businesses/${businessId}/inbox`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Manage selected inboxes
              </Link>
              {!state.inboxes.length && (
                <p className="text-sm text-muted-foreground">
                  Add an email inbox connection in the shared sales inbox before
                  saving a reply route. An import connection alone does not
                  establish live synchronization.
                </p>
              )}
              <Field id="edit-route" label="Reply route to edit">
                <NativeSelect
                  id="edit-route"
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                >
                  <option value="">Add reply route</option>
                  {state.replyRoutes.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.configuration.address}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <form
                key={`${routeId}-${route?.version ?? 0}`}
                onSubmit={(e) =>
                  void save(
                    e,
                    senderSaveSchema(replyRouteSchema),
                    "reply-routes",
                    (form) => ({
                      id: route?.id ?? null,
                      expectedVersion: route?.version ?? 0,
                      configuration: {
                        address: read(form, "address"),
                        connectionId: read(form, "connectionId"),
                        inboxConnectionId: read(form, "inboxConnectionId"),
                        enabled: form.has("enabled"),
                      },
                    }),
                  )
                }
              >
                <fieldset disabled={pending} className="space-y-4">
                  <Field id="route-address" label="Reply-to address">
                    <Input
                      id="route-address"
                      name="address"
                      type="email"
                      required
                      maxLength={254}
                      defaultValue={route?.configuration.address ?? ""}
                    />
                  </Field>
                  <Field id="route-connection" label="Reply-reading connection">
                    <NativeSelect
                      id="route-connection"
                      name="connectionId"
                      required
                      defaultValue={route?.configuration.connectionId ?? ""}
                    >
                      <option value="" disabled>
                        Select a connection
                      </option>
                      {state.connections.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.configuration.label} ·{" "}
                          {row.configuration.account}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="route-inbox" label="Inbox receiving replies">
                    <NativeSelect
                      id="route-inbox"
                      name="inboxConnectionId"
                      required
                      defaultValue={
                        route?.configuration.inboxConnectionId ?? ""
                      }
                    >
                      <option value="" disabled>
                        Select a sales inbox
                      </option>
                      {state.inboxes.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                          {row.active ? "" : " (revoked)"}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Enabled
                    prefix="route"
                    value={route?.configuration.enabled ?? true}
                  />
                  <Button type="submit">Save reply route</Button>
                </fieldset>
                {feedback("reply-routes")}
              </form>
            </CardContent>
          </Card>
          <Card id="identity-editor">
            <CardHeader>
              <CardTitle>Identity and intended use</CardTitle>
              <p className="text-sm text-muted-foreground">
                Keep dedicated outreach separate from ordinary sales. Use an
                address the Business controls or an approved service-provided
                address. Setup checks must confirm control and truthful
                identification.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field id="edit-identity" label="Identity to edit">
                <NativeSelect
                  id="edit-identity"
                  value={identityId}
                  onChange={(e) => setIdentityId(e.target.value)}
                >
                  <option value="">Add sending identity</option>
                  {state.identities.map((row) => (
                    <option key={row.id} value={row.id}>
                      {purposes[row.configuration.purpose]} ·{" "}
                      {row.configuration.fromAddress}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <form
                key={`${identityId}-${identity?.version ?? 0}`}
                onSubmit={(e) =>
                  void save(
                    e,
                    senderSaveSchema(senderIdentitySchema),
                    "identities",
                    (form) => ({
                      id: identity?.id ?? null,
                      expectedVersion: identity?.version ?? 0,
                      configuration: {
                        origin: read(form, "origin"),
                        purpose: read(form, "purpose"),
                        fromAddress: read(form, "fromAddress"),
                        displayName: read(form, "displayName"),
                        uses: form.getAll("uses"),
                        connectionId: read(form, "connectionId") || null,
                        replyRouteId: read(form, "replyRouteId") || null,
                        enabled: form.has("enabled"),
                      },
                    }),
                  )
                }
              >
                <fieldset disabled={pending} className="space-y-4">
                  <Field id="identity-origin" label="Address origin">
                    <NativeSelect
                      id="identity-origin"
                      name="origin"
                      required
                      defaultValue={identity?.configuration.origin ?? ""}
                    >
                      <option value="" disabled>
                        Select address origin
                      </option>
                      {Object.entries(origins).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="identity-purpose" label="Identity purpose">
                    <NativeSelect
                      id="identity-purpose"
                      name="purpose"
                      defaultValue={
                        identity?.configuration.purpose ?? "ordinary_sales"
                      }
                    >
                      {Object.entries(purposes).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="identity-from" label="From address">
                    <Input
                      id="identity-from"
                      name="fromAddress"
                      type="email"
                      required
                      maxLength={254}
                      defaultValue={identity?.configuration.fromAddress ?? ""}
                    />
                  </Field>
                  <Field id="identity-name" label="Sender or team name">
                    <Input
                      id="identity-name"
                      name="displayName"
                      required
                      maxLength={120}
                      defaultValue={identity?.configuration.displayName ?? ""}
                    />
                  </Field>
                  <p className="text-sm text-muted-foreground">
                    The current Business name and platform identification
                    accompany this name.
                  </p>
                  <Field id="identity-connection" label="Sending connection">
                    <NativeSelect
                      id="identity-connection"
                      name="connectionId"
                      defaultValue={identity?.configuration.connectionId ?? ""}
                    >
                      <option value="">Not configured</option>
                      {state.connections.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.configuration.label} ·{" "}
                          {row.configuration.account}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field id="identity-route" label="Reply route">
                    <NativeSelect
                      id="identity-route"
                      name="replyRouteId"
                      defaultValue={identity?.configuration.replyRouteId ?? ""}
                    >
                      <option value="">Not configured</option>
                      {state.replyRoutes.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.configuration.address}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">
                      Intended uses
                    </legend>
                    {senderUseSchema.options.map((use) => (
                      <label
                        key={use}
                        className="flex min-h-11 items-center gap-3"
                      >
                        <input
                          type="checkbox"
                          name="uses"
                          value={use}
                          defaultChecked={
                            identity?.configuration.uses.includes(use) ??
                            (use === "inbound" ||
                              use === "existing_conversation")
                          }
                          className="size-5 accent-primary"
                        />
                        {useLabels[use]}
                      </label>
                    ))}
                  </fieldset>
                  <Enabled
                    prefix="identity"
                    value={identity?.configuration.enabled ?? true}
                  />
                  <Button type="submit">Save identity</Button>
                </fieldset>
                {feedback("identities")}
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
