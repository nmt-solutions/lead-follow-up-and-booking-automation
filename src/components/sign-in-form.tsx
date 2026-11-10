"use client";
import { useRef, useState } from "react";
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
const headings = {
  password: {
    title: "Sign in to Lead Relay",
    description: "Enter your email and password.",
  },
  signup: {
    title: "Sign up for Lead Relay",
    description: "Enter your details to create an account.",
  },
  magic: {
    title: "Passwordless sign in",
    description: "Get a secure sign-in link by email.",
  },
  reset: {
    title: "Reset your password",
    description:
      "Use an email link and your authenticator to choose a new password.",
  },
  verify: {
    title: "Verify your email",
    description: "Open the verification link in your email to finish sign-up.",
  },
} satisfies Record<Mode, { title: string; description: string }>;
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
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState(
    linkFailed ? "This link expired. Request a new one." : "",
  );
  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setSent(false);
    setUnverified(false);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1
          id="sign-in-title"
          ref={heading}
          tabIndex={-1}
          className="font-display text-4xl leading-tight font-medium tracking-[-0.045em]"
        >
          {headings[mode].title}
        </h1>
        <p className="text-sm leading-7 text-muted-foreground">
          {headings[mode].description}
        </p>
      </div>
      <form
        className="flex flex-col gap-5"
        aria-busy={pending}
        aria-labelledby="sign-in-title"
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
                      : "Check your email and password, or try passwordless sign in.",
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
                placeholder={
                  mode === "signup"
                    ? "Create a password"
                    : "Enter your password"
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
              {mode === "verify"
                ? "Check your email to verify your account."
                : mode === "reset"
                  ? "Check your email to continue resetting your password."
                  : "Check your email for your sign-in link."}{" "}
              The link is valid for 10 minutes.
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending
              ? "Please wait…"
              : mode === "password"
                ? "Sign in"
                : mode === "signup"
                  ? "Sign up"
                  : mode === "verify"
                    ? sent
                      ? "Resend verification email"
                      : "Send verification email"
                    : mode === "reset"
                      ? sent
                        ? "Resend reset link"
                        : "Send password reset link"
                      : sent
                        ? "Resend sign-in link"
                        : "Send sign-in link"}
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
              Passwordless sign in
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={pending}
              onClick={() => changeMode("signup")}
            >
              New to Lead Relay? Sign up
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => changeMode("password")}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : mode === "magic"
                ? "Sign in with a password"
                : "Back to sign in"}
          </Button>
        )}
        {mode === "magic" && (
          <Button
            type="button"
            variant="link"
            disabled={pending}
            onClick={() => changeMode("signup")}
          >
            New to Lead Relay? Sign up
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
