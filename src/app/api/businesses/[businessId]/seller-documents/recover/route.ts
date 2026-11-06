import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/businesses/[businessId]/seller-documents/recover">,
) {
  const { businessId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.recover(request, businessId),
  );
}
