import { ApplicationError } from "../models/application-error";
import type { SequenceMailProvider } from "../models/email-sequences";
import { configuredMicrosoftMail } from "../microsoft-mail/configuration";
import { createMicrosoftSequenceMail } from "../microsoft-mail/sequence-mail";
import { configuredGmail } from "../gmail/configuration";
import { createGmailSequenceMail } from "../gmail/sequence-mail";
import type { Clock } from "../models/business";

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
export function configuredSequenceMail(options: {
  env: Readonly<Record<string, string | undefined>>;
  clock: Clock;
  fetch: typeof fetch;
}): SequenceMailProvider {
  const gmail = configuredGmail(options.env),
    microsoft = configuredMicrosoftMail(options.env);
  return routeSequenceMail([
    ...(gmail
      ? [
          createGmailSequenceMail({
            configuration: gmail,
            clock: options.clock,
            fetch: options.fetch,
          }),
        ]
      : []),
    ...(microsoft
      ? [
          createMicrosoftSequenceMail({
            configuration: microsoft,
            clock: options.clock,
            fetch: options.fetch,
          }),
        ]
      : []),
  ]);
}
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

/** Exact adapter routing only. Selection never catches a send failure or tries another provider. */
export function routeSequenceMail(
  providers: SequenceMailProvider[],
): SequenceMailProvider {
  const byKey = new Map(providers.map((p) => [p.key, p]));
  if (byKey.size !== providers.length)
    throw new ApplicationError("INVALID_INPUT");
  const select = (key: string) => byKey.get(key) ?? unavailableSequenceMail;
  return {
    key: "native-mail-v1",
    mode: providers.length ? "live" : "unconfigured",
    adapters: providers.map((p) => ({ key: p.key, mode: p.mode })),
    select,
    send: (e, s, a) => select(e.adapterKey).send(e, s, a),
    reconcile: (e, s) => select(e.adapterKey).reconcile(e, s),
  };
}
export const selectSequenceMail = (p: SequenceMailProvider, key: string) =>
  p.select?.(key) ?? p;
