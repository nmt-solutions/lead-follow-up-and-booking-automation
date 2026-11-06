import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingHttp.get(request, params.businessId);
  });
export const PUT = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingHttp.save(request, params.businessId);
  });
