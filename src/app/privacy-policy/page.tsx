import type { Metadata } from "next";
import { PolicyDocument } from "@/components/policy-document";
import { privacySections } from "@/content/privacy";
export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "How Lead Relay handles business, account, connected service, and sales data.",
  robots: { index: true, follow: true },
};
export default function PrivacyPolicyPage() {
  return (
    <PolicyDocument
      title="Privacy policy"
      summary="What we collect, how we use it, and the choices you have."
      sections={privacySections}
    />
  );
}
