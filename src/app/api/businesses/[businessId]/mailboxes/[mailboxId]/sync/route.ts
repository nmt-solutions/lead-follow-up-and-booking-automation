import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes/[mailboxId]/sync">,
) =>
  handleRequest(async () => {
    const { businessId, mailboxId } = await context.params;
    return (await getServices()).mailboxesHttp.queue(
      request,
      businessId,
      mailboxId,
    );
  });
