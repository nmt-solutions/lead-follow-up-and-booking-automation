import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp/intake">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappIntakeHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp/intake">,
) =>
  handleRequest(async () =>
    (await getServices()).whatsappIntakeHttp.command(
      request,
      (await context.params).businessId,
    ),
  );
