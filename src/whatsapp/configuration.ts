import { z } from "zod";
import type { Clock } from "../models/business";
import { metaIdSchema } from "../models/whatsapp";
import { calendarCredentialVault } from "../appointments/credentials";
import { createMetaCloudProvider } from "./cloud";
import { unavailableMetaProvider } from "./provider";

const secure = z.object({
  appId: metaIdSchema,
  appSecret: z.string().min(1),
  configId: metaIdSchema,
  graphVersion: z.string().regex(/^v[0-9]{2,3}\.0$/),
  activeKeyId: z.string().min(1).max(80),
  keys: z.record(z.string(), z.string().regex(/^[a-fA-F0-9]{64}$/)),
});
export type MetaConfiguration = z.infer<typeof secure>;
/** Independent, explicit launch gates. Other Meta integrations never activate WhatsApp. */
export function configuredMetaCloud(
  env: Readonly<Record<string, string | undefined>>,
  fetcher: typeof fetch,
  clock: Clock,
) {
  let keys: unknown;
  try {
    keys = JSON.parse(env.META_TOKEN_KEYS ?? "{}");
  } catch {
    keys = null;
  }
  const parsed = secure.safeParse({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    configId: env.META_LOGIN_CONFIG_ID,
    graphVersion: env.META_GRAPH_VERSION,
    activeKeyId: env.META_TOKEN_KEY_ID,
    keys,
  });
  const secureConfiguration =
    parsed.success && Boolean(parsed.data.keys[parsed.data.activeKeyId]);
  const gates = {
    techProvider: env.META_TECH_PROVIDER_APPROVED === "true",
    businessVerification: env.META_BUSINESS_VERIFIED === "true",
    appReview: env.META_APP_REVIEW_APPROVED === "true",
    liveApp: env.META_APP_LIVE === "true",
    secureConfiguration,
    coexistence: env.META_COEXISTENCE_ONBOARDING_APPROVED === "true",
  };
  const configured =
    gates.techProvider &&
    gates.businessVerification &&
    gates.appReview &&
    gates.liveApp &&
    gates.secureConfiguration;
  const setup = { ...gates, configured };
  if (!parsed.success || !configured)
    return { provider: { ...unavailableMetaProvider, setup }, vault: null };
  return {
    provider: {
      ...createMetaCloudProvider(parsed.data, setup, fetcher, clock),
      sendingAvailable: true,
      outboundWorkerReady:
        env.META_OUTBOUND_WORKER_DEPLOYMENT_CONFIRMED === "true",
    },
    vault: calendarCredentialVault(parsed.data),
  };
}
