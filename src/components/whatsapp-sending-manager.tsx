"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  metaSendingWorkspaceSchema,
  metaPlanSchema,
  metaPermissionSchema,
  metaTemplateSelectionSchema,
  type MetaSendingWorkspace,
  type MetaPlan,
} from "@/models/whatsapp-sending";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";

const envelope = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: metaSendingWorkspaceSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const iso = (value: FormDataEntryValue | null) => {
  const s = String(value ?? "");
  const date = new Date(`${s}Z`);
  return s && Number.isFinite(date.getTime()) ? date.toISOString() : "";
};
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
export function WhatsAppSendingManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: MetaSendingWorkspace;
}) {
  const [state, setState] = useState(initialState),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [recovery, setRecovery] = useState<string | null>(null);
  const busy = useRef(false);
  const [selected, setSelected] = useState<string[]>([]),
    [steps, setSteps] = useState([{ templateId: "", delayMinutes: "0" }]),
    [revision, setRevision] = useState<
      MetaSendingWorkspace["plans"][number] | null
    >(null);
  async function command(action: string, input: unknown) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/whatsapp/sending`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, input }),
        },
      );
      const result = envelope.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The result could not be confirmed. Refresh saved status before retrying; your entries remain here.",
        );
        return;
      }
      if (!response.ok || !result.data.success) {
        const code = result.data.success ? "" : result.data.code;
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : null,
        );
        setError(
          code === "CONFLICT"
            ? "Saved context changed or this action needs review. Refresh status and save a new version when recipients or messages change."
            : code === "CHANNEL_SETUP_REQUIRED"
              ? "Review the selected Meta account, approved template, capture and worker setup. Sending remains blocked."
              : "The action could not be completed. Check the fields, current Business access and session; your entries are preserved.",
        );
        return;
      }
      setState(result.data.data);
      setNotice("Saved. Review the current state and message evidence below.");
    } catch {
      setError(
        "The result is unconfirmed. Refresh saved status before retrying; an uncertain message must never be resent.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(
          `/api/businesses/${businessId}/whatsapp/sending`,
          { cache: "no-store" },
        ),
        result = envelope.safeParse(await response.json());
      if (!response.ok || !result.success || !result.data.success) {
        setError("Saved status is unavailable. Check your session and retry.");
        return;
      }
      setState(result.data.data);
      setNotice("Saved status refreshed.");
    } catch {
      setError("Status is unavailable. Retry when the connection is restored.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  function permission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      p = metaPermissionSchema.safeParse({
        peer: String(f.get("peer")).replace(/^\+/, ""),
        purpose: f.get("purpose"),
        opportunityId: f.get("opportunity") || null,
        numberProvided: f.get("numberProvided") === "on",
        optedIn: f.get("optedIn") === "on",
        noticesReviewed: f.get("notices") === "on",
        reference: f.get("reference"),
        sha256: f.get("digest"),
        observedAt: iso(f.get("observed")),
        validUntil: iso(f.get("expiry")),
      });
    if (!p.success) {
      setError(
        "Complete the recipient, purpose, evidence, UTC dates and permission confirmations.",
      );
      return;
    }
    void command("permission", p.data);
  }
  function template(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      p = metaTemplateSelectionSchema.safeParse({
        name: f.get("name"),
        language: f.get("language"),
        parameters: String(f.get("parameters") ?? "")
          .split("\n")
          .filter(Boolean),
      });
    if (!p.success) {
      setError(
        "Enter a template name, exact language code and one positional text value per line.",
      );
      return;
    }
    void command("template", p.data);
  }
  function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const plan = metaPlanSchema.safeParse({
      campaignId: revision?.plan.campaignId ?? crypto.randomUUID(),
      expectedVersion: revision ? revision.plan.expectedVersion + 1 : 0,
      name: f.get("name"),
      connectionVersion: state.connectionVersion,
      authorityVersion: state.authorityVersion,
      recipients: selected.flatMap((id) => {
        const c = state.candidates.find((c) => c.contactId === id);
        return c
          ? [
              {
                peer: c.peer,
                prospectId: c.prospectId,
                contactId: c.contactId,
                evidenceKey: c.evidenceKey,
                steps: steps.map((s) => ({
                  template: state.templates.find((t) => t.id === s.templateId)
                    ?.template,
                  delayMinutes: Number(s.delayMinutes),
                  evaluation: null,
                })),
              },
            ]
          : [];
      }),
      timing: {
        timeZone: f.get("zone"),
        weekdays: String(f.get("weekdays")).split(",").map(Number),
        startTime: f.get("start"),
        endTime: f.get("end"),
        dst: "compatible",
        missed: "next_window",
      },
      notBefore: iso(f.get("notBefore")),
      expiresAt: iso(f.get("expiresAt")),
      maxAttempts: steps.length,
      stopConditions: {
        reply: true,
        optOut: true,
        takeover: true,
        authorityChange: true,
        setupFailure: true,
      },
    });
    if (!plan.success) {
      setError(
        "Select recipients and current templates, then complete the explicit dates and sending window. Every later message needs a positive delay.",
      );
      return;
    }
    void command("savePlan", plan.data);
  }
  const activeTemplates = state.templates.filter(
    (t) => t.connectionVersion === state.connectionVersion,
  );
  const templateChoices = (
    value: string,
    onChange: (id: string) => void,
    id: string,
  ) => (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
    >
      <option value="">Select exact rendered template</option>
      {activeTemplates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.template.name} · {t.template.language} · {t.template.rendered}
        </option>
      ))}
    </NativeSelect>
  );
  function approval(
    event: FormEvent<HTMLFormElement>,
    p: MetaSendingWorkspace["plans"][number],
  ) {
    event.preventDefault();
    void command("decide", { planId: p.id, hash: p.hash, approved: true });
  }
  function planSummary(plan: MetaPlan) {
    return (
      <div className="space-y-3 text-sm">
        <p>
          {plan.recipients.length} fixed recipients · at most {plan.maxAttempts}{" "}
          attempts per recipient
        </p>
        <p>
          Starts {plan.notBefore}; expires {plan.expiresAt}. Sending window{" "}
          {plan.timing.startTime}–{plan.timing.endTime} in{" "}
          {plan.timing.timeZone}; weekdays {plan.timing.weekdays.join(", ")}{" "}
          (Monday = 1).
        </p>
        <p>
          Stop on reply, opt-out, takeover, changed authority or unsafe setup.
          Approval grants no recipient permission or financial authority.
        </p>
        {plan.recipients.map((r) => (
          <div key={r.peer} className="space-y-2 rounded-xl bg-muted p-4">
            <p className="font-medium">+{r.peer}</p>
            <p>
              This recipient and its source/contact evidence are fixed for this
              version.
            </p>
            {r.steps.map((s, i) => (
              <div key={i}>
                <p className="font-medium">
                  Message {i + 1} · {s.template.name} · {s.template.language} ·
                  delay {s.delayMinutes} minutes
                </p>
                <p className="whitespace-pre-wrap">{s.template.rendered}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-8 wrap-anywhere" aria-busy={pending}>
      {error && (
        <Alert role="alert">
          {error}
          {recovery && (
            <Link
              href={recovery}
              className="block min-h-11 text-primary underline"
            >
              Restore session or authenticator verification
            </Link>
          )}
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Current sending checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Badge>
            {state.sendingReady
              ? "Account checks ready; each message is checked again"
              : "Setup review required"}
          </Badge>
          <p className="text-sm text-muted-foreground">
            Recipient opt-in, exact template and the 24-hour customer service
            window are separate from email policy. Ordinary replies use the
            saved inquiry recipient, parent and grounded answer.
          </p>
          {state.issues.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {state.issues.map((v) => (
                <li key={v}>{v.replaceAll("_", " ")}</li>
              ))}
            </ul>
          )}
          <p>
            Our paid automation: {state.automation.remaining}{" "}
            {state.automation.unit ?? "matching included units unavailable"}{" "}
            remaining.
          </p>
          <Link
            href={`/businesses/${businessId}/subscription-payments`}
            className="inline-flex min-h-11 items-center text-primary underline"
          >
            Review subscription payments and allowance
          </Link>
          <div>
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={pending}
            >
              {pending ? "Updating…" : "Refresh saved status"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp permission evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Record attributable evidence held in the approved case archive.
            Public phone numbers, paid reach and Meta template approval do not
            establish opt-in. Do not enter credentials or private documents.
          </p>
          <form onSubmit={permission} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wa-peer" label="Recipient international number">
                <Input id="wa-peer" name="peer" type="tel" required />
              </Field>
              <Field id="wa-purpose" label="Permission purpose">
                <NativeSelect id="wa-purpose" name="purpose">
                  <option value="conversation">Conversation replies</option>
                  <option value="outreach">
                    Approved outreach and follow-up
                  </option>
                </NativeSelect>
              </Field>
              <Field
                id="wa-opportunity"
                label="Opportunity (optional; blank covers this recipient and purpose)"
              >
                <NativeSelect id="wa-opportunity" name="opportunity">
                  <option value="">Recipient and purpose</option>
                  {[...new Set(state.actions.map((a) => a.opportunityId))].map(
                    (id) => (
                      <option key={id} value={id}>
                        {state.actions.find((a) => a.opportunityId === id)
                          ?.title ?? id}
                      </option>
                    ),
                  )}
                </NativeSelect>
              </Field>
              <Field id="wa-reference" label="Evidence case reference">
                <Input
                  id="wa-reference"
                  name="reference"
                  required
                  pattern="[A-Z][A-Z0-9-]{5,100}"
                />
              </Field>
              <Field id="wa-digest" label="Redacted evidence SHA-256">
                <Input
                  id="wa-digest"
                  name="digest"
                  required
                  pattern="[a-f0-9]{64}"
                />
              </Field>
              <Field id="wa-observed" label="Evidence observed (UTC)">
                <Input
                  id="wa-observed"
                  name="observed"
                  type="datetime-local"
                  required
                />
              </Field>
              <Field id="wa-expiry" label="Evidence valid until (UTC)">
                <Input
                  id="wa-expiry"
                  name="expiry"
                  type="datetime-local"
                  required
                />
              </Field>
            </div>
            {[
              [
                "numberProvided",
                "The recipient provided this number to this Business.",
              ],
              [
                "optedIn",
                "The recipient opted in to messages for this purpose.",
              ],
              [
                "notices",
                "Required notices and applicable permission rules were reviewed.",
              ],
            ].map(([name, label]) => (
              <label key={name} className="flex min-h-11 items-center gap-3">
                <Checkbox name={name} required />
                {label}
              </label>
            ))}
            <Button disabled={pending}>Record permission evidence</Button>
          </form>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 font-medium">
              Saved permission history
            </summary>
            <div className="space-y-3">
              {state.permissions.map((p) => (
                <div key={p.id} className="space-y-2 rounded-xl border p-4">
                  <p>
                    +{p.permission.peer} · {p.permission.purpose} ·{" "}
                    {p.revoked
                      ? "Revoked"
                      : `Valid until ${p.permission.validUntil}`}
                  </p>
                  <p className="text-sm">
                    {p.permission.reference} · observed{" "}
                    {p.permission.observedAt}
                  </p>
                  {!p.revoked && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void command("revokePermission", {
                          permissionId: p.id,
                          reason: "Business revoked recipient permission",
                        })
                      }
                    >
                      Revoke this permission
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current approved templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Retrieve the exact language and positional text parameters from your
            selected Meta account. Body-only informational templates are
            supported. Unsupported components and financial promises need
            separate review.
          </p>
          <form onSubmit={template} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wa-template" label="Template name">
                <Input id="wa-template" name="name" required />
              </Field>
              <Field id="wa-language" label="Exact language code">
                <Input
                  id="wa-language"
                  name="language"
                  required
                  placeholder="en_US"
                />
              </Field>
            </div>
            <Field
              id="wa-parameters"
              label="Positional text parameters, one per line (blank when none)"
            >
              <Textarea id="wa-parameters" name="parameters" />
            </Field>
            <Button variant="outline" disabled={pending}>
              Retrieve current template
            </Button>
          </form>
          {activeTemplates.map((t) => (
            <div key={t.id} className="rounded-xl bg-muted p-4">
              <p className="font-medium">
                {t.template.name} · {t.template.language} ·{" "}
                {t.template.category}
              </p>
              <p className="mt-2 whitespace-pre-wrap">{t.template.rendered}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Observed {t.observedAt}. Status and exact contents are checked
                again before transport.
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bounded outreach plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Choose current sourced contacts. Saving a version sends nothing; the
            Owner reviews its fixed recipient set, evidence, sender, exact
            messages, timing, attempt cap and stop rules before approval.
            Execution is a separate action.
          </p>
          <form onSubmit={savePlan} className="space-y-4">
            <Field
              id="wa-plan-name"
              label={
                revision
                  ? `New version after ${revision.plan.expectedVersion + 1}`
                  : "New campaign name"
              }
            >
              <Input
                key={revision?.id ?? "new"}
                id="wa-plan-name"
                name="name"
                defaultValue={revision?.plan.name}
                required
              />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">Fixed recipient set</legend>
              {!state.candidates.length && (
                <p className="text-sm text-muted-foreground">
                  No current sourced phone contacts. Review Prospect discovery
                  first.
                </p>
              )}
              {state.candidates.map((c) => (
                <label
                  key={c.contactId}
                  className="flex min-h-11 items-start gap-3 rounded-xl border p-3"
                >
                  <Checkbox
                    checked={selected.includes(c.contactId)}
                    onCheckedChange={(checked) =>
                      setSelected((v) =>
                        checked
                          ? [...v, c.contactId]
                          : v.filter((id) => id !== c.contactId),
                      )
                    }
                  />
                  <span>
                    {c.name} · +{c.peer}
                    <span className="block text-sm text-muted-foreground">
                      {c.market} · {c.sources.length} retained source references
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {steps.map((s, i) => (
              <div key={i} className="space-y-3 rounded-xl border p-4">
                <Field id={`wa-step-${i}`} label={`Message ${i + 1}`}>
                  {templateChoices(
                    s.templateId,
                    (id) =>
                      setSteps((v) =>
                        v.map((r, n) =>
                          n === i ? { ...r, templateId: id } : r,
                        ),
                      ),
                    `wa-step-${i}`,
                  )}
                </Field>
                {i > 0 && (
                  <Field
                    id={`wa-delay-${i}`}
                    label="Minimum minutes after the previous message"
                  >
                    <Input
                      id={`wa-delay-${i}`}
                      type="number"
                      min="1"
                      required
                      value={s.delayMinutes}
                      onChange={(e) =>
                        setSteps((v) =>
                          v.map((r, n) =>
                            n === i
                              ? { ...r, delayMinutes: e.target.value }
                              : r,
                          ),
                        )
                      }
                    />
                  </Field>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={steps.length >= 10}
                onClick={() =>
                  setSteps((v) => [...v, { templateId: "", delayMinutes: "" }])
                }
              >
                Add bounded follow-up
              </Button>
              {steps.length > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSteps((v) => v.slice(0, -1))}
                >
                  Remove last follow-up
                </Button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["notBefore", "Earliest start (UTC)", "datetime-local"],
                ["expiresAt", "Plan expiry (UTC)", "datetime-local"],
                ["zone", "Sending time zone, such as Asia/Kolkata", "text"],
                [
                  "weekdays",
                  "Allowed weekdays, comma-separated (Monday 1, Sunday 7)",
                  "text",
                ],
                ["start", "Local sending window starts", "time"],
                ["end", "Local sending window ends", "time"],
              ].map(([name, label, type]) => (
                <Field key={name} id={`wa-plan-${name}`} label={label}>
                  <Input
                    id={`wa-plan-${name}`}
                    name={name}
                    type={type}
                    required
                  />
                </Field>
              ))}
            </div>
            <p className="text-sm">
              Attempt cap: {steps.length} messages per recipient. Repeated work
              never increases it. Missed sends wait for the next approved local
              window; ambiguous acceptance blocks subsequent attempts.
            </p>
            <Button
              disabled={pending || !selected.length || !state.connectionVersion}
            >
              Save version for Owner review
            </Button>
            {revision && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRevision(null)}
              >
                Start a separate campaign
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      {state.plans.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle>
              {p.plan.name} · version {p.plan.expectedVersion + 1}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Badge>
              {p.cancelled
                ? "Stopped"
                : !p.current
                  ? "Superseded"
                  : p.approved
                    ? "Owner approved"
                    : "Awaiting Owner approval"}
            </Badge>
            <p className="font-medium">
              Approved sender: {p.sender.number} · connection version{" "}
              {p.plan.connectionVersion}
            </p>
            {p.blockedReason && (
              <p className="text-sm text-warning">
                Current execution check: {p.blockedReason.replaceAll("_", " ")}
              </p>
            )}
            {planSummary(p.plan)}
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium">
                Saved source and contact evidence
              </summary>
              <div className="space-y-4">
                {p.sources.map((s) => (
                  <div
                    key={s.contactId}
                    className="space-y-2 rounded-xl bg-muted p-4"
                  >
                    <p className="font-medium">
                      {s.name} · +{s.peer}
                    </p>
                    {s.sources.map((source, i) => (
                      <div key={i}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center text-primary underline"
                        >
                          View recorded public source (new tab)
                        </a>
                        <blockquote className="border-l-2 border-border pl-3">
                          {source.quote}
                        </blockquote>
                        <p className="text-sm text-muted-foreground">
                          Checked {source.checkedAt}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
            {p.current && !p.cancelled && (
              <div className="space-y-3">
                {!p.approved && state.canApprove && (
                  <form onSubmit={(e) => approval(e, p)} className="space-y-3">
                    <label className="flex min-h-11 items-start gap-3">
                      <Checkbox required className="mt-1" />I reviewed this
                      sender version, recipient set, retained source/contact
                      evidence, exact messages, timing, attempt cap and stop
                      conditions.
                    </label>
                    <Button disabled={pending}>
                      Approve this exact version
                    </Button>
                  </form>
                )}
                {p.approved && (
                  <Button
                    disabled={pending || !state.sendingReady}
                    onClick={() =>
                      void command("start", { planId: p.id, hash: p.hash })
                    }
                  >
                    Start approved execution
                  </Button>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRevision(p);
                      setSelected(p.plan.recipients.map((r) => r.contactId));
                      setSteps(
                        p.plan.recipients[0].steps.map((s) => ({
                          templateId:
                            activeTemplates.find(
                              (t) =>
                                JSON.stringify(t.template) ===
                                JSON.stringify(s.template),
                            )?.id ?? "",
                          delayMinutes: String(s.delayMinutes),
                        })),
                      );
                    }}
                  >
                    Prepare a new version
                  </Button>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void command("cancelPlan", {
                        planId: p.id,
                        reason: "Business stopped pending execution",
                      })
                    }
                  >
                    Stop pending execution
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Message evidence and customer Meta usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Accepted is distinct from Sent, delivered and read. Missing or
            unsupported evidence remains unresolved; reconciliation never
            resends. Meta callbacks can arrive late and do not establish a final
            bill or price. No Meta credit, prepaid balance or duplicate
            subscription charge is created.
          </p>
          {!state.actions.length && (
            <p>
              No saved WhatsApp actions yet. Ordinary replies start in the
              Opportunity’s Answer and qualify flow.
            </p>
          )}
          {state.actions.map((a) => (
            <div key={a.id} className="space-y-3 rounded-xl border p-4">
              <Link
                href={`/businesses/${businessId}/opportunities/${a.opportunityId}`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                Review Opportunity: {a.title}
              </Link>
              <p>
                {a.state} · {a.evidence} · due {a.dueAt}
              </p>
              {a.intent && (
                <p className="whitespace-pre-wrap">
                  +{a.intent.peer}: {a.intent.body}
                </p>
              )}
              <p className="text-sm">
                {a.reason?.replaceAll("_", " ")}{" "}
                {a.reconciliationReason?.replaceAll("_", " ")}
              </p>
              {a.providerMessageRef && (
                <p className="text-sm">
                  Provider reference: {a.providerMessageRef}
                </p>
              )}
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void command("reconcile", { actionId: a.id })}
              >
                Reconcile saved provider evidence
              </Button>
              {a.state === "pending" && (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command("bindReplyTemplate", {
                      actionId: a.id,
                      templateId: new FormData(e.currentTarget).get(
                        "templateId",
                      ),
                    });
                  }}
                >
                  <Field
                    id={`wa-bind-${a.id}`}
                    label="For an expired reply window: select a template whose exact rendering equals the saved grounded answer"
                  >
                    <NativeSelect
                      id={`wa-bind-${a.id}`}
                      name="templateId"
                      required
                    >
                      <option value="">
                        Select matching approved template
                      </option>
                      {activeTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.template.name} · {t.template.language} ·{" "}
                          {t.template.rendered}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Button variant="outline" disabled={pending}>
                    Bind exact reply template
                  </Button>
                </form>
              )}
              {state.usage
                .filter((u) => u.actionId === a.id)
                .map((u, i) => (
                  <div
                    key={i}
                    className="space-y-1 text-sm text-muted-foreground"
                  >
                    <p>
                      Customer Meta usage: {u.state.replaceAll("_", " ")} ·{" "}
                      {u.minor !== null
                        ? `${u.currency} ${u.minor} minor units`
                        : "amount not established"}
                    </p>
                    <p>
                      Source: {u.provenance}; provider observed{" "}
                      {u.observedAt ?? "pending"}; received{" "}
                      {u.receivedAt ?? "pending"}.
                    </p>
                    {u.pricing !== null && (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3">
                          Provider usage classification
                        </summary>
                        <pre className="whitespace-pre-wrap">
                          {JSON.stringify(u.pricing, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              {a.intent && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    Record a sourced customer Meta cost estimate
                  </summary>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Optional assisted estimate for this one message, from your
                    reviewed Meta account/rate evidence. This is not a charge or
                    an observed final bill. Do not enter payment credentials.
                  </p>
                  <form
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void command("estimate", {
                        actionId: a.id,
                        currency: f.get("currency"),
                        minor: f.get("minor"),
                        reference: f.get("reference"),
                        observedAt: iso(f.get("observed")),
                        validUntil: iso(f.get("valid")),
                      });
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        id={`wa-cost-currency-${a.id}`}
                        label="Meta billing currency"
                      >
                        <Input
                          id={`wa-cost-currency-${a.id}`}
                          name="currency"
                          required
                          pattern="[A-Z]{3}"
                        />
                      </Field>
                      <Field
                        id={`wa-cost-minor-${a.id}`}
                        label="Estimated minor units for this message"
                      >
                        <Input
                          id={`wa-cost-minor-${a.id}`}
                          name="minor"
                          inputMode="numeric"
                          required
                          pattern="[0-9]+"
                        />
                      </Field>
                      <Field
                        id={`wa-cost-ref-${a.id}`}
                        label="Rate evidence case reference"
                      >
                        <Input
                          id={`wa-cost-ref-${a.id}`}
                          name="reference"
                          required
                          pattern="[A-Z][A-Z0-9-]{5,100}"
                        />
                      </Field>
                      <Field
                        id={`wa-cost-observed-${a.id}`}
                        label="Rate observed (UTC)"
                      >
                        <Input
                          id={`wa-cost-observed-${a.id}`}
                          name="observed"
                          type="datetime-local"
                          required
                        />
                      </Field>
                      <Field
                        id={`wa-cost-valid-${a.id}`}
                        label="Estimate valid until (UTC)"
                      >
                        <Input
                          id={`wa-cost-valid-${a.id}`}
                          name="valid"
                          type="datetime-local"
                          required
                        />
                      </Field>
                    </div>
                    <Button variant="outline" disabled={pending}>
                      Record separate Meta estimate
                    </Button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
