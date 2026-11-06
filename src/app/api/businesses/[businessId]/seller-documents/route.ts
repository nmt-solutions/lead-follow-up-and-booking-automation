import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/businesses/[businessId]/seller-documents">,
) {
  const { businessId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.workspace(request, businessId),
  );
}
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/businesses/[businessId]/seller-documents">,
) {
  const { businessId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.issue(request, businessId),
  );
}
