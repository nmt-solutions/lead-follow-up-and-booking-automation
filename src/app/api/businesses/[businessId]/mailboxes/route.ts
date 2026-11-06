import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes">,
) =>
  handleRequest(async () =>
    (await getServices()).mailboxesHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes">,
) =>
  handleRequest(async () =>
    (await getServices()).mailboxesHttp.save(
      request,
      (await context.params).businessId,
    ),
  );
