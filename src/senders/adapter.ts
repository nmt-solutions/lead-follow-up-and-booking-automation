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

export const selectSenderAdapter = (adapter: SenderAdapter, provider: string) =>
  adapter.select?.(provider) ?? adapter;
export function routeSenderAdapters(
  providers: Readonly<Record<string, SenderAdapter>>,
): SenderAdapter {
  const select = (provider: string) =>
    providers[provider] ?? unavailableSenderAdapter;
  return {
    key: "native-mail-v1",
    mode: Object.keys(providers).length ? "live" : "unconfigured",
    select,
    inspect: (context, signal) =>
      select(context.connection?.configuration.provider ?? "").inspect(
        context,
        signal,
      ),
  };
}
