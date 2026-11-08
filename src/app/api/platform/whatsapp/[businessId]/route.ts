import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/platform/whatsapp/[businessId]">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappHttp.reviewGet(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/platform/whatsapp/[businessId]">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappHttp.reviewCommand(
      request,
      (await context.params).businessId,
    ),
  );
