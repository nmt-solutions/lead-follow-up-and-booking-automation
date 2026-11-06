import type { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import { verifyRuntimeRole } from "./runtime";
import {
  whatsAppIntake,
  whatsAppOutbound,
  whatsAppReceipt,
  whatsAppIntakeScopeForeignKeys,
  whatsAppConnection,
  whatsAppOauth,
  whatsAppEvent,
  whatsAppEvidence,
  whatsAppScopeForeignKeys,
  emailSequencePolicy,
  emailSequenceScopeForeignKeys,
  emailSequenceRun,
  emailSequenceAction,
  emailSequenceEvent,
  emailHandoff,
  emailHandoffEvidence,
  campaignRevision,
  campaignDecision,
  emailMarketPolicy,
  emailRecipientRevision,
  emailSuppression,
  emailEligibilityEvaluation,
  emailActionReview,
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
  senderHealthRecord,
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
  billingProfileRevision,
  billingProfileReview,
  taxRuleRevision,
  taxRuleDecision,
  taxCalculation,
  taxScopeForeignKeys,
  subscriptionPricingRevision,
  subscriptionQuote,
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
    CREATE OR REPLACE FUNCTION public.pending_email_sequence_work()
    RETURNS TABLE(payload jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN QUERY SELECT jsonb_build_object('businessId',a.business_id,'runId',a.run_id,'actionId',a.id,
      'generation',a.generation,'key',a.execution_key,'identity',a.identity)
      FROM public.email_sequence_action a JOIN public.email_sequence_run r ON r.id=a.run_id AND r.business_id=a.business_id
      WHERE (r.state='active' AND a.state='pending' AND a.queue_state IN ('pending','failed'))
        OR a.state IN ('committed','unknown')
      ORDER BY coalesce(a.recovery_at,a.at),a.id LIMIT 50;
    END $$;
    CREATE OR REPLACE FUNCTION public.stop_email_sequence_work(work jsonb,reason text)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF reason NOT IN ('authorization_changed','worker_lost') THEN RAISE EXCEPTION 'Invalid sequence failure'; END IF;
      UPDATE public.email_sequence_action a SET reason=stop_email_sequence_work.reason,
        state=CASE WHEN stop_email_sequence_work.reason='authorization_changed' THEN 'paused' ELSE 'pending' END,
        queue_state=CASE WHEN stop_email_sequence_work.reason='authorization_changed' THEN 'none' ELSE 'failed' END,
        generation=a.generation+1,execution_key=gen_random_uuid(),queue_run_id=NULL
      FROM public.email_sequence_run r
      WHERE a.id=(work->>'actionId')::uuid AND a.business_id=(work->>'businessId')::uuid
        AND a.run_id=(work->>'runId')::uuid AND a.generation=(work->>'generation')::integer AND a.execution_key=(work->>'key')::uuid
        AND r.id=a.run_id AND r.business_id=a.business_id AND a.identity=work->'identity' AND a.state='pending';
    END $$;
    REVOKE ALL ON FUNCTION public.pending_email_sequence_work(),public.stop_email_sequence_work(jsonb,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.pending_email_sequence_work(),public.stop_email_sequence_work(jsonb,text) TO app_runtime;
  `);
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
      IF to_regclass('public.billing_profile_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.billing_profile_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.subscription_pricing_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.subscription_pricing_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.subscription_quote') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.subscription_quote FROM app_runtime;
      END IF;
      IF to_regclass('public.billing_profile_review') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.billing_profile_review FROM app_runtime;
      END IF;
      IF to_regclass('public.tax_rule_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.tax_rule_revision FROM app_runtime;
      END IF;
      IF to_regclass('public.tax_rule_decision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.tax_rule_decision FROM app_runtime;
      END IF;
      IF to_regclass('public.tax_calculation') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.tax_calculation FROM app_runtime;
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
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='opportunity_due_action' AND column_name='email') THEN
          REVOKE UPDATE (email) ON public.opportunity_due_action FROM app_runtime;
        END IF;
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
      IF to_regclass('public.whatsapp_intake') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.whatsapp_intake,public.whatsapp_receipt FROM app_runtime;
        REVOKE ALL PRIVILEGES (connection_version,account_key,inbox_connection_id,actor_id,enabled_at,receipt_retention_seconds,inbound_at,echo_at,gap) ON public.whatsapp_intake FROM app_runtime;
        REVOKE ALL PRIVILEGES (activity,state,conversation_id,opportunity_id) ON public.whatsapp_receipt FROM app_runtime;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='whatsapp_receipt' AND column_name='status_evidence') THEN REVOKE UPDATE(status_evidence) ON public.whatsapp_receipt FROM app_runtime; END IF;
      END IF;
      IF to_regclass('public.whatsapp_connection') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.whatsapp_connection, public.whatsapp_oauth, public.whatsapp_event FROM app_runtime;
        REVOKE UPDATE (version, configuration, status, reason, terms_actor_id, terms_accepted_at, credentials, provider_key, observation, operation_id, assets, coexistence_finished, phone_number_id) ON public.whatsapp_connection FROM app_runtime;
        REVOKE UPDATE (consumed) ON public.whatsapp_oauth FROM app_runtime;
      END IF;
      IF to_regclass('public.whatsapp_evidence') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.whatsapp_evidence FROM app_runtime;
        REVOKE ALL PRIVILEGES (id, business_id, connection_id, version, actor_id, session_id, at, review, revocation) ON public.whatsapp_evidence FROM app_runtime;
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
      IF to_regclass('public.sender_health_record') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.sender_health_record FROM app_runtime;
        REVOKE ALL ON SEQUENCE public.sender_health_record_position_seq FROM app_runtime;
      END IF;
      IF to_regprocedure('public.sender_health_native(uuid)') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.sender_health_native(uuid) FROM app_runtime; END IF;
      IF to_regprocedure('public.purge_sender_health_artifacts(uuid,timestamptz)') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.purge_sender_health_artifacts(uuid,timestamptz) FROM app_runtime; END IF;
      IF to_regclass('public.email_market_policy') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.email_market_policy, public.email_recipient_revision, public.email_suppression, public.email_eligibility_evaluation, public.email_action_review FROM app_runtime;
      END IF;
      IF to_regclass('public.campaign_revision') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.campaign_revision, public.campaign_decision FROM app_runtime;
      END IF;
      IF to_regclass('public.email_handoff') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.email_handoff, public.email_handoff_evidence FROM app_runtime;
      END IF;
      IF to_regclass('public.email_sequence_run') IS NOT NULL THEN
        REVOKE ALL PRIVILEGES ON public.email_sequence_policy, public.email_sequence_run, public.email_sequence_action, public.email_sequence_event FROM app_runtime;
        REVOKE UPDATE (identity,state,version,reason) ON public.email_sequence_run FROM app_runtime;
        REVOKE UPDATE (state,reason,due_at,generation,execution_key,attempt_id,receipt,queue_state,queue_run_id,recovery_at,identity,control_version) ON public.email_sequence_action FROM app_runtime;
      END IF;
      IF to_regclass('public.inbox_opportunity') IS NOT NULL THEN
        REVOKE UPDATE (stage,buyer_id) ON public.inbox_opportunity FROM app_runtime;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inbox_message' AND column_name='native_sync_generation') THEN
        REVOKE UPDATE (native_sync_generation) ON public.inbox_message, public.gmail_manual_message FROM app_runtime;
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
    ...taxScopeForeignKeys,
    ...emailSequenceScopeForeignKeys,
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
    ...whatsAppScopeForeignKeys,
    ...whatsAppIntakeScopeForeignKeys,
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
      ...taxScopeForeignKeys,
      ...emailSequenceScopeForeignKeys,
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
      ...whatsAppScopeForeignKeys,
      ...whatsAppIntakeScopeForeignKeys,
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
    for (const table of [
      membership,
      opportunityDueAction,
      inboxOpportunity,
      senderHealthRecord,
      whatsAppIntake,
      whatsAppReceipt,
    ]) {
      for (const constraint of getTableConfig(table).checks) {
        await database.execute(
          sql`alter table ${table} drop constraint if exists ${sql.identifier(constraint.name)}`,
        );
        await database.execute(
          sql`alter table ${table} add constraint ${sql.identifier(constraint.name)} check (${constraint.value})`,
        );
      }
    }
    // drizzle-kit 0.31 push deliberately omits USING/WITH CHECK expressions.
    // Apply the schema's expressions here, without a second source of truth.
    for (const table of [
      whatsAppOutbound,
      whatsAppIntake,
      whatsAppReceipt,
      whatsAppEvidence,
      whatsAppConnection,
      whatsAppOauth,
      whatsAppEvent,
      emailSequencePolicy,
      emailSequenceRun,
      emailSequenceAction,
      emailSequenceEvent,
      emailHandoff,
      emailHandoffEvidence,
      campaignRevision,
      campaignDecision,
      emailMarketPolicy,
      emailRecipientRevision,
      emailSuppression,
      emailEligibilityEvaluation,
      emailActionReview,
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
      senderHealthRecord,
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
      billingProfileRevision,
      billingProfileReview,
      taxRuleRevision,
      taxRuleDecision,
      taxCalculation,
      subscriptionPricingRevision,
      subscriptionQuote,
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
      CREATE OR REPLACE FUNCTION public.protect_opportunity_intake() RETURNS trigger
      LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
        -- Schema-owner maintenance includes additive upgrades of populated legacy intake.
        -- Runtime can never assume the schema-owner role (verified by verifyRuntimeRole).
        IF current_user=(SELECT pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c WHERE c.oid='public.inbox_opportunity'::regclass) THEN RETURN NEW; END IF;
        IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.stage IS DISTINCT FROM OLD.stage THEN
          IF NOT (OLD.buyer_id IS NULL AND OLD.stage='prospect' AND NEW.stage='inquiry' AND NEW.buyer_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.email_sequence_action a
              JOIN public.email_sequence_event r ON r.action_id=a.id AND r.business_id=a.business_id AND r.kind='reply_observed'
              JOIN public.email_sequence_event p ON p.action_id=a.id AND p.business_id=a.business_id AND p.kind='attempt_reserved'
              JOIN public.inbox_buyer b ON b.id=NEW.buyer_id AND b.business_id=a.business_id
              WHERE a.opportunity_id=OLD.id AND a.business_id=OLD.business_id
              AND p.envelope->>'recipient'=lower(b.sender_ref) AND ((p.envelope->>'replyInboxId')::uuid=b.connection_id OR ((r.source->>'mailboxId')::uuid=b.connection_id AND r.source->>'connectionId'=p.envelope->>'replyConnectionId'))))
          THEN RAISE EXCEPTION 'Opportunity intake is immutable'; END IF;
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS protect_opportunity_intake ON public.inbox_opportunity;
      CREATE TRIGGER protect_opportunity_intake BEFORE UPDATE ON public.inbox_opportunity FOR EACH ROW EXECUTE FUNCTION public.protect_opportunity_intake();
      REVOKE ALL ON FUNCTION public.protect_opportunity_intake() FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON email_sequence_policy, email_sequence_run, email_sequence_action, email_sequence_event FROM app_runtime;
      GRANT SELECT, INSERT ON email_sequence_policy, email_sequence_run, email_sequence_action, email_sequence_event TO app_runtime;
      GRANT UPDATE (identity,state,version,reason) ON email_sequence_run TO app_runtime;
      GRANT UPDATE (state,reason,due_at,generation,execution_key,attempt_id,receipt,queue_state,queue_run_id,recovery_at,identity,control_version) ON email_sequence_action TO app_runtime;
      ALTER TABLE email_sequence_policy FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_sequence_run FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_sequence_action FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_sequence_event FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON campaign_revision, campaign_decision FROM app_runtime;
      GRANT SELECT, INSERT ON campaign_revision, campaign_decision TO app_runtime;
      REVOKE ALL PRIVILEGES ON email_handoff, email_handoff_evidence FROM app_runtime;
      GRANT SELECT, INSERT ON email_handoff, email_handoff_evidence TO app_runtime;
      ALTER TABLE email_handoff FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_handoff_evidence FORCE ROW LEVEL SECURITY;
      ALTER TABLE campaign_revision FORCE ROW LEVEL SECURITY;
      ALTER TABLE campaign_decision FORCE ROW LEVEL SECURITY;
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
      GRANT UPDATE (native_sync_generation) ON gmail_manual_message TO app_runtime;
      ALTER TABLE gmail_manual_message FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON mailbox_policy, mailbox_job FROM app_runtime;
      GRANT SELECT, INSERT ON mailbox_policy, mailbox_job TO app_runtime;
      GRANT UPDATE (version, connection_version, configuration, incremental_since, cursor, permission_observation, updated_at, visibility, last_synced_at, complete_reply_capture) ON mailbox_policy TO app_runtime;
      GRANT UPDATE (state, cursor, seen, identity, successor_id) ON mailbox_job TO app_runtime;
      ALTER TABLE mailbox_policy FORCE ROW LEVEL SECURITY;
      ALTER TABLE mailbox_job FORCE ROW LEVEL SECURITY;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE ALL PRIVILEGES ON whatsapp_connection, whatsapp_oauth, whatsapp_event FROM app_runtime;
      REVOKE ALL PRIVILEGES ON whatsapp_evidence FROM app_runtime;
      REVOKE ALL PRIVILEGES (id, business_id, connection_id, version, actor_id, session_id, at, review, revocation) ON whatsapp_evidence FROM app_runtime;
      GRANT SELECT, INSERT ON whatsapp_evidence TO app_runtime;
      ALTER TABLE whatsapp_evidence FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON whatsapp_outbound FROM app_runtime;
      REVOKE ALL PRIVILEGES (id,business_id,connection_id,key,actor_id,at,data,position) ON whatsapp_outbound FROM app_runtime;
      GRANT SELECT, INSERT ON whatsapp_outbound TO app_runtime;
      GRANT USAGE ON SEQUENCE whatsapp_outbound_position_seq TO app_runtime;
      ALTER TABLE whatsapp_outbound FORCE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON whatsapp_connection, whatsapp_oauth, whatsapp_event TO app_runtime;
      GRANT UPDATE (version, configuration, status, reason, terms_actor_id, terms_accepted_at, credentials, provider_key, observation, operation_id, assets, coexistence_finished, phone_number_id) ON whatsapp_connection TO app_runtime;
      GRANT UPDATE (consumed) ON whatsapp_oauth TO app_runtime;
      ALTER TABLE whatsapp_connection FORCE ROW LEVEL SECURITY;
      ALTER TABLE whatsapp_oauth FORCE ROW LEVEL SECURITY;
      ALTER TABLE whatsapp_event FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON sender_connection, sender_reply_route, sender_identity, sender_observation FROM app_runtime;
      GRANT SELECT, INSERT ON sender_connection, sender_reply_route, sender_identity, sender_observation TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at) ON sender_connection TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at, connection_id, inbox_connection_id) ON sender_reply_route TO app_runtime;
      GRANT UPDATE (version, configuration, updated_at, connection_id, reply_route_id) ON sender_identity TO app_runtime;
      ALTER TABLE sender_connection FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_reply_route FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_identity FORCE ROW LEVEL SECURITY;
      ALTER TABLE sender_observation FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON sender_health_record FROM app_runtime;
      GRANT SELECT, INSERT ON sender_health_record TO app_runtime;
      GRANT USAGE ON SEQUENCE sender_health_record_position_seq TO app_runtime;
      ALTER TABLE sender_health_record FORCE ROW LEVEL SECURITY;
      CREATE OR REPLACE FUNCTION public.sender_health_native(connection uuid) RETURNS jsonb
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
        SELECT jsonb_build_object('mailboxId',p.id,'generation',g.generation,'accountSubject',g.account_subject,
          'status',g.status,'send',g.scopes ? CASE WHEN p.provider='gmail' THEN 'https://www.googleapis.com/auth/gmail.send' ELSE 'Mail.Send' END)
        FROM public.mailbox_policy p JOIN LATERAL (
          SELECT generation,account_subject,status,scopes FROM public.gmail_grant WHERE id=p.id AND business_id=p.business_id AND p.provider='gmail'
          UNION ALL SELECT generation,account_subject,status,scopes FROM public.microsoft_mail_grant WHERE id=p.id AND business_id=p.business_id AND p.provider='microsoft'
        ) g ON true WHERE p.connection_id=connection AND p.business_id=nullif(current_setting('app.business_id',true),'')::uuid
          AND (public.current_business_role() IS NOT NULL OR EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.sender_health))
      $$;
      REVOKE ALL ON FUNCTION public.sender_health_native(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.sender_health_native(uuid) TO app_runtime;
      CREATE OR REPLACE FUNCTION public.purge_sender_health_artifacts(identity uuid, at_time timestamptz) RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      DECLARE retention integer; affected integer;
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.sender_health) THEN RAISE EXCEPTION 'forbidden'; END IF;
        SELECT (payload->'configuration'->>'retentionDays')::integer INTO retention FROM public.sender_health_record
          WHERE business_id=nullif(current_setting('app.business_id',true),'')::uuid AND identity_id=identity AND kind='policy'
          ORDER BY (payload->>'version')::integer DESC LIMIT 1;
        IF retention IS NULL THEN RETURN 0; END IF;
        UPDATE public.sender_health_record SET payload=jsonb_build_object('kind','evidence','evidence',null)
          WHERE business_id=nullif(current_setting('app.business_id',true),'')::uuid AND identity_id=identity AND kind='evidence'
          AND payload->'evidence'<>'null'::jsonb AND at<at_time-make_interval(days=>retention);
        GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
      END $$;
      REVOKE ALL ON FUNCTION public.purge_sender_health_artifacts(uuid,timestamptz) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.purge_sender_health_artifacts(uuid,timestamptz) TO app_runtime;
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
      GRANT UPDATE (stage, buyer_id) ON inbox_opportunity TO app_runtime;
      REVOKE ALL PRIVILEGES ON opportunity_control_history, opportunity_manual_event, opportunity_due_action FROM app_runtime;
      GRANT SELECT, INSERT ON opportunity_control_history, opportunity_manual_event, opportunity_due_action TO app_runtime;
      GRANT UPDATE (state, reason, email) ON opportunity_due_action TO app_runtime;
      CREATE OR REPLACE FUNCTION public.protect_opportunity_mail() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog, public AS $protect$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.email IS NOT NULL THEN RAISE EXCEPTION 'Mail intent requires a durable commitment'; END IF;
          RETURN NEW;
        END IF;
        IF OLD.email IS NOT NULL AND (NEW.email IS NULL OR NEW.email->'envelope' IS DISTINCT FROM OLD.email->'envelope')
          THEN RAISE EXCEPTION 'Committed mail intent is immutable'; END IF;
        IF OLD.email IS NOT NULL AND NEW.state = 'pending'
          THEN RAISE EXCEPTION 'Committed mail cannot be retried'; END IF;
        IF OLD.email IS NULL AND NEW.email IS NOT NULL AND (
          OLD.state <> 'pending' OR NEW.state <> 'committed' OR
          NEW.email->'envelope'->>'actionId' IS DISTINCT FROM NEW.id::text OR
          NEW.email->'envelope'->>'attemptId' IS DISTINCT FROM NEW.id::text OR
          NEW.email->'envelope'->>'businessId' IS DISTINCT FROM NEW.business_id::text OR
          NEW.email->'envelope'->>'opportunityId' IS DISTINCT FROM NEW.opportunity_id::text OR
          NEW.email->'envelope'->>'mailboxId' IS DISTINCT FROM NEW.connection_id::text OR
          NEW.email->'envelope'->>'messageId' IS DISTINCT FROM NEW.message_id::text OR
          NEW.email->'result' IS DISTINCT FROM 'null'::jsonb OR NEW.email->'sent' IS DISTINCT FROM 'null'::jsonb)
          THEN RAISE EXCEPTION 'Mail intent requires its exact durable commitment'; END IF;
        RETURN NEW;
      END $protect$;
      DROP TRIGGER IF EXISTS protect_opportunity_mail ON public.opportunity_due_action;
      CREATE TRIGGER protect_opportunity_mail BEFORE INSERT OR UPDATE ON public.opportunity_due_action
        FOR EACH ROW EXECUTE FUNCTION public.protect_opportunity_mail();
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
      GRANT UPDATE (native_sync_generation) ON inbox_message TO app_runtime;
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
      GRANT SELECT, INSERT ON email_market_policy, email_recipient_revision, email_suppression, email_eligibility_evaluation, email_action_review TO app_runtime;
      ALTER TABLE email_market_policy FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_recipient_revision FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_suppression FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_eligibility_evaluation FORCE ROW LEVEL SECURITY;
      ALTER TABLE email_action_review FORCE ROW LEVEL SECURITY;
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
      REVOKE ALL PRIVILEGES ON billing_profile_revision FROM app_runtime;
      REVOKE ALL PRIVILEGES ON subscription_pricing_revision FROM app_runtime;
      GRANT SELECT, INSERT ON subscription_pricing_revision TO app_runtime;
      ALTER TABLE subscription_pricing_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON subscription_quote FROM app_runtime;
      GRANT SELECT, INSERT ON subscription_quote TO app_runtime;
      ALTER TABLE subscription_quote FORCE ROW LEVEL SECURITY;
      GRANT SELECT, INSERT ON billing_profile_revision TO app_runtime;
      ALTER TABLE billing_profile_revision FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON billing_profile_review FROM app_runtime;
      GRANT SELECT, INSERT ON billing_profile_review TO app_runtime;
      ALTER TABLE billing_profile_review FORCE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON tax_rule_revision, tax_rule_decision, tax_calculation FROM app_runtime;
      GRANT SELECT, INSERT ON tax_rule_revision, tax_rule_decision, tax_calculation TO app_runtime;
      ALTER TABLE tax_rule_revision FORCE ROW LEVEL SECURITY;
      ALTER TABLE tax_rule_decision FORCE ROW LEVEL SECURITY;
      ALTER TABLE tax_calculation FORCE ROW LEVEL SECURITY;
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
    `);
    await client.query(`
      REVOKE ALL ON whatsapp_intake, whatsapp_receipt FROM app_runtime;
      GRANT SELECT, INSERT ON whatsapp_intake, whatsapp_receipt TO app_runtime;
      GRANT UPDATE (connection_version,account_key,inbox_connection_id,actor_id,enabled_at,receipt_retention_seconds,inbound_at,echo_at,gap) ON whatsapp_intake TO app_runtime;
      GRANT UPDATE (activity,state,conversation_id,opportunity_id) ON whatsapp_receipt TO app_runtime;
      ALTER TABLE whatsapp_intake FORCE ROW LEVEL SECURITY;
      ALTER TABLE whatsapp_receipt FORCE ROW LEVEL SECURITY;
      CREATE OR REPLACE FUNCTION public.resolve_meta_intake(provider text, waba text, phone text)
      RETURNS TABLE(id uuid,business_id uuid,actor_id text)
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
        SELECT i.id,i.business_id,i.actor_id FROM public.whatsapp_intake i
        JOIN public.whatsapp_connection c ON c.id=i.id AND c.business_id=i.business_id
        JOIN public.membership m ON m.business_id=i.business_id AND m.user_id=i.actor_id
        WHERE c.provider_key=provider AND c.assets->>'wabaId'=waba AND c.phone_number_id=phone
          AND c.version=i.connection_version AND c.status='connected' AND c.credentials IS NOT NULL
          AND m.role IN ('owner','admin')
          AND c.observation->'checks'->>'customer_ownership'='confirmed'
          AND c.observation->'checks'->>'permissions'='confirmed'
          AND c.observation->'checks'->>'number_verified'='confirmed'
          AND c.observation->'checks'->>'number_registered'='confirmed'
      $$;
      CREATE OR REPLACE FUNCTION public.pending_meta_intakes(provider text)
      RETURNS TABLE(id uuid,business_id uuid,actor_id text)
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
        SELECT i.id,i.business_id,i.actor_id FROM public.whatsapp_intake i
        JOIN public.whatsapp_connection c ON c.id=i.id AND c.business_id=i.business_id
        JOIN public.membership m ON m.business_id=i.business_id AND m.user_id=i.actor_id
        WHERE c.provider_key=provider AND c.version=i.connection_version AND c.status='connected'
          AND c.credentials IS NOT NULL AND m.role IN ('owner','admin')
          AND c.observation->'checks'->>'customer_ownership'='confirmed'
          AND c.observation->'checks'->>'permissions'='confirmed'
          AND c.observation->'checks'->>'number_verified'='confirmed'
          AND c.observation->'checks'->>'number_registered'='confirmed'
          AND EXISTS (SELECT 1 FROM public.whatsapp_receipt r WHERE r.connection_id=i.id AND r.state IN ('pending','review') AND r.connection_version=i.connection_version)
        ORDER BY EXISTS (SELECT 1 FROM public.whatsapp_receipt r WHERE r.connection_id=i.id AND r.connection_version=i.connection_version AND r.state='pending') DESC,i.id LIMIT 100
      $$;
      CREATE OR REPLACE FUNCTION public.purge_meta_receipts(at_time timestamptz)
      RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
        UPDATE public.whatsapp_intake i SET gap='unprocessed_event_expired'
          WHERE EXISTS (SELECT 1 FROM public.whatsapp_receipt r WHERE r.connection_id=i.id
            AND r.connection_version=i.connection_version AND r.state IN ('pending','review') AND r.expires_at<=least(at_time,statement_timestamp()));
        UPDATE public.whatsapp_receipt SET activity=NULL,
          state=CASE WHEN state IN ('pending','review') THEN 'expired' ELSE state END
        WHERE expires_at<=least(at_time,statement_timestamp()) AND activity IS NOT NULL
      $$;
      REVOKE ALL ON FUNCTION public.purge_meta_receipts(timestamptz) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.purge_meta_receipts(timestamptz) TO app_runtime;
      REVOKE ALL ON FUNCTION public.resolve_meta_intake(text,text,text),public.pending_meta_intakes(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.resolve_meta_intake(text,text,text),public.pending_meta_intakes(text) TO app_runtime;
    `);
    await client.query("SET LOCAL ROLE app_runtime");
    await verifyRuntimeRole(client);
    await client.query("COMMIT");
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
