"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { profileSchema } from "@/models/registration";
import { RegistrationFields } from "./registration-fields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";

type Mode = "password" | "signup" | "magic" | "reset" | "verify";
export function SignInForm({
  linkFailed,
  callbackURL = "/security",
}: {
  linkFailed: boolean;
  callbackURL?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [error, setError] = useState(
    linkFailed ? "This link expired. Request a new one." : "",
  );
  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setSent(false);
    setUnverified(false);
  }
  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-5"
        aria-busy={pending}
        onSubmit={async (event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          setPending(true);
          setError("");
          setSent(false);
          try {
            if (mode === "password") {
              const result = await authClient.signIn.email({
                email: email.trim(),
                password: String(values.get("password") ?? ""),
              });
              if (result.error) {
                setError(
                  result.error.status === 429
                    ? "Please wait before trying again."
                    : result.error.code === "EMAIL_NOT_VERIFIED"
                      ? "Verify your email before signing in."
                      : "Check your email and password, or use a magic link.",
                );
                setUnverified(result.error.code === "EMAIL_NOT_VERIFIED");
                return;
              }
              router.push(callbackURL);
              router.refresh();
              return;
            }
            if (mode === "signup") {
              const profile = profileSchema.safeParse(
                Object.fromEntries(values),
              );
              if (!profile.success) {
                setError("Enter your name and account details.");
                return;
              }
              const response = await fetch("/api/auth/sign-up/email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...profile.data,
                  name: `${profile.data.firstName} ${profile.data.lastName}`,
                  email: email.trim(),
                  password: String(values.get("password") ?? ""),
                }),
              });
              if (!response.ok) {
                setError(
                  response.status === 429
                    ? "Please wait before trying again."
                    : "Unable to create your account. Check your details and try again.",
                );
                return;
              }
              const verification = await authClient.sendVerificationEmail({
                email: email.trim(),
                callbackURL: "/security",
              });
              if (verification.error) {
                setError(
                  "Your account may be saved. Use Resend verification email to continue.",
                );
                setMode("verify");
                return;
              }
              setMode("verify");
              setSent(true);
              return;
            }
            if (mode === "verify") {
              const result = await authClient.sendVerificationEmail({
                email: email.trim(),
                callbackURL: "/security",
              });
              if (result.error) {
                setError(
                  "Unable to send your verification email. Please try again.",
                );
                return;
              }
              setSent(true);
              return;
            }
            const result = await authClient.signIn.magicLink({
              email: email.trim(),
              callbackURL:
                mode === "reset" ? "/security?password=1" : callbackURL,
              newUserCallbackURL: "/security?profile=1",
              errorCallbackURL: "/sign-in?error=link",
            });
            if (result.error) {
              setError(
                result.error.status === 429
                  ? "Please wait a minute before requesting another link."
                  : "Unable to send your link. Please try again.",
              );
              return;
            }
            setSent(true);
          } catch {
            setError("Check your connection and try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        {mode !== "password" && (
          <h2 className="font-display text-xl font-medium">
            {mode === "signup"
              ? "Create your account"
              : mode === "reset"
                ? "Reset your password"
                : mode === "verify"
                  ? "Verify your email"
                  : "Sign in with a magic link"}
          </h2>
        )}
        <FieldGroup className="gap-4">
          {mode === "signup" && <RegistrationFields disabled={pending} />}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
              placeholder="you@example.com"
            />
          </Field>
          {(mode === "password" || mode === "signup") && (
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                {mode === "password" && (
                  <Button
                    variant="link"
                    type="button"
                    className="px-0 text-xs"
                    disabled={pending}
                    onClick={() => changeMode("reset")}
                  >
                    Forgot password?
                  </Button>
                )}
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={mode === "signup" ? 12 : undefined}
                maxLength={128}
                required
                disabled={pending}
                aria-describedby={
                  mode === "signup" ? "password-hint" : undefined
                }
              />
              {mode === "signup" && (
                <p id="password-hint" className="text-xs text-muted-foreground">
                  Use at least 12 characters.
                </p>
              )}
            </Field>
          )}
          {mode === "reset" && (
            <p className="text-sm text-muted-foreground">
              Open the email link and verify with your authenticator to choose a
              new password.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {sent && (
            <p
              role="status"
              className="rounded-xl border border-success/20 bg-success/5 p-4 text-sm leading-6"
            >
              Check your email for a link, valid for 10 minutes.
              {mode === "signup"
                ? " Open it to verify your email and finish setup."
                : ""}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending
              ? "Please wait…"
              : mode === "password"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : sent
                    ? "Send another link"
                    : "Email me a link"}
          </Button>
        </FieldGroup>
      </form>
      <div className="flex flex-col gap-1 border-t border-border pt-4">
        {mode === "password" ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => changeMode("magic")}
            >
              Use a magic link
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={pending}
              onClick={() => changeMode("signup")}
            >
              New to Lead Relay? Create account
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => changeMode("password")}
          >
            Back to sign in
          </Button>
        )}
        {mode === "password" && unverified && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => changeMode("verify")}
          >
            Resend verification email
          </Button>
        )}
      </div>
    </div>
  );
}
