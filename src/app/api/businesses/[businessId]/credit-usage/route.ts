import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
import { creditUsageSchema } from "@/models/credit-usage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  return handleRequest(async () => {
    const usage = await (
      await getServices()
    ).subscriptionPayments.usage(request.headers, businessId);
    return Response.json(
      { success: true, data: creditUsageSchema.parse(usage) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
