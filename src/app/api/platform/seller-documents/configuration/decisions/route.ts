import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(request: Request) {
  return handleRequest(async () =>
    (await getServices()).sellerDocumentsHttp.decideIssuer(request),
  );
}
