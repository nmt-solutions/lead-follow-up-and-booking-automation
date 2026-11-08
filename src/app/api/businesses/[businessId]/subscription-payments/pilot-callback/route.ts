import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  return handleRequest(async () =>
    (await getServices()).subscriptionPaymentsHttp.pilotCallback(
      request,
      businessId,
    ),
  );
}
