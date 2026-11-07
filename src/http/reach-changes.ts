import type { createReachChangeApplication } from "../application/reach-changes";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
export function createReachChangeHttp(d: {
  application: ReturnType<typeof createReachChangeApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 8192),
    app = d.application;
  return {
    withdraw: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.withdraw(r.headers, id, await body(r))),
      ),
    workspace: (r: Request, id: string) =>
      respond(async () => dataResponse(await app.workspace(r.headers, id))),
    preview: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.preview(r.headers, id, await body(r))),
      ),
    approve: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.approve(r.headers, id, await body(r))),
      ),
    execute: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.execute(r.headers, id, await body(r))),
      ),
    refresh: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.refresh(r.headers, id, await body(r))),
      ),
    checkout: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.checkout(r.headers, id, await body(r))),
      ),
    queue: (r: Request) =>
      respond(async () => dataResponse(await app.queue(r.headers))),
    operatorExecute: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.operatorExecute(r.headers, id, await body(r))),
      ),
    operatorRefresh: (r: Request, id: string) =>
      respond(async () =>
        dataResponse(await app.operatorRefresh(r.headers, id, await body(r))),
      ),
  };
}
