import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../models/business";
import {
  samePolicy,
  type DataPolicy,
  type OffboardInput,
  type NativeCleanup,
  type RevocationOutcome,
} from "../models/data-governance";
import { ApplicationError } from "../models/application-error";
import type { Database } from "./runtime";
import { requireCapability, scoped, type Transaction } from "./scope";
import {
  businessDataExport,
  businessDataGrant,
  businessDataRequest,
  businessDataStep,
  businessDataEvent,
} from "./schema";

export const dataHash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const dataExportKey = (businessId: string, id: string) =>
  `business-exports/${businessId}/${id}.json`;
const sourcePolicySchema = z.object({
  adapterId: z.string(),
  exa: z.object({ scopeRef: z.string() }).optional(),
  permissions: z.object({
    retainEvidence: z.boolean(),
    displayEvidence: z.boolean(),
    exportEvidence: z.boolean(),
    afterCancellation: z.boolean(),
  }),
});
export async function dataNow(tx: Transaction) {
  const r = await tx.execute<{ at: string }>(
    sql`select statement_timestamp()::text at`,
  );
  return new Date(r.rows[0].at);
}
// Only the listed columns cross the customer export boundary. No arbitrary table dump.
const sources = [
  [
    "business",
    "id,name,offering,home_market,website,created_at,updated_at",
    "id",
  ],
  ["inbox_buyer", "id,connection_id,name,geography,engaged_at", "business_id"],
  [
    "inbox_conversation",
    "id,connection_id,buyer_id,subject,last_received_at",
    "business_id",
  ],
  [
    "inbox_opportunity",
    "id,connection_id,conversation_id,buyer_id,title,stage,owner_id,handoff_reason,next_action,control_state,control_version,created_at",
    "business_id",
  ],
  [
    "inbox_message",
    "id,connection_id,conversation_id,content,received_at",
    "business_id",
  ],
  [
    "inbox_message_link",
    "id,conversation_id,sequence,opportunity_id",
    "business_id",
  ],
  [
    "inbox_association",
    "id,buyer_id,default_opportunity_id,version,review_reason,next_action",
    "business_id",
  ],
  [
    "call_activity",
    "id,opportunity_id,buyer_id,created_at,actor_name",
    "business_id",
  ],
  [
    "call_revision",
    "id,call_id,opportunity_id,buyer_id,version,actor_name,responsible_name,occurred_at,notes,outcome,next_action,at",
    "business_id",
  ],
  [
    "subscription_period",
    'id,action_id,provider,payment_id,start,"end",snapshot,charge',
    "business_id",
  ],
  [
    "seller_document",
    "id,period_id,original_id,adjustment_id,adjustment_source,kind,series_key,ordinal::text ordinal,number,snapshot,at,retain_until,sha256,bytes,artifact_state",
    "business_id",
  ],
  ["billing_profile_revision", "id,version,profile,at", "business_id"],
  ["tax_calculation", "id,version,resolves_id,snapshot,at", "business_id"],
  [
    "business_file",
    "id,name,purpose,content_type,size,state,sha256,created_at,completed_at,retention_until",
    "business_id",
  ],
] as const;

// Free-form evidence can itself contain an authorization link. Exclude bearer values
// and strip URL capabilities in every string, including message bodies and notes.
export function customerText(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
        try {
          const u = new URL(raw);
          if (
            /auth|callback|invite|magic|reset|verify|token|sign[-_]?in|login|recovery/i.test(
              u.pathname,
            )
          )
            return "[authorization link omitted]";
          u.username = "";
          u.password = "";
          u.search = "";
          u.hash = "";
          return u.toString();
        } catch {
          return "[URL omitted]";
        }
      })
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[bearer omitted]")
      .replace(
        /\b(?:password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|execution[_ -]?key|dispatch[_ -]?key|recovery[_ -]?key)\s*[:=]\s*[^\s,;]+/gi,
        "[credential value omitted]",
      );
  if (Array.isArray(value)) return value.map(customerText);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !/secret|password|token|credentials|callback|checkout|recoveryKey|operationKey|requestKey|sessionId|executionKey|dispatchKey|accountScope|storageKey/i.test(
              k,
            ),
        )
        .map(([k, v]) => [k, customerText(v)]),
    );
  return value;
}
export function createDataGovernanceRepository(database: Database) {
  function access<T>(
    actor: Actor,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.manage");
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function artifact(tx: Transaction, id: string, actor: Actor) {
    const [r] = await tx
      .select()
      .from(businessDataExport)
      .where(eq(businessDataExport.id, id));
    if (!r || r.actorId !== actor.userId)
      throw new ApplicationError("NOT_FOUND");
    await assertPolicy(tx, r.policy);
    return r;
  }
  async function assertPolicy(tx: Transaction, policy: DataPolicy) {
    const at = await dataNow(tx);
    if (
      new Date(policy.effectiveFrom) > at ||
      new Date(policy.effectiveUntil) <= at
    )
      throw new ApplicationError("DATA_POLICY_REQUIRED");
    const r = await tx.execute<{ conflict: boolean }>(
      sql`select exists(select 1 from (select policy from public.business_data_request union all select policy from public.business_data_export) p where policy->>'id'=${policy.id} and (policy->>'version')::integer=${policy.version} and policy<>${JSON.stringify(policy)}::jsonb) conflict`,
    );
    if (r.rows[0].conflict) throw new ApplicationError("CONFLICT");
  }
  return {
    access,
    async expireSecrets() {
      const r = await database.execute<{ count: number }>(
        sql`select public.expire_business_data_secrets() count`,
      );
      return r.rows[0].count;
    },
    async recordEvidence(
      actor: Actor,
      businessId: string,
      input: { stepId: string; fact: string; reference: string },
    ) {
      return access(actor, businessId, async (tx) => {
        await tx.execute(
          sql`select public.record_business_data_evidence(${input.stepId}::uuid,${input.fact},${input.reference})`,
        );
      });
    },
    async claimExpiredExports(scope: string) {
      const r = await database.execute<{
        id: string;
        business_id: string;
        lease: string;
      }>(sql`select * from public.claim_business_exports(${scope})`);
      return r.rows;
    },
    async finishExpiredExport(id: string, lease: string, success: boolean) {
      await database.execute(
        sql`select public.finish_business_export_cleanup(${id}::uuid,${lease}::uuid,${success})`,
      );
    },
    async offboard(
      actor: Actor,
      businessId: string,
      input: OffboardInput,
      policy: DataPolicy,
    ) {
      return access(actor, businessId, async (tx) => {
        await assertPolicy(tx, policy);
        let [r] = await tx
          .select()
          .from(businessDataRequest)
          .where(eq(businessDataRequest.requestKey, input.requestKey));
        if (r) {
          if (
            r.kind !== "offboard" ||
            r.actorId !== actor.userId ||
            !isDeepStrictEqual(r.input, input) ||
            !samePolicy(r.policy, policy)
          )
            throw new ApplicationError("CONFLICT");
        } else {
          [r] = await tx
            .insert(businessDataRequest)
            .values({
              id: randomUUID(),
              businessId,
              requestKey: input.requestKey,
              actorId: actor.userId,
              kind: "offboard",
              policy,
              input,
            })
            .returning();
          await tx.execute(
            sql`select public.start_business_offboarding(${r.id}::uuid)`,
          );
        }
        return { id: r.id, cancellation: r.input?.cancellation ?? null };
      });
    },
    async reopen(
      actor: Actor,
      businessId: string,
      requestKey: string,
      policy: DataPolicy,
    ) {
      return access(actor, businessId, async (tx) => {
        await assertPolicy(tx, policy);
        const [old] = await tx
          .select()
          .from(businessDataRequest)
          .where(eq(businessDataRequest.requestKey, requestKey));
        if (old) {
          if (
            old.kind !== "reopen" ||
            old.actorId !== actor.userId ||
            !samePolicy(old.policy, policy)
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        // Outstanding provider revocation must settle before reconnect can create
        // another grant for the same remote identity.
        const pending = await tx
          .select({ id: businessDataStep.id })
          .from(businessDataStep)
          .where(
            sql`state in ('pending','retry','working') and kind not in ('file','local')`,
          )
          .limit(1);
        if (pending.length) throw new ApplicationError("CONFLICT");
        await tx.insert(businessDataRequest).values({
          id: randomUUID(),
          businessId,
          requestKey,
          actorId: actor.userId,
          kind: "reopen",
          policy,
          input: null,
        });
      });
    },
    async claimCleanup(policy: DataPolicy): Promise<NativeCleanup[]> {
      const r = await database.execute<{ value: NativeCleanup }>(
        sql`select public.claim_business_data_cleanup(${JSON.stringify(policy)}::jsonb) value`,
      );
      return r.rows.map((r) => r.value);
    },
    async finishCleanup(target: NativeCleanup, outcome: RevocationOutcome) {
      await database.execute(
        sql`select public.finish_business_data_cleanup(${target.id}::uuid,${target.lease}::uuid,${outcome})`,
      );
    },
    async workspace(actor: Actor, businessId: string) {
      return access(actor, businessId, async (tx) => ({
        exports: await tx
          .select()
          .from(businessDataExport)
          .where(eq(businessDataExport.actorId, actor.userId))
          .orderBy(desc(businessDataExport.createdAt))
          .limit(50),
        requests: await tx
          .select()
          .from(businessDataRequest)
          .orderBy(desc(businessDataRequest.at), desc(businessDataRequest.id))
          .limit(50),
        steps: await tx
          .select({
            id: businessDataStep.id,
            requestId: businessDataStep.requestId,
            kind: businessDataStep.kind,
            targetId: businessDataStep.targetId,
            state: businessDataStep.state,
            attempts: businessDataStep.attempts,
            outcome: businessDataStep.outcome,
            tokenWiped: businessDataStep.tokenWiped,
          })
          .from(businessDataStep)
          .limit(1000),
        events: await tx
          .select()
          .from(businessDataEvent)
          .orderBy(desc(businessDataEvent.at), desc(businessDataEvent.id))
          .limit(1000),
      }));
    },
    async collect(
      actor: Actor,
      businessId: string,
      policy: DataPolicy,
      part: number,
    ) {
      return access(actor, businessId, async (tx) => {
        const offset = (part - 1) * policy.maxRows;
        let hasMore = false;
        const records: Record<string, unknown[]> = {},
          coverage: {
            source: string;
            total: number;
            included: number;
            ids: unknown[];
            sha256: string;
            omitted: number;
            offset?: number;
          }[] = [];
        for (const [table, columns, scope] of sources) {
          const r = await tx.execute<{ record: Record<string, unknown> }>(
            sql.raw(
              `select row_to_json(r) record from (select ${columns} from public.${table} where ${scope}='${businessId}' order by 1 limit ${policy.maxRows} offset ${offset}) r`,
            ),
          );
          const total = await tx.execute<{ count: string }>(
            sql.raw(
              `select count(*)::text count from public.${table} where ${scope}='${businessId}'`,
            ),
          );
          records[table] = r.rows.map((r) => customerText(r.record));
          hasMore ||= Number(total.rows[0].count) > offset + r.rows.length;
          coverage.push({
            source: table,
            offset,
            total: Number(total.rows[0].count),
            included: r.rows.length,
            ids: r.rows.map((r) => r.record.id ?? r.record.message_id),
            sha256: dataHash(JSON.stringify(records[table])),
            omitted: Number(total.rows[0].count) - r.rows.length,
          });
        }
        const observations = await tx.execute<{
          id: string;
          run_id: string;
          prospect_id: string;
          checked_at: string;
          outcome: string;
          data: unknown;
          policy: unknown;
        }>(
          sql`select o.id,o.run_id,o.prospect_id,o.checked_at::text,o.outcome,o.data,r.policy from public.discovery_observation o join public.discovery_run r on r.id=o.run_id and r.business_id=o.business_id order by o.checked_at,o.id limit ${policy.maxRows} offset ${offset}`,
        );
        const exportPermitted = (o: { data: unknown; policy: unknown }) => {
          const run = sourcePolicySchema.safeParse(o.policy);
          const data = z
            .object({ evidence: z.array(z.object({ url: z.string() })) })
            .safeParse(o.data);
          if (
            !run.success ||
            !data.success ||
            !run.data.permissions.retainEvidence ||
            !run.data.permissions.displayEvidence ||
            !run.data.permissions.exportEvidence ||
            !run.data.permissions.afterCancellation
          )
            return false;
          const right = policy.sourceRights.find(
            (r) =>
              r.adapterId === run.data.adapterId &&
              r.scopeRef === (run.data.exa?.scopeRef ?? run.data.adapterId) &&
              r.export &&
              r.afterCancellation,
          );
          return (
            !!right &&
            data.data.evidence.every((e) => {
              try {
                return right.sourceOrigins.some(
                  (origin) => new URL(origin).origin === new URL(e.url).origin,
                );
              } catch {
                return false;
              }
            })
          );
        };
        const permitted = observations.rows.filter(exportPermitted);
        const results = await tx.execute<{
          run_id: string;
          prospect_id: string;
          data: unknown;
          policy: unknown;
        }>(
          sql`select x.run_id,x.prospect_id,x.data,r.policy from public.discovery_result x join public.discovery_run r on r.id=x.run_id and r.business_id=x.business_id order by x.run_id,x.prospect_id limit ${policy.maxRows} offset ${offset}`,
        );
        const permittedResults = results.rows.filter(exportPermitted);
        records.discovery_result = permittedResults.map((r) =>
          customerText({
            run_id: r.run_id,
            prospect_id: r.prospect_id,
            data: r.data,
          }),
        );
        records.discovery_observation = permitted.map((o) =>
          customerText({
            id: o.id,
            run_id: o.run_id,
            prospect_id: o.prospect_id,
            checked_at: o.checked_at,
            outcome: o.outcome,
            data: o.data,
          }),
        );
        const prospectIds = [
          ...new Set(
            [...permitted, ...permittedResults].map((o) => o.prospect_id),
          ),
        ];
        records.discovery_source = [
          ...new Map(
            [...permitted, ...permittedResults].map((o) => [
              o.run_id,
              { run_id: o.run_id, rights: sourcePolicySchema.parse(o.policy) },
            ]),
          ).values(),
        ].map(customerText);
        const runTotal = await tx.execute<{ count: string }>(
          sql`select count(*)::text count from public.discovery_run`,
        );
        coverage.push({
          source: "discovery_source",
          total: Number(runTotal.rows[0].count),
          included: records.discovery_source.length,
          ids: [
            ...new Set(
              [...permitted, ...permittedResults].map((o) => o.run_id),
            ),
          ],
          sha256: dataHash(JSON.stringify(records.discovery_source)),
          omitted:
            Number(runTotal.rows[0].count) - records.discovery_source.length,
        });
        const prospects = prospectIds.length
          ? await tx.execute<{ id: string; canonical_url: string }>(
              sql`select id,canonical_url from public.discovery_prospect where id in (${sql.join(
                prospectIds.map((id) => sql`${id}::uuid`),
                sql`,`,
              )})`,
            )
          : { rows: [] };
        records.discovery_prospect = prospects.rows.map(customerText);
        for (const source of [
          "discovery_prospect",
          "discovery_result",
        ] as const) {
          const count = await tx.execute<{ count: string }>(
            sql.raw(`select count(*)::text count from public.${source}`),
          );
          coverage.push({
            source,
            ...(source === "discovery_result" ? { offset } : {}),
            total: Number(count.rows[0].count),
            included: records[source].length,
            ids:
              source === "discovery_prospect"
                ? prospects.rows.map((p) => p.id)
                : permittedResults.map((r) => [r.run_id, r.prospect_id]),
            sha256: dataHash(JSON.stringify(records[source])),
            omitted: Number(count.rows[0].count) - records[source].length,
          });
          if (source === "discovery_result")
            hasMore ||=
              Number(count.rows[0].count) > offset + results.rows.length;
        }
        const total = await tx.execute<{ count: string }>(
          sql`select count(*)::text count from public.discovery_observation`,
        );
        coverage.push({
          source: "discovery_observation",
          offset,
          total: Number(total.rows[0].count),
          included: permitted.length,
          ids: permitted.map((o) => o.id),
          sha256: dataHash(JSON.stringify(records.discovery_observation)),
          omitted: Number(total.rows[0].count) - permitted.length,
        });
        hasMore ||=
          Number(total.rows[0].count) > offset + observations.rows.length;
        return {
          records,
          manifest: {
            format: "business-retained-data/v1",
            part,
            rowLimit: policy.maxRows,
            hasMore,
            businessId,
            createdAt: (await dataNow(tx)).toISOString(),
            infrastructureBackup: false,
            coverage: "partial",
            policy: {
              id: customerText(policy.id),
              version: policy.version,
              evidence: customerText(policy.evidence),
            },
            sources: coverage,
            relations: [
              "discovery_observation.prospect_id -> discovery_prospect.id",
              "discovery_observation.run_id -> source discovery_run (execution omitted)",
              "inbox_conversation.buyer_id -> inbox_buyer.id",
              "inbox_message.conversation_id -> inbox_conversation.id",
              "inbox_message_link.opportunity_id -> inbox_opportunity.id",
              "call_revision.call_id -> call_activity.id",
              "seller_document.period_id -> subscription_period.id",
              "seller_document.original_id -> seller_document.id",
            ],
            omissions: [
              "Credentials, authorization links, private callback/worker/recovery capabilities, raw provider events and unrelated/global operator/auth records are excluded.",
              "Authentication, invitation and transactional notification ledgers are outside this customer export; their independent global or Business history and payload-retention authority remain unchanged.",
              "Source rights and row/byte limits apply. Missing or unapproved source rights omit affected evidence, including after cancellation.",
              "URLs have no query/fragment; free text is redacted for authorization links. Canonical JSON preserves formula-like text without spreadsheet execution.",
              "Private file bytes use separate current authorized downloads. Issued attachments below are verified against immutable hashes; missing, unsafe or bounded-out attachments have explicit per-document omissions.",
              "This is a redacted customer export, not a complete infrastructure backup.",
            ],
          },
        };
      });
    },
    async beginExport(
      actor: Actor,
      businessId: string,
      requestKey: string,
      policy: DataPolicy,
      part: number,
    ) {
      return access(actor, businessId, async (tx) => {
        await assertPolicy(tx, policy);
        const [old] = await tx
          .select()
          .from(businessDataExport)
          .where(eq(businessDataExport.requestKey, requestKey));
        if (old) {
          if (
            old.actorId !== actor.userId ||
            old.part !== part ||
            !samePolicy(old.policy, policy)
          )
            throw new ApplicationError("CONFLICT");
          return old;
        }
        const at = await dataNow(tx);
        const [r] = await tx
          .insert(businessDataExport)
          .values({
            id: randomUUID(),
            businessId,
            actorId: actor.userId,
            requestKey,
            part,
            policy,
            state: "pending",
            expiresAt: new Date(at.getTime() + policy.exportSeconds * 1000),
          })
          .returning();
        return r;
      });
    },
    async freezeExport(
      actor: Actor,
      businessId: string,
      id: string,
      bytes: number,
      sha256: string,
    ) {
      return access(actor, businessId, async (tx) => {
        const r = await artifact(tx, id, actor);
        if (
          r.expiresAt <= (await dataNow(tx)) ||
          !["pending", "ready"].includes(r.state)
        )
          throw new ApplicationError("FILE_UNAVAILABLE");
        if (r.sha256 !== null) return r;
        const [frozen] = await tx
          .update(businessDataExport)
          .set({ bytes, sha256 })
          .where(eq(businessDataExport.id, id))
          .returning();
        return frozen;
      });
    },
    async finishExport(
      actor: Actor,
      businessId: string,
      id: string,
      bytes: number,
      sha256: string,
    ) {
      return access(actor, businessId, async (tx) => {
        const r = await artifact(tx, id, actor);
        if (r.bytes !== bytes || r.sha256 !== sha256)
          throw new ApplicationError("CONFLICT");
        if (r.state === "ready") return;
        if (r.expiresAt <= (await dataNow(tx)) || r.state !== "pending")
          throw new ApplicationError("FILE_UNAVAILABLE");
        await tx
          .update(businessDataExport)
          .set({ state: "ready", bytes, sha256 })
          .where(eq(businessDataExport.id, id));
      });
    },
    readExport: (actor: Actor, businessId: string, id: string) =>
      access(actor, businessId, (tx) => artifact(tx, id, actor)),
    async grant(
      actor: Actor,
      businessId: string,
      id: string,
      tokenHash: string,
      policy: DataPolicy,
    ) {
      return access(actor, businessId, async (tx) => {
        const r = await artifact(tx, id, actor),
          at = await dataNow(tx);
        if (
          r.state !== "ready" ||
          r.expiresAt <= at ||
          !samePolicy(r.policy, policy)
        )
          throw new ApplicationError("FILE_UNAVAILABLE");
        const expiresAt = new Date(
          Math.min(
            r.expiresAt.getTime(),
            at.getTime() + policy.grantSeconds * 1000,
          ),
        );
        await tx.insert(businessDataGrant).values({
          businessId,
          exportId: id,
          actorId: actor.userId,
          tokenHash,
          expiresAt,
        });
        return expiresAt;
      });
    },
    async claimDownload(
      actor: Actor,
      businessId: string,
      id: string,
      tokenHash: string,
    ) {
      return access(actor, businessId, async (tx) => {
        const r = await artifact(tx, id, actor),
          at = await dataNow(tx);
        const [grant] = await tx
          .select()
          .from(businessDataGrant)
          .where(
            and(
              eq(businessDataGrant.tokenHash, tokenHash),
              eq(businessDataGrant.actorId, actor.userId),
              eq(businessDataGrant.exportId, id),
            ),
          )
          .for("update");
        if (
          !grant ||
          grant.usedAt ||
          grant.expiresAt <= at ||
          r.expiresAt <= at ||
          r.state !== "ready"
        )
          throw new ApplicationError("FILE_UNAVAILABLE");
        await tx
          .update(businessDataGrant)
          .set({ usedAt: at })
          .where(eq(businessDataGrant.tokenHash, tokenHash));
        return { artifact: r, expiresAt: grant.expiresAt };
      });
    },
  };
}
export type DataGovernanceRepository = ReturnType<
  typeof createDataGovernanceRepository
>;
