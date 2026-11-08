import { ApplicationError } from "../models/application-error";
import type { OpportunityActionProvider } from "../models/opportunity-control";
import { mailResultSchema } from "../models/mail-dispatch";
import { createGmailTransport, gmailTransportKey } from "./transport";

/** Uses the shared native transport directly, never another application or sequence workflow. */
export function createGmailOpportunityMail(
  d: Parameters<typeof createGmailTransport>[0],
): OpportunityActionProvider {
  const transport = createGmailTransport(d);
  return {
    emailIdentity: { adapterKey: gmailTransportKey, mode: "live" },
    channels: ["email"],
    async dispatch(action, signal, access) {
      if (action.channel !== "email" || !action.email || !access)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      return mailResultSchema.parse(
        await transport.send(action.email, signal, access),
      );
    },
  };
}
