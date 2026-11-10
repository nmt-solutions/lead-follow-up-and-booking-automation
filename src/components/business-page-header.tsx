import type { ReactNode } from "react";
import {
  businessSections,
  type BusinessSection,
} from "@/content/business-sections";
import { PageHeader } from "./page-header";

export function BusinessPageHeader({
  section,
  children,
}: {
  section: BusinessSection;
  children?: ReactNode;
}) {
  const entry = businessSections[section];
  const Icon = entry.icon;
  return (
    <div className="flex items-start gap-4">
      <div className="hidden size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-card text-primary sm:flex">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <PageHeader
        title={entry.title}
        description={entry.description}
        className="flex-1"
      >
        {children}
      </PageHeader>
    </div>
  );
}
