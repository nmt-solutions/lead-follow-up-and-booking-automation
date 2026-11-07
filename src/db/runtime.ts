import { verifyDiscoveryCapacity } from "./discovery-capacity-security";
import { verifyRecoverySecurity } from "./recovery-security";
import { drizzle } from "drizzle-orm/node-postgres";
import { verifyTaxPeriods } from "./tax-period-security";
import { verifyTaxFilings } from "./tax-filing-security";
import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "../models/application-error";
import * as schema from "./schema";
import {
  notificationFunctions,
  notificationTables,
} from "./notification-security";
import { operationSourceTables } from "./operations-security";
import { reachFunctions } from "./reach-change-security";
import { verifyDataGovernance } from "./data-governance-security";
import { verifyReconciliationRuntime } from "./reconciliation-security";

export function runtimeDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}
export type Database = ReturnType<typeof runtimeDatabase>;

// Fail closed on an accidentally supplied Neon schema-owner connection.
export async function verifyRuntimeRole(
  pool: Pool | PoolClient,
  options: { allowQuarantined?: boolean } = {},
): Promise<void> {
  if (!options.allowQuarantined) {
    const quarantine = await pool.query<{ blocked: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='recovery_quarantine') AS blocked",
    );
    if (quarantine.rows[0]?.blocked)
      throw new ApplicationError("SETUP_REQUIRED");
  }
  if (!(await verifyRecoverySecurity(pool)))
    throw new ApplicationError("SETUP_REQUIRED");
  await verifyDiscoveryCapacity(pool);
  await verifyReconciliationRuntime(pool);
  await verifyDataGovernance(pool);
  await verifyTaxPeriods(pool);
  await verifyTaxFilings(pool);
  const result = await pool.query<{ safe: boolean }>(`
    SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('reach_change','reach_change_event'))
      AND (SELECT count(*)=4 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('reach_change','reach_change_event'))
      AND has_sequence_privilege(current_user,'public.reach_change_event_position_seq','USAGE')
      AND (SELECT count(*)=4 AND bool_and(i.indisunique AND i.indisvalid) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('reach_change_scope','reach_change_request','reach_change_event_identity','reach_change_request_identity'))
      AND (SELECT count(*)=4 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('reach_change_period_scope','reach_change_action_scope','reach_change_quote_scope','reach_change_event_scope'))
      AND (SELECT count(*)=${reachFunctions.length} AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${reachFunctions.map((n) => `'${n}'`).join(",")}))
      AND (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('financial_case','financial_case_event','financial_receipt'))
      AND (SELECT count(*)=3 AND bool_and(convalidated) FROM pg_constraint WHERE conname IN ('financial_case_period_scope','financial_case_invoice_scope','financial_case_event_scope'))
      AND (SELECT count(*)=9 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('financial_credit_allowed','financial_capture_receipt','financial_receipt_work','financial_adjustments_feed','financial_refunded','financial_worker_authorized','financial_pending','financial_reserved','financial_public'))
      AND NOT has_column_privilege(current_user,'public.platform_operator','refunds','UPDATE')
      AND has_sequence_privilege(current_user,'public.financial_case_position_seq','USAGE') AND has_sequence_privilege(current_user,'public.financial_case_event_position_seq','USAGE')
      AND (SELECT count(*)=8 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('financial_case','financial_case_event','financial_receipt'))
      AND (SELECT count(*)=${notificationTables.length} AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${notificationTables.map((n) => `'${n}'`).join(",")}))
      AND NOT has_column_privilege(current_user,'public.platform_operator','notifications','UPDATE')
      AND (SELECT count(*)=${notificationTables.length * 2} AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual='false' ELSE with_check='false' END) FROM pg_policies WHERE schemaname='public' AND tablename IN (${notificationTables.map((n) => `'${n}'`).join(",")}))
      AND (SELECT count(*)=${notificationFunctions.length} AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${notificationFunctions.map((n) => `'${n}'`).join(",")}))
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('operation_event','operation_retention'))
      AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND NOT has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='operation_detail')
      AND NOT has_column_privilege(current_user,'public.platform_operator','operations','UPDATE')
      AND has_sequence_privilege(current_user,'public.operation_event_position_seq','USAGE')
      AND (SELECT count(*)=5 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('operations_operator_authorized','operation_mailbox_work','record_operation_detail','prune_operation_details','maintain_operation_retention'))
      AND NOT has_function_privilege(current_user,'public.capture_operation()','EXECUTE')
      AND NOT has_function_privilege(current_user,'public.operation_snapshot(text,jsonb)','EXECUTE')
      AND (SELECT count(*)=${operationSourceTables.length} AND bool_and(t.tgenabled='O' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND t.tgname='capture_operation' AND p.proname='capture_operation' AND c.relname IN (${operationSourceTables.map((table) => `'${table}'`).join(",")}))
      AND (SELECT count(*)=8 AND bool_and(CASE WHEN policyname LIKE '%_read' OR policyname='operation_retention_system' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('operation_event','operation_retention','operation_detail'))
      AND (SELECT count(*)=6 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('operator_cost_record','operator_cost_planning','operator_cost_scan','operator_cost_budget','operator_cost_alert','operator_cost_notification_event'))
      AND (SELECT count(*)=12 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('operator_cost_record','operator_cost_planning','operator_cost_scan','operator_cost_budget','operator_cost_alert','operator_cost_notification_event'))
      AND NOT has_column_privilege(current_user,'public.platform_operator','costs','UPDATE')
      AND (SELECT count(*)=8 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('operator_cost_native','cost_worker_authorized','cost_owner_email','cost_attribution_valid','operator_cost_work','cost_claim_alert','cost_alert_deliverable','cost_finish_alert'))
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('seller_issuer_revision','seller_issuer_decision'))
      AND (SELECT count(*)=4 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('seller_issuer_revision','seller_issuer_decision'))
      AND NOT has_column_privilege(current_user,'public.platform_operator','documents','UPDATE')
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('seller_document','seller_document_request'))
      AND NOT has_any_column_privilege(current_user,'public.seller_document_request','UPDATE')
      AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['id','business_id','period_id','original_id','adjustment_id','adjustment_source','recovery_key','retry_after','kind','series_key','ordinal','number','snapshot','actor_id','at','retain_until','account_scope','sha256','bytes']) c WHERE has_column_privilege(current_user,'public.seller_document',c,'UPDATE'))
      AND has_column_privilege(current_user,'public.seller_document','artifact_state','UPDATE') AND has_column_privilege(current_user,'public.seller_document','failure','UPDATE')
      AND (SELECT count(*)=6 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('seller_document','seller_document_request'))
      AND (SELECT count(*)=5 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('seller_document_period_scope','seller_document_original_scope','seller_document_request_scope','seller_document_access_scope','seller_document_storage_scope'))
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('seller_document_access','seller_document_storage'))
      AND NOT has_any_column_privilege(current_user,'public.seller_document_access','UPDATE')
      AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['id','business_id','document_id','actor_id','at','action']) c WHERE has_column_privilege(current_user,'public.seller_document_storage',c,'UPDATE'))
      AND has_column_privilege(current_user,'public.seller_document_storage','outcome','UPDATE')
      AND (SELECT count(*)=5 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('seller_document_access','seller_document_storage'))
      AND (SELECT count(*)=3 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('seller_next_number','seller_artifact_worker_authorized','claim_seller_artifacts'))
      AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='whatsapp_outbound')
      AND (SELECT count(*)=2 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename='whatsapp_outbound')
      AND has_sequence_privilege(current_user,'public.whatsapp_outbound_position_seq','USAGE')
      AND (SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pending_meta_outbound')
      AND (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('whatsapp_outbound_connection_scope','whatsapp_action_plan_scope'))
      AND (SELECT count(*)=5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('subscription_payment','subscription_payment_event','subscription_payment_history','subscription_period','subscription_usage'))
      AND (SELECT count(*)=15 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL WHEN policyname LIKE '%_system' OR policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('subscription_payment','subscription_payment_event','subscription_payment_history','subscription_period','subscription_usage'))
      AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='subscription_lifecycle_event')
      AND (SELECT count(*)=3 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename='subscription_lifecycle_event')
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='subscription_lifecycle_event_scope' AND contype='f' AND convalidated)
      AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='subscription_lifecycle_event_identity' AND i.indisunique AND i.indisvalid)
      AND has_column_privilege(current_user,'public.subscription_payment','lifecycle','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.subscription_period','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.subscription_payment_event','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.subscription_payment_history','UPDATE')
      AND NOT has_any_column_privilege(current_user,'public.subscription_usage','UPDATE')
      AND has_column_privilege(current_user,'public.subscription_payment','recovery','UPDATE')
      AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['id','business_id','request_key','operation_key','recovery_key','quote_id','snapshot','actor_id','at']) c WHERE has_column_privilege(current_user,'public.subscription_payment',c,'UPDATE'))
      AND (SELECT count(*)=4 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('subscription_payment_event_scope','subscription_payment_history_scope','subscription_period_action_scope','subscription_usage_period_scope'))
      AND (SELECT count(*)=9 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('payment_worker_authorized','pending_subscription_payments','subscription_payment_target','subscription_payment_allocated','current_paid_scope','payment_event_identity','capture_unmatched_payment_event','subscription_payment_reference_target','payment_renewal_context'))
      AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='sender_health_record')
      AND (SELECT count(*)=2 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL ELSE with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename='sender_health_record')
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sender_health_identity_scope' AND contype='f' AND convalidated)
      AND NOT has_column_privilege(current_user,'public.platform_operator','sender_health','UPDATE')
      AND has_function_privilege(current_user,'public.sender_health_native(uuid)','EXECUTE')
      AND has_function_privilege(current_user,'public.purge_sender_health_artifacts(uuid,timestamptz)','EXECUTE')
      AND has_sequence_privilege(current_user,'public.sender_health_record_position_seq','USAGE')
      AND (SELECT count(*)=2 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[] AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('sender_health_native','purge_sender_health_artifacts'))
      AND (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('whatsapp_intake','whatsapp_receipt'))
      AND (SELECT count(*)=6 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL WHEN policyname LIKE '%_update' THEN qual IS NOT NULL AND with_check IS NOT NULL ELSE false END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('whatsapp_intake','whatsapp_receipt'))
      AND NOT has_column_privilege(current_user,'public.whatsapp_intake','business_id','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_receipt','fingerprint','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_receipt','account_key','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_receipt','peer','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_receipt','reply_to','UPDATE')
      AND NOT has_column_privilege(current_user,'public.whatsapp_receipt','status_evidence','UPDATE')
      AND (SELECT count(*)=5 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conname IN ('whatsapp_intake_connection_scope','whatsapp_intake_inbox_scope','whatsapp_receipt_connection_scope','whatsapp_receipt_conversation_scope','whatsapp_receipt_opportunity_scope'))
      AND (SELECT count(*)=3 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('resolve_meta_intake','pending_meta_intakes','purge_meta_receipts'))
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
      AND has_column_privilege(current_user,'public.email_sequence_action','processing_acceptance','UPDATE')
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
      AND NOT has_column_privilege(current_user, 'public.opportunity_due_action', 'whatsapp_plan_id', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.opportunity_due_action', 'whatsapp_step', 'UPDATE')
      AND NOT has_column_privilege(current_user, 'public.opportunity_due_action', 'whatsapp_peer', 'UPDATE')
      AND has_column_privilege(current_user, 'public.opportunity_due_action', 'meta_recovery_at', 'UPDATE')
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
      AND has_column_privilege(current_user,'public.discovery_usage','provider_cost','UPDATE')
      AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.discovery_usage'::regclass AND tgname='protect_discovery_provider_cost' AND tgenabled='O')
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
