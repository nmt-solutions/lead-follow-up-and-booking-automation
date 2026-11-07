"use client";
import Link from "next/link";
import { useState, useId, useRef, useEffect, type ComponentProps } from "react";
import { z } from "zod";
import {
  notificationWorkspaceSchema,
  notificationPreferenceViewSchema,
  noticeViewSchema,
  type NotificationWorkspace,
  type NoticeView,
} from "@/models/notifications";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";

type Preference = z.infer<typeof notificationPreferenceViewSchema>;
const preferencesSchema = z.array(notificationPreferenceViewSchema);
const businessSchema = z.object({
  allowedPreferences: z.array(
    z.enum(["operations", "subscription", "tax_period"]),
  ),
  notices: z.array(noticeViewSchema),
  sendingReady: z.boolean(),
  preferences: preferencesSchema,
});
const operatorSchema = z.object({
  workspace: notificationWorkspaceSchema,
  preferences: preferencesSchema,
});
async function read<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in again, then refresh delivery status."
        : response.status === 403
          ? "Your access or MFA has changed. Verify Security, then refresh."
          : response.status === 409
            ? "Another check or native retry deadline is active. Review current status and try after the saved retry time."
            : "This action could not be confirmed. Refresh saved status before trying again.",
    );
  const value: unknown = await response.json(),
    parsed = z
      .object({ success: z.literal(true), data: schema })
      .safeParse(value);
  if (!parsed.success)
    throw new Error("The saved status could not be read. Refresh this page.");
  return parsed.data.data;
}
function Field({
  label,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}
function at(value: string | null) {
  return value && Number.isFinite(new Date(value).getTime())
    ? `${new Date(value).toISOString().slice(0, 19).replace("T", " ")} UTC`
    : "Not recorded";
}
function useCommandFocus(busy: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!busy && origin.current) {
      if (origin.current.isConnected) origin.current.focus();
      else document.getElementById("notification-history")?.focus();
      origin.current = null;
    }
  }, [busy]);
  return () => {
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
}
const reasonNames: Record<string, string> = {
  setup_required: "Verify the sending domain and account usage.",
  setup_check_in_progress: "An account usage check is in progress.",
  quota_or_observation_exhausted:
    "The selected quota is exhausted or needs a fresh native check.",
  selected_paid_terms_required:
    "This account requires explicitly selected paid terms.",
  key_or_idempotency_expired:
    "The original key or provider retry guarantee is no longer available. Review native evidence; do not resend this identity.",
  payload_expired:
    "The private payload expired. Authentication requires a new sign-in request.",
  authority_changed: "The original purpose or recipient authority changed.",
  rate_limited:
    "Resend requested a delay. Retry is blocked until the saved time.",
  held: "Review the original payload key, authority and native evidence.",
  uncertain:
    "Provider acceptance is unresolved; the original identity remains reserved.",
  rejected: "Resend rejected this request. Correct setup before retrying.",
};
function History({
  notices,
  busy,
  retry,
}: {
  notices: NoticeView[];
  busy: boolean;
  retry?: (id: string) => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="notification-history">
      <h2
        id="notification-history"
        tabIndex={-1}
        className="text-xl font-semibold tracking-tight"
      >
        Delivery history
      </h2>
      <p className="text-sm text-muted-foreground">
        Provider acceptance, delivery and the recorded source stage remain
        separate. Private recipients, sign-in links and invitation tokens are
        omitted. The latest 200 attempts are shown.
      </p>
      {notices.length === 0 ? (
        <p>
          No saved attempts yet. Request a sign-in link, invite a teammate, or
          enable a current platform notice below.
        </p>
      ) : (
        <ul className="space-y-4">
          {notices.map((n) => (
            <li
              key={n.id}
              className="space-y-3 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold capitalize">
                  {n.purpose.replaceAll("_", " ")}
                </h3>
                <Badge>
                  {n.stage
                    ? `Provider ${n.stage.replaceAll("_", " ")}`
                    : n.state === "accepted"
                      ? "Provider accepted"
                      : n.state.replaceAll("_", " ")}
                </Badge>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Source stage</dt>
                  <dd className="wrap-anywhere">
                    {n.sourceStage.replaceAll("_", " ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Current dispatch authority
                  </dt>
                  <dd>
                    {n.authorityCurrent
                      ? "Still available"
                      : "Changed, completed or expired"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    First native attempt
                  </dt>
                  <dd>{at(n.firstAttemptAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Next permitted attempt
                  </dt>
                  <dd>{at(n.nextAttemptAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Private payload expires
                  </dt>
                  <dd>{at(n.expiresAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Provider retry deadline
                  </dt>
                  <dd>{at(n.retryUntil)}</dd>
                </div>
              </dl>
              {reasonNames[n.reason] && (
                <p className="text-sm">{reasonNames[n.reason]}</p>
              )}
              {n.providerId && (
                <p className="wrap-anywhere text-sm text-muted-foreground">
                  Native receipt: {n.providerId}
                </p>
              )}
              <details>
                <summary className="cursor-pointer py-3 text-sm font-medium">
                  Attempt history
                </summary>
                <ol className="space-y-2 text-sm">
                  {n.history.map((e, i) => (
                    <li key={`${e.at}:${i}`}>
                      {at(e.at)} · {e.kind.replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
                <p className="mt-3 wrap-anywhere text-xs text-muted-foreground">
                  Attempt {n.id}
                </p>
              </details>
              {retry &&
                n.purpose !== "cost_alert" &&
                !n.providerId &&
                !["held", "expired"].includes(n.state) && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => retry(n.id)}
                  >
                    Check original attempt
                  </Button>
                )}
              {n.purpose === "cost_alert" && (
                <Link
                  href="/platform/costs"
                  className="inline-flex min-h-11 items-center text-primary underline"
                >
                  Review the original budget alert
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function Preferences({
  allowed,
  values,
  busy,
  save,
}: {
  allowed: ("operations" | "subscription" | "tax_period")[];
  values: Preference[];
  busy: boolean;
  save: (input: {
    purpose: "operations" | "subscription" | "tax_period";
    enabled: boolean;
    expectedVersion: number;
  }) => void;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight">
        My platform email notices
      </h2>
      <p className="text-sm text-muted-foreground">
        Choose notices for your current verified account. Operations use the
        current assigned responsibility; Business managers also receive
        sender-health incidents. Subscription notices require billing authority.
        Operator notices cover only sources allowed by their current operations
        or sender-health capability. Changes retain their original history.
      </p>
      {(["operations", "subscription", "tax_period"] as const)
        .filter(
          (p) =>
            p !== "tax_period" ||
            allowed.includes(p) ||
            values.some((v) => v.purpose === p && v.enabled),
        )
        .map((p) => {
          const v = values.find((v) => v.purpose === p);
          return (
            <div
              key={p}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span>
                {p === "operations"
                  ? "Handoffs, sender health and operational exceptions"
                  : p === "tax_period"
                    ? "Configured tax-period review reminders"
                    : "Subscription, refund and dispute status"}
                : {v?.enabled ? "Email enabled" : "In-app only"}
              </span>
              <Button
                variant="outline"
                disabled={busy || (!v?.enabled && !allowed.includes(p))}
                onClick={() =>
                  save({
                    purpose: p,
                    enabled: !v?.enabled,
                    expectedVersion: v?.version ?? 0,
                  })
                }
              >
                {v?.enabled
                  ? "Stop email"
                  : allowed.includes(p)
                    ? "Enable email"
                    : "Source access required"}
              </Button>
            </div>
          );
        })}
    </section>
  );
}
export function NotificationManager({
  initial,
  initialPreferences,
}: {
  initial: NotificationWorkspace;
  initialPreferences: Preference[];
}) {
  const [state, setState] = useState(initial),
    [preferences, setPreferences] = useState(initialPreferences),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [kind, setKind] = useState<"free" | "selected_paid">(
    initial.terms?.kind ?? "free",
  );
  const rememberFocus = useCommandFocus(busy);
  async function load() {
    const data = await read(
      await fetch("/api/platform/notifications", { cache: "no-store" }),
      operatorSchema,
    );
    setState(data.workspace);
    setPreferences(data.preferences);
  }
  async function run(operation: () => Promise<void>, message: string) {
    rememberFocus();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      setStatus(message);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refresh saved status.");
    } finally {
      setBusy(false);
    }
  }
  async function command(value: unknown) {
    await read(
      await fetch("/api/platform/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      }),
      z.object({ saved: z.literal(true) }),
    );
    await load();
  }
  return (
    <div className="space-y-8" aria-busy={busy}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action needs review</AlertTitle>
          <AlertDescription>
            {error}{" "}
            <Link href="/security" className="underline">
              Open Security
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {status && <Alert variant="success">{status}</Alert>}
      <section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Platform sender</h2>
            <p className="mt-2 wrap-anywhere">{state.sender}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.account} ·{" "}
              {state.mode === "production"
                ? "Production mode"
                : "Restricted test-recipient mode; this is not a Resend sandbox"}
            </p>
          </div>
          <Badge>
            {state.setupFresh && state.setup?.sendingReady
              ? "Native domain verified"
              : "Setup needs review"}
          </Badge>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {Object.entries(state.deployment).map(([key, ready]) => (
            <div key={key}>
              <dt className="capitalize text-muted-foreground">
                {key.replace(/([A-Z])/g, " $1")} configuration
              </dt>
              <dd>{ready ? "Configured" : "Missing"}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">Native setup read</dt>
            <dd>
              {state.setup?.readAccess ?? "Not checked"} ·{" "}
              {at(state.setupCheckedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Domain</dt>
            <dd className="wrap-anywhere">
              {state.setup?.domain ?? "Not checked"} ·{" "}
              {state.setup?.domainStatus ?? "unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Durable recovery schedule</dt>
            <dd>
              {state.recoveryConfigured
                ? "Configured; deployment verification pending"
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Signed delivery events</dt>
            <dd>
              {state.webhookConfigured
                ? "Secret configured; endpoint deployment must be verified"
                : "Not configured"}
            </dd>
          </div>
        </dl>
        <ul className="space-y-3 text-sm">
          {state.setup?.senders.map((sender) => (
            <li
              key={sender.from}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <span className="wrap-anywhere">
                {sender.from} · {sender.domain} · {sender.domainStatus}
              </span>
              <Badge>
                {sender.sendingReady
                  ? "Sending domain verified"
                  : "Sender setup required"}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Account identity names the configured credential set. Native reads
          verify its domain and quota; actual acceptance proves sending-key
          access. A separate full-access setup key is required. Receiving
          readiness never grants mailbox synchronization.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () => command({ action: "verify" }),
                "Native setup check saved. Review its result before sending.",
              )
            }
          >
            {busy ? "Working…" : "Verify native sender and usage"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(load, "Saved delivery status refreshed.")}
          >
            Refresh saved status
          </Button>
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Account-wide transactional usage
        </h2>
        {state.setup?.usage ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            {(["daily", "monthly"] as const).map((period) => {
              const q = state.setup!.usage!.emails[period];
              return (
                <div
                  key={period}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <dt className="capitalize">{period}</dt>
                  <dd className="mt-2 text-xl font-semibold">
                    {q.used.toLocaleString()} /{" "}
                    {q.limit === null
                      ? "No native cap"
                      : q.limit.toLocaleString()}
                  </dd>
                  <dd className="mt-2 text-sm text-muted-foreground">
                    {q.sent} sent · {q.received} received · resets{" "}
                    {at(q.resets_at)}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p>Run native verification to load actual team usage.</p>
        )}
        <p className="text-sm text-muted-foreground">
          Counters include other keys and receiving. Unresolved local acceptance
          remains reserved ({state.pendingReservations}). Observed sends are
          counted once. A missing daily cap does not establish free service.
        </p>
      </section>
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-8">
        <h2 className="text-xl font-semibold">Selected sending terms</h2>
        {state.bootstrapAuthOnly && (
          <p className="mt-3 text-sm" role="status">
            Auth-only bootstrap is active. Save reviewed sending terms from this
            MFA session to enable invitations and platform notifications.
          </p>
        )}
        {state.terms && (
          <p className="mt-3 text-sm">
            Current selection:{" "}
            {state.terms.kind === "free" ? "Free band" : "Selected paid terms"}{" "}
            · {state.terms.reference}. Monthly limit {state.terms.monthlyLimit};
            daily limit {state.terms.dailyLimit ?? "uncapped"}.
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          Free eligibility and volume remain bounded by actual account usage.
          Recording paid terms does not activate a provider upgrade. Arrange
          that explicit plan in Resend, then verify its actual limits here.
          Selected commitments are context for costs; they are not per-email
          expenses.
        </p>
        <form
          className="mt-6 space-y-5"
          key={JSON.stringify(state.terms)}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void run(async () => {
              const amount = String(form.get("amount") ?? "");
              if (
                kind === "selected_paid" &&
                !/^\d{1,18}(\.\d{1,6})?$/.test(amount)
              )
                throw new Error(
                  "Enter the selected monthly commitment with up to six decimal places.",
                );
              const [whole, part = ""] = amount.split(".");
              await command({
                action: "terms",
                input: {
                  kind,
                  reference: String(form.get("reference")),
                  monthlyLimit: Number(form.get("monthly")),
                  dailyLimit:
                    String(form.get("daily")) === ""
                      ? null
                      : Number(form.get("daily")),
                  amount:
                    kind === "free"
                      ? null
                      : {
                          currency: String(form.get("currency")),
                          micros: (
                            BigInt(whole) * 1000000n +
                            BigInt(part.padEnd(6, "0"))
                          ).toString(),
                        },
                },
              });
            }, "Selected terms saved. Verify native account limits after any provider plan change.");
          }}
        >
          <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="notice-plan-kind">Plan selection</Label>
              <NativeSelect
                id="notice-plan-kind"
                value={kind}
                onChange={(e) =>
                  setKind(
                    z.enum(["free", "selected_paid"]).parse(e.target.value),
                  )
                }
              >
                <option value="free">Free band</option>
                <option value="selected_paid">Explicit paid terms</option>
              </NativeSelect>
            </div>
            <Field
              label="Reviewed terms reference"
              name="reference"
              required
              maxLength={240}
              defaultValue={state.terms?.reference ?? ""}
            />
            <Field
              label="Selected monthly email limit"
              name="monthly"
              type="number"
              min={1}
              required
              defaultValue={
                state.terms?.monthlyLimit ??
                state.setup?.usage?.emails.monthly.limit ??
                ""
              }
            />
            <Field
              label="Selected daily limit (blank only for paid uncapped)"
              name="daily"
              type="number"
              min={1}
              defaultValue={
                state.terms?.dailyLimit ??
                state.setup?.usage?.emails.daily.limit ??
                ""
              }
            />
            {kind === "selected_paid" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="notice-plan-currency">
                    Commitment currency
                  </Label>
                  <NativeSelect
                    id="notice-plan-currency"
                    name="currency"
                    defaultValue={state.terms?.amount?.currency ?? "USD"}
                  >
                    <option value="USD">USD</option>
                    <option value="INR">INR</option>
                  </NativeSelect>
                </div>
                <Field
                  label="Selected monthly commitment"
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={
                    state.terms?.amount
                      ? `${BigInt(state.terms.amount.micros) / 1000000n}.${(BigInt(state.terms.amount.micros) % 1000000n).toString().padStart(6, "0")}`
                      : ""
                  }
                />
              </>
            )}
          </fieldset>
          <Button disabled={busy} type="submit">
            Save selected terms
          </Button>
        </form>
      </section>
      <Preferences
        allowed={state.allowedPreferences}
        values={preferences}
        busy={busy}
        save={(input) =>
          void run(
            () => command({ action: "preference", input }),
            "Your notice delivery preference was saved.",
          )
        }
      />
      <History
        notices={state.notices}
        busy={busy}
        retry={(id) =>
          void run(
            () => command({ action: "retry", id }),
            "Original attempt checked. Its saved state and retry deadline remain authoritative.",
          )
        }
      />
    </div>
  );
}
export function BusinessNotifications({
  businessId,
  initial,
}: {
  businessId: string;
  initial: z.infer<typeof businessSchema>;
}) {
  const [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const rememberFocus = useCommandFocus(busy);
  async function run(value?: unknown) {
    rememberFocus();
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (value)
        await read(
          await fetch(`/api/businesses/${businessId}/notifications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "preference", input: value }),
          }),
          z.object({ saved: z.literal(true) }),
        );
      setState(
        await read(
          await fetch(`/api/businesses/${businessId}/notifications`, {
            cache: "no-store",
          }),
          businessSchema,
        ),
      );
      setStatus(
        value
          ? "Your delivery preference was saved."
          : "Saved delivery status refreshed.",
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refresh delivery status.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8" aria-busy={busy}>
      {error && (
        <Alert variant="destructive">
          {error}{" "}
          <Link href="/security" className="underline">
            Open Security
          </Link>
        </Alert>
      )}
      {status && <Alert variant="success">{status}</Alert>}
      <Alert variant={state.sendingReady ? "success" : "warning"}>
        {state.sendingReady
          ? "The platform sender has current native verification."
          : "The platform sender needs setup or a fresh verification. Ask the notification operator to review it."}
      </Alert>
      <div className="flex flex-wrap gap-4">
        <Button variant="outline" disabled={busy} onClick={() => void run()}>
          Refresh delivery status
        </Button>
        <Link
          href={`/businesses/${businessId}/team`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Review or retry an invitation
        </Link>
      </div>
      <Preferences
        allowed={state.allowedPreferences}
        values={state.preferences}
        busy={busy}
        save={(input) => void run(input)}
      />
      <History notices={state.notices} busy={busy} />
    </div>
  );
}
