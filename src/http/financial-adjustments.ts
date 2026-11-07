import type { createFinancialAdjustmentApplication } from "../application/financial-adjustments";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createFinancialAdjustmentHttp(options: {
  application: ReturnType<typeof createFinancialAdjustmentApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = options.application,
    respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 32 * 1024);
  return {
    queue: (r: Request) =>
      respond(async () => dataResponse(await app.queue(r.headers))),
    receipts: (r: Request) =>
      respond(async () => dataResponse(await app.receipts(r.headers))),
    financialFeed: (r: Request) =>
      respond(async () => dataResponse(await app.financialFeed(r.headers))),
    workspace: (r: Request, id: string, operator = false) =>
      respond(async () =>
        dataResponse(await app.workspace(r.headers, id, operator)),
      ),
    command: (r: Request, id: string, action: string) =>
      respond(async () => {
        if (action === "evidence") {
          const file = await app.evidence(r.headers, id, await body(r));
          return new Response(new Uint8Array(file.bytes), {
            headers: {
              "content-type": file.contentType,
              "content-disposition": `attachment; filename="${file.name}"`,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        }
        if (
          ![
            "review",
            "review-credit",
            "execute",
            "refresh",
            "credit",
            "dispute",
            "withdraw",
            "details",
          ].includes(action)
        )
          throw new ApplicationError("INVALID_INPUT");
        const input = await body(r);
        switch (action) {
          case "review-credit":
            return dataResponse(await app.reviewCredit(r.headers, id, input));
          case "review":
            return dataResponse(await app.review(r.headers, id, input));
          case "execute":
            return dataResponse(await app.execute(r.headers, id, input));
          case "refresh":
            return dataResponse(await app.refresh(r.headers, id, input));
          case "credit":
            return dataResponse(await app.credit(r.headers, id, input));
          case "dispute":
            return dataResponse(await app.dispute(r.headers, id, input));
          case "withdraw":
            return dataResponse(await app.withdraw(r.headers, id, input));
          case "details":
            return dataResponse(await app.details(r.headers, id, input));
        }
        throw new ApplicationError("INVALID_INPUT");
      }),
    event: (r: Request) =>
      respond(async () => {
        const reader = r.body?.getReader();
        if (!reader) throw new ApplicationError("INVALID_INPUT");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            if (size > 256 * 1024) {
              await reader.cancel();
              throw new ApplicationError("INVALID_INPUT");
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        return dataResponse(
          await app.event({ body: Buffer.concat(chunks), headers: r.headers }),
        );
      }),
  };
}
