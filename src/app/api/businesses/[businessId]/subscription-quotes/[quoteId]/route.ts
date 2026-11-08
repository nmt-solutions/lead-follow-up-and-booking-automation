import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
type Context = { params: Promise<{ businessId: string; quoteId: string }> };
export const GET = (request: Request, context: Context) =>
  handleRequest(async () => {
    const { businessId, quoteId } = await context.params;
    return (await getServices()).subscriptionQuotesHttp.quote(
      request,
      businessId,
      quoteId,
    );
  });
