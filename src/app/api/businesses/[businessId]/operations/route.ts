import { getServices } from "@/server/services";
export async function GET(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/operations">,
) {
  return (await getServices()).operationsHttp.get(
    request,
    (await context.params).businessId,
  );
}
export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/operations">,
) {
  return (await getServices()).operationsHttp.command(
    request,
    (await context.params).businessId,
  );
}
