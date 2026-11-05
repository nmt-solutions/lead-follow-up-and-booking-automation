import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const DELETE = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox/connections/[connectionId]">,
) =>
  handleRequest(async () => {
    const { businessId, connectionId } = await context.params;
    return (await getServices()).inboxHttp.revokeConnection(
      request,
      businessId,
      connectionId,
    );
  });
