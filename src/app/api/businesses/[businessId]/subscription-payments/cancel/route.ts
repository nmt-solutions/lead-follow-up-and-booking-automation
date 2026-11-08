import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  return handleRequest(async () =>
    (await getServices()).subscriptionPaymentsHttp.cancel(request, businessId),
  );
}
