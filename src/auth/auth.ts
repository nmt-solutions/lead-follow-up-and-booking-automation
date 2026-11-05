import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { magicLink } from "better-auth/plugins/magic-link";
import type { Database } from "../db/runtime";
import * as schema from "../db/schema";

export type SignInMail = { email: string; url: string };
export type SignInMailer = { send(message: SignInMail): Promise<void> };

export function createAuth(options: {
  database: Database;
  baseURL: string;
  secret: string;
  mailer: SignInMailer;
}) {
  return betterAuth({
    appName: "Business profile",
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(options.database, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    trustedOrigins: [new URL(options.baseURL).origin],
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    logger: { disabled: true },
    plugins: [
      magicLink({
        expiresIn: 600,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: ({ email, url }) => options.mailer.send({ email, url }),
      }),
    ],
  });
}
