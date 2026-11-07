import type { createReconciliationApplication } from "../application/reconciliation";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createReconciliationHttp(options: {
  application: ReturnType<typeof createReconciliationApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = options.application,
    respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 1100000);
  return {
    workspace: (r: Request) =>
      respond(async () => {
        const u = new URL(r.url);
        return dataResponse(
          await app.workspace(r.headers, {
            from: u.searchParams.get("from"),
            until: u.searchParams.get("until"),
          }),
        );
      }),
    command: (r: Request, action: string) =>
      respond(async () => {
        const input = await body(r);
        if (action === "evidence")
          return dataResponse(await app.recordEvidence(r.headers, input));
        if (action === "record")
          return dataResponse(await app.record(r.headers, input));
        if (action === "review")
          return dataResponse(await app.review(r.headers, input));
        if (action === "access")
          return dataResponse(await app.evidenceAccess(r.headers, input));
        if (action === "content") {
          const f = await app.evidenceContent(r.headers, input);
          return new Response(f.bytes, {
            headers: {
              "content-type": f.contentType,
              "content-disposition": `attachment; filename="${f.name}"`,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }
        if (action === "export") {
          const f = await app.export(r.headers, input);
          return new Response(f.content, {
            headers: {
              "content-type": f.contentType,
              "content-disposition": `attachment; filename="${f.name}"`,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
              "x-content-sha256": f.sha256,
            },
          });
        }
        throw new ApplicationError("INVALID_INPUT");
      }),
  };
}
