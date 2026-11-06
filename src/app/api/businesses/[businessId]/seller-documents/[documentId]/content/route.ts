import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/businesses/[businessId]/seller-documents/[documentId]/content">,
) {
  const { businessId, documentId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.download(
      request,
      businessId,
      documentId,
    ),
  );
}
