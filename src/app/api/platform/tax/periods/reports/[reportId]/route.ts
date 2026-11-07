import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return handleRequest(async () =>
    (await getServices()).taxPeriodsHttp.report(r, (await params).reportId),
  );
}
