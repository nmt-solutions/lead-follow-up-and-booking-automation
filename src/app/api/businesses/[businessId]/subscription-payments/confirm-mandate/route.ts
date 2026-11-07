import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export async function POST(
  request: Request,
  context: RouteContext<"/api/businesses/[businessId]/subscription-payments/confirm-mandate">,
) {
  const { businessId } = await context.params;
  return handleRequest(async () =>
    (await getServices()).subscriptionPaymentsHttp.confirmMandate(
      request,
      businessId,
    ),
  );
}
