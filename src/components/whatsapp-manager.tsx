"use client";
import { Field, FieldGroup } from "./ui/field";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  whatsAppConfigurationSchema,
  whatsAppViewSchema,
  metaCheckNames,
  type WhatsAppView,
  type MetaCompletion,
} from "@/models/whatsapp";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { NativeSelect } from "./ui/native-select";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import { MetaSignup, metaSignupSchema } from "./meta-signup";
import { WhatsAppEvidenceStatus } from "./whatsapp-evidence-status";
import { WhatsAppIntakeManager } from "./whatsapp-intake-manager";

const issueLabels: Record<string, string> = {
  configured:
    "Meta onboarding is unavailable until the operator completes production setup.",
  techProvider: "Operator: complete Meta Tech Provider access verification.",
  businessVerification: "Operator: verify the platform's Meta business.",
  appReview:
    "Operator: obtain App Review and Advanced Access for the required permissions.",
  liveApp: "Operator: publish the approved Meta app.",
  secureConfiguration:
    "Operator: configure the approved app, signup configuration and encrypted credential storage.",
  connection_required: "Save your number arrangement and control terms below.",
  authorization_required:
    "Complete Meta sign-in for your Business portfolio and number.",
  current_provider_check_required:
    "Check the connection to obtain current account and number evidence.",
  unsupported_coexistence:
    "Business App coexistence is unavailable for this setup. Keep your current app workflow until a supported path is verified.",
  customer_ownership:
    "Use a WhatsApp account owned by your selected Meta Business portfolio.",
  business_verification: "Complete your Business verification in Meta.",
  account_review: "Resolve the WhatsApp account review in Meta.",
  number_verified:
    "Verify the number in Meta using the code sent to your own SIM or phone line.",
  number_registered: "Complete number registration, then check its status.",
  permissions:
    "Reconnect and grant the required business and WhatsApp permissions.",
  customer_payment_method:
    "Add your own payment method in WhatsApp Manager, then ask the onboarding operator to review your account-specific billing evidence below.",
  coexistence:
    "Meta has not confirmed the requested Business App coexistence path for this number.",
};
const checkLabels = {
  customer_ownership: "Customer account ownership",
  business_verification: "Customer Business verification",
  account_review: "WhatsApp account review",
  number_verified: "Number verification",
  number_registered: "Number registration",
  permissions: "Required permissions",
  customer_payment_method: "Customer-paid Meta billing",
  coexistence: "Number and Business App path",
};
const statusLabels = {
  setup_required: "Setup incomplete",
  connecting: "Meta sign-in incomplete",
  verifying: "Checking connection",
  connected: "Authorization stored",
  reconnect_required: "Reconnect required",
  disconnected: "Disconnected locally",
};
const reasonLabels = {
  consent_cancelled: "Meta sign-in was cancelled. Connect when you are ready.",
  consent_failed: "Meta sign-in failed. Review your account setup and retry.",
  incomplete_setup:
    "Meta sign-in finished without a complete account and verified number. Finish number setup and reconnect.",
  provider_unavailable:
    "Meta could not be checked. Earlier positive evidence has been cleared; check again when available.",
  invalid_response:
    "Meta's account details could not be verified. Reconnect or ask the operator to review setup.",
  revoked:
    "Meta authorization expired or was revoked. Reconnect to restore access.",
  insufficient_permissions:
    "Required permissions or customer asset ownership could not be verified. Review your Meta portfolio and reconnect.",
  unsupported_coexistence: issueLabels.unsupported_coexistence,
  exchange_uncertain:
    "The one-use authorization exchange could not be confirmed. Start a fresh Meta connection.",
  registration_uncertain:
    "Registration may have completed at Meta. Check the connection before attempting registration again.",
};
type Section = "save" | "connect" | "read" | "register" | "disconnect";
type Feedback = {
  section: Section;
  error: boolean;
  text: string;
  recovery?: "security" | "sign-in";
};
class FormFailure extends Error {}

export function WhatsAppManager({
  businessId,
  initialState,
}: {
  businessId: string;
  initialState: WhatsAppView;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [signup, setSignup] = useState<z.infer<typeof metaSignupSchema> | null>(
    null,
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const base = `/api/businesses/${businessId}/whatsapp`;
  const command = useCallback(
    async (
      action:
        "save" | "start" | "complete" | "refresh" | "register" | "disconnect",
      input: unknown,
      section: Section,
    ) => {
      setPending(true);
      setFeedback(null);
      try {
        const response = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, input }),
        });
        const raw: unknown = await response.json();
        if (!response.ok) {
          const failure = z.object({ code: z.string() }).safeParse(raw);
          const code = failure.success ? failure.data.code : "";
          setFeedback({
            section,
            error: true,
            text:
              code === "MFA_REQUIRED"
                ? "Verify your authenticator in Security, then retry. Your form is preserved."
                : code === "UNAUTHENTICATED"
                  ? "Sign in again in a new tab, then retry. Your form is preserved."
                  : code === "CONFLICT"
                    ? "The connection changed or this signup expired. Reload its status, then start a fresh connection."
                    : code === "CHANNEL_SETUP_REQUIRED"
                      ? "This Meta onboarding path is not configured. Review the missing setup above."
                      : "The action could not be completed. Check the fields and reload the connection status.",
            ...(code === "MFA_REQUIRED"
              ? { recovery: "security" }
              : code === "UNAUTHENTICATED"
                ? { recovery: "sign-in" }
                : {}),
          });
          return;
        }
        if (action === "start")
          setSignup(
            metaSignupSchema.parse(
              z.object({ data: z.unknown() }).parse(raw).data,
            ),
          );
        else if (
          action === "complete" ||
          action === "disconnect" ||
          action === "save"
        )
          setSignup(null);
        const reloaded = await fetch(base, { cache: "no-store" });
        if (!reloaded.ok)
          throw new FormFailure(
            "The action completed, but status could not reload. Reload status to review the result.",
          );
        const next = z
          .object({ data: whatsAppViewSchema })
          .parse(await reloaded.json());
        setState(next.data);
        setFeedback({
          section,
          error: false,
          text:
            action === "save"
              ? "Number arrangement saved. Meta verification is still required."
              : action === "start"
                ? "Meta sign-in is prepared. Continue below."
                : action === "disconnect"
                  ? "Local access removed. Your customer-owned account and number remain with you."
                  : "Connection status updated. Review the separate setup checks.",
        });
      } catch (error: unknown) {
        setFeedback({
          section,
          error: true,
          text:
            error instanceof FormFailure
              ? error.message
              : "The action could not be confirmed. Reload status before retrying.",
        });
      } finally {
        setPending(false);
      }
    },
    [base],
  );
  const complete = useCallback(
    async (input: MetaCompletion) => {
      await command("complete", input, "connect");
    },
    [command],
  );
  const reportError = useCallback(
    (text: string) => setFeedback({ section: "connect", error: true, text }),
    [],
  );
  async function reload() {
    setPending(true);
    try {
      const r = await fetch(base, { cache: "no-store" });
      if (!r.ok) throw new Error();
      setState(
        z.object({ data: whatsAppViewSchema }).parse(await r.json()).data,
      );
      setFeedback({
        section: "read",
        error: false,
        text: "Saved status reloaded. Use Check connection for fresh Meta evidence.",
      });
    } catch {
      setFeedback({
        section: "read",
        error: true,
        text: "Status could not reload. Restore your session and retry.",
        recovery: "sign-in",
      });
    } finally {
      setPending(false);
    }
  }
  function feedbackFor(section: Section) {
    if (feedback?.section !== section) return null;
    return (
      <div className="flex flex-col gap-2">
        {feedback.error ? (
          <Alert>{feedback.text}</Alert>
        ) : (
          <p role="status" className="text-sm">
            {feedback.text}
          </p>
        )}
        {feedback.recovery && (
          <Link
            href={feedback.recovery === "security" ? "/security" : "/sign-in"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            {feedback.recovery === "security"
              ? "Open Security"
              : "Open sign-in"}{" "}
            in a new tab
          </Link>
        )}
      </div>
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const configuration = whatsAppConfigurationSchema.safeParse({
      portfolioId: form.get("portfolioId"),
      numberSource: form.get("numberSource"),
      requestedNumber: form.get("requestedNumber"),
      provisioningTerms: form.get("provisioningTerms"),
      customerControlsAssets: form.get("customerControlsAssets") === "on",
      customerPaysMeta: form.get("customerPaysMeta") === "on",
      termsVersion: "direct_meta_v1",
    });
    if (!configuration.success) {
      setFeedback({
        section: "save",
        error: true,
        text: "Enter the Meta portfolio ID, international number and at least 30 characters of control/transfer terms, and confirm both ownership and separate billing.",
      });
      return;
    }
    await command(
      "save",
      {
        expectedVersion: state.connection?.version ?? 0,
        configuration: configuration.data,
      },
      "save",
    );
  }
  const c = state.connection;
  const lastObservation = c?.observation;
  return (
    <div className="flex flex-col gap-8">
      <WhatsAppIntakeManager
        key={`${c?.version}-${state.intake.inboxConnectionId}`}
        businessId={businessId}
        version={c?.version ?? null}
        initialState={state.intake}
        canManage={state.canManage}
      />
      <Card>
        <CardHeader>
          <CardTitle>Customer-owned channel, separate Meta bill</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{state.billing.disclosure}</p>
          <a
            href="https://business.whatsapp.com/products/platform-pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            Review Meta pricing (opens a new tab)
          </a>
          <p className="text-sm text-muted-foreground">
            You retain your Meta portfolio, WhatsApp account, number, SIM/phone
            access and payment method. We request access to provide automation.
            Disconnecting here removes local access; revoke the app in Meta
            Business settings to end Meta-side access. No number is deregistered
            or transferred here.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connection readiness</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Badge>{c ? statusLabels[c.status] : "Not connected"}</Badge>
            <Badge>
              {state.readiness.onboardingReady
                ? "Onboarding checks confirmed"
                : "Onboarding not ready"}
            </Badge>
            <Badge>
              {state.readiness.sendingReady
                ? "Sending account checks ready"
                : "Sending requires separate setup"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Onboarding does not enable sending, recipient permission, approved
            templates or conversation windows. Incoming capture and supported
            manual activity have their own evidence above.
          </p>
          {c?.reason && (
            <p className="rounded-lg bg-muted p-4 text-sm">
              {reasonLabels[c.reason]}
            </p>
          )}
          {state.readiness.issues.length > 0 && (
            <ul className="flex flex-col list-disc gap-2 ps-5 text-sm">
              {state.readiness.issues.map((issue, i) => (
                <li key={`${issue}-${i}`}>
                  {issueLabels[issue] ??
                    "Review account setup with the operator."}
                </li>
              ))}
            </ul>
          )}
          {lastObservation && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Last provider observation. Current readiness above also requires
                unexpired evidence.
              </p>
              <p className="font-medium wrap-anywhere">
                {lastObservation.displayNumber}
              </p>
              <dl className="grid gap-3 sm:grid-cols-2">
                {metaCheckNames.map((name) => (
                  <div key={name}>
                    <dt className="text-sm text-muted-foreground">
                      {checkLabels[name]}
                    </dt>
                    <dd className="mt-1 text-sm font-medium">
                      {
                        {
                          confirmed: "Confirmed",
                          missing: "Missing",
                          unknown: "Not verified",
                          unsupported: "Unsupported",
                        }[lastObservation.checks[name]]
                      }
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted-foreground">
                Last checked{" "}
                {new Date(lastObservation.observedAt).toLocaleString()}.
                Evidence expires{" "}
                {new Date(lastObservation.validUntil).toLocaleString()}.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void reload()}
            >
              Reload saved status
            </Button>
            {c && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  pending || c.status !== "connected" || !state.setup.configured
                }
                onClick={() =>
                  void command(
                    "refresh",
                    { expectedVersion: c.version },
                    "read",
                  )
                }
              >
                {pending ? "Working…" : "Check connection"}
              </Button>
            )}
          </div>
          {feedbackFor("read")}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Customer control and direct Meta payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <WhatsAppEvidenceStatus evidence={state.paymentEvidence} />
          <p className="text-sm text-muted-foreground">
            For assisted review, share this Business ID with your onboarding
            operator:{" "}
            <span className="font-medium text-foreground wrap-anywhere">
              {businessId}
            </span>
            . Show your customer portfolio, WhatsApp account and number control,
            and Meta billing settings identifying your Business as the direct
            payer. Use the agreed secure support channel for redacted documents;
            never send card numbers, security codes, OTPs or access tokens.
          </p>
          {c?.assets && (
            <p className="text-sm wrap-anywhere">
              Selected portfolio {c.assets.portfolioId} · WhatsApp account{" "}
              {c.assets.wabaId} · Number {c.assets.phoneNumberId} · Connection
              version {c.version}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            The operator records the review in Platform → WhatsApp evidence.
            Reload saved status after review. Changed terms, reconnection or
            local disconnection require a new review; expired or revoked
            evidence cannot complete onboarding.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Number arrangement and control</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-col gap-5">
            <FieldGroup className="gap-5">
              <fieldset disabled={pending} className="flex flex-col gap-5">
                <p className="text-sm text-muted-foreground">
                  Record the actual arrangement before authorizing Meta access.
                  For assisted setup, state who buys the number, controls OTP
                  access, pays the carrier and can authorize a transfer. Saving
                  changes requires fresh Meta sign-in.
                </p>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="wa-portfolio">
                    Your Meta Business portfolio ID
                  </Label>
                  <Input
                    id="wa-portfolio"
                    name="portfolioId"
                    inputMode="numeric"
                    pattern="[0-9]{1,40}"
                    required
                    defaultValue={c?.configuration.portfolioId ?? ""}
                  />
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="wa-number">
                    Business phone number, including country code
                  </Label>
                  <Input
                    id="wa-number"
                    name="requestedNumber"
                    type="tel"
                    autoComplete="tel"
                    pattern="\+[1-9][0-9]{6,14}"
                    placeholder="+14155550123"
                    required
                    defaultValue={c?.configuration.requestedNumber ?? ""}
                  />
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="wa-source">Number setup path</Label>
                  <NativeSelect
                    id="wa-source"
                    name="numberSource"
                    defaultValue={
                      c?.configuration.numberSource ?? "existing_cloud"
                    }
                  >
                    <option value="existing_cloud">
                      Existing Cloud API number
                    </option>
                    <option value="business_app">
                      Keep using the WhatsApp Business App (eligibility
                      required)
                    </option>
                    <option value="assisted_new">
                      Assisted setup of a new customer-controlled number
                    </option>
                  </NativeSelect>
                  <p className="text-sm text-muted-foreground">
                    {state.setup.coexistence
                      ? "Business App use still needs Meta's supported coexistence completion and a number check."
                      : "Business App coexistence is currently unavailable. Selecting this path records your request and cannot make it ready."}
                  </p>
                </Field>
                <Field className="flex flex-col gap-2">
                  <Label htmlFor="wa-terms">
                    Provisioning, control and transfer terms
                  </Label>
                  <Textarea
                    id="wa-terms"
                    name="provisioningTerms"
                    required
                    minLength={30}
                    maxLength={2000}
                    rows={5}
                    defaultValue={c?.configuration.provisioningTerms ?? ""}
                  />
                  <p className="text-sm text-muted-foreground">
                    Include any carrier/provider restrictions and the steps
                    needed to release or transfer the number. No automatic
                    transfer or guaranteed retention of app features is
                    promised.
                  </p>
                </Field>
                <label
                  htmlFor="wa-control"
                  className="flex min-h-11 items-start gap-3 py-2"
                >
                  <Checkbox
                    id="wa-control"
                    name="customerControlsAssets"
                    value="on"
                    required
                    defaultChecked={Boolean(c)}
                  />
                  <span className="text-sm">
                    Our Business controls the Meta portfolio, account and
                    number, or will retain those controls under the recorded
                    assisted setup terms.
                  </span>
                </label>
                <label
                  htmlFor="wa-billing"
                  className="flex min-h-11 items-start gap-3 py-2"
                >
                  <Checkbox
                    id="wa-billing"
                    name="customerPaysMeta"
                    value="on"
                    required
                    defaultChecked={Boolean(c)}
                  />
                  <span className="text-sm">
                    Our Business supplies its own Meta payment method and pays
                    Meta usage separately from the automation subscription. This
                    declaration does not verify billing setup.
                  </span>
                </label>
                <Button type="submit">
                  {pending ? "Working…" : "Save number arrangement"}
                </Button>
              </fieldset>
              {feedbackFor("save")}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      {c && (
        <Card>
          <CardHeader>
            <CardTitle>Authorize with Meta</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Use your own Meta administrator login. Complete account selection,
              number verification and payment setup at Meta. A partial or
              cancelled signup remains incomplete.
            </p>
            <Button
              type="button"
              disabled={
                pending ||
                !state.setup.configured ||
                (c.configuration.numberSource === "business_app" &&
                  !state.setup.coexistence)
              }
              onClick={() =>
                void command("start", { expectedVersion: c.version }, "connect")
              }
            >
              {signup ? "Prepare a fresh Meta sign-in" : "Prepare Meta sign-in"}
            </Button>
            {signup && (
              <MetaSignup
                key={signup.state}
                signup={signup}
                complete={complete}
                reportError={reportError}
              />
            )}
            {feedbackFor("connect")}
          </CardContent>
        </Card>
      )}
      {c &&
        c.configuration.numberSource !== "business_app" &&
        (c.observation?.checks.number_registered === "missing" ||
          c.reason === "registration_uncertain" ||
          feedback?.section === "register") && (
          <Card>
            <CardHeader>
              <CardTitle>Register your verified number</CardTitle>
            </CardHeader>
            <CardContent>
              {c.observation?.checks.number_registered === "missing" &&
              c.reason === null ? (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const pin = new FormData(form).get("pin");
                    void command(
                      "register",
                      { expectedVersion: c.version, pin },
                      "register",
                    ).finally(() => form.reset());
                  }}
                >
                  <FieldGroup className="gap-4">
                    <p className="text-sm text-muted-foreground">
                      Registration uses your six-digit Meta two-step
                      verification PIN. Keep the PIN with your Business; it is
                      sent once to Meta and never saved here. Business App
                      coexistence does not use this registration action.
                    </p>
                    <Label htmlFor="wa-pin">Meta registration PIN</Label>
                    <Input
                      id="wa-pin"
                      name="pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                    />
                    <Button disabled={pending} type="submit">
                      Register number with Meta
                    </Button>
                  </FieldGroup>
                </form>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    Review the latest registration status before another
                    attempt.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || c.status !== "connected"}
                    onClick={() =>
                      void command(
                        "refresh",
                        { expectedVersion: c.version },
                        "register",
                      )
                    }
                  >
                    Check registration status
                  </Button>
                </div>
              )}
              {feedbackFor("register")}
            </CardContent>
          </Card>
        )}
      {c && c.status !== "disconnected" && (
        <Card>
          <CardHeader>
            <CardTitle>Remove local access</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Disconnect locally
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>
                  Disconnect this WhatsApp connection?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Local credentials and readiness evidence will be removed. Your
                  customer-owned Meta account and number remain in Meta. Remove
                  the app in Meta Business settings to revoke Meta-side
                  permissions.
                </AlertDialogDescription>
                <div className="flex flex-wrap justify-end gap-3">
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void command(
                        "disconnect",
                        { expectedVersion: c.version },
                        "disconnect",
                      )
                    }
                  >
                    Disconnect locally
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
      {feedbackFor("disconnect")}
    </div>
  );
}
