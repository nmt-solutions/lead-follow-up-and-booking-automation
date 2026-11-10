import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { plans, formatPlanPrice, type PlanId } from "@/content/plans";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function PlanCards({
  businessId,
  selected,
  onboarding = false,
}: {
  businessId?: string;
  selected?: PlanId;
  onboarding?: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {plans.map((plan) => (
        <Card key={plan.id} className="flex flex-col">
          <CardHeader>
            <div className="flex min-h-7 items-center justify-between gap-3">
              <CardTitle>{plan.label}</CardTitle>
              {plan.id === selected ? (
                <Badge>Selected</Badge>
              ) : plan.id === "growth" ? (
                <Badge variant="outline">For growing teams</Badge>
              ) : null}
            </div>
            <CardDescription>{plan.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-6">
            <div>
              <p className="font-display text-4xl tracking-tight">
                {formatPlanPrice(plan.monthlyMinor)}
                <span className="ml-1 text-sm text-muted-foreground">
                  / month
                </span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Per business · plus applicable taxes
              </p>
            </div>
            <ul className="flex flex-1 flex-col gap-3 text-sm">
              {[
                `${plan.discovery.toLocaleString("en-IN")} discovery credits each month`,
                `${plan.automation.toLocaleString("en-IN")} outreach actions each month`,
                "Shared allowances for your team",
                "Email and calendar connections",
                "Conversations, approvals and bookings",
                "Cancel from your billing page",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
            <Button
              asChild
              variant={plan.id === "growth" ? "default" : "outline"}
            >
              <Link
                href={
                  businessId
                    ? onboarding
                      ? `/onboarding/${businessId}?step=plan&plan=${plan.id}`
                      : `/businesses/${businessId}/subscribe?plan=${plan.id}`
                    : `/start?plan=${plan.id}`
                }
              >
                Choose {plan.label}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
