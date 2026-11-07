import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
export async function GET(
  r: Request,
  ctx: RouteContext<"/api/platform/tax/filings/evidence/[evidenceId]/content">,
) {
  return handleRequest(async () =>
    (await getServices()).taxFilingsHttp.content(
      r,
      (await ctx.params).evidenceId,
    ),
  );
}
