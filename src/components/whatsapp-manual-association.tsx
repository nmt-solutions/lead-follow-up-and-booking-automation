"use client";
import { FieldGroup } from "./ui/field";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { metaIntakeViewSchema } from "@/models/whatsapp-intake";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
export function WhatsAppManualAssociation({
  businessId,
  receiptId,
  messages,
}: {
  businessId: string;
  receiptId: string;
  messages: { id: string; text: string; opportunityId: string | null }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/whatsapp/intake`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "associate",
            input: { receiptId, messageId: data.get("messageId") },
          }),
        },
      );
      const result = z
        .object({ success: z.boolean(), data: metaIntakeViewSchema.optional() })
        .safeParse(await response.json());
      if (
        !response.ok ||
        !result.success ||
        !result.data.success ||
        !result.data.data
      ) {
        setError(
          "The association could not be confirmed. Ask an Owner/Admin with a verified session to review the message's current purchasing need and retry.",
        );
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("The result is unknown. Reload saved activity before retrying.");
    } finally {
      setPending(false);
    }
  }
  if (done)
    return (
      <p role="status" className="mt-4 text-success">
        Activity associated. Review human control before explicitly handing
        back.
      </p>
    );
  return (
    <form
      onSubmit={save}
      className="flex flex-col mt-5 gap-3 border-t pt-4"
      aria-busy={pending}
    >
      <FieldGroup className="gap-3">
        <Label htmlFor={`meta-anchor-${receiptId}`}>
          Which received message has the same purchasing need?
        </Label>
        <NativeSelect
          id={`meta-anchor-${receiptId}`}
          name="messageId"
          required
          defaultValue=""
        >
          <option value="" disabled>
            Choose an associated message
          </option>
          {messages
            .filter((m) => m.opportunityId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.text.slice(0, 100)}
              </option>
            ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          Owner/Admin review links this observed app activity to the selected
          message&apos;s current Opportunity and pauses its automation.
          Associate incoming messages first if the need is still unclear.
        </p>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Associating…"
            : "Associate activity and pause Opportunity"}
        </Button>
        {error && <Alert variant="destructive">{error}</Alert>}
      </FieldGroup>
    </form>
  );
}
