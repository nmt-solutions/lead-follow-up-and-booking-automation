import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { AppointmentManager } from "@/components/appointment-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appointments" };
export default async function AppointmentsPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]/appointments">) {
  const { businessId, opportunityId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        appointments: await services.appointments.read(
          credentials,
          businessId,
          opportunityId,
        ),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Appointments</>}
        description={<>Opportunity {opportunityId}</>}
      ></PageHeader>
      <AppointmentManager
        businessId={businessId}
        opportunityId={opportunityId}
        initialState={state.appointments}
      />
    </div>
  );
}
