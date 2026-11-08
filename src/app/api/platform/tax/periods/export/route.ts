import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(r: Request) {
  return handleRequest(async () =>
    (await getServices()).taxPeriodsHttp.exportReport(r),
  );
}
