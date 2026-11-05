import type { createKnowledgeApplication } from "../application/knowledge";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createKnowledgeHttp(options: {
  application: ReturnType<typeof createKnowledgeApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  // All list/field maxima fit within this bound even with four-byte UTF-8 text.
  const body = createJsonBodyReader(options.origin, 3 * 1024 * 1024);
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
    approve: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.approve(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
    retire: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.retire(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
    evaluate: (request: Request, id: string) =>
      respond(async () =>
        dataResponse(
          await options.application.evaluate(
            request.headers,
            id,
            await body(request),
          ),
        ),
      ),
  };
}
