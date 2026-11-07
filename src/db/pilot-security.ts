import { nativeCostSourcesSql } from "./cost-security";
import { pilotCostReadTables } from "./pilot-owner-policies";
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pilotRecord, pilotEvent, pilotEffect } from "./schema";
export const pilotTables = ["pilot_record", "pilot_event", "pilot_effect"];
// The pinned push can replace the referenced composite primary key. Use the
// schema-owned definitions in the shared pause/validated-restore sequence.
export const pilotScopeForeignKeys = [pilotEvent, pilotEffect].flatMap(
  (table) =>
    getTableConfig(table).foreignKeys.filter((key) =>
      ["pilot_event_scope", "pilot_effect_scope"].includes(key.getName()),
    ),
);
export const pilotFunctions = [
  "pilot_authorized",
  "pilot_operator",
  "reserve_pilot_effect",
  "pilot_effect_current",
  "pilot_global_room",
  "pilot_budget_ready",
  "pilot_path_allowed",
  "protect_pilot_write",
];
export async function preparePilotSecurity(pool: Pool | PoolClient) {
  await pool.query(`DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['pilot_record','pilot_event','pilot_effect'] LOOP IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON public.%I FROM app_runtime,PUBLIC',t); END IF; END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['pilot_authorized','pilot_operator','reserve_pilot_effect','pilot_effect_current','pilot_global_room','pilot_budget_ready','pilot_path_allowed','protect_pilot_write']) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime,PUBLIC',f.signature); END LOOP;
 END $$;
 CREATE OR REPLACE FUNCTION public.pilot_authorized() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 RETURN EXISTS(SELECT 1 FROM public.membership m JOIN public.session s ON s.user_id=m.user_id JOIN public."user" u ON u.id=m.user_id JOIN public.two_factor f ON f.user_id=u.id
 WHERE m.business_id::text=current_setting('app.business_id',true) AND m.user_id=current_setting('app.actor_id',true) AND m.role IN ('owner','admin')
 AND s.id=current_setting('app.pilot_session',true) AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '12 hours'); END $$;
 CREATE OR REPLACE FUNCTION public.pilot_operator() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 RETURN public.pilot_authorized() AND EXISTS(SELECT 1 FROM public.platform_operator o JOIN public.session s ON s.user_id=o.user_id WHERE o.user_id=current_setting('app.actor_id',true) AND o.pilots AND s.id=current_setting('app.pilot_session',true) AND s.mfa_verified_at>clock_timestamp()-interval '15 minutes'); END $$;
 REVOKE ALL ON FUNCTION public.pilot_authorized(),public.pilot_operator() FROM PUBLIC;
 `);
}
export async function securePilots(pool: PoolClient) {
  const db = drizzle(pool);
  // #56 adds its own maintenance role to operational policies. Keep these
  // separate aggregate-read exceptions exact after that composition.
  for (const name of pilotCostReadTables)
    await pool.query(
      `ALTER POLICY ${name}_pilot_cost_owner_read ON public.${name} TO PUBLIC USING(current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.${name}'::regclass))`,
    );
  for (const table of [pilotRecord, pilotEvent, pilotEffect]) {
    const config = getTableConfig(table),
      name = config.name;
    await db.execute(sql`alter table ${table} force row level security`);
    for (const policy of config.policies) {
      await db.execute(
        sql`drop policy if exists ${sql.identifier(policy.name!)} on ${table}`,
      );
      await db.execute(
        sql`create policy ${sql.identifier(policy.name!)} on ${table} for ${sql.raw(policy.for!)} to app_runtime ${policy.using ? sql`using (${policy.using})` : sql``} ${policy.withCheck ? sql`with check (${policy.withCheck})` : sql``}`,
      );
    }
    await pool.query(
      `DROP POLICY IF EXISTS ${name}_owner ON public.${name}; CREATE POLICY ${name}_owner ON public.${name} FOR ALL TO PUBLIC USING(current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.${name}'::regclass)) WITH CHECK(current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.${name}'::regclass)); REVOKE ALL ON public.${name} FROM app_runtime,PUBLIC; GRANT SELECT,INSERT ON public.${name} TO app_runtime;`,
    );
  }
  await pool.query(`
 CREATE OR REPLACE FUNCTION public.protect_pilot_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE plan jsonb; p record; source record; caller name; needs_operator boolean:=true; renewal_id uuid; renewal_payment text; renewal_at timestamptz; renewal_amount text;
 BEGIN
 -- Schema-owner recovery/import is a separate administrative boundary. SET ROLE
 -- app_runtime must still use the restricted path, even on an owner connection.
 caller=coalesce(nullif(current_setting('role',true),'none'),session_user);
 IF pg_has_role(caller,(SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID),'MEMBER') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='subscription_payment_history' THEN
   SELECT a.* INTO source FROM public.subscription_payment a WHERE a.id=NEW.action_id AND a.business_id=NEW.business_id;
   IF source.snapshot->'pilotContinuation' IS NULL OR NEW.kind<>'creation_not_attempted' THEN RETURN NEW; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,0));
   IF NOT coalesce(public.payment_worker_authorized(NEW.action_id,NEW.business_id),false)
     OR source.checkout IS NOT NULL OR source.observation IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.subscription_payment_history h WHERE h.action_id=NEW.action_id AND h.business_id=NEW.business_id AND (h.kind IN ('creation_authorized','checkout_creation') OR h.detail->'observation'<>'null'::jsonb))
     OR EXISTS(SELECT 1 FROM public.subscription_payment_event e WHERE e.action_id=NEW.action_id AND e.business_id=NEW.business_id)
     THEN RAISE insufficient_privilege; END IF;
   RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,0));
 IF NEW.business_id::text IS DISTINCT FROM current_setting('app.business_id',true) OR NEW.actor_id IS DISTINCT FROM current_setting('app.actor_id',true) OR NOT coalesce(public.pilot_authorized(),false) THEN RAISE insufficient_privilege; END IF;
 IF TG_TABLE_NAME='pilot_record' THEN
   IF NOT coalesce(public.pilot_operator(),false) THEN RAISE insufficient_privilege; END IF;
   plan=NEW.snapshot->'plan';
   SELECT a.* INTO source FROM public.subscription_payment a WHERE a.business_id=NEW.business_id AND a.id::text=plan->>'paymentActionId';
   IF source.id IS NULL OR NOT coalesce(
     jsonb_typeof(NEW.snapshot)='object' AND jsonb_typeof(plan)='object'
     AND NEW.snapshot->'payment'->'quote'=source.snapshot->'quote'
     AND NEW.snapshot->'payment'->'term'=source.snapshot->'term'
     AND (NEW.snapshot->'payment'->'basis') IS NOT DISTINCT FROM (source.snapshot->'basis')
     AND (NEW.snapshot->'payment'->'pilotContinuation') IS NOT DISTINCT FROM (source.snapshot->'pilotContinuation')
     AND NEW.snapshot->'payment'->'tax'->'lines'=source.snapshot->'tax'->'lines'
     AND NEW.snapshot->'payment'->'tax'->'totals'=source.snapshot->'tax'->'totals'
     AND NEW.snapshot->'payment'->'provider'->>'key'=source.snapshot->'provider'->>'key'
     AND NEW.snapshot->'payment'->'provider'->>'account'=source.snapshot->'provider'->>'account'
     AND NEW.snapshot->'payment'->'provider'->>'mode'=source.snapshot->'provider'->>'mode'
     AND (source.snapshot->'term'->>'kind'='days' OR jsonb_typeof(source.snapshot->'pilotContinuation')='object')
     AND source.snapshot->'quote'->'initial'->>'kind'='paid_pilot'
     AND plan->>'currency'=source.snapshot->'quote'->>'currency'
     AND plan->>'cashLimitMinor' ~ '^[0-9]{1,15}$' AND plan->>'spendLimitMinor' ~ '^[0-9]{1,15}$'
     AND plan->>'timeLimitSeconds' ~ '^[0-9]{1,8}$' AND (plan->>'timeLimitSeconds')::bigint BETWEEN 1 AND 31536000
     AND (plan->>'startsAt')::timestamptz<(plan->>'endsAt')::timestamptz
     AND jsonb_typeof(plan->'baseline')='array' AND jsonb_array_length(plan->'baseline')>0
     AND jsonb_typeof(plan->'criteria')='array' AND jsonb_array_length(plan->'criteria')>0
     AND jsonb_typeof(plan->'capabilities')='array' AND jsonb_array_length(plan->'capabilities')>0
     AND EXISTS(SELECT 1 FROM public.business b WHERE b.id=NEW.business_id AND NEW.snapshot->'business'->>'name'=b.name AND NEW.snapshot->'business'->>'offering'=b.offering),false)
     THEN RAISE insufficient_privilege; END IF;
   IF NOT coalesce(jsonb_typeof(plan->'goal')='string' AND length(plan->>'goal') BETWEEN 1 AND 2000 AND plan->>'goal' ~ '[^[:space:]]'
     AND jsonb_typeof(plan->'scope')='string' AND length(plan->>'scope') BETWEEN 1 AND 2000 AND plan->>'scope' ~ '[^[:space:]]'
     AND jsonb_typeof(plan->'approvalEvidence')='string' AND length(plan->>'approvalEvidence') BETWEEN 1 AND 2000 AND plan->>'approvalEvidence' ~ '[^[:space:]]'
     AND jsonb_array_length(plan->'baseline') BETWEEN 1 AND 30 AND jsonb_array_length(plan->'criteria') BETWEEN 1 AND 30
     AND jsonb_typeof(plan->'ceilings')='object' AND jsonb_array_length(plan->'capabilities') BETWEEN 1 AND 6,false)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'baseline') b WHERE NOT coalesce(jsonb_typeof(b)='object' AND jsonb_typeof(b->'value')='number'
       AND abs((b->>'value')::numeric)<=1.7976931348623157e308 AND jsonb_typeof(b->'metric')='string' AND length(b->>'metric') BETWEEN 1 AND 2000 AND b->>'metric' ~ '[^[:space:]]'
       AND jsonb_typeof(b->'unit')='string' AND length(b->>'unit') BETWEEN 1 AND 2000 AND b->>'unit' ~ '[^[:space:]]'
       AND jsonb_typeof(b->'evidence')='string' AND length(b->>'evidence') BETWEEN 1 AND 2000 AND b->>'evidence' ~ '[^[:space:]]',false))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'criteria') c WHERE NOT coalesce(jsonb_typeof(c)='object' AND jsonb_typeof(c->'target')='number'
       AND abs((c->>'target')::numeric)<=1.7976931348623157e308 AND c->>'comparison' IN ('at_least','at_most')
       AND jsonb_typeof(c->'metric')='string' AND length(c->>'metric') BETWEEN 1 AND 2000 AND c->>'metric' ~ '[^[:space:]]'
       AND jsonb_typeof(c->'unit')='string' AND length(c->>'unit') BETWEEN 1 AND 2000 AND c->>'unit' ~ '[^[:space:]]',false))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan->'capabilities') capability WHERE capability NOT IN ('discovery','inquiry_email','outreach_email','mailbox','whatsapp','calendar'))
     OR (SELECT count(DISTINCT capability) FROM jsonb_array_elements_text(plan->'capabilities') capability)<>jsonb_array_length(plan->'capabilities') THEN RAISE insufficient_privilege; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each(plan->'ceilings') c WHERE c.value<>'null'::jsonb AND NOT coalesce(jsonb_typeof(c.value)='object' AND c.value->>'cashMinor' ~ '^[0-9]{1,15}$' AND c.value->>'spendMinor' ~ '^[0-9]{1,15}$' AND c.value->>'seconds' ~ '^[0-9]{1,8}$' AND (c.value->>'seconds')::bigint>0 AND (c.value->>'globalSpendInrMicros' IS NULL OR c.value->>'globalSpendInrMicros' ~ '^[0-9]{1,15}$') AND length(c.value->>'evidence') BETWEEN 1 AND 2000 AND c.value->>'evidence' ~ '[^[:space:]]',false)) THEN RAISE insufficient_privilege; END IF;
 ELSE
   needs_operator=NEW.kind NOT IN ('approved','stopped');
   SELECT r.* INTO p FROM public.pilot_record r WHERE r.id=NEW.pilot_id AND r.business_id=NEW.business_id;
   IF p.id IS NULL OR (NEW.kind NOT IN ('approved','stopped') AND NOT coalesce(public.pilot_operator(),false)) THEN RAISE insufficient_privilege; END IF;
   plan=p.snapshot->'plan';
   IF NEW.kind='effort' AND NOT coalesce(jsonb_typeof(NEW.data)='object'
     AND NEW.data->>'kind' IN ('setup','support','sales','billing_tax','maintenance')
     AND NEW.data->>'cashMinor' ~ '^[0-9]{1,15}$' AND NEW.data->>'spendMinor' ~ '^[0-9]{1,15}$'
     AND NEW.data->>'seconds' ~ '^[0-9]{1,8}$' AND (NEW.data->>'seconds')::bigint BETWEEN 1 AND 31536000
     AND length(NEW.data->>'evidence') BETWEEN 1 AND 2000
     AND NEW.data->>'measurement'='attributed_actual_input'
     AND (NEW.data->>'occurredAt')::timestamptz<=clock_timestamp(),false) THEN RAISE insufficient_privilege; END IF;
   IF NEW.kind='approved' AND (NEW.data IS DISTINCT FROM '{"approvedExactFrozenPlan":true}'::jsonb OR EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped')) THEN RAISE insufficient_privilege; END IF;
   IF NEW.kind='activated' THEN
     IF NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='approved')
       OR EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped')
       OR public.business_data_stopped(NEW.business_id)
       OR NOT coalesce((plan->>'startsAt')::timestamptz<=clock_timestamp() AND (plan->>'endsAt')::timestamptz>clock_timestamp(),false)
       OR NOT EXISTS(SELECT 1 FROM public.subscription_period r WHERE r.business_id=NEW.business_id AND r.action_id::text=plan->>'paymentActionId' AND r.start<=(plan->>'startsAt')::timestamptz AND r.end>=(plan->>'endsAt')::timestamptz AND r.charge->>'status'='confirmed' AND r.id IN (SELECT paid.id FROM public.current_paid_scope(NEW.business_id,clock_timestamp()) paid))
       OR EXISTS(SELECT 1 FROM public.pilot_record r JOIN public.pilot_event e ON e.pilot_id=r.id AND e.business_id=r.business_id AND e.kind='activated' WHERE r.business_id=NEW.business_id AND r.id<>p.id AND NOT EXISTS(SELECT 1 FROM public.pilot_event stopped WHERE stopped.pilot_id=r.id AND stopped.business_id=r.business_id AND stopped.kind='stopped'))
       OR NOT coalesce(jsonb_typeof(NEW.data->'gates')='array' AND jsonb_array_length(NEW.data->'gates')>0,false)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.data->'gates') g WHERE g->'ready' IS DISTINCT FROM 'true'::jsonb) THEN RAISE insufficient_privilege; END IF;
   END IF;
   IF NEW.kind='results' AND (
     NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='activated')
     OR NOT coalesce(NEW.data->'report'->>'businessId'=NEW.business_id::text
       AND (NEW.data->'report'->>'from')::timestamptz>=(plan->>'startsAt')::timestamptz
       AND (NEW.data->'report'->>'to')::timestamptz<=(plan->>'endsAt')::timestamptz
       AND (NEW.data->'report'->>'to')::timestamptz<=clock_timestamp()
       AND (NEW.data->'report'->>'from')::timestamptz<(NEW.data->'report'->>'to')::timestamptz
       AND jsonb_typeof(NEW.data->'report'->'metrics')='array'
       AND jsonb_typeof(NEW.data->'criteria')='array'
       AND jsonb_typeof(NEW.data->'contribution'->'evidence')='array'
       AND jsonb_array_length(NEW.data->'contribution'->'evidence')>0
       AND NEW.data->'contribution'->>'revenueExcludingTaxMinor' ~ '^[0-9]{1,15}$'
       AND NEW.data->'contribution'->>'providerExpenseMinor' ~ '^[0-9]{1,15}$'
       AND NEW.data->'contribution'->>'effortExpenseMinor' ~ '^[0-9]{1,15}$'
       AND length(NEW.data->>'assessment') BETWEEN 1 AND 2000,false)) THEN RAISE insufficient_privilege; END IF;
   IF NEW.kind IN ('renewal','reuse') THEN
     IF NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='results') THEN RAISE insufficient_privilege; END IF;
     SELECT r.id,r.payment_id,(r.charge->>'paidAt')::timestamptz,r.charge->>'amountMinor' INTO renewal_id,renewal_payment,renewal_at,renewal_amount
     FROM public.subscription_period r JOIN public.subscription_payment a ON a.id=r.action_id AND a.business_id=r.business_id
     JOIN public.subscription_period initial ON initial.id::text=r.snapshot->'pilotContinuation'->>'originalPeriodId' AND initial.business_id=r.business_id
     WHERE r.business_id=NEW.business_id AND initial.action_id::text=coalesce(p.snapshot->'payment'->'pilotContinuation'->>'originalActionId',plan->>'paymentActionId')
       AND r.snapshot->'pilotContinuation'->>'originalActionId'=initial.action_id::text
       AND initial.snapshot->'term'->>'kind'='days' AND r.snapshot->'term'->>'kind'='calendar_month' AND r.snapshot->'basis'->>'kind'='renewal'
       AND r.start>=initial.end AND r.snapshot->'quote'->'renewal'=p.snapshot->'payment'->'quote'->'renewal'
       AND initial.charge->>'status'='confirmed' AND r.charge->>'status'='confirmed' AND (a.lifecycle->'cancellation' IS NULL OR a.lifecycle->'cancellation'='null'::jsonb)
       AND NOT coalesce(a.observation->>'paymentId'=r.payment_id AND a.observation->>'status'<>'confirmed',false)
       AND NOT EXISTS(SELECT 1 FROM public.subscription_payment_history h JOIN public.subscription_period paid ON paid.id IN (initial.id,r.id) AND paid.business_id=h.business_id AND paid.action_id=h.action_id
         WHERE h.detail->'observation'->>'status'='confirmed' AND h.detail->'observation'->>'provider'=paid.provider AND h.detail->'observation'->>'account'=paid.account
         AND h.detail->'observation'->>'paymentId'=paid.payment_id AND h.detail->'observation'->>'customerId'=paid.charge->>'customerId'
         AND h.detail->'observation'->>'amountMinor'=paid.charge->>'amountMinor' AND h.detail->'observation'->>'currency'=paid.charge->>'currency'
         AND coalesce((h.detail->'observation'->'charge'->>'refundedMinor')::numeric,0)>0)
       AND NOT EXISTS(SELECT 1 FROM public.financial_case c JOIN LATERAL(SELECT e.detail FROM public.financial_case_event e WHERE e.case_id=c.id AND e.business_id=c.business_id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1) e ON true WHERE c.business_id=r.business_id AND c.period_id IN(initial.id,r.id) AND e.detail->>'access'='block_period')
     ORDER BY r.start,r.id LIMIT 1;
     IF renewal_id IS NULL THEN RAISE insufficient_privilege; END IF;
     IF NEW.kind='renewal' AND NOT coalesce(NEW.data->>'periodId'=renewal_id::text AND NEW.data->>'paymentId'=renewal_payment AND NEW.data->>'amountMinor'=renewal_amount AND (NEW.data->>'paidAt')::timestamptz=renewal_at,false) THEN RAISE insufficient_privilege; END IF;
     IF NEW.kind='reuse' AND (
       NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='renewal')
       OR NOT EXISTS(SELECT 1 FROM public.pilot_record second JOIN public.membership m ON m.business_id=second.business_id AND m.user_id=current_setting('app.actor_id',true) AND m.role IN ('owner','admin')
         WHERE second.id::text=NEW.data->>'secondPilotId' AND second.business_id::text=NEW.data->>'secondBusinessId' AND second.business_id<>NEW.business_id
         AND second.at>=renewal_at AND (second.snapshot->'business'->>'offering' IS DISTINCT FROM p.snapshot->'business'->>'offering' OR second.snapshot->'plan'->>'goal' IS DISTINCT FROM plan->>'goal')
         AND EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=second.id AND e.business_id=second.business_id AND e.kind='activated'))
       OR NOT coalesce(length(NEW.data->>'differentNeed') BETWEEN 1 AND 2000 AND length(NEW.data->>'adaptations') BETWEEN 1 AND 2000 AND jsonb_typeof(NEW.data->'configuration')='array' AND jsonb_array_length(NEW.data->'configuration')>0,false)) THEN RAISE insufficient_privilege; END IF;
   END IF;
   NEW.position=nextval('public.pilot_event_position_seq');
 END IF;
 NEW.at=clock_timestamp();
 IF NOT coalesce(public.pilot_authorized(),false) OR needs_operator AND NOT coalesce(public.pilot_operator(),false) THEN RAISE insufficient_privilege; END IF;
 RETURN NEW;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE insufficient_privilege;
 END $$;
 REVOKE ALL ON FUNCTION public.protect_pilot_write() FROM PUBLIC,app_runtime;
 DROP TRIGGER IF EXISTS pilot_record_guard ON public.pilot_record;
 CREATE TRIGGER pilot_record_guard BEFORE INSERT ON public.pilot_record FOR EACH ROW EXECUTE FUNCTION public.protect_pilot_write();
 DROP TRIGGER IF EXISTS pilot_event_guard ON public.pilot_event;
 CREATE TRIGGER pilot_event_guard BEFORE INSERT ON public.pilot_event FOR EACH ROW EXECUTE FUNCTION public.protect_pilot_write();
 DROP TRIGGER IF EXISTS pilot_creation_history_guard ON public.subscription_payment_history;
 CREATE TRIGGER pilot_creation_history_guard BEFORE INSERT ON public.subscription_payment_history FOR EACH ROW EXECUTE FUNCTION public.protect_pilot_write();
 DROP FUNCTION IF EXISTS public.pilot_global_room(text,numeric);
 CREATE OR REPLACE FUNCTION public.pilot_global_room(currency text,requested numeric,candidate jsonb default null) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE cap numeric; spent numeric; held numeric; unknowns boolean; native_unknown boolean; cost_month text:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM'); BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('operator-costs',0));
 SELECT (b.configuration->>'limitInrMicros')::numeric INTO cap FROM public.operator_cost_budget b WHERE b.month=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM') AND b.category='global' AND b.retain_until>clock_timestamp() ORDER BY b.version DESC LIMIT 1;
 IF cap IS NULL OR currency<>'INR' OR NOT EXISTS(SELECT 1 FROM public.operator_cost_record r WHERE r.month=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM')) THEN RETURN false; END IF;
 WITH latest AS(SELECT DISTINCT ON(source_id) source_id,source FROM public.operator_cost_record WHERE month=cost_month ORDER BY source_id,version DESC),
 native(source_id,kind,business_id,run_id,at,details) AS(${nativeCostSourcesSql}),
 effects AS(SELECT business_id,kind,operation_id FROM public.pilot_effect UNION ALL SELECT (candidate->>'tenant')::uuid,candidate->>'kind',candidate->>'operation' WHERE candidate IS NOT NULL),
 held_sources AS(SELECT n.source_id FROM native n WHERE EXISTS(SELECT 1 FROM effects e WHERE e.business_id=n.business_id AND (
   (n.kind='discovery' AND e.kind='discovery' AND n.source_id='native:discovery:'||e.operation_id)
   OR (n.kind='ai' AND e.kind='discovery' AND EXISTS(SELECT 1 FROM public.ai_attempt a JOIN public.ai_execution x ON x.id=a.execution_id AND x.business_id=a.business_id WHERE 'native:ai:'||a.id=n.source_id AND x.request_key::text=e.operation_id AND x.business_id=e.business_id))
   OR (n.kind='ordinary_mail' AND e.kind='automation' AND n.source_id='native:opportunity-mail:'||e.operation_id)
   OR (n.kind='sequence_mail' AND e.kind='automation' AND n.source_id='native:sequence-mail:'||e.operation_id)
   OR (n.kind='native_mail' AND e.kind='automation' AND n.details->>'duplicateOf' IN ('native:opportunity-mail:'||e.operation_id,'native:sequence-mail:'||e.operation_id))
   OR (n.kind='mailbox_job' AND e.kind='mailbox' AND e.operation_id LIKE substr(n.source_id,length('native:mailbox-job:')+1)||':%')
 ))),
 covered AS(SELECT jsonb_array_elements_text(l.source->'coversSourceIds') id FROM latest l WHERE l.source->'amount' IS NOT NULL AND l.source->'amount'<>'null'::jsonb AND l.source->'amount'->>'currency'='INR' AND l.source->>'status' NOT IN ('unpriced','uncertain') AND (l.source->>'freshUntil')::timestamptz>clock_timestamp()),
 included AS(SELECT l.* FROM latest l WHERE l.source->>'kind' NOT IN ('customer_paid_meta','cash_topup','plan_change','subscription_allocation') AND l.source->>'funding'<>'customer_meta' AND NOT EXISTS(SELECT 1 FROM covered c WHERE c.id=l.source_id) AND NOT EXISTS(SELECT 1 FROM held_sources h WHERE h.source_id=l.source_id))
 SELECT coalesce(sum((source->'amount'->>'micros')::numeric),0),coalesce(bool_or(source->'amount' IS NULL OR source->'amount'='null'::jsonb OR source->'amount'->>'currency'<>'INR' OR source->>'status' IN ('unpriced','uncertain') OR (source_id NOT LIKE 'native:%' AND (source->>'freshUntil')::timestamptz<=clock_timestamp())),false),
 EXISTS(SELECT 1 FROM native n WHERE n.kind<>'meta' AND NOT(n.kind='discovery' AND n.details->>'kind'='review') AND NOT EXISTS(SELECT 1 FROM held_sources h WHERE h.source_id=n.source_id) AND NOT EXISTS(SELECT 1 FROM covered c WHERE c.id=n.source_id) AND NOT EXISTS(SELECT 1 FROM latest l WHERE l.source_id=n.source_id AND l.source->'details'=n.details))
 INTO spent,unknowns,native_unknown FROM included;
 SELECT coalesce(sum(e.global_inr_micros),0) INTO held FROM public.pilot_effect e WHERE to_char(e.at AT TIME ZONE 'UTC','YYYY-MM')=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM');
 RETURN NOT unknowns AND NOT native_unknown AND spent+held+requested*10000<=cap;
 END $$;
 DROP FUNCTION IF EXISTS public.reserve_pilot_effect(uuid,text,text,integer);
 CREATE OR REPLACE FUNCTION public.reserve_pilot_effect(tenant uuid,effect_kind text,operation text,units integer,effect_intent jsonb default '{}'::jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE p record; prior record; ceiling jsonb; cash numeric; spend numeric; duration bigint; used_cash numeric; used_spend numeric; used_seconds bigint; global_cost numeric; BEGIN
 IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL OR units<=0 OR effect_kind NOT IN ('discovery','automation','mailbox','calendar') THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(tenant::text,0));
 SELECT r.* INTO p FROM public.pilot_record r WHERE r.business_id=tenant AND EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=r.id AND e.business_id=r.business_id AND e.kind='activated') ORDER BY r.at DESC,r.id DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant) AND NOT EXISTS(SELECT 1 FROM public.subscription_period paid WHERE paid.business_id=tenant AND paid.end>clock_timestamp() AND paid.charge->>'status'='confirmed' AND (paid.snapshot->'term'->>'kind'='days' AND jsonb_typeof(paid.snapshot->'provider'->'review'->'pilotOrders')='object' OR jsonb_typeof(paid.snapshot->'pilotContinuation')='object')); END IF;
 IF public.business_data_stopped(tenant) OR EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped') OR (p.snapshot->'plan'->>'startsAt')::timestamptz>clock_timestamp() OR (p.snapshot->'plan'->>'endsAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO prior FROM public.pilot_effect e WHERE e.business_id=tenant AND e.kind=effect_kind AND e.operation_id=operation;
 IF prior.id IS NOT NULL THEN RETURN prior.pilot_id=p.id AND prior.quantity=units AND prior.actor_id=current_setting('app.actor_id',true) AND prior.intent=effect_intent AND public.pilot_effect_current(tenant,effect_kind,operation); END IF;
 IF (effect_kind='discovery' AND NOT p.snapshot->'plan'->'capabilities' ? 'discovery') OR (effect_kind='mailbox' AND NOT p.snapshot->'plan'->'capabilities' ? 'mailbox') OR (effect_kind='calendar' AND NOT p.snapshot->'plan'->'capabilities' ? 'calendar') OR (effect_kind='automation' AND NOT p.snapshot->'plan'->'capabilities' ?| ARRAY['inquiry_email','outreach_email','whatsapp']) THEN RETURN false; END IF;
 ceiling=p.snapshot->'plan'->'ceilings'->effect_kind;
 IF ceiling IS NULL OR ceiling='null'::jsonb THEN RETURN false; END IF;
 global_cost=CASE WHEN p.snapshot->'plan'->>'currency'='INR' THEN (ceiling->>'spendMinor')::numeric*units*10000 ELSE (ceiling->>'globalSpendInrMicros')::numeric*units END;
 cash=(ceiling->>'cashMinor')::numeric*units; spend=(ceiling->>'spendMinor')::numeric*units; duration=(ceiling->>'seconds')::bigint*units;
 IF cash IS NULL OR spend IS NULL OR global_cost IS NULL OR duration IS NULL OR duration<=0 THEN RETURN false; END IF;
 SELECT coalesce(sum(e.cash_minor),0),coalesce(sum(e.spend_minor),0),coalesce(sum(e.seconds),0) INTO used_cash,used_spend,used_seconds FROM public.pilot_effect e WHERE e.pilot_id=p.id AND e.business_id=p.business_id;
 SELECT used_cash+coalesce(sum((e.data->>'cashMinor')::numeric),0),used_spend+coalesce(sum((e.data->>'spendMinor')::numeric),0),used_seconds+coalesce(sum((e.data->>'seconds')::bigint),0) INTO used_cash,used_spend,used_seconds FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='effort';
 IF used_cash+cash>(p.snapshot->'plan'->>'cashLimitMinor')::numeric OR used_spend+spend>(p.snapshot->'plan'->>'spendLimitMinor')::numeric OR used_seconds+duration>(p.snapshot->'plan'->>'timeLimitSeconds')::bigint OR NOT public.pilot_global_room('INR',global_cost/10000,jsonb_build_object('tenant',tenant,'kind',effect_kind,'operation',operation)) THEN RETURN false; END IF;
 IF public.current_business_role() IS NULL OR public.business_data_stopped(tenant) OR (p.snapshot->'plan'->>'endsAt')::timestamptz<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped') OR NOT EXISTS(SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id WHERE s.id=current_setting('app.pilot_session',true) AND s.user_id=current_setting('app.actor_id',true) AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '12 hours') THEN RETURN false; END IF;
 INSERT INTO public.pilot_effect(id,business_id,pilot_id,kind,operation_id,quantity,cash_minor,spend_minor,global_inr_micros,seconds,actor_id,intent) VALUES(gen_random_uuid(),tenant,p.id,effect_kind,operation,units,cash,spend,global_cost,duration,current_setting('app.actor_id',true),effect_intent); RETURN true;
 END $$;
 CREATE OR REPLACE FUNCTION public.pilot_effect_current(tenant uuid,effect_kind text,operation text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; BEGIN
 IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL THEN RETURN false; END IF;
 SELECT r.* INTO p FROM public.pilot_record r WHERE r.business_id=tenant AND EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=r.id AND e.business_id=r.business_id AND e.kind='activated') ORDER BY r.at DESC,r.id DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant) AND NOT EXISTS(SELECT 1 FROM public.subscription_period paid WHERE paid.business_id=tenant AND paid.end>clock_timestamp() AND paid.charge->>'status'='confirmed' AND (paid.snapshot->'term'->>'kind'='days' AND jsonb_typeof(paid.snapshot->'provider'->'review'->'pilotOrders')='object' OR jsonb_typeof(paid.snapshot->'pilotContinuation')='object')); END IF;
 IF NOT public.pilot_global_room('INR',0) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id WHERE s.id=current_setting('app.pilot_session',true) AND s.user_id=current_setting('app.actor_id',true) AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '12 hours') AND NOT public.business_data_stopped(tenant) AND (p.snapshot->'plan'->>'startsAt')::timestamptz<=clock_timestamp() AND (p.snapshot->'plan'->>'endsAt')::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped') AND (operation='' OR EXISTS(SELECT 1 FROM public.pilot_effect e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind=effect_kind AND e.operation_id=operation)) AND (SELECT coalesce(sum(e.cash_minor),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'cashMinor')::numeric),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'cashLimitMinor')::numeric AND (SELECT coalesce(sum(e.spend_minor),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'spendMinor')::numeric),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'spendLimitMinor')::numeric AND (SELECT coalesce(sum(e.seconds),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'seconds')::bigint),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'timeLimitSeconds')::bigint AND public.current_business_role() IS NOT NULL;
 END $$;
 CREATE OR REPLACE FUNCTION public.pilot_path_allowed(tenant uuid,capability text,path jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; plan jsonb; BEGIN
 IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL THEN RETURN false; END IF;
 SELECT r.* INTO p FROM public.pilot_record r WHERE r.business_id=tenant AND EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=r.id AND e.business_id=r.business_id AND e.kind='activated') ORDER BY r.at DESC,r.id DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant) AND NOT EXISTS(SELECT 1 FROM public.subscription_period paid WHERE paid.business_id=tenant AND paid.end>clock_timestamp() AND paid.charge->>'status'='confirmed' AND (paid.snapshot->'term'->>'kind'='days' AND jsonb_typeof(paid.snapshot->'provider'->'review'->'pilotOrders')='object' OR jsonb_typeof(paid.snapshot->'pilotContinuation')='object')); END IF;
 plan=p.snapshot->'plan';
 IF NOT plan->'capabilities' ? capability THEN RETURN false; END IF;
 RETURN coalesce(CASE capability
 WHEN 'discovery' THEN true
 WHEN 'mailbox' THEN plan->>'mailboxId'=path->>'mailboxId'
 WHEN 'calendar' THEN plan->>'calendarId'=path->>'calendarId' AND plan->>'calendarProvider'=path->>'provider' AND plan->>'calendarConnectionId'=path->>'connectionId'
 WHEN 'whatsapp' THEN plan->>'whatsAppConnectionId'=path->>'connectionId'
 WHEN 'inquiry_email' THEN plan->>'senderId'=path->>'senderId' AND plan->>'mailboxId'=path->>'mailboxId' AND plan->'emailActions' @> jsonb_build_array(path->'action')
 WHEN 'outreach_email' THEN plan->>'senderId'=path->>'senderId' AND plan->>'mailboxId'=path->>'mailboxId' AND plan->'emailActions' @> jsonb_build_array(path->'action')
 ELSE false END,false);
 END $$;
 REVOKE ALL ON FUNCTION public.pilot_path_allowed(uuid,text,jsonb) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.pilot_path_allowed(uuid,text,jsonb) TO app_runtime;
 CREATE OR REPLACE FUNCTION public.pilot_budget_ready() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN public.pilot_authorized() AND public.pilot_global_room('INR',0); END $$;
 REVOKE ALL ON FUNCTION public.pilot_budget_ready() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.pilot_budget_ready() TO app_runtime;
 REVOKE ALL ON FUNCTION public.pilot_global_room(text,numeric,jsonb),public.pilot_authorized(),public.pilot_operator(),public.reserve_pilot_effect(uuid,text,text,integer,jsonb),public.pilot_effect_current(uuid,text,text) FROM PUBLIC;
 REVOKE ALL ON FUNCTION public.pilot_global_room(text,numeric,jsonb) FROM app_runtime;
 GRANT EXECUTE ON FUNCTION public.pilot_authorized(),public.pilot_operator(),public.reserve_pilot_effect(uuid,text,text,integer,jsonb),public.pilot_effect_current(uuid,text,text) TO app_runtime;
 GRANT USAGE ON SEQUENCE public.pilot_event_position_seq TO app_runtime;
 `);
}
export async function verifyPilots(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(`SELECT
 (SELECT count(*)=${pilotCostReadTables.length} AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${pilotCostReadTables.map((n) => `'${n}'`).join(",")}]::name[])) AND
 (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('pilot_record','pilot_event','pilot_effect'))
 AND (SELECT count(*)=8 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE')=(p.proname NOT IN ('pilot_global_room','protect_pilot_write')) AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('pilot_authorized','pilot_operator','reserve_pilot_effect','pilot_effect_current','pilot_global_room','pilot_budget_ready','pilot_path_allowed','protect_pilot_write'))
 AND (SELECT count(*)=3 AND bool_and(t.tgenabled='O' AND t.tgtype=7 AND p.proname='protect_pilot_write') FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE (t.tgrelid='public.pilot_record'::regclass AND t.tgname='pilot_record_guard' OR t.tgrelid='public.pilot_event'::regclass AND t.tgname='pilot_event_guard' OR t.tgrelid='public.subscription_payment_history'::regclass AND t.tgname='pilot_creation_history_guard'))
 AND (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conname IN ('pilot_event_scope','pilot_effect_scope') AND contype='f')
 AND NOT has_column_privilege(current_user,'public.platform_operator','pilots','UPDATE')
 AND has_sequence_privilege(current_user,'public.pilot_event_position_seq','USAGE')
 AND (SELECT count(*)=${pilotCostReadTables.length} AND bool_and(tablename=ANY(ARRAY[${pilotCostReadTables.map((n) => `'${n}'`).join(",")}]::name[]) AND roles::text[]=ARRAY['public'] AND cmd='SELECT' AND permissive='PERMISSIVE' AND with_check IS NULL AND regexp_replace(qual,'[[:space:]]','','g')=format('(CURRENT_USER=(SELECTpg_get_userbyid(c.relowner)ASpg_get_userbyidFROMpg_classcWHERE(c.oid=(%L::regclass)::oid)))',('public.'||tablename)::regclass::text)) FROM pg_policies WHERE schemaname='public' AND policyname=tablename||'_pilot_cost_owner_read') AS safe`);
  return result.rows[0]?.safe === true;
}
