import type { createSellerDocumentApplication } from "../application/seller-documents";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createSellerDocumentHttp(options: {
  application: ReturnType<typeof createSellerDocumentApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = options.application,
    respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 128 * 1024);
  return {
    catalog: (r: Request) =>
      respond(async () => dataResponse(await app.catalog(r.headers))),
    saveIssuer: (r: Request) =>
      respond(async () =>
        dataResponse(await app.saveIssuer(r.headers, await body(r))),
      ),
    decideIssuer: (r: Request) =>
      respond(async () =>
        dataResponse(await app.decideIssuer(r.headers, await body(r))),
      ),
    queue: (r: Request) =>
      respond(async () => dataResponse(await app.queue(r.headers))),
    workspace: (r: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(await app.workspace(r.headers, businessId, operator)),
      ),
    issue: (r: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(
          await app.issue(r.headers, businessId, await body(r), operator),
        ),
      ),
    adjust: (r: Request, businessId: string) =>
      respond(async () =>
        dataResponse(await app.adjust(r.headers, businessId, await body(r))),
      ),
    recover: (r: Request, businessId: string, operator = false) =>
      respond(async () =>
        dataResponse(
          await app.recover(r.headers, businessId, await body(r), operator),
        ),
      ),
    access: (r: Request, businessId: string, id: string, operator = false) =>
      respond(async () => {
        await body(r);
        return dataResponse(
          await app.createAccess(r.headers, businessId, id, operator),
        );
      }),
    download: (r: Request, businessId: string, id: string, operator = false) =>
      respond(async () => {
        const file = await app.download(
          r.headers,
          businessId,
          id,
          r.headers.get("x-file-token"),
          operator,
        );
        return new Response(Buffer.from(file.bytes), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="${file.name}"`,
            "Content-Length": String(file.bytes.byteLength),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
  };
}
