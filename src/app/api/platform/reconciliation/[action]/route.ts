import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  context: RouteContext<"/api/platform/reconciliation/[action]">,
) {
  const { action } = await context.params;
  return handleRequest(async () =>
    (await getServices()).reconciliationHttp.command(request, action),
  );
}
