import { headers } from "next/headers";
import { OnboardingForm } from "@/components/onboarding-form";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a business" };
export default async function NewBusinessSetup() {
  const company = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      await services.access.authenticatePrivileged(credentials);
      return (
        (await services.access.primary(credentials)).user.companyName ?? ""
      );
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return <OnboardingForm initialCompanyName={company} />;
}
