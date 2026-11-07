import { dataPolicySchema } from "../models/data-governance";
import { exaActivationSchema } from "../models/exa";
import { readFilesConfiguration } from "../storage/configuration";
import { configuredGmail } from "../gmail/configuration";
import { configuredGoogleCalendar } from "../google-calendar/configuration";
import { createDataRevoker } from "./data-revoker";
import { configuredMetaCloud } from "../whatsapp/configuration";
import { z } from "zod";

/** Operator/deployment-owned input. Business requests cannot approve legal rights. */
export function configuredDataGovernance(
  environment: NodeJS.ProcessEnv,
  mode: "live" | "test",
  fetcher: typeof fetch = fetch,
) {
  const files = readFilesConfiguration(environment);
  const policy = () => {
    try {
      const p = dataPolicySchema.parse(
        JSON.parse(environment.BUSINESS_DATA_POLICY_JSON ?? "null"),
      );
      if (
        p.mode !== mode ||
        !files.policy ||
        p.storageScope !== files.policy.accountScope ||
        environment.BUSINESS_DATA_WORKER_DEPLOYMENT_CONFIRMED !== "true" ||
        !environment.TRIGGER_BUSINESS_DATA_CRON
      )
        return null;
      const activation = exaActivationSchema.safeParse(
        JSON.parse(environment.EXA_ACTIVATION_JSON ?? "null"),
      );
      // Retained exports do not require a live API credential, but require the
      // current executed order and its original source-rights evidence route.
      p.sourceRights = p.sourceRights.filter(
        (r) =>
          (r.adapterId !== "exa-search-contents-v1" &&
            !r.adapterId.startsWith("exa")) ||
          (activation.success &&
            r.scopeRef === activation.data.scopeRef &&
            activation.data.permissions.customerExport &&
            activation.data.permissions.afterCancellation),
      );
      return p;
    } catch {
      return null;
    }
  };
  let meta = null;
  try {
    const gates = configuredMetaCloud(environment, fetcher, {
      now: () => new Date(),
    });
    if (gates.vault)
      meta = z
        .object({
          appId: z.string().regex(/^[0-9]{1,40}$/),
          appSecret: z.string().min(1),
          configId: z.string().regex(/^[0-9]{1,40}$/),
          graphVersion: z.string().regex(/^v[0-9]{2,3}\.0$/),
          activeKeyId: z.string(),
          keys: z.record(z.string(), z.string().regex(/^[a-fA-F0-9]{64}$/)),
        })
        .parse({
          appId: environment.META_APP_ID,
          appSecret: environment.META_APP_SECRET,
          configId: environment.META_LOGIN_CONFIG_ID,
          graphVersion: environment.META_GRAPH_VERSION,
          activeKeyId: environment.META_TOKEN_KEY_ID,
          keys: JSON.parse(environment.META_TOKEN_KEYS ?? "null"),
        });
  } catch {
    /* Native setup remains visibly incomplete. */
  }
  return {
    storageScope: files.policy?.accountScope,
    policy,
    storage: files.storage,
    revoke: createDataRevoker({
      fetch: fetcher,
      gmail: configuredGmail(environment),
      google: configuredGoogleCalendar(environment),
      meta,
    }),
  };
}
