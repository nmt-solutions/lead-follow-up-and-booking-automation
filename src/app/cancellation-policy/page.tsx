import { PolicyDocument } from "@/components/policy-document";
import { cancellationSections } from "@/content/purchase-policies";
import { publicMetadata } from "@/lib/public-site";
export const metadata = publicMetadata(
  "Cancellation policy",
  "How to stop Lead Relay renewals, confirm cancellation and keep access through the paid period.",
  "/cancellation-policy",
);
export default function Page() {
  return (
    <PolicyDocument
      title="Cancellation policy"
      summary="Stop future renewals from your business billing page."
      sections={cancellationSections}
    />
  );
}
