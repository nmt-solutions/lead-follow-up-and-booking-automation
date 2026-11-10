import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { MailboxManager } from "@/components/mailbox-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email inboxes" };
export default async function MailboxesPage({
  params,
}: PageProps<"/businesses/[businessId]/mailboxes">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const workspace = await services.mailboxes.workspace(
        credentials,
        businessId,
      );
      const gmailConnections = workspace.canManage
        ? Object.fromEntries(
            await Promise.all(
              workspace.mailboxes
                .filter((m) => m.provider === "gmail")
                .map(async (m) => [
                  m.id,
                  await services.gmail.read(credentials, businessId, m.id),
                ]),
            ),
          )
        : {};
      const microsoftConnections = workspace.canManage
        ? Object.fromEntries(
            await Promise.all(
              workspace.mailboxes
                .filter((m) => m.provider === "microsoft")
                .map(async (m) => [
                  m.id,
                  await services.microsoftMail.read(
                    credentials,
                    businessId,
                    m.id,
                  ),
                ]),
            ),
          )
        : {};
      return { workspace, gmailConnections, microsoftConnections };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader title={<>Email inboxes</>}></PageHeader>
      <MailboxManager
        businessId={businessId}
        initialState={state.workspace}
        gmailConnections={state.gmailConnections}
        microsoftConnections={state.microsoftConnections}
      />
    </div>
  );
}
