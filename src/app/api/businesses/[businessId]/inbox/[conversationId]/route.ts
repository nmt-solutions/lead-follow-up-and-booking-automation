import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox/[conversationId]">,
) =>
  handleRequest(async () => {
    const { businessId, conversationId } = await context.params;
    return (await getServices()).inboxHttp.conversation(
      request,
      businessId,
      conversationId,
    );
  });
export const PATCH = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/inbox/[conversationId]">,
) =>
  handleRequest(async () => {
    const { businessId, conversationId } = await context.params;
    return (await getServices()).inboxHttp.associate(
      request,
      businessId,
      conversationId,
    );
  });
