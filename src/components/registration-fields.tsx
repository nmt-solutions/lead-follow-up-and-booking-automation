"use client";
import { useState } from "react";
import { Building2, UserRound } from "lucide-react";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export function RegistrationFields({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [accountType, setAccountType] = useState("company");
  return (
    <FieldGroup className="gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="first-name">First name</FieldLabel>
          <Input
            id="first-name"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={80}
            disabled={disabled}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="last-name">Last name</FieldLabel>
          <Input
            id="last-name"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={80}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel id="account-type-label">Account type</FieldLabel>
        <input type="hidden" name="accountType" value={accountType} />
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full"
          value={accountType}
          onValueChange={(value) => {
            if (value) setAccountType(value);
          }}
          disabled={disabled}
          aria-labelledby="account-type-label"
        >
          <ToggleGroupItem value="company" className="min-h-11 flex-1">
            <Building2 aria-hidden="true" />
            Company
          </ToggleGroupItem>
          <ToggleGroupItem value="personal" className="min-h-11 flex-1">
            <UserRound aria-hidden="true" />
            Personal
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {accountType === "company" && (
        <Field>
          <FieldLabel htmlFor="company-name">Company name</FieldLabel>
          <Input
            id="company-name"
            name="companyName"
            autoComplete="organization"
            required
            maxLength={120}
            disabled={disabled}
          />
        </Field>
      )}
    </FieldGroup>
  );
}
