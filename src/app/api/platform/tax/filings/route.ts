import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(r: Request) {
  return handleRequest(async () => (await getServices()).taxFilingsHttp.get(r));
}
export async function POST(r: Request) {
  return handleRequest(async () =>
    (await getServices()).taxFilingsHttp.command(r),
  );
}
