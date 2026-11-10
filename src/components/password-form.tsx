"use client";
import { useState } from "react";
import { z } from "zod";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";

export function PasswordForm({
  onSaved,
  onVerify,
}: {
  onSaved: () => void;
  onVerify: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const password = String(new FormData(form).get("password") ?? "");
        setPending(true);
        setError("");
        try {
          const response = await fetch("/api/security/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const result = z
            .object({ success: z.boolean(), code: z.string().optional() })
            .safeParse(await response.json());
          if (!response.ok || !result.success || !result.data.success) {
            if (result.success && result.data.code === "MFA_REQUIRED") {
              onVerify();
              return;
            }
            setError(
              response.status === 401
                ? "Sign in again to save your password."
                : "Unable to save your password. Please try again.",
            );
            return;
          }
          form.reset();
          onSaved();
        } catch {
          setError("Check your connection and try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor="new-password">New password</FieldLabel>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a new password"
          minLength={12}
          maxLength={128}
          required
          disabled={pending}
          aria-describedby="new-password-hint"
        />
        <p id="new-password-hint" className="text-xs text-muted-foreground">
          At least 12 characters. Other sessions will be signed out.
        </p>
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
