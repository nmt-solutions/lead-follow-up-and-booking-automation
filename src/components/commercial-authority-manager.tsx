"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  commercialActions,
  commercialActionLabels,
  commercialChangeSchema,
  commercialCurrencies,
  commercialPolicySchema,
  commercialRuleSchema,
  commercialWorkspaceSchema,
  commercialEvaluationResultSchema,
  decimalMoney,
  moneyFromDecimal,
  discountFromPercent,
  percentDiscount,
  type CommercialPolicy,
  type CommercialWorkspace,
} from "@/models/commercial-authority";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";

const ruleFormSchema = z
  .object({
    mode: z.enum(["disabled", "approval", "automatic"]),
    currency: z.string(),
    amount: z.string(),
    discount: z.string(),
    ownerId: z.string(),
  })
  .transform((draft, context) => {
    const amountLimit = moneyFromDecimal(draft.currency, draft.amount);
    if ((draft.currency || draft.amount) && !amountLimit)
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message:
          "Select a currency and enter a nonnegative amount with that currency's decimal precision.",
      });
    const discountLimitBps = discountFromPercent(draft.discount);
    if (draft.discount && discountLimitBps === null)
      context.addIssue({
        code: "custom",
        path: ["discount"],
        message:
          "Enter a discount from 0 to 100%, with at most two decimal places.",
      });
    return {
      automationEnabled: draft.mode !== "disabled",
      approvalRequired: draft.mode !== "automatic",
      amountLimit,
      discountLimitBps,
      escalationOwnerId: draft.ownerId || null,
    };
  })
  .pipe(commercialRuleSchema);
const policyFormSchema = z
  .object({
    prices: ruleFormSchema,
    quotations: ruleFormSchema,
    discounts: ruleFormSchema,
    orders: ruleFormSchema,
  })
  .pipe(commercialPolicySchema);
type RuleDraft = z.input<typeof ruleFormSchema>;
function draftRule(rule: CommercialPolicy["prices"]): RuleDraft {
  return {
    mode: !rule.automationEnabled
      ? "disabled"
      : rule.approvalRequired
        ? "approval"
        : "automatic",
    currency: rule.amountLimit?.currency ?? "",
    amount: rule.amountLimit ? decimalMoney(rule.amountLimit) : "",
    discount:
      rule.discountLimitBps === null
        ? ""
        : percentDiscount(rule.discountLimitBps),
    ownerId: rule.escalationOwnerId ?? "",
  };
}
function draftPolicy(policy: CommercialPolicy) {
  return {
    prices: draftRule(policy.prices),
    quotations: draftRule(policy.quotations),
    discounts: draftRule(policy.discounts),
    orders: draftRule(policy.orders),
  };
}
class PolicyRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function requestPolicy(
  url: string,
  method: "GET" | "PUT" | "POST",
  payload?: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers:
      payload === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ code: z.string() }).safeParse(json);
    throw new PolicyRequestError(
      failure.success ? failure.data.code : "UNKNOWN",
    );
  }
  return json;
}

function PolicySummary({
  policy,
  approvers,
}: {
  policy: CommercialPolicy;
  approvers: CommercialWorkspace["approvers"];
}) {
  return (
    <dl className="grid gap-5 sm:grid-cols-2">
      {commercialActions.map((action) => {
        const rule = policy[action];
        const owner = approvers.find(
          (member) => member.userId === rule.escalationOwnerId,
        );
        const automatic =
          rule.automationEnabled && !rule.approvalRequired && Boolean(owner);
        return (
          <div
            key={action}
            className="space-y-2 rounded-xl border border-border p-4 wrap-anywhere"
          >
            <dt className="font-semibold">{commercialActionLabels[action]}</dt>
            <dd className="space-y-2 text-sm">
              <Badge>
                {automatic ? "Automatic within limits" : "Approval required"}
              </Badge>
              <p>
                {!rule.automationEnabled
                  ? "Automation disabled."
                  : rule.approvalRequired
                    ? "Every action needs approval."
                    : !owner
                      ? "Escalation owner unavailable; automation blocked."
                      : "Only within the saved limits below."}
              </p>
              <p>
                Amount:{" "}
                {rule.amountLimit
                  ? `${rule.amountLimit.currency} ${decimalMoney(rule.amountLimit)} maximum`
                  : "Not configured"}
              </p>
              <p>
                Discount:{" "}
                {rule.discountLimitBps === null
                  ? "None permitted automatically"
                  : `${percentDiscount(rule.discountLimitBps)}% maximum`}
              </p>
              <p>
                Escalation:{" "}
                {owner
                  ? `${owner.name} (${owner.role})`
                  : rule.escalationOwnerId
                    ? `Unavailable owner (${rule.escalationOwnerId})`
                    : "Ask an Owner or Admin to configure"}
              </p>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function CommercialAuthorityManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: CommercialWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [draft, setDraft] = useState(() => draftPolicy(initialState.policy));
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const endpoint = `/api/businesses/${businessId}/commercial-authority`;
  const parsedPolicy = policyFormSchema.safeParse(draft);
  const parsedChange = parsedPolicy.success
    ? commercialChangeSchema.safeParse({
        expectedVersion: state.version,
        policy: parsedPolicy.data,
        note,
      })
    : parsedPolicy;

  function change(
    action: (typeof commercialActions)[number],
    patch: Partial<RuleDraft>,
  ) {
    setDraft((current) => ({
      ...current,
      [action]: { ...current[action], ...patch },
    }));
    setDirty(true);
    setReviewed(false);
    setMessage("");
  }
  function failure(caught: unknown) {
    const code = caught instanceof PolicyRequestError ? caught.code : "UNKNOWN";
    setNeedsMfa(code === "MFA_REQUIRED");
    setConflict(code === "CONFLICT" || code === "UNKNOWN");
    setError(
      code === "MFA_REQUIRED"
        ? "Verify in Security, then retry. Your edits remain here."
        : code === "UNAUTHENTICATED"
          ? "Sign in again in another tab, then retry. Your edits remain here."
          : code === "CONFLICT"
            ? "A newer policy is saved. Load the latest policy, compare it with your edits, and review before saving again."
            : code === "FORBIDDEN" || code === "NOT_FOUND"
              ? "Your current access cannot perform this action. Ask a Business Owner or Admin."
              : "Unable to confirm the result. Load the latest policy to check its state before retrying.",
    );
  }
  async function load() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = z
        .object({ success: z.literal(true), data: commercialWorkspaceSchema })
        .parse(await requestPolicy(endpoint, "GET"));
      setState(result.data);
      setConflict(false);
      setNeedsMfa(false);
      setReviewed(false);
      if (!dirty) setDraft(draftPolicy(result.data.policy));
      setMessage(
        dirty
          ? "Latest policy loaded. Your edits are preserved below; compare and review them before saving."
          : "Latest policy loaded.",
      );
    } catch (caught: unknown) {
      failure(caught);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (pending.current || !parsedChange.success || !reviewed || conflict)
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = z
        .object({ success: z.literal(true), data: commercialWorkspaceSchema })
        .parse(await requestPolicy(endpoint, "PUT", parsedChange.data));
      setState(result.data);
      setDraft(draftPolicy(result.data.policy));
      setDirty(false);
      setReviewed(false);
      setNote("");
      setNeedsMfa(false);
      setMessage(
        `Commercial policy saved as revision ${result.data.version}. Current policy checks now use these settings.`,
      );
    } catch (caught: unknown) {
      failure(caught);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-8">
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="effective-commercial-policy"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="effective-commercial-policy"
            className="text-xl font-semibold"
          >
            Effective commercial policy
          </h2>
          <Badge>
            {state.version
              ? `Saved revision ${state.version}`
              : "Safe defaults · not configured"}
          </Badge>
        </div>
        <PolicySummary policy={state.policy} approvers={state.approvers} />
        <p className="text-sm text-muted-foreground">
          Limits include the boundary and apply to each action’s total before
          discount. Currency must match exactly; no conversion is assumed. A
          discounted price, quotation or order also requires discount authority.
          Missing amounts or discount information require approval.
        </p>
        <p className="text-sm text-muted-foreground">
          This is the last loaded policy. Execution must check the latest policy
          and current ownership. Messages, private files and retrieved pages
          cannot enable authority.
        </p>
        <Button type="button" variant="outline" disabled={busy} onClick={load}>
          {busy ? "Working…" : "Load latest policy"}
        </Button>
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {needsMfa && (
        <Link
          href="/security"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Open Security in a new tab
        </Link>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4"
        >
          {message}
        </p>
      )}
      {state.canManage ? (
        <form
          className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div>
            <h2 className="text-xl font-semibold">Configure authority</h2>
            <p className="mt-2 text-muted-foreground">
              Choose each action deliberately. Changes apply when you save.
              Disable automation to revoke it, or keep approval required for
              every action.
            </p>
          </div>
          <fieldset disabled={busy} className="space-y-6">
            <legend className="sr-only">Commercial action settings</legend>
            {commercialActions.map((action) => {
              const rule = draft[action];
              return (
                <fieldset
                  key={action}
                  className="space-y-4 rounded-xl border border-border p-4"
                >
                  <legend className="px-2 font-semibold">
                    {commercialActionLabels[action]}
                  </legend>
                  <div className="space-y-2">
                    <Label htmlFor={`${action}-mode`}>
                      Automation and approval
                    </Label>
                    <NativeSelect
                      id={`${action}-mode`}
                      value={rule.mode}
                      onChange={(event) => {
                        const mode = z
                          .enum(["disabled", "approval", "automatic"])
                          .parse(event.target.value);
                        change(action, { mode });
                      }}
                    >
                      <option value="disabled">
                        Disabled — approval required
                      </option>
                      <option value="approval">
                        Enabled — always require approval
                      </option>
                      <option value="automatic">
                        Automatic within configured limits
                      </option>
                    </NativeSelect>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`${action}-currency`}>Currency</Label>
                      <NativeSelect
                        id={`${action}-currency`}
                        value={rule.currency}
                        onChange={(event) =>
                          change(action, { currency: event.target.value })
                        }
                      >
                        <option value="">Not configured</option>
                        {commercialCurrencies.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${action}-amount`}>
                        Maximum total before discount
                      </Label>
                      <Input
                        id={`${action}-amount`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={rule.amount}
                        onChange={(event) =>
                          change(action, { amount: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${action}-discount`}>
                        Maximum discount (%)
                      </Label>
                      <Input
                        id={`${action}-discount`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={rule.discount}
                        onChange={(event) =>
                          change(action, { discount: event.target.value })
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        0–100%, up to two decimal places. Blank permits no
                        automatic discount.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${action}-owner`}>
                        Escalation owner
                      </Label>
                      <NativeSelect
                        id={`${action}-owner`}
                        value={rule.ownerId}
                        onChange={(event) =>
                          change(action, { ownerId: event.target.value })
                        }
                      >
                        <option value="">Not configured</option>
                        {rule.ownerId &&
                          !state.approvers.some(
                            (member) => member.userId === rule.ownerId,
                          ) && (
                            <option value={rule.ownerId}>
                              Unavailable owner — choose another
                            </option>
                          )}
                        {state.approvers.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name} ({member.role})
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enabling this action requires an amount limit and a current
                    Owner or Admin for escalation.
                    {action === "discounts"
                      ? " Discount automation also requires an explicit percentage limit."
                      : " Discounted actions must satisfy both this policy and the Discounts policy."}
                  </p>
                </fieldset>
              );
            })}
            <div className="space-y-2">
              <Label htmlFor="commercial-change-note">
                Reason for this change
              </Label>
              <Textarea
                id="commercial-change-note"
                maxLength={1000}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setReviewed(false);
                }}
                required
              />
            </div>
            {!parsedChange.success && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {parsedChange.error.issues.map((issue, index) => (
                  <li key={index}>
                    {issue.path.length ? `${issue.path.join(" · ")}: ` : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                className="mt-1.5 size-5 shrink-0 accent-primary"
              />
              <span>
                I have reviewed these settings and authorize the selected
                automation and limits for this Business.
              </span>
            </label>
            <Button
              type="submit"
              disabled={!parsedChange.success || !reviewed || conflict}
            >
              {busy ? "Saving…" : "Save commercial policy"}
            </Button>
          </fieldset>
        </form>
      ) : (
        <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
          You can view and check this policy. Ask a Business Owner or Admin to
          change authority or escalation owners.
        </p>
      )}
      <CommercialPolicyCheck endpoint={endpoint} />
      <section
        className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
        aria-labelledby="commercial-history"
      >
        <h2 id="commercial-history" className="text-xl font-semibold">
          Policy history
        </h2>
        {!state.history.length ? (
          <p className="text-muted-foreground">
            No changes yet. Every action requires approval.
          </p>
        ) : (
          [...state.history].reverse().map((revision) => (
            <details
              key={revision.id}
              className="rounded-xl border border-border p-4"
            >
              <summary className="min-h-11 cursor-pointer font-medium wrap-anywhere">
                Revision {revision.version} · {revision.actorName} ·{" "}
                {revision.at}
              </summary>
              <p className="my-4 whitespace-pre-wrap wrap-anywhere">
                {revision.note}
              </p>
              <p className="mb-4 text-sm text-muted-foreground wrap-anywhere">
                Changed by {revision.actorId}. Escalation owner availability
                below reflects current team access; saved owner IDs remain in
                history.
              </p>
              <PolicySummary
                policy={revision.policy}
                approvers={state.approvers}
              />
            </details>
          ))
        )}
      </section>
    </div>
  );
}

function CommercialPolicyCheck({ endpoint }: { endpoint: string }) {
  const [action, setAction] =
    useState<(typeof commercialActions)[number]>("prices");
  const [currency, setCurrency] = useState("");
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [result, setResult] = useState<z.infer<
    typeof commercialEvaluationResultSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function check() {
    if (pending.current) return;
    setResult(null);
    setError("");
    const money = moneyFromDecimal(currency, amount);
    const discountBps = discountFromPercent(discount);
    if (
      ((currency || amount) && !money) ||
      (discount && discountBps === null)
    ) {
      setError(
        "Select a currency and valid amount, and a discount from 0 to 100% with at most two decimals. Leave unknown information blank to test the handoff.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const parsed = z
        .object({
          success: z.literal(true),
          data: commercialEvaluationResultSchema,
        })
        .parse(
          await requestPolicy(`${endpoint}/evaluate`, "POST", {
            action,
            amount: money,
            discountBps,
          }),
        );
      setResult(parsed.data);
    } catch (caught: unknown) {
      setError(
        caught instanceof PolicyRequestError && caught.code === "MFA_REQUIRED"
          ? "Verify your session in Security, then retry."
          : "Unable to check current policy. Confirm your sign-in and Business access, then retry.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
      aria-labelledby="commercial-check"
    >
      <div>
        <h2 id="commercial-check" className="text-xl font-semibold">
          Check current policy
        </h2>
        <p className="mt-2 text-muted-foreground">
          Check a proposed action against the latest saved policy. This sends no
          message and creates no quote or order. A result is a snapshot, so
          execution must check again.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <legend className="sr-only">Proposed commercial action</legend>
          <div className="space-y-2">
            <Label htmlFor="check-action">Action</Label>
            <NativeSelect
              id="check-action"
              value={action}
              onChange={(event) => {
                setAction(z.enum(commercialActions).parse(event.target.value));
                setResult(null);
              }}
            >
              {commercialActions.map((entry) => (
                <option key={entry} value={entry}>
                  {commercialActionLabels[entry]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="check-currency">Currency</Label>
              <NativeSelect
                id="check-currency"
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setResult(null);
                }}
              >
                <option value="">Unknown</option>
                {commercialCurrencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="check-amount">Total before discount</Label>
              <Input
                id="check-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setResult(null);
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="check-discount">Discount (%)</Label>
            <Input
              id="check-discount"
              inputMode="decimal"
              value={discount}
              onChange={(event) => {
                setDiscount(event.target.value);
                setResult(null);
              }}
            />
            <p className="text-sm text-muted-foreground">
              Enter 0 for no discount; leave blank when unknown.
            </p>
          </div>
          <Button type="submit" variant="outline">
            {busy ? "Checking…" : "Check current policy"}
          </Button>
        </fieldset>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open Security
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {result && (
        <div
          role="status"
          className="space-y-2 rounded-xl bg-muted p-4 wrap-anywhere"
        >
          <p className="font-semibold">
            {result.status === "permitted"
              ? "Within current commercial limits"
              : "Approval required"}
          </p>
          <p>
            {commercialActionLabels[result.checkedAction]}:{" "}
            {result.reason.replaceAll("_", " ")}
          </p>
          <p>{result.nextAction}</p>
          <p className="text-sm text-muted-foreground">
            Revision {result.version} · Checked {result.evaluatedAt}
          </p>
        </div>
      )}
    </section>
  );
}
