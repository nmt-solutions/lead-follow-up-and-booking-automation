import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const maxDuration = 90;
type Context =
  RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/inquiries">;
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).inquiriesHttp.read(
      request,
      businessId,
      opportunityId,
    );
  });
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, opportunityId } = await context.params;
    return (await getServices()).inquiriesHttp.process(
      request,
      businessId,
      opportunityId,
    );
  });
