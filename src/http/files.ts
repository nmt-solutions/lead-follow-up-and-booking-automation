import type { createFileApplication } from "../application/files";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";

export function createFilesHttp(options: {
  application: ReturnType<typeof createFileApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin);
  const app = options.application;
  return {
    list: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(await app.list(request.headers, businessId)),
      ),
    begin: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await app.beginUpload(
            request.headers,
            businessId,
            await body(request),
          ),
          201,
        ),
      ),
    access: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        await body(request);
        return dataResponse(
          await app.createAccess(request.headers, businessId, id),
        );
      }),
    remove: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        await body(request);
        return dataResponse(
          await app.deleteFile(request.headers, businessId, id),
        );
      }),
    upload: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        if (request.headers.get("origin") !== options.origin)
          throw new ApplicationError("FORBIDDEN");
        // Authorize before reading the body. Enforce the configured bound while
        // reading, including chunked bodies and false Content-Length headers.
        const listing = await app.list(request.headers, businessId);
        if (!listing.canManage) throw new ApplicationError("FORBIDDEN");
        if (!listing.policy) throw new ApplicationError("FILE_SETUP_REQUIRED");
        const file = listing.files.find((file) => file.id === id);
        if (!file) throw new ApplicationError("NOT_FOUND");
        if (request.headers.get("content-type") !== file.contentType)
          throw new ApplicationError("FILE_DISALLOWED");
        const reader = request.body?.getReader();
        if (!reader) throw new ApplicationError("INVALID_INPUT");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > Math.min(file.size, listing.policy.maxBytes))
              throw new ApplicationError("FILE_DISALLOWED");
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        return dataResponse(
          await app.completeUpload(
            request.headers,
            businessId,
            id,
            request.headers.get("x-file-token"),
            Buffer.concat(chunks),
          ),
        );
      }),
    download: (request: Request, businessId: string, id: string) =>
      respond(async () => {
        const result = await app.download(
          request.headers,
          businessId,
          id,
          request.headers.get("x-file-token"),
        );
        return new Response(Buffer.from(result.bytes), {
          headers: {
            "Content-Type": result.file.contentType,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
            "Content-Length": String(result.bytes.byteLength),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
  };
}
