import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const POST = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).discoveryHttp.cancel(
      request,
      (await context.params).businessId,
    ),
  );
