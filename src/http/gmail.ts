import type { createGmailApplication } from "../application/gmail";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { gmailCallbackSchema } from "../models/gmail";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";

export function createGmailHttpHandlers(options: {
  application: ReturnType<typeof createGmailApplication>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const responder = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 4096),
    app = options.application;
  async function respond(operation: () => Promise<Response>) {
    const response = await responder(operation);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  async function empty(request: Request) {
    const input = await body(request);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length
    )
      throw new ApplicationError("INVALID_INPUT");
  }
  return {
    read: (request: Request, businessId: string, mailboxId: string) =>
      respond(async () =>
        dataResponse(await app.read(request.headers, businessId, mailboxId)),
      ),
    start: (request: Request, businessId: string, mailboxId: string) =>
      respond(async () => {
        await empty(request);
        return dataResponse(
          await app.start(request.headers, businessId, mailboxId),
        );
      }),
    disconnect: (request: Request, businessId: string, mailboxId: string) =>
      respond(async () => {
        await empty(request);
        return dataResponse(
          await app.disconnect(request.headers, businessId, mailboxId),
        );
      }),
    callback: (request: Request, businessId: string, mailboxId: string) =>
      respond(async () => {
        const params = new URL(request.url).searchParams;
        if (["state", "code", "error"].some((k) => params.getAll(k).length > 1))
          throw new ApplicationError("INVALID_INPUT");
        const parsed = gmailCallbackSchema.safeParse({
          state: params.get("state"),
          ...(params.has("code") ? { code: params.get("code") } : {}),
          ...(params.has("error") ? { error: params.get("error") } : {}),
        });
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const result = await app.callback(
          request.headers,
          businessId,
          mailboxId,
          parsed.data,
        );
        return new Response(null, {
          status: 303,
          headers: { Location: `${options.origin}${result.returnPath}` },
        });
      }),
  };
}
