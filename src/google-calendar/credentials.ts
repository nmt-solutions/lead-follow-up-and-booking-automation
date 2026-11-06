import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { GoogleCalendarConfiguration } from "./configuration";
import { ApplicationError } from "../models/application-error";

const envelope = z.object({
  keyId: z.string(),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});
export function googleCredentialVault(
  configuration: GoogleCalendarConfiguration,
) {
  return {
    encrypt(value: string, context: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(configuration.keys[configuration.activeKeyId], "hex"),
        iv,
      );
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return JSON.stringify({
        keyId: configuration.activeKeyId,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      });
    },
    decrypt(value: string, context: string): string {
      try {
        const v = envelope.parse(JSON.parse(value));
        const key = configuration.keys[v.keyId];
        if (!key) throw new Error();
        const cipher = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(key, "hex"),
          Buffer.from(v.iv, "base64"),
        );
        cipher.setAAD(Buffer.from(context));
        cipher.setAuthTag(Buffer.from(v.tag, "base64"));
        return Buffer.concat([
          cipher.update(Buffer.from(v.data, "base64")),
          cipher.final(),
        ]).toString("utf8");
      } catch {
        throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
      }
    },
  };
}
