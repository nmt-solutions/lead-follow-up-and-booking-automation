import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("Business offerings, buyers and Home market", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    harness = await createHarness();
  });
  beforeEach(() => harness.clock.set("2026-11-05T09:00:00Z"));
  afterAll(async () => {
    await harness?.close();
  });

  const steel = {
    offering: "Galvanized steel sheets",
    specifications: "ASTM A653, 1–3 mm",
    minimumOrder: "500 kg per order",
    deliveryConstraints:
      "Unloading equipment required; delivery within 150 miles",
    serviceConstraints: "Cutting requires a drawing",
    address: {
      street: "10 River Road",
      locality: "Newark",
      region: "New Jersey",
      postalCode: "07102",
      country: "United States",
    },
    homeMarket: "New Jersey, United States",
    homeMarketConfirmed: true,
    additionalMarkets: ["New York, United States", "Ontario, Canada"],
    buyerCategories: [
      {
        label: "Fabrication businesses",
        identity: "organization",
        use: "business_end_user",
        requiresBuyingRequest: false,
      },
      {
        label: "Independent fabricators",
        identity: "sole_proprietor",
        use: "business_end_user",
        requiresBuyingRequest: false,
      },
      {
        label: "Steel distributors",
        identity: "organization",
        use: "reseller",
        requiresBuyingRequest: false,
      },
    ],
    buyersReviewed: true,
    exclusions: ["Scrap dealers", "Personal hobby projects"],
  };

  it("saves two industries through the same commands and returns their distinct confirmed configuration", async () => {
    const owner = await harness.signIn("config-owner@example.com");
    const a = await harness.application.createBusiness(owner, {
      name: "Hudson Steel",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const b = await harness.application.createBusiness(owner, {
      name: "Scissors & Co",
      offering: "Scissors",
      homeMarket: "",
      website: "",
    });
    expect(
      (await harness.application.getProfile(owner, a.id)).configuration,
    ).toBeNull();
    await harness.application.saveConfiguration(owner, a.id, steel);
    await harness.application.saveConfiguration(owner, b.id, {
      ...steel,
      offering: "Professional scissors",
      specifications: "6-inch stainless steel, left- and right-handed",
      minimumOrder: "24 pairs",
      deliveryConstraints: "Tracked UK delivery",
      serviceConstraints: "Sharpening by appointment",
      address: {
        street: "",
        locality: "Sheffield",
        region: "",
        postalCode: "",
        country: "United Kingdom",
      },
      homeMarket: "United Kingdom",
      additionalMarkets: ["Ireland"],
      buyerCategories: [
        {
          label: "Independent barbers and tailors",
          identity: "sole_proprietor",
          use: "business_end_user",
          requiresBuyingRequest: false,
        },
        {
          label: "Retailers",
          identity: "organization",
          use: "reseller",
          requiresBuyingRequest: false,
        },
      ],
      exclusions: ["Children's craft scissors"],
    });
    await harness.reapplySchema();
    const savedSteel = await harness.application.getProfile(owner, a.id);
    expect(savedSteel).toMatchObject({
      offering: steel.offering,
      homeMarket: steel.homeMarket,
      configuration: {
        specifications: "ASTM A653, 1–3 mm",
        minimumOrder: "500 kg per order",
        deliveryConstraints: steel.deliveryConstraints,
        serviceConstraints: steel.serviceConstraints,
        additionalMarkets: ["New York, United States", "Ontario, Canada"],
        buyerCategories: steel.buyerCategories,
        exclusions: ["Scrap dealers", "Personal hobby projects"],
        homeMarketConfirmedAt: "2026-11-05T09:00:00.000Z",
        buyersReviewedAt: "2026-11-05T09:00:00.000Z",
      },
    });
    expect(await harness.application.getProfile(owner, b.id)).toMatchObject({
      homeMarket: "United Kingdom",
      configuration: {
        minimumOrder: "24 pairs",
        exclusions: ["Children's craft scissors"],
        additionalMarkets: ["Ireland"],
      },
    });
    expect(harness.invitations.sent).toEqual([]);
    expect(harness.mail.sent.map((message) => message.email)).toEqual([
      "config-owner@example.com",
    ]);
  });

  it("requires reviewed buyers and an explicit Home market confirmation, and restricts personal-use targeting", async () => {
    const owner = await harness.signIn("config-validation@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Validated configuration",
      offering: "Steel",
      homeMarket: "Unconfirmed legacy market",
      website: "",
    });
    const suggestion = await harness.application.suggestHomeMarket(
      owner,
      business.id,
      steel.address,
    );
    expect(suggestion).toEqual({
      homeMarket: "Newark, New Jersey, United States",
    });
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration,
    ).toBeNull();
    expect(
      await harness.application.suggestHomeMarket(owner, business.id, {
        ...steel.address,
        country: "",
      }),
    ).toEqual({ homeMarket: null });
    await harness.application.saveConfiguration(owner, business.id, steel);
    for (const invalid of [
      { ...steel, homeMarketConfirmed: false },
      { ...steel, buyersReviewed: false },
      { ...steel, additionalMarkets: ["new jersey, united states"] },
      { ...steel, buyerCategories: [] },
      { ...steel, specifications: "x".repeat(4001) },
      { ...steel, businessId: business.id },
      {
        ...steel,
        buyerCategories: [
          {
            label: "Consumers",
            identity: "individual",
            use: "personal_use",
            requiresBuyingRequest: false,
          },
        ],
      },
      {
        ...steel,
        buyerCategories: [
          {
            label: "Consumers",
            identity: "organization",
            use: "personal_use",
            requiresBuyingRequest: true,
          },
        ],
      },
      {
        ...steel,
        buyerCategories: [
          {
            label: "Barbers",
            identity: "individual",
            use: "business_end_user",
            requiresBuyingRequest: false,
          },
        ],
      },
    ]) {
      await expect(
        harness.application.saveConfiguration(owner, business.id, invalid),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration
        ?.exclusions,
    ).toEqual(["Scrap dealers", "Personal hobby projects"]);
    const consumer = {
      label: "Home sewing requests",
      identity: "individual",
      use: "personal_use",
      requiresBuyingRequest: true,
    };
    await harness.application.saveConfiguration(owner, business.id, {
      ...steel,
      buyerCategories: [consumer],
    });
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration
        ?.buyerCategories,
    ).toEqual([consumer]);
    harness.clock.set("2026-11-05T10:00:00Z");
    await harness.application.updateProfile(owner, business.id, {
      name: "Validated configuration",
      offering: "Scissors",
      homeMarket: "Canada",
      website: "",
    });
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration,
    ).toMatchObject({ homeMarketConfirmedAt: null, buyersReviewedAt: null });
  });

  it("isolates configuration across authenticated HTTP and trusted worker commands, including current roles and MFA", async () => {
    const owner = await harness.signIn("config-access@example.com");
    const outsider = await harness.signIn("config-outsider@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Private configuration",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    function request(
      headers: Headers,
      input: unknown = steel,
      origin = "http://localhost:3000",
    ) {
      const merged = new Headers(headers);
      merged.set("origin", origin);
      merged.set("content-type", "application/json");
      return new Request("http://localhost:3000/api/businesses/configuration", {
        method: "PUT",
        headers: merged,
        body: JSON.stringify(input),
      });
    }
    expect(
      (await harness.http.configure(request(owner), business.id)).status,
    ).toBe(200);
    expect(
      (await harness.http.configure(request(outsider), business.id)).status,
    ).toBe(404);
    expect(
      (
        await harness.http.get(
          new Request("http://localhost:3000", { headers: outsider }),
          business.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (await harness.http.configure(request(new Headers()), business.id))
        .status,
    ).toBe(401);
    expect(
      (
        await harness.http.configure(
          request(owner, steel, "https://attacker.example"),
          business.id,
        )
      ).status,
    ).toBe(403);
    await harness.team.invite(owner, business.id, {
      email: "config-sales@example.com",
      role: "salesperson",
    });
    const mail = harness.invitations.sent.at(-1);
    if (!mail) throw new Error("Invitation missing");
    const sales = await harness.signIn("config-sales@example.com");
    await harness.team.accept(sales, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    expect(
      (await harness.application.getProfile(sales, business.id)).configuration
        ?.minimumOrder,
    ).toBe("500 kg per order");
    expect(
      (await harness.http.configure(request(sales), business.id)).status,
    ).toBe(403);
    const worker = harness.workerFor(await harness.authenticate(outsider));
    await expect(
      worker.saveConfiguration(undefined, business.id, steel),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      worker.getProfile(undefined, business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const primaryOnly = await harness.signIn(
      "config-access@example.com",
      false,
    );
    expect(
      (await harness.http.configure(request(primaryOnly), business.id)).status,
    ).toBe(403);
    const invalid = await harness.http.configure(
      request(owner, {
        ...steel,
        specifications: { secret: "private-payload" },
      }),
      business.id,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("private-payload");
    expect(JSON.stringify(harness.diagnostics)).not.toMatch(
      /private-payload|ASTM|config-access@example/,
    );
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration
        ?.minimumOrder,
    ).toBe("500 kg per order");
  });

  it("saves allowed multilingual configuration fields through the HTTP boundary", async () => {
    const owner = await harness.signIn("config-multilingual@example.com");
    const business = await harness.application.createBusiness(owner, {
      name: "Multilingual supply",
      offering: "Products",
      homeMarket: "",
      website: "",
    });
    const input = {
      ...steel,
      offering: "鋼".repeat(4000),
      specifications: "鋼".repeat(4000),
      deliveryConstraints: "鋼".repeat(2000),
      serviceConstraints: "鋼".repeat(2000),
    };
    const headers = new Headers(owner);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    const response = await harness.http.configure(
      new Request("http://localhost:3000/api/businesses/configuration", {
        method: "PUT",
        headers,
        body: JSON.stringify(input),
      }),
      business.id,
    );
    expect(response.status).toBe(200);
    expect(
      (await harness.application.getProfile(owner, business.id)).configuration
        ?.specifications,
    ).toBe("鋼".repeat(4000));
  });
});
