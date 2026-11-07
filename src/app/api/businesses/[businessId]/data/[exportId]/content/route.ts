import { getServices } from "@/server/services";
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/data/[exportId]/content">,
) {
  const p = await context.params;
  return (await getServices()).dataGovernanceHttp.download(
    request,
    p.businessId,
    p.exportId,
  );
}
