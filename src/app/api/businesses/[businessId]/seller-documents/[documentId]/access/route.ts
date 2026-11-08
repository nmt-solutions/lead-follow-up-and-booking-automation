import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/businesses/[businessId]/seller-documents/[documentId]/access">,
) {
  const { businessId, documentId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.access(
      request,
      businessId,
      documentId,
    ),
  );
}
