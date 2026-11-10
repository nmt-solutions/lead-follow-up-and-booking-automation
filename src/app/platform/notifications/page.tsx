import { PageHeader } from "@/components/page-header";

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
    <div className="app-page">
      <PageHeader
        title={<>Transactional notification delivery</>}
        description={
          <>
            Verify the platform sender, select sending terms and review
            authentication, invitations and authorized platform notices.
          </>
        }
      ></PageHeader>
      <NotificationManager
        initial={data.workspace}
        initialPreferences={data.preferences}
      />
    </div>
  );
}
