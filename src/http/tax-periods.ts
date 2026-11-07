import { z } from "zod";
import type { createTaxPeriodApplication } from "../application/tax-periods";
import type { createNotificationApplication } from "../application/notifications";
import { ApplicationError } from "../models/application-error";
import { dataResponse } from "../models/api";
import { createJsonBodyReader } from "./request-body";
import { createResponder, type FailureDiagnostic } from "./respond";

export function createTaxPeriodHttp(d: {
  application: ReturnType<typeof createTaxPeriodApplication<Headers>>;
  notifications: Pick<
    ReturnType<typeof createNotificationApplication<Headers>>,
    "preferences" | "setPreference"
  >;
  origin: string;
  reportFailure(d: FailureDiagnostic): void;
}) {
  const app = d.application,
    body = createJsonBodyReader(d.origin, 128 * 1024),
    respond = createResponder(d.reportFailure);
  async function screen(headers: Headers) {
    const preferences = await d.notifications.preferences(headers, null);
    const workspace = await app.workspace(headers);
    return {
      workspace,
      emailPreference:
        preferences.find((p) => p.purpose === "tax_period") ?? null,
    };
  }
  return {
    get: (r: Request) =>
      respond(async () => dataResponse(await screen(r.headers))),
    report: (r: Request, id: string) =>
      respond(async () => dataResponse(await app.report(r.headers, id))),
    command: (r: Request) =>
      respond(async () => {
        const command = z
          .strictObject({
            action: z.enum([
              "save_obligation",
              "decide_obligation",
              "open_period",
              "prepare",
              "review",
              "evaluate_reminders",
              "email_preference",
            ]),
            input: z.unknown(),
          })
          .safeParse(await body(r));
        if (!command.success) throw new ApplicationError("INVALID_INPUT");
        const { action, input } = command.data;
        if (action === "save_obligation")
          await app.saveObligation(r.headers, input);
        else if (action === "decide_obligation")
          await app.decideObligation(r.headers, input);
        else if (action === "open_period")
          await app.openPeriod(r.headers, input);
        else if (action === "prepare") await app.prepare(r.headers, input);
        else if (action === "review") await app.act(r.headers, input);
        else if (action === "evaluate_reminders")
          await app.evaluateReminders(r.headers);
        else {
          await app.workspace(r.headers);
          const preference = z
            .strictObject({
              enabled: z.boolean(),
              expectedVersion: z.number().int().nonnegative(),
            })
            .safeParse(input);
          if (!preference.success) throw new ApplicationError("INVALID_INPUT");
          await d.notifications.setPreference(r.headers, null, {
            ...preference.data,
            purpose: "tax_period",
          });
        }
        return dataResponse(await screen(r.headers));
      }),
    exportReport: (r: Request) =>
      respond(async () => {
        const exported = await app.exportReport(r.headers, await body(r));
        return new Response(JSON.stringify(exported, null, 2), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="tax-report-${exported.report.id}-r${exported.report.revision}.json"`,
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }),
  };
}
