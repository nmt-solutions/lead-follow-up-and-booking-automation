import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string; fileId: string }> };
export const PUT = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, fileId } = await context.params;
    return (await getServices()).filesHttp.upload(request, businessId, fileId);
  });
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, fileId } = await context.params;
    return (await getServices()).filesHttp.download(
      request,
      businessId,
      fileId,
    );
  });
