import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox/connections/[connectionId]/manual-replies">,
) =>
  handleRequest(async () => {
    const { businessId, connectionId } = await context.params;
    return (await getServices()).opportunitiesHttp.manualReply(
      request,
      businessId,
      connectionId,
    );
  });
