import Link from "next/link";
import { headers } from "next/headers";
import { TeamManager } from "@/components/team-manager";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage team" };
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
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          Back to overview
        </Link>
        <p className="mb-3 text-sm font-medium text-primary">
          {data.profile.name}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Team access
        </h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Invite people and control what they can do in this Business.
        </p>
      </div>
      <TeamManager
        businessId={businessId}
        team={data.team}
        audit={data.audit}
      />
      <Link
        href={`/businesses/${businessId}/notifications`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Review native invitation acceptance and delivery
      </Link>
    </div>
  );
}
