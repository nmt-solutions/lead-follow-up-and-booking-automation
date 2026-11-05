import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context =
  RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/appointments">;
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).appointmentsHttp.read(
      request,
      businessId,
      opportunityId,
    );
  });
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).appointmentsHttp.request(
      request,
      businessId,
      opportunityId,
    );
  });
