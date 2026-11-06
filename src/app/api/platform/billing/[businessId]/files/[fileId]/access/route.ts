import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string; fileId: string }> };
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingReviewFilesHttp.access(
      request,
      params.businessId,
      params.fileId,
    );
  });
