import { ApplicationError } from "../models/application-error";
import type { OpportunityActionProvider } from "../models/opportunity-control";
export function routeOpportunityMail(
  providers: OpportunityActionProvider[],
): OpportunityActionProvider {
  const unavailable: OpportunityActionProvider = {
    channels: [],
    async dispatch() {
      throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    },
  };
  const byKey = new Map(providers.map((p) => [p.emailIdentity?.adapterKey, p]));
  if (byKey.size !== providers.length || byKey.has(undefined))
    throw new ApplicationError("INVALID_INPUT");
  const selectEmail = (key: string) => byKey.get(key) ?? unavailable;
  return {
    channels: providers.length ? ["email"] : [],
    selectEmail,
    dispatch: (a, s, access) =>
      selectEmail(a.email?.adapterKey ?? "").dispatch(a, s, access),
  };
}
