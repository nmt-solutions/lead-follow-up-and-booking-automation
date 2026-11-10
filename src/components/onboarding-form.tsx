"use client";
import { Field, FieldGroup } from "./ui/field";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Users,
  X,
} from "lucide-react";
import { z } from "zod";
import { createBusinessSchema, profileSchema } from "@/models/business";
import {
  buyerSuggestions,
  configurationInputSchema,
  savedConfigurationSchema,
  type BuyerCategory,
} from "@/models/configuration";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { SetupStepper } from "./setup-stepper";
import { emptyAddress, LocationFields } from "./location-fields";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Progress } from "./ui/progress";
import { BookOpen } from "lucide-react";

const steps = ["Your business", "Your customers", "Your location", "Review"];
const responseSchema = z.object({
  success: z.literal(true),
  data: profileSchema.extend({
    id: z.uuid(),
    configuration: savedConfigurationSchema.nullable(),
  }),
});
const customerOptions = [
  {
    buyer: buyerSuggestions[0],
    title: "Businesses",
    description: "Companies buying your products or services",
  },
  {
    buyer: buyerSuggestions[1],
    title: "Independent professionals",
    description: "Sole proprietors buying for their business",
  },
  {
    buyer: buyerSuggestions[2],
    title: "Retailers and distributors",
    description: "Businesses buying to resell",
  },
  {
    buyer: {
      label: "People with public buying requests",
      identity: "individual",
      use: "personal_use",
      requiresBuyingRequest: true,
    } satisfies BuyerCategory,
    title: "Individual customers",
    description: "People who have publicly asked for what you sell",
  },
];

export function OnboardingForm() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    name: "",
    website: "",
    offering: "",
    homeMarket: "",
  });
  const [address, setAddress] = useState(emptyAddress);
  const [buyers, setBuyers] = useState<BuyerCategory[]>([]);
  const [customBuyer, setCustomBuyer] = useState("");
  const [customKind, setCustomKind] = useState("business");
  const [customOpen, setCustomOpen] = useState(false);
  const [buyersReviewed, setBuyersReviewed] = useState(false);
  const [marketConfirmed, setMarketConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const saved = useRef(false);
  function go(next: number) {
    setStep(next);
    setFields({});
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function change(field: keyof typeof profile, value: string) {
    if (field === "offering") setBuyersReviewed(false);
    setProfile((previous) => ({ ...previous, [field]: value }));
    setFields((previous) => ({ ...previous, [field]: "" }));
    setError("");
  }
  function toggleBuyer(buyer: BuyerCategory) {
    setBuyers((previous) =>
      previous.some((item) => item.label === buyer.label)
        ? previous.filter((item) => item.label !== buyer.label)
        : [...previous, buyer],
    );
    setBuyersReviewed(false);
    setFields({});
  }
  function checkStep() {
    const next: Record<string, string> = {};
    if (step === 0) {
      for (const field of ["name", "offering", "website"] as const)
        if (!profileSchema.shape[field].safeParse(profile[field]).success)
          next[field] =
            field === "name"
              ? "Enter your business name."
              : field === "offering"
                ? "Tell us what you sell."
                : "Enter a website starting with https://, or leave it blank.";
    }
    if (step === 1 && !buyers.length)
      next.buyers = "Choose at least one customer type.";
    if (
      step === 2 &&
      !configurationInputSchema.shape.homeMarket.safeParse(profile.homeMarket)
        .success
    )
      next.homeMarket = "Choose a country or enter the area you serve.";
    setFields(next);
    const first = Object.keys(next)[0];
    if (first)
      requestAnimationFrame(() =>
        (
          document.getElementById(
            first === "buyers" ? "customer-options" : first,
          ) ?? document.getElementById("address-country")
        )?.focus(),
      );
    return !first;
  }
  const payload = {
    ...profile,
    configuration: {
      offering: profile.offering,
      homeMarket: profile.homeMarket,
      address,
      buyerCategories: buyers,
      specifications: "",
      minimumOrder: "",
      deliveryConstraints: "",
      serviceConstraints: "",
      additionalMarkets: [],
      exclusions: [],
      homeMarketConfirmed: marketConfirmed,
      buyersReviewed,
    },
  };
  return (
    <div className="app-page max-w-5xl">
      <div>
        <h1 className="page-title">Set up your business</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us what you sell and who you want to reach. You can change this
          later.
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold">Your progress</p>
            <Progress
              value={((step + 1) / steps.length) * 100}
              aria-label={`Step ${step + 1} of ${steps.length}`}
            />
          </div>
          <SetupStepper
            steps={steps}
            current={step}
            onChange={go}
            disabled={pending || uncertain}
            orientation="vertical"
          />
          <div className="hidden flex-col gap-3 border-t border-border pt-5 text-xs leading-6 text-muted-foreground lg:flex">
            <BookOpen className="size-5 text-primary" aria-hidden="true" />
            <p>Need a hand with setup?</p>
            <Link href="/getting-started" className="font-medium text-primary">
              Read the vendor guide
            </Link>
          </div>
        </aside>
        <form
          noValidate
          aria-busy={pending}
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current || uncertain) return;
            if (step < 3) {
              if (checkStep()) go(step + 1);
              return;
            }
            const parsed = createBusinessSchema.safeParse(payload);
            if (!parsed.success) {
              setError(
                !buyersReviewed || !marketConfirmed
                  ? "Confirm your customers and search area before creating your business."
                  : "Check your business details before saving.",
              );
              return;
            }
            submitting.current = true;
            setPending(true);
            setError("");
            try {
              const response = await fetch("/api/businesses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parsed.data),
              });
              if (!response.ok) {
                if (response.status >= 500) {
                  setUncertain(true);
                  setError(
                    "We couldn't confirm the save. Open Your businesses to check before trying again.",
                  );
                  return;
                }
                setError(
                  response.status === 401
                    ? "Your session ended. Sign in again in another tab, then return here. Your details are still here."
                    : response.status === 403
                      ? "Verify your authenticator in Account security, then return here to save."
                      : "We couldn't create your business. Try again.",
                );
                return;
              }
              const result = responseSchema.safeParse(await response.json());
              if (!result.success) {
                setUncertain(true);
                setError(
                  "We couldn't confirm the save. Open Your businesses to check whether it was created.",
                );
                return;
              }
              saved.current = true;
              router.push(`/businesses/${result.data.data.id}?created=1`);
              router.refresh();
            } catch {
              setUncertain(true);
              setError(
                "The connection was interrupted. Open Your businesses to check whether your business was created. Your details are still here.",
              );
            } finally {
              if (!saved.current) {
                submitting.current = false;
                setPending(false);
              }
            }
          }}
        >
          <FieldGroup className="gap-5">
            <fieldset disabled={pending} className="min-w-0">
              <legend className="sr-only">Set up your business</legend>
              <motion.div
                key={step}
                initial={
                  step === 0 ? false : { opacity: 0, x: reducedMotion ? 0 : 10 }
                }
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  type: "spring",
                  bounce: 0,
                  duration: reducedMotion ? 0 : 0.25,
                }}
                className="flex flex-col gap-6 p-6 sm:p-8"
              >
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Step {step + 1} of {steps.length}
                  </p>
                  <h2
                    ref={heading}
                    tabIndex={-1}
                    className="mt-2 text-2xl font-semibold tracking-tight outline-none"
                  >
                    {
                      [
                        "What does your business do?",
                        "Who buys from you?",
                        "Where do you work?",
                        "Check your details",
                      ][step]
                    }
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {
                      [
                        "A short description helps us find relevant prospects.",
                        "Choose the types of customers you want to find. Nothing is selected for you.",
                        "We'll use your location as the starting area for prospect searches.",
                        "Review your customer types and location. Creating a business does not send any messages.",
                      ][step]
                    }
                  </p>
                </div>
                {step === 0 && (
                  <>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor="name">Business name</Label>
                      <Input
                        id="name"
                        name="name"
                        autoComplete="organization"
                        maxLength={120}
                        value={profile.name}
                        onChange={(event) => change("name", event.target.value)}
                        placeholder="For example, NMT Solutions"
                        aria-invalid={Boolean(fields.name)}
                        aria-describedby="name-error"
                      />
                      <p
                        id="name-error"
                        className="text-sm text-destructive empty:hidden"
                      >
                        {fields.name}
                      </p>
                    </Field>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor="website">
                        Website{" "}
                        <span className="font-normal text-muted-foreground">
                          optional
                        </span>
                      </Label>
                      <Input
                        id="website"
                        type="url"
                        name="website"
                        autoComplete="url"
                        maxLength={2048}
                        value={profile.website}
                        onChange={(event) =>
                          change("website", event.target.value)
                        }
                        placeholder="https://yourbusiness.com"
                        aria-invalid={Boolean(fields.website)}
                        aria-describedby="website-error"
                      />
                      <p
                        id="website-error"
                        className="text-sm text-destructive empty:hidden"
                      >
                        {fields.website}
                      </p>
                    </Field>
                    <Field className="flex flex-col gap-2">
                      <Label htmlFor="offering">What do you sell?</Label>
                      <Textarea
                        id="offering"
                        name="offering"
                        maxLength={4000}
                        value={profile.offering}
                        onChange={(event) =>
                          change("offering", event.target.value)
                        }
                        placeholder="For example, we build websites and mobile apps for small businesses."
                        className="min-h-32"
                        aria-invalid={Boolean(fields.offering)}
                        aria-describedby="offering-error"
                      />
                      <p
                        id="offering-error"
                        className="text-sm text-destructive empty:hidden"
                      >
                        {fields.offering}
                      </p>
                    </Field>
                  </>
                )}
                {step === 1 && (
                  <>
                    <ToggleGroup
                      type="multiple"
                      value={buyers
                        .filter((buyer) =>
                          customerOptions.some(
                            (option) => option.buyer.label === buyer.label,
                          ),
                        )
                        .map((buyer) => buyer.label)}
                      onValueChange={(values) => {
                        setBuyers((previous) => [
                          ...previous.filter(
                            (buyer) =>
                              !customerOptions.some(
                                (option) => option.buyer.label === buyer.label,
                              ),
                          ),
                          ...customerOptions
                            .filter((option) =>
                              values.includes(option.buyer.label),
                            )
                            .map((option) => option.buyer),
                        ]);
                        setBuyersReviewed(false);
                        setFields({});
                      }}
                      variant="card"
                      size="card"
                      spacing={2}
                      className="grid w-full gap-3 sm:grid-cols-2"
                      id="customer-options"
                      aria-label="Customer types"
                      aria-describedby="buyers-error"
                    >
                      {customerOptions.map((option) => (
                        <ToggleGroupItem
                          key={option.title}
                          value={option.buyer.label}
                          disabled={
                            !buyers.some(
                              (buyer) => buyer.label === option.buyer.label,
                            ) && buyers.length >= 30
                          }
                        >
                          <Users aria-hidden="true" />
                          <span className="font-semibold">{option.title}</span>
                          <span className="text-sm font-normal leading-6 text-muted-foreground">
                            {option.description}
                          </span>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    {buyers
                      .filter(
                        (buyer) =>
                          !customerOptions.some(
                            (option) => option.buyer.label === buyer.label,
                          ),
                      )
                      .map((buyer) => (
                        <div
                          key={buyer.label}
                          className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3"
                        >
                          <span className="text-sm">{buyer.label}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleBuyer(buyer)}
                            aria-label={`Remove ${buyer.label}`}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setCustomOpen(!customOpen)}
                    >
                      <Plus aria-hidden="true" />
                      Add a specific customer type
                    </Button>
                    {customOpen && (
                      <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
                        <Field className="flex flex-col gap-2">
                          <Label htmlFor="custom-buyer">Customer type</Label>
                          <Input
                            id="custom-buyer"
                            value={customBuyer}
                            onChange={(event) =>
                              setCustomBuyer(event.target.value)
                            }
                            maxLength={200}
                            placeholder="For example, furniture manufacturers"
                          />
                        </Field>
                        <Field className="flex flex-col gap-2">
                          <Label htmlFor="custom-kind">Who are they?</Label>
                          <Select
                            value={customKind}
                            onValueChange={setCustomKind}
                          >
                            <SelectTrigger id="custom-kind" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="business">
                                Businesses
                              </SelectItem>
                              <SelectItem value="sole">
                                Independent professionals
                              </SelectItem>
                              <SelectItem value="reseller">
                                Retailers or resellers
                              </SelectItem>
                              <SelectItem value="consumer">
                                Individual customers
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!customBuyer.trim() || buyers.length >= 30}
                          onClick={() => {
                            if (
                              buyers.some(
                                (buyer) =>
                                  buyer.label.toLowerCase() ===
                                  customBuyer.trim().toLowerCase(),
                              )
                            ) {
                              setFields({
                                buyers:
                                  "That customer type is already selected.",
                              });
                              return;
                            }
                            toggleBuyer({
                              label: customBuyer.trim(),
                              identity:
                                customKind === "consumer"
                                  ? "individual"
                                  : customKind === "sole"
                                    ? "sole_proprietor"
                                    : "organization",
                              use:
                                customKind === "consumer"
                                  ? "personal_use"
                                  : customKind === "reseller"
                                    ? "reseller"
                                    : "business_end_user",
                              requiresBuyingRequest: customKind === "consumer",
                            });
                            setCustomBuyer("");
                            setCustomOpen(false);
                          }}
                        >
                          Add customer type
                        </Button>
                      </div>
                    )}
                    <p
                      id="buyers-error"
                      role={fields.buyers ? "alert" : undefined}
                      className="text-sm text-destructive empty:hidden"
                    >
                      {fields.buyers}
                    </p>
                  </>
                )}
                {step === 2 && (
                  <LocationFields
                    address={address}
                    homeMarket={profile.homeMarket}
                    onChange={(next, market) => {
                      setAddress(next);
                      change("homeMarket", market);
                      setMarketConfirmed(false);
                    }}
                    error={fields.homeMarket}
                  />
                )}
                {step === 3 && (
                  <>
                    {[
                      {
                        icon: Building2,
                        title: profile.name,
                        value: profile.offering,
                        edit: 0,
                      },
                      {
                        icon: Users,
                        title: "Your customers",
                        value: buyers.map((buyer) => buyer.label).join(", "),
                        edit: 1,
                      },
                      {
                        icon: MapPin,
                        title: "Search area",
                        value: profile.homeMarket,
                        edit: 2,
                      },
                    ].map((item) => (
                      <div
                        key={item.edit}
                        className="flex items-start gap-3 rounded-xl border border-border p-4"
                      >
                        <item.icon
                          aria-hidden="true"
                          className="mt-1 size-5 shrink-0 text-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium">{item.title}</h3>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                            {item.value}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => go(item.edit)}
                          aria-label={`Edit ${steps[item.edit]}`}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                    <Label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={buyersReviewed}
                        onCheckedChange={(value) =>
                          setBuyersReviewed(value === true)
                        }
                      />
                      <span>These are the customers I want to reach.</span>
                    </Label>
                    <Label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={marketConfirmed}
                        onCheckedChange={(value) =>
                          setMarketConfirmed(value === true)
                        }
                      />
                      <span>
                        Start prospect searches in {profile.homeMarket}.
                      </span>
                    </Label>
                  </>
                )}
              </motion.div>
              <div className="flex flex-col gap-4 border-t border-border bg-muted/20 px-6 py-5 sm:px-8">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {error}
                      <span className="mt-2 flex flex-wrap gap-4">
                        <a
                          href="/security"
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Open Account security
                        </a>
                        <a
                          href="/sign-in"
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Sign in again
                        </a>
                      </span>
                    </AlertDescription>
                  </Alert>
                )}
                {uncertain && (
                  <Link
                    href="/businesses"
                    className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
                  >
                    Open Your businesses to check the save
                  </Link>
                )}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={step === 0}
                    onClick={() => go(step - 1)}
                  >
                    <ArrowLeft aria-hidden="true" />
                    Back
                  </Button>
                  <Button type="submit" disabled={pending || uncertain}>
                    {pending ? (
                      <>
                        <Loader2 className="animate-spin" aria-hidden="true" />
                        Creating business...
                      </>
                    ) : step === 3 ? (
                      <>
                        Create business
                        <Check aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        Continue
                        <ArrowRight aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
                <p role="status" className="text-xs text-muted-foreground">
                  {pending
                    ? "Saving your business and setup together..."
                    : "Your details are saved when you create your business."}
                </p>
              </div>
            </fieldset>
          </FieldGroup>
        </form>
      </div>
    </div>
  );
}
