import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/sender-health">,
) {
  const { businessId } = await context.params;
  return handleRequest(async () =>
    (await getServices()).senderHealthHttp.get(request, businessId),
  );
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/sender-health">,
) {
  const { businessId } = await context.params;
  return handleRequest(async () =>
    (await getServices()).senderHealthHttp.command(request, businessId),
  );
}
