import { PolicyDocument } from "@/components/policy-document";
import { refundSections } from "@/content/purchase-policies";
import { publicMetadata } from "@/lib/public-site";
export const metadata = publicMetadata(
  "Refund policy",
  "Lead Relay refund eligibility, request details and processing of approved refunds.",
  "/refund-policy",
);
export default function Page() {
  return (
    <PolicyDocument
      title="Refund policy"
      summary="How we review a payment problem and process an approved refund."
      sections={refundSections}
    />
  );
}
