import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox/connections">,
) =>
  handleRequest(async () =>
    (await getServices()).inboxHttp.addConnection(
      request,
      (await context.params).businessId,
    ),
  );
