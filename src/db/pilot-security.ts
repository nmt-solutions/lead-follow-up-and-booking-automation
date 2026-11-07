import { nativeCostSourcesSql } from "./cost-security";
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pilotRecord, pilotEvent, pilotEffect } from "./schema";
export const pilotTables = ["pilot_record", "pilot_event", "pilot_effect"];
export const pilotFunctions = [
  "pilot_authorized",
  "pilot_operator",
  "reserve_pilot_effect",
  "pilot_effect_current",
  "pilot_global_room",
  "pilot_budget_ready",
  "pilot_path_allowed",
];
export async function preparePilotSecurity(pool: Pool | PoolClient) {
  await pool.query(`DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['pilot_record','pilot_event','pilot_effect'] LOOP IF to_regclass('public.'||t) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON public.%I FROM app_runtime',t); END IF; END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['pilot_authorized','pilot_operator','reserve_pilot_effect','pilot_effect_current','pilot_global_room','pilot_budget_ready','pilot_path_allowed']) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime',f.signature); END LOOP;
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
      `DROP POLICY IF EXISTS ${name}_owner ON public.${name}; CREATE POLICY ${name}_owner ON public.${name} FOR ALL TO PUBLIC USING(current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.${name}'::regclass)) WITH CHECK(current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.${name}'::regclass)); REVOKE ALL ON public.${name} FROM app_runtime; GRANT SELECT,INSERT ON public.${name} TO app_runtime;`,
    );
  }
  await pool.query(`
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
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant); END IF;
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
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant); END IF;
 IF NOT public.pilot_global_room('INR',0) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id WHERE s.id=current_setting('app.pilot_session',true) AND s.user_id=current_setting('app.actor_id',true) AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '12 hours') AND NOT public.business_data_stopped(tenant) AND (p.snapshot->'plan'->>'startsAt')::timestamptz<=clock_timestamp() AND (p.snapshot->'plan'->>'endsAt')::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind='stopped') AND (operation='' OR EXISTS(SELECT 1 FROM public.pilot_effect e WHERE e.pilot_id=p.id AND e.business_id=p.business_id AND e.kind=effect_kind AND e.operation_id=operation)) AND (SELECT coalesce(sum(e.cash_minor),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'cashMinor')::numeric),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'cashLimitMinor')::numeric AND (SELECT coalesce(sum(e.spend_minor),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'spendMinor')::numeric),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'spendLimitMinor')::numeric AND (SELECT coalesce(sum(e.seconds),0) FROM public.pilot_effect e WHERE e.business_id=tenant AND e.pilot_id=p.id)+(SELECT coalesce(sum((e.data->>'seconds')::bigint),0) FROM public.pilot_event e WHERE e.business_id=tenant AND e.pilot_id=p.id AND e.kind='effort')<=(p.snapshot->'plan'->>'timeLimitSeconds')::bigint AND public.current_business_role() IS NOT NULL;
 END $$;
 CREATE OR REPLACE FUNCTION public.pilot_path_allowed(tenant uuid,capability text,path jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; plan jsonb; BEGIN
 IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL THEN RETURN false; END IF;
 SELECT r.* INTO p FROM public.pilot_record r WHERE r.business_id=tenant AND EXISTS(SELECT 1 FROM public.pilot_event e WHERE e.pilot_id=r.id AND e.business_id=r.business_id AND e.kind='activated') ORDER BY r.at DESC,r.id DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN NOT EXISTS(SELECT 1 FROM public.pilot_record r WHERE r.business_id=tenant); END IF;
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
 (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('pilot_record','pilot_event','pilot_effect'))
 AND (SELECT count(*)=7 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE')=(p.proname<>'pilot_global_room') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('pilot_authorized','pilot_operator','reserve_pilot_effect','pilot_effect_current','pilot_global_room','pilot_budget_ready','pilot_path_allowed'))
 AND (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conname IN ('pilot_event_scope','pilot_effect_scope') AND contype='f')
 AND NOT has_column_privilege(current_user,'public.platform_operator','pilots','UPDATE')
 AND has_sequence_privilege(current_user,'public.pilot_event_position_seq','USAGE') AS safe`);
  return result.rows[0]?.safe === true;
}
