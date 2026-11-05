import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { verifyRuntimeRole } from "./runtime";
import {
  business,
  membership,
  invitation,
  teamAudit,
  platformOperator,
  businessFile,
  fileAccess,
  fileUsage,
  knowledgeRevision,
  commercialAuthorityRevision,
  discoveryConfiguration,
  discoveryRun,
  discoveryProspect,
  discoveryResult,
  discoveryUsage,
  discoveryProspectAlias,
  discoveryObservation,
  discoveryCommand,
  discoverySchedule,
  discoveryDispatch,
} from "./schema";

async function prepareFileCleanup(pool: Pool) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.claim_file_cleanup(scope text, at_time timestamptz, lease_seconds integer)
    RETURNS TABLE(id uuid, business_id uuid, operation_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF lease_seconds <= 0 THEN RAISE EXCEPTION 'Invalid cleanup lease'; END IF;
      DELETE FROM public.file_access a USING public.business_file f
        WHERE a.file_id = f.id AND f.account_scope = scope AND a.expires_at <= at_time;
      DELETE FROM public.business_file f WHERE f.account_scope = scope
        AND f.state = 'deleted' AND f.purge_after <= at_time;
      RETURN QUERY WITH due AS (
        SELECT f.id FROM public.business_file f
        WHERE f.account_scope = scope AND f.state <> 'deleted' AND f.cleanup_after <= at_time
        ORDER BY f.cleanup_after, f.id LIMIT 50 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE public.business_file f SET state = 'deleting', operation_id = gen_random_uuid(),
          cleanup_after = at_time + make_interval(secs => lease_seconds)
        FROM due WHERE f.id = due.id RETURNING f.*
      ), attempts AS (
        INSERT INTO public.file_usage (id, file_id, business_id, account_scope, action, outcome, at)
        SELECT c.operation_id, c.id, c.business_id, c.account_scope, 'delete', 'uncertain', at_time FROM claimed c
      ) SELECT c.id, c.business_id, c.operation_id FROM claimed c;
    END $$;
    CREATE OR REPLACE FUNCTION public.finish_file_cleanup(file_id uuid, operation uuid, at_time timestamptz, success boolean)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      UPDATE public.business_file f SET
        state = CASE WHEN success THEN 'deleted' ELSE 'deleting' END,
        deleted_at = CASE WHEN success THEN at_time ELSE NULL END,
        purge_after = CASE WHEN success THEN at_time + make_interval(secs => f.record_retention_seconds) ELSE NULL END,
        cleanup_after = CASE WHEN success THEN NULL ELSE f.cleanup_after END,
        failure = CASE WHEN success THEN NULL ELSE 'CLEANUP_FAILED' END
      WHERE f.id = file_id AND f.operation_id = operation AND f.state = 'deleting';
      IF FOUND AND success THEN
        UPDATE public.file_usage u SET outcome = 'succeeded' WHERE u.id = operation AND u.file_id = finish_file_cleanup.file_id;
        DELETE FROM public.file_access a WHERE a.file_id = finish_file_cleanup.file_id;
      END IF;
    END $$;
    REVOKE ALL ON FUNCTION public.claim_file_cleanup(text, timestamptz, integer), public.finish_file_cleanup(uuid, uuid, timestamptz, boolean) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.claim_file_cleanup(text, timestamptz, integer), public.finish_file_cleanup(uuid, uuid, timestamptz, boolean) TO app_runtime;
  `);
}

/** Role setup is separate because Drizzle does not model all privilege attributes. */
export async function prepareDatabaseRole(pool: Pool) {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;
  `);
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb) AS safe
    FROM pg_roles WHERE rolname = 'app_runtime'
  `);
  if (result.rows[0]?.safe !== true)
    throw new Error(
      "app_runtime has unsafe privileges. Review the role before pushing.",
    );
  // PostgreSQL 16+ may grant the creator ADMIN without SET. Allow the owner to
  // verify the runtime role, never the reverse membership that would bypass RLS.
  await pool.query(
    "GRANT app_runtime TO CURRENT_USER WITH INHERIT FALSE, SET TRUE",
  );
  await prepareFileCleanup(pool);
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.pending_discovery_dispatches()
    RETURNS TABLE(id uuid, payload jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN RETURN QUERY SELECT d.id, d.payload FROM public.discovery_dispatch d
      WHERE d.state = 'pending' ORDER BY d.attempts, d.created_at, d.id LIMIT 50; END $$;
    CREATE OR REPLACE FUNCTION public.finish_discovery_dispatch(dispatch uuid, accepted boolean)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN UPDATE public.discovery_dispatch d SET
      attempts = d.attempts + 1, state = CASE WHEN accepted THEN 'enqueued' ELSE 'pending' END,
      failure = CASE WHEN accepted THEN NULL ELSE 'queue_unavailable' END
      WHERE d.id = dispatch AND d.state = 'pending';
      UPDATE public.discovery_run r SET stop_reason = CASE WHEN accepted THEN NULL ELSE 'queue_unavailable' END
        FROM public.discovery_dispatch d WHERE d.id = dispatch AND d.payload->>'kind' = 'discovery'
        AND r.id = (d.payload->'work'->>'runId')::uuid AND r.business_id = d.business_id
        AND r.execution_id = (d.payload->'work'->>'executionKey')::uuid AND r.status = 'queued';
      END $$;
    CREATE OR REPLACE FUNCTION public.fail_discovery_schedule(schedule uuid, scope uuid, revision integer, capability uuid, reason text, at_time timestamptz, due_time timestamptz)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF reason NOT IN ('authorization_revoked', 'configuration_changed', 'setup_required', 'worker_lost') THEN RAISE EXCEPTION 'Invalid schedule failure'; END IF;
      UPDATE public.discovery_schedule s SET failure = reason, status = 'paused', next_due_at = NULL, updated_at = at_time
        WHERE s.id = schedule AND s.business_id = scope AND s.revision = fail_discovery_schedule.revision AND s.dispatch_key = capability AND s.next_due_at = due_time;
    END $$;
    REVOKE ALL ON FUNCTION public.pending_discovery_dispatches(), public.finish_discovery_dispatch(uuid, boolean), public.fail_discovery_schedule(uuid, uuid, integer, uuid, text, timestamptz, timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.pending_discovery_dispatches(), public.finish_discovery_dispatch(uuid, boolean), public.fail_discovery_schedule(uuid, uuid, integer, uuid, text, timestamptz, timestamptz) TO app_runtime;
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.finish_discovery(run uuid, scope uuid, execution uuid, reason text, at_time timestamptz)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF reason NOT IN ('completed', 'budget_exhausted', 'provider_unavailable', 'provider_rate_limited', 'provider_permission_denied', 'invalid_provider_response', 'interrupted', 'defect', 'authorization_revoked', 'configuration_changed', 'queue_unavailable', 'worker_lost', 'cancelled') THEN RAISE EXCEPTION 'Invalid stop reason'; END IF;
      UPDATE public.discovery_run r SET status = CASE WHEN reason = 'completed' THEN 'completed' ELSE 'stopped' END,
        stop_reason = reason, updated_at = at_time
        WHERE r.id = run AND r.business_id = scope AND r.execution_id = execution AND r.status IN ('queued', 'running');
      IF FOUND THEN
        UPDATE public.discovery_usage u SET outcome = 'uncertain'
          WHERE u.run_id = run AND u.business_id = scope AND u.outcome = 'reserved';
      END IF;
    END $$;
    REVOKE ALL ON FUNCTION public.finish_discovery(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.finish_discovery(uuid, uuid, uuid, text, timestamptz) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.fail_discovery_operation(run uuid, scope uuid, execution uuid, operation uuid)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      UPDATE public.discovery_usage u SET outcome = 'failed'
        WHERE u.id = operation AND u.run_id = run AND u.business_id = scope AND u.outcome = 'reserved'
        AND EXISTS (SELECT 1 FROM public.discovery_run r WHERE r.id = run AND r.business_id = scope AND r.execution_id = execution AND r.status = 'running');
    END $$;
    REVOKE ALL ON FUNCTION public.fail_discovery_operation(uuid, uuid, uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.fail_discovery_operation(uuid, uuid, uuid, uuid) TO app_runtime;
  `);
  // Current escalation owners are visible to current Business members, including
  // Salespeople whose ordinary membership reads cannot enumerate the team.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.commercial_approvers()
    RETURNS TABLE("userId" text, name text, role text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF public.current_business_role() IS NULL THEN RETURN; END IF;
      RETURN QUERY SELECT m.user_id, coalesce(nullif(u.name, ''), u.email), m.role FROM public.membership m
        JOIN public."user" u ON u.id = m.user_id
        WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
          AND m.role IN ('owner', 'admin') ORDER BY u.name, m.user_id;
    END $$;
    REVOKE ALL ON FUNCTION public.commercial_approvers() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.commercial_approvers() TO app_runtime;
  `);
  // Narrow definer helpers avoid recursive membership RLS. PL/pgSQL resolves
  // tables at execution, so they can be installed before the first schema push.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.current_business_role() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN RETURN (SELECT m.role FROM public.membership m
      WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
      AND m.user_id = nullif(current_setting('app.actor_id', true), '')); END $$;
    CREATE OR REPLACE FUNCTION public.inviter_authorized(inviter text, invited_role text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN RETURN EXISTS (SELECT 1 FROM public.membership m
      WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
      AND m.user_id = inviter AND (m.role = 'owner' OR (m.role = 'admin' AND invited_role = 'salesperson'))); END $$;
    REVOKE ALL ON FUNCTION public.current_business_role(), public.inviter_authorized(text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.current_business_role(), public.inviter_authorized(text, text) TO app_runtime;
  `);
  // A push can replace policy definitions. Pause protected access until the
  // final security transaction restores complete policies and privileges.
  await pool.query(`
    DO $$ BEGIN
      IF to_regclass('public.business') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.business FROM app_runtime;
        REVOKE ALL PRIVILEGES (name, offering, home_market, website, updated_at) ON public.business FROM app_runtime;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'business' AND column_name = 'configuration') THEN
          REVOKE ALL PRIVILEGES (configuration) ON public.business FROM app_runtime;
        END IF;
      END IF;
      IF to_regclass('public.membership') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.membership FROM app_runtime;
      END IF;
      IF to_regclass('public.invitation') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.invitation FROM app_runtime;
        REVOKE ALL PRIVILEGES (status, accepted_by, accepted_at, delivery, delivery_started_at) ON public.invitation FROM app_runtime;
      END IF;
      IF to_regclass('public.team_audit') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.team_audit FROM app_runtime;
      END IF;
      IF to_regclass('public.platform_operator') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.platform_operator FROM app_runtime;
      END IF;
      IF to_regclass('public.business_file') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.business_file, public.file_access, public.file_usage FROM app_runtime;
      END IF;
      IF to_regclass('public.knowledge_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.knowledge_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.commercial_authority_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.commercial_authority_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.discovery_run') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.discovery_configuration, public.discovery_run, public.discovery_prospect, public.discovery_result, public.discovery_usage FROM app_runtime;
        REVOKE ALL PRIVILEGES (status, stop_reason, used, completed_steps, updated_at) ON public.discovery_run FROM app_runtime;
        REVOKE ALL PRIVILEGES (outcome) ON public.discovery_usage FROM app_runtime;
      END IF;
      IF to_regclass('public.discovery_command') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.discovery_command FROM app_runtime;
        REVOKE ALL PRIVILEGES (budget, execution_id, execution_user_id, session_id, attempt, completed_search_keys) ON public.discovery_run FROM app_runtime;
        REVOKE ALL PRIVILEGES (sources) ON public.discovery_usage FROM app_runtime;
      END IF;
      IF to_regclass('public.discovery_observation') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.discovery_observation, public.discovery_prospect_alias FROM app_runtime;
        REVOKE ALL PRIVILEGES (returned_results, source_url, checked_at, check_order) ON public.discovery_usage FROM app_runtime;
      END IF;
    END $$;
  `);
}

/** Idempotent security settings which the pinned Drizzle version cannot express. */
export async function secureDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client);
    // The pinned push also misses changes to an existing CHECK expression.
    // Upgrade the original owner-only role check from the schema's definition.
    for (const constraint of getTableConfig(membership).checks) {
      await database.execute(
        sql`alter table ${membership} drop constraint if exists ${sql.identifier(constraint.name)}`,
      );
      await database.execute(
        sql`alter table ${membership} add constraint ${sql.identifier(constraint.name)} check (${constraint.value})`,
      );
    }
    // drizzle-kit 0.31 push deliberately omits USING/WITH CHECK expressions.
    // Apply the schema's expressions here, without a second source of truth.
    for (const table of [
      business,
      membership,
      invitation,
      teamAudit,
      platformOperator,
      businessFile,
      fileAccess,
      fileUsage,
      knowledgeRevision,
      commercialAuthorityRevision,
      discoveryConfiguration,
      discoveryRun,
      discoveryProspect,
      discoveryResult,
      discoveryUsage,
      discoveryProspectAlias,
      discoveryObservation,
      discoveryCommand,
      discoverySchedule,
      discoveryDispatch,
    ]) {
      for (const policy of getTableConfig(table).policies) {
        await database.execute(sql`alter policy ${sql.identifier(policy.name)} on ${table}
          to ${policy.to === "public" ? sql`public` : sql.identifier("app_runtime")}
          ${policy.using ? sql`using (${policy.using})` : sql``}
          ${policy.withCheck ? sql`with check (${policy.withCheck})` : sql``}`);
      }
    }
    await client.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO app_runtime;
      GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, rate_limit, two_factor TO app_runtime;
      REVOKE ALL PRIVILEGES ON business, membership, invitation, team_audit, platform_operator FROM app_runtime;
      GRANT SELECT, INSERT ON membership, business, invitation, team_audit TO app_runtime;
      GRANT SELECT ON platform_operator TO app_runtime;
      GRANT UPDATE (role) ON membership TO app_runtime;
      GRANT DELETE ON membership TO app_runtime;
      GRANT UPDATE (status, accepted_by, accepted_at, delivery, delivery_started_at) ON invitation TO app_runtime;
      GRANT UPDATE (name, offering, home_market, website, configuration, updated_at) ON business TO app_runtime;
      ALTER TABLE membership ALTER CONSTRAINT membership_business_id_business_id_fk DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE business FORCE ROW LEVEL SECURITY;
      ALTER TABLE membership FORCE ROW LEVEL SECURITY;
      ALTER TABLE invitation FORCE ROW LEVEL SECURITY;
      ALTER TABLE team_audit FORCE ROW LEVEL SECURITY;
      ALTER TABLE platform_operator FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON business_file, file_access, file_usage FROM app_runtime;
      GRANT SELECT, INSERT ON business_file TO app_runtime;
      GRANT UPDATE (state, operation_id, sha256, failure, cleanup_after, completed_at) ON business_file TO app_runtime;
      GRANT SELECT, INSERT ON file_access TO app_runtime;
      GRANT SELECT, INSERT ON file_usage TO app_runtime;
      GRANT UPDATE (outcome) ON file_usage TO app_runtime;
      ALTER TABLE business_file FORCE ROW LEVEL SECURITY;
      ALTER TABLE file_access FORCE ROW LEVEL SECURITY;
      ALTER TABLE file_usage FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON knowledge_revision FROM app_runtime;
      GRANT SELECT, INSERT ON knowledge_revision TO app_runtime;
      ALTER TABLE knowledge_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON commercial_authority_revision FROM app_runtime;
      GRANT SELECT, INSERT ON commercial_authority_revision TO app_runtime;
      ALTER TABLE commercial_authority_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON discovery_configuration, discovery_run, discovery_prospect, discovery_result, discovery_usage FROM app_runtime;
      GRANT SELECT ON discovery_configuration TO app_runtime;
      GRANT SELECT, INSERT ON discovery_run, discovery_prospect, discovery_result, discovery_usage TO app_runtime;
      GRANT UPDATE (status, stop_reason, used, completed_steps, updated_at) ON discovery_run TO app_runtime;
      GRANT UPDATE (outcome) ON discovery_usage TO app_runtime;
      GRANT UPDATE (returned_results, source_url, checked_at, check_order) ON discovery_usage TO app_runtime;
      REVOKE ALL PRIVILEGES ON discovery_prospect_alias, discovery_observation FROM app_runtime;
      GRANT SELECT, INSERT ON discovery_prospect_alias, discovery_observation TO app_runtime;
      ALTER TABLE discovery_configuration FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_run FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_prospect FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_result FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_usage FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_prospect_alias FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_observation FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON discovery_command FROM app_runtime;
      GRANT SELECT, INSERT ON discovery_command TO app_runtime;
      ALTER TABLE discovery_command FORCE ROW LEVEL SECURITY;
      GRANT UPDATE (budget, execution_id, execution_user_id, session_id, attempt, completed_search_keys) ON discovery_run TO app_runtime;
      GRANT UPDATE (sources) ON discovery_usage TO app_runtime;
      REVOKE ALL PRIVILEGES ON discovery_schedule, discovery_dispatch FROM app_runtime;
      GRANT SELECT, INSERT, UPDATE ON discovery_schedule TO app_runtime;
      GRANT SELECT, INSERT ON discovery_dispatch TO app_runtime;
      ALTER TABLE discovery_schedule FORCE ROW LEVEL SECURITY;
      ALTER TABLE discovery_dispatch FORCE ROW LEVEL SECURITY;
      GRANT UPDATE (durable_run_id, durable_attempt, attempt_started_at, schedule_revision) ON discovery_run TO app_runtime;
      SET LOCAL ROLE app_runtime;
    `);
    await verifyRuntimeRole(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
