import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes/connect">,
) =>
  handleRequest(async () => {
    const { businessId } = await context.params;
    return (await getServices()).emailSetupHttp.start(request, businessId);
  });
