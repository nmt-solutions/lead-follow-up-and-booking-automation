import type { createPilotApplication } from "../application/pilots";
import { dataResponse } from "../models/api";
import { ApplicationError } from "../models/application-error";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
export function createPilotHttp(d: {
  application: ReturnType<typeof createPilotApplication<Headers>>;
  origin: string;
  reportFailure(v: FailureDiagnostic): void;
}) {
  const respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(d.origin, 64 * 1024);
  return {
    get: (r: Request, b: string) =>
      respond(async () =>
        dataResponse(await d.application.workspace(r.headers, b)),
      ),
    command: (r: Request, b: string, command: string) =>
      respond(async () => {
        const input = await body(r);
        switch (command) {
          case "authorize-setup":
            return dataResponse(
              await d.application.authorizeSetup(r.headers, b, input),
            );
          case "prepare":
            return dataResponse(
              await d.application.prepare(r.headers, b, input),
            );
          case "preflight":
            return dataResponse(
              await d.application.preflight(r.headers, b, input),
            );
          case "approve":
            return dataResponse(
              await d.application.approve(r.headers, b, input),
            );
          case "activate":
            return dataResponse(
              await d.application.activate(r.headers, b, input),
            );
          case "stop":
            return dataResponse(await d.application.stop(r.headers, b, input));
          case "effort":
            return dataResponse(
              await d.application.effort(r.headers, b, input),
            );
          case "results":
            return dataResponse(
              await d.application.results(r.headers, b, input),
            );
          case "renewal":
            return dataResponse(
              await d.application.renewal(r.headers, b, input),
            );
          case "reuse":
            return dataResponse(await d.application.reuse(r.headers, b, input));
          default:
            throw new ApplicationError("NOT_FOUND");
        }
      }),
  };
}
