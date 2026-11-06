import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-sequences">,
) =>
  handleRequest(async () =>
    (await getServices()).emailSequencesHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/email-sequences">,
) =>
  handleRequest(async () =>
    (await getServices()).emailSequencesHttp.post(
      request,
      (await context.params).businessId,
    ),
  );
