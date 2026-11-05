import { ApplicationError } from "../models/application-error";

export function createJsonBodyReader(origin: string) {
  return async function body(request: Request): Promise<unknown> {
    if (request.headers.get("origin") !== origin)
      throw new ApplicationError("FORBIDDEN");
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new ApplicationError("INVALID_INPUT");
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
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("INVALID_INPUT");
    } finally {
      reader.releaseLock();
    }
  };
}
