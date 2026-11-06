import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/mailboxes/[mailboxId]/gmail">,
) =>
  handleRequest(async () => {
    const { businessId, mailboxId } = await context.params;
    return (await getServices()).gmailHttp.read(request, businessId, mailboxId);
  });
