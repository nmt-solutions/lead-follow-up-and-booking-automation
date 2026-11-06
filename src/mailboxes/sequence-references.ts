import type { MailboxSnapshot } from "../models/mailboxes";
import type { MailNative } from "../models/mail-native";

/** An exact approved outgoing reference identifies sales processing scope, never permission to send or evidence of delivery. */
export function sequenceMailSelected(
  context: MailboxSnapshot,
  native: MailNative,
) {
  return (
    context.sequenceMessages?.some((m) =>
      native.direction === "manual_reply"
        ? native.internetMessageId === m.internetMessageId &&
          native.from === m.fromAddress &&
          native.to.length === 1 &&
          native.to[0] === m.recipient
        : native.inReplyTo === m.internetMessageId &&
          native.from === m.recipient &&
          native.to.includes(m.replyTo),
    ) ?? false
  );
}
