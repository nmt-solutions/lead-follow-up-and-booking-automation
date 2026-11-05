import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox">,
) =>
  handleRequest(async () =>
    (await getServices()).inboxHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
