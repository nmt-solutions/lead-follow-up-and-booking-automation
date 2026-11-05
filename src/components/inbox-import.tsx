"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import type { InboxConnection } from "@/models/inbox";
import { inboxConnectionSchema, incomingInquirySchema } from "@/models/inbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
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

const resultSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), code: z.string() }),
]);
const captureSchema = z.object({
  status: z.enum(["captured", "duplicate", "ignored"]),
  conversationId: z.uuid().nullable(),
});
class ImportFailure extends Error {
  constructor(
    message: string,
    readonly recovery: "/security" | "/sign-in" | null = null,
  ) {
    super(message);
  }
}

export function InboxImport({
  businessId,
  connections,
}: {
  businessId: string;
  connections: InboxConnection[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<"/security" | "/sign-in" | null>(
    null,
  );
  const root = `/api/businesses/${businessId}/inbox/connections`;
  async function command(path: string, method: string, input: unknown) {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = resultSchema.safeParse(await response.json());
    if (!result.success)
      throw new ImportFailure(
        "Refresh and try again. The response could not be read.",
      );
    if (!result.data.success || !response.ok) {
      const code = !result.data.success ? result.data.code : "";
      throw new ImportFailure(
        code === "MFA_REQUIRED"
          ? "Verify your session in Security, then try again. Your entries are still here."
          : code === "UNAUTHENTICATED"
            ? "Sign in again in a new tab, then retry. Your entries are still here."
            : code === "CONFLICT"
              ? "These source references conflict with an existing message. Check the original record before retrying."
              : "The import could not be saved. Check your access, connection, source references and fields, then try again.",
        code === "MFA_REQUIRED"
          ? "/security"
          : code === "UNAUTHENTICATED"
            ? "/sign-in"
            : null,
      );
    }
    return result.data.data;
  }
  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError("");
    setNotice("");
    setRecovery(null);
    try {
      await operation();
      router.refresh();
    } catch (failure: unknown) {
      setRecovery(failure instanceof ImportFailure ? failure.recovery : null);
      setError(
        failure instanceof ImportFailure
          ? failure.message
          : "The request failed. Your entries are still here; try again.",
      );
    } finally {
      setPending(false);
    }
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecovery(null);
    const form = new FormData(event.currentTarget);
    const parsed = inboxConnectionSchema.safeParse({
      label: form.get("label"),
      channel: form.get("channel"),
      conversationRefs: String(form.get("conversationRefs") ?? "")
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(
        "Enter a name and at most 100 source conversation references, each on its own line.",
      );
      return;
    }
    void run(async () => {
      await command(root, "POST", parsed.data);
      setNotice(
        "Import connection added. It can receive the messages you import here.",
      );
    });
  }
  function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecovery(null);
    const form = new FormData(event.currentTarget);
    const parsed = incomingInquirySchema.safeParse({
      eventId: form.get("eventId"),
      messageRef: form.get("messageRef"),
      conversationRef: form.get("conversationRef"),
      senderRef: form.get("senderRef"),
      senderName: form.get("senderName"),
      geography: form.get("geography") || null,
      kind: form.get("kind"),
      replyToMessageRef: form.get("replyToMessageRef") || undefined,
      subject: form.get("subject"),
      text: form.get("text"),
      occurredAt: form.get("occurredAt"),
    });
    if (!parsed.success) {
      setError(
        "Complete the message and source references. A buying-interest reply also needs the original message reference.",
      );
      return;
    }
    const connectionId = z.uuid().safeParse(form.get("connectionId"));
    if (!connectionId.success) {
      setError("Choose an active import connection.");
      return;
    }
    void run(async () => {
      const saved = captureSchema.safeParse(
        await command(
          `${root}/${connectionId.data}/events`,
          "POST",
          parsed.data,
        ),
      );
      if (!saved.success)
        throw new ImportFailure(
          "The import response could not be read. Refresh the inbox before retrying.",
        );
      setNotice(
        saved.data.status === "duplicate"
          ? "This message is already in the inbox."
          : saved.data.status === "ignored"
            ? "This message did not establish buying engagement."
            : "Inquiry captured. Open it in the inbox to review the buyer and initial Opportunity.",
      );
    });
  }
  return (
    <section
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
      aria-labelledby="imports-title"
    >
      <h2 id="imports-title" className="text-xl font-semibold">
        Received-message imports
      </h2>
      <p className="text-sm text-muted-foreground">
        Import messages into a selected source connection. Email and WhatsApp
        synchronization are not connected by this form. Only direct inquiries
        and buying-interest replies establish engagement.
      </p>
      <Button variant="outline" onClick={() => router.refresh()}>
        Refresh inbox
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            {recovery && (
              <Link
                href={recovery}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline"
              >
                {recovery === "/security"
                  ? "Open Security in a new tab"
                  : "Open sign-in in a new tab"}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      <details className="space-y-4">
        <summary className="min-h-11 cursor-pointer py-3 font-medium">
          Manage import connections
        </summary>
        <ul className="space-y-3">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <span className="wrap-anywhere">
                {connection.label} · {connection.channel} ·{" "}
                {connection.active ? "Active import" : "Revoked"}
              </span>
              {connection.active && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={pending}>
                      Revoke import
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>
                      Revoke this import connection?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      New imports will stop for {connection.label}. Its stored
                      conversations will remain available. A new connection is
                      required to import again.
                    </AlertDialogDescription>
                    <div className="flex flex-wrap gap-3">
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          void run(async () => {
                            await command(
                              `${root}/${connection.id}`,
                              "DELETE",
                              {},
                            );
                            setNotice(
                              "Connection revoked. Stored conversations remain available.",
                            );
                          })
                        }
                      >
                        Revoke import
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-label">Connection name</Label>
            <Input id="import-label" name="label" required maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-channel">Channel</Label>
            <NativeSelect id="import-channel" name="channel">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-scope">
              Selected conversation references (optional)
            </Label>
            <Textarea
              id="import-scope"
              name="conversationRefs"
              aria-describedby="import-scope-help"
              maxLength={25700}
            />
            <p id="import-scope-help" className="text-sm text-muted-foreground">
              One source reference per line. Leave blank to process all new
              messages you import into this connection. Historical
              correspondence is not imported.
            </p>
          </div>
          <Button disabled={pending}>
            {pending ? "Saving…" : "Add import connection"}
          </Button>
        </form>
      </details>
      {connections.some((connection) => connection.active) && (
        <details className="space-y-4">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">
            Import a received inquiry
          </summary>
          <form onSubmit={capture} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="import-connection">Source connection</Label>
              <NativeSelect id="import-connection" name="connectionId">
                {connections
                  .filter((connection) => connection.active)
                  .map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.label} ({connection.channel})
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-kind">Engagement</Label>
              <NativeSelect id="import-kind" name="kind">
                <option value="direct_inquiry">Direct inquiry</option>
                <option value="buying_interest_reply">
                  Buying-interest reply
                </option>
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["senderName", "Buyer name", 200],
                ["senderRef", "Source buyer reference", 256],
                ["geography", "Buyer geography (optional)", 200],
                ["eventId", "Source event reference", 256],
                ["messageRef", "Source message reference", 256],
                ["conversationRef", "Source conversation reference", 256],
                [
                  "replyToMessageRef",
                  "Original message reference (for replies)",
                  256,
                ],
              ].map(([name, label, max]) => (
                <div key={name} className="space-y-2">
                  <Label htmlFor={`import-${name}`}>{label}</Label>
                  <Input
                    id={`import-${name}`}
                    name={String(name)}
                    maxLength={Number(max)}
                    required={
                      name !== "geography" && name !== "replyToMessageRef"
                    }
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-occurred">Source event time</Label>
              <Input
                id="import-occurred"
                name="occurredAt"
                required
                placeholder="2026-11-06T09:00:00Z"
                aria-describedby="import-time-help"
              />
              <p
                id="import-time-help"
                className="text-sm text-muted-foreground"
              >
                Use the original ISO 8601 timestamp, including timezone. Only
                events since this connection was added are accepted.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Keep source references and event time unchanged when retrying an
              import. Repeated messages about the same need use the same
              conversation reference.
            </p>
            <div className="space-y-2">
              <Label htmlFor="import-subject">Subject</Label>
              <Input
                id="import-subject"
                name="subject"
                required
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-text">Received message</Label>
              <Textarea
                id="import-text"
                name="text"
                required
                maxLength={20000}
              />
            </div>
            <Button disabled={pending}>
              {pending ? "Saving…" : "Import inquiry"}
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}
