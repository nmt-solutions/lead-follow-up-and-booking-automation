import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sequenceMailSelected } from "../mailboxes/sequence-references";
import { mailNativeSchema } from "../models/mail-native";
import { MicrosoftMailFailure } from "../models/microsoft-mail";
import type {
  MailboxMetadata,
  MailboxSnapshot,
  MailboxGrant,
} from "../models/mailboxes";
import { microsoftValue } from "./http";

export const graphId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_+=/\-]+$/);
const recipient = z.object({
  emailAddress: z.object({ address: z.email().max(254) }),
});
export const graphMetadataFields =
  "id,conversationId,parentFolderId,receivedDateTime,sentDateTime,isDraft,subject,internetMessageId,from,sender,toRecipients,ccRecipients,bccRecipients,internetMessageHeaders";
export const graphMessageSchema = z.object({
  id: graphId,
  conversationId: graphId,
  parentFolderId: graphId,
  receivedDateTime: z.iso.datetime({ offset: true }),
  sentDateTime: z.iso.datetime({ offset: true }),
  isDraft: z.boolean(),
  subject: z.string().max(500),
  internetMessageId: z.string().max(998),
  from: recipient,
  sender: recipient,
  toRecipients: z.array(recipient).max(50),
  ccRecipients: z.array(recipient).max(50),
  bccRecipients: z.array(recipient).max(50),
  internetMessageHeaders: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9-]+$/),
        value: z.string().max(8192),
      }),
    )
    .max(200),
});
type GraphMessage = z.infer<typeof graphMessageSchema>;
export function graphMetadata(
  message: GraphMessage,
  context: MailboxSnapshot,
  nativeGrant: NonNullable<MailboxGrant["microsoft"]>,
): MailboxMetadata {
  const headers = new Map<string, string>();
  for (const h of message.internetMessageHeaders) {
    const key = h.name.toLowerCase(),
      value = h.value.replace(/\r?\n[ \t]+/g, " ").trim();
    if (headers.has(key) || /[\u0000-\u001f\u007f]/.test(value)) {
      if (
        [
          "from",
          "to",
          "cc",
          "bcc",
          "subject",
          "message-id",
          "in-reply-to",
          "list-id",
          "auto-submitted",
        ].includes(key)
      )
        throw new MicrosoftMailFailure("invalid_response");
      continue;
    }
    headers.set(key, value);
  }
  if (
    headers.has("message-id") &&
    headers.get("message-id") !== message.internetMessageId
  )
    throw new MicrosoftMailFailure("invalid_response");
  const account = context.account.toLowerCase(),
    from = message.from.emailAddress.address.toLowerCase(),
    sender = message.sender.emailAddress.address.toLowerCase();
  const to = [
    ...new Set(
      [
        ...message.toRecipients,
        ...message.ccRecipients,
        ...message.bccRecipients,
      ].map((r) => r.emailAddress.address.toLowerCase()),
    ),
  ];
  const sent = message.parentFolderId === nativeGrant.sentFolderRef;
  const native = mailNativeSchema.safeParse({
    direction: sent ? "manual_reply" : "incoming",
    internetMessageId: message.internetMessageId,
    inReplyTo: headers.get("in-reply-to") ?? null,
    from,
    to,
  });
  const appOrigin = context.appMessages?.some(
    (receipt) =>
      receipt.messageRef === message.id &&
      receipt.internetMessageId === message.internetMessageId,
  );
  const excluded =
    appOrigin ||
    message.isDraft ||
    nativeGrant.excludedFolderRefs.includes(message.parentFolderId) ||
    headers.has("list-id") ||
    (headers.has("auto-submitted") &&
      headers.get("auto-submitted")?.toLowerCase() !== "no");
  const validDirection =
    from === sender &&
    (sent
      ? from === account && !to.includes(account)
      : from !== account && to.includes(account));
  const subject = message.subject.toLocaleLowerCase();
  const sales =
    (native.success && sequenceMailSelected(context, native.data)) ||
    context.knownThreads?.includes(message.conversationId) ||
    (context.configuration.scope.kind === "threads" &&
      context.configuration.scope.refs.includes(message.conversationId)) ||
    (context.configuration.scope.kind === "folders" &&
      context.configuration.salesSubjectTerms?.some((term) =>
        subject.includes(term.toLocaleLowerCase()),
      ));
  return {
    messageRef: message.id,
    conversationRef: message.conversationId,
    folderRefs: [message.parentFolderId],
    occurredAt: sent ? message.sentDateTime : message.receivedDateTime,
    relevance: excluded
      ? "unrelated"
      : native.success && validDirection && sales
        ? "sales"
        : "unknown",
    ...(native.success ? { native: native.data } : {}),
  };
}
export function graphEvent(
  raw: unknown,
  context: MailboxSnapshot,
  expected: MailboxMetadata,
  grant: NonNullable<MailboxGrant["microsoft"]>,
) {
  const message = microsoftValue(
    graphMessageSchema.extend({
      body: z.object({
        contentType: z.literal("text"),
        content: z
          .string()
          .min(1)
          .max(20000)
          .refine((v) => !v.includes("\0")),
      }),
    }),
    raw,
  );
  const metadata = graphMetadata(message, context, grant);
  if (
    !isDeepStrictEqual(metadata, expected) ||
    !metadata.native ||
    metadata.relevance !== "sales" ||
    /[\u0000-\u001f\u007f]/.test(message.subject)
  )
    throw new MicrosoftMailFailure("invalid_response");
  const base = {
    eventId: message.id,
    messageRef: message.id,
    conversationRef: message.conversationId,
    occurredAt: metadata.occurredAt,
    subject: message.subject.trim() || "Sales conversation",
    text: message.body.content,
  };
  return metadata.native.direction === "manual_reply"
    ? { ...base, kind: "manual_reply", native: metadata.native }
    : {
        ...base,
        kind: explicitEmailOptOut(base.text) ? "opt_out" : "direct_inquiry",
        senderRef: metadata.native.from,
        senderName: metadata.native.from,
        geography: null,
      };
}
import { explicitEmailOptOut } from "../inbox/opt-out";
