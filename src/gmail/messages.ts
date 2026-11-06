import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { MailboxMetadata, MailboxSnapshot } from "../models/mailboxes";
import { gmailNativeSchema } from "../models/gmail";
import { GmailFailure, providerValue } from "./http";
import { sequenceMailSelected } from "../mailboxes/sequence-references";

export const gmailId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const header = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/),
  value: z.string().max(8192),
});
export const messageSchema = z.object({
  id: gmailId,
  threadId: gmailId,
  labelIds: z.array(z.string().min(1).max(256)).max(100).default([]),
  internalDate: z.string().regex(/^\d{1,16}$/),
  sizeEstimate: z.number().int().nonnegative().max(50_000_000),
  payload: z.object({ headers: z.array(header).max(200) }).passthrough(),
});
type Message = z.infer<typeof messageSchema>;
function headers(message: Message) {
  const result = new Map<string, string>();
  for (const h of message.payload.headers) {
    const name = h.name.toLowerCase();
    const value = h.value.replace(/\r?\n[ \t]+/g, " ").trim();
    if (/[\u0000-\u001f\u007f]/.test(value) || result.has(name)) {
      if (
        [
          "from",
          "to",
          "cc",
          "bcc",
          "subject",
          "message-id",
          "in-reply-to",
        ].includes(name)
      )
        throw new GmailFailure("invalid_response");
      continue;
    }
    result.set(name, value);
  }
  return result;
}
function addresses(value: string): string[] | null {
  if (!value) return [];
  if (value.length > 8192) return null;
  // Deliberately support simple addr-spec/name-addr lists only. Ambiguous/group syntax is never a buyer identity.
  const entries = value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (entries.length > 50) return null;
  const emails = entries.map((v) => {
    const nameAddr = /^(?:"[^"<>]*"|[^"<>]*)<([^<>]+)>$/.exec(v.trim());
    const parsed = z
      .email()
      .max(254)
      .safeParse(nameAddr?.[1]?.trim() ?? v.trim());
    return parsed.success ? parsed.data.toLowerCase() : "";
  });
  return emails.every(Boolean) ? emails : null;
}
export function gmailMetadata(
  message: Message,
  context: MailboxSnapshot,
): MailboxMetadata {
  const h = headers(message);
  const from = addresses(h.get("from") ?? "");
  const recipientLists = [
    addresses(h.get("to") ?? ""),
    addresses(h.get("cc") ?? ""),
    addresses(h.get("bcc") ?? ""),
  ];
  // Unsupported nonempty headers cannot be silently interpreted as an empty recipient list.
  const to = recipientLists.some((list) => list === null)
    ? []
    : [...new Set(recipientLists.flatMap((list) => list ?? []))];
  const account = context.account.toLowerCase();
  const sent = message.labelIds.includes("SENT");
  const native = gmailNativeSchema.safeParse({
    direction: sent ? "manual_reply" : "incoming",
    internetMessageId: h.get("message-id"),
    inReplyTo: h.get("in-reply-to") ?? null,
    from: from?.[0],
    to,
  });
  const occurred = Number(message.internalDate);
  if (
    !Number.isSafeInteger(occurred) ||
    !Number.isFinite(new Date(occurred).getTime())
  )
    throw new GmailFailure("invalid_response");
  const excluded =
    message.labelIds.some((l) => ["DRAFT", "SPAM", "TRASH"].includes(l)) ||
    h.has("list-id") ||
    (h.has("auto-submitted") && h.get("auto-submitted") !== "no");
  const directionValid = sent
    ? from?.[0] === account && !to.includes(account)
    : from?.[0] !== account && to.includes(account);
  const subject = decodedHeader(h.get("subject") ?? "").toLocaleLowerCase();
  const known = context.knownThreads?.includes(message.threadId);
  const selectedSales =
    (native.success && sequenceMailSelected(context, native.data)) ||
    known ||
    context.configuration.scope.kind === "threads" ||
    (context.configuration.scope.kind === "folders" &&
      context.configuration.salesSubjectTerms?.some((term) =>
        subject.includes(term.toLocaleLowerCase()),
      ));
  return {
    messageRef: message.id,
    conversationRef: message.threadId,
    folderRefs: message.labelIds,
    occurredAt: new Date(occurred).toISOString(),
    relevance: excluded
      ? "unrelated"
      : native.success && from?.length === 1 && directionValid && selectedSales
        ? "sales"
        : "unknown",
    ...(native.success ? { native: native.data } : {}),
  };
}
function decodedHeader(value: string) {
  // RFC 2047 section 6.2: folding whitespace between adjacent encoded words is not display text.
  return value
    .replace(/(\?=)[ \t]+(?==\?)/g, "$1")
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (_match: string, charset: string, kind: string, data: string) => {
        try {
          const bytes =
            kind.toLowerCase() === "b"
              ? Buffer.from(data, "base64")
              : Buffer.from(
                  data
                    .replace(/_/g, " ")
                    .replace(/=([0-9a-f]{2})/gi, (_: string, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    ),
                  "binary",
                );
          return new TextDecoder(charset, { fatal: true }).decode(bytes);
        } catch {
          throw new GmailFailure("invalid_response");
        }
      },
    );
}
function plainBody(raw: unknown) {
  let count = 0;
  const read = (value: unknown, depth: number): string[] => {
    if (depth > 10 || ++count > 100) throw new GmailFailure("invalid_response");
    const part = providerValue(
      z.object({
        mimeType: z.string().min(1).max(200),
        filename: z.string().max(1024).optional(),
        headers: z.array(header).max(200).optional(),
        body: z
          .object({
            size: z.number().int().nonnegative().max(50_000_000),
            data: z
              .string()
              .max(100000)
              .regex(/^[A-Za-z0-9_-]*={0,2}$/)
              .optional(),
            attachmentId: z.string().max(256).optional(),
          })
          .optional(),
        parts: z.array(z.unknown()).max(100).optional(),
      }),
      value,
    );
    if (
      part.filename ||
      part.body?.attachmentId ||
      part.mimeType === "message/rfc822"
    )
      return [];
    if (part.mimeType.startsWith("multipart/"))
      return (part.parts ?? []).flatMap((p) => read(p, depth + 1));
    if (part.mimeType !== "text/plain" || part.body?.data === undefined)
      return [];
    const contentType =
      part.headers?.find((h) => h.name.toLowerCase() === "content-type")
        ?.value ?? "";
    const charset =
      /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? "utf-8";
    try {
      return [
        new TextDecoder(charset, { fatal: true }).decode(
          Buffer.from(part.body.data, "base64url"),
        ),
      ];
    } catch {
      throw new GmailFailure("invalid_response");
    }
  };
  const text = read(raw, 0).join("\n").trim();
  if (!text || text.length > 20000 || text.includes("\0"))
    throw new GmailFailure("invalid_response");
  return text;
}
export function gmailEvent(
  raw: unknown,
  context: MailboxSnapshot,
  expected: MailboxMetadata,
) {
  const message = providerValue(messageSchema, raw);
  const metadata = gmailMetadata(message, context);
  if (
    !isDeepStrictEqual(metadata, expected) ||
    !metadata.native ||
    metadata.relevance !== "sales"
  )
    throw new GmailFailure("invalid_response");
  const h = headers(message);
  const subject = decodedHeader(
    h.get("subject") || "Sales conversation",
  ).trim();
  if (!subject || subject.length > 500 || /[\u0000-\u001f\u007f]/.test(subject))
    throw new GmailFailure("invalid_response");
  const base = {
    eventId: message.id,
    messageRef: message.id,
    conversationRef: message.threadId,
    occurredAt: metadata.occurredAt,
    subject,
    text: plainBody(message.payload),
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
