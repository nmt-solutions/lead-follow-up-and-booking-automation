"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { ArrowRight, Check, Copy, Loader2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import {
  enrollmentSchema,
  recoveryCodesSchema,
  securityStatusSchema,
  type SecurityStatus,
} from "@/models/security";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./ui/input-otp";
import { Field, FieldLabel, FieldGroup } from "./ui/field";
import { Alert, AlertDescription } from "./ui/alert";
import { Card, CardHeader, CardContent, CardDescription } from "./ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import { PasswordForm } from "./password-form";

export function SecurityManager({
  initialStatus,
  passwordRequested = false,
  initialHasPassword = false,
}: {
  initialStatus: SecurityStatus | null;
  passwordRequested?: boolean;
  initialHasPassword?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SecurityStatus>(
    initialStatus ?? {
      email: "",
      enrolled: true,
      required: true,
      verified: false,
      operatorVerified: false,
      operator: false,
      readiness: "mfa-incomplete",
    },
  );
  const [editingPassword, setEditingPassword] = useState(passwordRequested);
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [setupURI, setSetupURI] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [method, setMethod] = useState<"authenticator" | "recovery">(
    "authenticator",
  );
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [managementVerification, setManagementVerification] = useState(
    Boolean(
      passwordRequested && initialStatus && !initialStatus.operatorVerified,
    ),
  );
  const feedback = useRef<HTMLDivElement>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const needsVerification =
    status.readiness !== "mfa-satisfied" || managementVerification;
  const setupKey = setupURI
    ? (new URL(setupURI).searchParams.get("secret") ?? "")
    : "";
  const savingCodes = codes.length > 0 && !setupURI && !needsVerification;

  async function request(path: string, body: unknown = {}): Promise<unknown> {
    const response = await fetch(`/api/auth/two-factor/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        hasPassword &&
          ["enable", "disable", "generate-backup-codes"].includes(path)
          ? {
              ...(typeof body === "object" && body ? body : {}),
              password: currentPassword,
            }
          : body,
      ),
    });
    if (!response.ok) {
      const failure = z
        .object({ code: z.string().optional() })
        .safeParse(await response.json().catch(() => null));
      const retryable =
        failure.success &&
        ["INVALID_CODE", "INVALID_BACKUP_CODE"].includes(
          failure.data.code ?? "",
        );
      if (failure.success && failure.data.code === "INVALID_PASSWORD")
        throw new Error("Check your current password and try again.");
      if (failure.success && failure.data.code === "ACCOUNT_TEMPORARILY_LOCKED")
        throw new Error(
          "Too many attempts. Wait 15 minutes, then sign out and sign in again.",
        );
      if (
        failure.success &&
        failure.data.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
      ) {
        setSignInRequired(true);
        throw new Error("This verification attempt has ended. Sign in again.");
      }
      if (response.status === 403 && path === "enable")
        throw new Error(
          "Sign out, then sign in again to set up your authenticator.",
        );
      const expired =
        response.status === 401 &&
        !retryable &&
        (await fetch("/api/security", { cache: "no-store" })).status === 401;
      if (expired) setSignInRequired(true);
      if (
        response.status === 403 &&
        ["disable", "generate-backup-codes"].includes(path)
      ) {
        setManagementVerification(true);
        throw new Error("Verify your identity to continue.");
      }
      throw new Error(
        response.status === 429
          ? "Too many attempts. Try again in 15 minutes."
          : expired
            ? "Your session expired. Sign in again."
            : "That code didn't work. Please try again.",
      );
    }
    return response.json();
  }
  async function refresh() {
    const response = await fetch("/api/security", { cache: "no-store" });
    const result = z
      .object({ success: z.literal(true), data: securityStatusSchema })
      .safeParse(await response.json());
    if (!response.ok || !result.success)
      throw new Error("Unable to confirm your session. Please try again.");
    setStatus(result.data.data);
    setSignInRequired(false);
    return result.data.data;
  }
  async function run(operation: () => Promise<void>, focus?: string) {
    if (pending) return;
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
      requestAnimationFrame(() => {
        if (focus) document.getElementById(focus)?.focus();
        else feedback.current?.focus();
      });
    }
  }
  async function beginSetup() {
    const setup = enrollmentSchema.parse(await request("enable"));
    const uri = new URL(setup.totpURI);
    if (
      uri.protocol !== "otpauth:" ||
      uri.hostname !== "totp" ||
      !uri.searchParams.get("secret")
    )
      throw new Error(
        "Unable to prepare your authenticator. Please try again.",
      );
    setSetupURI(setup.totpURI);
    setCodes(setup.backupCodes);
    setCode("");
    setMethod("authenticator");
    setCurrentPassword("");
  }
  function continueToApp() {
    if (editingPassword) return;
    router.replace("/onboarding");
    router.refresh();
  }
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recovery = !setupURI && method === "recovery";
    void run(async () => {
      await request(recovery ? "verify-backup-code" : "verify-totp", {
        code: recovery ? recoveryCode.trim() : code,
      });
      const current = await refresh();
      if (current.readiness !== "mfa-satisfied")
        throw new Error("Unable to confirm verification. Please try again.");
      setCode("");
      setRecoveryCode("");
      setSetupURI("");
      if (managementVerification) {
        setManagementVerification(false);
        return;
      }
      if (!codes.length && !editingPassword) continueToApp();
    });
  }
  function changeMethod() {
    const next = method === "authenticator" ? "recovery" : "authenticator";
    setMethod(next);
    setError("");
    setMessage("");
    setCode("");
    setRecoveryCode("");
    requestAnimationFrame(() =>
      (next === "authenticator"
        ? otpInput.current
        : backupInput.current
      )?.focus(),
    );
  }
  const title = savingCodes
    ? "Save your recovery codes"
    : setupURI
      ? "Add your authenticator"
      : needsVerification && status.enrolled
        ? method === "recovery"
          ? "Use a recovery code"
          : "Verify your identity"
        : !status.enrolled
          ? "Secure your account"
          : "Account security";
  const description = savingCodes
    ? "Keep these somewhere safe. Each code works once."
    : setupURI
      ? "Scan the QR code, then enter the code from your app."
      : needsVerification && status.enrolled
        ? method === "recovery"
          ? "Enter one of your saved recovery codes."
          : "Enter the 6-digit code from your authenticator app."
        : !status.enrolled
          ? "Add an authenticator app to protect your account."
          : status.email;
  return (
    <div className="w-full max-w-md" aria-busy={pending}>
      <Card>
        <CardHeader className="items-center gap-3 pb-5 pt-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </span>
          <h1 className="font-display text-2xl font-medium tracking-tight">
            {title}
          </h1>
          <CardDescription className="max-w-xs text-center">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pb-7">
          {savingCodes ? (
            <>
              <ul
                aria-label="Recovery codes"
                className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/50 p-4 font-mono text-sm"
              >
                {codes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(codes.join("\n"));
                    setMessage("Recovery codes copied.");
                  })
                }
              >
                <Copy data-icon="inline-start" aria-hidden="true" />
                Copy codes
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setCodes([]);
                  continueToApp();
                }}
              >
                I&apos;ve saved my codes
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </>
          ) : (
            <>
              {setupURI && (
                <>
                  <div className="mx-auto rounded-2xl border border-border bg-white p-2 [forced-color-adjust:none]">
                    <QRCodeSVG
                      value={setupURI}
                      size={208}
                      marginSize={4}
                      level="M"
                      title="Scan to add Lead Relay to your authenticator"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  </div>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="manual" className="border-0">
                      <AccordionTrigger className="justify-center gap-2 py-2 text-sm">
                        Enter setup key manually
                      </AccordionTrigger>
                      <AccordionContent className="flex flex-col gap-3 pt-2">
                        <Field>
                          <FieldLabel htmlFor="setup-key">Setup key</FieldLabel>
                          <Input
                            id="setup-key"
                            value={setupKey}
                            readOnly
                            className="font-mono text-xs"
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            void run(async () => {
                              await navigator.clipboard.writeText(setupKey);
                              setMessage("Setup key copied.");
                            })
                          }
                        >
                          <Copy data-icon="inline-start" aria-hidden="true" />
                          Copy setup key
                        </Button>
                        <p className="text-xs leading-6 text-muted-foreground">
                          In your authenticator app, choose Enter setup key and
                          select time-based codes.
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
              {(setupURI || (status.enrolled && needsVerification)) && (
                <form onSubmit={verify}>
                  <FieldGroup className="gap-5">
                    <Field
                      data-invalid={Boolean(error)}
                      className="items-center"
                    >
                      <FieldLabel
                        className="sr-only"
                        htmlFor={
                          method === "recovery" && !setupURI
                            ? "recovery-code"
                            : "authenticator-code"
                        }
                      >
                        {method === "recovery" && !setupURI
                          ? "Recovery code"
                          : "Authenticator code"}
                      </FieldLabel>
                      {method === "recovery" && !setupURI ? (
                        <Input
                          ref={backupInput}
                          id="recovery-code"
                          type="password"
                          value={recoveryCode}
                          onChange={(event) =>
                            setRecoveryCode(event.target.value)
                          }
                          autoComplete="off"
                          autoFocus
                          pattern="[A-Za-z0-9]{5}-[A-Za-z0-9]{5}"
                          maxLength={11}
                          minLength={11}
                          placeholder="XXXXX-XXXXX"
                          required
                          disabled={pending}
                          aria-invalid={Boolean(error)}
                          aria-describedby={
                            error ? "verification-error" : undefined
                          }
                          className="text-center font-mono text-lg tracking-wider"
                        />
                      ) : (
                        <InputOTP
                          ref={otpInput}
                          id="authenticator-code"
                          maxLength={6}
                          minLength={6}
                          value={code}
                          onChange={setCode}
                          pattern={REGEXP_ONLY_DIGITS}
                          pasteTransformer={(value) =>
                            value.replace(/[\s-]/g, "")
                          }
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          pushPasswordManagerStrategy="none"
                          required
                          autoFocus
                          disabled={pending}
                          aria-invalid={Boolean(error)}
                          aria-describedby={
                            error ? "verification-error" : undefined
                          }
                          containerClassName="justify-center"
                        >
                          <InputOTPGroup>
                            {[0, 1, 2, 3, 4, 5].map((index) => (
                              <InputOTPSlot key={index} index={index} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      )}
                    </Field>
                    <Button
                      className="w-full"
                      type="submit"
                      disabled={
                        pending ||
                        (method === "recovery" && !setupURI
                          ? recoveryCode.trim().length !== 11
                          : code.length !== 6)
                      }
                    >
                      {pending && (
                        <Loader2
                          className="animate-spin"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                      )}
                      {pending ? "Verifying..." : "Continue"}
                    </Button>
                  </FieldGroup>
                  {!setupURI && (
                    <Button
                      type="button"
                      variant="link"
                      className="mt-3 w-full"
                      disabled={pending}
                      onClick={changeMethod}
                    >
                      {method === "authenticator"
                        ? "Use a recovery code"
                        : "Use authenticator code"}
                    </Button>
                  )}
                </form>
              )}
              {!status.enrolled && !setupURI && (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(beginSetup, "authenticator-code");
                  }}
                >
                  {hasPassword && (
                    <Field>
                      <FieldLabel htmlFor="enrollment-password">
                        Confirm your password
                      </FieldLabel>
                      <Input
                        id="enrollment-password"
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                        required
                        maxLength={128}
                        disabled={pending}
                      />
                    </Field>
                  )}
                  <Button className="w-full" type="submit" disabled={pending}>
                    {pending && (
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                    )}
                    {pending ? "Preparing..." : "Set up authenticator"}
                  </Button>
                </form>
              )}
              {!needsVerification && status.enrolled && !setupURI && (
                <>
                  <p className="flex items-center justify-center gap-2 text-sm text-success">
                    <Check className="size-4" aria-hidden="true" />
                    Authenticator enabled
                  </p>
                  {editingPassword ? (
                    <>
                      <PasswordForm
                        onVerify={() => setManagementVerification(true)}
                        onSaved={() => {
                          setHasPassword(true);
                          setEditingPassword(false);
                          setMessage("Password saved.");
                        }}
                      />
                      <Button
                        variant="ghost"
                        onClick={() => setEditingPassword(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button onClick={continueToApp}>
                      Continue to app
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  )}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="manage" className="border-0">
                      <AccordionTrigger>Manage security</AccordionTrigger>
                      <AccordionContent className="flex flex-col gap-3">
                        {hasPassword && (
                          <Field>
                            <FieldLabel htmlFor="security-password">
                              Current password
                            </FieldLabel>
                            <Input
                              id="security-password"
                              type="password"
                              autoComplete="current-password"
                              value={currentPassword}
                              onChange={(event) =>
                                setCurrentPassword(event.target.value)
                              }
                              maxLength={128}
                              disabled={pending}
                            />
                            <p className="text-xs text-muted-foreground">
                              Required to replace your authenticator or recovery
                              codes.
                            </p>
                          </Field>
                        )}
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={() => {
                            setEditingPassword(true);
                            if (!status.operatorVerified)
                              setManagementVerification(true);
                          }}
                        >
                          Set or change password
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              disabled={pending}
                              onClick={(event) => {
                                if (!status.operatorVerified) {
                                  event.preventDefault();
                                  setManagementVerification(true);
                                }
                              }}
                            >
                              Create new recovery codes
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle>
                              Replace recovery codes?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Your previous codes will stop working. Save the
                              new codes before leaving.
                            </AlertDialogDescription>
                            <div className="flex flex-wrap justify-end gap-3">
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  void run(async () => {
                                    const result = recoveryCodesSchema.parse(
                                      await request("generate-backup-codes"),
                                    );
                                    setCodes(result.backupCodes);
                                    setCurrentPassword("");
                                  })
                                }
                              >
                                Replace codes
                              </AlertDialogAction>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              disabled={pending}
                              onClick={(event) => {
                                if (!status.operatorVerified) {
                                  event.preventDefault();
                                  setManagementVerification(true);
                                }
                              }}
                            >
                              Replace authenticator
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogTitle>
                              Replace your authenticator?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Your current authenticator and recovery codes will
                              stop working. Set up and verify the replacement to
                              continue.
                            </AlertDialogDescription>
                            <div className="flex flex-wrap justify-end gap-3">
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  void run(async () => {
                                    await request("disable");
                                    setCodes([]);
                                    setSetupURI("");
                                    await refresh();
                                    await beginSetup();
                                  }, "authenticator-code")
                                }
                              >
                                Replace authenticator
                              </AlertDialogAction>
                            </div>
                          </AlertDialogContent>
                        </AlertDialog>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </>
              )}
            </>
          )}
          <div
            ref={feedback}
            tabIndex={-1}
            className="flex flex-col gap-3 outline-none"
            aria-live="polite"
          >
            {error && (
              <Alert variant="destructive">
                <AlertDescription id="verification-error">
                  {error}
                </AlertDescription>
              </Alert>
            )}
            {message && (
              <p
                role="status"
                className="text-center text-sm text-muted-foreground"
              >
                {message}
              </p>
            )}
            {signInRequired && (
              <Button asChild variant="outline">
                <Link href="/sign-in">Sign in again</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {needsVerification && (
        <p className="mt-5 text-center text-xs text-muted-foreground">
          {status.email}
        </p>
      )}
    </div>
  );
}
