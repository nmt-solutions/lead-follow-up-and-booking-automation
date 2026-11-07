import { z } from "zod";
import type { createNotificationApplication } from "../application/notifications";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createResponder, type FailureDiagnostic } from "./respond";
import { createJsonBodyReader } from "./request-body";

export function createNotificationHttp(d: {
  application: ReturnType<typeof createNotificationApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = d.application,
    respond = createResponder(d.reportFailure),
    body = createJsonBodyReader(new URL(d.origin).origin, 8192);
  return {
    get: (r: Request, businessId?: string) =>
      respond(async () =>
        dataResponse(
          businessId
            ? {
                ...(await app.businessWorkspace(r.headers, businessId)),
                preferences: await app.preferences(r.headers, businessId),
              }
            : {
                workspace: await app.workspace(r.headers),
                preferences: await app.preferences(r.headers, null),
              },
        ),
      ),
    command: (r: Request, businessId?: string) =>
      respond(async () => {
        const parsed = z
          .discriminatedUnion("action", [
            z.strictObject({ action: z.literal("terms"), input: z.unknown() }),
            z.strictObject({ action: z.literal("verify") }),
            z.strictObject({ action: z.literal("retry"), id: z.uuid() }),
            z.strictObject({
              action: z.literal("preference"),
              input: z.unknown(),
            }),
          ])
          .safeParse(await body(r));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const command = parsed.data;
        if (businessId && command.action !== "preference")
          throw new ApplicationError("FORBIDDEN");
        if (command.action === "terms")
          await app.selectTerms(r.headers, command.input);
        else if (command.action === "verify") await app.refreshSetup(r.headers);
        else if (command.action === "retry")
          await app.retry(r.headers, command.id);
        else
          await app.setPreference(r.headers, businessId ?? null, command.input);
        return dataResponse({ saved: true });
      }),
    webhook: (r: Request) =>
      respond(async () => {
        const reader = r.body?.getReader();
        if (!reader) throw new ApplicationError("INVALID_INPUT");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > 65536) {
              await reader.cancel();
              throw new ApplicationError("INVALID_INPUT");
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        return dataResponse(
          await app.receiveWebhook(Buffer.concat(chunks), r.headers),
        );
      }),
  };
}
