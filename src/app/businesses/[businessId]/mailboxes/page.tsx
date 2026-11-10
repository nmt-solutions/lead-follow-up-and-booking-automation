import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { MailboxManager } from "@/components/mailbox-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Connect email" };
export default async function MailboxesPage({
  params,
  searchParams,
}: PageProps<"/businesses/[businessId]/mailboxes">) {
  const { businessId } = await params;
  const query = await searchParams;
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
      return {
        workspace,
        gmailConnections,
        microsoftConnections,
        availableProviders: services.emailSetupAvailable,
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      {query.welcome === "1" && (
        <Alert>
          <AlertDescription>
            Your business is saved. Connect an email below, or{" "}
            <Link href={`/businesses/${businessId}`} className="underline">
              continue and do this later
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
      {query.connection === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>
            The connection wasn&apos;t completed. If this email is already
            listed, use its Reconnect action. Otherwise, choose a provider to
            try again.
          </AlertDescription>
        </Alert>
      )}
      <PageHeader
        title="Email"
        description="Bring your sales conversations into Lead Relay."
      />
      <MailboxManager
        businessId={businessId}
        initialState={state.workspace}
        gmailConnections={state.gmailConnections}
        microsoftConnections={state.microsoftConnections}
        availableProviders={state.availableProviders}
      />
    </div>
  );
}
