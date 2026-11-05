import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const POST = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.invite(
      request,
      (await context.params).businessId,
    ),
  );
export const DELETE = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.revoke(
      request,
      (await context.params).businessId,
    ),
  );
export const PATCH = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.deliver(
      request,
      (await context.params).businessId,
    ),
  );
