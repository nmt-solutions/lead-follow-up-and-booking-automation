import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("Business team access", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const profile = {
    name: "Access Business",
    offering: "Steel",
    homeMarket: "",
    website: "",
  };
  function tokenFor(email: string) {
    const message = h.invitations.sent.findLast((x) => x.email === email);
    if (!message) throw new Error("Missing invitation notification");
    return new URLSearchParams(new URL(message.url).hash.slice(1)).get("token");
  }
  async function join(
    owner: Headers,
    businessId: string,
    email: string,
    role: "admin" | "salesperson",
  ) {
    await h.team.invite(owner, businessId, { email, role });
    const headers = await h.signIn(email);
    await h.team.accept(headers, { token: tokenFor(email) });
    return headers;
  }

  it("an owner invites a teammate who accepts once with their verified email", async () => {
    const owner = await h.signIn("team-owner@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Team Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const invited = await h.team.invite(owner, business.id, {
      email: "SALESPERSON@example.com",
      role: "salesperson",
      expiresInDays: 7,
    });
    expect(invited).toMatchObject({
      email: "salesperson@example.com",
      status: "pending",
      delivery: "sent",
    });
    const notification = h.invitations.sent.at(-1);
    expect(notification).toMatchObject({
      email: "salesperson@example.com",
      businessName: "Team Business",
      role: "salesperson",
    });
    if (!notification) throw new Error("Missing invitation notification");
    const token = new URLSearchParams(
      new URL(notification.url).hash.slice(1),
    ).get("token");
    const salesperson = await h.signIn("salesperson@example.com");
    expect(await h.team.accept(salesperson, { token })).toEqual({
      businessId: business.id,
    });
    expect(
      await h.application.getProfile(salesperson, business.id),
    ).toMatchObject({ name: "Team Business" });
    expect(
      (await h.application.listBusinesses(salesperson)).map((x) => x.id),
    ).toEqual([business.id]);
    await expect(h.team.accept(salesperson, { token })).rejects.toMatchObject({
      code: "INVITATION_UNAVAILABLE",
    });
    const team = await h.team.getTeam(owner, business.id);
    expect(team.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "salesperson@example.com",
          role: "salesperson",
        }),
      ]),
    );
    expect(await h.team.getAudit(owner, business.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "invitation.created" }),
        expect.objectContaining({ action: "invitation.accepted" }),
      ]),
    );
  });

  it("enforces Business roles, protects the owner, and prevents admin escalation", async () => {
    h.clock.set("2026-11-05T10:00:00Z");
    const owner = await h.signIn("roles-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const admin = await join(
      owner,
      business.id,
      "roles-admin@example.com",
      "admin",
    );
    const sales = await join(
      admin,
      business.id,
      "roles-sales@example.com",
      "salesperson",
    );
    const salesActor = await h.authenticate(sales);
    const ownerActor = await h.authenticate(owner);
    await h.application.updateProfile(admin, business.id, {
      ...profile,
      name: "Managed by admin",
    });
    for (const capability of [
      "billing.read",
      "billing.manage",
      "integrations.manage",
      "commercial-authority.manage",
    ]) {
      expect(
        await h.team.requireBusinessCapability(admin, business.id, capability),
      ).toMatchObject({ role: "admin" });
      await expect(
        h.team.requireBusinessCapability(sales, business.id, capability),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      h.application.updateProfile(sales, business.id, profile),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.team.getTeam(sales, business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(h.team.getAudit(sales, business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      h.team.invite(admin, business.id, {
        email: "escalation@example.com",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.team.changeRole(admin, business.id, {
        userId: salesActor.userId,
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.team.removeMember(owner, business.id, ownerActor),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.team.changeRole(owner, business.id, {
        userId: ownerActor.userId,
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.team.invite(owner, business.id, {
        email: "escalation@example.com",
        role: "owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      h.team.invite(owner, business.id, {
        email: "escalation@example.com",
        role: "platform-operator",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await h.team.changeRole(owner, business.id, {
      userId: salesActor.userId,
      role: "admin",
    });
    expect(
      await h.team.requireBusinessCapability(
        sales,
        business.id,
        "billing.manage",
      ),
    ).toMatchObject({ role: "admin" });
    await h.team.changeRole(owner, business.id, {
      userId: salesActor.userId,
      role: "salesperson",
    });
    await expect(
      h.team.requireBusinessCapability(sales, business.id, "billing.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.team.removeMember(admin, business.id, salesActor);
    await expect(
      h.application.getProfile(sales, business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await h.application.listBusinesses(sales)).toEqual([]);
    expect(await h.team.getAudit(owner, business.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "membership.role_changed",
          subjectId: salesActor.userId,
          detail: "admin -> salesperson",
        }),
        expect.objectContaining({
          action: "membership.removed",
          subjectId: salesActor.userId,
        }),
      ]),
    );
  });

  it("reveals invitation details only to its verified recipient before acceptance", async () => {
    h.clock.set("2026-11-05T11:00:00Z");
    const owner = await h.signIn("preview-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    await h.team.invite(owner, business.id, {
      email: "preview-recipient@example.com",
      role: "salesperson",
    });
    const token = tokenFor("preview-recipient@example.com");
    const other = await h.signIn("preview-other@example.com");
    await expect(h.team.preview(other, { token })).rejects.toMatchObject({
      code: "INVITATION_UNAVAILABLE",
    });
    const recipient = await h.signIn("preview-recipient@example.com");
    expect(await h.team.preview(recipient, { token })).toMatchObject({
      businessName: "Access Business",
      role: "salesperson",
    });
    expect(await h.application.listBusinesses(recipient)).toEqual([]);
  });

  it("rejects expired, revoked and stolen invitations without granting membership", async () => {
    h.clock.set("2026-11-05T12:00:00Z");
    const owner = await h.signIn("links-owner@example.com");
    const recipient = await h.signIn("links-recipient@example.com");
    const thief = await h.signIn("links-thief@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const invitation = await h.team.invite(owner, business.id, {
      email: "links-recipient@example.com",
      role: "salesperson",
      expiresInDays: 1,
    });
    const token = tokenFor("links-recipient@example.com");
    await expect(h.team.accept(thief, { token })).rejects.toMatchObject({
      code: "INVITATION_UNAVAILABLE",
    });
    await h.team.revokeInvitation(owner, business.id, {
      invitationId: invitation.id,
    });
    await expect(h.team.accept(recipient, { token })).rejects.toMatchObject({
      code: "INVITATION_UNAVAILABLE",
    });
    const expiring = await h.team.invite(owner, business.id, {
      email: "links-recipient@example.com",
      role: "salesperson",
      expiresInDays: 1,
    });
    const expiredToken = tokenFor("links-recipient@example.com");
    h.clock.set("2026-11-06T12:00:00Z");
    recipient.set(
      "cookie",
      (await h.signIn("links-recipient@example.com")).get("cookie")!,
    );
    owner.set(
      "cookie",
      (await h.signIn("links-owner@example.com")).get("cookie")!,
    );
    thief.set(
      "cookie",
      (await h.signIn("links-thief@example.com")).get("cookie")!,
    );
    await expect(
      h.team.accept(recipient, { token: expiredToken }),
    ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    expect((await h.team.getTeam(owner, business.id)).invitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expiring.id, status: "expired" }),
        expect.objectContaining({ id: invitation.id, status: "revoked" }),
      ]),
    );
    expect(await h.application.listBusinesses(recipient)).toEqual([]);
    expect(await h.application.listBusinesses(thief)).toEqual([]);
    expect(await h.team.getAudit(owner, business.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "invitation.expired",
          subjectId: expiring.id,
        }),
      ]),
    );
  });

  it("keeps current permissions authoritative for stale sessions and deferred notifications", async () => {
    h.clock.set("2026-11-05T13:00:00Z");
    const owner = await h.signIn("revocation-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const admin = await join(
      owner,
      business.id,
      "revocation-admin@example.com",
      "admin",
    );
    const actor = await h.authenticate(admin);
    const worker = h.teamWorkerFor(actor);
    const pending = await h.team.invite(admin, business.id, {
      email: "revocation-recipient@example.com",
      role: "salesperson",
    });
    const token = tokenFor("revocation-recipient@example.com");
    await h.team.changeRole(owner, business.id, {
      ...actor,
      role: "salesperson",
    });
    await expect(
      worker.deliverInvitation(undefined, business.id, {
        invitationId: pending.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.team.getAudit(admin, business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.team.changeRole(owner, business.id, { ...actor, role: "admin" });
    const recipient = await h.signIn("revocation-recipient@example.com");
    await expect(h.team.accept(recipient, { token })).rejects.toMatchObject({
      code: "INVITATION_UNAVAILABLE",
    });
    await h.team.removeMember(owner, business.id, actor);
    await expect(worker.getTeam(undefined, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      worker.deliverInvitation(undefined, business.id, {
        invitationId: pending.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      h.application.getProfile(admin, business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      h.invitations.sent.filter((x) => x.invitationId === pending.id),
    ).toHaveLength(1);
    expect(
      (await h.team.getTeam(owner, business.id)).invitations,
    ).toContainEqual(
      expect.objectContaining({ id: pending.id, status: "revoked" }),
    );
  });

  it("isolates all team reads and writes from another Business and rejects forged scope", async () => {
    h.clock.set("2026-11-05T14:00:00Z");
    const owner = await h.signIn("isolation-owner@example.com");
    const other = await h.signIn("isolation-other@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const anotherBusiness = await h.application.createBusiness(other, {
      ...profile,
      name: "Other Business",
    });
    const actor = await h.authenticate(owner);
    const invitation = await h.team.invite(owner, business.id, {
      email: "isolation-recipient@example.com",
      role: "salesperson",
    });
    for (const attempt of [
      () => h.team.getTeam(other, business.id),
      () => h.team.getAudit(other, business.id),
      () =>
        h.team.invite(other, business.id, {
          email: "isolation-intruder@example.com",
          role: "salesperson",
        }),
      () => h.team.changeRole(other, business.id, { ...actor, role: "admin" }),
      () => h.team.removeMember(other, business.id, actor),
      () =>
        h.team.revokeInvitation(other, business.id, {
          invitationId: invitation.id,
        }),
      () =>
        h.team.deliverInvitation(other, business.id, {
          invitationId: invitation.id,
        }),
      () =>
        h.team.requireBusinessCapability(other, business.id, "billing.read"),
      () =>
        h.team.revokeInvitation(other, anotherBusiness.id, {
          invitationId: invitation.id,
        }),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      h.team.invite(owner, business.id, {
        email: "forged@example.com",
        role: "salesperson",
        businessId: anotherBusiness.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      h.team.accept(owner, {
        token: tokenFor("isolation-recipient@example.com"),
        businessId: anotherBusiness.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await h.team.getTeam(owner, business.id)).invitations).toHaveLength(
      1,
    );
  });

  it("reconciles ambiguous notification acceptance without duplicate email effects", async () => {
    h.clock.set("2026-11-05T15:00:00Z");
    const owner = await h.signIn("notification-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    h.invitations.failAfterAccept = true;
    const invitation = await h.team.invite(owner, business.id, {
      email: "notification-recipient@example.com",
      role: "salesperson",
    });
    h.invitations.failAfterAccept = false;
    expect(invitation.delivery).toBe("unconfirmed");
    await h.application.updateProfile(owner, business.id, {
      ...profile,
      name: "Renamed after send",
    });
    await h.team.deliverInvitation(owner, business.id, {
      invitationId: invitation.id,
    });
    await h.team.deliverInvitation(owner, business.id, {
      invitationId: invitation.id,
    });
    expect(
      h.invitations.sent.filter((x) => x.invitationId === invitation.id),
    ).toEqual([expect.objectContaining({ businessName: "Access Business" })]);
    expect(
      (await h.team.getTeam(owner, business.id)).invitations,
    ).toContainEqual(
      expect.objectContaining({ id: invitation.id, delivery: "sent" }),
    );
    expect(
      JSON.stringify(await h.team.getAudit(owner, business.id)),
    ).not.toContain("sensitive-provider");
    expect(
      JSON.stringify(await h.team.getTeam(owner, business.id)),
    ).not.toContain("tokenHash");
    h.invitations.fail = true;
    const failed = await h.team.invite(owner, business.id, {
      email: "late-retry@example.com",
      role: "salesperson",
    });
    h.invitations.fail = false;
    h.clock.set("2026-11-06T15:00:00Z");
    owner.set(
      "cookie",
      (await h.signIn("notification-owner@example.com")).get("cookie")!,
    );
    await expect(
      h.team.deliverInvitation(owner, business.id, { invitationId: failed.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.invitations.sent.some((x) => x.invitationId === failed.id)).toBe(
      false,
    );
  });

  it("upgrades the legacy owner-only membership check before accepting an administrator", async () => {
    h.clock.set("2026-11-05T16:00:00Z");
    const owner = await h.signIn("legacy-check-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    // Upgrade fixture: issue #3's existing check allowed only owners.
    await h.admin.query(
      "ALTER TABLE membership DROP CONSTRAINT membership_role; ALTER TABLE membership ADD CONSTRAINT membership_role CHECK (role = 'owner') NOT VALID",
    );
    await h.reapplySchema();
    await h.team.invite(owner, business.id, {
      email: "legacy-check-recipient@example.com",
      role: "admin",
    });
    const recipient = await h.signIn("legacy-check-recipient@example.com");
    await h.team.accept(recipient, {
      token: tokenFor("legacy-check-recipient@example.com"),
    });
    expect((await h.team.getTeam(owner, business.id)).members).toContainEqual(
      expect.objectContaining({
        email: "legacy-check-recipient@example.com",
        role: "admin",
      }),
    );
  });
  it("accepts a concurrent invitation once and persists team access across schema pushes", async () => {
    h.clock.set("2026-11-05T16:00:00Z");
    const owner = await h.signIn("concurrent-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        h.team.invite(owner, business.id, {
          email: "concurrent-recipient@example.com",
          role: "admin",
        }),
      ),
    );
    expect(results.map((x) => x.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const recipient = await h.signIn("concurrent-recipient@example.com");
    const token = tokenFor("concurrent-recipient@example.com");
    const accepts = await Promise.allSettled(
      [1, 2].map(() => h.team.accept(recipient, { token })),
    );
    expect(accepts.map((x) => x.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    await h.reapplySchema();
    expect((await h.team.getTeam(owner, business.id)).members).toContainEqual(
      expect.objectContaining({
        email: "concurrent-recipient@example.com",
        role: "admin",
      }),
    );
    expect(
      (await h.team.getAudit(owner, business.id)).filter(
        (x) => x.action === "invitation.accepted",
      ),
    ).toHaveLength(1);
  });

  it("requires separate persisted platform grants and a trusted MFA identity", async () => {
    h.clock.set("2026-11-05T17:00:00Z");
    const owner = await h.signIn("operator-owner@example.com");
    const operator = await h.signIn("operator@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const verifiedPlatform = h.team;
    await expect(
      verifiedPlatform.requirePlatformCapability(owner, "tax.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    await expect(
      h.team.requirePlatformCapability(
        await h.signIn("operator@example.com", false),
        "tax.manage",
      ),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(
      await verifiedPlatform.requirePlatformCapability(operator, "tax.manage"),
    ).toEqual({ capability: "tax.manage" });
    await expect(
      verifiedPlatform.requirePlatformCapability(
        operator,
        "reconciliation.manage",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      verifiedPlatform.requireBusinessCapability(
        operator,
        business.id,
        "billing.read",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.provisionOperator(operator, { tax: false, reconciliation: false });
    await expect(
      verifiedPlatform.requirePlatformCapability(operator, "tax.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("authenticates HTTP team commands, rejects foreign origins and keeps diagnostics safe", async () => {
    h.clock.set("2026-11-05T18:00:00Z");
    const owner = await h.signIn("team-http-owner@example.com");
    const other = await h.signIn("team-http-other@example.com");
    const business = await h.application.createBusiness(owner, profile);
    function request(
      headers: Headers,
      body: string,
      origin = "http://localhost:3000",
    ) {
      const merged = new Headers(headers);
      merged.set("content-type", "application/json");
      merged.set("origin", origin);
      return new Request(
        `http://localhost:3000/api/businesses/${business.id}/team/invitations`,
        { method: "POST", headers: merged, body },
      );
    }
    const input = JSON.stringify({
      email: "team-http-recipient@example.com",
      role: "salesperson",
    });
    expect(
      (await h.teamHttp.invite(request(owner, input), business.id)).status,
    ).toBe(201);
    expect(
      (await h.teamHttp.invite(request(new Headers(), input), business.id))
        .status,
    ).toBe(401);
    expect(
      (
        await h.teamHttp.invite(
          request(owner, input, "https://attacker.example"),
          business.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (await h.teamHttp.invite(request(owner, "x".repeat(32769)), business.id))
        .status,
    ).toBe(400);
    const denied = await h.teamHttp.get(
      new Request("http://localhost:3000", { headers: other }),
      business.id,
    );
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({
      code: "NOT_FOUND",
      requestId: expect.any(String),
    });
    expect(
      (await h.teamHttp.accept(request(owner, '{"token":"sensitive-token"}')))
        .status,
    ).toBe(400);
    expect(JSON.stringify(h.diagnostics)).not.toMatch(
      /team-http-recipient|sensitive-token|sensitive-provider/,
    );
  });

  it("lets Admins expire an old Admin invitation without granting Admin authority", async () => {
    h.clock.set("2026-11-05T20:00:00Z");
    const owner = await h.signIn("admin-expiry-owner@example.com");
    const business = await h.application.createBusiness(owner, profile);
    const admin = await join(
      owner,
      business.id,
      "admin-expiry-admin@example.com",
      "admin",
    );
    const invitation = await h.team.invite(owner, business.id, {
      email: "admin-expiry-recipient@example.com",
      role: "admin",
      expiresInDays: 1,
    });
    await expect(
      h.team.revokeInvitation(admin, business.id, {
        invitationId: invitation.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.clock.set("2026-11-06T20:00:00Z");
    admin.set(
      "cookie",
      (await h.signIn("admin-expiry-admin@example.com")).get("cookie")!,
    );
    owner.set(
      "cookie",
      (await h.signIn("admin-expiry-owner@example.com")).get("cookie")!,
    );
    expect(
      (await h.team.getTeam(admin, business.id)).invitations,
    ).toContainEqual(
      expect.objectContaining({ id: invitation.id, status: "expired" }),
    );
    const renewed = await h.team.invite(admin, business.id, {
      email: "admin-expiry-recipient@example.com",
      role: "salesperson",
    });
    expect(renewed).toMatchObject({
      status: "pending",
      role: "salesperson",
      delivery: "sent",
    });
    await expect(
      h.team.invite(admin, business.id, {
        email: "still-owner-only@example.com",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await h.team.getAudit(admin, business.id)).toContainEqual(
      expect.objectContaining({
        action: "invitation.expired",
        subjectId: invitation.id,
      }),
    );
  });

  it("supports forced RLS when the definer owner has no superuser or bypass privileges", async () => {
    h.clock.set("2026-11-05T19:00:00Z");
    const owner = await h.signIn("managed-postgres-owner@example.com");
    // Infrastructure fixture mirrors a managed PostgreSQL schema owner; assertions
    // remain at the application seam rather than inspecting internal records.
    await h.admin
      .query(`CREATE ROLE test_schema_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE, CREATE ON SCHEMA public TO test_schema_owner;
      ALTER TABLE membership OWNER TO test_schema_owner;
      ALTER FUNCTION public.current_business_role() OWNER TO test_schema_owner;
      ALTER FUNCTION public.inviter_authorized(text, text) OWNER TO test_schema_owner;`);
    const business = await h.application.createBusiness(owner, profile);
    const admin = await join(
      owner,
      business.id,
      "managed-postgres-admin@example.com",
      "admin",
    );
    expect((await h.team.getTeam(admin, business.id)).members).toHaveLength(2);
    expect(await h.application.getProfile(admin, business.id)).toMatchObject({
      name: "Access Business",
    });
  });
});
