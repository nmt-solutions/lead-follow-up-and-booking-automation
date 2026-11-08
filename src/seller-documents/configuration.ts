import { readFilesConfiguration } from "../storage/configuration";

export function configuredSellerDocumentStorage(
  env: Record<string, string | undefined>,
) {
  const configured = readFilesConfiguration(env);
  if (
    !configured.policy ||
    !configured.storage ||
    env.SELLER_DOCUMENT_STORAGE_PROTECTED_CONFIRMED !== "true"
  )
    return { storage: null, policy: null };
  return {
    storage: configured.storage,
    policy: {
      accountScope: configured.policy.accountScope,
      maxBytes: configured.policy.maxBytes,
      accessTtlSeconds: configured.policy.accessTtlSeconds,
      recoveryLeaseSeconds:
        configured.policy.operationTimeoutSeconds +
        configured.policy.cleanupGraceSeconds,
    },
  };
}
