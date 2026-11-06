import { z } from "zod";
import type { createWhatsAppIntakeApplication } from "../application/whatsapp-intake";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";

export function createWhatsAppIntakeHttp(options: {
  application: ReturnType<typeof createWhatsAppIntakeApplication<Headers>>;
  origin: string;
  reportFailure(diagnostic: FailureDiagnostic): void;
}) {
  const respond = createResponder(options.reportFailure);
  const body = createJsonBodyReader(options.origin);
  return {
    get: (request: Request, businessId: string) =>
      respond(async () =>
        dataResponse(
          await options.application.workspace(request.headers, businessId),
        ),
      ),
    command: (request: Request, businessId: string) =>
      respond(async () => {
        const input = z
          .strictObject({
            action: z.enum(["enable", "associate"]),
            input: z.unknown(),
          })
          .safeParse(await body(request));
        if (!input.success) throw new ApplicationError("INVALID_INPUT");
        return dataResponse(
          await options.application[input.data.action](
            request.headers,
            businessId,
            input.data.input,
          ),
        );
      }),
    verify: (request: Request) =>
      respond(async () => {
        const p = new URL(request.url).searchParams;
        return new Response(
          options.application.verify(
            p.get("hub.mode"),
            p.get("hub.verify_token"),
            p.get("hub.challenge"),
          ),
          {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "text/plain",
            },
          },
        );
      }),
    receive: (request: Request) =>
      respond(async () => {
        const reader = request.body?.getReader();
        if (!reader) throw new ApplicationError("INVALID_INPUT");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 1024 * 1024) {
              await reader.cancel();
              throw new ApplicationError("INVALID_INPUT");
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        return dataResponse(
          await options.application.accept(
            Buffer.concat(chunks),
            request.headers.get("x-hub-signature-256"),
          ),
        );
      }),
  };
}
