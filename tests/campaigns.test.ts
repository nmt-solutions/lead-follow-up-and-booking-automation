import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { campaignFixture } from "./support/campaigns";
import { eligibilityApplication } from "./support/email-eligibility";
import { createCampaignHttp } from "../src/http/campaigns";
import {
  campaignWorkspaceSchema,
  campaignReviewSchema,
} from "../src/models/campaigns";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { defaultCommercialPolicy } from "../src/models/commercial-authority";
import { configurationDetailsSchema } from "../src/models/configuration";

describe("Bounded first-outreach approval at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("reloads an immutable attributed approval of exact recipients, evidence and sequence without sending", async () => {
    const f = await campaignFixture(h);
    const effects = h.mail.sent.length;
    const saved = await f.app.save(f.owner, f.business.id, f.draft());
    const revision = saved.campaigns[0].revisions[0];
    expect(revision.snapshot.recipients[0]).toMatchObject({
      address: "purchasing@fabricator.example",
      contactStatus: "general_business_contact",
      prospect: {
        relationship: "potential_buyer",
        uncertainty: "Purchasing role and timing unconfirmed",
      },
    });
    const approved = await f.app.decide(f.owner, f.business.id, {
      ...f.ref(revision),
      decision: "approved",
      note: "Reviewed the exact evidence and bounded plan",
    });
    expect(approved.campaigns[0].revisions[0].decision).toMatchObject({
      decision: "approved",
      actorId: (await h.authenticate(f.owner)).userId,
      at: "2026-11-05T09:00:00.000Z",
    });
    const reloaded = await f.newApplication().workspace(f.owner, f.business.id);
    expect(reloaded.campaigns[0].revisions[0].snapshot).toEqual(
      revision.snapshot,
    );
    expect(reloaded.campaigns[0].revisions[0].snapshot.steps).toEqual([
      {
        subject: "Steel supply",
        body: "We supply galvanized steel. Is this relevant to your business?",
        delayMinutes: 0,
      },
      {
        subject: "Steel supply follow-up",
        body: "Would you like our product specification?",
        delayMinutes: 2880,
      },
    ]);
    expect(reloaded.campaigns[0].revisions[0].snapshot.maxAttempts).toBe(2);
    expect(h.mail.sent).toHaveLength(effects);
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).conversations,
    ).toEqual([]);
    expect(f.queued).toEqual([]);
  });

  it("keeps approval distinct from current eligibility and consumes only the exact approved identity and step", async () => {
    const f = await campaignFixture(h);
    const saved = await f.app.save(f.owner, f.business.id, f.draft());
    const r = saved.campaigns[0].revisions[0];
    const recipient = r.snapshot.recipients[0];
    const input = {
      ...f.ref(r),
      recipient: {
        prospectId: recipient.prospectId,
        contactId: recipient.contactId,
        address: recipient.address,
      },
      stepIndex: 0,
    };
    await expect(
      f.app.inspect(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Reviewed",
    });
    const inspection = await f.app.inspect(f.owner, f.business.id, input);
    expect(inspection.approval.decision).toBe("approved");
    expect(inspection.eligibility.status).toBe("unknown");
    expect(inspection.eligibility.purpose).toBe("sales_outreach");
    expect(inspection.eligibility.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "permission", status: "unknown" }),
      ]),
    );
    expect(inspection.current.authority.status).toBe("allowed");
    expect(inspection.execution).toEqual({
      configured: false,
      state: "not_scheduled",
    });
    await expect(
      f.app.inspect(f.owner, f.business.id, {
        ...input,
        recipient: { ...input.recipient, address: "injected@example.net" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.app.inspect(f.owner, f.business.id, { ...input, stepIndex: 2 }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).conversations,
    ).toEqual([]);
  });

  it("requires a new approval for revisions and later discoveries, preserving the previous decision and exact addresses", async () => {
    const f = await campaignFixture(h),
      draft = f.draft();
    const original = (await f.app.save(f.owner, f.business.id, draft))
      .campaigns[0].revisions[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(original),
      decision: "approved",
      note: "First version reviewed",
    });
    await f.discover("new-contact@fabricator.example");
    let state = await f.app.workspace(f.owner, f.business.id);
    expect(
      state.campaigns[0].revisions[0].snapshot.recipients.map((r) => r.address),
    ).toEqual(["purchasing@fabricator.example"]);
    expect(state.campaigns[0].revisions[0].current.evidence.status).toBe(
      "blocked",
    );
    const candidate = state.candidates.find(
      (c) => c.address === "new-contact@fabricator.example",
    )!;
    state = await f.app.save(f.owner, f.business.id, {
      ...draft,
      requestKey: crypto.randomUUID(),
      expectedVersion: 1,
      recipients: [
        {
          prospectId: candidate.prospectId,
          contactId: candidate.contactId,
          evidenceKey: candidate.evidenceKey,
        },
      ],
      steps: [
        {
          subject: "Revised introduction",
          body: "Updated factual introduction",
          delayMinutes: 0,
        },
      ],
      maxAttempts: 1,
      note: "Select the new evidence explicitly",
    });
    expect(state.campaigns[0].revisions).toHaveLength(2);
    expect(state.campaigns[0].revisions[0].decision?.decision).toBe("approved");
    const changed = state.campaigns[0].revisions[1];
    expect(changed.decision).toBeNull();
    expect(state.campaigns[0].revisions[0].current.version.status).toBe(
      "blocked",
    );
    const rec = changed.snapshot.recipients[0];
    await expect(
      f.app.inspect(f.owner, f.business.id, {
        ...f.ref(changed),
        recipient: {
          prospectId: rec.prospectId,
          contactId: rec.contactId,
          address: rec.address,
        },
        stepIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.app.decide(f.owner, f.business.id, {
        ...f.ref(original),
        decision: "rejected",
        note: "Rewrite history",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).conversations,
    ).toEqual([]);
    expect(f.queued).toEqual([]);
  });

  it("serializes concurrent saves and decision replays without losing attributable history", async () => {
    const f = await campaignFixture(h),
      draft = f.draft();
    await Promise.all([
      f.app.save(f.owner, f.business.id, draft),
      f.app.save(f.owner, f.business.id, draft),
    ]);
    let state = await f.app.workspace(f.owner, f.business.id);
    expect(state.campaigns[0].revisions).toHaveLength(1);
    const r = state.campaigns[0].revisions[0],
      decision = {
        ...f.ref(r),
        decision: "rejected",
        note: "Revise the message first",
      };
    await Promise.all([
      f.app.decide(f.owner, f.business.id, decision),
      f.app.decide(f.owner, f.business.id, decision),
    ]);
    await expect(
      f.app.decide(f.owner, f.business.id, {
        ...decision,
        decision: "approved",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const saves = await Promise.allSettled([
      f.app.save(f.owner, f.business.id, {
        ...draft,
        requestKey: crypto.randomUUID(),
        expectedVersion: 1,
        note: "Editor A",
      }),
      f.app.save(f.owner, f.business.id, {
        ...draft,
        requestKey: crypto.randomUUID(),
        expectedVersion: 1,
        note: "Editor B",
      }),
    ]);
    expect(saves.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(saves.filter((r) => r.status === "rejected")).toMatchObject([
      { reason: { code: "CONFLICT" } },
    ]);
    state = await f.newApplication().workspace(f.owner, f.business.id);
    expect(state.campaigns[0].revisions).toHaveLength(2);
    expect(state.campaigns[0].revisions[0].decision).toMatchObject({
      decision: "rejected",
      note: "Revise the message first",
    });
    expect(state.campaigns[0].revisions[1].decision).toBeNull();
    await expect(
      f.app.save(f.owner, f.business.id, {
        ...draft,
        name: "Replay with changed content",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not approve stale evidence, sender versions or replaced revisions", async () => {
    const f = await campaignFixture(h),
      draft = f.draft();
    const r = (await f.app.save(f.owner, f.business.id, draft)).campaigns[0]
      .revisions[0];
    await f.app.save(f.owner, f.business.id, {
      ...draft,
      expectedVersion: 1,
      requestKey: crypto.randomUUID(),
    });
    await expect(
      f.app.decide(f.owner, f.business.id, {
        ...f.ref(r),
        decision: "approved",
        note: "Stale version",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const latest = (await f.app.workspace(f.owner, f.business.id)).campaigns[0]
      .revisions[1];
    await f.sender.app.saveIdentity(f.owner, f.business.id, {
      id: f.sender.identity.id,
      expectedVersion: 1,
      configuration: {
        ...f.sender.identity.configuration,
        displayName: "Changed sender",
      },
    });
    await expect(
      f.app.decide(f.owner, f.business.id, {
        ...f.ref(latest),
        decision: "approved",
        note: "Stale sender",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.app.save(f.owner, f.business.id, {
        ...draft,
        expectedVersion: 2,
        requestKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await f.app.workspace(f.owner, f.business.id)
      ).campaigns[0].revisions.every((r) => !r.decision),
    ).toBe(true);
  });

  it("shows a later inquiry and human control as a stop without changing the approval or creating engagement itself", async () => {
    const f = await campaignFixture(h);
    const r = (await f.app.save(f.owner, f.business.id, f.draft())).campaigns[0]
      .revisions[0];
    const decision = { ...f.ref(r), decision: "approved", note: "Reviewed" };
    await f.app.decide(f.owner, f.business.id, decision);
    const connection = (await f.inbox.workspace(f.owner, f.business.id))
      .connections[0];
    await f.inbox.capture(f.owner, f.business.id, connection.id, {
      eventId: "inquiry-after-approval",
      messageRef: "inquiry-after-approval",
      conversationRef: "direct-need",
      senderRef: "purchasing@fabricator.example",
      senderName: "Fabricator",
      kind: "direct_inquiry",
      subject: "Steel inquiry",
      text: "We would like to discuss supply",
      occurredAt: h.clock.now().toISOString(),
    });
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.campaigns[0].revisions[0].decision?.decision).toBe("approved");
    expect(state.campaigns[0].revisions[0].current.conversation).toMatchObject({
      status: "blocked",
    });
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).opportunities,
    ).toHaveLength(1);
  });

  it("binds the reply route and transport versions as part of the reviewed sender", async () => {
    const f = await campaignFixture(h),
      draft = f.draft();
    const r = (await f.app.save(f.owner, f.business.id, draft)).campaigns[0]
      .revisions[0];
    expect(r.snapshot.senderContext.replyRoute?.configuration.address).toBe(
      "sales@supplier.example",
    );
    await f.sender.app.saveReplyRoute(f.owner, f.business.id, {
      id: f.sender.route.id,
      expectedVersion: 1,
      configuration: {
        ...f.sender.route.configuration,
        address: "changed@supplier.example",
      },
    });
    await f.sender.app.check(f.owner, f.business.id, f.sender.identity.id, {
      expectedVersion: 1,
    });
    await expect(
      f.app.decide(f.owner, f.business.id, {
        ...f.ref(r),
        decision: "approved",
        note: "Stale reply route",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).campaigns[0].revisions[0]
        .current.sender.status,
    ).toBe("blocked");
  });

  async function addMember(
    f: Awaited<ReturnType<typeof campaignFixture>>,
    role: "admin" | "salesperson",
    mfa = true,
  ) {
    const email = `campaign-member-${crypto.randomUUID()}@example.com`;
    await h.team.invite(f.owner, f.business.id, { email, role });
    const mail = h.invitations.sent.at(-1)!;
    const credentials = await h.signIn(email, mfa);
    await h.team.accept(credentials, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    return credentials;
  }

  it("lets sales staff prepare and inspect while only a current MFA-verified Owner can decide", async () => {
    const f = await campaignFixture(h),
      sales = await addMember(f, "salesperson", false),
      admin = await addMember(f, "admin");
    const r = (await f.app.save(sales, f.business.id, f.draft())).campaigns[0]
      .revisions[0];
    expect(r.actorId).toBe((await h.authenticate(sales)).userId);
    for (const actor of [sales, admin])
      await expect(
        f.app.decide(actor, f.business.id, {
          ...f.ref(r),
          decision: "approved",
          note: "Self authorization",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Owner review",
    });
    expect(
      (await f.app.workspace(sales, f.business.id)).campaigns[0].revisions[0]
        .current.authority.status,
    ).toBe("allowed");
    const ownerSession = await h.auth.api.getSession({ headers: f.owner });
    const primary = await h.signIn(ownerSession!.user.email, false);
    await expect(f.app.workspace(primary, f.business.id)).rejects.toMatchObject(
      { code: "MFA_REQUIRED" },
    );
    await h.team.removeMember(
      f.owner,
      f.business.id,
      await h.authenticate(sales),
    );
    await expect(f.app.workspace(sales, f.business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await h.signOut(f.owner);
    const revoked = (await f.app.workspace(admin, f.business.id)).campaigns[0]
      .revisions[0];
    expect(revoked.decision?.decision).toBe("approved");
    expect(revoked.current.authority.status).toBe("blocked");
  });

  it("isolates cross-Business revisions, contacts, evidence and sending identities", async () => {
    const a = await campaignFixture(h),
      b = await campaignFixture(h);
    const r = (await a.app.save(a.owner, a.business.id, a.draft())).campaigns[0]
      .revisions[0];
    await expect(a.app.workspace(b.owner, a.business.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      b.app.decide(b.owner, b.business.id, {
        ...a.ref(r),
        decision: "approved",
        note: "Wrong Business",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.app.save(b.owner, b.business.id, {
        ...b.draft(),
        recipients: a.draft().recipients,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.app.save(b.owner, b.business.id, {
        ...b.draft(),
        senderIdentityId: a.sender.identity.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.app.save(a.owner, a.business.id, {
        ...a.draft(),
        expectedVersion: 1,
        recipients: [
          { ...a.draft().recipients[0], evidenceKey: "a".repeat(64) },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await b.app.workspace(b.owner, b.business.id)).campaigns).toEqual(
      [],
    );
  });

  it.each([
    { steps: [] },
    { maxAttempts: 0 },
    { maxAttempts: 3 },
    { steps: [{ subject: "Test", body: "Content", delayMinutes: 1 }] },
    {
      steps: [
        { subject: "Test", body: "Content", delayMinutes: 0 },
        { subject: "Again", body: "Content", delayMinutes: 0 },
      ],
    },
    {
      steps: [
        { subject: "Test", body: "Content", delayMinutes: 0 },
        { subject: "Again", body: "Content", delayMinutes: 1.5 },
      ],
    },
    {
      steps: [
        {
          subject: "Header\r\nBcc: injected@example.net",
          body: "Content",
          delayMinutes: 0,
        },
      ],
    },
    {
      stopConditions: {
        reply: false,
        optOut: true,
        humanControl: true,
        authorityChange: true,
        eligibilityChange: true,
        senderFailure: true,
        reachChange: true,
        additional: [],
      },
    },
    { send: true },
    { channel: "whatsapp" },
    { proposalId: "00000000-0000-4000-8000-000000000000" },
  ])(
    "rejects malformed plan or bypass fields without saving: %j",
    async (patch) => {
      const f = await campaignFixture(h);
      await expect(
        f.app.save(f.owner, f.business.id, { ...f.draft(), ...patch }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await f.app.workspace(f.owner, f.business.id)).campaigns).toEqual(
        [],
      );
    },
  );

  it("rejects duplicate contact routes instead of turning consolidated research into duplicate sends", async () => {
    const f = await campaignFixture(h),
      draft = f.draft();
    await expect(
      f.app.save(f.owner, f.business.id, {
        ...draft,
        recipients: [...draft.recipients, ...draft.recipients],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await f.app.workspace(f.owner, f.business.id)).campaigns).toEqual(
      [],
    );
  });

  it("uses current scoped permission and suppression for initial and follow-up review, never an approval as permission", async () => {
    const f = await campaignFixture(h),
      draft = f.draft(),
      actor = await h.authenticate(f.owner),
      app = eligibilityApplication(h);
    const r = (await f.app.save(f.owner, f.business.id, draft)).campaigns[0]
        .revisions[0],
      rec = r.snapshot.recipients[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Exact plan reviewed",
    });
    await h.admin.query(
      "insert into platform_operator(user_id,email_policy) values ($1,true) on conflict(user_id) do update set email_policy=true",
      [actor.userId],
    );
    for (const purpose of ["sales_outreach", "sales_follow_up"] as const) {
      const last = (await app.workspace(f.owner, f.business.id)).policies.find(
        (p) => p.policy.purpose === purpose,
      );
      if (!last)
        await app.publishPolicy(f.owner, f.business.id, {
          expectedVersion: 0,
          policy: {
            market: "US",
            recipientClass: "corporate",
            purpose,
            enabled: true,
            effectiveAt: h.clock.now().toISOString(),
            validUntil: "2027-01-01T00:00:00Z",
            acceptedEvidence: ["consent"],
            requiredContent: [],
            incomingOptOutScope: "recipient_outreach",
            sources: ["https://policy.example/reviewed-fixture"],
            rationale:
              "Explicit synthetic policy, never installed in production",
          },
        });
    }
    const policies = (await app.workspace(f.owner, f.business.id)).policies;
    expect(
      (await app.workspace(f.owner, f.business.id)).actions.filter(
        (a) => a.action.kind === "campaign",
      ),
    ).toHaveLength(2);
    const facts = {
      recipient: rec.address,
      market: "US",
      recipientClass: "corporate",
      reference: "Synthetic fixture evidence",
      effectiveAt: h.clock.now().toISOString(),
      validUntil: "2027-01-01T00:00:00Z",
      permissions: ["sales_outreach", "sales_follow_up"].map((purpose) => ({
        kind: "consent",
        purpose,
        policyId: policies.find((p) => p.policy.purpose === purpose)!.id,
        opportunityId: null,
        prospectId: rec.prospectId,
        reference:
          "Explicit synthetic permission for this prospect and purpose",
        observedAt: h.clock.now().toISOString(),
        validUntil: "2027-01-01T00:00:00Z",
      })),
    };
    await app.saveRecipient(f.owner, f.business.id, {
      expectedVersion: 0,
      facts,
    });
    const input = {
      ...f.ref(r),
      recipient: {
        prospectId: rec.prospectId,
        contactId: rec.contactId,
        address: rec.address,
      },
      stepIndex: 0,
    };
    expect(
      (await f.app.inspect(f.owner, f.business.id, input)).eligibility.status,
    ).toBe("allowed");
    expect(
      (await f.app.inspect(f.owner, f.business.id, { ...input, stepIndex: 1 }))
        .eligibility.purpose,
    ).toBe("sales_follow_up");
    await app.suppress(f.owner, f.business.id, {
      requestKey: crypto.randomUUID(),
      recipient: rec.address,
      scope: "recipient_outreach",
      opportunityId: null,
      effectiveAt: "2026-11-05T09:01:00Z",
      reference: "Opt-out effective in one minute",
    });
    const before = await f.app.inspect(f.owner, f.business.id, input);
    expect(before.eligibility.status).toBe("allowed");
    expect(before.eligibility.recheckAt).toBe("2026-11-05T09:01:00Z");
    h.clock.set("2026-11-05T09:01:00Z");
    for (const stepIndex of [0, 1])
      expect(
        (await f.app.inspect(f.owner, f.business.id, { ...input, stepIndex }))
          .eligibility.checks,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "suppression", status: "blocked" }),
        ]),
      );
    expect(
      (await f.app.workspace(f.owner, f.business.id)).campaigns[0].revisions[0]
        .decision?.decision,
    ).toBe("approved");
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).conversations,
    ).toEqual([]);
    expect(f.queued).toEqual([]);
    expect(
      (await app.workspace(f.owner, f.business.id)).evaluations.filter(
        (e) => e.action.kind === "campaign",
      ),
    ).toHaveLength(5);
    const market = policies.find((p) => p.policy.purpose === "sales_outreach")!;
    await app.publishPolicy(f.owner, f.business.id, {
      expectedVersion: market.version,
      policy: { ...market.policy, requiredContent: ["one_click_unsubscribe"] },
    });
    await app.reviewContent(f.owner, f.business.id, {
      action: {
        kind: "campaign",
        id: r.id,
        recipientKey: rec.contactId,
        stepIndex: 0,
      },
      requirements: ["one_click_unsubscribe"],
      reference: "A content checkbox is not a transport",
    });
    expect(
      (await f.app.inspect(f.owner, f.business.id, input)).eligibility.checks,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "content_one_click_unsubscribe",
          status: "unknown",
        }),
      ]),
    );
  });

  it("provides scoped validated HTTP responses and safe failures with no provider payload diagnostics", async () => {
    const f = await campaignFixture(h),
      diagnostics: unknown[] = [],
      http = createCampaignHttp({
        application: f.app,
        origin: "http://localhost:3000",
        reportFailure: (d) => diagnostics.push(d),
      });
    const request = (origin: string, input: unknown) =>
      new Request("http://localhost:3000/api/campaigns", {
        method: "POST",
        headers: {
          ...Object.fromEntries(f.owner),
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    const saved = await http.post(
      request("http://localhost:3000", { command: "save", input: f.draft() }),
      f.business.id,
    );
    expect(saved.status).toBe(200);
    const data = await saved.json();
    expect(campaignWorkspaceSchema.safeParse(data.data).success).toBe(true);
    const r = data.data.campaigns[0].revisions[0],
      rec = r.snapshot.recipients[0];
    const reviewed = await http.post(
      request("http://localhost:3000", {
        command: "review",
        input: {
          ...f.ref(r),
          recipient: {
            prospectId: rec.prospectId,
            contactId: rec.contactId,
            address: rec.address,
          },
          stepIndex: 0,
        },
      }),
      f.business.id,
    );
    expect(
      campaignReviewSchema.safeParse((await reviewed.json()).data).success,
    ).toBe(true);
    expect(
      (
        await http.post(
          request("https://evil.example", { command: "decide", input: {} }),
          f.business.id,
        )
      ).status,
    ).toBe(403);
    const bad = await http.post(
      request("http://localhost:3000", {
        command: "save",
        input: { ...f.draft(), recipients: ["sensitive-provider-token"] },
      }),
      f.business.id,
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("sensitive-provider-token");
    expect(JSON.stringify(diagnostics)).not.toContain(
      "sensitive-provider-token",
    );
    expect(
      (await http.get(new Request("http://localhost:3000"), f.business.id))
        .status,
    ).toBe(401);
  });

  it("preserves immutable history and restricted forced RLS across schema reapplication", async () => {
    const f = await campaignFixture(h),
      r = (await f.app.save(f.owner, f.business.id, f.draft())).campaigns[0]
        .revisions[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Reviewed",
    });
    await h.reapplySchema();
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.campaigns[0].revisions[0].snapshot).toEqual(r.snapshot);
    expect(state.campaigns[0].revisions[0].decision?.decision).toBe("approved");
    const security = await h.admin.query(
      "select relname,relrowsecurity,relforcerowsecurity,has_table_privilege('app_runtime',oid,'UPDATE') as updates,has_table_privilege('app_runtime',oid,'DELETE') as deletes from pg_class where relname in ('campaign_revision','campaign_decision')",
    );
    expect(security.rows).toHaveLength(2);
    for (const row of security.rows)
      expect(row).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        updates: false,
        deletes: false,
      });
    await expect(
      h.runtime.query(
        "update campaign_revision set note='changed' where id=$1",
        [r.id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await f.app.workspace(f.owner, f.business.id)).campaigns[0].revisions[0]
        .note,
    ).toBe("Manual factual draft for review");
  });

  it("retains historical approval while later authority, reach and sender evidence changes stop current use", async () => {
    const f = await campaignFixture(h),
      r = (await f.app.save(f.owner, f.business.id, f.draft())).campaigns[0]
        .revisions[0];
    await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Owner reviewed",
    });
    const authority = createCommercialAuthorityApplication({
      authenticate: h.authenticate,
      authenticatePrivileged: h.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
    });
    await authority.save(f.owner, f.business.id, {
      expectedVersion: 0,
      policy: defaultCommercialPolicy(),
      note: "Authority reviewed again",
    });
    const profile = await h.application.getProfile(f.owner, f.business.id);
    await h.application.saveConfiguration(f.owner, f.business.id, {
      ...configurationDetailsSchema.strip().parse(profile.configuration),
      offering: profile.offering,
      homeMarket: "California, United States",
      homeMarketConfirmed: true,
      buyersReviewed: true,
    });
    h.clock.set("2026-11-05T10:00:00Z");
    const current = (await f.app.workspace(f.owner, f.business.id)).campaigns[0]
      .revisions[0];
    expect(current.decision?.decision).toBe("approved");
    expect(current.snapshot).toEqual(r.snapshot);
    expect(current.current.authority.status).toBe("blocked");
    expect(current.current.policyVersion).toBe(1);
    expect(current.current.reach.status).toBe("blocked");
    expect(current.current.sender.status).toBe("blocked");
    expect(
      (await f.inbox.workspace(f.owner, f.business.id)).opportunities,
    ).toEqual([]);
  });

  it("reviews and persists consolidated multi-source contacts beyond individual observation limits", async () => {
    const f = await campaignFixture(h, { multipleSources: true });
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.candidates).toHaveLength(6);
    expect(new Set(state.candidates.map((c) => c.prospectId)).size).toBe(1);
    const r = (await f.app.save(f.owner, f.business.id, f.draft())).campaigns[0]
      .revisions[0];
    expect(r.snapshot.recipients).toHaveLength(6);
    expect(r.snapshot.recipients[0].prospect.contacts).toHaveLength(6);
    const approved = await f.app.decide(f.owner, f.business.id, {
      ...f.ref(r),
      decision: "approved",
      note: "Reviewed all retained source contacts",
    });
    expect(campaignWorkspaceSchema.safeParse(approved).success).toBe(true);
    expect(
      (await f.newApplication().workspace(f.owner, f.business.id)).campaigns[0]
        .revisions[0].snapshot,
    ).toEqual(r.snapshot);
  });

  it("preserves general-contact uncertainty when an owner's name is not bound to the mailbox", async () => {
    const f = await campaignFixture(h, { namedGeneral: true });
    const state = await f.app.workspace(f.owner, f.business.id);
    expect(state.candidates[0].contact.roleEvidence?.role).toBe("owner");
    expect(state.candidates[0].contactStatus).toBe("general_business_contact");
    const r = (await f.app.save(f.owner, f.business.id, f.draft())).campaigns[0]
      .revisions[0];
    expect(r.snapshot.recipients[0].contactStatus).toBe(
      "general_business_contact",
    );
  });
});
