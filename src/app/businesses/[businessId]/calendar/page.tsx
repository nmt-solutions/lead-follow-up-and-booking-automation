import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { GoogleCalendarManager } from "@/components/google-calendar-manager";

import { MicrosoftCalendarManager } from "@/components/microsoft-calendar-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booking calendar" };
export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/businesses/[businessId]/calendar">) {
  const { businessId } = await params;
  const query = await searchParams;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        calendar: await services.googleCalendar.read(credentials, businessId),
        microsoft: await services.microsoftCalendar.read(
          credentials,
          businessId,
        ),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      {query.connection === "failed" && (
        <Alert variant="destructive">
          <AlertDescription>
            The calendar connection wasn&apos;t completed. Choose your provider
            below to try again.
          </AlertDescription>
        </Alert>
      )}
      <PageHeader
        title="Connect your calendar"
        description="Choose Google or Microsoft, approve access, and select your work calendar. Lead Relay checks availability and saves approved appointments there."
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <GoogleCalendarManager
          businessId={businessId}
          initialState={state.calendar}
        />
        <MicrosoftCalendarManager
          businessId={businessId}
          initialState={state.microsoft}
        />
      </div>
      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
        Calendar access is separate from email. Connecting a calendar does not
        send invitations. You can disconnect whenever you need to.
      </p>
    </div>
  );
}
