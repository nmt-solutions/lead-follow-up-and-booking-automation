import { headers } from "next/headers";
import { z } from "zod";
import { SetupConnections } from "@/components/setup-connections";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ApplicationError } from "@/models/application-error";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finish setup" };
export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ step?: string; connection?: string }>;
}) {
  const { businessId } = await params;
  const query = await searchParams;
  const step =
    query.step === "calendar" || query.step === "search" ? query.step : "email";
  const state = await (async () => {
    try {
      if (!z.uuid().safeParse(businessId).success)
        throw new ApplicationError("INVALID_INPUT");
      const services = await getServices();
      const credentials = await headers();
      const profile = await services.application.getProfile(
        credentials,
        businessId,
      );
      const workspace = await services.mailboxes.workspace(
        credentials,
        businessId,
      );
      if (!workspace.canManage) throw new ApplicationError("FORBIDDEN");
      const [google, microsoft, discovery, ...emailConnections] =
        await Promise.all([
          services.googleCalendar.read(credentials, businessId),
          services.microsoftCalendar.read(credentials, businessId),
          services.discovery.workspace(credentials, businessId),
          ...workspace.mailboxes.map(async (mailbox) => ({
            id: mailbox.id,
            ...(await (
              mailbox.provider === "gmail"
                ? services.gmail
                : services.microsoftMail
            ).read(credentials, businessId, mailbox.id)),
          })),
        ]);
      return {
        profile,
        google,
        microsoft,
        discovery,
        emails: workspace.mailboxes
          .filter((mailbox) =>
            emailConnections.some(
              (connection) =>
                connection.id === mailbox.id &&
                connection.status === "connected",
            ),
          )
          .map((mailbox) => ({
            account: mailbox.account,
            provider: mailbox.provider,
          })),
        availableProviders: services.emailSetupAvailable,
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <SetupConnections
      key={`${businessId}-${step}`}
      businessId={businessId}
      step={step}
      state={state}
      connectionFailed={query.connection === "failed"}
    />
  );
}
