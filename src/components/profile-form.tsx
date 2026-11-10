"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Check, LockKeyhole } from "lucide-react";
import { profileSchema, type BusinessProfileInput } from "@/models/business";
import { savedConfigurationSchema } from "@/models/configuration";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";

const responseSchema = z.object({
  success: z.literal(true),
  data: profileSchema.extend({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    configuration: savedConfigurationSchema.nullable(),
  }),
});
const emptyProfile: BusinessProfileInput = {
  name: "",
  offering: "",
  homeMarket: "",
  website: "",
};
const fieldHints = {
  name: "Enter a Business name, up to 120 characters.",
  offering: "Describe your products or services, up to 4,000 characters.",
  homeMarket: "Use up to 200 characters.",
  website:
    "Enter a full http:// or https:// website address, or leave it blank.",
};

export function ProfileForm({
  businessId,
  initialProfile = emptyProfile,
}: {
  businessId?: string;
  initialProfile?: BusinessProfileInput;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [savedProfile, setSavedProfile] = useState(initialProfile);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof BusinessProfileInput, string>>
  >({});
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const dirty = JSON.stringify(profile) !== JSON.stringify(savedProfile);

  function change(field: keyof BusinessProfileInput, value: string) {
    setProfile((previous) => ({ ...previous, [field]: value }));
    setMessage("");
    setError("");
    setSessionExpired(false);
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  function validateField(field: keyof BusinessProfileInput) {
    const valid = profileSchema.shape[field].safeParse(profile[field]).success;
    setFieldErrors((previous) => ({
      ...previous,
      [field]: valid ? undefined : fieldHints[field],
    }));
  }

  return (
    <form
      ref={form}
      className="rounded-2xl border border-border bg-card shadow-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSessionExpired(false);
        setMessage("");
        const parsed = profileSchema.safeParse(profile);
        if (!parsed.success) {
          const errors: Partial<Record<keyof BusinessProfileInput, string>> =
            {};
          for (const field of Object.keys(fieldHints)) {
            if (
              field === "name" ||
              field === "offering" ||
              field === "homeMarket" ||
              field === "website"
            ) {
              if (!profileSchema.shape[field].safeParse(profile[field]).success)
                errors[field] = fieldHints[field];
            }
          }
          setFieldErrors(errors);
          const first = Object.keys(errors)[0];
          form.current
            ?.querySelector<HTMLElement>(`[name="${first}"]`)
            ?.focus();
          return;
        }
        setPending(true);
        try {
          const response = await fetch(
            businessId ? `/api/businesses/${businessId}` : "/api/businesses",
            {
              method: businessId ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(parsed.data),
            },
          );
          if (response.status === 401) {
            setSessionExpired(true);
            setError(
              "Your session has ended. Sign in again in another tab, then save your changes here.",
            );
            return;
          }
          if (response.status === 403) {
            setError(
              "Verify your authenticator in Security, then return here to save. Your changes are still here.",
            );
            return;
          }
          if (!response.ok) {
            setError(
              response.status === 404
                ? "You no longer have access to this Business."
                : "Your changes could not be saved. Please try again.",
            );
            return;
          }
          const json: unknown = await response.json();
          const result = responseSchema.safeParse(json);
          if (!result.success) {
            setError(
              "We could not confirm the save. Reload the page to check your profile.",
            );
            return;
          }
          const saved = profileSchema.parse({
            name: result.data.data.name,
            offering: result.data.data.offering,
            homeMarket: result.data.data.homeMarket,
            website: result.data.data.website,
          });
          setProfile(saved);
          setSavedProfile(saved);
          if (!businessId) {
            router.push(`/businesses/${result.data.data.id}?created=1`);
            router.refresh();
            return;
          }
          setMessage("Changes saved.");
          router.refresh();
        } catch {
          setError(
            "Check your connection, then try saving again. Your changes are still here.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="min-w-0 space-y-7 p-6 sm:p-8">
        <legend className="sr-only">Business profile</legend>
        <div className="space-y-2">
          <Label htmlFor="name">Business name</Label>
          <Input
            id="name"
            name="name"
            autoComplete="organization"
            required
            maxLength={120}
            value={profile.name}
            onChange={(event) => change("name", event.target.value)}
            onBlur={() => validateField("name")}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
          {fieldErrors.name && (
            <p id="name-error" className="text-sm text-destructive">
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="offering">Products or services</Label>
          <Textarea
            id="offering"
            name="offering"
            required
            maxLength={4000}
            value={profile.offering}
            onChange={(event) => change("offering", event.target.value)}
            onBlur={() => validateField("offering")}
            aria-invalid={Boolean(fieldErrors.offering)}
            aria-describedby="offering-hint offering-error"
          />
          <p
            id="offering-hint"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            Describe what your Business offers, in your own words.
          </p>
          <p
            id="offering-error"
            className="text-sm text-destructive empty:hidden"
          >
            {fieldErrors.offering}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="homeMarket">
            Default search area{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="homeMarket"
            name="homeMarket"
            maxLength={200}
            value={profile.homeMarket}
            onChange={(event) => change("homeMarket", event.target.value)}
            onBlur={() => validateField("homeMarket")}
            aria-invalid={Boolean(fieldErrors.homeMarket)}
            aria-describedby="market-hint market-error"
          />
          <p
            id="market-hint"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            The city, region or country where you operate or provide your
            services. If you change it, review and confirm the new area in
            Business setup.
          </p>
          <p
            id="market-error"
            className="text-sm text-destructive empty:hidden"
          >
            {fieldErrors.homeMarket}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="website">
            Website{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="website"
            name="website"
            type="url"
            autoComplete="url"
            maxLength={2048}
            placeholder="https://"
            value={profile.website}
            onChange={(event) => change("website", event.target.value)}
            onBlur={() => validateField("website")}
            aria-invalid={Boolean(fieldErrors.website)}
            aria-describedby={fieldErrors.website ? "website-error" : undefined}
          />
          {fieldErrors.website && (
            <p id="website-error" className="text-sm text-destructive">
              {fieldErrors.website}
            </p>
          )}
        </div>
      </fieldset>
      <div className="space-y-4 border-t border-border px-6 py-5 sm:px-8">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {error && (
          <a
            href="/security"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
          >
            Open Security in a new tab
          </a>
        )}
        {sessionExpired && (
          <a
            href="/sign-in"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
          >
            Sign in in a new tab
          </a>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            {message ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                {message}
              </>
            ) : pending ? (
              "Saving your profile…"
            ) : dirty ? (
              "You have unsaved changes."
            ) : (
              <>
                <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                Private to your Business
              </>
            )}
          </p>
          <Button
            type="submit"
            disabled={pending || Boolean(businessId && !dirty)}
          >
            {pending
              ? "Saving…"
              : businessId
                ? "Save changes"
                : "Create Business"}
          </Button>
        </div>
      </div>
    </form>
  );
}
