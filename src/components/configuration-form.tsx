"use client";
import { Field, FieldGroup } from "./ui/field";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import {
  buyerSuggestions,
  configurationInputSchema,
  savedConfigurationSchema,
  type BuyerCategory,
  type ConfigurationInput,
  type SavedConfiguration,
} from "@/models/configuration";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Alert, AlertDescription } from "./ui/alert";
import { SetupStepper } from "./setup-stepper";
import { LocationFields, emptyAddress } from "./location-fields";

type Draft = Omit<
  ConfigurationInput,
  "homeMarketConfirmed" | "buyersReviewed"
> & { homeMarketConfirmed: boolean; buyersReviewed: boolean };
const responseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    offering: z.string(),
    homeMarket: z.string(),
    configuration: savedConfigurationSchema,
  }),
});
const steps = ["Products and services", "Customers", "Location"];
const optionalFields = [
  {
    name: "specifications",
    label: "Product or service details",
    hint: "Sizes, materials, standards, or the work you include.",
    limit: 4000,
  },
  {
    name: "minimumOrder",
    label: "Minimum order",
    hint: "Include quantities and units, if you have a minimum.",
    limit: 500,
  },
  {
    name: "deliveryConstraints",
    label: "Delivery requirements",
    hint: "Where you deliver, delivery times, or shipping requirements.",
    limit: 2000,
  },
  {
    name: "serviceConstraints",
    label: "Service requirements",
    hint: "Availability or requirements for on-site work.",
    limit: 2000,
  },
] as const;
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function ConfigurationForm({
  businessId,
  offering,
  homeMarket,
  configuration,
  readOnly = false,
}: {
  businessId: string;
  offering: string;
  homeMarket: string;
  configuration: SavedConfiguration | null;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>({
    offering,
    homeMarket,
    specifications: configuration?.specifications ?? "",
    minimumOrder: configuration?.minimumOrder ?? "",
    deliveryConstraints: configuration?.deliveryConstraints ?? "",
    serviceConstraints: configuration?.serviceConstraints ?? "",
    address: configuration?.address ?? emptyAddress,
    additionalMarkets: configuration?.additionalMarkets ?? [],
    buyerCategories: configuration?.buyerCategories ?? [],
    exclusions: configuration?.exclusions ?? [],
    homeMarketConfirmed: Boolean(configuration?.homeMarketConfirmedAt),
    buyersReviewed: Boolean(configuration?.buyersReviewedAt),
  });
  const [step, setStep] = useState(0);
  const [additionalMarkets, setAdditionalMarkets] = useState(
    draft.additionalMarkets.join("\n"),
  );
  const [exclusions, setExclusions] = useState(draft.exclusions.join("\n"));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  function change(values: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...values }));
    setStatus("");
    setError("");
    setErrors({});
  }
  function go(next: number) {
    setStep(next);
    setErrors({});
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function changeBuyer(index: number, values: Partial<BuyerCategory>) {
    change({
      buyerCategories: draft.buyerCategories.map((buyer, position) =>
        position === index ? { ...buyer, ...values } : buyer,
      ),
      buyersReviewed: false,
    });
  }
  function fieldError(name: string) {
    return (
      <p id={`${name}-error`} className="text-sm text-destructive empty:hidden">
        {errors[name]}
      </p>
    );
  }
  function validateStep() {
    const result = configurationInputSchema.safeParse({
      ...draft,
      additionalMarkets: lines(additionalMarkets),
      exclusions: lines(exclusions),
    });
    if (result.success || readOnly) return true;
    const applicable =
      step === 0
        ? ["offering", ...optionalFields.map((field) => field.name)]
        : step === 1
          ? ["buyerCategories", "buyersReviewed", "exclusions"]
          : [
              "address",
              "homeMarket",
              "homeMarketConfirmed",
              "additionalMarkets",
            ];
    const issues = result.error.issues.filter((issue) =>
      applicable.includes(String(issue.path[0])),
    );
    const next: Record<string, string> = {};
    for (const issue of issues)
      next[String(issue.path[0])] ??=
        issue.path[0] === "buyersReviewed"
          ? "Confirm these customer types before continuing."
          : issue.path[0] === "homeMarketConfirmed"
            ? "Confirm your search area before saving."
            : issue.message;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first)
      requestAnimationFrame(() =>
        document
          .getElementById(
            first === "buyerCategories"
              ? "buyer-0"
              : first === "address"
                ? "address-street"
                : first,
          )
          ?.focus(),
      );
    return !issues.length;
  }
  return (
    <div className="flex flex-col gap-8">
      <SetupStepper
        steps={steps}
        current={step}
        onChange={go}
        disabled={pending}
      />
      {readOnly && (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          You can view this setup. Ask an owner or admin to make changes.
        </p>
      )}
      <form
        noValidate
        aria-busy={pending}
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          if (!validateStep()) return;
          if (step < 2) {
            go(step + 1);
            return;
          }
          if (readOnly) return;
          const parsed = configurationInputSchema.safeParse({
            ...draft,
            additionalMarkets: lines(additionalMarkets),
            exclusions: lines(exclusions),
          });
          if (!parsed.success) {
            const first = String(parsed.error.issues[0].path[0]);
            go(
              first === "offering" ||
                optionalFields.some((field) => field.name === first)
                ? 0
                : first === "buyerCategories" ||
                    first === "buyersReviewed" ||
                    first === "exclusions"
                  ? 1
                  : 2,
            );
            setError("Check the highlighted setup details before saving.");
            return;
          }
          submitting.current = true;
          setPending(true);
          setError("");
          setStatus("");
          try {
            const response = await fetch(
              `/api/businesses/${businessId}/configuration`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parsed.data),
              },
            );
            if (!response.ok) {
              setError(
                response.status === 401
                  ? "Sign in again in another tab, then return to save. Your changes are still here."
                  : response.status === 403
                    ? "Verify your authenticator in Account security, then return to save."
                    : "Your setup could not be saved. Try again.",
              );
              return;
            }
            const result = responseSchema.safeParse(await response.json());
            if (!result.success) {
              setError(
                "We couldn't confirm the save. Reload to check your saved setup.",
              );
              return;
            }
            setStatus(
              "Business setup saved. Your next search will use these details.",
            );
            router.refresh();
          } catch {
            setError(
              "Check your connection and try again. Your changes are still here.",
            );
          } finally {
            submitting.current = false;
            setPending(false);
          }
        }}
      >
        <FieldGroup className="gap-5">
          <fieldset disabled={readOnly || pending} className="min-w-0">
            <legend className="sr-only">Business setup</legend>
            <motion.section
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
              <h2
                tabIndex={-1}
                ref={heading}
                className="text-2xl font-semibold tracking-tight outline-none"
              >
                {
                  [
                    "What you sell",
                    "Who you want to reach",
                    "Where to find customers",
                  ][step]
                }
              </h2>
              {step === 0 && (
                <>
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor="offering">Products or services</Label>
                    <Textarea
                      id="offering"
                      name="offering"
                      maxLength={4000}
                      value={draft.offering}
                      className="min-h-32"
                      onChange={(event) =>
                        change({
                          offering: event.target.value,
                          buyersReviewed: false,
                        })
                      }
                      aria-invalid={Boolean(errors.offering)}
                      aria-describedby="offering-error"
                    />
                    {fieldError("offering")}
                    <p className="text-sm text-muted-foreground">
                      Already filled from your business profile. Edit it only if
                      something has changed.
                    </p>
                  </Field>
                  <Collapsible
                    className="group/details"
                    defaultOpen={optionalFields.some((field) =>
                      Boolean(draft[field.name]),
                    )}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between"
                      >
                        More product details, optional
                        <ChevronDown
                          aria-hidden="true"
                          className="transition-transform group-data-[state=open]/details:rotate-180"
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex flex-col gap-5 pt-5">
                      {optionalFields.map((field) => (
                        <Field key={field.name} className="flex flex-col gap-2">
                          <Label htmlFor={field.name}>{field.label}</Label>
                          <Textarea
                            id={field.name}
                            name={field.name}
                            maxLength={field.limit}
                            value={draft[field.name]}
                            onChange={(event) =>
                              change({ [field.name]: event.target.value })
                            }
                            aria-describedby={`${field.name}-hint ${field.name}-error`}
                          />
                          <p
                            id={`${field.name}-hint`}
                            className="text-sm text-muted-foreground"
                          >
                            {field.hint}
                          </p>
                          {fieldError(field.name)}
                        </Field>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
              {step === 1 && (
                <>
                  {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                      {buyerSuggestions.map((buyer, index) => (
                        <Button
                          key={buyer.label}
                          type="button"
                          variant="outline"
                          disabled={
                            draft.buyerCategories.length >= 30 ||
                            draft.buyerCategories.some(
                              (item) => item.label === buyer.label,
                            )
                          }
                          onClick={() =>
                            change({
                              buyerCategories: [
                                ...draft.buyerCategories,
                                { ...buyer },
                              ],
                              buyersReviewed: false,
                            })
                          }
                        >
                          <Plus aria-hidden="true" />
                          {
                            [
                              "Businesses",
                              "Independent professionals",
                              "Retailers and distributors",
                            ][index]
                          }
                        </Button>
                      ))}
                    </div>
                  )}
                  {!draft.buyerCategories.length && (
                    <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                      Choose a customer type above or add your own below.
                    </p>
                  )}
                  <div className="flex flex-col gap-4">
                    {draft.buyerCategories.map((buyer, index) => (
                      <fieldset
                        key={index}
                        className="flex flex-col min-w-0 gap-4 rounded-xl border border-border p-4"
                      >
                        <legend className="px-2 text-sm font-medium">
                          Customer type {index + 1}
                        </legend>
                        <Field className="flex flex-col gap-2">
                          <Label htmlFor={`buyer-${index}`}>
                            Customer type name
                          </Label>
                          <Input
                            id={`buyer-${index}`}
                            name={`buyerCategories.${index}.label`}
                            value={buyer.label}
                            maxLength={200}
                            onChange={(event) =>
                              changeBuyer(index, { label: event.target.value })
                            }
                          />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field className="flex flex-col gap-2">
                            <Label htmlFor={`identity-${index}`}>
                              Who are they?
                            </Label>
                            <Select
                              value={buyer.identity}
                              onValueChange={(value) => {
                                if (
                                  value === "organization" ||
                                  value === "sole_proprietor"
                                )
                                  changeBuyer(index, {
                                    identity: value,
                                    use:
                                      buyer.use === "personal_use"
                                        ? "business_end_user"
                                        : buyer.use,
                                  });
                                if (value === "individual")
                                  changeBuyer(index, {
                                    identity: value,
                                    use: "personal_use",
                                    requiresBuyingRequest: true,
                                  });
                              }}
                            >
                              <SelectTrigger
                                id={`identity-${index}`}
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="organization">
                                  Business or organization
                                </SelectItem>
                                <SelectItem value="sole_proprietor">
                                  Independent professional
                                </SelectItem>
                                <SelectItem value="individual">
                                  Individual customer
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field className="flex flex-col gap-2">
                            <Label htmlFor={`use-${index}`}>
                              What are they buying for?
                            </Label>
                            <Select
                              value={buyer.use}
                              onValueChange={(value) => {
                                if (value === "personal_use")
                                  changeBuyer(index, {
                                    use: value,
                                    identity: "individual",
                                    requiresBuyingRequest: true,
                                  });
                                if (
                                  value === "business_end_user" ||
                                  value === "reseller"
                                )
                                  changeBuyer(index, {
                                    use: value,
                                    identity:
                                      buyer.identity === "individual"
                                        ? "organization"
                                        : buyer.identity,
                                  });
                              }}
                            >
                              <SelectTrigger
                                id={`use-${index}`}
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="business_end_user">
                                  Their business
                                </SelectItem>
                                <SelectItem value="reseller">Resale</SelectItem>
                                <SelectItem value="personal_use">
                                  Personal use
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                        </div>
                        <Label className="flex min-h-11 items-start gap-3 py-2">
                          <Checkbox
                            checked={buyer.requiresBuyingRequest}
                            disabled={buyer.use === "personal_use"}
                            onCheckedChange={(value) =>
                              changeBuyer(index, {
                                requiresBuyingRequest: value === true,
                              })
                            }
                          />
                          <span>
                            Only find people who have publicly asked to buy
                          </span>
                        </Label>
                        {buyer.use === "personal_use" && (
                          <p className="text-sm text-muted-foreground">
                            For individual customers, a public buying request is
                            required.
                          </p>
                        )}
                        {!readOnly && (
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() =>
                              change({
                                buyerCategories: draft.buyerCategories.filter(
                                  (_, position) => position !== index,
                                ),
                                buyersReviewed: false,
                              })
                            }
                          >
                            <Trash2 aria-hidden="true" />
                            Remove customer type
                          </Button>
                        )}
                      </fieldset>
                    ))}
                  </div>
                  {fieldError("buyerCategories")}
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={draft.buyerCategories.length >= 30}
                      onClick={() =>
                        change({
                          buyerCategories: [
                            ...draft.buyerCategories,
                            {
                              label: "",
                              identity: "organization",
                              use: "business_end_user",
                              requiresBuyingRequest: false,
                            },
                          ],
                          buyersReviewed: false,
                        })
                      }
                    >
                      <Plus aria-hidden="true" />
                      Add customer type
                    </Button>
                  )}
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor="exclusions">
                      Who should we leave out?{" "}
                      <span className="font-normal text-muted-foreground">
                        optional
                      </span>
                    </Label>
                    <Textarea
                      id="exclusions"
                      value={exclusions}
                      onChange={(event) => {
                        setExclusions(event.target.value);
                        change({ buyersReviewed: false });
                      }}
                      placeholder="One exclusion per line, for example competitors"
                    />
                    {fieldError("exclusions")}
                  </Field>
                  <Label className="flex min-h-11 items-start gap-3 py-2">
                    <Checkbox
                      id="buyersReviewed"
                      checked={draft.buyersReviewed}
                      onCheckedChange={(value) =>
                        change({ buyersReviewed: value === true })
                      }
                    />
                    <span>These are the customers I want to reach.</span>
                  </Label>
                  {fieldError("buyersReviewed")}
                </>
              )}
              {step === 2 && (
                <>
                  <LocationFields
                    address={draft.address}
                    homeMarket={draft.homeMarket}
                    onChange={(address, market) =>
                      change({
                        address,
                        homeMarket: market,
                        homeMarketConfirmed: false,
                      })
                    }
                    error={errors.homeMarket}
                  />
                  {fieldError("address")}
                  <Field className="flex flex-col gap-2">
                    <Label htmlFor="additionalMarkets">
                      Other search areas{" "}
                      <span className="font-normal text-muted-foreground">
                        optional
                      </span>
                    </Label>
                    <Textarea
                      id="additionalMarkets"
                      value={additionalMarkets}
                      onChange={(event) => {
                        setAdditionalMarkets(event.target.value);
                        change({});
                      }}
                      placeholder="One city, region, or country per line"
                    />
                    <p className="text-sm text-muted-foreground">
                      Add up to 30 areas. Paid search coverage is managed
                      separately.
                    </p>
                    {fieldError("additionalMarkets")}
                  </Field>
                  <Label className="flex min-h-11 items-start gap-3 py-2">
                    <Checkbox
                      id="homeMarketConfirmed"
                      checked={draft.homeMarketConfirmed}
                      onCheckedChange={(value) =>
                        change({ homeMarketConfirmed: value === true })
                      }
                    />
                    <span>
                      Use {draft.homeMarket || "this location"} as my default
                      search area.
                    </span>
                  </Label>
                  {fieldError("homeMarketConfirmed")}
                </>
              )}
            </motion.section>
          </fieldset>
          <div className="flex flex-col gap-4 border-t border-border bg-muted/20 px-6 py-5 sm:px-8">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {error}
                  <a
                    href="/security"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block underline"
                  >
                    Open Account security in a new tab
                  </a>
                </AlertDescription>
              </Alert>
            )}
            <p role="status" className="text-sm text-success empty:hidden">
              {status}
            </p>
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                type="button"
                disabled={step === 0 || pending}
                onClick={() => go(step - 1)}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
              {(!readOnly || step < 2) && (
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : step === 2 ? (
                    <>
                      Save business setup
                      <Check aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>
              )}
            </div>
            {!readOnly && (
              <p className="text-xs text-muted-foreground">
                Changes take effect when you save on the last step.
              </p>
            )}
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
