import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).subscriptionQuotesHttp.workspace(
      request,
      (await context.params).businessId,
    ),
  );
export const POST = (request: Request, context: Context) =>
  handleRequest(async () =>
    (await getServices()).subscriptionQuotesHttp.create(
      request,
      (await context.params).businessId,
    ),
  );
