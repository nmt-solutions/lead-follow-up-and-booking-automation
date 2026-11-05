import type { InvitationMailer } from "../models/team";
import { ApplicationError } from "../models/application-error";
import { z } from "zod";

export function createInvitationMailer(options: {
  apiKey: string;
  from: string;
}): InvitationMailer {
  return {
    async send(message) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `business-invitation/${message.invitationId}`,
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.email],
            subject: `Invitation to ${message.businessName}`,
            text: `You have been invited to ${message.businessName} as ${message.role}.\n\nSign in with ${message.email} and accept the invitation:\n${message.url}\n\nExpires: ${message.expiresAt.toISOString()}. If you did not expect this invitation, ignore it.`,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
        const result: unknown = await response.json();
        if (!z.object({ id: z.string().min(1) }).safeParse(result).success)
          throw new ApplicationError("PROVIDER_UNAVAILABLE");
      } catch {
        throw new ApplicationError("PROVIDER_UNAVAILABLE");
      }
    },
  };
}
