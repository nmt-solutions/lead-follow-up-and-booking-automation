import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { mailboxFixture } from "./support/mailboxes";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { runtimeDatabase } from "../src/db/runtime";

describe("Actual selected pilot mailbox I/O", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  it("charges each real native call before I/O and stops remaining body reads when pilot approval is withdrawn during the first body", async () => {
    const calls: string[] = [];
    let onBody: (() => Promise<void>) | undefined;
    const external = mailboxFixture(h.clock),
      database = runtimeDatabase(h.runtime);
    const mailboxApp = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      clock: h.clock,
      provider: {
        ...external,
        inspect: async (context) => {
          calls.push("inspect");
          return external.inspect(context);
        },
        list: async (context, grant) => {
          calls.push("list");
          return external.list(context, grant);
        },
        read: async (context, metadata) => {
          calls.push("body");
          await onBody?.();
          return external.read(context, metadata);
        },
      },
    });
    let mailboxId = "";
    const s = await pilotFixture(
      h,
      { cashLimitMinor: "100", spendLimitMinor: "100", timeLimitSeconds: 100 },
      async (native) => {
        const senders = createSenderApplication({
          authenticate: h.access.authenticateForWork,
          repository: createSenderRepository(database, h.clock),
          adapter: unavailableSenderAdapter,
          clock: h.clock,
        });
        const connection = await senders.saveConnection(
          native.f.owner,
          native.f.business.id,
          {
            id: null,
            expectedVersion: 0,
            configuration: {
              label: "Actual selected fixture mailbox",
              provider: "gmail",
              account: "sales@supplier.example",
              enabled: true,
            },
          },
        );
        const mailbox = await mailboxApp.save(
          native.f.owner,
          native.f.business.id,
          {
            id: null,
            expectedVersion: 0,
            configuration: {
              connectionId: connection.id,
              requestedRead: true,
              requestedSend: false,
              enabled: true,
              scope: { kind: "folders", refs: ["sales"] },
              history: null,
            },
          },
        );
        mailboxId = mailbox.id;
        const first = await mailboxApp.queue(
          native.f.owner,
          native.f.business.id,
          mailbox.id,
          { mode: "incremental" },
        );
        await mailboxApp.execute(first);
        return {
          mailboxes: mailboxApp,
          plan: {
            capabilities: ["mailbox"],
            mailboxId: mailbox.id,
            ceilings: {
              discovery: null,
              automation: null,
              calendar: null,
              mailbox: {
                cashMinor: "1",
                spendMinor: "1",
                seconds: 1,
                globalSpendInrMicros: null,
                evidence: "fixture:approved-per-native-request-ceiling",
              },
            },
          },
          setupCost: {
            provider: "mailbox_job",
            category: "workers",
            micros: "1000",
            evidence: "fixture:actual-synthetic-prior-sync-statement",
          },
        };
      },
    );
    expect(
      (
        await s.pilots.preflight(s.f.owner, s.f.business.id, {
          pilotId: s.pilot.id,
          requestKey: randomUUID(),
        })
      ).gates.filter((g) => !g.ready),
    ).toEqual([]);
    await s.pilots.activate(s.f.owner, s.f.business.id, {
      pilotId: s.pilot.id,
      requestKey: randomUUID(),
    });
    calls.length = 0;
    external.add("first", h.clock.now().toISOString());
    external.add("second", h.clock.now().toISOString());
    onBody = async () => {
      onBody = undefined;
      await s.pilots.stop(s.f.owner, s.f.business.id, {
        pilotId: s.pilot.id,
        requestKey: randomUUID(),
      });
    };
    const work = await mailboxApp.queue(s.f.owner, s.f.business.id, mailboxId, {
      mode: "incremental",
    });
    await mailboxApp.execute(work);
    expect(calls).toEqual(["inspect", "list", "body"]);
    const view = (await s.pilots.workspace(s.f.owner, s.f.business.id))
      .pilots[0];
    expect(view.usage).toMatchObject({
      seconds: 3,
      cashMinor: "3",
      spendMinor: "3",
    });
    expect(view.status).toBe("stopped");
  });
});
