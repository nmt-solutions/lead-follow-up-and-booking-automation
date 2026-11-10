import { connectionCallback } from "@/server/connection-callback";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export const GET = (request: Request) =>
  handleRequest(() => connectionCallback(request, "gmail"));
