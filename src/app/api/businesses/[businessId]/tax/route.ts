import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";

type Context = { params: Promise<{ businessId: string }> };
export async function GET(request: Request, { params }: Context) {
  return handleRequest(async () =>
    (await getServices()).taxHttp.get(request, (await params).businessId),
  );
}
export async function POST(request: Request, { params }: Context) {
  return handleRequest(async () =>
    (await getServices()).taxHttp.calculate(request, (await params).businessId),
  );
}
