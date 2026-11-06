"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import Link from "next/link";
import { z } from "zod";
import {
  campaignReviewSchema,
  campaignWorkspaceSchema,
  mandatoryCampaignStops,
  saveCampaignSchema,
  type CampaignWorkspace,
  type CampaignRevision,
  type CampaignReview,
  type CampaignSnapshot,
} from "@/models/campaigns";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";

type Recipient = CampaignSnapshot["recipients"][number];
const selectionKey = (r: Recipient) =>
  `${r.prospectId}:${r.contactId}:${r.evidenceKey}`;
const stopText =
  "Stop on any reply, applicable opt-out, human control, authority or eligibility change, sender failure or loss of Geographic reach. These safety stops are mandatory.";
const localDraftSchema = z.object({
  editing: z
    .object({
      campaignId: z.uuid(),
      expectedVersion: z.number().int().nonnegative(),
    })
    .nullable(),
  requestKey: z.uuid(),
  name: z.string(),
  senderId: z.string(),
  selected: z.array(z.string()),
  attempts: z.string(),
  note: z.string(),
  additional: z.string(),
  steps: z
    .array(
      z.object({
        subject: z.string(),
        body: z.string(),
        delayMinutes: z.string(),
      }),
    )
    .min(1),
  decisionNotes: z.record(z.string(), z.string()),
});
function readLocalDraft(key: string) {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null"),
      p = localDraftSchema.safeParse(raw);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}
const subscribeHydration = () => () => {};
export function CampaignManager(props: {
  businessId: string;
  initialState: CampaignWorkspace;
}) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  return hydrated ? (
    <CampaignEditor
      {...props}
      key={`${props.businessId}:${props.initialState.actorId}`}
    />
  ) : (
    <p role="status">Loading campaign review and saved drafts…</p>
  );
}

function RecipientEvidence({ recipient: r }: { recipient: Recipient }) {
  return (
    <div className="space-y-2 wrap-anywhere text-sm">
      <p className="font-medium">
        {r.prospect.name} · {r.address}
      </p>
      <p>
        {r.contactStatus === "buyer_contact"
          ? "Buyer contact"
          : "General business contact"}{" "}
        · {r.contact.name ?? "No verified person"} · {r.prospect.market}
      </p>
      <p>{r.prospect.matchReason}</p>
      <p className="text-muted-foreground">
        Uncertainty: {r.prospect.uncertainty}
      </p>
      {r.reviewReasons.map((reason) => (
        <p key={reason} className="text-warning">
          Review needed: {reason}
        </p>
      ))}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">
          Inspect selected evidence and identity
        </summary>
        <div className="space-y-3 border-l border-border pl-4">
          <p>
            Prospect ID: {r.prospectId}
            <br />
            Contact ID: {r.contactId}
          </p>
          <p>
            Contact source:{" "}
            <a
              href={r.contact.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {r.contact.url}
            </a>
            <br />
            Checked: {r.contact.checkedAt}
          </p>
          <blockquote>{r.contact.route?.quote}</blockquote>
          {r.contact.nameQuote && <p>Name evidence: {r.contact.nameQuote}</p>}
          <p>
            Purchasing responsibility:{" "}
            {r.contact.roleEvidence
              ? `${r.contact.roleEvidence.role} — ${r.contact.roleEvidence.quote}`
              : "Unconfirmed"}
          </p>
          <p>
            Public research only. Direct engagement has not been established by
            this approval.
          </p>
          {r.prospect.evidence.map((e, i) => (
            <div key={i}>
              <a
                href={e.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                {e.url}
              </a>
              <p>Checked: {e.checkedAt}</p>
              <blockquote>{e.quote}</blockquote>
            </div>
          ))}
          {r.prospect.request && (
            <p>
              Public buying request: {r.prospect.request.quote} ·{" "}
              {r.prospect.request.publishedAt ?? "Undated"} · Source status:{" "}
              {r.prospect.request.status}. A public request does not establish
              engagement.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function CampaignEditor({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: CampaignWorkspace;
}) {
  const storageKey = `campaign-draft:${businessId}:${initialState.actorId}`;
  const [restored] = useState(() => readLocalDraft(storageKey));
  const [state, setState] = useState(initialState),
    [pending, setPending] = useState(false),
    [feedback, setFeedbackState] = useState({
      scope: "workspace",
      error: false,
      message: "",
    });
  function setFeedback(
    value: { error: boolean; message: string },
    scope = "draft",
  ) {
    setFeedbackState({ ...value, scope });
  }
  const [editing, setEditing] = useState<{
    campaignId: string;
    expectedVersion: number;
  } | null>(restored?.editing ?? null);
  const [requestKey, setRequestKey] = useState(
    () => restored?.requestKey ?? crypto.randomUUID(),
  );
  const [name, setName] = useState(restored?.name ?? ""),
    [senderId, setSenderId] = useState(restored?.senderId ?? ""),
    [selected, setSelected] = useState<string[]>(restored?.selected ?? []),
    [attempts, setAttempts] = useState(restored?.attempts ?? ""),
    [note, setNote] = useState(restored?.note ?? ""),
    [additional, setAdditional] = useState(restored?.additional ?? "");
  const [steps, setSteps] = useState(
    restored?.steps ?? [{ subject: "", body: "", delayMinutes: "0" }],
  );
  const [reviews, setReviews] = useState<Record<string, CampaignReview>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    restored?.decisionNotes ?? {},
  );
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          editing,
          requestKey,
          name,
          senderId,
          selected,
          attempts,
          note,
          additional,
          steps,
          decisionNotes,
        }),
      );
    } catch {
      /* Recovery links keep this form open when browser storage is unavailable. */
    }
  }, [
    storageKey,
    editing,
    requestKey,
    name,
    senderId,
    selected,
    attempts,
    note,
    additional,
    steps,
    decisionNotes,
  ]);
  function feedbackFor(scope: string) {
    return feedback.scope === scope && feedback.message ? (
      <Alert variant={feedback.error ? "destructive" : "default"}>
        {feedback.message}
      </Alert>
    ) : null;
  }
  const base = `/api/businesses/${businessId}/campaigns`;
  async function request<T>(
    schema: z.ZodType<T>,
    command?: string,
    input?: unknown,
    scope = "workspace",
  ): Promise<T | null> {
    const notify = (value: { error: boolean; message: string }) =>
      setFeedback(value, scope);
    setPending(true);
    notify({
      error: false,
      message: command
        ? "Saving or checking the selected version…"
        : "Refreshing current state…",
    });
    try {
      const response = await fetch(
        base,
        command
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command, input }),
            }
          : { cache: "no-store" },
      );
      const json: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(json);
        const code = failure.success ? failure.data.code : "";
        notify({
          error: true,
          message:
            code === "MFA_REQUIRED"
              ? "Keep this tab open. Verify your authenticator using the Security link, then retry."
              : code === "CONFLICT"
                ? "This version or its evidence changed. Refresh current state, review and save a new version. Your draft is preserved."
                : code === "UNAUTHENTICATED"
                  ? "Keep this tab open. Sign in using the recovery link, then retry."
                  : code === "FORBIDDEN"
                    ? "Only a current Business Owner can approve or reject a campaign. Ask your Owner to review."
                    : "The request could not be completed. Check your access and fields, then retry.",
        });
        return null;
      }
      const parsed = z
        .object({ success: z.literal(true), data: schema })
        .safeParse(json);
      if (!parsed.success) {
        notify({
          error: true,
          message:
            "The response could not be verified. Refresh current state before retrying.",
        });
        return null;
      }
      notify({
        error: false,
        message:
          command === "decide"
            ? "Decision recorded. No outreach was scheduled or sent."
            : command === "save"
              ? "A new immutable version was saved for Owner review. No outreach was scheduled or sent."
              : "Current state checked. No outreach was scheduled or sent.",
      });
      return parsed.data.data;
    } catch {
      notify({
        error: true,
        message:
          "Connection interrupted. Refresh to inspect saved history before retrying; your draft is preserved.",
      });
      return null;
    } finally {
      setPending(false);
    }
  }
  function resetDraft() {
    setEditing(null);
    setName("");
    setSenderId("");
    setSelected([]);
    setAttempts("");
    setNote("");
    setAdditional("");
    setSteps([{ subject: "", body: "", delayMinutes: "0" }]);
    setRequestKey(crypto.randomUUID());
  }
  function revise(r: CampaignRevision) {
    setEditing({ campaignId: r.campaignId, expectedVersion: r.version });
    setName(r.snapshot.name);
    setSenderId(r.snapshot.senderIdentityId);
    setSelected(r.snapshot.recipients.map(selectionKey));
    setAttempts(String(r.snapshot.maxAttempts));
    setNote("");
    setAdditional(r.snapshot.stopConditions.additional.join("\n"));
    setSteps(
      r.snapshot.steps.map((s) => ({
        ...s,
        delayMinutes: String(s.delayMinutes),
      })),
    );
    setRequestKey(crypto.randomUUID());
    setFeedback({
      error: false,
      message:
        "Revising the selected version. Review current evidence and sender before saving; the earlier approval stays in history.",
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const sender = state.senders.find((s) => s.id === senderId);
    const recipients = selected.map((key) =>
      state.candidates.find((c) => selectionKey(c) === key),
    );
    if (!sender || recipients.some((r) => !r)) {
      setFeedback({
        error: true,
        message:
          "Choose a current sender and reselect any changed recipient evidence before saving.",
      });
      return;
    }
    const parsed = saveCampaignSchema.safeParse({
      requestKey,
      campaignId: editing?.campaignId ?? requestKey,
      expectedVersion: editing?.expectedVersion ?? 0,
      name,
      channel: "email",
      senderIdentityId: sender.id,
      senderVersion: sender.version,
      recipients: recipients.flatMap((r) =>
        r
          ? [
              {
                prospectId: r.prospectId,
                contactId: r.contactId,
                evidenceKey: r.evidenceKey,
              },
            ]
          : [],
      ),
      steps: steps.map((s) => ({
        ...s,
        delayMinutes: s.delayMinutes === "" ? NaN : Number(s.delayMinutes),
      })),
      maxAttempts: attempts === "" ? NaN : Number(attempts),
      stopConditions: {
        ...mandatoryCampaignStops,
        additional: additional
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      },
      note,
    });
    if (!parsed.success) {
      setFeedback({
        error: true,
        message:
          "Complete the name, recipients, messages, timing, attempt cap and review note. The cap must equal the number of messages; follow-up delays must be positive whole minutes.",
      });
      return;
    }
    const next = await request(
      campaignWorkspaceSchema,
      "save",
      parsed.data,
      "draft",
    );
    if (next) {
      setState(next);
      setReviews({});
      resetDraft();
    }
  }
  async function decide(
    r: CampaignRevision,
    decision: "approved" | "rejected",
  ) {
    if (!decisionNotes[r.id]?.trim()) {
      setFeedback(
        {
          error: true,
          message: "Enter a review note before recording your decision.",
        },
        `decision:${r.id}`,
      );
      return;
    }
    const next = await request(
      campaignWorkspaceSchema,
      "decide",
      {
        revisionId: r.id,
        payloadHash: r.payloadHash,
        decision,
        note: decisionNotes[r.id],
      },
      `decision:${r.id}`,
    );
    if (next) {
      setState(next);
      setReviews({});
    }
  }
  async function review(
    r: CampaignRevision,
    recipient: Recipient,
    stepIndex: number,
  ) {
    const result = await request(
      campaignReviewSchema,
      "review",
      {
        revisionId: r.id,
        payloadHash: r.payloadHash,
        recipient: {
          prospectId: recipient.prospectId,
          contactId: recipient.contactId,
          address: recipient.address,
        },
        stepIndex,
      },
      `review:${r.id}:${recipient.contactId}:${stepIndex}`,
    );
    if (result) {
      setReviews((v) => ({
        ...v,
        [`${r.id}:${recipient.contactId}:${stepIndex}`]: result,
      }));
      setState((s) => ({
        ...s,
        campaigns: s.campaigns.map((c) => ({
          ...c,
          revisions: c.revisions.map((revision) =>
            revision.id === r.id ? result.revision : revision,
          ),
        })),
      }));
    }
  }
  return (
    <div className="space-y-8">
      <Alert>
        Campaign approval records a bounded plan. It does not send, launch,
        grant legal permission, authorize commercial commitments or return an
        Opportunity to automation.
      </Alert>
      <p className="text-sm text-muted-foreground">
        Keep this tab open while verifying access in another tab. Drafts are
        also saved in this tab when browser storage is available.
      </p>
      <div className="flex flex-wrap gap-4">
        <Button
          variant="outline"
          disabled={pending}
          onClick={async () => {
            const next = await request(campaignWorkspaceSchema);
            if (next) {
              setState(next);
              setReviews({});
            }
          }}
        >
          Refresh current state
        </Button>
        <Link
          href="/security"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Security and authenticator (new tab)
        </Link>
      </div>
      <Link
        href="/sign-in"
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Sign in again (new tab)
      </Link>
      {feedbackFor("workspace")}
      <Card>
        <CardHeader>
          <CardTitle>
            {editing
              ? `Revise campaign · after version ${editing.expectedVersion}`
              : "Prepare a campaign"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={save}
            onChange={() => setRequestKey(crypto.randomUUID())}
          >
            <fieldset disabled={pending} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Campaign name</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={2000}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-channel">Channel</Label>
                <NativeSelect
                  id="campaign-channel"
                  value="email"
                  onChange={() => {}}
                >
                  <option value="email">Email</option>
                </NativeSelect>
                <p className="text-sm text-muted-foreground">
                  Review uses configured email identities. Execution and sending
                  adapters are not activated here.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-sender">Sending identity</Label>
                <NativeSelect
                  id="campaign-sender"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  required
                >
                  <option value="">Choose an identity</option>
                  {state.senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.configuration.fromAddress} ·{" "}
                      {s.configuration.purpose.replaceAll("_", " ")} · version{" "}
                      {s.version}
                    </option>
                  ))}
                </NativeSelect>
                {!state.senders.length && (
                  <p>
                    Create an identity in{" "}
                    <Link
                      href={`/businesses/${businessId}/senders`}
                      className="text-primary underline"
                    >
                      Sending identities
                    </Link>{" "}
                    before saving.
                  </p>
                )}
              </div>
              <fieldset className="space-y-4">
                <legend className="mb-3 font-semibold">
                  Fixed recipient and evidence selection
                </legend>
                <p className="text-sm text-muted-foreground">
                  Select exact published contacts. Later discoveries stay
                  outside saved versions. Duplicate addresses cannot appear
                  twice in one plan.
                </p>
                {!state.candidates.length && (
                  <p>
                    Run{" "}
                    <Link
                      href={`/businesses/${businessId}/discovery`}
                      className="text-primary underline"
                    >
                      prospect discovery
                    </Link>{" "}
                    to collect sourced email contacts.
                  </p>
                )}
                {state.candidates.map((r) => (
                  <div
                    key={selectionKey(r)}
                    className="rounded-xl border border-border p-4"
                  >
                    <label className="mb-3 flex min-h-11 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={selected.includes(selectionKey(r))}
                        onChange={(e) =>
                          setSelected((v) =>
                            e.target.checked
                              ? [...v, selectionKey(r)]
                              : v.filter((k) => k !== selectionKey(r)),
                          )
                        }
                      />
                      <span>
                        Select {r.prospect.name} · {r.address}
                      </span>
                    </label>
                    <RecipientEvidence recipient={r} />
                  </div>
                ))}
                {selected.some(
                  (key) =>
                    !state.candidates.some((c) => selectionKey(c) === key),
                ) && (
                  <Alert variant="warning">
                    Selected evidence changed.{" "}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSelected((v) =>
                          v.filter((k) =>
                            state.candidates.some((c) => selectionKey(c) === k),
                          ),
                        );
                        setRequestKey(crypto.randomUUID());
                      }}
                    >
                      Remove outdated selections
                    </Button>{" "}
                    Then explicitly select the current contacts.
                  </Alert>
                )}
              </fieldset>
              <fieldset className="space-y-4">
                <legend className="mb-3 font-semibold">
                  Initial message and follow-ups
                </legend>
                <p className="text-sm text-muted-foreground">
                  Every selected recipient receives the exact text below. No
                  inferred personalization or commercial authority is added.
                  Each message can be attempted once; delays start after the
                  previous successful attempt.
                </p>
                {steps.map((s, i) => (
                  <div
                    key={i}
                    className="space-y-3 rounded-xl border border-border p-4"
                  >
                    <h3 className="font-medium">
                      {i === 0 ? "Initial message" : `Follow-up ${i}`}
                    </h3>
                    <Label htmlFor={`campaign-subject-${i}`}>Subject</Label>
                    <Input
                      id={`campaign-subject-${i}`}
                      value={s.subject}
                      required
                      maxLength={2000}
                      onChange={(e) =>
                        setSteps((v) =>
                          v.map((s, n) =>
                            n === i ? { ...s, subject: e.target.value } : s,
                          ),
                        )
                      }
                    />
                    <Label htmlFor={`campaign-body-${i}`}>Message</Label>
                    <Textarea
                      id={`campaign-body-${i}`}
                      value={s.body}
                      required
                      maxLength={2000}
                      onChange={(e) =>
                        setSteps((v) =>
                          v.map((s, n) =>
                            n === i ? { ...s, body: e.target.value } : s,
                          ),
                        )
                      }
                    />
                    {i === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Initial delay: 0 minutes. Approval does not schedule
                        this message.
                      </p>
                    ) : (
                      <>
                        <Label htmlFor={`campaign-delay-${i}`}>
                          Delay after previous successful attempt (minutes)
                        </Label>
                        <Input
                          id={`campaign-delay-${i}`}
                          type="number"
                          min={1}
                          step={1}
                          required
                          value={s.delayMinutes}
                          onChange={(e) =>
                            setSteps((v) =>
                              v.map((s, n) =>
                                n === i
                                  ? { ...s, delayMinutes: e.target.value }
                                  : s,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSteps((v) => v.filter((_, n) => n !== i));
                            setRequestKey(crypto.randomUUID());
                          }}
                        >
                          Remove follow-up {i}
                        </Button>
                      </>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSteps((v) => [
                      ...v,
                      { subject: "", body: "", delayMinutes: "" },
                    ]);
                    setRequestKey(crypto.randomUUID());
                  }}
                >
                  Add follow-up
                </Button>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="campaign-attempts">
                  Maximum attempts per recipient, including initial contact
                </Label>
                <Input
                  id="campaign-attempts"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={attempts}
                  onChange={(e) => setAttempts(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  Enter {steps.length} for this {steps.length}-message plan.
                  Each message has one authorized attempt.
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold">Mandatory stop conditions</h3>
                <p>{stopText}</p>
                <Label htmlFor="campaign-stops">
                  Additional stop conditions (one per line, optional)
                </Label>
                <Textarea
                  id="campaign-stops"
                  value={additional}
                  onChange={(e) => setAdditional(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-note">Reason for this version</Label>
                <Textarea
                  id="campaign-note"
                  value={note}
                  required
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                {feedbackFor("draft")}
                <Button type="submit">
                  {pending ? "Saving…" : "Save version for review"}
                </Button>
                {editing && (
                  <Button type="button" variant="outline" onClick={resetDraft}>
                    Cancel revision
                  </Button>
                )}
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <section className="space-y-5" aria-labelledby="campaign-history">
        <h2 id="campaign-history" className="text-xl font-semibold">
          Campaign versions and approval history
        </h2>
        {!state.campaigns.length && (
          <p className="text-muted-foreground">
            No campaign has been prepared. Save a version to review its exact
            scope.
          </p>
        )}
        {state.campaigns.map((c) => (
          <div key={c.id} className="space-y-5">
            {[...c.revisions].reverse().map((r) => (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle>
                    {r.snapshot.name} · version {r.version}
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge>
                      {r.decision?.decision ?? "Awaiting Owner approval"}
                    </Badge>
                    <Badge>Not scheduled · 0 campaign sends</Badge>
                    {r.version !== c.revisions.at(-1)?.version && (
                      <Badge>Superseded</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <p className="text-sm">
                    Prepared by {r.actorName} · {r.at}
                    <br />
                    {r.note}
                  </p>
                  <p>
                    Email · {r.snapshot.sender.displayName} &lt;
                    {r.snapshot.sender.fromAddress}&gt; · identity version{" "}
                    {r.snapshot.senderVersion}
                    <br />
                    Reply-to:{" "}
                    {r.snapshot.senderContext.replyRoute?.configuration
                      .address ?? "Not configured"}{" "}
                    · transport:{" "}
                    {r.snapshot.senderContext.connection?.configuration
                      .provider ?? "Not configured"}
                    <br />
                    Maximum {r.snapshot.maxAttempts} attempts per recipient.
                  </p>
                  <div className="space-y-3">
                    {r.snapshot.steps.map((s, i) => (
                      <div key={i} className="rounded-xl bg-muted p-4">
                        <h3 className="font-semibold">
                          {i === 0 ? "Initial message" : `Follow-up ${i}`} ·{" "}
                          {s.delayMinutes} minutes{" "}
                          {i ? "after previous success" : "initial delay"}
                        </h3>
                        <p className="mt-2 font-medium wrap-anywhere">
                          {s.subject}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap wrap-anywhere">
                          {s.body}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p>{stopText}</p>
                  {r.snapshot.stopConditions.additional.map((s, i) => (
                    <p key={i}>Additional stop: {s}</p>
                  ))}
                  <section className="space-y-3">
                    <h3 className="font-semibold">
                      Current checks, separate from approval
                    </h3>
                    {(
                      [
                        "version",
                        "authority",
                        "evidence",
                        "sender",
                        "reach",
                        "conversation",
                      ] as const
                    ).map((key) => (
                      <p key={key}>
                        <span className="font-medium capitalize">
                          {key}: {r.current[key].status}
                        </span>{" "}
                        · {r.current[key].reason}
                      </p>
                    ))}
                    <p className="text-sm text-muted-foreground">
                      Commercial policy version {r.current.policyVersion};
                      reviewed version {r.current.approvalPolicyVersion}.{" "}
                      <Link
                        href={`/businesses/${businessId}/commercial-authority`}
                        className="text-primary underline"
                      >
                        Inspect current commercial authority
                      </Link>
                      .
                    </p>
                  </section>
                  <div className="space-y-4">
                    {r.snapshot.recipients.map((recipient) => (
                      <div
                        key={recipient.contactId}
                        className="space-y-3 rounded-xl border border-border p-4"
                      >
                        <RecipientEvidence recipient={recipient} />
                        {r.snapshot.steps.map((_, i) => {
                          const result =
                            reviews[`${r.id}:${recipient.contactId}:${i}`];
                          return (
                            <div key={i} className="space-y-2">
                              <Button
                                variant="outline"
                                disabled={pending}
                                onClick={() => review(r, recipient, i)}
                              >
                                Check current eligibility ·{" "}
                                {i === 0 ? "initial message" : `follow-up ${i}`}
                              </Button>
                              {feedbackFor(
                                `review:${r.id}:${recipient.contactId}:${i}`,
                              )}
                              {result && (
                                <div className="space-y-2 text-sm">
                                  <p className="font-medium">
                                    Email eligibility:{" "}
                                    {result.eligibility.status} ·{" "}
                                    {result.eligibility.at}
                                  </p>
                                  {result.eligibility.checks.map((check) => (
                                    <p key={check.code}>
                                      <strong>
                                        {check.code.replaceAll("_", " ")}:{" "}
                                        {check.status}
                                      </strong>{" "}
                                      · {check.detail}{" "}
                                      {check.status !== "allowed" &&
                                        check.nextAction}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/businesses/${businessId}/email-eligibility`}
                    className="inline-flex min-h-11 items-center text-primary underline"
                  >
                    Review permission evidence, policy requirements and
                    suppression history
                  </Link>
                  {feedbackFor(`decision:${r.id}`)}
                  {r.decision ? (
                    <p className="rounded-xl bg-muted p-4">
                      {r.decision.decision === "approved"
                        ? "Approved"
                        : "Rejected"}{" "}
                      by {r.decision.actorName} (Owner) · {r.decision.at}
                      <br />
                      {r.decision.note}
                    </p>
                  ) : (
                    r.version === c.revisions.at(-1)?.version && (
                      <div className="space-y-3">
                        {state.canApprove ? (
                          <>
                            <Label htmlFor={`decision-${r.id}`}>
                              Owner review note
                            </Label>
                            <Textarea
                              id={`decision-${r.id}`}
                              maxLength={2000}
                              value={decisionNotes[r.id] ?? ""}
                              onChange={(e) =>
                                setDecisionNotes((v) => ({
                                  ...v,
                                  [r.id]: e.target.value,
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-3">
                              <Button
                                disabled={pending}
                                onClick={() => decide(r, "approved")}
                              >
                                Approve version {r.version}
                              </Button>
                              <Button
                                variant="outline"
                                disabled={pending}
                                onClick={() => decide(r, "rejected")}
                              >
                                Reject version {r.version}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <p>
                            Ask a Business Owner with current authenticator
                            verification to approve or reject this version.
                          </p>
                        )}
                      </div>
                    )
                  )}
                  {r.version === c.revisions.at(-1)?.version && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => revise(r)}
                    >
                      Prepare a new revision
                    </Button>
                  )}
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary">
                      Immutable version reference
                    </summary>
                    <p className="text-sm wrap-anywhere">
                      Revision: {r.id}
                      <br />
                      Snapshot hash: {r.payloadHash}
                    </p>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
