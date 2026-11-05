import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context =
  RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/commercial-actions">;
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).commercialActionsHttp.read(
      request,
      businessId,
      opportunityId,
    );
  });
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).commercialActionsHttp.propose(
      request,
      businessId,
      opportunityId,
    );
  });
