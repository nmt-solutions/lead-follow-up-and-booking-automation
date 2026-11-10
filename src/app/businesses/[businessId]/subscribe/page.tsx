import { SubscriptionSetup } from "@/components/subscription-setup";
import { subscriptionSetupData } from "@/server/subscription-setup";
import { pageFailure } from "@/server/page";
export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a plan" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const data = await (async () => {
    try {
      return await subscriptionSetupData(
        (await params).businessId,
        (await searchParams).plan,
      );
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <SubscriptionSetup key={data.selected ?? "plans"} {...data} />
    </div>
  );
}
