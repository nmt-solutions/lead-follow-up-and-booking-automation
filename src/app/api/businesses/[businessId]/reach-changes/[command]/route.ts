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
    if (command === "approve") return app.approve(request, businessId);
    if (command === "execute") return app.execute(request, businessId);
    if (command === "refresh") return app.refresh(request, businessId);
    if (command === "withdraw") return app.withdraw(request, businessId);
    if (command === "checkout") return app.checkout(request, businessId);
    throw new ApplicationError("NOT_FOUND");
  });
}
