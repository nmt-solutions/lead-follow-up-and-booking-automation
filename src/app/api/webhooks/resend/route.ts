import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export const runtime = "nodejs";
export async function POST(r: Request) {
  return handleRequest(async () =>
    (await getServices()).notificationsHttp.webhook(r),
  );
}
