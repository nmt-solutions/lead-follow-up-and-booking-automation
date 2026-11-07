import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { NotificationManager } from "@/components/notification-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Transactional notification delivery" };
export default async function Notifications() {
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        workspace: await services.notifications.workspace(credentials),
        preferences: await services.notifications.preferences(
          credentials,
          null,
        ),
      };
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-4">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Transactional notification delivery</h1>
        <p>
          Verify the platform sender, select sending terms and review
          authentication, invitations and authorized platform notices.
        </p>
      </header>
      <NotificationManager
        initial={data.workspace}
        initialPreferences={data.preferences}
      />
    </div>
  );
}
