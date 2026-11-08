import { createHarness } from "./harness";
import { pilotFixture } from "./pilot";
import { gmailFixture } from "./gmail";
import { runtimeDatabase } from "../../src/db/runtime";
import { createSenderApplication } from "../../src/application/senders";
import { createSenderRepository } from "../../src/db/sender-repository";
import { unavailableSenderAdapter } from "../../src/senders/adapter";
import { createMailboxApplication } from "../../src/application/mailboxes";
import { createMailboxRepository } from "../../src/db/mailbox-repository";
import { createGmailApplication } from "../../src/application/gmail";
import { createGmailConnection } from "../../src/gmail/connection";
import { createGmailProvider } from "../../src/gmail/provider";

export async function pilotSetupFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  synchronize = true,
  includeDiscovery = false,
) {
  const google = gmailFixture(),
    database = runtimeDatabase(h.runtime),
    connection = createGmailConnection(database, {
      clock: h.clock,
      configuration: google.configuration,
      fetch: google.fetch,
    }),
    gmail = createGmailApplication({ access: h.access, connection }),
    mailboxes = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      clock: h.clock,
      provider: createGmailProvider(connection, h.clock),
      enqueue: async () => {},
    });
  let mailboxId = "";
  const s = await pilotFixture(
    h,
    {
      cashLimitMinor: "100",
      spendLimitMinor: "100",
      timeLimitSeconds: 100,
    },
    async (native) => {
      const senders = createSenderApplication({
        authenticate: h.access.authenticateForWork,
        repository: createSenderRepository(database, h.clock),
        adapter: unavailableSenderAdapter,
        clock: h.clock,
      });
      const sender = await senders.saveConnection(
        native.f.owner,
        native.f.business.id,
        {
          id: null,
          expectedVersion: 0,
          configuration: {
            label: "Selected native Gmail",
            provider: "gmail",
            account: google.control.email,
            enabled: true,
          },
        },
      );
      const mailbox = await mailboxes.save(
        native.f.owner,
        native.f.business.id,
        {
          id: null,
          expectedVersion: 0,
          configuration: {
            connectionId: sender.id,
            requestedRead: true,
            requestedSend: false,
            enabled: true,
            scope: { kind: "folders", refs: ["Label_sales"] },
            salesSubjectTerms: ["inquiry"],
            history: null,
          },
        },
      );
      mailboxId = mailbox.id;
      const start = await gmail.start(
        native.f.owner,
        native.f.business.id,
        mailboxId,
      );
      await gmail.callback(native.f.owner, native.f.business.id, mailboxId, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      if (synchronize) {
        const work = await mailboxes.queue(
          native.f.owner,
          native.f.business.id,
          mailboxId,
          { mode: "incremental" },
        );
        let result = await mailboxes.execute(work);
        for (let page = 0; page < 6 && result?.status === "partial"; page++)
          result = await mailboxes.execute(work);
        if (result?.status !== "completed")
          throw new Error(
            "Initial native mailbox fixture did not become current",
          );
      }
      return {
        mailboxes,
        plan: {
          capabilities: includeDiscovery
            ? ["discovery", "mailbox"]
            : ["mailbox"],
          mailboxId,
          ceilings: {
            discovery: includeDiscovery
              ? {
                  cashMinor: "1",
                  spendMinor: "1",
                  seconds: 1,
                  globalSpendInrMicros: null,
                  evidence: "fixture:bounded-discovery",
                }
              : null,
            automation: null,
            calendar: null,
            mailbox: {
              cashMinor: "1",
              spendMinor: "1",
              seconds: 1,
              globalSpendInrMicros: null,
              evidence: "fixture:bounded-native-read",
            },
          },
        },
        ...(synchronize
          ? {
              setupCost: {
                provider: "mailbox_job",
                category: "workers" as const,
                micros: "1000",
                evidence: "fixture:prior-native-sync",
              },
            }
          : {}),
      };
    },
  );
  return {
    ...s,
    mailboxes,
    mailboxId,
    gmail,
    google,
    mailboxesFor: (database: ReturnType<typeof runtimeDatabase>) =>
      createMailboxApplication({
        authenticate: h.access.authenticateForWork,
        repository: createMailboxRepository(database, h.clock),
        clock: h.clock,
        provider: createGmailProvider(
          createGmailConnection(database, {
            clock: h.clock,
            configuration: google.configuration,
            fetch: google.fetch,
          }),
          h.clock,
        ),
        enqueue: async () => {},
      }),
  };
}
