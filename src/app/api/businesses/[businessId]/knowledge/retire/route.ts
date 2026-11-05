import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const POST = (
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) =>
  handleRequest(async () =>
    (await getServices()).knowledgeHttp.retire(
      request,
      (await context.params).businessId,
    ),
  );
