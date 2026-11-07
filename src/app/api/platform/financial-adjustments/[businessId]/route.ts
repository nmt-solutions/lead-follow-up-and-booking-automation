import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  return handleRequest(async () =>
    (await getServices()).financialAdjustmentsHttp.workspace(
      request,
      businessId,
      true,
    ),
  );
}
