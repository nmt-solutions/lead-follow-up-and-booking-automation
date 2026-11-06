import type { SenderAdapter } from "../models/senders";
import { ApplicationError } from "../models/application-error";

/** Selection is configuration only. No mail transport, OAuth or DNS provider is activated here. */
export const unavailableSenderAdapter: SenderAdapter = {
  key: "mail-unconfigured-v1",
  mode: "unconfigured",
  async inspect() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
};
