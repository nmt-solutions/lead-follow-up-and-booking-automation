import type { createBusinessApplication } from "../application/business";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";

export type BusinessApplication = ReturnType<
  typeof createBusinessApplication<Headers>
>;

export function createBusinessHttp(options: {
  application: BusinessApplication;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);

  async function body(request: Request): Promise<unknown> {
    if (request.headers.get("origin") !== options.origin)
      throw new ApplicationError("FORBIDDEN");
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new ApplicationError("INVALID_INPUT");
    // Bound the bytes read even when Content-Length is absent or untrusted.
    const reader = request.body?.getReader();
    if (!reader) throw new ApplicationError("INVALID_INPUT");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 32768) {
          await reader.cancel();
          throw new ApplicationError("INVALID_INPUT");
        }
        chunks.push(chunk.value);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      return JSON.parse(text);
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("INVALID_INPUT");
    } finally {
      reader.releaseLock();
    }
  }

  return {
    list: (request: Request) =>
      respond(async () =>
        dataResponse(await options.application.listBusinesses(request.headers)),
      ),
    create: (request: Request) =>
      respond(async () =>
        dataResponse(
          await options.application.createBusiness(
            request.headers,
            await body(request),
          ),
          201,
        ),
      ),
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.getProfile(request.headers, businessId),
        ),
      ),
    update: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.updateProfile(
            request.headers,
            businessId,
            await body(request),
          ),
        ),
      ),
  };
}
