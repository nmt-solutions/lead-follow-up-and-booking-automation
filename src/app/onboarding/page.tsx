import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get started" };
export default async function OnboardingPage() {
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      await services.access.authenticatePrivileged(credentials);
      return {
        identity: await services.access.primary(credentials),
        businesses: await services.application.listBusinesses(credentials),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  const resume = (await cookies())
    .get("lr_setup")
    ?.value.match(/^([a-f0-9-]{36})\.(email|calendar|plan|search)$/);
  if (resume && state.businesses.some((b) => b.id === resume[1]))
    redirect(`/onboarding/${resume[1]}?step=${resume[2]}`);
  if (state.businesses.length) redirect("/businesses");
  return (
    <OnboardingForm
      initialCompanyName={state.identity.user.companyName ?? ""}
    />
  );
}
