import { getServices } from "@/server/services";
export async function POST(
  request: Request,
  context: RouteContext<"/api/platform/operations/[businessId]/acknowledge">,
) {
  return (await getServices()).operationsHttp.acknowledge(
    request,
    (await context.params).businessId,
    true,
  );
}
