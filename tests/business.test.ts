import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("private Business setup", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeAll(async () => {
    harness = await createHarness();
  });
  beforeEach(() => {
    harness.clock.set("2026-11-05T09:00:00Z");
  });
  afterAll(async () => {
    await harness?.close();
  });

  it("an owner signs in, creates a Business, saves its profile and returns to it", async () => {
    const owner = await harness.signIn("owner@example.com");
    const created = await harness.application.createBusiness(owner, {
      name: "Hudson Steel",
      offering: "Steel sheet for fabrication businesses",
      homeMarket: "New York, United States",
      website: "https://steel.example.com",
    });
    expect(created).toMatchObject({
      name: "Hudson Steel",
      offering: "Steel sheet for fabrication businesses",
      createdAt: new Date("2026-11-05T09:00:00Z"),
    });

    harness.clock.set("2026-11-05T10:00:00Z");
    await harness.application.updateProfile(owner, created.id, {
      name: "Hudson Steel Supply",
      offering: "Galvanized sheet, minimum order 500 kg",
      homeMarket: "New York and New Jersey, United States",
      website: "https://steel.example.com",
    });

    await harness.signOut(owner);
    await expect(
      harness.application.listBusinesses(owner),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const returningOwner = await harness.signIn("owner@example.com");
    expect(await harness.application.listBusinesses(returningOwner)).toEqual([
      expect.objectContaining({ id: created.id, name: "Hudson Steel Supply" }),
    ]);
    expect(
      await harness.application.getProfile(returningOwner, created.id),
    ).toMatchObject({
      offering: "Galvanized sheet, minimum order 500 kg",
      homeMarket: "New York and New Jersey, United States",
      updatedAt: new Date("2026-11-05T10:00:00Z"),
    });
    expect(harness.mail.sent.map((message) => message.email)).toEqual([
      "owner@example.com",
      "owner@example.com",
    ]);
  });

  it("rejects invalid profile commands without overwriting saved information", async () => {
    harness.clock.set("2026-11-05T11:00:00Z");
    const owner = await harness.signIn("validation@example.com");
    const profile = {
      name: "Scissors & Co",
      offering: "Scissors for barbers and tailors",
      homeMarket: "United Kingdom",
      website: "",
    };
    const created = await harness.application.createBusiness(owner, profile);
    await expect(
      harness.application.updateProfile(owner, created.id, {
        ...profile,
        website: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      await harness.application.getProfile(owner, created.id),
    ).toMatchObject(profile);
    await expect(
      harness.application.getProfile(owner, "not-a-business-id"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      harness.application.createBusiness(new Headers(), profile),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("isolates two owners across web and worker commands on reused connections", async () => {
    harness.clock.set("2026-11-05T12:00:00Z");
    const steelOwner = await harness.signIn("steel@example.com");
    const scissorsOwner = await harness.signIn("scissors@example.com");
    const steel = await harness.application.createBusiness(steelOwner, {
      name: "Private steel profile",
      offering: "Steel sheets",
      homeMarket: "United States",
      website: "",
    });
    const scissors = await harness.application.createBusiness(scissorsOwner, {
      name: "Private scissors profile",
      offering: "Scissors for resellers",
      homeMarket: "United Kingdom",
      website: "",
    });
    const forgedProfile = {
      name: "Changed by another Business",
      offering: "Unwanted change",
      homeMarket: "",
      website: "",
    };
    await expect(
      harness.application.getProfile(scissorsOwner, steel.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      harness.application.updateProfile(scissorsOwner, steel.id, forgedProfile),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const worker = harness.workerFor(await harness.authenticate(scissorsOwner));
    await expect(worker.getProfile(undefined, steel.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      worker.updateProfile(undefined, steel.id, forgedProfile),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await worker.getProfile(undefined, scissors.id)).toMatchObject({
      name: "Private scissors profile",
    });

    const [steelList, scissorsList] = await Promise.all([
      harness.application.listBusinesses(steelOwner),
      harness.application.listBusinesses(scissorsOwner),
    ]);
    expect(steelList.map((profile) => profile.name)).toEqual([
      "Private steel profile",
    ]);
    expect(scissorsList.map((profile) => profile.name)).toEqual([
      "Private scissors profile",
    ]);
    await expect(
      harness.application.createBusiness(scissorsOwner, {
        ...forgedProfile,
        userId: (await harness.authenticate(steelOwner)).userId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not authenticate an expired or reused email link", async () => {
    harness.clock.set("2026-11-05T13:00:00Z");
    await harness.signIn("single-use@example.com");
    const link = harness.mail.sent.at(-1);
    if (!link) throw new Error("Missing email link");
    const reused = await harness.auth.handler(new Request(link.url));
    expect(reused.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(reused.headers.get("set-cookie")).toBeNull();

    await harness.auth.api.signInMagicLink({
      body: {
        email: "expired@example.com",
        callbackURL: "/businesses",
        errorCallbackURL: "/sign-in",
      },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    const expiring = harness.mail.sent.at(-1);
    if (!expiring) throw new Error("Missing email link");
    harness.clock.set("2026-11-05T13:11:00Z");
    const expired = await harness.auth.handler(new Request(expiring.url));
    expect(expired.headers.get("location")).toContain("error=");
    expect(expired.headers.get("set-cookie")).toBeNull();
  });

  it("authenticates HTTP commands, rejects foreign origins and returns safe failures", async () => {
    harness.clock.set("2026-11-05T14:00:00Z");
    const owner = await harness.signIn("http-owner@example.com");
    const another = await harness.signIn("http-other@example.com");
    const profile = {
      name: "HTTP Business",
      offering: "Private offerings",
      homeMarket: "",
      website: "",
    };
    function request(
      headers: Headers,
      body: string,
      origin = "http://localhost:3000",
    ) {
      const merged = new Headers(headers);
      merged.set("content-type", "application/json");
      merged.set("origin", origin);
      return new Request("http://localhost:3000/api/businesses", {
        method: "POST",
        headers: merged,
        body,
      });
    }
    const created = await harness.http.create(
      request(owner, JSON.stringify(profile)),
    );
    expect(created.status).toBe(201);
    const [saved] = await harness.application.listBusinesses(owner);
    expect(saved).toMatchObject(profile);
    expect(
      (
        await harness.http.create(
          request(new Headers(), JSON.stringify(profile)),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await harness.http.update(
          request(owner, JSON.stringify(profile), "https://attacker.example"),
          saved.id,
        )
      ).status,
    ).toBe(403);
    const denied = await harness.http.get(
      new Request("http://localhost:3000", { headers: another }),
      saved.id,
    );
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({
      code: "NOT_FOUND",
      message: "Business not found.",
      requestId: expect.any(String),
    });
    const malformed = await harness.http.create(
      request(owner, '{"private-secret":'),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain("private-secret");
    expect(
      (await harness.http.create(request(owner, "x".repeat(32769)))).status,
    ).toBe(400);
    expect(JSON.stringify(harness.diagnostics)).not.toContain(
      "Private offerings",
    );
    expect(JSON.stringify(harness.diagnostics)).not.toContain("private-secret");
    expect(JSON.stringify(harness.diagnostics)).not.toContain(
      "http-owner@example.com",
    );
  });
});
