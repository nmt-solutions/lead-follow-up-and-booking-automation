"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  enableMetaIntakeSchema,
  metaIntakeViewSchema,
  type MetaIntakeView,
} from "@/models/whatsapp-intake";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert } from "./ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const envelope = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: metaIntakeViewSchema }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
export function WhatsAppIntakeManager({
  businessId,
  version,
  initialState,
  canManage,
}: {
  businessId: string;
  version: number | null;
  initialState: MetaIntakeView;
  canManage: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<"/security" | "/sign-in" | null>(
    null,
  );
  async function refresh() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/whatsapp/intake`,
        { cache: "no-store" },
      );
      const result = envelope.safeParse(await response.json());
      if (!response.ok || !result.success || !result.data.success) {
        setError(
          "Capture status could not be read. Check your session and retry.",
        );
        return;
      }
      setState(result.data.data);
      setNotice("Saved capture evidence refreshed.");
    } catch {
      setError(
        "Capture status is unavailable. Retry when the connection is restored.",
      );
    } finally {
      setPending(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setRecovery(null);
    const data = new FormData(event.currentTarget);
    const parsed = enableMetaIntakeSchema.safeParse({
      expectedVersion: version,
      receiptRetentionSeconds: Number(data.get("retention")),
    });
    if (!parsed.success) {
      setError(
        "Choose the approved provider-receipt retention in seconds, at least 60, and connect your number first.",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/whatsapp/intake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "enable", input: parsed.data }),
        },
      );
      const result = envelope.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The result could not be confirmed. Reload saved status before retrying.",
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
          code === "CHANNEL_SETUP_REQUIRED"
            ? "Ask the onboarding operator to check the selected number, webhook callback, worker deployment and current Meta permission. Sending and payment proof are separate checks."
            : code === "CONFLICT"
              ? "The connection changed. Reload and review the selected number before retrying."
              : "Check your current session and Business access, then retry. Your retention entry is preserved.",
        );
        return;
      }
      setState(result.data.data);
      setNotice(
        "Inbound capture selected. Received messages appear in the shared inbox after durable processing.",
      );
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Reload saved status before retrying. Your entry is preserved.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incoming messages and manual activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 wrap-anywhere">
        <div className="flex flex-wrap gap-2">
          <Badge>
            {state.enabled
              ? "Inbound capture selected"
              : "Inbound capture unavailable"}
          </Badge>
          <Badge>
            {state.inboundObserved
              ? "Signed incoming message observed"
              : "Incoming capture not yet observed"}
          </Badge>
          <Badge>
            {state.replyVisibility === "supported_app_events"
              ? "Supported app activity observed"
              : state.replyVisibility === "gap"
                ? "Reply visibility gap"
                : "Manual reply visibility unverified"}
          </Badge>
          <Badge>Sending requires separate setup</Badge>
        </div>
        <p>
          WhatsApp messages use the shared buyer, Opportunity, approved answers
          and qualification workflow. Ask for a person at any time; your sales
          team can take over an Opportunity and explicitly return it to
          automation.
        </p>
        <p className="text-sm text-muted-foreground">
          Supported Business App echoes can reveal outgoing activity. History,
          media, linked-device coverage and other providers are not promised as
          complete synchronization. Unverified or unsupported visibility pauses
          affected automation across channels. Account authorization and Meta
          billing proof alone do not prove capture.
        </p>
        {state.gap && (
          <Alert variant="destructive">
            Reply visibility needs review ({state.gap.replaceAll("_", " ")}).
            Review captured activity with the onboarding operator and the shared
            inbox before handing affected Opportunities back.
          </Alert>
        )}
        <p className="text-sm">
          {state.pending} recent events awaiting durable processing.
          Customer-paid Meta charges remain outside the platform subscription
          and operator spend.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={refresh}
        >
          {pending ? "Working…" : "Refresh capture status"}
        </Button>
        <div className="flex flex-wrap gap-4">
          <Link
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            href={`/businesses/${businessId}/inbox`}
          >
            Open shared inbox and take over
          </Link>
          <Link
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            href={`/businesses/${businessId}/knowledge`}
          >
            Review approved answers and escalation contact
          </Link>
        </div>
        {canManage && !state.enabled && (
          <form
            onSubmit={save}
            className="space-y-3 border-t pt-5"
            aria-busy={pending}
          >
            <Label htmlFor="meta-receipt-retention">
              Approved provider-receipt retention (seconds)
            </Label>
            <Input
              id="meta-receipt-retention"
              name="retention"
              type="number"
              min="60"
              max="2147483647"
              step="1"
              required
              defaultValue={state.receiptRetentionSeconds ?? ""}
              aria-describedby="meta-retention-note"
            />
            <p
              id="meta-retention-note"
              className="text-sm text-muted-foreground"
            >
              Use your agreed data policy. Provider staging content expires
              after this period; captured shared-inbox records follow the
              Business record policy. No retention period is assumed.
            </p>
            <Button type="submit" disabled={pending || !version}>
              {pending ? "Enabling capture…" : "Enable incoming capture"}
            </Button>
          </form>
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
              <Link
                href={recovery}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                {recovery === "/security" ? "Verify in Security" : "Sign in"}{" "}
                (new tab)
              </Link>
            )}
          </Alert>
        )}
        <details>
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Recent provider receipts
          </summary>
          <ul className="space-y-3">
            {state.receipts.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                {r.kind.replaceAll("_", " ")} · {r.state} · {r.at}
                <br />
                {r.messageRef ?? "No message identity"}
                {r.status ? ` · ${r.status}` : ""}
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
