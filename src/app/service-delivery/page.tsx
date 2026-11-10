import { PolicyDocument } from "@/components/policy-document";
import { deliverySections } from "@/content/purchase-policies";
import { publicMetadata } from "@/lib/public-site";
export const metadata = publicMetadata(
  "Service delivery",
  "How Lead Relay digital access is activated after verified payment and how to get help.",
  "/service-delivery",
);
export default function Page() {
  return (
    <PolicyDocument
      title="Service delivery"
      summary="An online service, with clear payment and setup status."
      sections={deliverySections}
    />
  );
}
