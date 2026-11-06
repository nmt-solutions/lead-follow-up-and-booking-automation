import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/senders">,
) =>
  handleRequest(async () =>
    (await getServices()).sendersHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
