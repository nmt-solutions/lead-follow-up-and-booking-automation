import { getServices } from "@/server/services";
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/data/[exportId]/access">,
) {
  const p = await context.params;
  return (await getServices()).dataGovernanceHttp.grant(
    request,
    p.businessId,
    p.exportId,
  );
}
