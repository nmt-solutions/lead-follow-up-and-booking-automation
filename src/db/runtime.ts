import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "../models/application-error";
import * as schema from "./schema";

export function runtimeDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}
export type Database = ReturnType<typeof runtimeDatabase>;

// Fail closed on an accidentally supplied Neon schema-owner connection.
export async function verifyRuntimeRole(
  pool: Pool | PoolClient,
): Promise<void> {
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
      AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='sender_health_record')
      AND (SELECT count(*)=2 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename='sender_health_record')
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sender_health_identity_scope' AND contype='f' AND convalidated)
      AND NOT has_column_privilege(current_user,'public.platform_operator','sender_health','UPDATE')
      AND has_function_privilege(current_user,'public.sender_health_native(uuid)','EXECUTE')
      AND has_function_privilege(current_user,'public.purge_sender_health_artifacts(uuid,timestamptz)','EXECUTE')
      AND has_sequence_privilege(current_user,'public.sender_health_record_position_seq','USAGE')
      AND (SELECT count(*)=2 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[] AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('sender_health_native','purge_sender_health_artifacts'))
      AND (SELECT count(*) = 1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='whatsapp_evidence')
      AND (SELECT count(*) = 2 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END) FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_evidence')
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='whatsapp_evidence_connection_scope' AND contype='f' AND convalidated)
      AND NOT has_column_privilege(current_user,'public.platform_operator','whatsapp_review','UPDATE')
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT,INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('whatsapp_connection','whatsapp_oauth','whatsapp_event'))
      AND (SELECT count(*) = 8 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('whatsapp_connection','whatsapp_oauth','whatsapp_event'))
      AND (SELECT count(*) = 2 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('whatsapp_oauth_connection_scope','whatsapp_event_connection_scope'))
      AND NOT has_column_privilege(current_user,'public.whatsapp_connection','business_id','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_oauth','state_hash','UPDATE')
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user,c.relowner,'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tax_rule_revision','tax_rule_decision','tax_calculation'))
      AND (SELECT count(*) = 6 AND bool_and('app_runtime'=ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname='public' AND tablename IN ('tax_rule_revision','tax_rule_decision','tax_calculation'))
      AND NOT has_table_privilege(current_user,'public.tax_rule_revision','UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user,'public.tax_rule_decision','UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user,'public.tax_calculation','UPDATE,DELETE,TRUNCATE')
      AND NOT has_any_column_privilege(current_user,'public.tax_rule_revision','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.tax_rule_decision','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.tax_calculation','UPDATE')
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tax_calculation_resolution_scope' AND contype='f' AND convalidated)
      AND (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
        AND has_table_privilege(current_user, c.oid, 'SELECT')
        AND has_table_privilege(current_user, c.oid, 'INSERT')
        AND NOT has_table_privilege(current_user, c.oid, 'UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user, c.oid, 'UPDATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('subscription_pricing_revision','subscription_quote'))
      AND (SELECT count(*) = 4 AND bool_and('app_runtime' = ANY(roles)
        AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
          WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname='public' AND tablename IN ('subscription_pricing_revision','subscription_quote'))
      AND (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('billing_profile_revision','billing_profile_review'))
      AND (SELECT count(*) = 4 AND bool_and('app_runtime' = ANY(roles)
        AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
          WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname='public' AND tablename IN ('billing_profile_revision','billing_profile_review'))
      AND NOT has_table_privilege(current_user, 'public.billing_profile_revision', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.billing_profile_review', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_any_column_privilege(current_user, 'public.billing_profile_revision', 'UPDATE')
      AND NOT has_any_column_privilege(current_user, 'public.billing_profile_review', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.business_file', 'purpose', 'UPDATE')
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('microsoft_mail_grant','microsoft_mail_oauth','mailbox_app_message'))
      AND (SELECT count(*) = 8 AND bool_and('app_runtime' = ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('microsoft_mail_grant','microsoft_mail_oauth','mailbox_app_message'))
      AND (SELECT count(*) = 4 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('microsoft_mail_grant_mailbox_scope','microsoft_mail_oauth_grant_scope','mailbox_app_message_mailbox_scope','mailbox_app_message_reply_scope'))
      AND NOT has_table_privilege(current_user, 'public.microsoft_mail_grant', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.microsoft_mail_oauth', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.mailbox_app_message', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.microsoft_mail_grant', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.microsoft_mail_oauth', 'verifier', 'UPDATE')
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mailbox_job_successor_scope' AND contype='f' AND convalidated)
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('gmail_grant','gmail_oauth','gmail_manual_message'))
      AND (SELECT count(*) = 9 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname='public' AND tablename IN ('gmail_grant','gmail_oauth','gmail_manual_message'))
      AND (SELECT count(*) = 5 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f'
        AND conname IN ('gmail_grant_mailbox_scope','gmail_oauth_grant_scope','gmail_manual_mailbox_scope','gmail_manual_conversation_scope','gmail_manual_opportunity_scope'))
      AND NOT has_table_privilege(current_user, 'public.gmail_grant', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.gmail_oauth', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.gmail_manual_message', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.gmail_grant', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.gmail_oauth', 'verifier', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.gmail_manual_message', 'content', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_message', 'content', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_message', 'mailbox_metadata', 'UPDATE')
      AND (SELECT count(*) = 4 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('sender_connection','sender_reply_route','sender_identity','sender_observation'))
      AND (SELECT count(*) = 11 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sender_connection','sender_reply_route','sender_identity','sender_observation'))
      AND (SELECT count(*) = 5 AND bool_and(convalidated) FROM pg_constraint WHERE contype = 'f'
        AND conname IN ('sender_route_connection_scope','sender_route_inbox_scope','sender_identity_connection_scope','sender_identity_route_scope','sender_observation_identity_scope'))
      AND NOT has_table_privilege(current_user, 'public.sender_identity', 'DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.sender_identity', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.sender_connection', 'created_by', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.sender_reply_route', 'business_id', 'UPDATE')
      AND NOT has_table_privilege(current_user, 'public.sender_observation', 'UPDATE,DELETE,TRUNCATE')
      AND (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('google_calendar_grant','google_calendar_oauth'))
      AND (SELECT count(*) = 6 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('google_calendar_grant','google_calendar_oauth'))
      AND NOT has_table_privilege(current_user, 'public.google_calendar_grant', 'DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.google_calendar_grant', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.google_calendar_oauth', 'verifier', 'UPDATE')
      AND current_setting('row_security') = 'on'
      AND (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
        AND has_table_privilege(current_user, c.oid, 'SELECT')
        AND has_table_privilege(current_user, c.oid, 'INSERT')
        AND NOT has_table_privilege(current_user, c.oid, 'UPDATE,DELETE,TRUNCATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('call_activity','call_revision'))
      AND (SELECT count(*) = 4 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('call_activity','call_revision'))
      AND (SELECT count(*) = 2 AND bool_and(convalidated) FROM pg_constraint
        WHERE conname IN ('call_activity_need_buyer_scope','call_revision_activity_scope') AND contype = 'f')
      AND (SELECT count(*) = 6 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('inbox_connection','inbox_buyer','inbox_conversation','inbox_opportunity','inbox_message','inbox_event'))
      AND (SELECT count(*) = 16 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
        ELSE false END) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('inbox_connection','inbox_buyer','inbox_conversation','inbox_opportunity','inbox_message','inbox_event'))
      AND (SELECT bool_and(NOT has_table_privilege(current_user, c.oid, 'UPDATE,DELETE,TRUNCATE'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('inbox_buyer','inbox_opportunity','inbox_message','inbox_event'))
      AND NOT has_table_privilege(current_user, 'public.inbox_connection', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.inbox_conversation', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_connection', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_connection', 'conversation_refs', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_conversation', 'buyer_id', 'UPDATE')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.inbox_opportunity'::regclass AND tgname='protect_opportunity_intake' AND tgenabled='O')
      AND (SELECT count(*)=4 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('email_sequence_policy','email_sequence_run','email_sequence_action','email_sequence_event'))
      AND (SELECT count(*)=12 AND bool_and((policyname='email_sequence_run_system' AND 'public'=ANY(roles) AND qual IS NOT NULL) OR (policyname='email_sequence_action_system' AND 'public'=ANY(roles) AND qual IS NOT NULL AND with_check IS NOT NULL) OR ('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('email_sequence_policy','email_sequence_run','email_sequence_action','email_sequence_event'))
      AND (SELECT count(*)=4 AND bool_and(convalidated) FROM pg_constraint WHERE conname IN ('email_sequence_action_run','email_sequence_action_opportunity','email_sequence_event_run','email_sequence_event_action') AND contype='f')
      AND NOT has_table_privilege(current_user,'public.email_sequence_event','UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user,'public.email_sequence_policy','UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user,'public.email_sequence_run','revision_id','UPDATE')
      AND NOT has_column_privilege(current_user,'public.email_sequence_action','contact_id','UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inbox_opportunity', 'title', 'UPDATE')
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('opportunity_control_history','opportunity_manual_event','opportunity_due_action'))
      AND (SELECT count(*) = 7 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
        ELSE false END) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('opportunity_control_history','opportunity_manual_event','opportunity_due_action'))
      AND NOT has_table_privilege(current_user, 'public.opportunity_control_history', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.opportunity_manual_event', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.opportunity_due_action', 'evaluation', 'UPDATE')
      AND has_column_privilege(current_user, 'public.opportunity_due_action', 'email', 'UPDATE')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.opportunity_due_action'::regclass
        AND tgname='protect_opportunity_mail' AND tgenabled <> 'D')
      AND NOT has_table_privilege(current_user, 'public.opportunity_due_action', 'UPDATE,DELETE,TRUNCATE')
      AND (SELECT count(*) = 1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'inquiry_run')
      AND (SELECT count(*) = 3 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
        ELSE false END) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inquiry_run')
      AND has_table_privilege(current_user, 'public.inquiry_run', 'SELECT,INSERT')
      AND NOT has_table_privilege(current_user, 'public.inquiry_run', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.inquiry_run', 'snapshot', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inquiry_run', 'actor_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.inquiry_run', 'business_id', 'UPDATE')
      AND (SELECT count(*) = 6 AND bool_and(convalidated) FROM pg_constraint
        WHERE conname IN ('inbox_buyer_connection_scope','inbox_conversation_buyer_scope','inbox_opportunity_conversation_scope','inbox_message_conversation_scope','inbox_event_connection_scope','inbox_event_conversation_scope') AND contype = 'f')
      AND (SELECT count(*) = 6 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('ai_profile','ai_activation','ai_activation_audit','ai_execution','ai_attempt','ai_review'))
      AND (SELECT count(*) = 15 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
        WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
        ELSE false END) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('ai_profile','ai_activation','ai_activation_audit','ai_execution','ai_attempt','ai_review'))
      AND NOT has_table_privilege(current_user, 'public.ai_profile', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.ai_activation', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.ai_activation_audit', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.ai_review', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.ai_execution', 'input', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.ai_execution', 'business_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.ai_attempt', 'route', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.platform_operator', 'ai', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.platform_operator', 'discovery', 'UPDATE')
      AND (SELECT count(*) = 2 AND bool_and(convalidated) FROM pg_constraint
        WHERE conname IN ('ai_attempt_execution_scope', 'ai_review_execution_scope')
        AND contype = 'f' AND confrelid = 'public.ai_execution'::regclass)
      AND (SELECT count(*) = 5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('discovery_configuration', 'discovery_run', 'discovery_prospect', 'discovery_result', 'discovery_usage'))
      AND (SELECT count(*) = 13 AND bool_and(
        (policyname IN ('discovery_run_system', 'discovery_usage_system') AND 'public' = ANY(roles) AND qual IS NOT NULL AND with_check IS NOT NULL)
        OR ('app_runtime' = ANY(roles) AND CASE
          WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
          WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL
          WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
          ELSE false END)) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('discovery_configuration', 'discovery_run', 'discovery_prospect', 'discovery_result', 'discovery_usage'))
      AND NOT has_table_privilege(current_user, 'public.discovery_configuration', 'INSERT,UPDATE,DELETE,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'public.discovery_run', 'policy', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.discovery_run', 'created_by', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.discovery_run', 'brief', 'UPDATE')
      AND (SELECT count(*) = 1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'discovery_command')
      AND (SELECT count(*) = 2 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'discovery_command')
      AND NOT has_table_privilege(current_user, 'public.discovery_command', 'UPDATE,DELETE,TRUNCATE')
      AND (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('discovery_prospect_alias', 'discovery_observation'))
      AND (SELECT count(*) = 4 AND bool_and('app_runtime' = ANY(roles) AND CASE
        WHEN policyname LIKE '%_read' THEN qual IS NOT NULL
        WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE false END)
        FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('discovery_prospect_alias', 'discovery_observation'))
      AND NOT has_table_privilege(current_user, 'public.discovery_prospect_alias', 'UPDATE,DELETE,TRUNCATE')
      AND NOT has_table_privilege(current_user, 'public.discovery_observation', 'UPDATE,DELETE,TRUNCATE')
      AND (SELECT count(*) = 1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'commercial_authority_revision')
      AND (SELECT count(*) = 2 AND bool_and('app_runtime' = ANY(roles) AND CASE policyname
        WHEN 'commercial_authority_read' THEN qual IS NOT NULL
        WHEN 'commercial_authority_insert' THEN with_check IS NOT NULL
        ELSE false END) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'commercial_authority_revision')
      AND NOT has_table_privilege(current_user, 'public.commercial_authority_revision', 'UPDATE,DELETE,TRUNCATE')
      AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER'))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('business_file','file_access','file_usage'))
      AND (SELECT count(*) = 8 AND bool_and(
        (policyname IN ('file_system','file_access_system','file_usage_system') AND 'public' = ANY(roles) AND qual IS NOT NULL AND with_check IS NOT NULL)
        OR ('app_runtime' = ANY(roles) AND CASE policyname
          WHEN 'file_read' THEN qual IS NOT NULL
          WHEN 'file_insert' THEN with_check IS NOT NULL
          WHEN 'file_update' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'file_access_scope' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'file_usage_scope' THEN qual IS NOT NULL AND with_check IS NOT NULL
          ELSE false END)) FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('business_file','file_access','file_usage'))
      AND (SELECT count(*) = 5 AND bool_and(
        c.relrowsecurity AND c.relforcerowsecurity
        AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
      ) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('business', 'membership', 'invitation', 'team_audit', 'platform_operator'))
      AND (SELECT count(*) = 13 AND bool_and(
        (policyname = 'membership_owner_read' AND 'public' = ANY(roles) AND qual IS NOT NULL)
        OR ('app_runtime' = ANY(roles) AND CASE policyname
          WHEN 'business_access' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'membership_read' THEN qual IS NOT NULL
          WHEN 'membership_create' THEN with_check IS NOT NULL
          WHEN 'membership_change' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'membership_remove' THEN qual IS NOT NULL
          WHEN 'invitation_read' THEN qual IS NOT NULL
          WHEN 'invitation_create' THEN with_check IS NOT NULL
          WHEN 'invitation_change' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'invitation_expire' THEN qual IS NOT NULL AND with_check IS NOT NULL
          WHEN 'team_audit_read' THEN qual IS NOT NULL
          WHEN 'team_audit_create' THEN with_check IS NOT NULL
          WHEN 'operator_read' THEN qual IS NOT NULL
          ELSE false END)
      ) FROM pg_policies WHERE schemaname = 'public' AND
        ((tablename = 'business' AND policyname = 'business_access') OR
         (tablename = 'membership' AND policyname IN ('membership_read', 'membership_owner_read', 'membership_create', 'membership_change', 'membership_remove')) OR
         (tablename = 'invitation' AND policyname IN ('invitation_read', 'invitation_create', 'invitation_change', 'invitation_expire')) OR
         (tablename = 'team_audit' AND policyname IN ('team_audit_read', 'team_audit_create')) OR
         (tablename = 'platform_operator' AND policyname = 'operator_read'))) AS safe
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (result.rows[0]?.safe !== true)
    throw new ApplicationError("SETUP_REQUIRED");
}
