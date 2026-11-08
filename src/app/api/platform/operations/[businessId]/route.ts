import { getServices } from "@/server/services";
export async function POST(
  request: Request,
  context: RouteContext<"/api/platform/operations/[businessId]">,
) {
  return (await getServices()).operationsHttp.command(
    request,
    (await context.params).businessId,
    true,
  );
}
