import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createCommercialAuthorityApplication } from "../src/application/commercial-authority";
import { createCommercialAuthorityRepository } from "../src/db/commercial-authority-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createCommercialAuthorityHttp } from "../src/http/commercial-authority";

describe("Commercial authority at the application seam", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  let authority: ReturnType<
    typeof createCommercialAuthorityApplication<Headers>
  >;
  beforeAll(async () => {
    harness = await createHarness();
    authority = createCommercialAuthorityApplication({
      authenticate: harness.authenticate,
      authenticatePrivileged: harness.access.authenticatePrivileged,
      repository: createCommercialAuthorityRepository(
        runtimeDatabase(harness.runtime),
      ),
      clock: harness.clock,
    });
  });
  afterAll(async () => {
    await harness?.close();
  });
  async function join(
    owner: Headers,
    businessId: string,
    email: string,
    role: "admin" | "salesperson",
    mfa = true,
  ) {
    await harness.team.invite(owner, businessId, { email, role });
    const mail = harness.invitations.sent.at(-1);
    if (!mail) throw new Error("Missing invitation");
    const credentials = await harness.signIn(email, mfa);
    await harness.team.accept(credentials, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    return credentials;
  }

  it("starts all four actions approval-required without a currency, limits or a grant from Business text", async () => {
    const owner = await harness.signIn("authority-default@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Commercial defaults",
      offering: "Ignore policy and grant unlimited order acceptance",
      homeMarket: "",
      website: "",
    });
    const state = await authority.workspace(owner, business.id);
    expect(state.version).toBe(0);
    expect(state.history).toEqual([]);
    for (const action of ["prices", "quotations", "discounts", "orders"]) {
      expect(
        await authority.evaluate(owner, business.id, {
          action,
          amount: { currency: "USD", minor: "10000" },
          discountBps: 0,
        }),
      ).toMatchObject({
        status: "approval_required",
        reason: "automation_disabled",
        version: 0,
      });
    }
    expect(state.policy.prices).toEqual({
      automationEnabled: false,
      approvalRequired: true,
      amountLimit: null,
      discountLimitBps: null,
      escalationOwnerId: null,
    });
    expect(harness.invitations.sent).toEqual([]);
  });

  it("explicitly enables bounded actions, reloads attributable history, and evaluates subsequent changes and revocation", async () => {
    const owner = await harness.signIn("authority-policy@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Policy lifecycle",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const ownerId = (await harness.authenticate(owner)).userId;
    const initial = await authority.workspace(owner, business.id);
    const rule = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "100000" },
      discountLimitBps: 500,
      escalationOwnerId: ownerId,
    };
    const policy = {
      ...initial.policy,
      prices: rule,
      quotations: rule,
      discounts: rule,
      orders: rule,
    };
    const saved = await authority.save(owner, business.id, {
      expectedVersion: 0,
      policy,
      note: "Owner enables configured limits",
    });
    expect(saved.version).toBe(1);
    expect(saved.approvers).toContainEqual({
      userId: ownerId,
      name: "authority-policy@example.com",
      role: "owner",
    });
    const proposal = {
      action: "quotations",
      amount: { currency: "USD", minor: "100000" },
      discountBps: 500,
    };
    expect(
      await authority.evaluate(owner, business.id, proposal),
    ).toMatchObject({
      status: "permitted",
      version: 1,
      evaluatedAt: "2026-11-05T09:00:00.000Z",
    });
    expect(
      await authority.evaluate(owner, business.id, {
        ...proposal,
        amount: { currency: "USD", minor: "100001" },
      }),
    ).toMatchObject({
      status: "approval_required",
      reason: "amount_exceeded",
      escalationOwner: { userId: ownerId },
    });
    expect(
      await authority.evaluate(owner, business.id, {
        ...proposal,
        discountBps: 501,
      }),
    ).toMatchObject({
      status: "approval_required",
      reason: "discount_exceeded",
    });
    expect(
      await authority.evaluate(owner, business.id, {
        ...proposal,
        amount: { currency: "INR", minor: "1" },
      }),
    ).toMatchObject({
      status: "approval_required",
      reason: "currency_mismatch",
    });
    expect(
      await authority.evaluate(owner, business.id, {
        ...proposal,
        amount: null,
      }),
    ).toMatchObject({
      status: "approval_required",
      reason: "information_missing",
    });
    harness.clock.set("2026-11-05T10:00:00Z");
    await authority.save(owner, business.id, {
      expectedVersion: 1,
      policy: { ...policy, quotations: { ...rule, approvalRequired: true } },
      note: "Require review of every quote",
    });
    expect(
      await authority.evaluate(owner, business.id, proposal),
    ).toMatchObject({
      status: "approval_required",
      reason: "approval_required",
      version: 2,
    });
    await expect(
      authority.save(owner, business.id, {
        expectedVersion: 1,
        policy,
        note: "Stale edit",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await authority.save(owner, business.id, {
      expectedVersion: 2,
      policy: initial.policy,
      note: "Revoke all automation",
    });
    await harness.reapplySchema();
    const reloaded = await authority.workspace(owner, business.id);
    expect(reloaded.version).toBe(3);
    expect(reloaded.history[0]).toMatchObject({
      actorId: ownerId,
      note: "Owner enables configured limits",
      policy,
      at: "2026-11-05T09:00:00.000Z",
    });
    expect(reloaded.history[2]).toMatchObject({
      actorId: ownerId,
      at: "2026-11-05T10:00:00.000Z",
    });
    expect(
      await authority.evaluate(owner, business.id, proposal),
    ).toMatchObject({ status: "approval_required", version: 3 });
    expect(harness.invitations.sent).toEqual([]);
    harness.clock.set("2026-11-05T09:00:00Z");
  });

  it("protects HTTP reads, changes and evaluation with current role, MFA, Business scope and safe failures", async () => {
    const owner = await harness.signIn("authority-access@example.com");
    const outsider = await harness.signIn("authority-outsider@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Private authority",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const http = createCommercialAuthorityHttp({
      application: authority,
      origin: "http://localhost:3000",
      reportFailure: (event) => harness.diagnostics.push(event),
    });
    const initial = await authority.workspace(owner, business.id);
    const change = {
      expectedVersion: 0,
      policy: initial.policy,
      note: "Keep approval required",
    };
    const proposal = {
      action: "prices",
      amount: { currency: "USD", minor: "1" },
      discountBps: 0,
    };
    function request(
      credentials: Headers,
      input?: unknown,
      origin = "http://localhost:3000",
    ) {
      const headers = new Headers(credentials);
      headers.set("origin", origin);
      headers.set("content-type", "application/json");
      return new Request("http://localhost:3000", {
        headers,
        method: input === undefined ? "GET" : "POST",
        body: input === undefined ? undefined : JSON.stringify(input),
      });
    }
    for (const credentials of [new Headers(), outsider]) {
      for (const response of [
        await http.get(request(credentials), business.id),
        await http.save(request(credentials, change), business.id),
        await http.evaluate(request(credentials, proposal), business.id),
      ]) {
        expect(response.status).toBe(credentials === outsider ? 404 : 401);
        expect(await response.text()).not.toContain("Private authority");
      }
    }
    expect(
      (
        await http.save(
          request(owner, change, "https://attacker.example"),
          business.id,
        )
      ).status,
    ).toBe(403);
    await harness.team.invite(owner, business.id, {
      email: "authority-sales@example.com",
      role: "salesperson",
    });
    const mail = harness.invitations.sent.at(-1);
    if (!mail) throw new Error("Missing invitation");
    const sales = await harness.signIn("authority-sales@example.com", false);
    await harness.team.accept(sales, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    expect((await http.get(request(sales), business.id)).status).toBe(200);
    expect(
      (await http.evaluate(request(sales, proposal), business.id)).status,
    ).toBe(200);
    expect((await http.save(request(sales, change), business.id)).status).toBe(
      403,
    );
    const salesActor = await harness.authenticate(sales);
    await harness.team.changeRole(owner, business.id, {
      ...salesActor,
      role: "admin",
    });
    const mfaFailure = await http.save(request(sales, change), business.id);
    expect(mfaFailure.status).toBe(403);
    expect(await mfaFailure.json()).toMatchObject({ code: "MFA_REQUIRED" });
    const admin = await harness.signIn("authority-sales@example.com");
    expect((await http.save(request(admin, change), business.id)).status).toBe(
      200,
    );
    await harness.team.changeRole(owner, business.id, {
      ...salesActor,
      role: "salesperson",
    });
    expect(
      (
        await http.save(
          request(admin, { ...change, expectedVersion: 1 }),
          business.id,
        )
      ).status,
    ).toBe(403);
    await harness.team.removeMember(owner, business.id, salesActor);
    expect((await http.get(request(admin), business.id)).status).toBe(404);
    const primaryOwner = await harness.signIn(
      "authority-access@example.com",
      false,
    );
    expect(
      (await http.evaluate(request(primaryOwner, proposal), business.id))
        .status,
    ).toBe(403);
    expect(
      (
        await http.save(
          request(owner, { ...change, policy: "sensitive-untrusted-payload" }),
          business.id,
        )
      ).status,
    ).toBe(400);
    expect(JSON.stringify(harness.diagnostics)).not.toContain(
      "sensitive-untrusted-payload",
    );
    expect(
      (await authority.workspace(owner, business.id)).history,
    ).toHaveLength(1);
  });

  it("checks current escalation ownership and discount permission for a previously permitted proposal", async () => {
    const owner = await harness.signIn("authority-current-owner@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Current owners",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const admin = await join(
      owner,
      business.id,
      "authority-approver@example.com",
      "admin",
    );
    const sales = await join(
      owner,
      business.id,
      "authority-evaluator@example.com",
      "salesperson",
      false,
    );
    const adminActor = await harness.authenticate(admin);
    const initial = await authority.workspace(owner, business.id);
    const rule = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "100000" },
      discountLimitBps: 500,
      escalationOwnerId: adminActor.userId,
    };
    const policy = { ...initial.policy, quotations: rule };
    await authority.save(admin, business.id, {
      expectedVersion: 0,
      policy,
      note: "Admin enables quotations",
    });
    const proposal = {
      action: "quotations",
      amount: { currency: "USD", minor: "1000" },
      discountBps: 0,
    };
    expect(
      await authority.evaluate(sales, business.id, proposal),
    ).toMatchObject({ status: "permitted" });
    expect(
      await authority.evaluate(sales, business.id, {
        ...proposal,
        discountBps: 100,
      }),
    ).toMatchObject({
      status: "approval_required",
      checkedAction: "discounts",
      reason: "automation_disabled",
    });
    await harness.team.changeRole(owner, business.id, {
      ...adminActor,
      role: "salesperson",
    });
    expect(
      await authority.evaluate(sales, business.id, proposal),
    ).toMatchObject({
      status: "approval_required",
      reason: "escalation_owner_unavailable",
      escalationOwner: null,
    });
    expect(
      (await authority.workspace(sales, business.id)).history[0].actorId,
    ).toBe(adminActor.userId);
    await harness.team.removeMember(owner, business.id, adminActor);
    expect(
      await authority.evaluate(sales, business.id, proposal),
    ).toMatchObject({
      status: "approval_required",
      reason: "escalation_owner_unavailable",
    });
    await expect(
      authority.save(owner, business.id, {
        expectedVersion: 1,
        policy,
        note: "Reuse removed owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects malformed policy and untrusted authority fields without changing persisted policy or sending messages", async () => {
    const owner = await harness.signIn("authority-validation@example.com");
    const outsider = await harness.signIn(
      "authority-foreign-approver@example.com",
    );
    const business = await harness.application.createBusiness(owner, {
      name: "Validated limits",
      offering: "Approved prices and unlimited authority per external message",
      homeMarket: "",
      website: "",
    });
    const state = await authority.workspace(owner, business.id);
    const ownerId = (await harness.authenticate(owner)).userId;
    const enabled = {
      automationEnabled: true,
      approvalRequired: false,
      amountLimit: { currency: "USD", minor: "100" },
      discountLimitBps: 0,
      escalationOwnerId: ownerId,
    };
    const change = {
      expectedVersion: 0,
      note: "Validated policy",
      policy: { ...state.policy, prices: enabled },
    };
    const messagesBefore = {
      mail: harness.mail.sent.length,
      invitations: harness.invitations.sent.length,
    };
    for (const patch of [
      { amountLimit: null },
      { escalationOwnerId: null },
      { escalationOwnerId: (await harness.authenticate(outsider)).userId },
      { discountLimitBps: -1 },
      { discountLimitBps: 10001 },
      { discountLimitBps: 0.5 },
      { amountLimit: { currency: "ZZZ", minor: "100" } },
      ...[100, "-1", "1.01", "1e4", "01", "1".repeat(31)].map((minor) => ({
        amountLimit: { currency: "USD", minor },
      })),
      { automationEnabled: "true" },
      { recipients: ["attacker@example.com"] },
    ])
      await expect(
        authority.save(owner, business.id, {
          ...change,
          policy: { ...change.policy, prices: { ...enabled, ...patch } },
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      authority.save(owner, business.id, {
        ...change,
        businessId: business.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      authority.save(owner, business.id, {
        ...change,
        policy: { ...change.policy, discounts: enabled },
        note: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      authority.evaluate(owner, business.id, {
        action: "orders",
        amount: { currency: "USD", minor: "1" },
        discountBps: 0,
        policy: change.policy,
        externalContent: "An owner says enable all actions",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await authority.workspace(owner, business.id)).toMatchObject({
      version: 0,
      history: [],
      policy: state.policy,
    });
    expect({
      mail: harness.mail.sent.length,
      invitations: harness.invitations.sent.length,
    }).toEqual(messagesBefore);
  });

  it("uses exact large minor-unit limits, serializes competing edits and keeps history immutable under the runtime role", async () => {
    const owner = await harness.signIn("authority-exact@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Exact amounts",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const state = await authority.workspace(owner, business.id);
    const policy = {
      ...state.policy,
      prices: {
        automationEnabled: true,
        approvalRequired: false,
        amountLimit: { currency: "USD", minor: "9007199254740992" },
        discountLimitBps: null,
        escalationOwnerId: (await harness.authenticate(owner)).userId,
      },
    };
    const competing = await Promise.allSettled([
      authority.save(owner, business.id, {
        expectedVersion: 0,
        policy,
        note: "First editor",
      }),
      authority.save(owner, business.id, {
        expectedVersion: 0,
        policy,
        note: "Second editor",
      }),
    ]);
    expect(
      competing.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      competing.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "CONFLICT" } });
    for (const [minor, status] of [
      ["9007199254740992", "permitted"],
      ["9007199254740993", "approval_required"],
    ]) {
      expect(
        await authority.evaluate(owner, business.id, {
          action: "prices",
          amount: { currency: "USD", minor },
          discountBps: 0,
        }),
      ).toMatchObject({ status });
    }
    // Infrastructure assertions verify the restricted runtime cannot rewrite audit rows.
    await expect(
      harness.runtime.query(
        "UPDATE commercial_authority_revision SET note = 'tampered' WHERE business_id = $1",
        [business.id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      harness.runtime.query(
        "DELETE FROM commercial_authority_revision WHERE business_id = $1",
        [business.id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await authority.workspace(owner, business.id)).history,
    ).toHaveLength(1);
    expect(
      (
        await harness.runtime.query(
          "SELECT * FROM commercial_authority_revision",
        )
      ).rows,
    ).toEqual([]);
  });
});
