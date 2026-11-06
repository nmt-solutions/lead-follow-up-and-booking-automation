import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  assessHealth,
  type HealthBinding,
  type HealthEvidence,
  type HealthPayload,
  type HealthPolicy,
} from "../models/sender-health";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  senderHealthRecord,
  senderIdentity,
  senderConnection,
  senderReplyRoute,
  platformOperator,
  session,
} from "./schema";

type RecordRow = typeof senderHealthRecord.$inferSelect;
const nativeSchema = z.object({
  mailboxId: z.uuid(),
  generation: z.number().int().positive(),
  accountSubject: z.string().nullable(),
  status: z.string(),
  send: z.boolean(),
});
export async function healthBindingAt(
  tx: Transaction,
  businessId: string,
  identityId: string,
) {
  const [identity] = await tx
    .select()
    .from(senderIdentity)
    .where(
      and(
        eq(senderIdentity.businessId, businessId),
        eq(senderIdentity.id, identityId),
      ),
    );
  if (!identity) throw new ApplicationError("NOT_FOUND");
  const [connection] = identity.connectionId
    ? await tx
        .select()
        .from(senderConnection)
        .where(
          and(
            eq(senderConnection.businessId, businessId),
            eq(senderConnection.id, identity.connectionId),
          ),
        )
    : [];
  if (!connection) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  const [route] = identity.replyRouteId
    ? await tx
        .select()
        .from(senderReplyRoute)
        .where(
          and(
            eq(senderReplyRoute.businessId, businessId),
            eq(senderReplyRoute.id, identity.replyRouteId),
          ),
        )
    : [];
  const [reply] = route
    ? await tx
        .select()
        .from(senderConnection)
        .where(
          and(
            eq(senderConnection.businessId, businessId),
            eq(senderConnection.id, route.connectionId),
          ),
        )
    : [];
  const result = await tx.execute<{ value: unknown }>(
    sql`select public.sender_health_native(${connection.id}::uuid) as value`,
  );
  const native = result.rows[0]?.value
    ? nativeSchema.parse(result.rows[0].value)
    : null;
  const binding: HealthBinding = {
    sender: {
      businessId,
      identityId,
      identityVersion: identity.version,
      connectionId: connection.id,
      connectionVersion: connection.version,
      replyRouteId: route?.id ?? null,
      replyRouteVersion: route?.version ?? null,
      replyConnectionId: reply?.id ?? null,
      replyConnectionVersion: reply?.version ?? null,
    },
    provider: connection.configuration.provider,
    account: connection.configuration.account,
    mailboxId: native?.mailboxId ?? null,
    generation: native?.generation ?? null,
    accountSubject: native?.accountSubject ?? null,
  };
  return { identity, binding, native };
}
async function recordsAt(
  tx: Transaction,
  businessId: string,
  identityId: string,
) {
  return tx
    .select()
    .from(senderHealthRecord)
    .where(
      and(
        eq(senderHealthRecord.businessId, businessId),
        eq(senderHealthRecord.identityId, identityId),
      ),
    )
    .orderBy(asc(senderHealthRecord.position));
}
function policyAt(rows: RecordRow[]) {
  return rows
    .filter((r) => r.payload.kind === "policy")
    .sort(
      (a, b) =>
        (b.payload.kind === "policy" ? b.payload.version : 0) -
        (a.payload.kind === "policy" ? a.payload.version : 0),
    )[0];
}
function incidentsAt(rows: RecordRow[]) {
  return rows.flatMap((r) =>
    r.payload.kind === "incident"
      ? [
          {
            id: r.id,
            at: r.at.toISOString(),
            ...r.payload,
            lastObservedAt: rows.reduce(
              (latest, x) =>
                x.payload.kind === "failure" &&
                x.payload.incidentId === r.id &&
                Date.parse(x.payload.observedAt) > Date.parse(latest)
                  ? x.payload.observedAt
                  : latest,
              r.payload.observedAt,
            ),
            lastWindowEnd: rows.reduce(
              (latest, x) =>
                x.payload.kind === "failure" &&
                x.payload.incidentId === r.id &&
                Date.parse(x.payload.windowEnd) > Date.parse(latest)
                  ? x.payload.windowEnd
                  : latest,
              r.payload.windowEnd,
            ),
            resolved: rows.some(
              (x) =>
                x.payload.kind === "repair" && x.payload.incidentId === r.id,
            ),
          },
        ]
      : [],
  );
}
function latestEvidence(rows: RecordRow[]) {
  return (
    rows
      .toReversed()
      .flatMap((r) =>
        r.payload.kind === "evidence" && r.payload.evidence
          ? [
              {
                id: r.id,
                actorId: r.actorId,
                recordedAt: r.at.toISOString(),
                ...r.payload.evidence,
              },
            ]
          : [],
      )
      .sort(
        (a, b) =>
          Date.parse(b.windowEnd) - Date.parse(a.windowEnd) ||
          Date.parse(b.observedAt) - Date.parse(a.observedAt),
      )[0] ?? null
  );
}
function fingerprint(payload: unknown) {
  // Inputs are schema-normalized; provider snapshots are not increment counters.
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
async function append(
  tx: Transaction,
  businessId: string,
  identityId: string,
  actorId: string,
  at: Date,
  eventKey: string,
  payload: HealthPayload,
) {
  const hash = fingerprint(payload);
  const [prior] = await tx
    .select()
    .from(senderHealthRecord)
    .where(
      and(
        eq(senderHealthRecord.businessId, businessId),
        eq(senderHealthRecord.identityId, identityId),
        eq(senderHealthRecord.kind, payload.kind),
        eq(senderHealthRecord.eventKey, eventKey),
      ),
    );
  if (prior) {
    if (prior.fingerprint !== hash) throw new ApplicationError("CONFLICT");
    return prior;
  }
  const row = {
    id: randomUUID(),
    businessId,
    identityId,
    kind: payload.kind,
    eventKey,
    fingerprint: hash,
    payload,
    actorId,
    at,
  };
  await tx.insert(senderHealthRecord).values(row);
  return row;
}
async function incident(
  tx: Transaction,
  businessId: string,
  identityId: string,
  actorId: string,
  at: Date,
  key: string,
  payload: Extract<HealthPayload, { kind: "incident" }>,
) {
  const rows = await recordsAt(tx, businessId, identityId);
  const open = incidentsAt(rows).filter((i) => !i.resolved);
  for (const existing of open.filter((i) =>
    payload.failures.some((f) => i.failures.includes(f)),
  ))
    await append(
      tx,
      businessId,
      identityId,
      actorId,
      at,
      `${existing.id}:${key}`,
      {
        kind: "failure",
        incidentId: existing.id,
        evidenceId: payload.evidenceId,
        observedAt: payload.observedAt,
        windowEnd: payload.windowEnd,
      },
    );
  const failures = payload.failures.filter(
    (f) => !open.some((i) => i.failures.includes(f)),
  );
  if (!failures.length) return;
  const saved = await append(tx, businessId, identityId, actorId, at, key, {
    ...payload,
    failures,
  });
  for (const audience of ["business", "operator"] as const)
    await append(
      tx,
      businessId,
      identityId,
      actorId,
      at,
      `${saved.id}:${audience}`,
      { kind: "alert", incidentId: saved.id, audience },
    );
}

/** Runs on the SAME locked transaction as native connection failures; never classifies these as DNS/bounce/complaint metrics. */
export async function recordSenderConnectionFailure(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  at: Date,
  reason: "revoked" | "insufficient",
) {
  const actor = await tx.execute<{ id: string }>(
    sql`select current_setting('app.actor_id',true) as id`,
  );
  const identities = await tx
    .select()
    .from(senderIdentity)
    .where(
      and(
        eq(senderIdentity.businessId, businessId),
        eq(senderIdentity.connectionId, connectionId),
      ),
    );
  for (const identity of identities) {
    const { binding, native } = await healthBindingAt(
      tx,
      businessId,
      identity.id,
    );
    if (!native || (native.status === "connected" && native.send)) continue;
    await incident(
      tx,
      businessId,
      identity.id,
      actor.rows[0].id,
      at,
      `connection:${binding.generation}:${reason}:${at.toISOString()}`,
      {
        kind: "incident",
        evidenceId: `connection:${binding.generation}`,
        binding,
        observedAt: at.toISOString(),
        windowEnd: at.toISOString(),
        failures: ["sending_authorization"],
        policy: null,
        metrics: null,
        reason,
      },
    );
  }
}

/** Shared current-state guard. Reads never repair incidents or change inbound processing. */
export async function senderHealthAt(
  tx: Transaction,
  businessId: string,
  identityId: string,
  at: Date,
  required = false,
) {
  const rows = await recordsAt(tx, businessId, identityId),
    policy = policyAt(rows);
  const incidents = incidentsAt(rows);
  const issues: { code: string; action: string }[] = [];
  if (incidents.some((i) => !i.resolved))
    issues.push({
      code: "health_incident",
      action:
        "Outbound for this sender is paused. Ask the sender-health operator to review the incident and submit newer evidence addressing every failed condition; acknowledgement and refresh cannot repair it.",
    });
  if (!policy || policy.payload.kind !== "policy") {
    if (required)
      issues.push({
        code: "health_policy_required",
        action:
          "Ask the sender-health operator to configure the source, measured population, thresholds and freshness, then review actual evidence.",
      });
    return { issues, proof: null };
  }
  const p = policy.payload,
    evidence = latestEvidence(rows);
  const { binding, native } = await healthBindingAt(tx, businessId, identityId);
  const current = Boolean(
    evidence &&
    evidence.policyVersion === p.version &&
    isDeepStrictEqual(binding, evidence.binding) &&
    Date.parse(evidence.observedAt) <= at.getTime() &&
    at.getTime() - Date.parse(evidence.observedAt) <
      p.configuration.freshnessSeconds * 1000,
  );
  if (!current)
    issues.push({
      code: "health_evidence_required",
      action:
        "Review fresh evidence for the current sender, native account/generation and policy. Missing, expired or changed bindings are unknown.",
    });
  if (current && evidence) {
    const result = assessHealth(evidence.metrics, p.configuration);
    if (result.unknown.length)
      issues.push({
        code: "health_sample_insufficient",
        action: `Obtain the configured minimum sample for ${result.unknown.join(", ")}; no data is not zero failures.`,
      });
    if (result.failures.length)
      issues.push({
        code: "health_threshold",
        action: `Repair ${result.failures.join(", ")} and submit a newer, complete evidence window.`,
      });
  }
  if (native && (native.status !== "connected" || !native.send))
    issues.push({
      code: "health_connection_unavailable",
      action:
        "Reconnect the exact selected account with sending permission; reading and calendar permissions are separate.",
    });
  return {
    issues,
    proof:
      current && evidence && !issues.length
        ? {
            observedAt: evidence.observedAt,
            validUntil: new Date(
              Date.parse(evidence.observedAt) +
                p.configuration.freshnessSeconds * 1000,
            ).toISOString(),
          }
        : null,
  };
}

export function createSenderHealthRepository(database: Database, clock: Clock) {
  async function authorize(
    tx: Transaction,
    actor: WorkIdentity,
    operator: boolean,
    businessId: string,
  ) {
    if (!operator) {
      const role = await requireCapability(
        tx,
        actor,
        businessId,
        "profile.read",
      );
      await requireSalesSession(tx, actor, clock.now(), role);
      return;
    }
    const [cap] = await tx
      .select()
      .from(platformOperator)
      .where(eq(platformOperator.userId, actor.userId));
    if (!cap?.senderHealth) throw new ApplicationError("FORBIDDEN");
    const [s] = await tx
      .select()
      .from(session)
      .where(
        and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)),
      );
    if (!s || s.expiresAt <= clock.now())
      throw new ApplicationError("UNAUTHENTICATED");
    if (!(await hasMfa(tx, s.token, clock.now(), operatorMfaLifetime)))
      throw new ApplicationError("MFA_REQUIRED");
  }
  function access<T>(
    actor: WorkIdentity,
    businessId: string,
    operator: boolean,
    run: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        await authorize(tx, actor, operator, businessId);
        return run(tx);
      },
      { lock: Boolean(businessId) },
    );
  }
  return {
    prune(actor: WorkIdentity, businessId: string, identityId: string) {
      return access(actor, businessId, true, async (tx) => {
        await healthBindingAt(tx, businessId, identityId);
        const result = await tx.execute<{ count: number }>(
          sql`select public.purge_sender_health_artifacts(${identityId}::uuid,${clock.now().toISOString()}::timestamptz) as count`,
        );
        return { purged: result.rows[0].count };
      });
    },
    configure(
      actor: WorkIdentity,
      businessId: string,
      identityId: string,
      input: { expectedVersion: number; policy: HealthPolicy },
    ) {
      return access(actor, businessId, true, async (tx) => {
        await healthBindingAt(tx, businessId, identityId);
        const current = policyAt(await recordsAt(tx, businessId, identityId));
        if (
          (current?.payload.kind === "policy" ? current.payload.version : 0) !==
          input.expectedVersion
        )
          throw new ApplicationError("CONFLICT");
        const version = input.expectedVersion + 1;
        await append(
          tx,
          businessId,
          identityId,
          actor.userId,
          clock.now(),
          String(version),
          { kind: "policy", version, configuration: input.policy },
        );
        return { version };
      });
    },
    ingest(
      actor: WorkIdentity,
      businessId: string,
      identityId: string,
      evidence: HealthEvidence,
    ) {
      return access(actor, businessId, true, async (tx) => {
        const rows = await recordsAt(tx, businessId, identityId);
        const duplicate = rows.find(
          (r) => r.kind === "evidence" && r.eventKey === evidence.eventKey,
        );
        if (duplicate) {
          if (
            duplicate.fingerprint !==
            fingerprint({ kind: "evidence", evidence })
          )
            throw new ApplicationError("CONFLICT");
          return { id: duplicate.id };
        }
        const policy = policyAt(rows);
        if (
          policy?.payload.kind !== "policy" ||
          policy.payload.version !== evidence.policyVersion
        )
          throw new ApplicationError("CONFLICT");
        const p = policy.payload.configuration,
          at = clock.now();
        const { binding, native } = await healthBindingAt(
          tx,
          businessId,
          identityId,
        );
        if (
          !isDeepStrictEqual(binding, evidence.binding) ||
          evidence.binding.sender.businessId !== businessId ||
          evidence.binding.sender.identityId !== identityId
        )
          throw new ApplicationError("CONFLICT");
        const observed = Date.parse(evidence.observedAt),
          start = Date.parse(evidence.windowStart),
          end = Date.parse(evidence.windowEnd);
        if (
          observed > at.getTime() ||
          observed < end ||
          end - start !== p.windowSeconds * 1000 ||
          observed - end > p.maximumLatenessSeconds * 1000 ||
          at.getTime() - observed >= p.freshnessSeconds * 1000 ||
          new URL(evidence.reference).origin !== p.sourceOrigin
        )
          throw new ApplicationError("INVALID_INPUT");
        const latest = latestEvidence(rows);
        if (
          latest &&
          (end < Date.parse(latest.windowEnd) ||
            observed < Date.parse(latest.observedAt))
        )
          throw new ApplicationError("CONFLICT");
        const assessed = assessHealth(evidence.metrics, p);
        const repairs = incidentsAt(rows).filter((i) =>
          evidence.repairs.includes(i.id),
        );
        if (
          repairs.length !== evidence.repairs.length ||
          repairs.some(
            (i) =>
              i.resolved ||
              observed <= Date.parse(i.lastObservedAt) ||
              start < Date.parse(i.lastWindowEnd) ||
              assessed.failures.length ||
              assessed.unknown.length ||
              (i.policy &&
                (i.policy.population !== p.population ||
                  i.policy.sourceOrigin !== p.sourceOrigin ||
                  i.policy.windowSeconds !== p.windowSeconds ||
                  assessHealth(evidence.metrics, i.policy).failures.length ||
                  assessHealth(evidence.metrics, i.policy).unknown.length)) ||
              (i.failures.includes("sending_authorization") &&
                (!native || native.status !== "connected" || !native.send)),
          )
        )
          throw new ApplicationError("CONFLICT");
        const saved = await append(
          tx,
          businessId,
          identityId,
          actor.userId,
          at,
          evidence.eventKey,
          { kind: "evidence", evidence },
        );
        for (const open of incidentsAt(rows).filter(
          (i) =>
            !i.resolved &&
            i.policy &&
            i.policy.population === p.population &&
            i.policy.sourceOrigin === p.sourceOrigin,
        )) {
          if (
            open.policy &&
            assessHealth(evidence.metrics, open.policy).failures.some((f) =>
              open.failures.includes(f),
            )
          )
            await append(
              tx,
              businessId,
              identityId,
              actor.userId,
              at,
              `${open.id}:${saved.id}`,
              {
                kind: "failure",
                incidentId: open.id,
                evidenceId: saved.id,
                observedAt: evidence.observedAt,
                windowEnd: evidence.windowEnd,
              },
            );
        }
        for (const repair of repairs)
          await append(
            tx,
            businessId,
            identityId,
            actor.userId,
            at,
            repair.id,
            { kind: "repair", incidentId: repair.id, evidenceId: saved.id },
          );
        if (assessed.failures.length)
          await incident(
            tx,
            businessId,
            identityId,
            actor.userId,
            at,
            saved.id,
            {
              kind: "incident",
              evidenceId: saved.id,
              binding,
              observedAt: evidence.observedAt,
              windowEnd: evidence.windowEnd,
              failures: assessed.failures,
              policy: p,
              metrics: evidence.metrics,
              reason: "threshold",
            },
          );
        return { id: saved.id };
      });
    },
    workspace(actor: WorkIdentity, businessId: string, operator = false) {
      return access(actor, businessId, operator, async (tx) => {
        const identities = await tx
          .select()
          .from(senderIdentity)
          .where(eq(senderIdentity.businessId, businessId));
        const result = [];
        for (const identity of identities) {
          if (!identity.connectionId) continue;
          const { binding } = await healthBindingAt(
              tx,
              businessId,
              identity.id,
            ),
            rows = await recordsAt(tx, businessId, identity.id),
            policy = policyAt(rows);
          result.push({
            id: identity.id,
            address: identity.configuration.fromAddress,
            binding,
            policy:
              policy?.payload.kind === "policy"
                ? {
                    version: policy.payload.version,
                    configuration: policy.payload.configuration,
                    actorId: policy.actorId,
                    at: policy.at.toISOString(),
                  }
                : null,
            evidence: latestEvidence(rows),
            incidents: incidentsAt(rows),
            ...(await senderHealthAt(
              tx,
              businessId,
              identity.id,
              clock.now(),
              true,
            )),
          });
        }
        const alerts = await this.alertRows(
          tx,
          operator ? "operator" : "business",
          businessId,
        );
        return { businessId, identities: result, alerts };
      });
    },
    async alertRows(
      tx: Transaction,
      audience: "business" | "operator",
      businessId?: string,
    ) {
      const rows = await tx
        .select()
        .from(senderHealthRecord)
        .where(
          businessId
            ? eq(senderHealthRecord.businessId, businessId)
            : undefined,
        );
      return rows.flatMap((r) =>
        r.payload.kind === "alert" && r.payload.audience === audience
          ? [
              {
                id: r.id,
                businessId: r.businessId,
                identityId: r.identityId,
                incidentId: r.payload.incidentId,
                at: r.at.toISOString(),
                acknowledged: rows.some(
                  (a) =>
                    a.payload.kind === "acknowledgement" &&
                    a.payload.alertId === r.id &&
                    a.payload.audience === audience,
                ),
              },
            ]
          : [],
      );
    },
    alerts(actor: WorkIdentity) {
      return access(actor, "", true, async (tx) => ({
        alerts: await this.alertRows(tx, "operator"),
      }));
    },
    acknowledge(
      actor: WorkIdentity,
      businessId: string,
      alertId: string,
      operator = false,
    ) {
      return access(actor, businessId, operator, async (tx) => {
        const [alert] = await tx
          .select()
          .from(senderHealthRecord)
          .where(
            and(
              eq(senderHealthRecord.businessId, businessId),
              eq(senderHealthRecord.id, alertId),
            ),
          );
        if (
          alert?.payload.kind !== "alert" ||
          alert.payload.audience !== (operator ? "operator" : "business")
        )
          throw new ApplicationError("NOT_FOUND");
        await append(
          tx,
          businessId,
          alert.identityId,
          actor.userId,
          clock.now(),
          alertId,
          {
            kind: "acknowledgement",
            alertId,
            audience: alert.payload.audience,
          },
        );
      });
    },
  };
}
