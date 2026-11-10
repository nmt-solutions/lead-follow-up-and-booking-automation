"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { z } from "zod";
import type { BusinessProfile } from "@/models/business";
import {
  startDiscoverySchema,
  type DiscoveryWorkspace,
} from "@/models/discovery";
import type { GoogleCalendarView } from "@/models/google-calendar";
import type { MicrosoftCalendarView } from "@/models/microsoft-calendar";
import { SetupIllustration } from "./setup-illustration";
import { CalendarConnection } from "./calendar-connection";
import { ProviderMark } from "./provider-mark";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertDescription } from "./ui/alert";

type Step = "email" | "calendar" | "search";
type State = {
  profile: Pick<BusinessProfile, "offering" | "homeMarket" | "configuration">;
  emails: { account: string; provider: "gmail" | "microsoft" }[];
  availableProviders: { gmail: boolean; microsoft: boolean };
  google: GoogleCalendarView;
  microsoft: MicrosoftCalendarView;
  discovery: DiscoveryWorkspace;
};
const steps = [
  { key: "business", label: "Business" },
  { key: "email", label: "Email" },
  { key: "calendar", label: "Calendar" },
  { key: "search", label: "First search" },
];

export function SetupConnections({
  businessId,
  step,
  state,
  connectionFailed,
}: {
  businessId: string;
  step: Step;
  state: State;
  connectionFailed: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState("");
  const search = state.discovery;
  const [offering, setOffering] = useState(
    search.policy?.exa?.publicOfferings[0] ??
      state.profile.offering.slice(0, 400),
  );
  const [market, setMarket] = useState(
    search.availableMarkets.find(
      (value) => value === state.profile.homeMarket,
    ) ??
      search.availableMarkets[0] ??
      "",
  );
  const [budget, setBudget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const key = useRef<{ scope: string; value: string } | null>(null);
  const busy = useRef(false);
  const current = steps.findIndex((item) => item.key === step);
  const ready =
    search.canRun &&
    search.setup.length === 0 &&
    Boolean(search.policy && search.brief);
  useEffect(() => {
    // Navigation preference only; never used to establish access or consent.
    document.cookie = `lr_setup=${businessId}.${step}; Path=/; SameSite=Lax; Max-Age=604800${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [businessId, step]);
  function go(next: Step) {
    router.push(`/onboarding/${businessId}?step=${next}`);
  }
  function finish(path = `/businesses/${businessId}`) {
    document.cookie = "lr_setup=; Path=/; SameSite=Lax; Max-Age=0";
    router.push(path);
    router.refresh();
  }
  async function connect(provider: "gmail" | "microsoft") {
    if (busy.current) return;
    busy.current = true;
    setPending(provider);
    setError("");
    setRecovery("");
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/mailboxes/connect`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-lead-relay-onboarding": "1",
          },
          body: JSON.stringify({ provider }),
        },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ code: z.string() }).safeParse(raw);
        setRecovery(
          failure.success && failure.data.code === "MFA_REQUIRED"
            ? "/security"
            : response.status === 401
              ? "/sign-in"
              : "",
        );
        throw new Error(
          "The connection couldn't start. Try again or skip for now.",
        );
      }
      const result = z
        .object({ data: z.object({ authorizationUrl: z.url() }) })
        .parse(raw);
      const url = new URL(result.data.authorizationUrl);
      if (
        url.origin !==
          (provider === "gmail"
            ? "https://accounts.google.com"
            : "https://login.microsoftonline.com") ||
        url.pathname !==
          (provider === "gmail"
            ? "/o/oauth2/v2/auth"
            : "/common/oauth2/v2.0/authorize")
      )
        throw new Error("Unable to open your provider. Please try again.");
      window.location.assign(url.toString());
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Check your connection and try again.",
      );
    } finally {
      busy.current = false;
      setPending("");
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-9 py-6 sm:py-10">
      <ol
        aria-label="Setup progress"
        className="mx-auto grid w-full max-w-2xl grid-cols-4 gap-2"
      >
        {steps.map((item, index) => (
          <li
            key={item.key}
            aria-current={index === current ? "step" : undefined}
            className={`flex flex-col gap-2 border-t-2 pt-3 text-xs sm:text-sm ${index === current ? "border-primary font-medium text-primary" : "border-border text-muted-foreground"}`}
          >
            <span className="flex items-center gap-1.5">
              {index === 0 ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <span>{index + 1}.</span>
              )}
              {item.label}
            </span>
          </li>
        ))}
      </ol>
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <section className="flex flex-col gap-5 text-center lg:text-left">
          <SetupIllustration stage={step} />
          <div className="flex flex-col gap-3">
            <p className="text-sm text-primary">
              Step {current + 1} of 4 · Optional
            </p>
            <h1 className="font-display text-3xl leading-tight font-medium tracking-tight sm:text-4xl">
              {step === "email"
                ? "Bring your email along."
                : step === "calendar"
                  ? "Make room for the next meeting."
                  : "Find buyers for what you sell."}
            </h1>
            <p className="text-sm leading-7 text-muted-foreground">
              {step === "email"
                ? "Choose Gmail or Outlook, then approve access on your provider's page. Lead Relay can read and send your sales conversations."
                : step === "calendar"
                  ? "Connect your work calendar to check free times and add appointments you approve. Choose where meetings should go after connecting."
                  : "Your product and customer details are already here. Review your search area and choose how much to use for your first search."}
            </p>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            {step === "email"
              ? "Connecting won't send an email or import your old messages."
              : step === "calendar"
                ? "Calendar access is separate from email. You can disconnect later."
                : "Review each match and its sources before deciding who to contact."}
          </p>
        </section>
        <div className="flex flex-col gap-5">
          {connectionFailed && (
            <Alert variant="destructive">
              <AlertDescription>
                Access wasn&apos;t completed. Try again or skip this step.
              </AlertDescription>
            </Alert>
          )}
          {step === "email" && (
            <Card>
              <CardContent className="flex flex-col gap-4 pt-6">
                {state.emails.map((account) => (
                  <div
                    key={`${account.provider}-${account.account}`}
                    className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 p-4"
                  >
                    <ProviderMark provider={account.provider} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {account.account}
                      </p>
                      <p className="text-xs text-success">Connected</p>
                    </div>
                    <Check className="size-4 text-success" aria-hidden="true" />
                  </div>
                ))}
                {(["gmail", "microsoft"] as const).map((provider) => (
                  <Button
                    key={provider}
                    variant="outline"
                    className="min-h-16 justify-start gap-4 px-5"
                    disabled={
                      Boolean(pending) || !state.availableProviders[provider]
                    }
                    onClick={() => void connect(provider)}
                  >
                    {pending === provider ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ProviderMark provider={provider} />
                    )}
                    <span className="flex flex-1 flex-col items-start gap-1">
                      <span>
                        Connect {provider === "gmail" ? "Gmail" : "Outlook"}
                      </span>
                      {!state.availableProviders[provider] && (
                        <span className="text-xs font-normal text-muted-foreground">
                          Not available yet
                        </span>
                      )}
                    </span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ))}
                {!state.availableProviders.gmail &&
                  !state.availableProviders.microsoft && (
                    <p className="text-sm text-muted-foreground">
                      Email connections aren&apos;t available yet. Continue and
                      connect later from Settings → Email.
                    </p>
                  )}
              </CardContent>
            </Card>
          )}
          {step === "calendar" && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <CalendarConnection
                provider="google"
                businessId={businessId}
                initialState={state.google}
                onboarding
              />
              <CalendarConnection
                provider="microsoft"
                businessId={businessId}
                initialState={state.microsoft}
                onboarding
              />
            </div>
          )}
          {step === "search" && (
            <Card>
              <CardContent className="pt-6">
                <form
                  className="flex flex-col gap-5"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (busy.current) return;
                    const scope = JSON.stringify([offering, market, budget]);
                    if (key.current?.scope !== scope)
                      key.current = { scope, value: crypto.randomUUID() };
                    const input = startDiscoverySchema.safeParse({
                      markets: [market],
                      publicOffering: offering,
                      budget: Number(budget),
                      confirmPublicQuery: confirmed,
                      requestKey: key.current.value,
                    });
                    if (!input.success || !ready) {
                      setError("Review the search details and usage limit.");
                      return;
                    }
                    busy.current = true;
                    setPending("search");
                    setError("");
                    try {
                      const response = await fetch(
                        `/api/businesses/${businessId}/discovery`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(input.data),
                        },
                      );
                      const raw: unknown = await response.json();
                      if (!response.ok) {
                        const failure = z
                          .object({ code: z.string() })
                          .safeParse(raw);
                        setRecovery(
                          failure.success &&
                            failure.data.code === "MFA_REQUIRED"
                            ? "/security"
                            : response.status === 401
                              ? "/sign-in"
                              : "",
                        );
                        throw new Error(
                          "The search couldn't start. Review Find prospects in the app before retrying.",
                        );
                      }
                      z.object({
                        success: z.literal(true),
                        data: z.object({
                          id: z.uuid(),
                          status: z.enum([
                            "queued",
                            "running",
                            "completed",
                            "stopped",
                          ]),
                        }),
                      }).parse(raw);
                      finish(`/businesses/${businessId}/discovery`);
                    } catch (failure: unknown) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "Check your connection and try again.",
                      );
                    } finally {
                      busy.current = false;
                      setPending("");
                    }
                  }}
                >
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="setup-product">
                        Your product or service
                      </FieldLabel>
                      {search.policy?.exa ? (
                        <NativeSelect
                          id="setup-product"
                          value={offering}
                          disabled={!ready || Boolean(pending)}
                          onChange={(event) => setOffering(event.target.value)}
                        >
                          {search.policy.exa.publicOfferings.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Textarea
                          id="setup-product"
                          value={offering}
                          onChange={(event) => setOffering(event.target.value)}
                          maxLength={400}
                          required
                          disabled={!ready || Boolean(pending)}
                          rows={3}
                        />
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="setup-market">
                        Search area
                      </FieldLabel>
                      {search.availableMarkets.length ? (
                        <NativeSelect
                          id="setup-market"
                          value={market}
                          onChange={(event) => setMarket(event.target.value)}
                          disabled={!ready || Boolean(pending)}
                        >
                          {search.availableMarkets.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </NativeSelect>
                      ) : (
                        <Input
                          id="setup-market"
                          value={state.profile.homeMarket}
                          readOnly
                        />
                      )}
                    </Field>
                    <div className="rounded-xl bg-muted/60 p-4 text-sm leading-6">
                      <p className="font-medium">Your customers</p>
                      <p className="text-muted-foreground">
                        {state.profile.configuration?.buyerCategories
                          .map((buyer) => buyer.label)
                          .join(", ") || "From your business profile"}
                      </p>
                    </div>
                    {ready && search.policy ? (
                      <>
                        <Field>
                          <FieldLabel htmlFor="setup-budget">
                            Usage limit for this search
                          </FieldLabel>
                          <Input
                            id="setup-budget"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={search.policy.maxRunBudget}
                            step={1}
                            value={budget}
                            onChange={(event) => setBudget(event.target.value)}
                            disabled={Boolean(pending)}
                            required
                            aria-describedby="setup-budget-hint"
                          />
                          <p
                            id="setup-budget-hint"
                            className="text-xs leading-6 text-muted-foreground"
                          >
                            Up to {search.policy.maxRunBudget}{" "}
                            {search.policy.allowanceUnit}. The search stops at
                            your limit. Search calls use{" "}
                            {search.policy.searchUnits}; reviews use{" "}
                            {search.policy.reviewUnits}{" "}
                            {search.policy.allowanceUnit}.
                            {search.policy.exa
                              ? ` Reading each shortlisted source uses ${search.policy.exa.contentsUnits} ${search.policy.allowanceUnit}.`
                              : ""}
                          </p>
                        </Field>
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id="setup-public-query"
                            checked={confirmed}
                            onCheckedChange={(value) =>
                              setConfirmed(value === true)
                            }
                            disabled={Boolean(pending)}
                          />
                          <FieldLabel
                            htmlFor="setup-public-query"
                            className="text-sm leading-6 font-normal"
                          >
                            Use this product description in public web searches.
                            I approve the usage limit above.
                          </FieldLabel>
                        </div>
                        <Button
                          type="submit"
                          disabled={Boolean(pending) || !confirmed}
                        >
                          {pending ? (
                            <Loader2
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : null}
                          {pending
                            ? "Starting search…"
                            : "Start my first search"}
                          <ArrowRight
                            data-icon="inline-end"
                            aria-hidden="true"
                          />
                        </Button>
                      </>
                    ) : (
                      <p className="rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
                        Your product, customers, and home area are saved. Search
                        needs service setup before it can run. You can finish
                        now and return to Find prospects later.
                      </p>
                    )}
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                {recovery && (
                  <>
                    {" "}
                    <Link
                      className="underline"
                      href={recovery}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Verify your account in a new tab, then return here
                    </Link>
                    .
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            {step !== "email" ? (
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={() => go(step === "calendar" ? "email" : "calendar")}
              >
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={() =>
                  step === "search"
                    ? finish()
                    : go(step === "email" ? "calendar" : "search")
                }
              >
                Skip for now
              </Button>
              {step !== "search" && (
                <Button
                  disabled={Boolean(pending)}
                  onClick={() => go(step === "email" ? "calendar" : "search")}
                >
                  Continue
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Button>
              )}
              {step === "search" && !ready && (
                <Button onClick={() => finish()}>
                  Finish setup
                  <Check data-icon="inline-end" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
