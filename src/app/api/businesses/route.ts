import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
export const GET = (request: Request) =>
  handleRequest(async () => (await getServices()).http.list(request));
export const POST = (request: Request) =>
  handleRequest(async () => (await getServices()).http.create(request));
