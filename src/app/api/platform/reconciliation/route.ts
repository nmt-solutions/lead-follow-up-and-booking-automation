import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(request: Request) {
  return handleRequest(async () =>
    (await getServices()).reconciliationHttp.workspace(request),
  );
}
