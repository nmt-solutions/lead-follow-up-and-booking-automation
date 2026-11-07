import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(r: Request) {
  return handleRequest(async () => (await getServices()).taxPeriodsHttp.get(r));
}
export async function POST(r: Request) {
  return handleRequest(async () =>
    (await getServices()).taxPeriodsHttp.command(r),
  );
}
