import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappHttp.command(
      request,
      (await context.params).businessId,
    ),
  );
