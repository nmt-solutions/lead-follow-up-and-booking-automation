import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-eligibility">,
) =>
  handleRequest(async () =>
    (await getServices()).emailEligibilityHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-eligibility">,
) =>
  handleRequest(async () =>
    (await getServices()).emailEligibilityHttp.post(
      request,
      (await context.params).businessId,
    ),
  );
