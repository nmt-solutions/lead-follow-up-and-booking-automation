import { ApplicationError } from "../models/application-error";
import type { OpportunityActionProvider } from "../models/opportunity-control";
import { mailResultSchema } from "../models/mail-dispatch";
import { createMicrosoftTransport, microsoftTransportKey } from "./transport";

/** Uses the shared native transport directly, never another application or sequence workflow. */
export function createMicrosoftOpportunityMail(
  d: Parameters<typeof createMicrosoftTransport>[0],
): OpportunityActionProvider {
  const transport = createMicrosoftTransport(d);
  return {
    emailIdentity: { adapterKey: microsoftTransportKey, mode: "live" },
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
