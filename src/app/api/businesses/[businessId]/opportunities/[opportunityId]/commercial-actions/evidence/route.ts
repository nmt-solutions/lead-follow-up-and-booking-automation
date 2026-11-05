import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context =
  RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/commercial-actions/evidence">;
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).commercialActionsHttp.evidence(
      request,
      businessId,
      opportunityId,
    );
  });
