import { unavailableCalendarProvider } from "../src/appointments/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { pilotFixture } from "./support/pilot";
import { googleFixture } from "./support/google-calendar";
import { runtimeDatabase } from "../src/db/runtime";
import { createGoogleCalendarApplication } from "../src/application/google-calendar";
import { createGoogleCalendarRepository } from "../src/db/google-calendar-repository";
import { createGoogleCalendarProvider } from "../src/google-calendar/provider";
import { createAppointmentApplication } from "../src/application/appointments";
import { createAppointmentRepository } from "../src/db/appointment-repository";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createKnowledgeApplication } from "../src/application/knowledge";
import { createKnowledgeRepository } from "../src/db/knowledge-repository";

describe("Actual selected pilot native calendar operation bounds", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
  });
  afterEach(async () => h?.close());
  it("preflights Google independently of an absent Microsoft adapter and stops a real native availability operation before extra I/O when time is exhausted", async () => {
    const db = runtimeDatabase(h.runtime),
      native = googleFixture(),
      options = {
        configuration: native.configuration,
        clock: h.clock,
        fetch: native.fetch,
      };
    const google = createGoogleCalendarApplication({
        database: db,
        access: h.access,
        ...options,
      }),
      googleRepository = createGoogleCalendarRepository(db, options);
    const appointments = createAppointmentApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createAppointmentRepository(db, h.clock),
      provider: unavailableCalendarProvider,
      providerForTransaction: (tx) =>
        createGoogleCalendarProvider(googleRepository, tx, h.clock),
      clock: h.clock,
      timeoutMs: 1000,
    });
    let opportunityId = "";
    const s = await pilotFixture(
      h,
      { cashLimitMinor: "1", spendLimitMinor: "1", timeLimitSeconds: 1 },
      async (base) => {
        const b = base.f.business.id,
          c = base.f.owner;
        const start = await google.start(c, b, {
          returnPath: `/businesses/${b}/calendar`,
        });
        await google.callback(c, b, {
          state: new URL(start.authorizationUrl).searchParams.get("state"),
          code: "fixture-code",
        });
        const selected = await google.select(c, b, {
          calendarId: "dedicated@example.com",
        });
        const inbox = createInboxApplication({
          authenticate: h.authenticate,
          repository: createInboxRepository(db),
          adapter: normalizedInquiryAdapter,
          clock: h.clock,
        });
        const connection = await inbox.addConnection(c, b, {
          label: "Actual booking inquiry",
          channel: "email",
          conversationRefs: [],
          manualRepliesObservable: true,
        });
        await inbox.capture(c, b, connection.id, {
          eventId: "pilot-calendar-inquiry",
          messageRef: "pilot-calendar-inquiry",
          conversationRef: "buyer",
          senderRef: "buyer@example.net",
          senderName: "Buyer",
          subject: "Steel consultation",
          text: "Please arrange an appointment.",
          kind: "direct_inquiry",
          occurredAt: h.clock.now().toISOString(),
        });
        opportunityId = (await inbox.workspace(c, b)).opportunities[0].id;
        const opportunities = createOpportunityApplication({
          authenticate: h.authenticate,
          authenticateForWork: h.access.authenticateForWork,
          repository: createOpportunityRepository(db, h.clock),
          clock: h.clock,
          provider: {
            channels: [],
            async dispatch() {
              throw Error("No send");
            },
          },
        });
        await opportunities.change(c, b, opportunityId, {
          command: "takeover",
          expectedVersion: 0,
          reason: "Actual requested appointment",
          nextAction: "Choose an authorized slot",
        });
        const knowledge = createKnowledgeApplication({
          authenticate: h.authenticate,
          repository: createKnowledgeRepository(db),
          clock: h.clock,
        });
        await knowledge.saveDraft(c, b, {
          expectedVersion: 0,
          configuration: {
            offerings: [
              {
                name: "Steel consultation",
                details: "Discuss actual requirements",
              },
            ],
            answers: [],
            missingInformation: [],
            goal: "booking",
            qualification: [],
            escalation: { name: "Owner", email: "owner@example.com" },
          },
          note: "Fixture actual configuration",
        });
        await knowledge.approve(c, b, {
          expectedVersion: 1,
          note: "Fixture actual approval",
        });
        await appointments.configure(c, b, {
          expectedVersion: 0,
          configuration: {
            timeZone: "UTC",
            hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
              weekday,
              start: "00:00",
              end: "23:59",
            })),
            durationMinutes: 30,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
            slotStepMinutes: 30,
            holdSeconds: 120,
            automationEnabled: false,
            calendar: {
              connectionId: selected.connectionId,
              calendarId: "dedicated@example.com",
            },
          },
          note: "Explicit fixture timing",
        });
        return {
          googleCalendar: google,
          plan: {
            capabilities: ["calendar"],
            calendarProvider: "google",
            calendarConnectionId: selected.connectionId,
            calendarId: "dedicated@example.com",
            ceilings: {
              discovery: null,
              automation: null,
              mailbox: null,
              calendar: {
                cashMinor: "1",
                spendMinor: "1",
                seconds: 1,
                globalSpendInrMicros: null,
                evidence: "fixture:approved-worst-case-calendar-operation",
              },
            },
          },
          setupCost: {
            provider: "google_calendar",
            category: "workers",
            micros: "1000",
            evidence: "fixture:explicit-prior-calendar-setup-statement",
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
    const before = native.calls.length,
      query = {
        day: new Date(h.clock.now().getTime() + 86400000)
          .toISOString()
          .slice(0, 10),
        customerTimeZone: "UTC",
      };
    const available = await appointments.availability(
      s.f.owner,
      s.f.business.id,
      opportunityId,
      query,
    );
    expect(available.reason).toBeNull();
    expect(available.slots.length).toBeGreaterThan(0);
    expect(native.calls.length).toBeGreaterThan(before);
    const after = native.calls.length;
    await expect(
      appointments.availability(
        s.f.owner,
        s.f.business.id,
        opportunityId,
        query,
      ),
    ).rejects.toMatchObject({ code: "PAID_ACCESS_REQUIRED" });
    expect(native.calls).toHaveLength(after);
    const state = (await s.pilots.workspace(s.f.owner, s.f.business.id))
      .pilots[0];
    expect(state.usage).toMatchObject({
      seconds: 1,
      cashMinor: "1",
      spendMinor: "1",
    });
  });
});
