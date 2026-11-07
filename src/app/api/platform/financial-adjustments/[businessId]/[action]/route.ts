import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string; action: string }> },
) {
  const { businessId, action } = await params;
  return handleRequest(async () =>
    (await getServices()).financialAdjustmentsHttp.command(
      request,
      businessId,
      action,
    ),
  );
}
