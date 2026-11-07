import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createReportingApplication } from "../src/application/reporting";
import { createReportingRepository } from "../src/db/reporting-repository";
import { createDiscoveryApplication } from "../src/application/discovery";
import { createDiscoveryRepository } from "../src/db/discovery-repository";
import {
  discoveryPolicySchema,
  type DiscoveryWork,
} from "../src/models/discovery";
import { persistPaidSubscription } from "./support/paid-subscription";
import { reportSalesFixture } from "./support/report-sales";
import { createAppointmentApplication } from "../src/application/appointments";
import { createAppointmentRepository } from "../src/db/appointment-repository";
import { deterministicCalendar } from "./support/calendar";
import { createReportingHttp } from "../src/http/reporting";

describe("Honest Business reports through the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  const application = () =>
    createReportingApplication({
      authenticate: h.access.authenticateForWork,
      repository: createReportingRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
    });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const owner = await h.signIn(`reports-${crypto.randomUUID()}@example.com`);
    const business = await h.application.createBusiness(owner, {
      name: "Steel supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    return { owner, business };
  }
  it("shows empty retained cohorts with unavailable accuracy, money and hours instead of invented zeroes", async () => {
    const { owner, business } = await fixture();
    const report = await application().read(owner, business.id, {});
    expect(report.metrics.find((m) => m.id === "contactable")).toMatchObject({
      value: 0,
      denominator: 0,
      ratio: null,
    });
    expect(
      report.metrics.find((m) => m.id === "contact_accuracy"),
    ).toMatchObject({ value: null, status: "unavailable" });
    expect(report.metrics.find((m) => m.id === "human_hours")).toMatchObject({
      value: null,
      status: "unavailable",
    });
    expect(
      report.metrics.find((m) => m.id === "discovery_actual_cost"),
    ).toMatchObject({ value: null, status: "unavailable" });
    expect(report.details).toMatchObject({
      total: 0,
      items: [],
      nextOffset: null,
    });
    expect(report.asOf).toBe("2026-11-05T09:00:00.000Z");
  });
  it("counts three canonical prospects across repeated runs, keeps contact coverage separate from accuracy and ages requests with the real report clock", async () => {
    const { owner, business } = await fixture();
    await h.application.saveConfiguration(owner, business.id, {
      offering: "Steel",
      specifications: "Sheet",
      minimumOrder: "500",
      deliveryConstraints: "US",
      serviceConstraints: "None",
      address: {
        street: "",
        locality: "Newark",
        region: "NJ",
        postalCode: "",
        country: "US",
      },
      homeMarket: "US",
      homeMarketConfirmed: true,
      additionalMarkets: [],
      buyerCategories: [
        {
          label: "Fabricators",
          identity: "organization",
          use: "business_end_user",
          requiresBuyingRequest: false,
        },
      ],
      buyersReviewed: true,
      exclusions: [],
    });
    const policy = discoveryPolicySchema.parse({
      adapterId: "reporting-fixture",
      activeMarkets: ["US"],
      coverage: [{ market: "US", source: "public_web" }],
      allowanceUnit: "fixture units",
      maxRunBudget: 12,
      searchUnits: 2,
      reviewUnits: 1,
      concurrency: 1,
      maxResults: 3,
      deadlineMs: 10000,
      permissions: {
        retainEvidence: true,
        retainQueries: false,
        displayEvidence: true,
        exportEvidence: true,
        afterCancellation: true,
        privateAiContext: true,
      },
    });
    await h.admin.query(
      "insert into discovery_configuration (business_id, policy) values ($1,$2)",
      [business.id, policy],
    );
    await persistPaidSubscription(h, owner, business.id, {
      markets: ["US"],
      discovery: { quantity: 100, unit: "fixture units" },
      automation: { quantity: 100, unit: "provider calls" },
    });
    const queued: DiscoveryWork[] = [];
    const discovery = createDiscoveryApplication({
      authenticate: h.authenticate,
      authenticateForWork: h.access.authenticateForWork,
      authenticateWork: h.access.authenticateWork,
      repository: createDiscoveryRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
      clock: h.clock,
      queue: {
        async enqueue(w) {
          queued.push(w);
        },
        async schedule() {},
      },
      provider: {
        id: policy.adapterId,
        async search(input) {
          await input.recordCost?.({
            provider: "exa",
            estimatedUsd: 0.25,
            requestId: `fixture-${input.operationId}`,
          });
          return ["open", "unknown", "expired"].map((status, i) => ({
            name: `Factory ${i}`,
            market: "US",
            url: `https://factory${i}.example/request`,
            excerpt: `We need Steel. Posted 2026-11-04. Status: ${status}. Expires 2026-11-05T09:30:00Z. ${i === 0 ? "Alice Owner is the owner. Alice Owner: alice@factory0.example" : i === 1 ? "Contact sales@factory1.example" : "No contact"}`,
          }));
        },
        async review({ source }) {
          const i = Number(source.name.slice(-1));
          const status = i === 0 ? "open" : i === 1 ? "unknown" : "expired";
          return {
            relevant: true,
            reason: "Explicit steel requirement",
            evidenceQuote: "We need Steel.",
            uncertainty: "No direct inquiry or verified accuracy",
            contacts:
              i === 0
                ? [
                    {
                      name: "Alice Owner",
                      nameQuote: "Alice Owner",
                      roleEvidence: {
                        role: "owner",
                        quote: "Alice Owner is the owner",
                      },
                      route: {
                        kind: "email",
                        value: "alice@factory0.example",
                        quote: "Alice Owner: alice@factory0.example",
                      },
                    },
                  ]
                : i === 1
                  ? [
                      {
                        name: null,
                        nameQuote: null,
                        roleEvidence: null,
                        route: {
                          kind: "email",
                          value: "sales@factory1.example",
                          quote: "Contact sales@factory1.example",
                        },
                      },
                    ]
                  : [],
            request: {
              quote: "We need Steel.",
              publishedAt: "2026-11-04",
              dateQuote: "Posted 2026-11-04",
              status,
              statusQuote: `Status: ${status}`,
              expiresAt: i === 0 ? "2026-11-05T09:30:00Z" : null,
              expiryQuote: i === 0 ? "Expires 2026-11-05T09:30:00Z" : null,
            },
          };
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      const input = {
        markets: ["US"],
        publicOffering: "Steel",
        confirmPublicQuery: true,
        budget: 8,
        requestKey: crypto.randomUUID(),
      };
      await discovery.start(owner, business.id, input);
      await discovery.start(owner, business.id, input);
      expect(await discovery.execute(queued.at(-1))).toMatchObject({
        outcome: "completed",
      });
      await discovery.execute(queued.at(-1));
    }
    const report = await application().read(owner, business.id, {
      limit: 1,
      category: "discovery",
    });
    const values = Object.fromEntries(
      report.metrics.map((m) => [m.id, m.value]),
    );
    expect(values).toMatchObject({
      observed_prospects: 3,
      new_prospects: 3,
      matched_observations: 6,
      contactable: 2,
      named_roles: 1,
      open_requests: 1,
      uncertain_requests: 1,
      expired_requests: 1,
      discovery_estimated_usd: 0.5,
    });
    expect(report.metrics.find((m) => m.id === "named_roles")).toMatchObject({
      denominator: 3,
      ratio: 1 / 3,
    });
    expect(
      report.metrics.find((m) => m.id === "direct_engagement"),
    ).toMatchObject({ value: 0 });
    expect(report.details.total).toBeGreaterThan(1);
    expect(report.details.items).toHaveLength(1);
    const all = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await application().read(owner, business.id, {
        limit: 1,
        offset,
        category: "discovery",
      });
      all.push(...page.details.items);
      offset = page.details.nextOffset;
    }
    expect(new Set(all.map((r) => r.id)).size).toBe(report.details.total);
    const workspace = await discovery.workspace(owner, business.id);
    expect(all.flatMap((r) => r.sourceIds)).toEqual(
      expect.arrayContaining(
        workspace.prospects.flatMap((p) => p.history.map((o) => o.id)),
      ),
    );
    h.clock.set("2026-11-05T10:00:00Z");
    const aged = await application().read(owner, business.id, {});
    expect(aged.metrics.find((m) => m.id === "open_requests")?.value).toBe(0);
    expect(aged.metrics.find((m) => m.id === "expired_requests")?.value).toBe(
      2,
    );
  });
  it("separates a genuine RFQ, issued quote, accepted order and confirmed sale from call notes and direct engagement", async () => {
    const f = await reportSalesFixture(h);
    const call = {
      callId: null,
      expectedVersion: 0,
      expectedControlVersion: 1,
      requestKey: crypto.randomUUID(),
      buyerId: f.need.buyerId,
      responsibleId: f.actor.userId,
      occurredAt: h.clock.now().toISOString(),
      notes: "Discussed requirements",
      outcome: "won",
      nextAction: "Verify purchase evidence",
    };
    const saved = await f.calls.save(f.owner, f.business.id, f.need.id, call);
    await f.calls.save(f.owner, f.business.id, f.need.id, {
      ...call,
      callId: saved.calls[0].id,
      expectedVersion: 1,
      expectedControlVersion: saved.controlVersion,
      requestKey: crypto.randomUUID(),
      outcome: "Correction: no completed sale yet",
    });
    let report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      direct_engagement: 1,
      confirmed_sale: 0,
      calls: 1,
      call_revisions: 2,
    });
    const current = await f.rfq.read(f.owner, f.business.id, f.need.id);
    const captured = await f.rfq.save(f.owner, f.business.id, f.need.id, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      expectedKnowledgeVersion: current.knowledgeVersion,
      expectedControlVersion: current.controlVersion,
      expectedContextKey: current.contextKey,
      offering: "Steel",
      fields: [],
      note: "Buyer requested steel quotation",
      nextAction: "Issue approved quote",
    });
    expect(captured.current?.status).toBe("complete");
    for (const action of ["quotations", "orders"] as const) {
      const context = await f.commercial.read(
        f.owner,
        f.business.id,
        f.need.id,
      );
      const proposed = await f.commercial.propose(
        f.owner,
        f.business.id,
        f.need.id,
        {
          requestKey: crypto.randomUUID(),
          replacesId: null,
          expectedContextKey: context.contextKey,
          mode: "manual",
          action,
          messageId: context.messages[0].id,
          offering: "Steel",
          description: "500 kg steel",
          grossAmount: { currency: "USD", minor: "10000" },
          discountBps: 0,
          terms: "Collection",
          note: "Reviewed exact action",
        },
      );
      const a = proposed.actions.at(-1)!;
      await f.commercial.decide(f.owner, f.business.id, f.need.id, {
        actionId: a.id,
        payloadHash: a.payloadHash,
        decision: "approved",
        note: "Approve exact terms",
      });
      for (const kind of action === "quotations"
        ? ["issued_quote"]
        : ["accepted_order", "confirmed_sale"]) {
        const input = {
          actionId: a.id,
          payloadHash: a.payloadHash,
          kind,
          reference: `${kind}-53`,
          occurredAt: h.clock.now().toISOString(),
          note: "Business verified the actual external commercial action and its exact evidence",
        };
        await f.commercial.evidence(f.owner, f.business.id, f.need.id, input);
        await f.commercial.evidence(f.owner, f.business.id, f.need.id, input);
      }
    }
    report = await application().read(f.owner, f.business.id, { limit: 1 });
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      direct_engagement: 1,
      rfqs: 1,
      complete_rfqs: 1,
      issued_quote: 1,
      accepted_order: 1,
      confirmed_sale: 1,
      calls: 1,
      call_revisions: 2,
    });
    expect(
      report.metrics.find((m) => m.id === "human_hours")?.value,
    ).toBeNull();
    expect(f.effects).toEqual([]);
    const sales = await application().read(f.owner, f.business.id, {
      category: "sales",
      limit: 50,
    });
    expect(
      sales.details.items.filter((r) => r.kind === "confirmed_sale"),
    ).toHaveLength(1);
    expect(
      sales.details.items.find((r) => r.kind === "confirmed_sale")?.sourceIds
        .length,
    ).toBe(2);
  });
  it("keeps requested, confirmed and attended appointment evidence separate through replay", async () => {
    const f = await reportSalesFixture(h);
    await f.knowledge.saveDraft(f.owner, f.business.id, {
      expectedVersion: 2,
      configuration: { ...f.configuration, goal: "booking" },
      note: "Use booking goal",
    });
    await f.knowledge.approve(f.owner, f.business.id, {
      expectedVersion: 3,
      note: "Approved",
    });
    const calendar = deterministicCalendar(f.business.id, h.clock);
    const bookings = createAppointmentApplication({
      authenticateForWork: h.access.authenticateForWork,
      repository: createAppointmentRepository(f.db, h.clock),
      provider: calendar.provider,
      clock: h.clock,
      timeoutMs: 1000,
    });
    await bookings.configure(f.owner, f.business.id, {
      expectedVersion: 0,
      note: "Approved timing",
      configuration: {
        timeZone: "America/New_York",
        hours: [{ weekday: 4, start: "09:00", end: "12:00" }],
        durationMinutes: 30,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 5,
        slotStepMinutes: 15,
        holdSeconds: 120,
        automationEnabled: false,
        calendar: {
          connectionId: calendar.connectionId,
          calendarId: "primary",
        },
      },
    });
    const request = {
      requestKey: crypto.randomUUID(),
      expectedVersion: 1,
      mode: "manual",
      customerTimeZone: "Europe/London",
      localStart: "2026-11-05T14:10",
      utcOffset: "+00:00",
    };
    const requested = await bookings.request(
      f.owner,
      f.business.id,
      f.need.id,
      request,
    );
    await bookings.request(f.owner, f.business.id, f.need.id, request);
    let report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      appointment_requests: 1,
      appointments_confirmed: 0,
      appointments_attended: 0,
    });
    const appointmentId = requested.appointments[0].id;
    await bookings.book(f.owner, f.business.id, f.need.id, { appointmentId });
    await bookings.book(f.owner, f.business.id, f.need.id, { appointmentId });
    report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      appointment_requests: 1,
      appointments_confirmed: 1,
      appointments_attended: 0,
    });
    h.clock.set("2026-11-05T14:41:00Z");
    await h.reverifyAuthenticator(f.owner);
    const evidence = {
      appointmentId,
      requestKey: crypto.randomUUID(),
      kind: "attended",
      reference: "actual-attendance",
      occurredAt: "2026-11-05T14:40:00Z",
      note: "Business verified meeting attendance",
    };
    await bookings.evidence(f.owner, f.business.id, f.need.id, evidence);
    await bookings.evidence(f.owner, f.business.id, f.need.id, evidence);
    report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      appointment_requests: 1,
      appointments_confirmed: 1,
      appointments_attended: 1,
      appointments_current_confirmed: 0,
      appointments_current_attended: 1,
      confirmed_sale: 0,
    });
    expect(calendar.effects.filter((e) => e.kind === "create")).toHaveLength(1);
  });
  it("reports opt-outs, current suppression and recorded control without calling an ordinary reply buying interest", async () => {
    const f = await reportSalesFixture(h);
    const capture = (kind: string, ref: string, text: string) =>
      f.inbox.capture(f.owner, f.business.id, f.connection.id, {
        eventId: ref,
        messageRef: ref,
        conversationRef: "buyer",
        senderRef: "buyer@example.net",
        senderName: "Buyer",
        subject: "Re: Steel",
        text,
        kind,
        occurredAt: h.clock.now().toISOString(),
      });
    await capture("other_reply", "thanks", "Thanks for the message");
    await capture("opt_out", "stop", "Please stop emailing me");
    await capture("opt_out", "stop", "Please stop emailing me");
    const report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      direct_engagement: 1,
      incoming_messages: 1,
      opt_out_messages: 1,
      email_suppressions: 1,
      human_control: 1,
      manual_replies: 0,
      response_coverage: 0,
    });
    expect(
      report.metrics.find((m) => m.id === "response_coverage")?.denominator,
    ).toBe(1);
    expect(
      report.details.items.some(
        (r) => r.kind === "next_action" && r.note === "Prepare request",
      ),
    ).toBe(true);
  });
  it("compares retained source times chronologically across explicit UTC offsets", async () => {
    const f = await reportSalesFixture(h);
    h.clock.set("2026-11-05T09:30:00Z");
    await f.inbox.capture(f.owner, f.business.id, f.connection.id, {
      eventId: "offset-inquiry",
      messageRef: "offset-inquiry",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Steel",
      text: "Please include delivery",
      kind: "direct_inquiry",
      occurredAt: "2026-11-05T08:30:00-01:00",
    });
    const report = await application().read(f.owner, f.business.id, {});
    expect(
      report.metrics.find((m) => m.id === "incoming_messages")?.value,
    ).toBe(2);
    expect(
      report.coverage.some((line) =>
        line.includes(
          "Inquiry earliest retained occurrence: 2026-11-05T09:00:00.000Z",
        ),
      ),
    ).toBe(true);
  });
  it("checks current Business membership and session assurance before aggregation and every paginated API read", async () => {
    const f = await reportSalesFixture(h);
    const outsider = await h.signIn(
      `outside-${crypto.randomUUID()}@example.com`,
    );
    await expect(
      application().read(outsider, f.business.id, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const email = `sales-${crypto.randomUUID()}@example.com`;
    await h.team.invite(f.owner, f.business.id, { email, role: "salesperson" });
    const invitation = h.invitations.sent.at(-1)!;
    const sales = await h.signIn(email, false);
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(invitation.url).hash.slice(1)).get(
        "token",
      ),
    });
    const actor = await h.authenticate(sales);
    const report = await application().read(sales, f.business.id, { limit: 1 });
    expect(
      report.metrics.find((m) => m.id === "direct_engagement")?.value,
    ).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(
      /sessionId|callbackToken|payloadHash|accountSubject|artifactSha256|platform_operator|private_envelope/,
    );
    const http = createReportingHttp({
      application: application(),
      reportFailure: () => {},
    });
    expect(
      (
        await http.get(
          new Request("http://localhost/api/reports?limit=51", {
            headers: sales,
          }),
          f.business.id,
        )
      ).status,
    ).toBe(400);
    const primaryOwner = await h.signIn(
      (await h.auth.api.getSession({ headers: f.owner }))!.user.email,
      false,
    );
    await expect(
      application().read(primaryOwner, f.business.id, {}),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await h.team.removeMember(f.owner, f.business.id, { userId: actor.userId });
    expect(
      (
        await http.get(
          new Request("http://localhost/api/reports?offset=1", {
            headers: sales,
          }),
          f.business.id,
        )
      ).status,
    ).toBe(404);
    await h.signOut(f.owner);
    await expect(
      application().read(f.owner, f.business.id, {}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("uses corrected current associations and RFQ requirements while retaining source history outside the request-created cohort", async () => {
    const f = await reportSalesFixture(h);
    const context = await f.rfq.read(f.owner, f.business.id, f.need.id);
    await f.rfq.save(f.owner, f.business.id, f.need.id, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 0,
      expectedKnowledgeVersion: context.knowledgeVersion,
      expectedControlVersion: context.controlVersion,
      expectedContextKey: context.contextKey,
      offering: "Steel",
      fields: [],
      note: "Initial request",
      nextAction: "Review commercial terms",
    });
    h.clock.set("2026-11-05T10:00:00Z");
    await f.knowledge.saveDraft(f.owner, f.business.id, {
      expectedVersion: 2,
      configuration: {
        ...f.configuration,
        qualification: [
          {
            key: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
          },
        ],
      },
      note: "Need quantity",
    });
    await f.knowledge.approve(f.owner, f.business.id, {
      expectedVersion: 3,
      note: "Approved requirement",
    });
    let report = await application().read(f.owner, f.business.id, {});
    expect(
      Object.fromEntries(report.metrics.map((m) => [m.id, m.value])),
    ).toMatchObject({
      rfqs: 1,
      complete_rfqs: 0,
      review_rfqs: 1,
      direct_engagement: 1,
    });
    const revisedContext = await f.rfq.read(f.owner, f.business.id, f.need.id);
    await f.rfq.save(f.owner, f.business.id, f.need.id, {
      requestKey: crypto.randomUUID(),
      expectedVersion: 1,
      expectedKnowledgeVersion: revisedContext.knowledgeVersion,
      expectedControlVersion: revisedContext.controlVersion,
      expectedContextKey: revisedContext.contextKey,
      offering: "Steel",
      fields: [{ key: "quantity", value: "500", messageId: null, quote: null }],
      note: "Owner reviewed quantity",
      nextAction: "Approve quotation",
    });
    const correction = await f.inbox.conversation(
      f.owner,
      f.business.id,
      f.conversation.id,
    );
    await f.inbox.associate(f.owner, f.business.id, f.conversation.id, {
      expectedVersion: correction.association.version,
      buyerId: correction.buyer.id,
      messageIds: [correction.messages[0].id],
      target: { kind: "new", title: "Correct purchasing need" },
      future: "target",
      reason: "Corrected need from original buyer evidence",
    });
    report = await application().read(f.owner, f.business.id, {});
    expect(
      report.metrics.find((m) => m.id === "direct_engagement")?.value,
    ).toBe(1);
    expect(report.metrics.find((m) => m.id === "engaged_buyers")?.value).toBe(
      1,
    );
    expect(
      report.details.items.some((r) => r.kind === "association_history"),
    ).toBe(true);
    const interval = await application().read(f.owner, f.business.id, {
      from: "2026-11-05T09:30:00Z",
      category: "sales",
      limit: 50,
    });
    expect(interval.metrics.find((m) => m.id === "rfqs")?.value).toBe(0);
    expect(
      interval.details.items.some(
        (r) => r.kind === "rfq_revision" && r.version === 2,
      ),
    ).toBe(true);
  });
  it("keeps complete counts beyond the detail page size and retains the report through populated managed schema reapplication", async () => {
    const f = await reportSalesFixture(h);
    for (let i = 0; i < 51; i++) {
      const current = await f.calls.read(f.owner, f.business.id, f.need.id);
      await f.calls.save(f.owner, f.business.id, f.need.id, {
        callId: null,
        expectedVersion: 0,
        expectedControlVersion: current.controlVersion,
        requestKey: crypto.randomUUID(),
        buyerId: f.need.buyerId,
        responsibleId: f.actor.userId,
        occurredAt: h.clock.now().toISOString(),
        notes: `Activity ${i}`,
        outcome: "Follow up",
        nextAction: "Review requirements",
      });
    }
    const report = await application().read(f.owner, f.business.id, {
      limit: 50,
      category: "activity",
    });
    expect(report.metrics.find((m) => m.id === "calls")?.value).toBe(51);
    expect(report.details.total).toBeGreaterThan(50);
    const entries = [...report.details.items];
    let offset = report.details.nextOffset;
    while (offset !== null) {
      const next = await application().read(f.owner, f.business.id, {
        limit: 50,
        category: "activity",
        offset,
      });
      entries.push(...next.details.items);
      offset = next.details.nextOffset;
    }
    expect(new Set(entries.map((r) => r.id)).size).toBe(105);
    expect(report.details.total).toBe(105);
    await h.reapplySchema();
    const restored = await application().read(f.owner, f.business.id, {
      limit: 50,
      category: "activity",
    });
    expect(restored).toEqual(report);
  });
});
