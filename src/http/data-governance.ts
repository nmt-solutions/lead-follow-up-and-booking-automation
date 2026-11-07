import type { createDataGovernanceApplication } from "../application/data-governance";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
export function createDataGovernanceHttp(d: {
  application: ReturnType<typeof createDataGovernanceApplication<Headers>>;
  origin: string;
  reportFailure: (diagnostic: FailureDiagnostic) => void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 8192),
    app = d.application;
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.workspace(request.headers, id)),
      ),
    command: (request: Request, id: string) =>
      respond(async () => {
        const input = await body(request);
        if (
          !input ||
          typeof input !== "object" ||
          !("command" in input) ||
          !("input" in input) ||
          Object.keys(input).length !== 2
        )
          throw new ApplicationError("INVALID_INPUT");
        const action = input.command;
        if (action === "export")
          return dataResponse(
            await app.export(request.headers, id, input.input),
          );
        if (action === "offboard")
          return dataResponse(
            await app.offboard(request.headers, id, input.input),
          );
        if (action === "reopen") {
          await app.reopen(request.headers, id, input.input);
          return dataResponse({ saved: true });
        }
        if (action === "recordEvidence") {
          await app.recordEvidence(request.headers, id, input.input);
          return dataResponse({ recorded: true });
        }
        throw new ApplicationError("INVALID_INPUT");
      }),
    grant: (request: Request, id: string, exportId: string) =>
      respond(async () => {
        await body(request);
        return dataResponse(await app.access(request.headers, id, exportId));
      }),
    download: (request: Request, id: string, exportId: string) =>
      respond(async () => {
        // A bearer grant stays out of URLs, logs, history and referrers.
        const value = await body(request);
        const token =
          value && typeof value === "object" && "token" in value
            ? value.token
            : null;
        const result = await app.download(request.headers, id, exportId, token);
        return new Response(Buffer.from(result.bytes), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${result.name}"`,
            "Cache-Control": "private, no-store, max-age=0",
            Pragma: "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
  };
}
