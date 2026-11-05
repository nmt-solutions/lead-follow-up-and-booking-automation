import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/opportunities/[opportunityId]/inquiries/[runId]/dispatch">,
) =>
  handleRequest(async () => {
    const { businessId, opportunityId, runId } = await context.params;
    return (await getServices()).inquiriesHttp.dispatch(
      request,
      businessId,
      opportunityId,
      runId,
    );
  });
