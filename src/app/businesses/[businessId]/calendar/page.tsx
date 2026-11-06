import Link from "next/link";
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business
        </Link>
        <p className="mb-3 text-sm font-medium text-primary">
          {state.profile.name}
        </p>
        <h1 className="page-title">Booking calendar</h1>
        <p className="mt-3 text-muted-foreground">
          Connect a customer-owned calendar, review its permission and choose
          where appointments are booked.
        </p>
      </header>
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
