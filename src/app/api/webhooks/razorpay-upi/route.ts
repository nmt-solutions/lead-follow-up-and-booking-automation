import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

/** This fixed server path selects the UPI account's own signature key ring. */
export async function POST(request: Request) {
  return handleRequest(async () =>
    (await getServices()).subscriptionPaymentsHttp.event(request, "upi"),
  );
}
