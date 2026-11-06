import { getServices } from "@/server/services";
export async function GET(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp/sending">,
) {
  return (await getServices()).whatsappSendingHttp.get(
    request,
    (await context.params).businessId,
  );
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/whatsapp/sending">,
) {
  return (await getServices()).whatsappSendingHttp.command(
    request,
    (await context.params).businessId,
  );
}
