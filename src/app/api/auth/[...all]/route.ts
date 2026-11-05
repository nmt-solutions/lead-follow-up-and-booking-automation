import { randomUUID } from "node:crypto";
import { getServices, reportFailure } from "@/server/services";
import { handleRequest } from "@/server/request";

export const runtime = "nodejs";
const handle = (request: Request) =>
  handleRequest(async () => {
    const response = await (await getServices()).auth.handler(request);
    if (response.status < 400) return response;
    const requestId = randomUUID();
    const code =
      response.status === 429 ? "RATE_LIMITED" : "AUTH_REQUEST_FAILED";
    reportFailure({ requestId, code });
    return Response.json(
      {
        code,
        message:
          response.status === 429
            ? "Please wait a minute before trying again."
            : "Unable to sign in. Please try again.",
        requestId,
      },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  });
export const GET = handle;
export const POST = handle;
