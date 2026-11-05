import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/opportunity-actions/[actionId]/dispatch">,
) =>
  handleRequest(async () => {
    const { businessId, actionId } = await context.params;
    return (await getServices()).opportunitiesHttp.dispatch(
      request,
      businessId,
      actionId,
    );
  });
