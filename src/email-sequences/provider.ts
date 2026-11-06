import { ApplicationError } from "../models/application-error";
import type { SequenceMailProvider } from "../models/email-sequences";

/** Mailbox login and sync do not activate Gmail/Graph dispatch or authoritative reconciliation.
 * Production has no fixture or transactional-mail fallback. */
export const unavailableSequenceMail: SequenceMailProvider = {
  key: "unconfigured-sequence-mail",
  mode: "unconfigured",
  async send() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
  async reconcile() {
    return { status: "unknown" };
  },
};
/** An external-I/O deadline only. Trigger owns persisted timing and retries. */
export async function sequenceMailCall(
  operation: (signal: AbortSignal) => Promise<unknown>,
  parent: AbortSignal,
) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(5000)]);
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(signal),
      new Promise<never>((_, reject) => {
        abort = () => reject(new ApplicationError("PROVIDER_UNAVAILABLE"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}
