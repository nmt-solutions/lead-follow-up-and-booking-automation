import { getServices } from "@/server/services";
export async function GET(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/data">,
) {
  return (await getServices()).dataGovernanceHttp.get(
    request,
    (await context.params).businessId,
  );
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/data">,
) {
  return (await getServices()).dataGovernanceHttp.command(
    request,
    (await context.params).businessId,
  );
}
