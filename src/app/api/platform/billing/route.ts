import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (request: Request) =>
  handleRequest(async () => {
    return (await getServices()).billingHttp.queue(request);
  });
