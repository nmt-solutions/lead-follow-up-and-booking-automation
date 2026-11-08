import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: RouteContext<"/api/platform/sender-health/[businessId]">,
) {
  const { businessId } = await context.params;
  return handleRequest(async () =>
    (await getServices()).senderHealthHttp.get(request, businessId, true),
  );
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/platform/sender-health/[businessId]">,
) {
  const { businessId } = await context.params;
  return handleRequest(async () =>
    (await getServices()).senderHealthHttp.command(request, businessId, true),
  );
}
