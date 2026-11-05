"use client";

import { useRef, useState } from "react";
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
import { NativeSelect } from "./ui/native-select";
import { Alert, AlertDescription } from "./ui/alert";

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
const suggestionSchema = z.object({
  success: z.literal(true),
  data: z.object({ homeMarket: z.string().max(200).nullable() }),
});
const supplyFields = [
  {
    name: "offering",
    label: "Products or services",
    limit: 4000,
    hint: "Describe what you sell. This also updates your Business profile.",
  },
  {
    name: "specifications",
    label: "Specifications",
    limit: 4000,
    hint: "Sizes, grades, materials, standards or service scope.",
  },
  {
    name: "minimumOrder",
    label: "Minimum quantities or order",
    limit: 500,
    hint: "Include units, or state that there is no minimum.",
  },
  {
    name: "deliveryConstraints",
    label: "Delivery constraints",
    limit: 2000,
    hint: "Coverage, lead times, access and shipping requirements.",
  },
  {
    name: "serviceConstraints",
    label: "Service requirements",
    limit: 2000,
    hint: "Availability, prerequisites or on-site requirements.",
  },
] as const;
function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

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
  const initial: Draft = {
    offering,
    homeMarket,
    specifications: configuration?.specifications ?? "",
    minimumOrder: configuration?.minimumOrder ?? "",
    deliveryConstraints: configuration?.deliveryConstraints ?? "",
    serviceConstraints: configuration?.serviceConstraints ?? "",
    address: configuration?.address ?? {
      street: "",
      locality: "",
      region: "",
      postalCode: "",
      country: "",
    },
    additionalMarkets: configuration?.additionalMarkets ?? [],
    buyerCategories: configuration?.buyerCategories ?? [],
    exclusions: configuration?.exclusions ?? [],
    homeMarketConfirmed: Boolean(configuration?.homeMarketConfirmedAt),
    buyersReviewed: Boolean(configuration?.buyersReviewedAt),
  };
  const [draft, setDraft] = useState(initial);
  const [hasConfiguration, setHasConfiguration] = useState(
    Boolean(configuration),
  );
  const [additionalMarkets, setAdditionalMarkets] = useState(
    initial.additionalMarkets.join("\n"),
  );
  const [exclusions, setExclusions] = useState(initial.exclusions.join("\n"));
  const [pending, setPending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  function change(values: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...values }));
    setStatus("");
    setError("");
    setErrors({});
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
  async function failure(response: Response) {
    setError(
      response.status === 401
        ? "Your session has ended. Sign in in another tab, then save again. Your changes are still here."
        : response.status === 403
          ? "Saving requires Owner or Admin access and a verified authenticator session. Check Security, then return here."
          : response.status === 404
            ? "You no longer have access to this Business."
            : "The request could not be completed. Check your fields and try again.",
    );
  }
  return (
    <form
      ref={form}
      className="space-y-8"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setStatus("");
        const parsed = configurationInputSchema.safeParse({
          ...draft,
          additionalMarkets: lines(additionalMarkets),
          exclusions: lines(exclusions),
        });
        if (!parsed.success) {
          const nextErrors: Record<string, string> = {};
          for (const issue of parsed.error.issues) {
            const name = issue.path.join(".") || "buyerCategories";
            nextErrors[name] ??=
              name === "homeMarketConfirmed"
                ? "Confirm the Home market before saving."
                : name === "buyersReviewed"
                  ? "Review the buyer categories and exclusions before saving."
                  : issue.message;
          }
          setErrors(nextErrors);
          const first = Object.keys(nextErrors)[0];
          (
            form.current?.querySelector<HTMLElement>(`[name="${first}"]`) ??
            form.current?.querySelector<HTMLElement>(`[id="${first}"]`)
          )?.focus();
          return;
        }
        setPending(true);
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
            await failure(response);
            return;
          }
          const json: unknown = await response.json();
          const result = responseSchema.safeParse(json);
          if (!result.success) {
            setError(
              "We could not confirm the save. Reload to check your saved configuration.",
            );
            return;
          }
          const saved = result.data.data;
          const { homeMarketConfirmedAt, buyersReviewedAt, ...details } =
            saved.configuration;
          setDraft({
            ...parsed.data,
            offering: saved.offering,
            homeMarket: saved.homeMarket,
            ...details,
            homeMarketConfirmed: Boolean(homeMarketConfirmedAt),
            buyersReviewed: Boolean(buyersReviewedAt),
          });
          setHasConfiguration(true);
          setAdditionalMarkets(
            saved.configuration.additionalMarkets.join("\n"),
          );
          setExclusions(saved.configuration.exclusions.join("\n"));
          setErrors({});
          setStatus(
            "Configuration saved. Home market confirmed and buyer categories reviewed.",
          );
        } catch {
          setError(
            "Check your connection, then try again. Your changes are still here.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {readOnly && (
        <p className="text-muted-foreground">
          You can view this configuration. Ask an Owner or Admin to make
          changes.
        </p>
      )}
      {!hasConfiguration && (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-4 text-sm"
        >
          {readOnly
            ? "Targeting is not configured. Ask an Owner or Admin to review and save it."
            : "Targeting is not configured. Review your supply requirements, buyers and Home market, then save."}
        </p>
      )}
      <fieldset
        disabled={readOnly || pending || suggesting}
        className="min-w-0 space-y-8"
      >
        <legend className="sr-only">Offerings, buyers and geography</legend>
        <section
          className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          aria-labelledby="supply-heading"
        >
          <h2 id="supply-heading" className="text-xl font-semibold">
            What you supply
          </h2>
          {supplyFields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={field.name}>
                {field.label}
                {field.name !== "offering" && " (optional)"}
              </Label>
              <Textarea
                id={field.name}
                name={field.name}
                maxLength={field.limit}
                value={draft[field.name]}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={`${field.name}-hint ${field.name}-error`}
                onBlur={() => {
                  const result = configurationInputSchema.shape[
                    field.name
                  ].safeParse(draft[field.name]);
                  setErrors((previous) => ({
                    ...previous,
                    [field.name]: result.success
                      ? ""
                      : result.error.issues[0].message,
                  }));
                }}
                onChange={(event) =>
                  change({
                    [field.name]: event.target.value,
                    ...(field.name === "offering"
                      ? { buyersReviewed: false }
                      : {}),
                  })
                }
              />
              <p
                id={`${field.name}-hint`}
                className="text-sm text-muted-foreground"
              >
                {field.hint}
              </p>
              {fieldError(field.name)}
            </div>
          ))}
        </section>
        <section
          className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          aria-labelledby="buyers-heading"
        >
          <div className="space-y-2">
            <h2 id="buyers-heading" className="text-xl font-semibold">
              Buyers and exclusions
            </h2>
            <p className="text-sm text-muted-foreground">
              Choose starter categories or add your own. Rename them for the
              buyers you serve, and review each identity and buying purpose.
            </p>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {buyerSuggestions.map((buyer) => (
                <Button
                  key={buyer.label}
                  type="button"
                  variant="outline"
                  disabled={draft.buyerCategories.length >= 30}
                  onClick={() =>
                    change({
                      buyerCategories: [...draft.buyerCategories, { ...buyer }],
                      buyersReviewed: false,
                    })
                  }
                >
                  Add: {buyer.label}
                </Button>
              ))}
            </div>
          )}
          {draft.buyerCategories.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No buyer categories selected.
            </p>
          )}
          <div id="buyerCategories" tabIndex={-1} className="space-y-4">
            {draft.buyerCategories.map((buyer, index) => (
              <fieldset
                key={index}
                id={`buyerCategories.${index}`}
                tabIndex={-1}
                aria-describedby={`buyer-${index}-error`}
                className="min-w-0 space-y-4 rounded-xl border border-border p-4"
              >
                <legend className="px-2 text-sm font-medium">
                  Buyer category {index + 1}
                </legend>
                <div className="space-y-2">
                  <Label htmlFor={`buyer-${index}`}>Category name</Label>
                  <Input
                    id={`buyer-${index}`}
                    name={`buyerCategories.${index}.label`}
                    aria-invalid={Boolean(
                      errors[`buyerCategories.${index}.label`],
                    )}
                    aria-describedby={`buyer-${index}-error`}
                    maxLength={200}
                    value={buyer.label}
                    onChange={(event) =>
                      changeBuyer(index, { label: event.target.value })
                    }
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`identity-${index}`}>Buyer identity</Label>
                    <NativeSelect
                      id={`identity-${index}`}
                      name={`buyerCategories.${index}.identity`}
                      aria-describedby={`buyer-${index}-error`}
                      value={buyer.identity}
                      onChange={(event) => {
                        const identity = event.target.value;
                        if (identity === "individual")
                          changeBuyer(index, {
                            identity,
                            use: "personal_use",
                            requiresBuyingRequest: true,
                          });
                        if (
                          identity === "organization" ||
                          identity === "sole_proprietor"
                        )
                          changeBuyer(index, {
                            identity,
                            use:
                              buyer.use === "personal_use"
                                ? "business_end_user"
                                : buyer.use,
                          });
                      }}
                    >
                      <option value="organization">Organization</option>
                      <option value="sole_proprietor">Sole proprietor</option>
                      <option value="individual">Individual consumer</option>
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`use-${index}`}>Buying purpose</Label>
                    <NativeSelect
                      id={`use-${index}`}
                      name={`buyerCategories.${index}.use`}
                      aria-describedby={`buyer-${index}-error`}
                      value={buyer.use}
                      onChange={(event) => {
                        const use = event.target.value;
                        if (use === "personal_use")
                          changeBuyer(index, {
                            use,
                            identity: "individual",
                            requiresBuyingRequest: true,
                          });
                        if (use === "business_end_user" || use === "reseller")
                          changeBuyer(index, {
                            use,
                            identity:
                              buyer.identity === "individual"
                                ? "sole_proprietor"
                                : buyer.identity,
                          });
                      }}
                    >
                      <option value="business_end_user">
                        Business end user
                      </option>
                      <option value="reseller">Reseller</option>
                      <option value="personal_use">Personal use</option>
                    </NativeSelect>
                  </div>
                </div>
                <p
                  id={`buyer-${index}-error`}
                  className="text-sm text-destructive empty:hidden"
                >
                  {Object.entries(errors)
                    .filter(
                      ([path]) =>
                        path === `buyerCategories.${index}` ||
                        path.startsWith(`buyerCategories.${index}.`),
                    )
                    .map(([, message]) => message)
                    .join(" ")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {buyer.use === "personal_use"
                    ? "Only explicit public buying requests. Each future consumer match must retain its request evidence."
                    : "Business purchasing includes sole proprietors and purchases for resale."}
                </p>
                <Label className="flex min-h-11 items-center gap-3">
                  <Input
                    type="checkbox"
                    className="size-5 min-h-5 shrink-0"
                    checked={buyer.requiresBuyingRequest}
                    disabled={buyer.use === "personal_use"}
                    onChange={(event) =>
                      changeBuyer(index, {
                        requiresBuyingRequest: event.target.checked,
                      })
                    }
                  />
                  Require an explicit public buying request
                </Label>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      change({
                        buyerCategories: draft.buyerCategories.filter(
                          (_, position) => position !== index,
                        ),
                        buyersReviewed: false,
                      })
                    }
                  >
                    Remove category {index + 1}
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
              Add custom buyer category
            </Button>
          )}
          <div className="space-y-2">
            <Label htmlFor="exclusions">Exclusions (optional)</Label>
            <Textarea
              id="exclusions"
              name="exclusions"
              value={exclusions}
              onChange={(event) => {
                setExclusions(event.target.value);
                change({ buyersReviewed: false });
              }}
              aria-describedby="exclusions-hint exclusions-error"
            />
            <p id="exclusions-hint" className="text-sm text-muted-foreground">
              One exclusion per line. Up to 50 entries, 300 characters each.
            </p>
            {fieldError("exclusions")}
          </div>
          <Label className="flex min-h-11 items-center gap-3">
            <Input
              name="buyersReviewed"
              type="checkbox"
              className="size-5 min-h-5 shrink-0"
              checked={draft.buyersReviewed}
              onChange={(event) =>
                change({ buyersReviewed: event.target.checked })
              }
              aria-invalid={Boolean(errors.buyersReviewed)}
              aria-describedby="buyersReviewed-error"
            />
            I have reviewed these buyer categories and exclusions.
          </Label>
          {fieldError("buyersReviewed")}
        </section>
        <section
          className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
          aria-labelledby="geography-heading"
        >
          <div className="space-y-2">
            <h2 id="geography-heading" className="text-xl font-semibold">
              Home market and additional markets
            </h2>
            <p className="text-sm text-muted-foreground">
              Your confirmed Home market sets the default discovery priority.
              Additional markets are explicit selections; saving here does not
              purchase discovery reach.
            </p>
          </div>
          <fieldset className="min-w-0 space-y-4">
            <legend className="mb-4 font-medium">
              Business address (optional)
            </legend>
            {(
              [
                ["street", "Street address", "street-address"],
                ["locality", "City or locality", "address-level2"],
                ["region", "State, province or region", "address-level1"],
                ["postalCode", "Postal code", "postal-code"],
                ["country", "Country", "country-name"],
              ] as const
            ).map(([name, label, autoComplete]) => (
              <div key={name} className="space-y-2">
                <Label htmlFor={`address-${name}`}>{label}</Label>
                <Input
                  id={`address-${name}`}
                  autoComplete={autoComplete}
                  maxLength={
                    name === "street" ? 500 : name === "postalCode" ? 40 : 200
                  }
                  value={draft.address[name]}
                  onChange={(event) => {
                    change({
                      address: { ...draft.address, [name]: event.target.value },
                      homeMarketConfirmed: false,
                    });
                    setSuggestion(null);
                    setSuggestionMessage("");
                  }}
                />
              </div>
            ))}
          </fieldset>
          {fieldError("address")}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setSuggesting(true);
                setSuggestion(null);
                setSuggestionMessage("");
                setError("");
                try {
                  const response = await fetch(
                    `/api/businesses/${businessId}/configuration/suggestion`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(draft.address),
                    },
                  );
                  if (!response.ok) {
                    await failure(response);
                    return;
                  }
                  const json: unknown = await response.json();
                  const result = suggestionSchema.safeParse(json);
                  if (!result.success) {
                    setError(
                      "The suggestion could not be read. Enter your Home market directly.",
                    );
                    return;
                  }
                  setSuggestion(result.data.data.homeMarket);
                  setSuggestionMessage(
                    result.data.data.homeMarket
                      ? "Suggestion based on your city, region and country. Review it before using it."
                      : "Enter a country and a concise city or region, or enter your Home market directly.",
                  );
                } catch {
                  setError(
                    "Check your connection, or enter your Home market directly.",
                  );
                } finally {
                  setSuggesting(false);
                }
              }}
            >
              {suggesting ? "Suggesting…" : "Suggest Home market from address"}
            </Button>
          )}
          {suggestionMessage && (
            <div role="status" className="space-y-3 rounded-xl bg-muted p-4">
              <p className="text-sm">{suggestionMessage}</p>
              {suggestion && (
                <>
                  <p className="font-medium wrap-anywhere">{suggestion}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      change({
                        homeMarket: suggestion,
                        homeMarketConfirmed: false,
                      });
                      setSuggestion(null);
                      setSuggestionMessage(
                        "Suggestion applied. Confirm your Home market below before saving.",
                      );
                    }}
                  >
                    Use suggested market
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="homeMarket">Home market</Label>
            <Input
              id="homeMarket"
              name="homeMarket"
              maxLength={200}
              value={draft.homeMarket}
              onChange={(event) =>
                change({
                  homeMarket: event.target.value,
                  homeMarketConfirmed: false,
                })
              }
              aria-invalid={Boolean(errors.homeMarket)}
              aria-describedby="homeMarket-hint homeMarket-error"
            />
            <p id="homeMarket-hint" className="text-sm text-muted-foreground">
              Enter the operating or service geography you want to prioritize,
              in any country.
            </p>
            {fieldError("homeMarket")}
          </div>
          <Label className="flex min-h-11 items-center gap-3">
            <Input
              name="homeMarketConfirmed"
              type="checkbox"
              className="size-5 min-h-5 shrink-0"
              checked={draft.homeMarketConfirmed}
              onChange={(event) =>
                change({ homeMarketConfirmed: event.target.checked })
              }
              aria-invalid={Boolean(errors.homeMarketConfirmed)}
              aria-describedby="homeMarketConfirmed-error"
            />
            I confirm this Home market for my Business.
          </Label>
          {fieldError("homeMarketConfirmed")}
          <div className="space-y-2">
            <Label htmlFor="additionalMarkets">
              Additional markets (optional)
            </Label>
            <Textarea
              id="additionalMarkets"
              name="additionalMarkets"
              value={additionalMarkets}
              onChange={(event) => {
                setAdditionalMarkets(event.target.value);
                change({});
              }}
              aria-invalid={Boolean(errors.additionalMarkets)}
              aria-describedby="additionalMarkets-hint additionalMarkets-error"
            />
            <p
              id="additionalMarkets-hint"
              className="text-sm text-muted-foreground"
            >
              One selected domestic or international market per line. Up to 30;
              omit the Home market and duplicates.
            </p>
            {fieldError("additionalMarkets")}
          </div>
        </section>
        {!readOnly && (
          <div className="space-y-4">
            {error && (
              <>
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
                <div className="flex flex-wrap gap-4">
                  <a
                    href="/security"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-primary underline"
                  >
                    Open Security in a new tab
                  </a>
                  <a
                    href="/sign-in"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-primary underline"
                  >
                    Sign in in a new tab
                  </a>
                </div>
              </>
            )}
            <p role="status" className="text-sm text-muted-foreground">
              {pending
                ? "Saving configuration…"
                : status || "Changes take effect when you save."}
            </p>
            <Button type="submit">
              {pending ? "Saving…" : "Save configuration"}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
