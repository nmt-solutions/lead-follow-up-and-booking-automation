import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  r: Request,
  c: RouteContext<"/api/businesses/[businessId]/notifications">,
) {
  return handleRequest(async () =>
    (await getServices()).notificationsHttp.get(r, (await c.params).businessId),
  );
}
export async function POST(
  r: Request,
  c: RouteContext<"/api/businesses/[businessId]/notifications">,
) {
  return handleRequest(async () =>
    (await getServices()).notificationsHttp.command(
      r,
      (await c.params).businessId,
    ),
  );
}
