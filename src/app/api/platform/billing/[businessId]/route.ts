import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingHttp.reviewWorkspace(
      request,
      params.businessId,
    );
  });
export const POST = (request: Request, context: Context) =>
  handleRequest(async () => {
    const params = await context.params;
    return (await getServices()).billingHttp.review(request, params.businessId);
  });
