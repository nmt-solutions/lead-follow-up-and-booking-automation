"use client";
import { Field } from "./ui/field";

import { useState } from "react";
import { MapPin } from "lucide-react";
import {
  suggestHomeMarket,
  type ConfigurationInput,
} from "@/models/configuration";
import { CountryPicker } from "./country-picker";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";

type Address = ConfigurationInput["address"];
export const emptyAddress: Address = {
  street: "",
  locality: "",
  region: "",
  postalCode: "",
  country: "",
};

export function LocationFields({
  address,
  homeMarket,
  onChange,
  error,
}: {
  address: Address;
  homeMarket: string;
  onChange(address: Address, market: string): void;
  error?: string;
}) {
  const [different, setDifferent] = useState(
    Boolean(homeMarket && homeMarket !== suggestHomeMarket(address)),
  );
  function update(field: keyof Address, value: string) {
    const next = { ...address, [field]: value };
    onChange(next, different ? homeMarket : (suggestHomeMarket(next) ?? ""));
  }
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="grid min-w-0 gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-sm text-muted-foreground">
          Your business address. Street and postal code are optional.
        </legend>
        <Field className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="address-street">
            Street address{" "}
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id="address-street"
            name="address.street"
            autoComplete="street-address"
            maxLength={500}
            value={address.street}
            onChange={(event) => update("street", event.target.value)}
            placeholder="Building and street"
          />
        </Field>
        <Field className="flex flex-col gap-2">
          <Label htmlFor="address-locality">City</Label>
          <Input
            id="address-locality"
            name="address.locality"
            autoComplete="address-level2"
            maxLength={200}
            value={address.locality}
            onChange={(event) => update("locality", event.target.value)}
          />
        </Field>
        <Field className="flex flex-col gap-2">
          <Label htmlFor="address-region">State or region</Label>
          <Input
            id="address-region"
            name="address.region"
            autoComplete="address-level1"
            maxLength={200}
            value={address.region}
            onChange={(event) => update("region", event.target.value)}
          />
        </Field>
        <Field className="flex flex-col gap-2">
          <Label htmlFor="address-country">Country</Label>
          <CountryPicker
            id="address-country"
            value={address.country}
            onChange={(value) => update("country", value)}
          />
        </Field>
        <Field className="flex flex-col gap-2">
          <Label htmlFor="address-postalCode">
            Postal code{" "}
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id="address-postalCode"
            name="address.postalCode"
            autoComplete="postal-code"
            maxLength={40}
            value={address.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
          />
        </Field>
      </fieldset>
      {!different && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-4">
          <MapPin
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-primary"
          />
          <div>
            <p className="text-sm font-medium">Your default search area</p>
            <p className="mt-1 text-sm text-muted-foreground" role="status">
              {homeMarket || "Choose your country to use this location."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              We&apos;ll start looking for customers here.
            </p>
          </div>
        </div>
      )}
      <Label className="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox
          checked={different}
          onCheckedChange={(checked) => {
            const next = checked === true;
            setDifferent(next);
            if (!next) onChange(address, suggestHomeMarket(address) ?? "");
          }}
        />
        I serve a different area or work remotely
      </Label>
      {different && (
        <Field className="flex flex-col gap-2">
          <Label htmlFor="homeMarket">
            Where do you want to find customers?
          </Label>
          <Input
            id="homeMarket"
            name="homeMarket"
            maxLength={200}
            value={homeMarket}
            onChange={(event) => onChange(address, event.target.value)}
            placeholder="For example, India or London, United Kingdom"
            aria-invalid={Boolean(error)}
            aria-describedby="location-error"
          />
          <p className="text-sm text-muted-foreground">
            Enter a city, region, or country. You can add more markets later.
          </p>
        </Field>
      )}
      <p
        id="location-error"
        className="text-sm text-destructive empty:hidden"
        role={error ? "alert" : undefined}
      >
        {error}
      </p>
    </div>
  );
}
