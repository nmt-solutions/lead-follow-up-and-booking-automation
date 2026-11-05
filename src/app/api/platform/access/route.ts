import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
export const GET = (request: Request) =>
  handleRequest(async () =>
    (await getServices()).teamHttp.platformAccess(request),
  );
