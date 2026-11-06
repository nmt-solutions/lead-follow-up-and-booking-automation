import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string; fileId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingReviewFilesHttp.download(
      request,
      params.businessId,
      params.fileId,
    );
  });
