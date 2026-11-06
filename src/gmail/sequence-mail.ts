import type { SequenceMailProvider } from "../models/email-sequences";
import { createGmailTransport, gmailTransportKey } from "./transport";

// Existing saved sequence bindings retain their adapter key.
export const gmailSequenceKey = gmailTransportKey;
export function createGmailSequenceMail(
  d: Parameters<typeof createGmailTransport>[0],
): SequenceMailProvider {
  return {
    key: gmailSequenceKey,
    mode: "live",
    ...createGmailTransport(d),
    async reconcile() {
      return { status: "unknown" };
    },
  };
}
