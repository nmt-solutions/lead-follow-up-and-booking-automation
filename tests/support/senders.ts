import { createSenderApplication } from "../../src/application/senders";
import { createSenderRepository } from "../../src/db/sender-repository";
import { runtimeDatabase } from "../../src/db/runtime";
import type {
  SenderAdapter,
  SenderCheck,
  SenderInspection,
  SenderUse,
  SenderIdentityConfiguration,
} from "../../src/models/senders";
import type { createHarness } from "./harness";

export const fixtureMailBinding = {
  adapterKey: "deterministic-mail-v1",
  mode: "fixture" as const,
};
export function senderFixture(h: Awaited<ReturnType<typeof createHarness>>) {
  const fixture = {
    changes: {} as Partial<
      Record<
        | "identity_control"
        | "domain_verification"
        | "spf"
        | "dkim"
        | "dmarc_alignment"
        | "sending_grant"
        | "delivery_transport"
        | "reply_reading_grant"
        | "inbox_sync"
        | "reply_capture"
        | "health",
        SenderCheck
      >
    >,
    approvedUses: [
      "first_contact",
      "trial",
      "inbound",
      "existing_conversation",
    ] as SenderUse[],
    intercept: async (context: SenderInspection): Promise<void> => {
      void context;
    },
  };
  const adapter: SenderAdapter = {
    key: fixtureMailBinding.adapterKey,
    mode: "fixture",
    async inspect(context) {
      await fixture.intercept(context);
      return {
        binding: context.binding,
        observedAt: h.clock.now().toISOString(),
        validUntil: new Date(h.clock.now().getTime() + 3600000).toISOString(),
        approvedUses: fixture.approvedUses,
        checks: {
          identity_control: "pass",
          domain_verification: "pass",
          spf: "pass",
          dkim: "pass",
          dmarc_alignment: "pass",
          sending_grant: "pass",
          delivery_transport: "pass",
          reply_reading_grant: "pass",
          inbox_sync: "pass",
          reply_capture: "pass",
          health: "pass",
          ...fixture.changes,
        },
      };
    },
  };
  const app = createSenderApplication({
    authenticate: h.access.authenticateForWork,
    repository: createSenderRepository(runtimeDatabase(h.runtime), h.clock),
    clock: h.clock,
    adapter,
  });
  return { app, adapter, fixture };
}

/** Real setup and persisted adapter observations; no mail/OAuth/DNS effects. */
export async function readySender(
  h: Awaited<ReturnType<typeof createHarness>>,
  credentials: Headers,
  businessId: string,
  inboxConnectionId: string,
  overrides: Partial<SenderIdentityConfiguration> = {},
  mailboxProvider: "gmail" | "microsoft" = "gmail",
) {
  const f = senderFixture(h);
  const origin = overrides.origin ?? "customer_mailbox";
  const account = overrides.fromAddress ?? "sales@supplier.example";
  const connection = await f.app.saveConnection(credentials, businessId, {
    id: null,
    expectedVersion: 0,
    configuration: {
      label: "Deterministic mail connection",
      provider: origin === "customer_mailbox" ? mailboxProvider : origin,
      account,
      enabled: true,
    },
  });
  const route = await f.app.saveReplyRoute(credentials, businessId, {
    id: null,
    expectedVersion: 0,
    configuration: {
      address: account,
      connectionId: connection.id,
      inboxConnectionId,
      enabled: true,
    },
  });
  const identity = await f.app.saveIdentity(credentials, businessId, {
    id: null,
    expectedVersion: 0,
    configuration: {
      origin,
      purpose: "ordinary_sales",
      fromAddress: account,
      displayName: "Sales team",
      uses: ["inbound", "existing_conversation"],
      connectionId: connection.id,
      replyRouteId: route.id,
      enabled: true,
      ...overrides,
    },
  });
  await f.app.check(credentials, businessId, identity.id, {
    expectedVersion: identity.version,
  });
  return { ...f, identity, connection, route };
}
