import { headers } from "next/headers";
import Link from "next/link";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { DiscoveryCapacityManager } from "@/components/discovery-capacity-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discovery capacity" };
export default async function DiscoveryCapacityPage() {
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).discoveryCapacity.configuration(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-3">
        <Link
          className="inline-flex min-h-11 items-center text-primary underline"
          href="/businesses"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Discovery capacity</h1>
        <p className="text-muted-foreground">
          Approve finite provider capacity and allocate purchased reservations.
          Deployment and current paid contracts are required before execution.
        </p>
      </header>
      <DiscoveryCapacityManager initial={initial} />
    </div>
  );
}
