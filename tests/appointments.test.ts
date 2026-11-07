import { microsoftFixture } from "./support/microsoft-calendar";
import { createOperationsApplication } from "../src/application/operations";
import { createOperationsRepository } from "../src/db/operations-repository";
import { createMicrosoftCalendarApplication } from "../src/application/microsoft-calendar";
import { createMicrosoftCalendarRepository } from "../src/db/microsoft-calendar-repository";
import {
  createMicrosoftCalendarProvider,
  microsoftProvenanceProperty,
} from "../src/microsoft-calendar/provider";
import { combineCalendarProviders } from "../src/appointments/providers";
import { unavailableCalendarProvider } from "../src/appointments/provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createKnowledgeApplication } from "../src/application/knowledge";
import { createKnowledgeRepository } from "../src/db/knowledge-repository";
import { createAppointmentApplication } from "../src/application/appointments";
import { createAppointmentRepository } from "../src/db/appointment-repository";
import { deterministicCalendar } from "./support/calendar";
import { createOpportunityApplication } from "../src/application/opportunity-control";
import { createOpportunityRepository } from "../src/db/opportunity-control-repository";
import { createRfqApplication } from "../src/application/rfq";
import { createRfqRepository } from "../src/db/rfq-repository";
import { createAppointmentHttp } from "../src/http/appointments";
import type { KnowledgeConfiguration } from "../src/models/knowledge";
import { bookingInquiry } from "./support/booking-inquiry";
import { googleFixture } from "./support/google-calendar";
import { createGoogleCalendarApplication } from "../src/application/google-calendar";
import { createGoogleCalendarRepository } from "../src/db/google-calendar-repository";
import { createGoogleCalendarProvider } from "../src/google-calendar/provider";

describe("Appointments through the application seam and real PostgreSQL", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  async function fixture(
    options: {
      now?: string;
      accountKind?: "google" | "microsoft_work" | "microsoft_personal";
      timing?: Record<string, unknown>;
      goal?: "booking" | "rfq";
      qualification?: KnowledgeConfiguration["qualification"];
      nativeGoogle?: boolean;
      nativeMicrosoft?: "work" | "personal";
    } = {},
  ) {
    h.clock.set(options.now ?? "2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`booking-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Consulting",
      offering: "Consultation",
      homeMarket: "US",
      website: "",
    });
    const db = runtimeDatabase(h.runtime);
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(db),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Inquiries",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await inbox.capture(credentials, business.id, connection.id, {
      eventId: "inquiry",
      messageRef: "inquiry",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Consultation",
      text: "Please arrange an appointment.",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    const opportunity = (await inbox.workspace(credentials, business.id))
      .opportunities[0];
    const opportunities = createOpportunityApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createOpportunityRepository(db, h.clock),
      clock: h.clock,
      provider: {
        channels: [],
        async dispatch() {
          throw new Error("No channel delivery");
        },
      },
    });
    await opportunities.change(credentials, business.id, opportunity.id, {
      command: "takeover",
      expectedVersion: 0,
      reason: "Arrange requested appointment",
      nextAction: "Choose a slot",
    });
    const knowledge = createKnowledgeApplication({
      authenticate: h.authenticate,
      repository: createKnowledgeRepository(db),
      clock: h.clock,
    });
    await knowledge.saveDraft(credentials, business.id, {
      expectedVersion: 0,
      configuration: {
        offerings: [{ name: "Consultation", details: "Discuss the project" }],
        answers: [],
        missingInformation: [],
        goal: options.goal ?? "booking",
        qualification: options.qualification ?? [],
        escalation: { name: "Owner", email: "owner@example.com" },
      },
      note: "Configure conversion goal",
    });
    await knowledge.approve(credentials, business.id, {
      expectedVersion: 1,
      note: "Approved",
    });
    const calendar = deterministicCalendar(business.id, h.clock);
    if (options.accountKind) {
      calendar.descriptor.accountKind = options.accountKind;
      calendar.descriptor.provider =
        options.accountKind === "google" ? "google" : "microsoft";
      calendar.descriptor.availabilityMode =
        options.accountKind === "microsoft_personal"
          ? "calendar_view"
          : "free_busy";
    }
    const google = options.nativeGoogle ? googleFixture() : null;
    const googleOptions = google
      ? {
          configuration: google.configuration,
          clock: h.clock,
          fetch: google.fetch,
        }
      : null;
    const googleApplication = googleOptions
      ? createGoogleCalendarApplication({
          database: db,
          access: h.access,
          ...googleOptions,
        })
      : null;
    let googleConnectionId: string | null = null;
    if (googleApplication) {
      const start = await googleApplication.start(credentials, business.id, {
        returnPath: `/businesses/${business.id}/calendar`,
      });
      await googleApplication.callback(credentials, business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      const selected = await googleApplication.select(
        credentials,
        business.id,
        { calendarId: "dedicated@example.com" },
      );
      googleConnectionId = selected.connectionId;
    }
    const googleRepository = googleOptions
      ? createGoogleCalendarRepository(db, googleOptions)
      : null;
    const microsoft = options.nativeMicrosoft
      ? microsoftFixture(h.clock)
      : null;
    if (microsoft && options.nativeMicrosoft === "work")
      microsoft.control.tenant = "11111111-2222-4333-8444-555555555555";
    const microsoftOptions = microsoft
      ? {
          configuration: microsoft.configuration,
          clock: h.clock,
          fetch: microsoft.fetch,
        }
      : null;
    const microsoftApplication = microsoftOptions
      ? createMicrosoftCalendarApplication({
          database: db,
          access: h.access,
          ...microsoftOptions,
        })
      : null;
    let microsoftConnectionId: string | null = null;
    if (microsoftApplication && microsoft) {
      const start = await microsoftApplication.start(credentials, business.id, {
        returnPath: `/businesses/${business.id}/calendar`,
      });
      microsoft.control.nonce = new URL(
        start.authorizationUrl,
      ).searchParams.get("nonce")!;
      await microsoftApplication.callback(credentials, business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      microsoftConnectionId = (
        await microsoftApplication.select(credentials, business.id, {
          calendarId: "primary",
        })
      ).connectionId;
    }
    const microsoftRepository = microsoftOptions
      ? createMicrosoftCalendarRepository(db, microsoftOptions)
      : null;
    const application = createAppointmentApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createAppointmentRepository(db, h.clock),
      provider: calendar.provider,
      ...(googleRepository || microsoftRepository
        ? {
            providerForTransaction: (
              tx: Parameters<typeof createGoogleCalendarProvider>[1],
            ) =>
              combineCalendarProviders(
                googleRepository
                  ? createGoogleCalendarProvider(googleRepository, tx, h.clock)
                  : unavailableCalendarProvider,
                microsoftRepository
                  ? createMicrosoftCalendarProvider(
                      microsoftRepository,
                      tx,
                      h.clock,
                    )
                  : unavailableCalendarProvider,
              ),
          }
        : {}),
      clock: h.clock,
      timeoutMs: 1000,
    });
    const configuration = {
      timeZone: "America/New_York",
      hours: [{ weekday: 4, start: "09:00", end: "12:00" }],
      durationMinutes: 30,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 5,
      slotStepMinutes: 15,
      holdSeconds: 120,
      automationEnabled: false,
      calendar: {
        connectionId:
          microsoftConnectionId ?? googleConnectionId ?? calendar.connectionId,
        calendarId: microsoftConnectionId
          ? "primary"
          : googleConnectionId
            ? "dedicated@example.com"
            : "primary",
      },
      ...options.timing,
    };
    await application.configure(credentials, business.id, {
      expectedVersion: 0,
      configuration,
      note: "Business chose all timing values",
    });
    const read = () =>
      application.read(credentials, business.id, opportunity.id);
    const slots = () =>
      application.availability(credentials, business.id, opportunity.id, {
        day: "2026-11-05",
        customerTimeZone: "Europe/London",
      });
    return {
      credentials,
      business,
      opportunity,
      db,
      inbox,
      knowledge,
      calendar,
      application,
      configuration,
      read,
      slots,
      opportunities,
      connection,
      google,
      googleApplication,
      microsoft,
      microsoftApplication,
    };
  }

  it.each(["work", "personal"] as const)(
    "books and cancels on native Microsoft %s, storing an authoritative identity and never inviting attendees",
    async (kind) => {
      const f = await fixture({ nativeMicrosoft: kind });
      expect((await f.slots()).slots.length).toBeGreaterThan(0);
      const held = await request(f);
      const booked = await f.application.book(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: held.id },
      );
      expect(booked.appointments[0]).toMatchObject({
        status: "confirmed",
        phase: "booked",
        customerNotified: false,
        event: { eventId: "immutable-1" },
      });
      const post = f.microsoft!.calls.find(
        (c) => c.method === "POST" && c.url.endsWith("/events"),
      )!;
      expect(post.body).toMatchObject({
        attendees: [],
        isReminderOn: false,
        isOnlineMeeting: false,
        start: { dateTime: "2026-11-05T14:10:00.000", timeZone: "UTC" },
        end: { dateTime: "2026-11-05T14:40:00.000", timeZone: "UTC" },
      });
      expect(post.headers.get("Prefer")).toContain('IdType="ImmutableId"');
      expect(
        f.microsoft!.calls.some((c) =>
          c.url.endsWith("/me/calendar/getSchedule"),
        ),
      ).toBe(kind === "work");
      expect(
        f.microsoft!.calls.some((c) => c.url.includes("calendarView")),
      ).toBe(true);
      await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
        appointmentId: held.id,
      });
      expect(f.microsoft!.events.size).toBe(1);
      const cancelled = await f.application.cancel(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: held.id },
      );
      expect(cancelled.appointments[0]).toMatchObject({
        status: "cancelled",
        phase: "finished",
      });
      expect(
        f
          .microsoft!.calls.find((c) => c.method === "DELETE")!
          .headers.get("If-Match"),
      ).toBe('"revision-1"');
    },
  );
  it("recovers Microsoft timeout acceptance by property lookup without another POST or transactionId query", async () => {
    const f = await fixture({ nativeMicrosoft: "personal" });
    const held = await request(f);
    f.microsoft!.control.timeoutAfterCreate = true;
    expect(
      (
        await f.application.book(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0],
    ).toMatchObject({ status: "requested", phase: "ambiguous", event: null });
    expect(
      (
        await f.application.reconcile(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0],
    ).toMatchObject({ status: "confirmed", event: { eventId: "immutable-1" } });
    expect(
      f.microsoft!.calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/events"),
      ),
    ).toHaveLength(1);
    expect(
      f
        .microsoft!.calls.filter((c) => c.method === "GET")
        .some((c) => c.url.includes("transactionId")),
    ).toBe(false);
  });
  it.each([401, 403, 429])(
    "blocks native Microsoft %i before mutation and retains safe readiness",
    async (status) => {
      const f = await fixture({ nativeMicrosoft: "work" });
      const held = await request(f);
      f.microsoft!.control.apiError = status;
      const result = await f.application.book(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: held.id },
      );
      expect(result.appointments[0]).toMatchObject({
        status: "requested",
        phase: "blocked",
        event: null,
      });
      expect(f.microsoft!.events.size).toBe(0);
      expect(
        (await f.microsoftApplication!.read(f.credentials, f.business.id))
          .status,
      ).toBe(
        status === 401
          ? "reconnect_required"
          : status === 403
            ? "insufficient"
            : "ready",
      );
    },
  );
  it("detects conflicts, duplicates and substituted Microsoft provenance without another event", async () => {
    const f = await fixture({ nativeMicrosoft: "personal" });
    const held = await request(f);
    f.microsoft!.control.timeoutAfterCreate = true;
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: held.id,
    });
    f.microsoft!.control.conflict = true;
    expect(
      (
        await f.application.reconcile(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0],
    ).toMatchObject({ phase: "conflict", status: "requested" });
    f.microsoft!.control.conflict = false;
    const event = f.microsoft!.events.get("immutable-1")!;
    f.microsoft!.events.set("duplicate", { ...event, id: "duplicate" });
    expect(
      (
        await f.application.reconcile(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0].status,
    ).toBe("requested");
    f.microsoft!.events.delete("duplicate");
    f.microsoft!.events.set("immutable-1", {
      ...event,
      singleValueExtendedProperties: [
        { id: microsoftProvenanceProperty, value: "foreign-business" },
      ],
    });
    expect(
      (
        await f.application.reconcile(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0].status,
    ).toBe("requested");
    expect(
      f.microsoft!.calls.filter(
        (c) => c.method === "POST" && c.url.endsWith("/events"),
      ),
    ).toHaveLength(1);
  });
  it("uses every personal calendarView page, expanded recurrence and conservative busy semantics, rejecting hostile continuation URLs", async () => {
    const f = await fixture({ nativeMicrosoft: "personal" });
    f.microsoft!.control.secondPage = [
      {
        id: "recurrence-exception",
        type: "exception",
        showAs: "tentative",
        isCancelled: false,
        start: { dateTime: "2026-11-05T14:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-11-05T17:00:00.0000000", timeZone: "UTC" },
      },
    ];
    expect((await f.slots()).slots).toHaveLength(0);
    f.microsoft!.control.secondPage[0].showAs = "free";
    expect((await f.slots()).slots.length).toBeGreaterThan(0);
    f.microsoft!.control.badNextLink = true;
    expect((await f.slots()).slots).toHaveLength(0);
    expect(
      f.microsoft!.calls.some(
        (c) => c.url.includes("evil.example") || c.url.includes("getSchedule"),
      ),
    ).toBe(false);
  });
  it("recovers Microsoft acceptance after failed persistence without confirming before the event is durable", async () => {
    const f = await fixture({ nativeMicrosoft: "work" });
    const held = await request(f);
    await h.admin.query(
      `CREATE FUNCTION fail_microsoft_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IS NOT NULL THEN RAISE EXCEPTION 'fixture storage unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_microsoft_retention BEFORE UPDATE ON appointment FOR EACH ROW EXECUTE FUNCTION fail_microsoft_retention()`,
    );
    try {
      await expect(
        f.application.book(f.credentials, f.business.id, f.opportunity.id, {
          appointmentId: held.id,
        }),
      ).rejects.toThrow();
    } finally {
      await h.admin.query(
        "DROP TRIGGER fail_microsoft_retention ON appointment; DROP FUNCTION fail_microsoft_retention()",
      );
    }
    expect((await f.read()).appointments[0]).toMatchObject({
      phase: "committed",
      status: "requested",
      event: null,
    });
    expect(
      (
        await f.application.reconcile(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0],
    ).toMatchObject({ status: "confirmed", phase: "booked" });
    expect(f.microsoft!.events.size).toBe(1);
  });
  it("converts an explicit Microsoft booking at the DST fold to the correct UTC payload and rejects an ambiguous wall time", async () => {
    const f = await fixture({
      nativeMicrosoft: "personal",
      now: "2026-11-01T04:00:00Z",
      timing: {
        timeZone: "UTC",
        hours: [{ weekday: 7, start: "04:00", end: "09:00" }],
        bufferBeforeMinutes: 0,
        slotStepMinutes: 30,
      },
    });
    const input = {
      requestKey: randomUUID(),
      expectedVersion: 1,
      mode: "manual",
      customerTimeZone: "America/New_York",
      localStart: "2026-11-01T01:30",
      utcOffset: null,
    };
    await expect(
      f.application.request(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        input,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const held = (
      await f.application.request(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { ...input, utcOffset: "-05:00" },
      )
    ).appointments[0];
    expect(
      (
        await f.application.book(
          f.credentials,
          f.business.id,
          f.opportunity.id,
          { appointmentId: held.id },
        )
      ).appointments[0].status,
    ).toBe("confirmed");
    expect(
      f.microsoft!.calls.find(
        (c) => c.method === "POST" && c.url.endsWith("/events"),
      )!.body,
    ).toMatchObject({
      start: { dateTime: "2026-11-01T06:30:00.000", timeZone: "UTC" },
    });
  });
  it("keeps Microsoft 409 and malformed creation ambiguous without a blind duplicate", async () => {
    for (const kind of ["conflict", "malformed"] as const) {
      const f = await fixture({ nativeMicrosoft: "personal" });
      const held = await request(f);
      if (kind === "conflict") f.microsoft!.control.createError = 409;
      else f.microsoft!.control.malformedCreate = true;
      expect(
        (
          await f.application.book(
            f.credentials,
            f.business.id,
            f.opportunity.id,
            { appointmentId: held.id },
          )
        ).appointments[0],
      ).toMatchObject({ status: "requested", phase: "ambiguous", event: null });
      await f.application.reconcile(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: held.id },
      );
      await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
        appointmentId: held.id,
      });
      expect(
        f.microsoft!.calls.filter(
          (c) => c.method === "POST" && c.url.endsWith("/events"),
        ),
      ).toHaveLength(1);
    }
  });

  it.each(["google", "microsoft"] as const)(
    "books on healthy %s when the other connected provider is unavailable",
    async (healthy) => {
      const f = await fixture({
        nativeGoogle: true,
        nativeMicrosoft: "personal",
      });
      let version = 1;
      if (healthy === "google") {
        const grant = await f.googleApplication!.read(
          f.credentials,
          f.business.id,
        );
        await f.application.configure(f.credentials, f.business.id, {
          expectedVersion: 1,
          configuration: {
            ...f.configuration,
            calendar: {
              connectionId: grant.connectionId!,
              calendarId: "dedicated@example.com",
            },
          },
          note: "Use healthy Google",
        });
        version = 2;
      }
      const held = await request(f, { expectedVersion: version });
      if (healthy === "google") f.microsoft!.control.apiError = 429;
      else f.google!.control.apiError = 503;
      expect(
        (
          await f.application.book(
            f.credentials,
            f.business.id,
            f.opportunity.id,
            { appointmentId: held.id },
          )
        ).appointments[0],
      ).toMatchObject({ status: "confirmed", phase: "booked" });
      const workspace = await f.read();
      expect(workspace.setupReason).toBeNull();
      expect(workspace.calendars).toHaveLength(1);
    },
  );
  it("cancels an unchanged native Google event expressed in the calendar offset", async () => {
    const f = await fixture({ nativeGoogle: true });
    f.google!.control.nativeOffset = true;
    const held = await request(f);
    const booked = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(booked.appointments[0].status).toBe("confirmed");
    const result = await f.application.cancel(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(result.appointments[0].status).toBe("cancelled");
    expect(f.google!.calls.filter((c) => c.method === "DELETE")).toHaveLength(
      1,
    );
  });
  it("uses the selected Google calendar timezone for all-day conflicts when Business time differs", async () => {
    const f = await fixture({ nativeGoogle: true });
    f.google!.control.timeZone = "Pacific/Kiritimati";
    const held = await request(f);
    f.google!.events.set("all-day", {
      id: "all-day",
      status: "confirmed",
      start: { date: "2026-11-06" },
      end: { date: "2026-11-07" },
    });
    const result = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(result.appointments[0]).toMatchObject({
      status: "requested",
      phase: "conflict",
      reason: "external_calendar_conflict",
    });
  });
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  it("books through native Google APIs with scoped authoritative metadata, no invites and read-only recovery after an accepted timeout", async () => {
    const f = await fixture({ nativeGoogle: true });
    const slots = await f.slots();
    expect(slots.slots).not.toHaveLength(0);
    f.google!.control.timeoutAfterCreate = true;
    const held = await request(f);
    const unknown = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(unknown.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      event: null,
    });
    const recovered = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(recovered.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "booked",
      customerNotified: false,
      event: { eventId: `a${held.intent.intentKey}` },
    });
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: held.id,
    });
    const creates = f.google!.calls.filter(
      (c) => c.method === "POST" && c.url.includes("/events?"),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0].url).toContain("sendUpdates=none");
    expect(creates[0].body).toMatchObject({
      attendees: [],
      reminders: { useDefault: false, overrides: [] },
      guestsCanInviteOthers: false,
      extendedProperties: {
        private: {
          businessId: f.business.id,
          connectionId: held.intent.connectionId,
          opportunityId: f.opportunity.id,
          appointmentId: held.id,
          intentKey: held.intent.intentKey,
        },
      },
    });
    const cancelled = await f.application.cancel(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(cancelled.appointments[0]).toMatchObject({
      status: "cancelled",
      phase: "finished",
    });
    const deleted = f.google!.calls.find((c) => c.method === "DELETE")!;
    expect(deleted.url).toContain("sendUpdates=none");
    expect(deleted.headers.get("If-Match")).toBe('"revision-1"');
  });
  it.each([401, 403, 429])(
    "blocks native Google booking on HTTP %i before creation and exposes current grant/recovery state",
    async (status) => {
      const f = await fixture({ nativeGoogle: true });
      const held = await request(f);
      f.google!.control.apiError = status;
      const result = await f.application.book(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: held.id },
      );
      expect(result.appointments[0]).toMatchObject({
        status: "requested",
        phase: "blocked",
        event: null,
        reason:
          status === 401
            ? "calendar_revoked"
            : status === 403
              ? "calendar_insufficient"
              : "calendar_rate_limited",
      });
      expect(f.google!.events.size).toBe(0);
      const connection = await f.googleApplication!.read(
        f.credentials,
        f.business.id,
      );
      expect(connection.status).toBe(
        status === 401
          ? "reconnect_required"
          : status === 403
            ? "insufficient"
            : "ready",
      );
    },
  );
  it.each(["freeBusyErrors", "malformedBusy"] as const)(
    "refuses native Google availability %s instead of inferring an empty calendar",
    async (kind) => {
      const f = await fixture({ nativeGoogle: true });
      f.google!.control[kind] = true;
      expect((await f.slots()).slots).toHaveLength(0);
      const held = await request(f);
      await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
        appointmentId: held.id,
      });
      expect(f.google!.events.size).toBe(0);
    },
  );
  it("maps native Google 409 to read-only reconciliation without retrying insert or declaring absence definitive", async () => {
    const f = await fixture({ nativeGoogle: true });
    const held = await request(f);
    f.google!.control.createError = 409;
    const result = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(result.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      reason: "calendar_conflict",
    });
    const absent = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(absent.appointments[0]).toMatchObject({
      phase: "ambiguous",
      status: "requested",
      reason: "creation_result_unknown",
    });
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: held.id,
    });
    expect(
      f.google!.calls.filter(
        (c) => c.method === "POST" && c.url.includes("/events?"),
      ),
    ).toHaveLength(1);
  });
  it("recovers native Google acceptance after a failed persistence commit without a duplicate event", async () => {
    const f = await fixture({ nativeGoogle: true });
    const held = await request(f);
    await h.admin.query(
      `CREATE FUNCTION fail_google_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IS NOT NULL THEN RAISE EXCEPTION 'fixture storage unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_google_retention BEFORE UPDATE ON appointment FOR EACH ROW EXECUTE FUNCTION fail_google_retention()`,
    );
    try {
      await expect(
        f.application.book(f.credentials, f.business.id, f.opportunity.id, {
          appointmentId: held.id,
        }),
      ).rejects.toThrow();
    } finally {
      await h.admin.query(
        "DROP TRIGGER fail_google_retention ON appointment; DROP FUNCTION fail_google_retention()",
      );
    }
    expect((await f.read()).appointments[0]).toMatchObject({
      phase: "committed",
      status: "requested",
      event: null,
    });
    const result = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(result.appointments[0]).toMatchObject({
      phase: "booked",
      status: "confirmed",
    });
    expect(f.google!.events.size).toBe(1);
    expect(
      f.google!.calls.filter(
        (c) => c.method === "POST" && c.url.includes("/events?"),
      ),
    ).toHaveLength(1);
  });
  it("validates native Google intent provenance, external conflicts and immutable history across disconnect", async () => {
    const f = await fixture({ nativeGoogle: true });
    const held = await request(f);
    f.google!.control.malformedCreate = true;
    const uncertain = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(uncertain.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      event: null,
    });
    const id = `a${held.intent.intentKey}`;
    const native = f.google!.events.get(id)!;
    f.google!.events.set(id, {
      ...native,
      extendedProperties: { private: { businessId: randomUUID() } },
    });
    const wrong = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(wrong.appointments[0].status).toBe("requested");
    expect(wrong.appointments[0].event).toBeNull();
    f.google!.events.set(id, native);
    f.google!.control.conflict = true;
    const conflict = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(conflict.appointments[0]).toMatchObject({
      status: "requested",
      phase: "conflict",
      reason: "external_calendar_conflict",
    });
    f.google!.control.conflict = false;
    const confirmed = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: held.id },
    );
    expect(confirmed.appointments[0].status).toBe("confirmed");
    await f.googleApplication!.disconnect(f.credentials, f.business.id);
    const history = await f.read();
    expect(history.appointments[0].event).toEqual(
      confirmed.appointments[0].event,
    );
    expect(history.appointments[0].history).toEqual(
      confirmed.appointments[0].history,
    );
    expect(history.calendars).toEqual([]);
    expect(f.google!.events.size).toBe(1);
  });
  async function request(f: Fixture, patch: Record<string, unknown> = {}) {
    const ids = new Set((await f.read()).appointments.map((p) => p.id));
    const state = await f.application.request(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        requestKey: randomUUID(),
        expectedVersion: 1,
        mode: "manual",
        customerTimeZone: "Europe/London",
        localStart: "2026-11-05T14:10",
        utcOffset: "+00:00",
        ...patch,
      },
    );
    return state.appointments.find((p) => !ids.has(p.id))!;
  }

  it("holds an explicit zoned request and confirms only a retained authoritative event, with one logical effect on replay", async () => {
    const f = await fixture();
    const available = await f.slots();
    expect(available.reason).toBeNull();
    expect(available.slots[0]).toMatchObject({
      startsAt: "2026-11-05T14:10:00Z",
      endsAt: "2026-11-05T14:40:00Z",
      localStart: "2026-11-05T14:10",
      utcOffset: "+00:00",
    });
    const input = {
      requestKey: randomUUID(),
      expectedVersion: 1,
      mode: "manual",
      customerTimeZone: "Europe/London",
      localStart: available.slots[0].localStart,
      utcOffset: available.slots[0].utcOffset,
    };
    const requested = await f.application.request(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      input,
    );
    expect(requested.appointments[0]).toMatchObject({
      status: "requested",
      phase: "held",
      event: null,
      holdExpiresAt: "2026-11-05T09:02:00.000Z",
    });
    expect(f.calendar.events).toHaveLength(0);
    const id = requested.appointments[0].id;
    await f.application.request(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      input,
    );
    await Promise.all(
      [1, 2].map(() =>
        f.application.book(f.credentials, f.business.id, f.opportunity.id, {
          appointmentId: id,
        }),
      ),
    );
    const confirmed = await f.read();
    expect(confirmed.appointments).toHaveLength(1);
    expect(confirmed.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "booked",
      event: {
        eventId: "event-1",
        businessId: f.business.id,
        opportunityId: f.opportunity.id,
        appointmentId: id,
        connectionId: f.calendar.connectionId,
        calendarId: "primary",
        startsAt: "2026-11-05T14:10:00Z",
      },
      customerNotified: false,
    });
    expect(f.calendar.events).toHaveLength(1);
    expect(confirmed.appointments[0].history.map((e) => e.kind)).toEqual([
      "requested",
      "committed",
      "confirmed",
    ]);
  });

  it("reconciles acceptance after timeout without another create, and keeps a hold until the ambiguity is resolved", async () => {
    const f = await fixture();
    const p = await request(f);
    const create = f.calendar.provider.create;
    f.calendar.provider.create = async (intent, signal) => {
      await create(intent, signal);
      throw new Error("private-token-and-provider-payload");
    };
    let state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      event: null,
    });
    expect(JSON.stringify(state)).not.toContain("private-token");
    const operations = createOperationsApplication({
      authenticate: h.access.authenticateForWork,
      repository: createOperationsRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      commands: { appointments: f.application },
    });
    expect(
      (await operations.workspace(f.credentials, f.business.id)).resources.find(
        (r) => r.id === p.id,
      ),
    ).toMatchObject({
      source: "appointment",
      status: "ambiguous",
      opportunityId: f.opportunity.id,
      context: { policyId: expect.any(String) },
    });
    await expect(
      operations.recover(f.credentials, f.business.id, {
        source: "appointment",
        targetId: p.id,
        action: "retry",
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.clock.set("2026-11-05T09:03:00Z");
    await h.reverifyAuthenticator(f.credentials);
    expect(
      (await f.slots()).slots.some((s) => s.startsAt === p.intent.startsAt),
    ).toBe(false);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    await operations.recover(f.credentials, f.business.id, {
      source: "appointment",
      targetId: p.id,
      action: "reconcile",
      requestKey: randomUUID(),
    });
    state = await f.read();
    expect(state.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "booked",
      event: { eventId: "event-1" },
    });
    expect(f.calendar.effects.filter((e) => e.kind === "create")).toHaveLength(
      1,
    );
  });

  it("serializes overlapping holds including buffers, expires them using the clock, and preserves the expired request", async () => {
    const f = await fixture();
    await Promise.all([
      request(f),
      request(f, { localStart: "2026-11-05T14:25" }),
    ]);
    let state = await f.read();
    expect(state.appointments.map((p) => p.phase).sort()).toEqual([
      "blocked",
      "held",
    ]);
    expect(state.appointments.find((p) => p.phase === "blocked")?.reason).toBe(
      "slot_held_or_booked",
    );
    const held = state.appointments.find((p) => p.phase === "held")!;
    h.clock.set("2026-11-05T09:02:00Z");
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: held.id,
    });
    expect(f.calendar.effects).toHaveLength(0);
    expect((await f.slots()).slots[0].startsAt).toBe("2026-11-05T14:10:00Z");
    await request(f);
    state = await f.read();
    expect(state.appointments).toHaveLength(3);
    expect(state.appointments.filter((p) => p.phase === "held")).toHaveLength(
      1,
    );
    expect(state.appointments.find((p) => p.id === held.id)?.status).toBe(
      "requested",
    );
  });

  it("checks fresh availability after an external edit and never confirms a stale offered slot", async () => {
    const f = await fixture();
    expect((await f.slots()).slots).not.toHaveLength(0);
    const p = await request(f);
    f.calendar.busy.push({
      startsAt: "2026-11-05T14:00:00Z",
      endsAt: "2026-11-05T14:11:00Z",
    });
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "blocked",
      reason: "slot_no_longer_available",
      event: null,
    });
    expect(f.calendar.effects).toHaveLength(0);
  });

  it.each(["missing", "revoked", "insufficient"] as const)(
    "blocks %s calendar grants independently of mailbox permission",
    async (grant) => {
      const f = await fixture();
      const p = await request(f);
      f.calendar.descriptor.grant = grant;
      const state = await f.application.book(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: p.id },
      );
      expect(state.appointments[0]).toMatchObject({
        status: "requested",
        phase: "blocked",
        reason: "calendar_permission_required",
      });
      expect(state.setupReason).toBe("calendar_permission_required");
      expect((await f.slots()).slots).toEqual([]);
      expect(f.calendar.effects).toEqual([]);
      expect(
        (await f.inbox.workspace(f.credentials, f.business.id)).connections[0]
          .active,
      ).toBe(true);
    },
  );

  it("does not treat an unavailable provider or malformed busy response as an empty calendar", async () => {
    const f = await fixture();
    const p = await request(f);
    f.calendar.provider.availability = async () => ({
      busy: [],
      private: "sensitive-provider-body",
    });
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      phase: "blocked",
      reason: "provider_unavailable",
    });
    expect(f.calendar.effects).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("sensitive-provider-body");
  });

  it.each(["google", "microsoft_work", "microsoft_personal"] as const)(
    "uses the configured %s capability path",
    async (accountKind) => {
      const f = await fixture({ accountKind });
      const p = await request(f);
      const state = await f.application.book(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { appointmentId: p.id },
      );
      expect(state.appointments[0].status).toBe("confirmed");
      expect(f.calendar.queries.at(-1)).toMatchObject({
        businessId: f.business.id,
        opportunityId: f.opportunity.id,
        accountKind,
        availabilityMode:
          accountKind === "microsoft_personal" ? "calendar_view" : "free_busy",
      });
    },
  );

  it("recovers a database failure after external creation by lookup, without repeating the provider mutation", async () => {
    const f = await fixture();
    const p = await request(f);
    await h.admin
      .query(`CREATE FUNCTION fail_booking_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IS NOT NULL THEN RAISE EXCEPTION 'fixture storage unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_booking_retention BEFORE UPDATE ON appointment FOR EACH ROW EXECUTE FUNCTION fail_booking_retention();`);
    try {
      await expect(
        f.application.book(f.credentials, f.business.id, f.opportunity.id, {
          appointmentId: p.id,
        }),
      ).rejects.toBeDefined();
    } finally {
      await h.admin.query(
        "DROP TRIGGER fail_booking_retention ON appointment; DROP FUNCTION fail_booking_retention()",
      );
    }
    expect((await f.read()).appointments[0]).toMatchObject({
      status: "requested",
      phase: "committed",
      event: null,
    });
    expect(f.calendar.events).toHaveLength(1);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    const state = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0].status).toBe("confirmed");
    expect(f.calendar.effects).toHaveLength(1);
  });

  it("detects post-create external conflicts, retains the event, and resolves them without a second booking", async () => {
    const f = await fixture();
    const p = await request(f);
    const create = f.calendar.provider.create;
    f.calendar.provider.create = async (intent, signal) => {
      const event = await create(intent, signal);
      f.calendar.busy.push({
        startsAt: "2026-11-05T14:15:00Z",
        endsAt: "2026-11-05T14:30:00Z",
      });
      return event;
    };
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "conflict",
      event: { eventId: "event-1" },
    });
    f.calendar.busy.length = 0;
    const resolved = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(resolved.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "booked",
      event: { eventId: "event-1" },
    });
    expect(f.calendar.events).toHaveLength(1);
  });

  it("distinguishes elapsed time from explicit attendance evidence", async () => {
    const f = await fixture();
    const p = await request(f);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    h.clock.set("2026-11-05T14:41:00Z");
    expect((await f.read()).appointments[0].status).toBe("confirmed");
    await expect(
      f.application.evidence(f.credentials, f.business.id, f.opportunity.id, {
        appointmentId: p.id,
        requestKey: randomUUID(),
        kind: "attended",
        reference: "attendance-log",
        occurredAt: "2026-11-05T14:39:00Z",
        note: "Present",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const attended = await f.application.evidence(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        appointmentId: p.id,
        requestKey: randomUUID(),
        kind: "attended",
        reference: "attendance-log",
        occurredAt: "2026-11-05T14:40:00Z",
        note: "Business confirms attendance from the meeting log",
      },
    );
    expect(attended.appointments[0]).toMatchObject({
      status: "attended",
      customerNotified: false,
    });
    expect(attended.appointments[0].history.at(-1)).toMatchObject({
      kind: "attended",
      source: "business",
      reference: "attendance-log",
    });
  });

  it("keeps cancellation requested separate from authoritative cancellation and never blindly retries it", async () => {
    const f = await fixture();
    const p = await request(f);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    const cancel = f.calendar.provider.cancel;
    f.calendar.provider.cancel = async (intent, signal) => {
      await cancel(intent, signal);
      throw new Error("private cancellation timeout");
    };
    const pending = await f.application.cancel(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(pending.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "cancel_ambiguous",
      event: { eventId: "event-1", status: "active" },
      customerNotified: false,
    });
    await f.application.cancel(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    const reconciled = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(reconciled.appointments[0]).toMatchObject({
      status: "cancelled",
      phase: "finished",
      event: { eventId: "event-1", status: "active" },
    });
    expect(reconciled.appointments[0].history.at(-1)).toMatchObject({
      kind: "cancelled",
      source: "provider",
    });
    expect(f.calendar.effects.map((e) => e.kind)).toEqual(["create", "cancel"]);
  });

  it("rechecks the actor session after the availability read and before a provider mutation", async () => {
    const f = await fixture();
    const p = await request(f);
    const actor = await h.access.authenticateForWork(f.credentials);
    const availability = f.calendar.provider.availability;
    f.calendar.provider.availability = async (query, signal) => {
      const result = await availability(query, signal);
      await h.admin.query("DELETE FROM session WHERE id = $1", [
        actor.sessionId,
      ]);
      return result;
    };
    await expect(
      f.application.book(f.credentials, f.business.id, f.opportunity.id, {
        appointmentId: p.id,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.calendar.events).toHaveLength(0);
  });

  it("rejects DST gaps and ambiguous input, and offers the correct customer local day across zones", async () => {
    const f = await fixture({
      now: "2027-03-13T09:00:00Z",
      timing: {
        hours: [{ weekday: 7, start: "00:00", end: "04:00" }],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        slotStepMinutes: 30,
      },
    });
    const slots = await f.application.availability(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { day: "2027-03-14", customerTimeZone: "America/New_York" },
    );
    expect(slots.slots.map((s) => s.localStart)).toEqual([
      "2027-03-14T00:00",
      "2027-03-14T00:30",
      "2027-03-14T01:00",
      "2027-03-14T01:30",
      "2027-03-14T03:00",
      "2027-03-14T03:30",
    ]);
    await expect(
      request(f, {
        customerTimeZone: "America/New_York",
        localStart: "2027-03-14T02:30",
        utcOffset: "-05:00",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const g = await fixture({
      now: "2027-11-06T09:00:00Z",
      timing: {
        hours: [{ weekday: 7, start: "00:00", end: "04:00" }],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        slotStepMinutes: 30,
      },
    });
    await expect(
      request(g, {
        customerTimeZone: "America/New_York",
        localStart: "2027-11-07T01:30",
        utcOffset: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const repeated = await g.application.availability(
      g.credentials,
      g.business.id,
      g.opportunity.id,
      { day: "2027-11-07", customerTimeZone: "America/New_York" },
    );
    expect(
      repeated.slots.some((s) => s.localStart === "2027-11-07T01:30"),
    ).toBe(false);
    const crossDay = await fixture();
    const nextDay = await crossDay.application.availability(
      crossDay.credentials,
      crossDay.business.id,
      crossDay.opportunity.id,
      { day: "2026-11-06", customerTimeZone: "Pacific/Auckland" },
    );
    expect(nextDay.slots[0].localStart).toBe("2026-11-06T03:10");
    expect(nextDay.slots.at(-1)?.localStart).toBe("2026-11-06T05:25");
    expect(
      nextDay.slots.every((s) => s.localStart.startsWith("2026-11-06")),
    ).toBe(true);
    await expect(
      crossDay.application.availability(
        crossDay.credentials,
        crossDay.business.id,
        crossDay.opportunity.id,
        { day: "2027-02-30", customerTimeZone: "America/New_York" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects changed replay payloads and cross-Business, cross-Opportunity and untrusted provider identities", async () => {
    const f = await fixture();
    const p = await request(f);
    const other = await fixture();
    await expect(
      f.application.read(other.credentials, f.business.id, f.opportunity.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.book(f.credentials, f.business.id, other.opportunity.id, {
        appointmentId: p.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const create = f.calendar.provider.create;
    f.calendar.provider.create = async (intent, signal) => {
      await create(intent, signal);
      return { ...f.calendar.events[0], businessId: other.business.id };
    };
    let state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      event: null,
    });
    f.calendar.provider.lookup = async () => ({
      status: "found",
      event: { ...f.calendar.events[0], connectionId: randomUUID() },
      conflicts: false,
    });
    state = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      event: null,
    });
    expect(JSON.stringify(state)).not.toContain(other.business.id);
    expect(f.calendar.effects).toHaveLength(1);
  });

  it("resolves authoritative absence, preserves history and requires a new explicit request instead of retrying creation", async () => {
    const f = await fixture();
    const p = await request(f);
    f.calendar.provider.create = async () => {
      throw new Error("uncertain transport result");
    };
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    const state = await f.application.reconcile(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "failed",
      reason: "authoritative_no_event",
      event: null,
    });
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    expect(f.calendar.effects).toHaveLength(0);
    expect((await f.slots()).slots[0].startsAt).toBe("2026-11-05T14:10:00Z");
  });

  it("stops automation on takeover and changed policy while manual authorized appointment work remains possible", async () => {
    const f = await fixture({ timing: { automationEnabled: true } });
    await f.opportunities.change(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        command: "handback",
        expectedVersion: 1,
        reason: "Return to automation",
        nextAction: "Arrange appointment",
      },
    );
    const p = await request(f, { mode: "automation" });
    await f.opportunities.change(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        command: "takeover",
        expectedVersion: 2,
        reason: "Human handling",
        nextAction: "Check booking",
      },
    );
    let state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments.find((a) => a.id === p.id)).toMatchObject({
      status: "requested",
      phase: "blocked",
      reason: "opportunity_context_changed",
    });
    const manual = await request(f);
    state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: manual.id },
    );
    expect(state.appointments.find((a) => a.id === manual.id)?.status).toBe(
      "confirmed",
    );
    expect(f.calendar.events).toHaveLength(1);
    const later = await request(f, { localStart: "2026-11-05T15:10" });
    await f.application.configure(f.credentials, f.business.id, {
      expectedVersion: 1,
      configuration: { ...f.configuration, durationMinutes: 45 },
      note: "New duration",
    });
    state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: later.id },
    );
    expect(state.appointments.find((a) => a.id === later.id)?.reason).toBe(
      "booking_policy_changed",
    );
    expect(f.calendar.events).toHaveLength(1);
  });

  it("keeps RFQ capture available without any calendar provider or grant and reports setup truthfully", async () => {
    const f = await fixture({ goal: "rfq" });
    f.calendar.provider.available = false;
    expect((await f.read()).setupReason).toBe("calendar_setup_required");
    const rfq = createRfqApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      repository: createRfqRepository(f.db, h.clock),
    });
    const before = await rfq.read(
      f.credentials,
      f.business.id,
      f.opportunity.id,
    );
    const saved = await rfq.save(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        expectedVersion: 0,
        expectedKnowledgeVersion: before.knowledgeVersion,
        expectedControlVersion: before.controlVersion,
        expectedContextKey: before.contextKey,
        requestKey: randomUUID(),
        offering: "Consultation",
        fields: [],
        note: "Buyer requests quotation instead",
        nextAction: "Prepare quotation",
      },
    );
    expect(saved.current?.status).toBe("complete");
    expect((await f.read()).appointments).toEqual([]);
    expect(f.calendar.effects).toEqual([]);
  });

  it("keeps request identity bound to the exact payload and exposes safe HTTP booking/reconciliation paths", async () => {
    const f = await fixture();
    const http = createAppointmentHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const input = {
      requestKey: randomUUID(),
      expectedVersion: 1,
      mode: "manual",
      customerTimeZone: "Europe/London",
      localStart: "2026-11-05T14:10",
      utcOffset: "+00:00",
    };
    const command = (body: unknown, origin = "http://localhost:3000") =>
      new Request("http://localhost:3000/api/appointments", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie")!,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await http.request(
          command(input, "https://untrusted.example"),
          f.business.id,
          f.opportunity.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.request(
          command({ ...input, durationMinutes: 1 }),
          f.business.id,
          f.opportunity.id,
        )
      ).status,
    ).toBe(400);
    const accepted = await http.request(
      command(input),
      f.business.id,
      f.opportunity.id,
    );
    expect(accepted.status).toBe(200);
    const p = (await f.read()).appointments[0];
    expect(
      (
        await http.request(
          command({ ...input, localStart: "2026-11-05T14:25" }),
          f.business.id,
          f.opportunity.id,
        )
      ).status,
    ).toBe(409);
    const created = await http.book(
      command({ appointmentId: p.id }),
      f.business.id,
      f.opportunity.id,
    );
    expect(created.status).toBe(200);
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    expect((await f.read()).appointments[0].status).toBe("confirmed");
    const original = f.calendar.provider.lookup;
    f.calendar.provider.lookup = async () => {
      throw new Error("provider-secret-raw-body");
    };
    expect(
      (
        await http.reconcile(
          command({ appointmentId: p.id }),
          f.business.id,
          f.opportunity.id,
        )
      ).status,
    ).toBe(200);
    expect(JSON.stringify(await f.read())).not.toContain(
      "provider-secret-raw-body",
    );
    f.calendar.provider.lookup = original;
    await http.reconcile(
      command({ appointmentId: p.id }),
      f.business.id,
      f.opportunity.id,
    );
    expect(f.calendar.effects).toHaveLength(1);
  });

  it("enforces Salesperson, current-owner, MFA and revoked membership boundaries for appointment work", async () => {
    const f = await fixture();
    const email = `booking-sales-${randomUUID()}@example.com`;
    await h.team.invite(f.credentials, f.business.id, {
      email,
      role: "salesperson",
    });
    const invitation = h.invitations.sent.at(-1)!;
    const sales = await h.signIn(email, false);
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
        "token",
      ),
    });
    const actor = await h.authenticate(sales);
    expect(
      (await f.application.read(sales, f.business.id, f.opportunity.id)).canAct,
    ).toBe(false);
    await expect(
      f.application.configure(sales, f.business.id, {
        expectedVersion: 1,
        configuration: f.configuration,
        note: "Unauthorized configuration",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.opportunities.change(sales, f.business.id, f.opportunity.id, {
      command: "takeover",
      expectedVersion: 1,
      reason: "Sales owner takes control",
      nextAction: "Book appointment",
    });
    await expect(
      f.application.availability(
        f.credentials,
        f.business.id,
        f.opportunity.id,
        { day: "2026-11-05", customerTimeZone: "UTC" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const requested = await f.application.request(
      sales,
      f.business.id,
      f.opportunity.id,
      {
        requestKey: randomUUID(),
        expectedVersion: 1,
        mode: "manual",
        customerTimeZone: "Europe/London",
        localStart: "2026-11-05T14:10",
        utcOffset: "+00:00",
      },
    );
    const p = requested.appointments[0];
    await f.application.book(sales, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    await expect(
      f.application.evidence(sales, f.business.id, f.opportunity.id, {
        appointmentId: p.id,
        requestKey: randomUUID(),
        kind: "cancelled",
        reference: "unapproved",
        occurredAt: h.clock.now().toISOString(),
        note: "Cannot attest",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.team.removeMember(f.credentials, f.business.id, {
      userId: actor.userId,
    });
    await expect(
      f.application.reconcile(sales, f.business.id, f.opportunity.id, {
        appointmentId: p.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A fresh Owner session cannot inherit another session's MFA proof.
    const ownerIdentity = await h.auth.api.getSession({
      headers: f.credentials,
    });
    const ownerPrimary = await h.signIn(ownerIdentity!.user.email, false);
    await expect(
      f.application.read(ownerPrimary, f.business.id, f.opportunity.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.calendar.effects).toHaveLength(1);
  });

  it("rechecks #19 state after durable commitment and leaves the request unconfirmed when it changed", async () => {
    const f = await fixture();
    const p = await request(f);
    const list = f.calendar.provider.listCalendars;
    let observedCommitted = false;
    f.calendar.provider.listCalendars = async (scope, signal) => {
      if (!observedCommitted) {
        const state = await h.admin.query<{ phase: string }>(
          "SELECT phase FROM appointment WHERE id = $1",
          [p.id],
        );
        observedCommitted = state.rows[0]?.phase === "committed";
        if (observedCommitted)
          await h.admin.query(
            "UPDATE inbox_opportunity SET control_version = control_version + 1 WHERE id = $1",
            [f.opportunity.id],
          );
      }
      return list(scope, signal);
    };
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(observedCommitted).toBe(true);
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "blocked",
      reason: "opportunity_context_changed",
    });
    expect(f.calendar.effects).toEqual([]);
  });

  it("bounds a hung creation and keeps an ambiguous request locked until authoritative reconciliation", async () => {
    const f = await fixture();
    const p = await request(f);
    let aborted = false;
    f.calendar.provider.create = async (_intent, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("transport aborted"));
          },
          { once: true },
        ),
      );
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(aborted).toBe(true);
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "ambiguous",
      event: null,
    });
    expect(
      (await f.slots()).slots.some((s) => s.startsAt === p.intent.startsAt),
    ).toBe(false);
  });

  it("preserves appointment history and forced RLS/restricted grants through an idempotent schema reapply", async () => {
    const f = await fixture();
    const p = await request(f);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    await h.reapplySchema();
    expect((await f.read()).appointments[0]).toMatchObject({
      id: p.id,
      status: "confirmed",
      event: { eventId: "event-1" },
    });
    const security = await h.admin.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)",
      [["booking_policy", "appointment", "appointment_history"]],
    );
    expect(security.rows).toHaveLength(3);
    expect(
      security.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    ).toBe(true);
    expect((await h.runtime.query("SELECT * FROM appointment")).rows).toEqual(
      [],
    );
    await expect(
      h.runtime.query("DELETE FROM appointment_history"),
    ).rejects.toBeDefined();
    await expect(
      h.runtime.query("UPDATE appointment SET intent = '{}'::jsonb"),
    ).rejects.toBeDefined();
  });

  it("refuses a provider event identity already retained by another appointment", async () => {
    const f = await fixture();
    const first = await request(f);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: first.id,
    });
    const later = await request(f, { localStart: "2026-11-05T15:10" });
    const create = f.calendar.provider.create;
    f.calendar.provider.create = async (intent, signal) => {
      await create(intent, signal);
      f.calendar.events[1].eventId = "event-1";
      return f.calendar.events[1];
    };
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: later.id },
    );
    expect(state.appointments.find((p) => p.id === later.id)).toMatchObject({
      status: "requested",
      event: null,
      phase: "ambiguous",
    });
    expect(
      state.appointments.filter((p) => p.status === "confirmed"),
    ).toHaveLength(1);
  });
  it("blocks automation with missing configured qualification while allowing explicit manual owner work", async () => {
    const f = await fixture({
      timing: { automationEnabled: true },
      qualification: [
        { key: "email", label: "Email", type: "email", required: true },
      ],
    });
    await f.opportunities.change(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        command: "handback",
        expectedVersion: 1,
        reason: "Permit qualified booking",
        nextAction: "Qualify buyer",
      },
    );
    const automated = await request(f, { mode: "automation" });
    expect(automated).toMatchObject({
      status: "requested",
      phase: "blocked",
      reason: "qualification_review_required",
    });
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: automated.id,
    });
    expect(f.calendar.effects).toEqual([]);
    const manual = await request(f);
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: manual.id },
    );
    expect(state.appointments.find((p) => p.id === manual.id)?.status).toBe(
      "confirmed",
    );
  });

  it("reconciles an external event introduced only inside the configured preceding buffer", async () => {
    const f = await fixture();
    const p = await request(f);
    const create = f.calendar.provider.create;
    f.calendar.provider.create = async (intent, signal) => {
      const event = await create(intent, signal);
      f.calendar.busy.push({
        startsAt: "2026-11-05T14:00:00Z",
        endsAt: "2026-11-05T14:05:00Z",
      });
      return event;
    };
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "requested",
      phase: "conflict",
      event: { eventId: "event-1" },
    });
  });
  it("uses real current inquiry qualification for automated booking and rejects a newly stale decision", async () => {
    const f = await fixture({
      timing: { automationEnabled: true },
      qualification: [
        { key: "email", label: "Email", type: "email", required: true },
      ],
    });
    await f.opportunities.change(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      {
        command: "handback",
        expectedVersion: 1,
        reason: "Ready for qualification",
        nextAction: "Process buyer details",
      },
    );
    const inquiry = await bookingInquiry(
      h,
      f.db,
      f.credentials,
      f.business.id,
      f.opportunities,
    );
    const capture = async (ref: string, text: string) => {
      await f.inbox.capture(f.credentials, f.business.id, f.connection.id, {
        eventId: ref,
        messageRef: ref,
        conversationRef: "buyer",
        senderRef: "buyer@example.net",
        senderName: "Buyer",
        subject: "Consultation",
        text,
        kind: "direct_inquiry",
        occurredAt: h.clock.now().toISOString(),
      });
      const ws = await f.inbox.workspace(f.credentials, f.business.id);
      const conversation = await f.inbox.conversation(
        f.credentials,
        f.business.id,
        ws.conversations[0].id,
      );
      return conversation.messages.find((m) => m.messageRef === ref)!;
    };
    const message = await capture("qualified", "Email: buyer@example.net");
    const result = await inquiry.process(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { messageId: message.id },
    );
    expect(result).toMatchObject({
      status: "ready",
      qualification: "qualified",
      goal: "booking",
    });
    const p = await request(f, { mode: "automation" });
    expect(p.phase).toBe("held");
    const state = await f.application.book(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments.find((a) => a.id === p.id)?.status).toBe(
      "confirmed",
    );
    await capture("new-details", "Email: invalid-address");
    const blocked = await request(f, {
      mode: "automation",
      localStart: "2026-11-05T15:10",
    });
    expect(blocked).toMatchObject({
      phase: "blocked",
      reason: "qualification_review_required",
    });
    expect(f.calendar.effects).toHaveLength(1);
  });
  it("stops cancellation when Opportunity policy changes during the final provider read", async () => {
    const f = await fixture();
    const p = await request(f);
    await f.application.book(f.credentials, f.business.id, f.opportunity.id, {
      appointmentId: p.id,
    });
    const lookup = f.calendar.provider.lookup;
    f.calendar.provider.lookup = async (intent, signal) => {
      const receipt = await lookup(intent, signal);
      await h.admin.query(
        "UPDATE inbox_opportunity SET control_version = control_version + 1 WHERE id = $1",
        [f.opportunity.id],
      );
      return receipt;
    };
    const state = await f.application.cancel(
      f.credentials,
      f.business.id,
      f.opportunity.id,
      { appointmentId: p.id },
    );
    expect(state.appointments[0]).toMatchObject({
      status: "confirmed",
      phase: "booked",
      reason: "cancellation_context_changed",
    });
    expect(f.calendar.effects.map((e) => e.kind)).toEqual(["create"]);
  });
});
