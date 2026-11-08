import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string; command: string }> },
) {
  const { businessId, command } = await params;
  return handleRequest(async () =>
    (await getServices()).pilotsHttp.command(request, businessId, command),
  );
}
