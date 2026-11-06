import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/senders/connections">,
) =>
  handleRequest(async () =>
    (await getServices()).sendersHttp.saveConnection(
      request,
      (await context.params).businessId,
    ),
  );
