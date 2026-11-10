import type { Metadata } from "next";
import { PolicyDocument } from "@/components/policy-document";
import { termsSections } from "@/content/terms";
export const metadata: Metadata = {
  title: "Terms and conditions",
  alternates: { canonical: "/terms" },
  description:
    "Terms for using Lead Relay, including accounts, AI features, approvals, and subscriptions.",
  robots: { index: true, follow: true },
};
export default function TermsPage() {
  return (
    <PolicyDocument
      title="Terms and conditions"
      summary="The terms for using Lead Relay on behalf of your business."
      sections={termsSections}
    />
  );
}
