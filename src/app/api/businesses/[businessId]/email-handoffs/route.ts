import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-handoffs">,
) =>
  handleRequest(async () =>
    (await getServices()).emailHandoffsHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-handoffs">,
) =>
  handleRequest(async () =>
    (await getServices()).emailHandoffsHttp.post(
      request,
      (await context.params).businessId,
    ),
  );
