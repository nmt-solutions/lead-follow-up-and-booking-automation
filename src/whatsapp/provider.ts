import type {
  WhatsAppSetup,
  MetaToken,
  MetaAssets,
  WhatsAppConfiguration,
} from "../models/whatsapp";
import { ApplicationError } from "../models/application-error";

export class MetaFailure extends Error {
  constructor(
    readonly reason:
      | "revoked"
      | "insufficient_permissions"
      | "provider_unavailable"
      | "invalid_response",
  ) {
    super(reason);
  }
}

export type MetaProvider = {
  key: string;
  setup: WhatsAppSetup;
  login?: { appId: string; configId: string; graphVersion: string };
  subscribe?(
    token: MetaToken,
    assets: MetaAssets,
    signal: AbortSignal,
  ): Promise<void>;
  exchange(code: string, signal: AbortSignal): Promise<unknown>;
  inspect(
    token: MetaToken,
    assets: MetaAssets,
    configuration: WhatsAppConfiguration,
    coexistenceFinished: boolean,
    signal: AbortSignal,
  ): Promise<unknown>;
  register(
    token: MetaToken,
    assets: MetaAssets,
    pin: string,
    signal: AbortSignal,
  ): Promise<void>;
};
export const unavailableMetaProvider: MetaProvider = {
  key: "unconfigured-meta-cloud",
  setup: {
    configured: false,
    techProvider: false,
    businessVerification: false,
    appReview: false,
    liveApp: false,
    secureConfiguration: false,
    coexistence: false,
  },
  async exchange() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
  async inspect() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
  async register() {
    throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  },
};
