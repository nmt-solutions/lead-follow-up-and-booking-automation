import { getServices } from "@/server/services";

export async function GET(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/reports">,
) {
  return (await getServices()).reportingHttp.get(
    request,
    (await context.params).businessId,
  );
}
