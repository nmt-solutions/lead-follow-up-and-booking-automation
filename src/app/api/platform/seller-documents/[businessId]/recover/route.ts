import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/platform/seller-documents/[businessId]/recover">,
) {
  const { businessId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.recover(
      request,
      businessId,
      true,
    ),
  );
}
