import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.access(
      request,
      (await context.params).businessId,
    ),
  );
