import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/senders/[identityId]/check">,
) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).sendersHttp.check(
      request,
      params.businessId,
      params.identityId,
    );
  });
