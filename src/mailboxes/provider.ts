import { ApplicationError } from "../models/application-error";
import type { MailboxProvider } from "../models/mailboxes";

/** Native Gmail/Graph OAuth, metadata filtering and sync adapters arrive in #29/#30. */
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
