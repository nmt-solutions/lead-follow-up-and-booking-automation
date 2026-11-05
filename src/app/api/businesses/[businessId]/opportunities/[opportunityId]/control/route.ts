import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/control">,
) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).opportunitiesHttp.read(
      request,
      businessId,
      opportunityId,
    );
  });
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/control">,
) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).opportunitiesHttp.change(
      request,
      businessId,
      opportunityId,
    );
  });
