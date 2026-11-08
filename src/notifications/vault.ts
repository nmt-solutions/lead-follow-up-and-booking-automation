import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  nativeMailSchema,
  type NativeNotificationMail,
} from "../models/notifications";
import { ApplicationError } from "../models/application-error";

/** Only the delivery claim may decrypt this limited-life, purpose-bound payload. */
export function notificationVault(options: {
  activeKey: string;
  keys: Record<string, Uint8Array>;
}) {
  const envelope = z.object({
    v: z.literal(1),
    kid: z.string(),
    iv: z.string(),
    tag: z.string(),
    data: z.string(),
  });
  const content = z.object({ expiresAt: z.number(), mail: nativeMailSchema });
  return {
    seal(mail: NativeNotificationMail, binding: string, expiresAt: Date) {
      const key = options.keys[options.activeKey];
      if (key?.byteLength !== 32) throw new ApplicationError("SETUP_REQUIRED");
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(binding));
      const data = Buffer.concat([
        cipher.update(JSON.stringify({ expiresAt: expiresAt.getTime(), mail })),
        cipher.final(),
      ]);
      return JSON.stringify({
        v: 1,
        kid: options.activeKey,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        data: data.toString("base64url"),
      });
    },
    open(sealed: string, binding: string, now: Date) {
      try {
        const value = envelope.parse(JSON.parse(sealed)),
          key = options.keys[value.kid];
        if (key?.byteLength !== 32) throw new Error("Unavailable key");
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(value.iv, "base64url"),
        );
        decipher.setAAD(Buffer.from(binding));
        decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
        const decoded = content.parse(
          JSON.parse(
            Buffer.concat([
              decipher.update(Buffer.from(value.data, "base64url")),
              decipher.final(),
            ]).toString("utf8"),
          ),
        );
        if (decoded.expiresAt <= now.getTime()) throw new Error("Expired");
        return decoded.mail;
      } catch {
        throw new ApplicationError("CONFLICT");
      }
    },
  };
}
