"use client";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Mail,
  MapPin,
  Search,
  Users,
  FileCheck2,
} from "lucide-react";

export type SetupStage =
  "business" | "customers" | "location" | "email" | "calendar" | "search";
const icons = {
  business: Building2,
  customers: Users,
  location: MapPin,
  email: Mail,
  calendar: CalendarDays,
  search: Search,
};

/** A small explanation of the current task, with no looping background motion. */
export function SetupIllustration({ stage }: { stage: SetupStage }) {
  const reduced = useReducedMotion();
  const Icon = icons[stage];
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto flex h-40 w-full max-w-xs items-center justify-center overflow-hidden rounded-3xl bg-primary/5 sm:h-48"
    >
      <div className="absolute size-40 rounded-full border border-primary/10" />
      <div className="absolute size-60 rounded-full border border-primary/5" />
      <motion.div
        key={stage}
        initial={reduced ? false : { opacity: 0, y: 10, rotate: -3 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ type: "spring", bounce: 0, duration: reduced ? 0 : 0.45 }}
        className="relative flex items-center gap-4"
      >
        <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/15 bg-card shadow-sm">
          <Icon className="size-8 text-primary" strokeWidth={1.5} />
        </div>
        <ArrowRight className="size-5 text-primary/45" />
        <div className="flex min-h-24 w-32 flex-col justify-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
          {stage === "calendar" ? (
            <>
              <div className="h-2 w-12 rounded bg-primary/20" />
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    className={`flex size-4 items-center justify-center rounded-sm ${i === 6 ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {i === 6 && <Check className="size-3" />}
                  </span>
                ))}
              </div>
            </>
          ) : stage === "email" ? (
            <>
              <div className="flex items-center gap-2">
                <Mail className="size-4 text-primary" />
                <span className="text-xs font-medium">Your inbox</span>
              </div>
              <div className="h-1.5 w-full rounded bg-primary/15" />
              <div className="h-1.5 w-2/3 rounded bg-muted" />
            </>
          ) : stage === "search" || stage === "customers" ? (
            <>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  initial={reduced ? false : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: reduced ? 0 : i * 0.1,
                    duration: reduced ? 0 : 0.25,
                  }}
                  className="flex items-center gap-2"
                >
                  <FileCheck2 className="size-4 text-primary/65" />
                  <span className="h-1.5 flex-1 rounded bg-primary/15" />
                </motion.div>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-primary" />
                <span className="h-2 w-12 rounded bg-primary/20" />
              </div>
              <span className="h-1.5 w-full rounded bg-muted" />
              <span className="h-1.5 w-3/4 rounded bg-muted" />
              <Check className="size-4 self-end text-success" />
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
