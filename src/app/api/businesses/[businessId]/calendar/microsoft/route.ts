import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export async function GET(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) {
  return handleRequest(async () => {
    const { businessId } = await context.params;
    return (await getServices()).microsoftCalendarHttp.read(
      request,
      businessId,
    );
  });
}
