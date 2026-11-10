import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { persistPaidSubscription } from "./support/paid-subscription";
import { deterministicPayments } from "./support/payment-gateway";
import { runtimeDatabase } from "../src/db/runtime";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import {
  creditPercentage,
  creditUsageSchema,
} from "../src/models/credit-usage";

describe("Business credit usage", () => {
  let h: Awaited<ReturnType<typeof createHarness>> | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it("returns only the current business's allowances, rechecks membership and expires the allowance", async () => {
    h = await createHarness();
    const owner = await h.signIn("credits-owner@example.com");
    const other = await h.signIn("credits-other@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Credit business",
      offering: "Data extraction",
      website: "",
      homeMarket: "India",
    });
    const unrelated = await h.application.createBusiness(other, {
      name: "Other business",
      offering: "Consulting",
      website: "",
      homeMarket: "India",
    });
    const app = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway: deterministicPayments(h.clock),
    });
    expect(await app.usage(owner, business.id)).toEqual({
      active: false,
      paidThrough: null,
      allowances: null,
    });
    await persistPaidSubscription(h, owner, business.id, {
      markets: ["India"],
      discovery: { quantity: 100, unit: "credits" },
      automation: { quantity: 20, unit: "provider calls" },
    });
    const period = await h.admin.query<{ id: string }>(
      "select id from subscription_period where business_id=$1",
      [business.id],
    );
    await h.admin.query(
      "insert into subscription_usage(id,business_id,period_id,kind,operation_id,quantity,unit,at) values($1,$2,$3,'discovery',$4,25,'credits',$5)",
      [
        randomUUID(),
        business.id,
        period.rows[0].id,
        randomUUID(),
        h.clock.now(),
      ],
    );
    const usage = creditUsageSchema.parse(await app.usage(owner, business.id));
    expect(usage).toMatchObject({
      active: true,
      allowances: {
        discovery: { included: 100, reserved: 25, remaining: 75 },
        automation: { included: 20, reserved: 0, remaining: 20 },
      },
    });
    expect(Object.keys(usage).sort()).toEqual([
      "active",
      "allowances",
      "paidThrough",
    ]);
    expect(
      usage.allowances && creditPercentage(usage.allowances.discovery),
    ).toBe(25);
    await expect(app.usage(other, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(app.usage(owner, unrelated.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(app.usage(new Headers(), business.id)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    await h.team.invite(owner, business.id, {
      email: "credits-member@example.com",
      role: "salesperson",
    });
    const notice = h.invitations.sent.at(-1);
    if (!notice) throw new Error("Invitation was not recorded");
    const member = await h.signIn("credits-member@example.com");
    await h.team.accept(member, {
      token: new URLSearchParams(new URL(notice.url).hash.slice(1)).get(
        "token",
      ),
    });
    expect(await app.usage(member, business.id)).toEqual(usage);
    await expect(app.workspace(member, business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const actor = await h.authenticate(member);
    await h.team.removeMember(owner, business.id, actor);
    await expect(app.usage(member, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    h.clock.set("2027-01-01T09:00:00Z");
    const renewedSession = await h.signIn("credits-owner@example.com");
    expect(await app.usage(renewedSession, business.id)).toEqual({
      active: false,
      paidThrough: null,
      allowances: null,
    });
  });

  it("keeps percentage values bounded and distinguishes zero allowance from unused credits", () => {
    const pool = {
      included: 100,
      reserved: 0,
      remaining: 100,
      unit: "credits",
    };
    expect(creditPercentage(pool)).toBe(0);
    expect(creditPercentage({ ...pool, reserved: 100, remaining: 0 })).toBe(
      100,
    );
    expect(creditPercentage({ ...pool, reserved: 150, remaining: 0 })).toBe(
      100,
    );
    expect(creditPercentage({ ...pool, included: 0, remaining: 0 })).toBeNull();
    expect(creditPercentage({ ...pool, reserved: Number.NaN })).toBeNull();
    expect(
      creditPercentage({ ...pool, included: Number.POSITIVE_INFINITY }),
    ).toBeNull();
  });
});
