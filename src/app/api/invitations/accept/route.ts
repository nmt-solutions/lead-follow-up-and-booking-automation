import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
export const POST = (request: Request) =>
  handleRequest(async () => (await getServices()).teamHttp.accept(request));
