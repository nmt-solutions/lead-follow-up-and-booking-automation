import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { MailEnvelope } from "../models/mail-dispatch";

const encoded = (value: string) => {
  // RFC 2047 encoded words, each below 75 characters, without splitting UTF-8 code points.
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c).toString("base64")}?=`)
    .join("\r\n ");
};
export function rawMessage(
  e: MailEnvelope,
  previous: { internetMessageId: string } | null,
) {
  for (const address of [e.fromAddress, e.recipient, e.replyTo])
    if (!z.email().safeParse(address).success || /[\r\n]/.test(address))
      throw new ApplicationError("INVALID_INPUT");
  if (
    [e.fromName, e.subject].some((v) => /[\u0000-\u001f\u007f]/.test(v)) ||
    !/^<[^<>\s@]+@[^<>\s@]+>$/.test(e.internetMessageId) ||
    (previous && !/^<[^<>\s@]+@[^<>\s@]+>$/.test(previous.internetMessageId))
  )
    throw new ApplicationError("INVALID_INPUT");
  const body = e.body.replace(/\r\n|\r|\n/g, "\r\n");
  return Buffer.from(
    [
      `From: ${encoded(e.fromName)} <${e.fromAddress}>`,
      `To: ${e.recipient}`,
      `Reply-To: ${e.replyTo}`,
      `Subject: ${encoded(e.subject)}`,
      `Message-ID: ${e.internetMessageId}`,
      `Date: ${new Date(e.reservedAt).toUTCString()}`,
      `X-Platform-Disclosure: ${encoded(e.platformDisclosure)}`,
      ...(previous
        ? [
            `In-Reply-To: ${previous.internetMessageId}`,
            `References: ${previous.internetMessageId}`,
          ]
        : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body)
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "",
      "",
    ].join("\r\n"),
  ).toString("base64url");
}
