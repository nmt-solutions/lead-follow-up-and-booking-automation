import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import { createSenderHealthApplication } from "../../src/application/sender-health";
import { createSenderHealthRepository } from "../../src/db/sender-health-repository";
import type { HealthEvidence } from "../../src/models/sender-health";

/** Synthetic reviewed measurements through the actual authenticated application and restricted persistence. */
export async function reviewedSenderHealth(
  h: Awaited<ReturnType<typeof createHarness>>,
  businessId: string,
  identityId: string,
  validUntil?: string,
) {
  const operator = await h.signIn(`health-support-${randomUUID()}@example.com`),
    actor = await h.authenticate(operator);
  await h.admin.query(
    "INSERT INTO platform_operator(user_id,sender_health) VALUES($1,true)",
    [actor.userId],
  );
  const app = createSenderHealthApplication({
    authenticate: h.access.authenticateForWork,
    repository: createSenderHealthRepository(
      runtimeDatabase(h.runtime),
      h.clock,
    ),
  });
  const rule = { unit: "rate" as const, limit: 0.01, minimumSample: 10 };
  const policy = {
    source: "assisted_review" as const,
    sourceAuthority: "Synthetic provider evidence fixture",
    sourceOrigin: "https://operator.example",
    population: "Synthetic exact-account complete window",
    windowSeconds: 3600,
    freshnessSeconds: Math.min(
      604800,
      validUntil
        ? Math.floor((Date.parse(validUntil) - h.clock.now().getTime()) / 1000)
        : 604800,
    ),
    maximumLatenessSeconds: 600,
    retentionDays: 30,
    thresholds: {
      spf: rule,
      dkim: rule,
      dmarc_alignment: rule,
      bounces: rule,
      complaints: rule,
    },
  };
  await app.configure(operator, businessId, identityId, {
    expectedVersion: 0,
    policy,
  });
  const binding = (
    await app.workspace(operator, businessId, true)
  ).identities.find((i) => i.id === identityId)!.binding;
  const evidence: HealthEvidence = {
    eventKey: "initial",
    policyVersion: 1,
    binding,
    observedAt: h.clock.now().toISOString(),
    windowStart: new Date(h.clock.now().getTime() - 3600000).toISOString(),
    windowEnd: h.clock.now().toISOString(),
    reference: "https://operator.example/synthetic-report",
    artifactSha256: "a".repeat(64),
    metrics: {
      spf: { failed: 0, total: 100 },
      dkim: { failed: 0, total: 100 },
      dmarc_alignment: { failed: 0, total: 100 },
      bounces: { failed: 0, total: 100 },
      complaints: { failed: 0, total: 100 },
    },
    repairs: [],
  };
  await app.ingest(operator, businessId, identityId, evidence);
  return { app, operator, evidence, policy };
}
