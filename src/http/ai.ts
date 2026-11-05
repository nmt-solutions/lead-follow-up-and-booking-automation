import type { createAiApplication } from "../application/ai";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createAiHttp(options: {
  application: ReturnType<typeof createAiApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin, 512 * 1024);
  return {
    get: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(await options.application.workspace(request.headers, id)),
      ),
    draft: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.saveDraft(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
    preview: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.preview(
            request.headers,
            id,
            await body(request),
            { signal: request.signal },
          ),
        ),
      ),
    review: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.reviewPreview(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
    activate: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.activate(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
  };
}
