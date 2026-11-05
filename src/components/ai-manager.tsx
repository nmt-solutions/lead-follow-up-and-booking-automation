"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  aiDraftSchema,
  aiExecutionViewSchema,
  aiWorkspaceSchema,
  type AiWorkspace,
  type AiProfile,
  type AiExecutionView,
} from "@/models/ai";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";

const limitFields = [
  ["maxInputChars", "Maximum input characters"],
  ["maxOutputTokens", "Maximum output tokens"],
  ["maxAttempts", "Combined attempts per task (1–5)"],
  ["maxFallbackAttempts", "System fallback attempts per task (0–4)"],
  ["deadlineMs", "Total task deadline in milliseconds (100–60000)"],
  ["allowanceAttempts", "Combined attempt allowance for this profile"],
  ["fallbackAllowanceAttempts", "System fallback allowance for this profile"],
] satisfies [keyof AiProfile["limits"], string][];
const failureSchema = z.object({
  message: z.string(),
  requestId: z.string().optional(),
});

export function AiManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: AiWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(
    initialState.profiles.at(-1)?.id ?? "",
  );
  const [task, setTask] = useState<"extraction" | "drafting">("extraction");
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<AiExecutionView | null>(null);
  const previewKey = useRef<{ content: string; key: string } | null>(null);
  const selected = state.profiles.find((row) => row.id === selectedId);
  async function request(path: string, value?: unknown, method = "POST") {
    const response = await fetch(`/api/businesses/${businessId}/ai${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const json: unknown = await response.json();
    if (!response.ok) {
      const failure = failureSchema.safeParse(json);
      throw new Error(
        failure.success
          ? `${failure.data.message}${failure.data.requestId ? ` Reference: ${failure.data.requestId}` : ""}`
          : "Unable to complete this action. Refresh and try again.",
      );
    }
    return json;
  }
  async function refresh() {
    const parsed = z
      .object({ success: z.literal(true), data: aiWorkspaceSchema })
      .safeParse(await request("", undefined, "GET"));
    if (!parsed.success)
      throw new Error(
        "The AI workspace response was invalid. Refresh and try again.",
      );
    setState(parsed.data.data);
    return parsed.data.data;
  }
  async function act(operation: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await operation();
      setStatus(message);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft(form: HTMLFormElement) {
    const values = new FormData(form);
    const input = {
      expectedVersion: state.profiles.at(-1)?.version ?? 0,
      note: values.get("draftNote"),
      profile: {
        name: values.get("name"),
        configurationRevision: state.configuration?.revision,
        providers: ["openai"],
        extraction: {
          model: values.get("extraction"),
          schema: "discovery-review-v1",
        },
        drafting: { model: values.get("drafting"), schema: "sales-draft-v1" },
        limits: Object.fromEntries(
          limitFields.map(([key]) => [
            key,
            values.get(key) === "" ? undefined : Number(values.get(key)),
          ]),
        ),
      },
    };
    if (!aiDraftSchema.safeParse(input).success) {
      setError(
        "Complete every model, limit and review-note field. Fallback must fit the combined attempt cap and allowance.",
      );
      return;
    }
    await act(async () => {
      await request("", input, "PUT");
      const updated = await refresh();
      setSelectedId(updated.profiles.at(-1)?.id ?? "");
    }, "Draft saved as a new immutable version. Run and review both representative tasks before activation.");
  }
  const displayed = preview
    ? (state.executions.find((row) => row.id === preview.id) ?? preview)
    : null;
  return (
    <div className="space-y-8">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link href="/security" className="underline">
              Open Security
            </Link>{" "}
            if session verification is required.
          </AlertDescription>
        </Alert>
      )}
      {status && (
        <p
          role="status"
          className="rounded-xl border border-border bg-card p-4"
        >
          {status}
        </p>
      )}
      <section
        className="space-y-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="ai-setup"
      >
        <h2 id="ai-setup" className="text-xl font-semibold">
          Readiness and funding
        </h2>
        <p>
          Active shared profile:{" "}
          <strong>
            {state.profiles.find((row) => row.id === state.activation.profileId)
              ?.profile.name ?? "None approved"}
          </strong>
        </p>
        {state.setup.length > 0 && (
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            {state.setup.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">OpenAI API funding</dt>
            <dd className="wrap-anywhere text-muted-foreground">
              {state.configuration
                ? `${state.configuration.openaiFunding.source.replaceAll("_", " ")} · ${state.configuration.openaiFunding.state} · ${state.configuration.openaiFunding.reference}`
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Existing subscription allocation</dt>
            <dd className="text-muted-foreground">
              Separate from API funding. This application does not consume or
              estimate ChatGPT or Codex subscription allocation.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Gateway credit and fallback charges</dt>
            <dd className="wrap-anywhere text-muted-foreground">
              {state.configuration
                ? `${state.configuration.gatewayFunding.state} · ${state.configuration.gatewayFunding.reference}`
                : "Not configured"}
              . System fallback requires an approved numeric allowance.
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          Funding evidence records operator confirmation; a successful request
          does not prove which API credit grant funded it. Exa retrieval and
          source permissions remain independent of model selection.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await refresh();
            }, "AI workspace refreshed.")
          }
        >
          Refresh status
        </Button>
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            This Business’s profile activation history
          </summary>
          {state.activationHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No profile activation has been reviewed through this Business.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {state.activationHistory.map((row) => (
                <li key={row.version} className="wrap-anywhere">
                  Activation {row.version} · {row.at} · Operator {row.actorId}
                  <p className="text-muted-foreground">{row.note}</p>
                </li>
              ))}
            </ul>
          )}
        </details>
      </section>
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="ai-draft"
      >
        <h2 id="ai-draft" className="text-xl font-semibold">
          Prepare a shared profile
        </h2>
        <p className="text-muted-foreground">
          Each save creates a version. Limits apply to all Businesses using that
          version, including previews and failed or uncertain attempts. Saving
          never replaces the active version.
        </p>
        <form
          key={selected?.id ?? "new"}
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void saveDraft(event.currentTarget);
          }}
        >
          <fieldset
            disabled={busy || !state.configuration}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="ai-name">Profile name</Label>
              <Input
                id="ai-name"
                name="name"
                required
                maxLength={120}
                defaultValue={selected?.profile.name ?? ""}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {(["extraction", "drafting"] as const).map((value) => (
                <div className="space-y-2" key={value}>
                  <Label htmlFor={`ai-${value}`}>
                    {value === "extraction"
                      ? "Extraction model"
                      : "Drafting model"}
                  </Label>
                  <NativeSelect
                    id={`ai-${value}`}
                    name={value}
                    required
                    defaultValue={selected?.profile[value].model ?? ""}
                  >
                    <option value="">Select an approved model</option>
                    {state.configuration?.models
                      .filter((model) => model.tasks.includes(value))
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Approved provider: OpenAI. Extraction uses the evidence-review
              schema; drafting uses the sales-draft schema. Other providers and
              capabilities require operator configuration.
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {limitFields.map(([key, title]) => (
                <div className="space-y-2" key={key}>
                  <Label htmlFor={`ai-${key}`}>{title}</Label>
                  <Input
                    id={`ai-${key}`}
                    name={key}
                    type="number"
                    step="1"
                    min={
                      key.includes("Fallback") ||
                      key === "fallbackAllowanceAttempts"
                        ? 0
                        : 1
                    }
                    required
                    defaultValue={selected?.profile.limits[key] ?? ""}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-draft-note">Reason for this version</Label>
              <Textarea
                id="ai-draft-note"
                name="draftNote"
                required
                maxLength={1000}
              />
            </div>
            <Button disabled={busy || !state.configuration}>
              {busy ? "Working…" : "Save profile draft"}
            </Button>
          </fieldset>
        </form>
      </section>
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="ai-preview"
      >
        <h2 id="ai-preview" className="text-xl font-semibold">
          Preview reviewed inputs
        </h2>
        <div className="space-y-2">
          <Label htmlFor="ai-version">Profile version</Label>
          <NativeSelect
            id="ai-version"
            value={selectedId}
            disabled={busy}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setPreview(null);
            }}
          >
            <option value="">Select a profile</option>
            {state.profiles.map((row) => (
              <option key={row.id} value={row.id}>
                Version {row.version} · {row.profile.name}
                {row.id === state.activation.profileId ? " · Active" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        {selected && (
          <p className="text-sm text-muted-foreground">
            Used {selected.usedAttempts} of{" "}
            {selected.profile.limits.allowanceAttempts} combined attempts;{" "}
            {selected.usedFallbackAttempts} of{" "}
            {selected.profile.limits.fallbackAllowanceAttempts} system fallback
            attempts. Per task: at most {selected.profile.limits.maxAttempts}{" "}
            combined attempts, including at most{" "}
            {selected.profile.limits.maxFallbackAttempts} fallback attempts.
          </p>
        )}
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const input = {
                profileId: selectedId,
                expectedKnowledgeVersion: state.knowledgeVersion,
                confirmReviewedInput: reviewed,
                confirmBusinessContext: authorized,
                sample: { task, label, text },
              };
              const content = JSON.stringify(input);
              if (previewKey.current?.content !== content)
                previewKey.current = { content, key: crypto.randomUUID() };
              const response = z
                .object({
                  success: z.literal(true),
                  data: aiExecutionViewSchema,
                })
                .safeParse(
                  await request("/preview", {
                    ...input,
                    requestKey: previewKey.current.key,
                  }),
                );
              if (!response.success)
                throw new Error(
                  "The preview response was invalid. Refresh status before retrying.",
                );
              setPreview(response.data.data);
              await refresh();
            }, "Preview recorded. Review the output and usage below; no message was sent.");
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="ai-task">Representative task</Label>
            <NativeSelect
              id="ai-task"
              value={task}
              disabled={busy}
              onChange={(event) => {
                if (
                  event.target.value === "extraction" ||
                  event.target.value === "drafting"
                )
                  setTask(event.target.value);
                setReviewed(false);
              }}
            >
              <option value="extraction">Evidence extraction</option>
              <option value="drafting">Sales reply draft</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-label">Sample label</Label>
            <Input
              id="ai-label"
              required
              maxLength={120}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setReviewed(false);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-text">
              Reviewed source text or inquiry sample
            </Label>
            <Textarea
              id="ai-text"
              required
              maxLength={40000}
              rows={6}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setReviewed(false);
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Uses current approved Business knowledge, version{" "}
            {state.knowledgeVersion ?? "not available"}. Sample instructions
            cannot change policies or trigger messages.
          </p>
          <label className="flex min-h-11 items-start gap-3">
            <input
              className="mt-1 size-5"
              type="checkbox"
              required
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>
              I reviewed this representative sample and its use with the
              approved Business knowledge.
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input
              className="mt-1 size-5"
              type="checkbox"
              required
              checked={authorized}
              onChange={(event) => setAuthorized(event.target.checked)}
            />
            <span>
              I authorize this Business context to be sent to the approved AI
              provider for this preview.
            </span>
          </label>
          <Button
            disabled={
              busy ||
              !selected ||
              !state.knowledgeVersion ||
              !reviewed ||
              !authorized
            }
          >
            {busy ? "Working…" : "Run preview without sending"}
          </Button>
        </form>
        {displayed && <ExecutionResult execution={displayed} />}
        <Button
          variant="outline"
          disabled={busy || !displayed}
          onClick={() => {
            previewKey.current = null;
            setPreview(null);
            setReviewed(false);
            setStatus(
              "Review the sample again before authorizing a new preview and its attempt allowance.",
            );
          }}
        >
          Prepare another preview
        </Button>
        <div className="space-y-2">
          <Label htmlFor="ai-review-note">
            Output review or activation note
          </Label>
          <Textarea
            id="ai-review-note"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={
              busy ||
              !displayed ||
              displayed.status !== "succeeded" ||
              Boolean(displayed.review) ||
              !note.trim()
            }
            onClick={() =>
              act(async () => {
                await request("/review", {
                  executionId: displayed?.id,
                  accepted: true,
                  confirmRepresentative: true,
                  note,
                });
                await refresh();
              }, "Representative output accepted for this exact profile and knowledge version.")
            }
          >
            Accept representative output
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              !displayed ||
              displayed.status !== "succeeded" ||
              Boolean(displayed.review) ||
              !note.trim()
            }
            onClick={() =>
              act(async () => {
                await request("/review", {
                  executionId: displayed?.id,
                  accepted: false,
                  confirmRepresentative: true,
                  note,
                });
                await refresh();
              }, "Output rejected. Run a new preview or prepare a revised profile.")
            }
          >
            Reject output
          </Button>
          <Button
            disabled={
              busy ||
              !selected ||
              !note.trim() ||
              !(["extraction", "drafting"] as const).every((value) =>
                state.executions.some(
                  (row) =>
                    row.profileId === selected.id &&
                    row.task === value &&
                    row.kind === "preview" &&
                    row.status === "succeeded" &&
                    row.review?.accepted &&
                    row.knowledgeVersion === state.knowledgeVersion,
                ),
              )
            }
            onClick={() =>
              act(async () => {
                await request("/activate", {
                  profileId: selectedId,
                  expectedActivationVersion: state.activation.version,
                  note,
                });
                await refresh();
              }, "Shared profile activated after both representative output reviews.")
            }
          >
            Activate reviewed profile
          </Button>
        </div>
      </section>
      <section className="space-y-4" aria-labelledby="ai-history">
        <h2 id="ai-history" className="text-xl font-semibold">
          This Business’s task history
        </h2>
        {state.executions.length === 0 ? (
          <p className="text-muted-foreground">
            No previews or workflow tasks recorded. Prepare a profile and
            preview a reviewed sample.
          </p>
        ) : (
          state.executions.map((row) => (
            <div
              key={row.id}
              className="space-y-3 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Badge>
                  {row.kind} · {row.task}
                </Badge>
                <span className="wrap-anywhere">{row.sample.label}</span>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(row.profileId);
                    setPreview(row);
                  }}
                >
                  Inspect result
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {row.at} · {row.status.replaceAll("_", " ")} ·{" "}
                {row.attempts.length} attempts
                {row.review
                  ? ` · ${row.review.accepted ? "Accepted" : "Rejected"}: ${row.review.note}`
                  : " · Output not reviewed"}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function ExecutionResult({ execution }: { execution: AiExecutionView }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted p-5 wrap-anywhere">
      <h3 className="font-semibold">
        {execution.sample.label} · {execution.status.replaceAll("_", " ")}
      </h3>
      {execution.failure && (
        <p>
          Stop reason: {execution.failure.replaceAll("_", " ")}. Review setup or
          usage before a new attempt.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Knowledge version {execution.knowledgeVersion}. AI output is untrusted
        and requires review. Running or uncertain work is never automatically
        repeated.
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Reviewed sample
        </summary>
        <p className="whitespace-pre-wrap">{execution.sample.text}</p>
      </details>
      {execution.output &&
        ("draft" in execution.output ? (
          <p className="whitespace-pre-wrap">{execution.output.draft}</p>
        ) : "kind" in execution.output ? (
          <p>
            Inquiry answer selections and qualification proposals are available
            in the associated inbox Opportunity.
          </p>
        ) : (
          <dl className="space-y-3">
            <div>
              <dt className="font-medium">Fit assessment</dt>
              <dd>{execution.output.reason}</dd>
            </div>
            <div>
              <dt className="font-medium">Exact evidence</dt>
              <dd>{execution.output.evidenceQuote}</dd>
            </div>
            <div>
              <dt className="font-medium">Uncertainty</dt>
              <dd>{execution.output.uncertainty}</dd>
            </div>
          </dl>
        ))}
      {execution.output && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            Inspect complete proposed output
          </summary>
          <pre className="whitespace-pre-wrap text-sm wrap-anywhere">
            {JSON.stringify(execution.output, null, 2)}
          </pre>
        </details>
      )}
      {execution.attempts.map((row) => (
        <div
          key={row.id}
          className="space-y-1 border-t border-border pt-3 text-sm"
        >
          <p className="font-medium">
            Attempt {row.number}:{" "}
            {row.route === "operator_byok"
              ? "Operator API key"
              : "Approved Gateway system fallback"}{" "}
            · {row.outcome}
          </p>
          <p>
            {row.metrics.provider ?? "Provider unknown"} ·{" "}
            {row.metrics.model ?? "Model unconfirmed"} · Credential source:{" "}
            {row.metrics.credentialSource.replaceAll("_", " ")} ·{" "}
            {row.latencyMs ?? "Unknown"} ms
          </p>
          <p>
            Input tokens: {row.metrics.inputTokens ?? "Unknown"}; output tokens:{" "}
            {row.metrics.outputTokens ?? "Unknown"}
          </p>
          <p>
            Provider-reported API cost:{" "}
            {row.metrics.providerCostUsd === null
              ? "Unknown"
              : `USD ${row.metrics.providerCostUsd}`}
            ; Gateway debit:{" "}
            {row.metrics.gatewayCostUsd === null
              ? "Unknown"
              : `USD ${row.metrics.gatewayCostUsd}`}
          </p>
          <p className="text-muted-foreground">
            Funding evidence: {row.fundingSource.replaceAll("_", " ")} ·{" "}
            {row.fundingReference}. Separate meters; no inferred combined bill
            or subscription deduction.
          </p>
        </div>
      ))}
    </div>
  );
}
