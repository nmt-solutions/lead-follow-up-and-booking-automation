import { dataResponse } from "@/models/api";
import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
export const GET = (request: Request) =>
  handleRequest(async () =>
    dataResponse(await (await getServices()).access.status(request.headers)),
  );
