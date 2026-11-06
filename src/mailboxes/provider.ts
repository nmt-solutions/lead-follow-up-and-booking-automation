import { ApplicationError } from "../models/application-error";
import type { MailboxProvider } from "../models/mailboxes";
import type { Database } from "../db/runtime";
import type { Clock } from "../models/business";
import { configuredGmail } from "../gmail/configuration";
import { createGmailConnection } from "../gmail/connection";
import { createGmailProvider } from "../gmail/provider";
import { configuredMicrosoftMail } from "../microsoft-mail/configuration";
import { createMicrosoftMailConnection } from "../microsoft-mail/connection";
import { createMicrosoftMailProvider } from "../microsoft-mail/provider";

/** An unconfigured provider never invents an effective grant. */
export const unavailableMailboxProvider: MailboxProvider = {
  key: "mailbox-unconfigured",
  mode: "unconfigured",
  async inspect() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
  async list() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
  async read() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
};

/** Shared web/Trigger composition routes each immutable mailbox identity to its native adapter. */
export function createNativeMailboxProvider(
  database: Database,
  options: {
    clock: Clock;
    env: Readonly<Record<string, string | undefined>>;
    fetch: typeof fetch;
  },
): MailboxProvider {
  const providers = {
    gmail: createGmailProvider(
      createGmailConnection(database, {
        clock: options.clock,
        configuration: configuredGmail(options.env),
        fetch: options.fetch,
      }),
      options.clock,
    ),
    microsoft: createMicrosoftMailProvider(
      createMicrosoftMailConnection(database, {
        clock: options.clock,
        configuration: configuredMicrosoftMail(options.env),
        fetch: options.fetch,
      }),
      options.clock,
    ),
  };
  return {
    key: "native-mailboxes-v1",
    mode: Object.values(providers).some((p) => p.mode === "live")
      ? "live"
      : "unconfigured",
    inspect: (c, signal) => providers[c.provider].inspect(c, signal),
    list: (c, grant, signal) => providers[c.provider].list(c, grant, signal),
    read: (c, metadata, signal) =>
      providers[c.provider].read(c, metadata, signal),
  };
}
