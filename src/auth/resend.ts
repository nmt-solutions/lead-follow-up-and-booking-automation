import { z } from "zod";
import type { SignInMailer } from "./auth";
import { ApplicationError } from "../models/application-error";

export function createSignInMailer(options: {
  apiKey: string;
  from: string;
}): SignInMailer {
  return {
    async send({ email, url }) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: [email],
            subject: "Sign in to your Business",
            text: `Use this link to sign in:\n\n${url}\n\nIt expires in 10 minutes and can only be used once. If you did not request it, ignore this email.`,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
        const result: unknown = await response.json();
        if (!z.object({ id: z.string().min(1) }).safeParse(result).success)
          throw new ApplicationError("PROVIDER_UNAVAILABLE");
      } catch (error: unknown) {
        // Do not retain provider bodies, sign-in URLs or credentials in diagnostics.
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
    },
  };
}
