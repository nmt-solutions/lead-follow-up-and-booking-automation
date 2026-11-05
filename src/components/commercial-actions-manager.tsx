"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  commercialActionLabels,
  commercialActions,
  commercialCurrencies,
  decimalMoney,
  moneyFromDecimal,
  discountFromPercent,
  percentDiscount,
} from "@/models/commercial-authority";
import {
  commercialWorkspaceSchemaForActions,
  proposeCommercialSchema,
  type CommercialActionWorkspace,
  type CommercialActionView,
} from "@/models/commercial-actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
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
  z.object({
    success: z.literal(true),
    data: commercialWorkspaceSchemaForActions,
  }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const outcomeLabels = {
  issued_quote: "Issued quote",
  accepted_order: "Accepted order",
  confirmed_sale: "Confirmed sale",
};
const money = (v: CommercialActionView["payload"]["grossAmount"]) =>
  `${v.currency} ${decimalMoney(v)}`;
type Send = (
  command: "propose" | "decide" | "execute" | "evidence",
  input: unknown,
) => Promise<boolean>;

export function CommercialActionsManager({
  businessId,
  opportunityId,
  initialState,
}: {
  businessId: string;
  opportunityId: string;
  initialState: CommercialActionWorkspace;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);
  const [revision, setRevision] = useState<CommercialActionView | null>(null);
  const base = `/api/businesses/${businessId}/opportunities/${opportunityId}/commercial-actions`;
  const send: Send = async (command, input) => {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      const response = await fetch(
        command === "propose" ? base : `${base}/${command}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError(
          "The result could not be confirmed. Reload and inspect history before retrying.",
        );
        return false;
      }
      if (!response.ok || !parsed.data.success) {
        const code = parsed.data.success ? "" : parsed.data.code;
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : null,
        );
        setError(
          code === "MFA_REQUIRED"
            ? "Verify your current session in Security, then return to this form."
            : code === "UNAUTHENTICATED"
              ? "Sign in again, then return to this form."
              : code === "CONFLICT"
                ? "The proposal, authority or Opportunity changed. Reload, review the current state and prepare a new revision if needed."
                : code === "COMMERCIAL_SETUP_REQUIRED"
                  ? "Commercial execution is not configured. Complete the approved action externally before recording Business evidence."
                  : code === "FORBIDDEN" || code === "NOT_FOUND"
                    ? "Your current Business role or Opportunity ownership does not permit this action."
                    : "Check the fields and exact evidence. The action could not be completed.",
        );
        return false;
      }
      setState(parsed.data.data);
      setNotice(
        "History updated. Review the recorded decision, execution state and evidence below.",
      );
      return true;
    } catch {
      setError(
        "The result is unknown. Reload to inspect execution and evidence before retrying; an unconfirmed action is never automatically repeated.",
      );
      return false;
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-6 wrap-anywhere">
      <Card>
        <CardHeader>
          <CardTitle>Current authority and ownership</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Responsible person: {state.ownerName ?? "Unassigned"} ·{" "}
            {state.controlState === "human"
              ? "Human control; automation paused"
              : "Automation control"}
          </p>
          <p className="text-sm text-muted-foreground">
            Approval covers only the displayed immutable action. It does not
            return this Opportunity to automation. Human control does not grant
            financial authority.
          </p>
          <Link
            href={`/businesses/${businessId}/commercial-authority`}
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            Review commercial authority (version {state.authority.version})
          </Link>
          {commercialActions.map((action) => {
            const r = state.authority.policy[action];
            return (
              <p key={action} className="text-sm">
                <span className="font-medium">
                  {commercialActionLabels[action]}:
                </span>{" "}
                {r.automationEnabled && !r.approvalRequired
                  ? "Automation enabled within limits"
                  : "Explicit approval required"}{" "}
                · Amount limit{" "}
                {r.amountLimit ? money(r.amountLimit) : "not configured"} ·
                Discount limit{" "}
                {r.discountLimitBps === null
                  ? "not configured"
                  : `${percentDiscount(r.discountLimitBps)}%`}
              </p>
            );
          })}
          {!state.providerAvailable && (
            <p className="rounded-xl bg-muted p-3 text-sm">
              Live commercial execution is not configured. Approval and
              authoritative Business evidence can be recorded here; no buyer
              message, order or payment is sent by this screen.
            </p>
          )}
          {state.setupReason && <p className="text-sm">{state.setupReason}</p>}
        </CardContent>
      </Card>
      {error && (
        <Alert variant="destructive">
          {error}
          {recovery && (
            <Link
              href={recovery}
              target="_blank"
              rel="noreferrer"
              className="ml-2 underline"
            >
              {recovery === "/security"
                ? "Open Security in a new tab"
                : "Sign in in a new tab"}
            </Link>
          )}
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {state.canPropose ? (
        <ProposalForm
          key={revision?.id ?? "new"}
          state={state}
          revision={revision}
          pending={pending}
          send={send}
          cancel={() => setRevision(null)}
        />
      ) : (
        <p>
          The assigned owner can prepare proposals after Business knowledge is
          approved.
        </p>
      )}
      <section className="space-y-4" aria-labelledby="commercial-history">
        <h2 id="commercial-history" className="text-xl font-semibold">
          Commercial action history
        </h2>
        {!state.actions.length && (
          <p className="text-muted-foreground">
            No commercial actions yet. Prepare exact terms for review above.
          </p>
        )}
        {[...state.actions].reverse().map((a) => (
          <ActionCard
            key={a.id}
            action={a}
            state={state}
            pending={pending}
            send={send}
            revise={() => {
              setRevision(a);
              document.getElementById("commercial-proposal-title")?.focus();
            }}
          />
        ))}
      </section>
      <section className="space-y-3" aria-labelledby="commercial-outcomes">
        <h2 id="commercial-outcomes" className="text-xl font-semibold">
          Authoritative outcomes
        </h2>
        <p className="text-sm text-muted-foreground">
          RFQs and appointments are separate records. A dispatched action or
          accepted order alone does not establish a confirmed sale.
        </p>
        {!state.outcomes.length && (
          <p>
            No issued quotes, accepted orders or confirmed sales are recorded.
          </p>
        )}
        {state.outcomes.map((o) => (
          <Card key={o.id}>
            <CardContent className="space-y-2 pt-6">
              <Badge>{outcomeLabels[o.kind]}</Badge>
              <p>
                {o.reference} · {o.occurredAt}
              </p>
              <p className="text-sm">
                Source: {o.source} · Recorded by {o.actorId}
              </p>
              <p className="whitespace-pre-wrap">{o.note}</p>
              <p className="text-xs text-muted-foreground">
                Action {o.actionId} · Recorded {o.at}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

function ProposalForm({
  state,
  revision,
  pending,
  send,
  cancel,
}: {
  state: CommercialActionWorkspace;
  revision: CommercialActionView | null;
  pending: boolean;
  send: Send;
  cancel(): void;
}) {
  const [error, setError] = useState("");
  const request = useRef<{ payload: string; key: string } | null>(null);
  const p = revision?.payload;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const amount = moneyFromDecimal(
      String(data.get("currency")),
      String(data.get("amount")),
    );
    const discountBps = discountFromPercent(String(data.get("discount")));
    const payload = {
      replacesId: revision?.id ?? null,
      expectedContextKey: state.contextKey,
      mode: data.get("mode"),
      action: data.get("action"),
      messageId: data.get("message"),
      offering: data.get("offering"),
      description: data.get("description"),
      grossAmount: amount,
      discountBps,
      terms: data.get("terms"),
      note: data.get("note"),
    };
    const serialized = JSON.stringify(payload);
    if (request.current?.payload !== serialized)
      request.current = { payload: serialized, key: crypto.randomUUID() };
    const parsed = proposeCommercialSchema.safeParse({
      ...payload,
      requestKey: request.current.key,
    });
    if (!parsed.success) {
      setError(
        "Complete all fields. Use a supported currency, exact amount and a discount from 0 to 100% with up to two decimal places that produces whole minor units.",
      );
      return;
    }
    if (await send("propose", parsed.data)) {
      request.current = null;
      cancel();
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle id="commercial-proposal-title" tabIndex={-1}>
          {revision
            ? `Prepare revision ${revision.version + 1}`
            : "Prepare a commercial action"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">
            Enter Business-authorized prices and complete terms. The buyer and
            conversation come from the selected received message. A custom
            quotation needs a complete, current RFQ.
          </p>
          <fieldset disabled={pending} className="space-y-4">
            <div>
              <Label htmlFor="commercial-action">Action</Label>
              <NativeSelect
                id="commercial-action"
                name="action"
                defaultValue={p?.action ?? ""}
                required
              >
                <option value="">Choose an action</option>
                {commercialActions.map((a) => (
                  <option key={a} value={a}>
                    {commercialActionLabels[a]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="commercial-mode">Execution control</Label>
              <NativeSelect
                id="commercial-mode"
                name="mode"
                defaultValue={p?.mode ?? "manual"}
              >
                <option value="manual">Manual review and execution</option>
                <option
                  value="automation"
                  disabled={state.controlState !== "automation"}
                >
                  Automation, when explicitly returned and permitted
                </option>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="commercial-offering">Approved offering</Label>
              <NativeSelect
                id="commercial-offering"
                name="offering"
                defaultValue={p?.offering ?? ""}
                required
              >
                <option value="">Choose an offering</option>
                {state.offerings.map((o) => (
                  <option key={o.name}>{o.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="commercial-message">Buyer message</Label>
              <NativeSelect
                id="commercial-message"
                name="message"
                defaultValue={p?.messageId ?? ""}
                required
              >
                <option value="">Choose the exact conversation</option>
                {state.messages.map((m, i) => (
                  <option key={m.id} value={m.id}>
                    {i + 1}. {m.recipientRef}: {m.text.slice(0, 90)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="commercial-description">
                Goods or services and quantities
              </Label>
              <Textarea
                id="commercial-description"
                name="description"
                defaultValue={p?.description}
                maxLength={4000}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="commercial-currency">Currency</Label>
                <NativeSelect
                  id="commercial-currency"
                  name="currency"
                  defaultValue={p?.grossAmount.currency ?? ""}
                  required
                >
                  <option value="">Choose currency</option>
                  {commercialCurrencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="commercial-amount">Total before discount</Label>
                <Input
                  id="commercial-amount"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={p ? decimalMoney(p.grossAmount) : ""}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="commercial-discount">
                Discount percent (enter 0 for none)
              </Label>
              <Input
                id="commercial-discount"
                name="discount"
                inputMode="decimal"
                defaultValue={p ? percentDiscount(p.discountBps) : ""}
                required
              />
            </div>
            <div>
              <Label htmlFor="commercial-terms">
                Complete commercial terms, including applicable tax and delivery
                treatment
              </Label>
              <Textarea
                id="commercial-terms"
                name="terms"
                defaultValue={p?.terms}
                maxLength={4000}
                required
              />
            </div>
            <div>
              <Label htmlFor="commercial-note">
                Preparation or revision reason
              </Label>
              <Textarea
                id="commercial-note"
                name="note"
                maxLength={1000}
                required
              />
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit">
                {pending ? "Saving…" : "Save immutable proposal"}
              </Button>
              {revision && (
                <Button type="button" variant="outline" onClick={cancel}>
                  Cancel revision
                </Button>
              )}
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function ActionCard({
  action: a,
  state,
  pending,
  send,
  revise,
}: {
  action: CommercialActionView;
  state: CommercialActionWorkspace;
  pending: boolean;
  send: Send;
  revise(): void;
}) {
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("");
  const [reference, setReference] = useState("");
  const [occurred, setOccurred] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const ref = { actionId: a.id, payloadHash: a.payloadHash };
  const canAct =
    a.latest && !a.stale && !a.execution && a.decision?.decision !== "rejected";
  const financiallyAuthorized =
    canAct &&
    (a.decision?.decision === "approved" ||
      a.currentEvaluation.status === "permitted");
  const canExecute = financiallyAuthorized && state.canPropose;
  const unconfirmed =
    a.execution?.state === "committed" || a.execution?.state === "ambiguous";
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {commercialActionLabels[a.payload.action]} · Revision {a.version}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Badge>
            {!a.latest
              ? "Replaced"
              : a.stale
                ? "Review changed context"
                : (a.decision?.decision ??
                  a.currentEvaluation.status.replaceAll("_", " "))}
          </Badge>
          {a.execution && (
            <Badge>
              {unconfirmed ? "External result unconfirmed" : a.execution.state}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-3">
          {[
            ["Buyer", a.payload.recipientRef],
            ["Offering", a.payload.offering],
            ["Goods or services", a.payload.description],
            ["Before discount", money(a.payload.grossAmount)],
            ["Discount", `${percentDiscount(a.payload.discountBps)}%`],
            ["Exact total", money(a.payload.netAmount)],
            ["Terms", a.payload.terms],
            ["Control", a.payload.mode],
            [
              "Current policy decision",
              a.currentEvaluation.reason.replaceAll("_", " "),
            ],
            ["Next action", a.currentEvaluation.nextAction],
            ["Prepared by", `${a.actorName} · ${a.at}`],
            ["Preparation reason", a.note],
            ["RFQ revision", a.payload.rfqRevisionId ?? "None"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
        <details className="text-sm">
          <summary className="cursor-pointer py-2">
            Approval and source references
          </summary>
          <p>
            Action {a.id} · policy version {a.policyVersion}
          </p>
          <p>Payload {a.payloadHash}</p>
          <p>
            Message {a.payload.messageId} · Conversation{" "}
            {a.payload.conversationRef}
          </p>
          <p>
            Original policy evaluation:{" "}
            {a.evaluation.reason.replaceAll("_", " ")}
          </p>
        </details>
        {a.decision && (
          <p className="text-sm">
            {a.decision.decision} by {a.decision.actorName} · {a.decision.at} ·
            Policy {a.decision.policyVersion}: {a.decision.note}
          </p>
        )}
        {a.execution && (
          <p className="text-sm">
            Execution: {a.execution.state} ·{" "}
            {a.execution.reason?.replaceAll("_", " ") ?? "Receipt recorded"} ·{" "}
            {a.execution.reference ?? "No confirmed reference"} ·{" "}
            {a.execution.at}
          </p>
        )}
        {unconfirmed && (
          <p className="rounded-xl bg-muted p-3">
            Check the external system using action {a.id} before taking further
            action. This action cannot be replayed. An Owner or Admin can
            reconcile it with authoritative evidence below.
          </p>
        )}
        {canAct && state.canApprove && !a.decision && (
          <div className="space-y-3">
            <Label htmlFor={`decision-${a.id}`}>
              Approval or rejection reason for these exact terms
            </Label>
            <Textarea
              id={`decision-${a.id}`}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pending || !note.trim()}
                onClick={() =>
                  send("decide", { ...ref, decision: "approved", note })
                }
              >
                Approve exact action
              </Button>
              <Button
                variant="outline"
                disabled={pending || !note.trim()}
                onClick={() =>
                  send("decide", { ...ref, decision: "rejected", note })
                }
              >
                Reject action
              </Button>
            </div>
          </div>
        )}
        {canExecute && state.providerAvailable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={pending}>Execute exact action</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Execute these approved terms?</AlertDialogTitle>
              <AlertDialogDescription>
                This can make a commercial commitment to{" "}
                {a.payload.recipientRef} for {money(a.payload.netAmount)}.
                Review the complete terms above. Execution cannot be undone
                here.
              </AlertDialogDescription>
              <div className="flex flex-wrap justify-end gap-3">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => send("execute", ref)}>
                  Execute exact action
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {a.latest &&
          (!a.execution || ["failed", "blocked"].includes(a.execution.state)) &&
          state.canPropose && (
            <Button variant="outline" disabled={pending} onClick={revise}>
              Prepare a new revision
            </Button>
          )}
        {state.canApprove &&
          (a.payload.action === "quotations" ||
            a.payload.action === "orders") &&
          ((financiallyAuthorized && a.payload.mode === "manual") ||
            a.execution?.state === "completed" ||
            unconfirmed) && (
            <details>
              <summary className="cursor-pointer py-2 font-medium">
                Record authoritative Business evidence
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const date = new Date(occurred);
                  if (!Number.isFinite(date.getTime())) return;
                  await send("evidence", {
                    ...ref,
                    kind,
                    reference,
                    occurredAt: date.toISOString(),
                    note: evidenceNote,
                  });
                }}
              >
                <p className="text-sm text-muted-foreground">
                  Record only an action already completed externally on these
                  exact terms. A buyer request, AI text, RFQ, appointment or
                  delivery receipt is insufficient. This records evidence
                  without sending to the buyer.
                </p>
                <Label htmlFor={`kind-${a.id}`}>Verified outcome</Label>
                <NativeSelect
                  id={`kind-${a.id}`}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  required
                >
                  <option value="">Choose outcome</option>
                  {a.payload.action === "quotations" ? (
                    <option value="issued_quote">Issued quote</option>
                  ) : (
                    <>
                      <option value="accepted_order">Accepted order</option>
                      {state.outcomes.some(
                        (o) =>
                          o.actionId === a.id && o.kind === "accepted_order",
                      ) && (
                        <option value="confirmed_sale">
                          Confirmed sale, separately verified
                        </option>
                      )}
                    </>
                  )}
                </NativeSelect>
                <Label htmlFor={`reference-${a.id}`}>
                  Authoritative document or system reference
                </Label>
                <Input
                  id={`reference-${a.id}`}
                  value={reference}
                  maxLength={256}
                  onChange={(e) => setReference(e.target.value)}
                  required
                />
                <Label htmlFor={`occurred-${a.id}`}>
                  Confirmed at (your local time)
                </Label>
                <Input
                  id={`occurred-${a.id}`}
                  type="datetime-local"
                  step="1"
                  value={occurred}
                  onChange={(e) => setOccurred(e.target.value)}
                  required
                />
                <Label htmlFor={`evidence-${a.id}`}>
                  Evidence and verification notes for the exact action
                </Label>
                <Textarea
                  id={`evidence-${a.id}`}
                  value={evidenceNote}
                  maxLength={2000}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  required
                />
                <Label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    required
                    className="mt-1 size-5 accent-primary"
                  />
                  I verified this outcome against authoritative Business records
                  for these exact terms.
                </Label>
                <Button disabled={pending} type="submit">
                  Record verified evidence
                </Button>
              </form>
            </details>
          )}
      </CardContent>
    </Card>
  );
}
