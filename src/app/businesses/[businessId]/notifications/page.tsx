import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BusinessNotifications } from "@/components/notification-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Notification delivery" };
export default async function Notifications({
  params,
}: PageProps<"/businesses/[businessId]/notifications">) {
  const { businessId } = await params;
  const initial = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        ...(await services.notifications.businessWorkspace(
          credentials,
          businessId,
        )),
        preferences: await services.notifications.preferences(
          credentials,
          businessId,
        ),
      };
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-4">
        <Link
          href={`/businesses/${businessId}`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back to overview
        </Link>
        <h1 className="page-title">Notification delivery</h1>
        <p>
          Review this Business’s invitation attempts and selected platform
          notices. Customer prospecting uses its separately authorized sales
          channel.
        </p>
      </header>
      <BusinessNotifications businessId={businessId} initial={initial} />
    </div>
  );
}
