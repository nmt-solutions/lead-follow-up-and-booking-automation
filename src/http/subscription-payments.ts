import type { createSubscriptionPaymentApplication } from "../application/subscription-payments";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createSubscriptionPaymentHttp(options: {
  application: ReturnType<typeof createSubscriptionPaymentApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = options.application,
    respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 16 * 1024);
  return {
    pilotRenewal: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.preparePilotRenewal(r.headers, id, await body(r)),
        ),
      ),
    pilotCallback: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await app.confirmPilotCheckout(r.headers, id, await body(r)),
        ),
      ),
    cancel: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.cancel(r.headers, id, await body(r))),
      ),
    updatePayment: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.updatePayment(r.headers, id, await body(r))),
      ),
    workspace: (r: Request, id: string) =>
      respond(async () => dataResponse(await app.workspace(r.headers, id))),
    prepare: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.prepare(r.headers, id, await body(r))),
      ),
    start: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.start(r.headers, id, await body(r))),
      ),
    refresh: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.refresh(r.headers, id, await body(r))),
      ),
    queue: (r: Request) =>
      respond(async () => dataResponse(await app.operatorQueue(r.headers))),
    operatorRefresh: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.operatorRefresh(r.headers, id, await body(r))),
      ),
    event: (r: Request) =>
      respond(async () => {
        const reader = r.body?.getReader();
        if (!reader) throw new ApplicationError("INVALID_INPUT");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
            if (length > 256 * 1024) {
              await reader.cancel();
              throw new ApplicationError("INVALID_INPUT");
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        const raw = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          raw.set(chunk, offset);
          offset += chunk.length;
        }
        return dataResponse(await app.event({ body: raw, headers: r.headers }));
      }),
  };
}
