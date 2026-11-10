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
}: PageProps<"/businesses/[businessId]/calendar">) {
  const { businessId } = await params;
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
      <PageHeader
        title={<>Booking calendar</>}
        description={
          <>
            Connect a customer-owned calendar, review its permission and choose
            where appointments are booked.
          </>
        }
      ></PageHeader>
      <GoogleCalendarManager
        businessId={businessId}
        initialState={state.calendar}
      />
      <MicrosoftCalendarManager
        businessId={businessId}
        initialState={state.microsoft}
      />
    </div>
  );
}
