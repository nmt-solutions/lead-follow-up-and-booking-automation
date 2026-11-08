import type { SequenceMailProvider } from "../models/email-sequences";
import { createMicrosoftTransport, microsoftTransportKey } from "./transport";
export function createMicrosoftSequenceMail(
  d: Parameters<typeof createMicrosoftTransport>[0],
): SequenceMailProvider {
  return {
    key: microsoftTransportKey,
    mode: "live",
    ...createMicrosoftTransport(d),
    async reconcile() {
      return { status: "unknown" };
    },
  };
}
