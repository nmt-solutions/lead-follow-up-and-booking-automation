"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Copy,
  ArrowRight,
} from "lucide-react";
import { z } from "zod";
import {
  enrollmentSchema,
  recoveryCodesSchema,
  securityStatusSchema,
  type SecurityStatus,
} from "@/models/security";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

export function SecurityManager({
  initialStatus,
}: {
  initialStatus: SecurityStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [setupKey, setSetupKey] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);

  async function request(path: string, body: unknown = {}): Promise<unknown> {
    const response = await fetch(`/api/auth/two-factor/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const expired =
      response.status === 401 &&
      (await fetch("/api/security", { cache: "no-store" })).status === 401;
    if (expired) setSignInRequired(true);
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Too many attempts. Wait up to 15 minutes before trying again."
          : expired
            ? "Your session has ended. Sign in again to continue."
            : "We could not confirm this step. Check your code, or sign in again if your security session has expired.",
      );
    return response.json();
  }
  async function refresh() {
    const response = await fetch("/api/security", { cache: "no-store" });
    const parsed = z
      .object({ success: z.literal(true), data: securityStatusSchema })
      .safeParse(await response.json());
    if (!response.ok || !parsed.success)
      throw new Error(
        "We could not refresh your security status. Reload this page.",
      );
    setStatus(parsed.data.data);
    setSignInRequired(false);
  }
  async function run(operation: () => Promise<void>, focusTarget?: string) {
    setPending(true);
    setError("");
    setMessage("");
    setSignInRequired(false);
    try {
      await operation();
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Check your connection and try again.",
      );
    } finally {
      setPending(false);
      if (focusTarget)
        requestAnimationFrame(() =>
          document.getElementById(focusTarget)?.focus(),
        );
      else feedback.current?.focus();
    }
  }
  function verifyForm(recovery: boolean) {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const code = String(
            new FormData(event.currentTarget).get("code") ?? "",
          ).trim();
          const form = event.currentTarget;
          void run(async () => {
            await request(recovery ? "verify-backup-code" : "verify-totp", {
              code,
            });
            await refresh();
            form.reset();
            setSetupKey("");
            setMessage(
              recovery
                ? "Recovery code accepted. This code cannot be used again. Save new recovery codes or replace your lost authenticator below."
                : "Authenticator verified. You can continue to your Businesses.",
            );
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={recovery ? "recovery-code" : "authenticator-code"}>
            {recovery ? "Recovery code" : "Authenticator code"}
          </Label>
          <Input
            id={recovery ? "recovery-code" : "authenticator-code"}
            name="code"
            type={recovery ? "password" : "text"}
            inputMode={recovery ? "text" : "numeric"}
            autoComplete={recovery ? "off" : "one-time-code"}
            pattern={recovery ? "[A-Za-z0-9]{5}-[A-Za-z0-9]{5}" : "[0-9]{6}"}
            maxLength={recovery ? 11 : 6}
            minLength={recovery ? 11 : 6}
            required
            disabled={pending}
            aria-describedby={recovery ? "recovery-hint" : "authenticator-hint"}
            className="font-mono text-lg tracking-widest"
          />
          <p
            id={recovery ? "recovery-hint" : "authenticator-hint"}
            className="text-sm text-muted-foreground"
          >
            {recovery
              ? "Enter one unused code, including the hyphen. Each code works once."
              : "Enter the six-digit code from your authenticator app."}
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          <ShieldCheck aria-hidden="true" />
          {pending
            ? "Verifying…"
            : recovery
              ? "Use recovery code"
              : "Verify authenticator"}
        </Button>
      </form>
    );
  }
  return (
    <div
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      aria-busy={pending}
    >
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Protect your access</CardTitle>
              <Badge
                className={status.verified ? "text-success" : "text-warning"}
              >
                {status.verified ? (
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="size-3.5" aria-hidden="true" />
                )}
                {status.verified
                  ? "Session verified"
                  : status.enrolled
                    ? "Verification needed"
                    : "Setup needed"}
              </Badge>
            </div>
            <CardDescription>
              Owners, Admins and platform operators need an authenticator or
              recovery code before using protected capabilities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-4 rounded-xl bg-muted p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Authenticator</dt>
                <dd className="mt-1 font-medium">
                  {status.enrolled
                    ? "Enrolled"
                    : setupKey
                      ? "Waiting for confirmation"
                      : "Not enrolled"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">MFA prerequisite</dt>
                <dd className="mt-1 font-medium">
                  {status.readiness === "mfa-satisfied"
                    ? "Satisfied for this session"
                    : "Incomplete"}
                </dd>
              </div>
            </dl>
            {!status.enrolled && !setupKey && (
              <div className="space-y-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Add this account to an authenticator app, then save your
                  recovery codes somewhere private. Your email sign-in link
                  remains the first step.
                </p>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      const setup = enrollmentSchema.parse(
                        await request("enable"),
                      );
                      const key = new URL(setup.totpURI).searchParams.get(
                        "secret",
                      );
                      if (!key)
                        throw new Error(
                          "Setup could not be confirmed. Try again.",
                        );
                      setSetupKey(key);
                      setCodes(setup.backupCodes);
                      setMessage(
                        "Setup key created. Add it to your authenticator, save your recovery codes, then verify a code.",
                      );
                    }, "setup-key")
                  }
                >
                  <KeyRound aria-hidden="true" />
                  {pending ? "Preparing setup…" : "Set up authenticator"}
                </Button>
              </div>
            )}
            {setupKey && (
              <div className="space-y-5">
                <div className="space-y-3">
                  <h3 className="font-semibold">Add your account</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    In your authenticator app, choose to enter a setup key. Use{" "}
                    <strong className="wrap-anywhere">{status.email}</strong> as
                    the account name and choose time-based codes.
                  </p>
                  <Label htmlFor="setup-key">Private setup key</Label>
                  <Input
                    id="setup-key"
                    value={setupKey}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(setupKey);
                        setMessage("Setup key copied. Keep it private.");
                      })
                    }
                  >
                    <Copy aria-hidden="true" />
                    Copy setup key
                  </Button>
                </div>
                {verifyForm(false)}
              </div>
            )}
            {status.enrolled && (
              <Tabs defaultValue="authenticator">
                <TabsList aria-label="Verification method" className="w-full">
                  <TabsTrigger value="authenticator">Authenticator</TabsTrigger>
                  <TabsTrigger value="recovery">Recovery code</TabsTrigger>
                </TabsList>
                <TabsContent value="authenticator">
                  {verifyForm(false)}
                </TabsContent>
                <TabsContent value="recovery">{verifyForm(true)}</TabsContent>
              </Tabs>
            )}
            {status.verified && (
              <Alert variant="success">
                <AlertTitle>MFA confirmed</AlertTitle>
                <AlertDescription>
                  Your current Business permissions still apply. MFA does not
                  grant access to another Business or add platform permissions.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        {codes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Save your recovery codes</CardTitle>
              <CardDescription>
                Keep these somewhere private, separate from your authenticator.
                Each code works once. They disappear from this page when you
                leave.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul
                aria-label="Recovery codes"
                className="grid gap-2 rounded-xl bg-muted p-4 font-mono text-sm sm:grid-cols-2"
              >
                {codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(codes.join("\n"));
                      setMessage(
                        "Recovery codes copied. Save them in a private place.",
                      );
                    })
                  }
                >
                  <Copy aria-hidden="true" />
                  Copy recovery codes
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setCodes([]);
                    setMessage(
                      "Recovery codes hidden. Your saved codes remain valid.",
                    );
                  }}
                >
                  I’ve saved my codes
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <div
          ref={feedback}
          tabIndex={-1}
          className="space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        >
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Check this step</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {message && (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {signInRequired && (
            <Button asChild variant="outline">
              <Link href="/sign-in">Sign in again</Link>
            </Button>
          )}
        </div>
        {status.verified && (
          <Card>
            <CardHeader>
              <CardTitle>Recovery options</CardTitle>
              <CardDescription>
                If you have lost your authenticator, use a saved recovery code
                above, then replace the authenticator. Security changes require
                MFA within the last 15 minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={pending}>
                    Create new recovery codes
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>
                    Replace your recovery codes?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    All previous recovery codes will stop working immediately.
                    Save the new codes somewhere private before leaving this
                    page.
                  </AlertDialogDescription>
                  <div className="flex flex-wrap justify-end gap-3">
                    <AlertDialogCancel>Keep existing codes</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void run(async () => {
                          const result = recoveryCodesSchema.parse(
                            await request("generate-backup-codes"),
                          );
                          setCodes(result.backupCodes);
                          setMessage(
                            "New recovery codes created. All previous recovery codes are now invalid.",
                          );
                        })
                      }
                    >
                      Create new recovery codes
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={pending}>
                    Replace authenticator
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>
                    Replace your authenticator?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Your current authenticator and recovery codes will stop
                    working. Protected access will be blocked until you enroll
                    and verify a new authenticator. Your Business permissions
                    stay the same.
                  </AlertDialogDescription>
                  <div className="flex flex-wrap justify-end gap-3">
                    <AlertDialogCancel>Keep authenticator</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void run(async () => {
                          await request("disable");
                          setCodes([]);
                          setSetupKey("");
                          await refresh();
                          setMessage(
                            "Old authenticator removed. Set up and verify your replacement to restore protected access.",
                          );
                        })
                      }
                    >
                      Replace authenticator
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}
      </div>
      <aside className="space-y-5 rounded-2xl border border-border bg-card p-6 text-sm leading-relaxed">
        <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Your access, explained</h2>
        <p className="text-muted-foreground">
          A sign-in link confirms your email. Your authenticator confirms a
          second factor for this session.
        </p>
        <p className="text-muted-foreground">
          Business access is verified for up to 12 hours. Platform operations
          require verification within 15 minutes and a separate operator grant.
        </p>
        <p className="text-muted-foreground">
          If you lose both your authenticator and recovery codes, email alone
          cannot restore privileged access. Ask your service operator for a
          reviewed recovery process.
        </p>
        <Button
          asChild
          variant={status.verified ? "default" : "outline"}
          className="w-full"
        >
          <Link href="/businesses">
            {status.verified ? "Continue to Businesses" : "Your Businesses"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          MFA is one production prerequisite. Other setup may still be
          incomplete.
        </p>
      </aside>
    </div>
  );
}
