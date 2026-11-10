"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** For controlled forms. Inactive fields retain React state and cannot submit early. */
export function FormSteps({
  steps,
  disabled = false,
}: {
  steps: {
    id: string;
    label: string;
    description: string;
    content: ReactNode;
  }[];
  disabled?: boolean;
}) {
  const [step, setStep] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const reducedMotion = useReducedMotion();
  function move(next: number) {
    if (next > step) {
      const fields = container.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(
        "fieldset[data-current-step] input, fieldset[data-current-step] select, fieldset[data-current-step] textarea",
      );
      for (const field of fields ?? []) if (!field.reportValidity()) return;
    }
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  return (
    <div
      ref={container}
      className="flex min-w-0 flex-col gap-6"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          step < steps.length - 1 &&
          event.target instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "submit"].includes(event.target.type)
        ) {
          event.preventDefault();
          move(step + 1);
        }
      }}
    >
      <ol
        aria-label="Setup steps"
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3"
      >
        {steps.map((item, index) => (
          <li
            key={item.id}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
              index === step
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span className="font-medium tabular-nums">{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Step {step + 1} of {steps.length}
        </p>
        <h3
          ref={heading}
          tabIndex={-1}
          className="text-xl font-medium outline-none"
        >
          {steps[step]?.label}
        </h3>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {steps[step]?.description}
        </p>
      </div>
      {steps.map((item, index) => (
        <fieldset
          key={item.id}
          data-current-step={index === step ? "" : undefined}
          disabled={disabled || index !== step}
          hidden={index !== step}
          className={cn(
            "min-w-0 border-0 p-0",
            index === step ? "flex flex-col gap-6" : "hidden",
          )}
        >
          <legend className="sr-only">{item.label}</legend>
          <motion.div
            initial={false}
            animate={{
              opacity: index === step ? 1 : 0,
              y: reducedMotion ? 0 : index === step ? 0 : 4,
            }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
            className="flex min-w-0 flex-col gap-6"
          >
            {item.content}
          </motion.div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || step === 0}
          onClick={() => move(step - 1)}
        >
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Back
        </Button>
        {step < steps.length - 1 && (
          <Button
            type="button"
            disabled={disabled}
            onClick={() => move(step + 1)}
          >
            Continue
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}
