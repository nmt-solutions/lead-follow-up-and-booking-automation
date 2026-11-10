import { BusinessPageHeader } from "@/components/business-page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { TeamManager } from "@/components/team-manager";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team members" };
export default async function TeamPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      const team = await services.team.getTeam(credentials, businessId);
      const profile = await services.application.getProfile(
        credentials,
        businessId,
      );
      const audit = await services.team.getAudit(credentials, businessId);
      return { team, profile, audit };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="team"></BusinessPageHeader>
      <TeamManager
        businessId={businessId}
        team={data.team}
        audit={data.audit}
      />
      <Link
        href={`/businesses/${businessId}/notifications`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Check invitation delivery
      </Link>
    </div>
  );
}
