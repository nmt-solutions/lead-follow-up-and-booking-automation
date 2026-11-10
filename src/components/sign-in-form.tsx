"use client";
import { Field, FieldGroup } from "./ui/field";

import { useState } from "react";
import { Mail, Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export function SignInForm({
  linkFailed,
  callbackURL = "/security",
}: {
  linkFailed: boolean;
  callbackURL?: string;
}) {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState(
    linkFailed
      ? "This sign-in link is no longer valid. Request a new one below."
      : "",
  );
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const email = String(
          new FormData(event.currentTarget).get("email") ?? "",
        ).trim();
        setPending(true);
        setError("");
        setSentTo("");
        try {
          const result = await authClient.signIn.magicLink({
            email,
            callbackURL,
            newUserCallbackURL: callbackURL,
            errorCallbackURL: "/sign-in",
          });
          if (result.error) {
            setError(
              result.error.status === 429
                ? "Please wait a minute before requesting another link."
                : "We could not send your sign-in link. Please try again.",
            );
            return;
          }
          setSentTo(email);
        } catch {
          setError("Check your connection and try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <FieldGroup className="gap-6">
        <Field className="flex flex-col gap-2">
          <Label htmlFor="email">Your email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            aria-describedby="email-hint"
            placeholder="you@yourbusiness.com"
            disabled={pending}
          />
          <p
            id="email-hint"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            We’ll email you a secure link. No password to remember.
          </p>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {sentTo && (
          <Alert variant="success">
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              We sent a sign-in link to{" "}
              <span className="break-all">{sentTo}</span>. It is valid for 10
              minutes. Check your spam folder if it does not arrive.
            </AlertDescription>
          </Alert>
        )}
        <Button className="w-full" type="submit" disabled={pending}>
          {pending ? (
            <Loader2
              className="animate-spin"
              data-icon="inline-start"
              aria-hidden="true"
            />
          ) : (
            <Mail data-icon="inline-start" aria-hidden="true" />
          )}
          {pending
            ? "Sending link…"
            : sentTo
              ? "Send another link"
              : "Continue with email"}
        </Button>
      </FieldGroup>
    </form>
  );
}
