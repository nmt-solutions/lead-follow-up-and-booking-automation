import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/platform/seller-documents/[businessId]/[documentId]/content">,
) {
  const { businessId, documentId } = await ctx.params;
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.download(
      request,
      businessId,
      documentId,
      true,
    ),
  );
}
