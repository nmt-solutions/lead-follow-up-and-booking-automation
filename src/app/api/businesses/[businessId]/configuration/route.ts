import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).http.get(request, (await context.params).businessId),
  );
export const PUT = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).http.configure(
      request,
      (await context.params).businessId,
    ),
  );
