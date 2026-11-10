"use client";
import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { countries, countryCode } from "@/lib/countries";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";

export function CountryPicker({
  id,
  value,
  onChange,
  format = "name",
  disabled,
  allowEmpty = false,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  format?: "name" | "code";
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = countries.find(
    (country) => country.code === countryCode(value),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          variant="outline"
          className="w-full justify-between text-left"
        >
          <span className="truncate">
            {selected?.name || value || "Choose country"}
          </span>
          <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput
            aria-label="Search countries"
            placeholder="Search countries..."
          />
          <CommandList>
            <CommandEmpty>No matching country.</CommandEmpty>
            <CommandGroup>
              {allowEmpty && (
                <CommandItem
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  Not provided
                </CommandItem>
              )}
              {countries.map((country) => (
                <CommandItem
                  key={country.code}
                  value={`${country.name} ${country.code}`}
                  onSelect={() => {
                    onChange(format === "code" ? country.code : country.name);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1">{country.name}</span>
                  {selected?.code === country.code && (
                    <Check aria-hidden="true" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
