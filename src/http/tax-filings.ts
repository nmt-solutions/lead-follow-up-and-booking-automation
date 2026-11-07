import { z } from "zod";
import type { createTaxFilingApplication } from "../application/tax-filings";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createTaxFilingHttp(d: {
  application: ReturnType<typeof createTaxFilingApplication<Headers>>;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = d.application,
    body = createJsonBodyReader(d.origin, 3 * 1024 * 1024),
    respond = createResponder(d.reportFailure);
  return {
    get: (r: Request) =>
      respond(async () => dataResponse(await app.workspace(r.headers))),
    command: (r: Request) =>
      respond(async () => {
        const parsed = z
          .strictObject({
            action: z.enum([
              "save_policy",
              "decide_policy",
              "prepare",
              "act",
              "store_evidence",
              "reconcile_remittance",
              "record_expense",
            ]),
            input: z.unknown(),
          })
          .safeParse(await body(r));
        if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
        const { action, input } = parsed.data;
        if (action === "save_policy") await app.savePolicy(r.headers, input);
        else if (action === "decide_policy")
          await app.decidePolicy(r.headers, input);
        else if (action === "prepare") await app.prepare(r.headers, input);
        else if (action === "act") await app.act(r.headers, input);
        else if (action === "store_evidence")
          await app.storeEvidence(r.headers, input);
        else if (action === "record_expense")
          await app.recordExpense(r.headers, input);
        else await app.reconcileRemittance(r.headers, input);
        return dataResponse(await app.workspace(r.headers));
      }),
    exportReport: (r: Request) =>
      respond(async () => {
        const exported = await app.exportReport(r.headers, await body(r));
        return new Response(JSON.stringify(exported, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="tax-accounting-${exported.report.id}-r${exported.report.revision}.json"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }),
    content: (r: Request, id: string) =>
      respond(async () => {
        const file = await app.downloadEvidence(r.headers, { evidenceId: id });
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "content-type": file.contentType,
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }),
  };
}
