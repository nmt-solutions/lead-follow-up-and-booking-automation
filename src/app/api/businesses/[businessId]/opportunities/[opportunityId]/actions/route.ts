import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/actions">,
) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).opportunitiesHttp.queue(
      request,
      businessId,
      opportunityId,
    );
  });
