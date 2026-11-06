import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { authenticatorCode } from "./support/totp";

describe("privileged MFA", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("starts authenticator enrollment without claiming it is verified", async () => {
    const headers = await h.signIn("mfa-enroll@example.com", false);
    headers.set("content-type", "application/json");
    headers.set("origin", "http://localhost:3000");
    const response = await h.auth.handler(
      new Request("http://localhost:3000/api/auth/two-factor/enable", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      method: "totp",
      totpURI: expect.stringContaining("otpauth://"),
      backupCodes: expect.any(Array),
    });
    expect((await h.auth.api.getSession({ headers }))?.user).toMatchObject({
      twoFactorEnabled: false,
    });
  });

  it("does not let a primary-only magic-link session create privileged ownership", async () => {
    const headers = await h.signIn("mfa-primary@example.com", false);
    await expect(
      h.application.createBusiness(headers, {
        name: "Protected Business",
        offering: "Steel",
        homeMarket: "",
        website: "",
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("requires a new challenge after magic-link sign-in and recovers once without crossing Business scope", async () => {
    const email = "mfa-recovery@example.com";
    const primary = await h.signIn(email, false);
    const setup = await h.auth.api.enableTwoFactor({
      headers: primary,
      body: {},
    });
    if (setup.method !== "totp") throw new Error("Expected authenticator");
    const response = await h.auth.api.verifyTOTP({
      headers: primary,
      body: { code: authenticatorCode(setup.totpURI, h.clock.now()) },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const owner = new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; "),
    });
    expect(await h.access.status(owner)).toMatchObject({
      enrolled: true,
      verified: true,
      readiness: "mfa-satisfied",
    });
    const business = await h.application.createBusiness(owner, {
      name: "MFA Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const second = await h.signIn(email, false);
    expect(await h.access.status(second)).toMatchObject({
      enrolled: true,
      verified: false,
      required: true,
      readiness: "mfa-incomplete",
    });
    for (const capability of [
      "billing.read",
      "billing.manage",
      "integrations.manage",
      "commercial-authority.manage",
    ]) {
      await expect(
        h.team.requireBusinessCapability(second, business.id, capability),
      ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    }
    await expect(
      h.auth.api.getTOTPURI({ headers: second, body: {} }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(
      h.auth.api.generateBackupCodes({ headers: second, body: {} }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(
      h.auth.api.disableTwoFactor({ headers: second, body: {} }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
    h.clock.set("2026-11-05T09:01:00Z");
    await h.auth.api.verifyBackupCode({
      headers: second,
      body: { code: setup.backupCodes[0] },
    });
    expect(await h.access.status(second)).toMatchObject({ verified: true });
    expect(await h.application.getProfile(second, business.id)).toMatchObject({
      name: "MFA Business",
    });
    const outsider = await h.signIn("mfa-outsider@example.com");
    await expect(
      h.application.getProfile(outsider, business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    h.clock.set("2026-11-05T09:02:00Z");
    const third = await h.signIn(email, false);
    await expect(
      h.auth.api.verifyBackupCode({
        headers: third,
        body: { code: setup.backupCodes[0] },
      }),
    ).rejects.toBeDefined();
    expect(await h.access.status(third)).toMatchObject({ verified: false });
    await h.signOut(second);
    await expect(
      h.application.getProfile(second, business.id),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      h.auth.api.verifyBackupCode({
        headers: second,
        body: { code: setup.backupCodes[1] },
      }),
    ).rejects.toBeDefined();
  });

  it("requires persisted operator grants and recent MFA without granting Business access", async () => {
    h.clock.set("2026-11-05T10:00:00Z");
    const owner = await h.signIn("mfa-platform-owner@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Private Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const operator = await h.signIn("mfa-platform@example.com");
    await expect(
      h.team.requirePlatformCapability(owner, "tax.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    expect(
      await h.team.requirePlatformCapability(operator, "tax.manage"),
    ).toEqual({ capability: "tax.manage" });
    await expect(
      h.team.requirePlatformCapability(operator, "reconciliation.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.application.getProfile(operator, business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const primaryOnly = await h.signIn("mfa-platform@example.com", false);
    await expect(
      h.team.requirePlatformCapability(primaryOnly, "tax.manage"),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    h.clock.set("2026-11-05T10:15:00Z");
    await expect(
      h.team.requirePlatformCapability(operator, "tax.manage"),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const fresh = await h.signIn("mfa-platform@example.com");
    await h.provisionOperator(fresh, { tax: false, reconciliation: false });
    await expect(
      h.team.requirePlatformCapability(fresh, "tax.manage"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports current MFA requirements for a pricing-only operator and notices grant revocation", async () => {
    h.clock.set("2026-11-05T10:20:00Z");
    const operator = await h.signIn("mfa-pricing-only@example.com");
    const actor = await h.authenticate(operator);
    await h.admin.query(
      "INSERT INTO platform_operator (user_id, pricing) VALUES ($1, true)",
      [actor.userId],
    );
    expect(await h.access.status(operator)).toMatchObject({
      required: true,
      operator: true,
      operatorVerified: true,
      readiness: "mfa-satisfied",
    });
    h.clock.set("2026-11-05T10:35:00Z");
    expect(await h.access.status(operator)).toMatchObject({
      required: true,
      operator: true,
      verified: true,
      operatorVerified: false,
      readiness: "mfa-incomplete",
    });
    await expect(
      h.team.requirePlatformCapability(operator, "pricing.manage"),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await h.admin.query(
      "UPDATE platform_operator SET pricing = false WHERE user_id = $1",
      [actor.userId],
    );
    expect(await h.access.status(operator)).toMatchObject({
      required: false,
      operator: false,
      readiness: "mfa-satisfied",
    });
  });

  it("locks repeated invalid challenges across primary sessions without elevating them", async () => {
    h.clock.set("2026-11-05T11:00:00Z");
    await h.signIn("mfa-lock@example.com");
    const first = await h.signIn("mfa-lock@example.com", false);
    const second = await h.signIn("mfa-lock@example.com", false);
    for (let attempt = 0; attempt < 5; attempt++) {
      h.clock.set(`2026-11-05T11:0${attempt}:00Z`);
      await expect(
        h.auth.api.verifyBackupCode({
          headers: attempt % 2 ? first : second,
          body: { code: "wrong-wrong" },
        }),
      ).rejects.toBeDefined();
    }
    h.clock.set("2026-11-05T11:05:00Z");
    await expect(
      h.auth.api.verifyBackupCode({
        headers: first,
        body: { code: "wrong-wrong" },
      }),
    ).rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    expect(await h.access.status(first)).toMatchObject({ verified: false });
  });

  it("applies newly granted Admin scope immediately and keeps missing enrollment visible", async () => {
    h.clock.set("2026-11-05T12:00:00Z");
    const owner = await h.signIn("mfa-promotion-owner@example.com");
    const sales = await h.signIn("mfa-promotion-sales@example.com", false);
    const business = await h.application.createBusiness(owner, {
      name: "Promotion Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    await h.team.invite(owner, business.id, {
      email: "mfa-promotion-sales@example.com",
      role: "salesperson",
    });
    const mail = h.invitations.sent.at(-1);
    if (!mail) throw new Error("Missing invitation");
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    expect(await h.application.getProfile(sales, business.id)).toMatchObject({
      name: "Promotion Business",
    });
    const actor = await h.authenticate(sales);
    await h.team.changeRole(owner, business.id, {
      userId: actor.userId,
      role: "admin",
    });
    expect(await h.access.status(sales)).toMatchObject({
      required: true,
      enrolled: false,
      verified: false,
      readiness: "mfa-incomplete",
    });
    expect((await h.team.getTeam(owner, business.id)).members).toContainEqual(
      expect.objectContaining({
        userId: actor.userId,
        role: "admin",
        mfaEnrolled: false,
      }),
    );
    const sent = h.invitations.sent.length;
    await expect(
      h.team.invite(sales, business.id, {
        email: "mfa-no-send@example.com",
        role: "salesperson",
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(h.invitations.sent).toHaveLength(sent);
    const response = await h.teamHttp.access(
      new Request(
        `http://localhost:3000/api/businesses/${business.id}/access?capability=integrations.manage`,
        { headers: sales },
      ),
      business.id,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MFA_REQUIRED" });
    expect(JSON.stringify(h.diagnostics)).not.toMatch(
      /mfa-promotion|secret|token|recovery/,
    );
  });

  it("invalidates old assurance and recovery codes when replacing the authenticator", async () => {
    h.clock.set("2026-11-05T13:00:00Z");
    const owner = await h.signIn("mfa-replace@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Replacement Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const second = await h.signIn("mfa-replace@example.com");
    const codes = await h.auth.api.generateBackupCodes({
      headers: owner,
      body: {},
    });
    const disabled = await h.auth.api.disableTwoFactor({
      headers: owner,
      body: {},
      asResponse: true,
    });
    expect(disabled.status).toBe(200);
    const replacement = new Headers({
      cookie: disabled.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; "),
    });
    expect(await h.access.status(replacement)).toMatchObject({
      enrolled: false,
      verified: false,
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(
      h.application.getProfile(second, business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const setup = await h.auth.api.enableTwoFactor({
      headers: replacement,
      body: {},
    });
    if (setup.method !== "totp") throw new Error("Expected authenticator");
    await expect(
      h.auth.api.verifyBackupCode({
        headers: replacement,
        body: { code: codes.backupCodes[0] },
      }),
    ).rejects.toBeDefined();
    await h.reapplySchema();
    h.clock.set("2026-11-05T13:01:00Z");
    const verified = await h.auth.api.verifyTOTP({
      headers: replacement,
      body: { code: authenticatorCode(setup.totpURI, h.clock.now()) },
      asResponse: true,
    });
    const fresh = new Headers({
      cookie: verified.headers
        .getSetCookie()
        .map((x) => x.split(";")[0])
        .join("; "),
    });
    expect(await h.application.getProfile(fresh, business.id)).toMatchObject({
      name: "Replacement Business",
    });
    await expect(
      h.application.getProfile(second, business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    h.clock.set("2026-11-06T01:01:00Z");
    await expect(
      h.application.getProfile(fresh, business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("prevents primary-only session enumeration or revocation while preserving own sign-out", async () => {
    h.clock.set("2026-11-05T14:00:00Z");
    const verified = await h.signIn("mfa-sessions@example.com");
    const primary = await h.signIn("mfa-sessions@example.com", false);
    const headers = new Headers(primary);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    const listed = await h.auth.handler(
      new Request("http://localhost:3000/api/auth/list-sessions", { headers }),
    );
    expect(listed.status).toBe(403);
    for (const path of ["revoke-other-sessions", "revoke-sessions"]) {
      const response = await h.auth.handler(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: "POST",
          headers,
          body: "{}",
        }),
      );
      expect(response.status).toBe(403);
    }
    const session = await h.auth.api.getSession({ headers: verified });
    if (!session) throw new Error("Verified session was revoked");
    const revoke = await h.auth.handler(
      new Request("http://localhost:3000/api/auth/revoke-session", {
        method: "POST",
        headers,
        body: JSON.stringify({ token: session.session.token }),
      }),
    );
    expect(revoke.status).toBe(403);
    expect(await h.access.status(verified)).toMatchObject({ verified: true });
    expect(await h.auth.api.listSessions({ headers: verified })).toHaveLength(
      2,
    );
    await h.signOut(primary);
    expect(await h.auth.api.getSession({ headers: primary })).toBeNull();
    expect(await h.access.status(verified)).toMatchObject({ verified: true });
  });
});
