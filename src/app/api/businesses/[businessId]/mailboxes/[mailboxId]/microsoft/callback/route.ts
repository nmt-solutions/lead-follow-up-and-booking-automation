import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes/[mailboxId]/microsoft/callback">,
) =>
  handleRequest(async () => {
    const { businessId, mailboxId } = await context.params;
    return (await getServices()).microsoftMailHttp.callback(
      request,
      businessId,
      mailboxId,
    );
  });
