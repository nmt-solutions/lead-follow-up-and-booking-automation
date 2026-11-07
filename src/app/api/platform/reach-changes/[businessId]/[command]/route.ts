import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
import { ApplicationError } from "@/models/application-error";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string; command: string }> },
) {
  const { businessId, command } = await params;
  return handleRequest(async () => {
    const app = (await getServices()).reachChangesHttp;
    if (command === "execute") return app.operatorExecute(request, businessId);
    if (command === "refresh") return app.operatorRefresh(request, businessId);
    throw new ApplicationError("NOT_FOUND");
  });
}
