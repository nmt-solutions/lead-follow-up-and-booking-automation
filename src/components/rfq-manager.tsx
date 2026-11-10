"use client";
import { Field, FieldGroup } from "./ui/field";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  rfqWorkspaceSchema,
  saveRfqSchema,
  type RfqWorkspace,
  type SaveRfq,
} from "@/models/rfq";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";

const responseSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: rfqWorkspaceSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const statusLabels = {
  complete: "Requirements complete",
  incomplete: "Missing requirements",
  review_required: "Review required",
};
export function RfqManager({
  businessId,
  opportunityId,
  state,
}: {
  businessId: string;
  opportunityId: string;
  state: RfqWorkspace;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(() =>
    state.requirements.map(
      (r) =>
        state.current?.fields.find((f) => f.key === r.key) ??
        state.suggestions.find((f) => f.key === r.key) ?? {
          key: r.key,
          value: "",
          messageId: null,
          quote: null,
        },
    ),
  );
  const [offering, setOffering] = useState(
    state.current?.offering.name ??
      (state.offerings.length === 1 ? state.offerings[0].name : ""),
  );
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState(state.nextAction);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const command = useRef<{ payload: string; key: string } | null>(null);
  const prefix = `rfq-${opportunityId}`;
  function change(key: string, patch: Partial<SaveRfq["fields"][number]>) {
    setFields((current) =>
      current.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setRecovery(null);
    const payload = {
      expectedVersion: state.current?.version ?? 0,
      expectedKnowledgeVersion: state.knowledgeVersion,
      expectedControlVersion: state.controlVersion,
      expectedContextKey: state.contextKey,
      offering,
      fields: fields.filter((f) => f.value.trim()),
      note,
      nextAction,
    };
    const serialized = JSON.stringify(payload);
    if (command.current?.payload !== serialized)
      command.current = { payload: serialized, key: crypto.randomUUID() };
    const input = saveRfqSchema.safeParse({
      ...payload,
      requestKey: command.current.key,
    });
    if (!input.success) {
      setError(
        "Choose an approved offering, enter a review note and next action, and check each value and evidence excerpt.",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/opportunities/${opportunityId}/rfq`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.data),
        },
      );
      const result = responseSchema.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The saved result could not be confirmed. Reload to inspect the request before retrying.",
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
            ? "Requirements, ownership or this request changed. Reload and review the current version."
            : code === "INVALID_INPUT"
              ? "Check the configured field types and use an exact excerpt from a message associated with this need."
              : code === "MFA_REQUIRED"
                ? "Verify your session in Security, then retry."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again, then retry."
                  : "The request could not be saved. Check your Business access and current Opportunity ownership.",
        );
        return;
      }
      setNotice(
        "Quotation request saved. Requirements remain available for human review.",
      );
      router.refresh();
    } catch {
      setError(
        "The save could not be confirmed. Reload to inspect persisted history before retrying.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="flex flex-col gap-4 border-t pt-5"
      aria-labelledby={`${prefix}-title`}
    >
      <h3 id={`${prefix}-title`} className="font-semibold">
        Quotation request
      </h3>
      <p className="text-sm text-muted-foreground">
        Capture requirements for this purchasing need. Completeness does not
        issue a quotation, accept a price or order, confirm an appointment, or
        record a sale. No calendar connection is needed.
      </p>
      <Badge>
        {state.current
          ? statusLabels[state.current.status]
          : "No request captured"}
      </Badge>
      <p className="text-sm">
        Responsible owner: {state.ownerName ?? state.ownerId ?? "Unassigned"}
      </p>
      <p className="text-sm font-medium">Next action: {state.nextAction}</p>
      {state.current && (
        <>
          <p className="text-sm text-muted-foreground">
            Request {state.current.id} · Revision {state.current.version} ·{" "}
            {state.current.offering.name}
          </p>
          {!!state.current.missing.length && (
            <p className="text-sm">
              Missing:{" "}
              {state.current.missing
                .map(
                  (key) =>
                    state.requirements.find((r) => r.key === key)?.label ?? key,
                )
                .join(", ")}
            </p>
          )}
          {state.current.issues.map((issue) => (
            <p key={issue} className="text-sm text-warning">
              {issue}
            </p>
          ))}
        </>
      )}
      {state.setupReason && (
        <p className="text-sm text-warning">
          {state.setupReason}{" "}
          <Link
            href={`/businesses/${businessId}/knowledge`}
            className="text-primary underline"
          >
            Business knowledge
          </Link>
        </p>
      )}
      {!state.canSave && !state.setupReason && (
        <p className="text-sm text-muted-foreground">
          Only the current accountable owner can capture or review this request.
          Use Opportunity control to take ownership.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
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
                className="underline"
              >
                Open {recovery === "/security" ? "Security" : "sign in"} (new
                tab)
              </Link>
            </>
          )}
        </Alert>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          {state.current
            ? "Review and update requirements"
            : "Capture requirements"}
        </summary>
        <form onSubmit={save} className="flex flex-col gap-5 pt-3">
          <FieldGroup className="gap-5">
            <p className="text-sm text-muted-foreground">
              Approved qualification fields define completeness. Blank values
              remain missing. Sourced inquiry facts are prefilled for review.
              Saving keeps this Opportunity under human control and pauses
              pending automation.
            </p>
            <fieldset
              disabled={pending || !state.canSave}
              className="flex flex-col min-w-0 gap-5"
            >
              <Field className="flex flex-col gap-2">
                <Label htmlFor={`${prefix}-offering`}>Product or service</Label>
                <NativeSelect
                  id={`${prefix}-offering`}
                  required
                  value={offering}
                  onChange={(e) => setOffering(e.target.value)}
                >
                  <option value="">Choose an approved offering</option>
                  {state.offerings.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {state.requirements.map((rule) => {
                const field = fields.find((f) => f.key === rule.key)!;
                const fieldId = `${prefix}-${rule.key}`;
                return (
                  <Field
                    key={rule.key}
                    className="flex flex-col gap-2 rounded-xl border p-4"
                  >
                    <Label htmlFor={fieldId}>
                      {rule.label}{" "}
                      {rule.required
                        ? "(required for completeness)"
                        : "(optional)"}
                    </Label>
                    {rule.type === "text" ? (
                      <Textarea
                        id={fieldId}
                        value={field.value}
                        maxLength={4000}
                        onChange={(e) =>
                          change(rule.key, {
                            value: e.target.value,
                            messageId: null,
                            quote: null,
                          })
                        }
                      />
                    ) : (
                      <Input
                        id={fieldId}
                        type={rule.type}
                        step={rule.type === "number" ? "any" : undefined}
                        value={field.value}
                        maxLength={4000}
                        onChange={(e) =>
                          change(rule.key, {
                            value: e.target.value,
                            messageId: null,
                            quote: null,
                          })
                        }
                      />
                    )}
                    {!field.value.trim() && rule.required && (
                      <p className="text-sm text-muted-foreground">
                        Missing requirement; you can save progress.
                      </p>
                    )}
                    <Label htmlFor={`${fieldId}-source`}>
                      Supporting message
                    </Label>
                    <NativeSelect
                      id={`${fieldId}-source`}
                      value={field.messageId ?? ""}
                      onChange={(e) =>
                        change(rule.key, {
                          messageId: e.target.value || null,
                          quote: e.target.value ? "" : null,
                        })
                      }
                    >
                      <option value="">
                        Manual entry attributed to this review
                      </option>
                      {state.messages.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.text.slice(0, 90)} · {m.id}
                        </option>
                      ))}
                    </NativeSelect>
                    {field.messageId && (
                      <>
                        <Label htmlFor={`${fieldId}-quote`}>
                          Exact evidence excerpt
                        </Label>
                        <Textarea
                          id={`${fieldId}-quote`}
                          value={field.quote ?? ""}
                          maxLength={4000}
                          required={!!field.value.trim()}
                          onChange={(e) =>
                            change(rule.key, { quote: e.target.value })
                          }
                        />
                        <p
                          className="whitespace-pre-wrap text-sm text-muted-foreground"
                          dir="auto"
                        >
                          {state.messages.find((m) => m.id === field.messageId)
                            ?.text ??
                            "This source is no longer associated with this need. Choose current evidence or review as a manual entry."}
                        </p>
                      </>
                    )}
                  </Field>
                );
              })}
              <Field className="flex flex-col gap-2">
                <Label htmlFor={`${prefix}-note`}>Review note</Label>
                <Textarea
                  id={`${prefix}-note`}
                  required
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              <Field className="flex flex-col gap-2">
                <Label htmlFor={`${prefix}-next`}>Next action</Label>
                <Textarea
                  id={`${prefix}-next`}
                  required
                  maxLength={1000}
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                />
              </Field>
              <Button type="submit" aria-busy={pending}>
                {pending
                  ? "Saving request…"
                  : state.current
                    ? "Save RFQ review"
                    : "Capture quotation request"}
              </Button>
            </fieldset>
          </FieldGroup>
        </form>
      </details>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => router.refresh()}
      >
        Reload current request
      </Button>
      {!!state.history.length && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Request review history ({state.history.length})
          </summary>
          <ol className="flex flex-col gap-4">
            {state.history.map((revision) => (
              <li
                key={revision.revisionId}
                className="flex flex-col gap-2 rounded-xl border p-4 text-sm"
              >
                <p className="font-medium">
                  Revision {revision.version}: {revision.offering.name} ·{" "}
                  {statusLabels[revision.completeness]}
                </p>
                <p>
                  By {revision.actorName} ·{" "}
                  <time dateTime={revision.at}>{revision.at}</time>
                </p>
                <p>{revision.note}</p>
                <p>Next action: {revision.nextAction}</p>
                <p className="text-muted-foreground">
                  Approved knowledge revision {revision.knowledgeVersion}.
                  Status reflects this historical review.
                </p>
                <dl className="flex flex-col gap-2">
                  {revision.fields.map((field) => (
                    <div key={field.key}>
                      <dt className="font-medium">
                        {revision.requirements.find((r) => r.key === field.key)
                          ?.label ?? field.key}
                      </dt>
                      <dd className="whitespace-pre-wrap" dir="auto">
                        {field.value}
                      </dd>
                      <dd className="text-muted-foreground">
                        {field.messageId
                          ? `Message ${field.messageId}: ${field.quote}`
                          : "Manual entry recorded by this reviewer"}
                      </dd>
                    </div>
                  ))}
                </dl>
                {!!revision.missing.length && (
                  <p>Missing at review: {revision.missing.join(", ")}</p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
