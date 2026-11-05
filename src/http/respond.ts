import { randomUUID } from "node:crypto";
import { errorResponse, publicFailure } from "../models/api";

export type FailureDiagnostic = { requestId: string; code: string };

export function createResponder(
  reportFailure: (diagnostic: FailureDiagnostic) => void,
) {
  return async function respond(operation: () => Promise<Response>) {
    try {
      return await operation();
    } catch (error: unknown) {
      const requestId = randomUUID();
      reportFailure({ requestId, code: publicFailure(error).code });
      return errorResponse(error, requestId);
    }
  };
}
