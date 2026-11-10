import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness } from "./support/harness";
import { authenticatorCode } from "./support/totp";
import { runtimeDatabase } from "../src/db/runtime";
import { account, user } from "../src/db/schema";
import { createPasswordApplication } from "../src/application/password";
import { createHash } from "node:crypto";

describe("password accounts with authenticator verification", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let counter = 0;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  function post(path: string, body: unknown, previous = new Headers()) {
    const headers = new Headers(previous);
    headers.set("content-type", "application/json");
    headers.set("origin", "http://localhost:3000");
    headers.set("x-forwarded-for", `203.0.113.${++counter}`);
    return h.auth.handler(
      new Request(`http://localhost:3000/api/auth/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }
  function cookies(response: Response, previous = new Headers()) {
    const values = new Map(
      (previous.get("cookie") ?? "")
        .split("; ")
        .filter(Boolean)
        .map((value) => [value.split("=")[0], value]),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const value = cookie.split(";")[0];
      values.set(value.split("=")[0], value);
    }
    return new Headers({ cookie: [...values.values()].join("; ") });
  }
  function passwords() {
    return createPasswordApplication({
      auth: h.auth,
      access: h.access,
      database: runtimeDatabase(h.runtime),
      clock: h.clock,
    });
  }
  const profile = {
    firstName: "Asha",
    lastName: "Rao",
    accountType: "company",
    companyName: "Rao Metals",
  };
  const originalPassword = "a-long-private-password-2026";

  it("validates signup profiles, verifies email before password sign-in, and retains company details", async () => {
    const dbTime = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() as now",
    );
    h.clock.set(dbTime.rows[0].now.toISOString());
    const email = "password-signup@example.com";
    expect(
      (
        await post("sign-up/email", {
          name: "Asha",
          email,
          password: originalPassword,
          ...profile,
          companyName: "",
        })
      ).status,
    ).toBe(400);
    const signup = await post("sign-up/email", {
      name: "untrusted name",
      email,
      password: originalPassword,
      ...profile,
    });
    expect(signup.status).toBe(200);
    expect(
      await runtimeDatabase(h.runtime)
        .select({ userId: account.userId, providerId: account.providerId })
        .from(account),
    ).toHaveLength(1);
    expect(
      await h.auth.api.getSession({ headers: cookies(signup) }),
    ).toBeNull();
    expect(
      (await post("sign-in/email", { email, password: originalPassword }))
        .status,
    ).toBe(403);
    expect(
      (
        await post("send-verification-email", {
          email,
          callbackURL: "/security",
        })
      ).status,
    ).toBe(200);
    const message = h.mail.sent.at(-1);
    if (!message || message.kind !== "verification")
      throw new Error("Missing verification email");
    const token = new URL(message.url).searchParams.get("token");
    if (!token) throw new Error("Missing verification token");
    const authority = `email-verification:${createHash("sha256").update(token).digest("base64url")}`;
    const source = () =>
      h.admin.query<{ value: unknown }>(
        "select notification_source('authentication','fixture',$1,null,null) as value",
        [authority],
      );
    expect((await source()).rows[0].value).not.toBeNull();
    const verified = await h.auth.handler(new Request(message.url));
    const headers = cookies(verified);
    expect((await source()).rows[0].value).toBeNull();
    const identity = await h.auth.api.getSession({ headers });
    expect(identity?.user).toMatchObject({
      ...profile,
      name: "Asha Rao",
      emailVerified: true,
    });
    expect((await h.access.status(headers)).operator).toBe(false);
    // Existing verified accounts receive a generic signup response and are not overwritten.
    await post("sign-up/email", {
      name: "Other",
      email,
      password: "different-long-password",
      ...profile,
      firstName: "Other",
    });
    expect((await h.auth.api.getSession({ headers }))?.user.firstName).toBe(
      "Asha",
    );
    const [credential] = await runtimeDatabase(h.runtime)
      .select()
      .from(account)
      .where(eq(account.userId, identity!.user.id));
    expect(credential.password).toBeTruthy();
    expect(credential.password).not.toBe(originalPassword);
    expect((await post("two-factor/enable", {}, headers)).status).toBe(400);
    const enrollment = await h.auth.api.enableTwoFactor({
      headers,
      body: { password: originalPassword },
    });
    if (enrollment.method !== "totp") throw new Error("Missing authenticator");
    const complete = await post(
      "two-factor/verify-totp",
      { code: authenticatorCode(enrollment.totpURI, h.clock.now()) },
      headers,
    );
    expect(complete.status).toBe(200);
    expect((await h.access.status(cookies(complete, headers))).verified).toBe(
      true,
    );
    expect(
      await (
        await post("sign-in/email", { email, password: originalPassword })
      ).json(),
    ).toMatchObject({ twoFactorRedirect: true });
  });

  it("creates a session only after password plus a valid authenticator, and consumes recovery codes once", async () => {
    const email = "password-challenge@example.com";
    let primary = await h.signIn(email, false);
    const setup = await h.auth.api.enableTwoFactor({
      headers: primary,
      body: {},
    });
    if (setup.method !== "totp") throw new Error("Missing authenticator");
    const enrolled = await post(
      "two-factor/verify-totp",
      { code: authenticatorCode(setup.totpURI, h.clock.now()) },
      primary,
    );
    expect(enrolled.status).toBe(200);
    primary = cookies(enrolled, primary);
    await passwords().save(primary, { password: originalPassword });
    const challenge = await post("sign-in/email", {
      email,
      password: originalPassword,
    });
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookies(challenge);
    expect(await h.auth.api.getSession({ headers: pending })).toBeNull();
    expect(
      (await post("two-factor/verify-totp", { code: "not-a-code" }, pending))
        .status,
    ).toBe(400);
    const wrong =
      authenticatorCode(setup.totpURI, h.clock.now()) === "000000"
        ? "111111"
        : "000000";
    expect(
      (await post("two-factor/verify-totp", { code: wrong }, pending)).status,
    ).toBe(401);
    expect(
      (
        await post(
          "two-factor/verify-totp",
          {
            code: authenticatorCode(setup.totpURI, h.clock.now()),
            trustDevice: true,
          },
          pending,
        )
      ).status,
    ).toBe(400);
    const verified = await post(
      "two-factor/verify-totp",
      { code: authenticatorCode(setup.totpURI, h.clock.now()) },
      pending,
    );
    expect(verified.status).toBe(200);
    expect((await h.access.status(cookies(verified))).verified).toBe(true);
    expect(
      (
        await post(
          "two-factor/verify-totp",
          { code: authenticatorCode(setup.totpURI, h.clock.now()) },
          pending,
        )
      ).status,
    ).toBe(401);
    const recoveryChallenge = cookies(
      await post("sign-in/email", { email, password: originalPassword }),
    );
    const recovery = await post(
      "two-factor/verify-backup-code",
      { code: setup.backupCodes[0] },
      recoveryChallenge,
    );
    expect(recovery.status).toBe(200);
    expect((await h.access.status(cookies(recovery))).verified).toBe(true);
    const replay = cookies(
      await post("sign-in/email", { email, password: originalPassword }),
    );
    expect(
      (
        await post(
          "two-factor/verify-backup-code",
          { code: setup.backupCodes[0] },
          replay,
        )
      ).status,
    ).toBe(401);
  });

  it("requires fresh MFA for password recovery and revokes other sessions atomically", async () => {
    const email = "password-reset@example.com";
    let primary = await h.signIn(email, false);
    await expect(
      passwords().save(primary, { password: originalPassword }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(
      (
        await post(
          "change-password",
          {
            currentPassword: originalPassword,
            newPassword: "bypass-long-password-2026",
          },
          primary,
        )
      ).status,
    ).toBe(403);
    const setup = await h.auth.api.enableTwoFactor({
      headers: primary,
      body: {},
    });
    if (setup.method !== "totp") throw new Error("Missing authenticator");
    primary = cookies(
      await post(
        "two-factor/verify-totp",
        { code: authenticatorCode(setup.totpURI, h.clock.now()) },
        primary,
      ),
      primary,
    );
    const other = await h.signIn(email, false);
    await passwords().save(primary, { password: originalPassword });
    expect(await h.auth.api.getSession({ headers: other })).toBeNull();
    const recovery = await h.signIn(email, false);
    await expect(
      passwords().save(recovery, { password: "new-private-password-2026" }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(
      (
        await post(
          "two-factor/verify-backup-code",
          { code: setup.backupCodes[0] },
          recovery,
        )
      ).status,
    ).toBe(200);
    await passwords().save(recovery, { password: "new-private-password-2026" });
    expect(await h.auth.api.getSession({ headers: primary })).toBeNull();
    expect(
      (await post("sign-in/email", { email, password: originalPassword }))
        .status,
    ).toBe(401);
    expect(
      await (
        await post("sign-in/email", {
          email,
          password: "new-private-password-2026",
        })
      ).json(),
    ).toMatchObject({ twoFactorRedirect: true });
    h.clock.set(
      new Date(h.clock.now().getTime() + 16 * 60 * 1000).toISOString(),
    );
    await expect(
      passwords().save(recovery, { password: originalPassword }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("normalizes personal profiles without granting business or platform privileges", async () => {
    const email = "personal-signup@example.com";
    expect(
      (
        await post("sign-up/email", {
          name: "Asha",
          email,
          password: originalPassword,
          ...profile,
          accountType: "personal",
          companyName: "Ignored",
        })
      ).status,
    ).toBe(200);
    const headers = await h.signIn(email, false);
    const identity = await h.auth.api.getSession({ headers });
    expect(identity?.user).toMatchObject({
      firstName: "Asha",
      lastName: "Rao",
      accountType: "personal",
      companyName: "",
    });
    const [saved] = await runtimeDatabase(h.runtime)
      .select()
      .from(user)
      .where(eq(user.id, identity!.user.id));
    expect(saved.accountType).toBe("personal");
    expect(await h.access.status(headers)).toMatchObject({
      operator: false,
      required: false,
      verified: false,
    });
  });
});
