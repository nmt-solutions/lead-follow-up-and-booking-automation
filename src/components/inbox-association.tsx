"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import {
  associateInquirySchema,
  type InboxConversation,
  type InboxWorkspace,
} from "@/models/inbox";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "./ui/card";
import { Alert } from "./ui/alert";

const responseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.object({ associated: z.literal(true) }),
  }),
  z.object({ success: z.literal(false), code: z.string() }),
]);

export function InboxAssociation({
  businessId,
  conversation,
  workspace,
}: {
  businessId: string;
  conversation: InboxConversation;
  workspace: InboxWorkspace;
}) {
  const router = useRouter();
  const [buyerId, setBuyerId] = useState(conversation.buyer.id);
  const [target, setTarget] = useState("review");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<"/security" | "/sign-in" | null>(
    null,
  );
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const needs = workspace.opportunities.filter(
    (need) => need.buyerId === buyerId,
  );
  const changedBuyer = buyerId !== conversation.buyer.id;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = associateInquirySchema.safeParse({
      expectedVersion: conversation.association.version,
      buyerId,
      messageIds: selected,
      target:
        target === "new"
          ? { kind: "new", title: form.get("title") }
          : target === "review"
            ? { kind: "review" }
            : { kind: "existing", opportunityId: target },
      future: form.get("future"),
      reason: form.get("reason"),
    });
    setError("");
    setNotice("");
    setRecovery(null);
    if (
      !parsed.success ||
      (changedBuyer &&
        (selected.length !== conversation.messages.length ||
          !form.has("verified")))
    ) {
      setError(
        "Select messages and a purchasing need or review action, and explain the correction. A buyer correction requires every message and confirmation of the person's identity.",
      );
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/inbox/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const result = responseSchema.safeParse(await response.json());
      if (!result.success) {
        setError(
          "The response could not be read. Reload the conversation before retrying; your entries are still here.",
        );
        return;
      }
      if (!result.data.success || !response.ok) {
        const code = !result.data.success ? result.data.code : "";
        setRecovery(
          code === "MFA_REQUIRED"
            ? "/security"
            : code === "UNAUTHENTICATED"
              ? "/sign-in"
              : null,
        );
        setError(
          code === "CONFLICT"
            ? "New messages or another correction changed this conversation. Reload the latest associations, review your selection, then retry."
            : code === "MFA_REQUIRED"
              ? "Verify your session in Security, then retry. Your entries are still here."
              : code === "UNAUTHENTICATED"
                ? "Sign in again in a new tab, then retry. Your entries are still here."
                : "The association could not be saved. Check your current access, buyer, messages and purchasing need, then retry.",
        );
        return;
      }
      setNotice(
        "Association saved. Original sources and Opportunity history are retained.",
      );
      setSavedVersion(conversation.association.version);
      setSelected([]);
      router.refresh();
    } catch {
      setError(
        "The request could not be confirmed. Reload the conversation before retrying. Your entries are still here.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Associate or correct messages</CardTitle>
        <CardDescription>
          One Opportunity represents one purchasing need. Select only the
          messages that belong together. Source records and existing owners
          remain in their original history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            {error}
            {recovery && (
              <Link
                href={recovery}
                target="_blank"
                className="mt-3 inline-flex min-h-11 items-center underline"
              >
                {recovery === "/security" ? "Open Security" : "Open sign-in"}{" "}
                (new tab)
              </Link>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => router.refresh()}
              className="mt-3"
            >
              Reload latest associations
            </Button>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-success">
            {notice}
          </p>
        )}
        <form onSubmit={save}>
          <fieldset
            disabled={
              pending || savedVersion === conversation.association.version
            }
            className="space-y-5"
          >
            <legend className="mb-3 font-medium">Messages to associate</legend>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setSelected(conversation.messages.map((message) => message.id))
              }
            >
              Select all messages
            </Button>
            <div className="space-y-2">
              {conversation.messages.map((message, index) => (
                <label
                  key={message.id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3"
                >
                  <Input
                    type="checkbox"
                    className="mt-1 size-5 min-h-0 w-5 shrink-0 accent-primary"
                    checked={selected.includes(message.id)}
                    onChange={(event) =>
                      setSelected((ids) =>
                        event.target.checked
                          ? [...ids, message.id]
                          : ids.filter((id) => id !== message.id),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-medium">
                      Message {index + 1}: {message.subject}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {message.text.slice(0, 180)}
                      {message.text.length > 180 ? "…" : ""}
                    </span>
                    <span className="mt-1 block text-sm">
                      {workspace.opportunities.find(
                        (need) => need.id === message.opportunityId,
                      )?.title ?? "Needs association review"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="association-buyer">Verified buyer</Label>
              <NativeSelect
                id="association-buyer"
                value={buyerId}
                onChange={(event) => {
                  setBuyerId(event.target.value);
                  setTarget("review");
                }}
              >
                {workspace.buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.id}>
                    {buyer.name} · {buyer.senderRef} · {buyer.id.slice(0, 8)}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                Matching names, company domains or public signals do not verify
                a person. Changing this buyer affects this conversation only.
              </p>
            </div>
            {changedBuyer && (
              <label className="flex min-h-11 items-start gap-3">
                <Input
                  type="checkbox"
                  name="verified"
                  required
                  className="mt-1 size-5 min-h-0 w-5 shrink-0 accent-primary"
                />
                <span>
                  I verified this person&apos;s identity across these channels.
                  All messages in this conversation belong to the selected
                  buyer.
                </span>
              </label>
            )}
            <div className="space-y-2">
              <Label htmlFor="association-target">Purchasing need</Label>
              <NativeSelect
                id="association-target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="review">Keep selected messages in review</option>
                <option value="new">Create a separate Opportunity</option>
                {needs.map((need) => (
                  <option key={need.id} value={need.id}>
                    {need.title} · {need.id.slice(0, 8)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {target === "new" && (
              <div className="space-y-2">
                <Label htmlFor="association-title">
                  Distinct purchasing need
                </Label>
                <Input
                  id="association-title"
                  name="title"
                  required
                  maxLength={200}
                  placeholder="e.g. Steel for the second site"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="association-future">
                Future messages without a matching reply reference
              </Label>
              <NativeSelect
                id="association-future"
                name="future"
                defaultValue="review"
              >
                <option value="review">Require association review</option>
                {target !== "review" && (
                  <option value="target">
                    Use the selected purchasing need
                  </option>
                )}
                {!changedBuyer && (
                  <option value="keep">
                    Keep the current conversation default
                  </option>
                )}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">
                A matching received-message reply reference follows that
                message&apos;s current association. Other messages follow this
                explicit choice.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="association-reason">
                Evidence and reason for this association
              </Label>
              <Textarea
                id="association-reason"
                name="reason"
                required
                maxLength={1000}
                placeholder="Explain how the buyer and purchasing need were verified."
              />
            </div>
            <Button disabled={!selected.length}>
              {pending ? "Saving…" : "Save association"}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
