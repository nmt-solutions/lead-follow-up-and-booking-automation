import type { createCostApplication } from "../application/costs";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";
import { ApplicationError } from "../models/application-error";
import { z } from "zod";

export function createCostHttp(options: {
  application: ReturnType<typeof createCostApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = options.application,
    respond = createResponder(options.reportFailure),
    body = createJsonBodyReader(options.origin, 128 * 1024);
  return {
    workspace: (r: Request) =>
      respond(async () =>
        dataResponse(
          await app.workspace(
            r.headers,
            new URL(r.url).searchParams.get("month"),
          ),
        ),
      ),
    command: (r: Request) =>
      respond(async () => {
        const parsed = z
          .object({
            action: z.enum([
              "record",
              "configure",
              "budget",
              "refresh",
              "evaluate",
              "acknowledge",
            ]),
            input: z.unknown(),
          })
          .strict()
          .safeParse(await body(r));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const { action, input } = parsed.data;
        if (action === "record") await app.record(r.headers, input);
        else if (action === "configure") await app.configure(r.headers, input);
        else if (action === "budget") await app.setBudget(r.headers, input);
        else if (action === "refresh") await app.refresh(r.headers, input);
        else if (action === "acknowledge")
          await app.acknowledge(r.headers, input);
        else await app.evaluate(r.headers, input);
        return dataResponse({ saved: true });
      }),
  };
}
