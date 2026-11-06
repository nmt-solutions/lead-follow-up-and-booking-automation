import { z } from "zod";
import type { CostMailer } from "../models/costs";
import { ApplicationError } from "../models/application-error";

export function configuredCostMailer(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): CostMailer | null {
  const parsed = z
    .object({
      RESEND_API_KEY: z.string().min(1),
      COST_ALERT_EMAIL_FROM: z.email(),
    })
    .safeParse(env);
  if (!parsed.success) return null;
  const config = parsed.data;
  return {
    async send(message) {
      try {
        const response = await request("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.key,
          },
          body: JSON.stringify({
            from: config.COST_ALERT_EMAIL_FROM,
            to: [message.email],
            subject: "Operator budget threshold reached",
            text: message.text,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
        const body: unknown = await response.json();
        const result = z
          .object({ id: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,256}$/) })
          .safeParse(body);
        if (!result.success)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        return result.data;
      } catch {
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
    },
  };
}
