import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string; fileId: string }> };
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, fileId } = await context.params;
    return (await getServices()).filesHttp.remove(request, businessId, fileId);
  });
