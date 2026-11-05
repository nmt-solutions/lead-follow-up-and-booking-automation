import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.get(
      request,
      (await context.params).businessId,
    ),
  );
export const PATCH = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.changeRole(
      request,
      (await context.params).businessId,
    ),
  );
export const DELETE = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.remove(
      request,
      (await context.params).businessId,
    ),
  );
