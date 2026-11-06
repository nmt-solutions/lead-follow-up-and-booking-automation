import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleRequest(async () =>
    (await getServices()).senderHealthHttp.alerts(request),
  );
}
