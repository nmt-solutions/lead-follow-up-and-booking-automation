"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  knowledgeDraftSchema,
  knowledgeWorkspaceSchema,
  informationalReplyTemplates,
  type KnowledgeConfiguration,
  type KnowledgeWorkspace,
} from "@/models/knowledge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

const responseSchema = z.object({
  success: z.literal(true),
  data: knowledgeWorkspaceSchema,
});
const empty: KnowledgeConfiguration = {
  offerings: [],
  answers: [],
  missingInformation: [],
  goal: "rfq",
  qualification: [],
  escalation: { name: "", email: "" },
};

function InquiryReplyUse({
  id,
  value,
  onChange,
}: {
  id: string;
  value: "human_review" | "informational" | undefined;
  onChange(value: "human_review" | "informational"): void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Inquiry reply use</Label>
      <NativeSelect
        id={id}
        value={value ?? "human_review"}
        onChange={(event) => {
          const parsed = z
            .enum(["human_review", "informational"])
            .safeParse(event.target.value);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        <option value="human_review">Require human review</option>
        <option value="informational">
          Allow a supported informational reply
        </option>
      </NativeSelect>
      <p className="text-sm text-muted-foreground">
        Automatic replies must match a supported phrase verbatim. Other approved
        wording requires human review. This setting takes effect on approval and
        grants no commercial authority.
      </p>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3">
          Supported automatic phrases
        </summary>
        <ul className="list-inside list-disc space-y-2">
          {informationalReplyTemplates.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function KnowledgeSummary({
  configuration,
}: {
  configuration: KnowledgeConfiguration;
}) {
  return (
    <div className="space-y-5 wrap-anywhere">
      <p>
        <span className="font-medium">Conversion goal: </span>
        {configuration.goal === "rfq"
          ? "Native quotation request (RFQ)"
          : "Appointment booking"}
      </p>
      <div>
        <h3 className="font-medium">Offerings</h3>
        {configuration.offerings.length ? (
          <dl className="mt-2 space-y-3">
            {configuration.offerings.map((entry) => (
              <div key={entry.name}>
                <dt className="font-medium">{entry.name}</dt>
                <dd className="whitespace-pre-wrap text-muted-foreground">
                  {entry.details}
                  <span className="mt-1 block text-sm">
                    Inquiry replies:{" "}
                    {entry.inquiryReply === "informational" &&
                    informationalReplyTemplates.some(
                      (text) => text === entry.details,
                    )
                      ? "Supported informational reply enabled"
                      : "Human review required"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">
            No approved offerings in this revision.
          </p>
        )}
      </div>
      <div>
        <h3 className="font-medium">Answers</h3>
        {configuration.answers.length ? (
          <dl className="mt-2 space-y-3">
            {configuration.answers.map((entry) => (
              <div key={entry.question}>
                <dt className="font-medium">{entry.question}</dt>
                <dd className="whitespace-pre-wrap text-muted-foreground">
                  {entry.answer}
                  <span className="mt-1 block text-sm">
                    Inquiry replies:{" "}
                    {entry.inquiryReply === "informational" &&
                    informationalReplyTemplates.some(
                      (text) => text === entry.answer,
                    )
                      ? "Supported informational reply enabled"
                      : "Human review required"}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">
            No approved answers in this revision.
          </p>
        )}
      </div>
      <div>
        <h3 className="font-medium">Qualification fields</h3>
        {configuration.qualification.length ? (
          <ul className="mt-2 space-y-2">
            {configuration.qualification.map((field) => (
              <li key={field.key}>
                {field.label} — {field.required ? "Required" : "Optional"},{" "}
                {field.type}{" "}
                <span className="text-sm text-muted-foreground">
                  ({field.key})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No qualification fields configured.
          </p>
        )}
      </div>
      <div>
        <h3 className="font-medium">Missing information to resolve</h3>
        {configuration.missingInformation.length ? (
          <ul className="mt-2 list-inside list-disc">
            {configuration.missingInformation.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            No recorded questions. Other unknown answers still require
            escalation.
          </p>
        )}
      </div>
      <p>
        <span className="font-medium">Escalation: </span>
        {configuration.escalation.name} ·{" "}
        <a
          className="text-primary underline underline-offset-4"
          href={`mailto:${configuration.escalation.email}`}
        >
          {configuration.escalation.email}
        </a>
      </p>
    </div>
  );
}

export function KnowledgeManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: KnowledgeWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [draft, setDraft] = useState(
    initialState.history.at(-1)?.configuration ?? empty,
  );
  const [missing, setMissing] = useState(draft.missingInformation.join("\n"));
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [conflict, setConflict] = useState(false);
  function change(value: KnowledgeConfiguration) {
    setDraft(value);
    setDirty(true);
    setReviewed(false);
  }
  const payload = {
    ...draft,
    missingInformation: missing
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
  const validated = knowledgeDraftSchema.safeParse({
    expectedVersion: state.version,
    note,
    configuration: payload,
  });
  async function send(action: "draft" | "approve" | "retire") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setNeedsMfa(false);
    setConflict(false);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/knowledge${action === "draft" ? "" : `/${action}`}`,
        {
          method: action === "draft" ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedVersion: state.version,
            note,
            ...(action === "draft" ? { configuration: payload } : {}),
          }),
        },
      );
      const json: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(json);
        const code = failure.success ? failure.data.code : "";
        setNeedsMfa(code === "MFA_REQUIRED");
        setConflict(code === "CONFLICT");
        setError(
          code === "CONFLICT"
            ? "A newer revision is available. Reload the saved version, review it and try again. Your edits remain here until you reload."
            : code === "MFA_REQUIRED"
              ? "Verify in Security, then retry. Your edits remain here."
              : code === "FORBIDDEN"
                ? "Your current role cannot change approved knowledge. Ask an Owner or Admin."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again in another tab, then retry to preserve these edits."
                  : "Unable to save this change. Check the fields and your access, then retry.",
        );
        return;
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Invalid response");
      setState(parsed.data.data);
      setDirty(false);
      setReviewed(false);
      setNote("");
      const saved = parsed.data.data.history.at(-1)?.configuration;
      if (saved) {
        setDraft(saved);
        setMissing(saved.missingInformation.join("\n"));
      }
      setMessage(
        action === "draft"
          ? `Draft saved. Review it below before approving. ${parsed.data.data.current ? "Current approved knowledge is still in use." : "No approved knowledge is active yet."}`
          : action === "approve"
            ? "Revision approved. Conversations can now use this configuration."
            : "Configuration retired. Workflows require a new approval before using knowledge.",
      );
    } catch {
      setError(
        "Unable to confirm this change. Reload the saved version before retrying to check whether it completed.",
      );
      setConflict(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const latest = state.history.at(-1);
  return (
    <div className="space-y-8">
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="current-knowledge"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="current-knowledge" className="text-xl font-semibold">
            Current approved configuration
          </h2>
          <Badge>
            {state.current
              ? `Approved · revision ${state.current.version}`
              : "Approval needed"}
          </Badge>
        </div>
        {state.current ? (
          <KnowledgeSummary configuration={state.current.configuration} />
        ) : (
          <p className="text-muted-foreground">
            No authoritative configuration is active. An Owner or Admin must
            save and approve a draft with an escalation contact.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Approval supplies information and qualification goals. Commercial
          actions, channel sending and booking confirmations still require their
          own authority. RFQs do not require a calendar.
        </p>
      </section>
      {!state.canManage && (
        <p className="rounded-xl border border-border bg-muted p-4">
          You can review this Business’s knowledge and history. Ask an Owner or
          Admin to make changes.
        </p>
      )}
      {state.canManage && (
        <form
          className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          onSubmit={(event) => {
            event.preventDefault();
            void send("draft");
          }}
        >
          <div>
            <h2 className="text-xl font-semibold">Prepare a draft</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Changes replace the configuration only after approval. Remove an
              entry here and approve the new revision to retire that offering,
              answer or requirement. All prior revisions remain in history.
            </p>
          </div>
          <fieldset disabled={busy} className="space-y-6">
            <div className="space-y-3">
              <h3 className="font-medium">Offerings</h3>
              {draft.offerings.map((entry, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border border-border p-4"
                >
                  <Label htmlFor={`offering-${index}`}>Offering name</Label>
                  <Input
                    id={`offering-${index}`}
                    value={entry.name}
                    maxLength={200}
                    required
                    onChange={(event) =>
                      change({
                        ...draft,
                        offerings: draft.offerings.map((item, i) =>
                          i === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`details-${index}`}>
                    Approved supply details
                  </Label>
                  <Textarea
                    id={`details-${index}`}
                    value={entry.details}
                    maxLength={4000}
                    required
                    onChange={(event) =>
                      change({
                        ...draft,
                        offerings: draft.offerings.map((item, i) =>
                          i === index
                            ? { ...item, details: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      change({
                        ...draft,
                        offerings: draft.offerings.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove offering {index + 1} from draft
                  </Button>
                  <InquiryReplyUse
                    id={`offering-use-${index}`}
                    value={entry.inquiryReply}
                    onChange={(inquiryReply) =>
                      change({
                        ...draft,
                        offerings: draft.offerings.map((item, i) =>
                          i === index ? { ...item, inquiryReply } : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={draft.offerings.length >= 50}
                onClick={() =>
                  change({
                    ...draft,
                    offerings: [...draft.offerings, { name: "", details: "" }],
                  })
                }
              >
                Add offering
              </Button>
            </div>
            <div className="space-y-3">
              <h3 className="font-medium">Business answers</h3>
              {draft.answers.map((entry, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border border-border p-4"
                >
                  <Label htmlFor={`question-${index}`}>Question</Label>
                  <Input
                    id={`question-${index}`}
                    value={entry.question}
                    required
                    maxLength={200}
                    onChange={(event) =>
                      change({
                        ...draft,
                        answers: draft.answers.map((item, i) =>
                          i === index
                            ? { ...item, question: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`answer-${index}`}>Answer to approve</Label>
                  <Textarea
                    id={`answer-${index}`}
                    value={entry.answer}
                    required
                    maxLength={4000}
                    onChange={(event) =>
                      change({
                        ...draft,
                        answers: draft.answers.map((item, i) =>
                          i === index
                            ? { ...item, answer: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      change({
                        ...draft,
                        answers: draft.answers.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove answer {index + 1} from draft
                  </Button>
                  <InquiryReplyUse
                    id={`answer-use-${index}`}
                    value={entry.inquiryReply}
                    onChange={(inquiryReply) =>
                      change({
                        ...draft,
                        answers: draft.answers.map((item, i) =>
                          i === index ? { ...item, inquiryReply } : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={draft.answers.length >= 100}
                onClick={() =>
                  change({
                    ...draft,
                    answers: [...draft.answers, { question: "", answer: "" }],
                  })
                }
              >
                Add answer
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-missing">
                Missing-information questions (one per line)
              </Label>
              <Textarea
                id="knowledge-missing"
                value={missing}
                maxLength={20100}
                onChange={(event) => {
                  setMissing(event.target.value);
                  setDirty(true);
                  setReviewed(false);
                }}
              />
              <p className="text-sm text-muted-foreground">
                Up to 100 questions, 200 characters each. Leave answers absent
                until reviewed.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-goal">Conversion goal</Label>
              <NativeSelect
                id="knowledge-goal"
                value={draft.goal}
                onChange={(event) =>
                  change({
                    ...draft,
                    goal: event.target.value === "booking" ? "booking" : "rfq",
                  })
                }
              >
                <option value="rfq">Native quotation request (RFQ)</option>
                <option value="booking">Appointment booking</option>
              </NativeSelect>
            </div>
            <div className="space-y-3">
              <h3 className="font-medium">Qualification requirements</h3>
              <p className="text-sm text-muted-foreground">
                Use stable field keys so workflows can reuse previously
                collected values. Labels describe the information to ask for.
              </p>
              {draft.qualification.map((field, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-xl border border-border p-4"
                >
                  <Label htmlFor={`key-${index}`}>Field key</Label>
                  <Input
                    id={`key-${index}`}
                    value={field.key}
                    pattern="[a-z][a-z0-9_]{0,59}"
                    required
                    maxLength={60}
                    onChange={(event) =>
                      change({
                        ...draft,
                        qualification: draft.qualification.map((item, i) =>
                          i === index
                            ? { ...item, key: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Start with a lowercase letter; use lowercase letters,
                    numbers and underscores.
                  </p>
                  <Label htmlFor={`field-${index}`}>
                    Question or field label
                  </Label>
                  <Input
                    id={`field-${index}`}
                    value={field.label}
                    required
                    maxLength={200}
                    onChange={(event) =>
                      change({
                        ...draft,
                        qualification: draft.qualification.map((item, i) =>
                          i === index
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`type-${index}`}>Value type</Label>
                  <NativeSelect
                    id={`type-${index}`}
                    value={field.type}
                    onChange={(event) => {
                      const type = z
                        .enum(["text", "number", "email"])
                        .parse(event.target.value);
                      change({
                        ...draft,
                        qualification: draft.qualification.map((item, i) =>
                          i === index ? { ...item, type } : item,
                        ),
                      });
                    }}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="email">Email address</option>
                  </NativeSelect>
                  <Label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 accent-primary"
                      checked={field.required}
                      onChange={(event) =>
                        change({
                          ...draft,
                          qualification: draft.qualification.map((item, i) =>
                            i === index
                              ? { ...item, required: event.target.checked }
                              : item,
                          ),
                        })
                      }
                    />
                    Required before progressing
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      change({
                        ...draft,
                        qualification: draft.qualification.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove requirement {index + 1} from draft
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={draft.qualification.length >= 50}
                onClick={() =>
                  change({
                    ...draft,
                    qualification: [
                      ...draft.qualification,
                      { key: "", label: "", type: "text", required: true },
                    ],
                  })
                }
              >
                Add qualification field
              </Button>
            </div>
            <div className="space-y-3">
              <h3 className="font-medium">Human escalation destination</h3>
              <Label htmlFor="escalation-name">Person or team name</Label>
              <Input
                id="escalation-name"
                value={draft.escalation.name}
                required
                maxLength={200}
                onChange={(event) =>
                  change({
                    ...draft,
                    escalation: {
                      ...draft.escalation,
                      name: event.target.value,
                    },
                  })
                }
              />
              <Label htmlFor="escalation-email">Contact email</Label>
              <Input
                id="escalation-email"
                type="email"
                value={draft.escalation.email}
                required
                maxLength={254}
                onChange={(event) =>
                  change({
                    ...draft,
                    escalation: {
                      ...draft.escalation,
                      email: event.target.value,
                    },
                  })
                }
              />
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="knowledge-note">
              Reason for this save, approval or retirement
            </Label>
            <Textarea
              id="knowledge-note"
              value={note}
              required
              maxLength={1000}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {!validated.success && (
            <p className="text-sm text-muted-foreground">
              {validated.error.issues[0]?.message}{" "}
              {validated.error.issues[0]?.path.join(" › ")}
            </p>
          )}
          <Button disabled={busy || !validated.success} type="submit">
            {busy ? "Saving…" : "Save draft"}
          </Button>
          {dirty && (
            <p className="text-sm text-muted-foreground">
              Unsaved changes. Save before reviewing and approving.
            </p>
          )}
          {latest?.action === "draft" && (
            <section
              className="space-y-4 border-t border-border pt-6"
              aria-labelledby="review-draft"
            >
              <h3 id="review-draft" className="text-lg font-semibold">
                Review saved draft · revision {latest.version}
              </h3>
              <KnowledgeSummary configuration={latest.configuration} />
              <Label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={reviewed}
                  disabled={busy || dirty}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                I reviewed this saved revision, including its goal, requirements
                and escalation contact.
              </Label>
              <Button
                type="button"
                disabled={busy || dirty || !reviewed || !note.trim()}
                onClick={() => void send("approve")}
              >
                Approve saved revision
              </Button>
            </section>
          )}
          {state.current && (
            <div className="space-y-3 border-t border-border pt-6">
              <p className="text-sm text-muted-foreground">
                Retire the whole current configuration to stop its use. History
                is retained. Enter a reason above.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive"
                    disabled={busy || dirty || !note.trim()}
                  >
                    Retire current configuration…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <div className="space-y-3">
                    <AlertDialogTitle>
                      Retire approved configuration?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Workflows will have no active approved knowledge until a
                      new draft is reviewed and approved. Revision history
                      remains available.
                    </AlertDialogDescription>
                  </div>
                  <div className="flex flex-wrap justify-end gap-3">
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void send("retire")}>
                      Retire configuration
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                {needsMfa && (
                  <>
                    {" "}
                    <Link
                      href="/security"
                      target="_blank"
                      className="underline"
                    >
                      Open Security in a new tab
                    </Link>
                  </>
                )}
                {conflict && (
                  <>
                    {" "}
                    <a
                      href={`/businesses/${businessId}/knowledge`}
                      className="underline"
                    >
                      Reload saved version (discards local edits)
                    </a>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          {message && (
            <p role="status" className="text-sm text-success">
              {message}
            </p>
          )}
        </form>
      )}
      <section className="space-y-4" aria-labelledby="knowledge-history">
        <h2 id="knowledge-history" className="text-xl font-semibold">
          Attributable history
        </h2>
        {state.history.length ? (
          [...state.history].reverse().map((revision) => (
            <details
              key={revision.id}
              className="rounded-xl border border-border bg-card p-5"
            >
              <summary className="min-h-11 cursor-pointer wrap-anywhere">
                <span className="font-medium">
                  Revision {revision.version} · {revision.action}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {revision.actorName} · {revision.at}
                </span>
              </summary>
              <div className="mt-4 space-y-5">
                <p className="whitespace-pre-wrap wrap-anywhere">
                  {revision.note}
                </p>
                <p className="text-xs text-muted-foreground wrap-anywhere">
                  Actor ID: {revision.actorId}
                </p>
                <KnowledgeSummary configuration={revision.configuration} />
                {state.canManage && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => {
                      change(revision.configuration);
                      setMissing(
                        revision.configuration.missingInformation.join("\n"),
                      );
                      setMessage(
                        "Historical content loaded into the editor. Save a new draft and review it before approval.",
                      );
                    }}
                  >
                    Use as a new draft
                  </Button>
                )}
              </div>
            </details>
          ))
        ) : (
          <p className="text-muted-foreground">
            No revisions yet. Save your first draft to begin the review history.
          </p>
        )}
      </section>
    </div>
  );
}
