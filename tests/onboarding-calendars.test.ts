import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { googleFixture } from "./support/google-calendar";
import { microsoftFixture } from "./support/microsoft-calendar";
import { createGoogleCalendarApplication } from "../src/application/google-calendar";
import { createMicrosoftCalendarApplication } from "../src/application/microsoft-calendar";
import { runtimeDatabase } from "../src/db/runtime";

describe("onboarding calendar consent", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  it.each(["google", "microsoft"] as const)(
    "returns %s consent cancellation to the same Business setup step",
    async (provider) => {
      const credentials = await h.signIn(`onboarding-${provider}@example.com`);
      const business = await h.application.createBusiness(credentials, {
        name: "New business",
        offering: "Steel components",
        homeMarket: "Pune, India",
        website: "",
      });
      const shared = {
        database: runtimeDatabase(h.runtime),
        access: h.access,
        clock: h.clock,
      };
      const application =
        provider === "google"
          ? createGoogleCalendarApplication({
              ...shared,
              ...googleFixture(),
            })
          : createMicrosoftCalendarApplication({
              ...shared,
              ...microsoftFixture(h.clock),
            });
      const returnPath = `/onboarding/${business.id}?step=calendar`;
      const started = await application.start(credentials, business.id, {
        returnPath,
      });
      for (const bad of [
        `/onboarding/${randomUUID()}?step=calendar`,
        "/onboarding/../businesses",
        "https://other.example/",
        `${returnPath}&next=https://other.example/`,
      ]) {
        await expect(
          application.start(credentials, business.id, { returnPath: bad }),
        ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      }
      const callback = {
        state: new URL(started.authorizationUrl).searchParams.get("state"),
        error: "access_denied",
      };
      expect(
        await application.callback(credentials, business.id, callback),
      ).toEqual({ returnPath });
      await expect(
        application.callback(credentials, business.id, callback),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect((await application.read(credentials, business.id)).reason).toBe(
        "consent_denied",
      );
    },
  );
});
