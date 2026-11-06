import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { verifyRuntimeRole } from "./runtime";
import {
  microsoftMailGrant,
  microsoftMailOauth,
  microsoftMailScopeForeignKeys,
  mailboxAppMessage,
  mailboxAppMessageScopeForeignKeys,
  gmailGrant,
  gmailOauth,
  gmailScopeForeignKeys,
  gmailManualMessage,
  gmailMessageScopeForeignKeys,
  mailboxPolicy,
  mailboxJob,
  mailboxScopeForeignKeys,
  senderConnection,
  senderReplyRoute,
  senderIdentity,
  senderObservation,
  senderScopeForeignKeys,
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
  aiProfile,
  aiActivation,
  aiActivationAudit,
  aiExecution,
  aiAttempt,
  aiReview,
  aiExecutionScopeForeignKeys,
  inboxScopeForeignKeys,
  inboxConnection,
  inboxBuyer,
  inboxConversation,
  inboxOpportunity,
  inboxMessage,
  inboxEvent,
  inboxAssociation,
  inboxMessageLink,
  inboxAssociationHistory,
  inboxOpportunityHistory,
  opportunityControlHistory,
  opportunityManualEvent,
  opportunityDueAction,
  inquiryRun,
  rfqRequest,
  rfqRevision,
  callActivity,
  callRevision,
  opportunityScopeForeignKeys,
  commercialProposal,
  commercialDecision,
  commercialExecution,
  commercialOutcome,
  commercialScopeForeignKeys,
  bookingPolicy,
  microsoftCalendarGrant,
  microsoftCalendarOauth,
  microsoftCalendarScopeForeignKeys,
  googleCalendarGrant,
  googleCalendarOauth,
  googleCalendarScopeForeignKeys,
  appointment,
  appointmentHistory,
  appointmentScopeForeignKeys,
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
      IF FOUND THEN
      UPDATE public.discovery_run r SET stop_reason = CASE WHEN accepted THEN NULL ELSE 'queue_unavailable' END
        FROM public.discovery_dispatch d WHERE d.id = dispatch AND d.payload->>'kind' = 'discovery'
        AND r.id = (d.payload->'work'->>'runId')::uuid AND r.business_id = d.business_id
        AND r.execution_id = (d.payload->'work'->>'executionKey')::uuid AND r.status = 'queued';
      END IF;
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
      IF reason NOT IN ('completed', 'budget_exhausted', 'provider_unavailable', 'provider_uncertain', 'provider_rate_limited', 'provider_permission_denied', 'invalid_provider_response', 'interrupted', 'defect', 'authorization_revoked', 'configuration_changed', 'queue_unavailable', 'worker_lost', 'cancelled') THEN RAISE EXCEPTION 'Invalid stop reason'; END IF;
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
    CREATE OR REPLACE FUNCTION public.rfq_owner_is_current(owner_id text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF public.current_business_role() IS NULL THEN RETURN false; END IF;
      RETURN EXISTS (SELECT 1 FROM public.membership m
        WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
          AND m.user_id = owner_id);
    END $$;
    REVOKE ALL ON FUNCTION public.rfq_owner_is_current(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.rfq_owner_is_current(text) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.call_responsible_members()
    RETURNS TABLE("userId" text, name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF public.current_business_role() IS NULL THEN RETURN; END IF;
      RETURN QUERY SELECT m.user_id, coalesce(nullif(u.name, ''), u.email) FROM public.membership m
        JOIN public."user" u ON u.id = m.user_id
        WHERE m.business_id = nullif(current_setting('app.business_id', true), '')::uuid
          AND m.role IN ('owner', 'admin', 'salesperson') ORDER BY u.name, m.user_id;
    END $$;
    REVOKE ALL ON FUNCTION public.call_responsible_members() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.call_responsible_members() TO app_runtime;
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
      IF to_regclass('public.ai_profile') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.ai_profile, public.ai_activation, public.ai_execution, public.ai_attempt, public.ai_review FROM app_runtime;
        REVOKE ALL PRIVILEGES (used_attempts, used_fallback_attempts) ON public.ai_profile FROM app_runtime;
        REVOKE ALL PRIVILEGES (status, failure, output) ON public.ai_execution FROM app_runtime;
        REVOKE ALL PRIVILEGES (outcome, failure, metrics, latency_ms) ON public.ai_attempt FROM app_runtime;
      END IF;
      IF to_regclass('public.ai_activation_audit') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.ai_activation_audit FROM app_runtime;
      END IF;
      IF to_regclass('public.inbox_connection') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.inbox_connection, public.inbox_buyer, public.inbox_conversation, public.inbox_opportunity, public.inbox_message, public.inbox_event FROM app_runtime;
        REVOKE ALL PRIVILEGES (active) ON public.inbox_connection FROM app_runtime;
        REVOKE ALL PRIVILEGES (last_received_at) ON public.inbox_conversation FROM app_runtime;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inbox_message' AND column_name='mailbox_current_metadata') THEN
          REVOKE UPDATE (mailbox_current_metadata) ON public.inbox_message FROM app_runtime;
        END IF;
      END IF;
      IF to_regclass('public.inbox_association') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.inbox_association, public.inbox_message_link, public.inbox_association_history, public.inbox_opportunity_history FROM app_runtime;
        REVOKE ALL PRIVILEGES (buyer_id, default_opportunity_id, version, review_reason, review_owner_id, next_action) ON public.inbox_association FROM app_runtime;
        REVOKE ALL PRIVILEGES (opportunity_id) ON public.inbox_message_link FROM app_runtime;
      END IF;
      IF to_regclass('public.opportunity_control_history') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.opportunity_control_history, public.opportunity_manual_event, public.opportunity_due_action FROM app_runtime;
        REVOKE ALL PRIVILEGES (state, reason) ON public.opportunity_due_action FROM app_runtime;
        REVOKE ALL PRIVILEGES (owner_id, handoff_reason, next_action, control_state, control_version, policy_version) ON public.inbox_opportunity FROM app_runtime;
      END IF;
      IF to_regclass('public.inquiry_run') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.inquiry_run FROM app_runtime;
        REVOKE ALL PRIVILEGES (result, execution_id) ON public.inquiry_run FROM app_runtime;
      END IF;
      IF to_regclass('public.rfq_request') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.rfq_request FROM app_runtime;
      END IF;
      IF to_regclass('public.call_activity') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.call_activity FROM app_runtime;
      END IF;
      IF to_regclass('public.call_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.call_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.rfq_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.rfq_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.commercial_proposal') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.commercial_proposal, public.commercial_decision, public.commercial_execution, public.commercial_outcome FROM app_runtime;
        REVOKE ALL PRIVILEGES (state, reason, reference) ON public.commercial_execution FROM app_runtime;
      END IF;
      IF to_regclass('public.booking_policy') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.booking_policy, public.appointment, public.appointment_history FROM app_runtime;
        REVOKE ALL PRIVILEGES (status, phase, event, reason, cancellation) ON public.appointment FROM app_runtime;
      END IF;
      IF to_regclass('public.google_calendar_grant') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.google_calendar_grant, public.google_calendar_oauth FROM app_runtime;
        REVOKE UPDATE (generation, status, reason, account_subject, account_email, selected_calendar_id, credentials, rejected_credentials, scopes, authorized_at, actor_id, at) ON public.google_calendar_grant FROM app_runtime;
        REVOKE UPDATE (consumed) ON public.google_calendar_oauth FROM app_runtime;
      END IF;
      IF to_regclass('public.microsoft_mail_grant') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.microsoft_mail_grant, public.microsoft_mail_oauth FROM app_runtime;
      END IF;
      IF to_regclass('public.mailbox_app_message') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.mailbox_app_message FROM app_runtime;
      END IF;
      IF to_regclass('public.gmail_grant') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.gmail_grant, public.gmail_oauth FROM app_runtime;
        REVOKE UPDATE (generation, status, reason, account_subject, credentials, rejected_credentials, scopes, authorized_at) ON public.gmail_grant FROM app_runtime;
        REVOKE UPDATE (consumed) ON public.gmail_oauth FROM app_runtime;
      END IF;
      IF to_regclass('public.gmail_manual_message') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.gmail_manual_message FROM app_runtime;
        REVOKE UPDATE (conversation_id, opportunity_id, state) ON public.gmail_manual_message FROM app_runtime;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gmail_manual_message' AND column_name='current_metadata') THEN
          REVOKE UPDATE (current_metadata) ON public.gmail_manual_message FROM app_runtime;
        END IF;
      END IF;
      IF to_regclass('public.microsoft_calendar_grant') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.microsoft_calendar_grant, public.microsoft_calendar_oauth FROM app_runtime;
        REVOKE UPDATE (generation, status, reason, account_subject, account_email, selected_calendar_id, credentials, account_kind, tenant_id, scopes, authorized_at, actor_id, at) ON public.microsoft_calendar_grant FROM app_runtime;
        REVOKE UPDATE (consumed) ON public.microsoft_calendar_oauth FROM app_runtime;
      END IF;
      IF to_regclass('public.mailbox_policy') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.mailbox_policy, public.mailbox_job FROM app_runtime;
        REVOKE UPDATE (version, connection_version, configuration, incremental_since, cursor, permission_observation, updated_at) ON public.mailbox_policy FROM app_runtime;
        REVOKE UPDATE (state, cursor, seen, identity) ON public.mailbox_job FROM app_runtime;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mailbox_job' AND column_name='successor_id') THEN
          REVOKE UPDATE (successor_id) ON public.mailbox_job FROM app_runtime;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mailbox_policy' AND column_name='visibility') THEN
          REVOKE UPDATE (visibility, last_synced_at) ON public.mailbox_policy FROM app_runtime;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mailbox_policy' AND column_name='complete_reply_capture') THEN
          REVOKE UPDATE (complete_reply_capture) ON public.mailbox_policy FROM app_runtime;
        END IF;
      END IF;
      IF to_regclass('public.sender_identity') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.sender_connection, public.sender_reply_route, public.sender_identity, public.sender_observation FROM app_runtime;
        REVOKE UPDATE (version, configuration, updated_at) ON public.sender_connection FROM app_runtime;
        REVOKE UPDATE (version, configuration, updated_at, connection_id, inbox_connection_id) ON public.sender_reply_route FROM app_runtime;
        REVOKE UPDATE (version, configuration, updated_at, connection_id, reply_route_id) ON public.sender_identity FROM app_runtime;
      END IF;
      -- The pinned push can replace ai_execution_scope before dropping its
      -- dependents. Access above is paused; remove only these named FKs so push
      -- can reconcile that unique constraint. secureDatabase validates/restores
      -- them from the schema before runtime access is restored.
      IF to_regclass('public.ai_attempt') IS NOT NULL THEN
        ALTER TABLE public.ai_attempt DROP CONSTRAINT IF EXISTS ai_attempt_execution_scope;
      END IF;
      IF to_regclass('public.ai_review') IS NOT NULL THEN
        ALTER TABLE public.ai_review DROP CONSTRAINT IF EXISTS ai_review_execution_scope;
      END IF;
    END $$;
  `);
  // The pinned introspector treats an index referenced by any FK as constraint-
  // generated and hides it, then tries to CREATE the existing index. Runtime
  // access above is paused. Remove only our scoped FKs (never rows/indexes);
  // secureDatabase validates and restores them before restoring access.
  const database = drizzle(pool);
  for (const key of [
    ...mailboxScopeForeignKeys,
    ...gmailScopeForeignKeys,
    ...microsoftMailScopeForeignKeys,
    ...mailboxAppMessageScopeForeignKeys,
    ...gmailMessageScopeForeignKeys,
    ...senderScopeForeignKeys,
    ...inboxScopeForeignKeys,
    ...opportunityScopeForeignKeys,
    ...commercialScopeForeignKeys,
    ...appointmentScopeForeignKeys,
    ...microsoftCalendarScopeForeignKeys,
    ...googleCalendarScopeForeignKeys,
  ]) {
    const { name } = getTableConfig(key.table);
    const exists = await pool.query<{ present: boolean }>(
      "select to_regclass($1) is not null as present",
      [`public.${name}`],
    );
    if (!exists.rows[0]?.present) continue;
    await database.execute(
      sql`alter table ${key.table} drop constraint if exists ${sql.identifier(key.getName())}`,
    );
  }
}

/** Idempotent security settings which the pinned Drizzle version cannot express. */
export async function secureDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = drizzle(client);
    // Upgrade #17 without rewriting source records. Reapplication never resets corrections.
    await client.query(`
      UPDATE inbox_opportunity o SET buyer_id = c.buyer_id, title = c.subject
        FROM inbox_conversation c WHERE o.conversation_id = c.id AND o.business_id = c.business_id AND o.buyer_id IS NULL;
      INSERT INTO inbox_association (id,business_id,buyer_id,initial_opportunity_id,default_opportunity_id,version,review_reason,review_owner_id,next_action)
        SELECT c.id,c.business_id,c.buyer_id,o.id,o.id,0,NULL,cn.created_by,'Review incoming inquiry'
        FROM inbox_conversation c JOIN inbox_opportunity o ON o.conversation_id = c.id AND o.business_id = c.business_id
        JOIN inbox_connection cn ON cn.id = c.connection_id AND cn.business_id = c.business_id
        ON CONFLICT (id) DO NOTHING;
      UPDATE inbox_association a SET initial_opportunity_id=o.id FROM inbox_opportunity o
        WHERE o.conversation_id=a.id AND o.business_id=a.business_id AND a.initial_opportunity_id IS NULL;
      INSERT INTO inbox_message_link (id,business_id,conversation_id,opportunity_id)
        SELECT m.id,m.business_id,m.conversation_id,o.id FROM inbox_message m
        JOIN inbox_opportunity o ON o.conversation_id = m.conversation_id AND o.business_id = m.business_id
        ON CONFLICT (id) DO NOTHING;
    `);
    // An equivalent unique index avoids the pinned push's composite-UNIQUE
    // replacement order bug. Reconcile it before restoring the scoped FKs;
    // IF NOT EXISTS also recognizes the old constraint's supporting index.
    await client.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS ai_execution_scope ON public.ai_execution (id, business_id)",
    );
    for (const key of [
      ...mailboxScopeForeignKeys,
      ...gmailScopeForeignKeys,
      ...microsoftMailScopeForeignKeys,
      ...mailboxAppMessageScopeForeignKeys,
      ...gmailMessageScopeForeignKeys,
      ...senderScopeForeignKeys,
      ...aiExecutionScopeForeignKeys,
      ...inboxScopeForeignKeys,
      ...opportunityScopeForeignKeys,
      ...commercialScopeForeignKeys,
      ...appointmentScopeForeignKeys,
      ...microsoftCalendarScopeForeignKeys,
      ...googleCalendarScopeForeignKeys,
    ]) {
      const table = key.table;
      const reference = key.reference();
      await database.execute(
        sql`alter table ${table} drop constraint if exists ${sql.identifier(key.getName())}`,
      );
      await database.execute(sql`alter table ${table} add constraint ${sql.identifier(key.getName())}
          foreign key (${sql.join(
            reference.columns.map((column) => sql.identifier(column.name)),
            sql`, `,
          )})
          references ${reference.foreignTable} (${sql.join(
            reference.foreignColumns.map((column) =>
              sql.identifier(column.name),
            ),
            sql`, `,
          )})`);
    }
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
      mailboxPolicy,
      microsoftMailGrant,
      microsoftMailOauth,
      mailboxAppMessage,
      gmailGrant,
      gmailOauth,
      gmailManualMessage,
      mailboxJob,
      senderConnection,
      senderReplyRoute,
      senderIdentity,
      senderObservation,
      microsoftCalendarGrant,
      microsoftCalendarOauth,
      googleCalendarGrant,
      googleCalendarOauth,
      bookingPolicy,
      appointment,
      appointmentHistory,
      commercialProposal,
      commercialDecision,
      commercialExecution,
      commercialOutcome,
      rfqRequest,
      rfqRevision,
      callActivity,
      callRevision,
      inquiryRun,
      opportunityControlHistory,
      opportunityManualEvent,
      opportunityDueAction,
      inboxConnection,
      inboxBuyer,
      inboxConversation,
      inboxOpportunity,
      inboxMessage,
      inboxEvent,
      inboxAssociation,
      inboxMessageLink,
      inboxAssociationHistory,
      inboxOpportunityHistory,
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
      aiProfile,
      aiActivation,
      aiActivationAudit,
      aiExecution,
      aiAttempt,
      aiReview,
    ]) {
      for (const policy of getTableConfig(table).policies) {
        await database.execute(sql`alter policy ${sql.identifier(policy.name)} on ${table}
          to ${policy.to === "public" ? sql`public` : sql.identifier("app_runtime")}
          ${policy.using ? sql`using (${policy.using})` : sql``}
          ${policy.withCheck ? sql`with check (${policy.withCheck})` : sql``}`);
      }
    }
    await client.query(`
      REVOKE ALL PRIVILEGES ON gmail_grant, gmail_oauth FROM app_runtime;
      REVOKE ALL PRIVILEGES ON microsoft_mail_grant, microsoft_mail_oauth FROM app_runtime;
      REVOKE ALL PRIVILEGES ON mailbox_app_message FROM app_runtime;
      GRANT SELECT, INSERT ON mailbox_app_message TO app_runtime;
      ALTER TABLE mailbox_app_message FORCE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON microsoft_mail_grant, microsoft_mail_oauth TO app_runtime;
      GRANT UPDATE (generation, status, reason, account_subject, credentials, rejected_credentials, scopes, authorized_at) ON microsoft_mail_grant TO app_runtime;
      GRANT UPDATE (consumed) ON microsoft_mail_oauth TO app_runtime;
      ALTER TABLE microsoft_mail_grant FORCE ROW LEVEL SECURITY;
      ALTER TABLE microsoft_mail_oauth FORCE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON gmail_grant, gmail_oauth TO app_runtime;
      GRANT UPDATE (generation, status, reason, account_subject, credentials, rejected_credentials, scopes, authorized_at) ON gmail_grant TO app_runtime;
      GRANT UPDATE (consumed) ON gmail_oauth TO app_runtime;
      ALTER TABLE gmail_grant FORCE ROW LEVEL SECURITY;
      ALTER TABLE gmail_oauth FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON gmail_manual_message FROM app_runtime;
      GRANT SELECT, INSERT ON gmail_manual_message TO app_runtime;
      GRANT UPDATE (conversation_id, opportunity_id, state, current_metadata) ON gmail_manual_message TO app_runtime;
      ALTER TABLE gmail_manual_message FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON mailbox_policy, mailbox_job FROM app_runtime;
      GRANT SELECT, INSERT ON mailbox_policy, mailbox_job TO app_runtime;
      GRANT UPDATE (version, connection_version, configuration, incremental_since, cursor, permission_observation, updated_at, visibility, last_synced_at, complete_reply_capture) ON mailbox_policy TO app_runtime;
      GRANT UPDATE (state, cursor, seen, identity, successor_id) ON mailbox_job TO app_runtime;
      ALTER TABLE mailbox_policy FORCE ROW LEVEL SECURITY;
      ALTER TABLE mailbox_job FORCE ROW LEVEL SECURITY;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON sender_connection, sender_reply_route, sender_identity, sender_observation FROM app_runtime;
      GRANT SELECT, INSERT ON sender_connection, sender_reply_route, sender_identity, sender_observation TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at) ON sender_connection TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at, connection_id, inbox_connection_id) ON sender_reply_route TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at, connection_id, reply_route_id) ON sender_identity TO app_runtime;
      ALTER TABLE sender_connection FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_reply_route FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_identity FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_observation FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON google_calendar_grant, google_calendar_oauth FROM app_runtime;
      GRANT SELECT, INSERT ON google_calendar_grant, google_calendar_oauth TO app_runtime;
      GRANT UPDATE (generation, status, reason, account_subject, account_email, selected_calendar_id, credentials, rejected_credentials, scopes, authorized_at, actor_id, at) ON google_calendar_grant TO app_runtime;
      GRANT UPDATE (consumed) ON google_calendar_oauth TO app_runtime;
      ALTER TABLE google_calendar_grant FORCE ROW LEVEL SECURITY;
      ALTER TABLE google_calendar_oauth FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON microsoft_calendar_grant, microsoft_calendar_oauth FROM app_runtime;
      GRANT SELECT, INSERT ON microsoft_calendar_grant, microsoft_calendar_oauth TO app_runtime;
      GRANT UPDATE (generation, status, reason, account_subject, account_email, selected_calendar_id, credentials, account_kind, tenant_id, scopes, authorized_at, actor_id, at) ON microsoft_calendar_grant TO app_runtime;
      GRANT UPDATE (consumed) ON microsoft_calendar_oauth TO app_runtime;
      ALTER TABLE microsoft_calendar_grant FORCE ROW LEVEL SECURITY;
      ALTER TABLE microsoft_calendar_oauth FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON booking_policy, appointment, appointment_history FROM app_runtime;
      GRANT SELECT, INSERT ON booking_policy, appointment, appointment_history TO app_runtime;
      GRANT UPDATE (status, phase, event, reason, cancellation) ON appointment TO app_runtime;
      ALTER TABLE booking_policy FORCE ROW LEVEL SECURITY;
      ALTER TABLE appointment FORCE ROW LEVEL SECURITY;
      ALTER TABLE appointment_history FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON commercial_proposal, commercial_decision, commercial_execution, commercial_outcome FROM app_runtime;
      GRANT SELECT, INSERT ON commercial_proposal, commercial_decision, commercial_execution, commercial_outcome TO app_runtime;
      GRANT UPDATE (state, reason, reference) ON commercial_execution TO app_runtime;
      ALTER TABLE commercial_proposal FORCE ROW LEVEL SECURITY;
      ALTER TABLE commercial_decision FORCE ROW LEVEL SECURITY;
      ALTER TABLE commercial_execution FORCE ROW LEVEL SECURITY;
      ALTER TABLE commercial_outcome FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON rfq_request, rfq_revision FROM app_runtime;
      GRANT SELECT, INSERT ON rfq_request, rfq_revision TO app_runtime;
      ALTER TABLE rfq_request FORCE ROW LEVEL SECURITY;
      ALTER TABLE rfq_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON call_activity, call_revision FROM app_runtime;
      GRANT SELECT, INSERT ON call_activity, call_revision TO app_runtime;
      ALTER TABLE call_activity FORCE ROW LEVEL SECURITY;
      ALTER TABLE call_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON inbox_connection, inbox_buyer, inbox_conversation, inbox_opportunity, inbox_message, inbox_event FROM app_runtime;
      GRANT SELECT, INSERT ON inbox_connection, inbox_buyer, inbox_conversation, inbox_opportunity, inbox_message, inbox_event TO app_runtime;
      GRANT UPDATE (active) ON inbox_connection TO app_runtime;
      GRANT UPDATE (last_received_at) ON inbox_conversation TO app_runtime;
      GRANT UPDATE (mailbox_current_metadata) ON inbox_message TO app_runtime;
      GRANT UPDATE (owner_id, handoff_reason, next_action, control_state, control_version, policy_version) ON inbox_opportunity TO app_runtime;
      REVOKE ALL PRIVILEGES ON opportunity_control_history, opportunity_manual_event, opportunity_due_action FROM app_runtime;
      GRANT SELECT, INSERT ON opportunity_control_history, opportunity_manual_event, opportunity_due_action TO app_runtime;
      GRANT UPDATE (state, reason) ON opportunity_due_action TO app_runtime;
      REVOKE ALL PRIVILEGES ON inquiry_run FROM app_runtime;
      GRANT SELECT, INSERT ON inquiry_run TO app_runtime;
      GRANT UPDATE (result, execution_id) ON inquiry_run TO app_runtime;
      ALTER TABLE inquiry_run FORCE ROW LEVEL SECURITY;
      ALTER TABLE opportunity_control_history FORCE ROW LEVEL SECURITY;
      ALTER TABLE opportunity_manual_event FORCE ROW LEVEL SECURITY;
      ALTER TABLE opportunity_due_action FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_connection FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_buyer FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_conversation FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_opportunity FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_message FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_event FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON inbox_association, inbox_message_link, inbox_association_history FROM app_runtime;
      GRANT SELECT, INSERT ON inbox_association, inbox_message_link, inbox_association_history TO app_runtime;
      GRANT UPDATE (buyer_id, default_opportunity_id, version, review_reason, review_owner_id, next_action) ON inbox_association TO app_runtime;
      GRANT UPDATE (opportunity_id) ON inbox_message_link TO app_runtime;
      ALTER TABLE inbox_association FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_message_link FORCE ROW LEVEL SECURITY;
      ALTER TABLE inbox_association_history FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON inbox_opportunity_history FROM app_runtime;
      GRANT SELECT ON inbox_opportunity_history TO app_runtime;
      ALTER TABLE inbox_opportunity_history FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON ai_profile, ai_activation, ai_activation_audit, ai_execution, ai_attempt, ai_review FROM app_runtime;
      GRANT SELECT, INSERT ON ai_profile, ai_activation, ai_activation_audit, ai_execution, ai_attempt, ai_review TO app_runtime;
      GRANT UPDATE (used_attempts, used_fallback_attempts) ON ai_profile TO app_runtime;
      GRANT UPDATE (status, failure, output) ON ai_execution TO app_runtime;
      GRANT UPDATE (outcome, failure, metrics, latency_ms) ON ai_attempt TO app_runtime;
      ALTER TABLE ai_profile FORCE ROW LEVEL SECURITY;
      ALTER TABLE ai_activation FORCE ROW LEVEL SECURITY;
      ALTER TABLE ai_activation_audit FORCE ROW LEVEL SECURITY;
      ALTER TABLE ai_execution FORCE ROW LEVEL SECURITY;
      ALTER TABLE ai_attempt FORCE ROW LEVEL SECURITY;
      ALTER TABLE ai_review FORCE ROW LEVEL SECURITY;
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
