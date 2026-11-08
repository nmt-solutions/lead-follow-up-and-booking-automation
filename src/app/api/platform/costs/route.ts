import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(request: Request) {
  return handleRequest(async () =>
    (await getServices()).costsHttp.workspace(request),
  );
}
export async function POST(request: Request) {
  return handleRequest(async () =>
    (await getServices()).costsHttp.command(request),
  );
}
