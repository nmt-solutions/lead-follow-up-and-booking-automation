import type { Metadata } from "next";
import { PolicyDocument } from "@/components/policy-document";
import { termsSections } from "@/content/terms";
export const metadata: Metadata = {
  title: "Terms and conditions",
  description:
    "Terms for using LeadRelay, including accounts, AI features, approvals, and subscriptions.",
  robots: { index: true, follow: true },
};
export default function TermsPage() {
  return (
    <PolicyDocument
      title="Terms and conditions"
      summary="The terms for using LeadRelay on behalf of your business."
      sections={termsSections}
    />
  );
}
