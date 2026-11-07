import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import { createNotificationApplication } from "../../src/application/notifications";
import { createNotificationRepository } from "../../src/db/notification-repository";
import { createResendProvider } from "../../src/notifications/resend";
import { notificationVault } from "../../src/notifications/vault";

export async function financialNotifications(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  const current = await h.admin.query<{ now: Date }>(
    "select clock_timestamp() as now",
  );
  h.clock.set(current.rows[0].now.toISOString());
  const operator = await h.signIn(
      "financial-notification-operator@example.com",
    ),
    actor = await h.authenticate(operator);
  await h.admin.query(
    "insert into platform_operator(user_id,notifications) values($1,true)",
    [actor.userId],
  );
  const configuration = {
    account: "financial-fixture",
    mode: "production" as const,
    from: "auth@platform.example",
    domainId: "c1bcab80-7951-4e78-94ba-3c615069da77",
    apiKey: "fixture-send",
    readApiKey: "fixture-read",
    origin: "http://localhost:3000",
  };
  const effects: { key: string; body: Record<string, unknown>; id: string }[] =
      [],
    accepted = new Map<string, (typeof effects)[number]>();
  const native: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/usage"))
      return Response.json({
        object: "usage",
        emails: {
          daily: {
            used: 0,
            sent: 0,
            received: 0,
            limit: 100,
            resets_at: new Date(
              h.clock.now().getTime() + 86400000,
            ).toISOString(),
          },
          monthly: {
            used: 0,
            sent: 0,
            received: 0,
            limit: 3000,
            resets_at: new Date(
              h.clock.now().getTime() + 2592000000,
            ).toISOString(),
          },
        },
        rate_limit: { limit: 10, duration: "1000ms" },
      });
    if (String(url).includes("/domains/"))
      return Response.json({
        id: configuration.domainId,
        name: "platform.example",
        status: "partially_verified",
        capabilities: { sending: "enabled", receiving: "enabled" },
        records: [
          { record: "SPF", type: "TXT", status: "verified" },
          { record: "SPF", type: "MX", status: "verified" },
          { record: "DKIM", type: "TXT", status: "verified" },
          { record: "Receiving", type: "MX", status: "pending" },
        ],
      });
    if (
      String(url) !== "https://api.resend.com/emails" ||
      init?.method !== "POST"
    )
      throw Error("Unexpected notification fixture endpoint");
    const key = new Headers(init.headers).get("Idempotency-Key");
    if (!key) throw Error("Missing native key");
    const body: Record<string, unknown> = JSON.parse(String(init.body)),
      prior = accepted.get(key);
    if (prior) {
      if (JSON.stringify(prior.body) !== JSON.stringify(body))
        throw Error("Changed payload");
      return Response.json({ id: prior.id });
    }
    const effect = { key, body, id: randomUUID() };
    effects.push(effect);
    accepted.set(key, effect);
    return Response.json({ id: effect.id });
  };
  const app = createNotificationApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createNotificationRepository(runtimeDatabase(h.runtime)),
    provider: createResendProvider(configuration, native),
    vault: notificationVault({
      activeKey: "fixture",
      keys: { fixture: Buffer.alloc(32, 11) },
    }),
    configuration,
  });
  await app.selectTerms(operator, {
    kind: "free",
    reference: "Explicit synthetic reviewed terms",
    monthlyLimit: 3000,
    dailyLimit: 100,
    amount: null,
  });
  await app.refreshSetup(operator);
  return { app, effects };
}
