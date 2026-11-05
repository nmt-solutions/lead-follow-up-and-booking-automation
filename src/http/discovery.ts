import type { createDiscoveryApplication } from "../application/discovery";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createDiscoveryHttp(options: {
  application: ReturnType<typeof createDiscoveryApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 16384);
  const command =
    (
      action:
        | "approveAllowance"
        | "resume"
        | "cancel"
        | "saveSchedule"
        | "scheduleCommand",
      status: number,
    ) =>
    (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application[action](
            request.headers,
            id,
            await body(request),
          ),
          status,
        ),
      );
  return {
    saveSchedule: command("saveSchedule", 200),
    scheduleCommand: command("scheduleCommand", 200),
    approveAllowance: command("approveAllowance", 200),
    resume: command("resume", 202),
    cancel: command("cancel", 200),
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await options.application.workspace(request.headers, id)),
      ),
    start: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.start(
            request.headers,
            id,
            await body(request),
          ),
          202,
        ),
      ),
  };
}
