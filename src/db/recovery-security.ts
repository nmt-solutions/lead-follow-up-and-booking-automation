import type { Pool, PoolClient } from "pg";
export const recoveryTables = [
  "infrastructure_recovery",
  "infrastructure_recovery_event",
];
export const recoveryFunctions = [
  "recovery_operator_authorized",
  "claim_infrastructure_recovery",
  "finish_infrastructure_recovery",
  "delegate_infrastructure_recovery",
  "pending_infrastructure_recovery",
];
export async function prepareRecoverySecurity(pool: Pool | PoolClient) {
  await pool.query(
    `DO $$ BEGIN IF to_regclass('public.infrastructure_recovery_event') IS NOT NULL THEN ALTER TABLE public.infrastructure_recovery_event DROP CONSTRAINT IF EXISTS recovery_event_scope; END IF; END $$;`,
  );
}
export async function secureRecovery(pool: Pool | PoolClient) {
  await pool.query(`
  CREATE OR REPLACE FUNCTION public.recovery_operator_authorized() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
    SELECT EXISTS(SELECT 1 FROM public.platform_operator o JOIN public."user" u ON u.id=o.user_id
      JOIN public.session s ON s.user_id=u.id JOIN public.two_factor f ON f.user_id=u.id
      WHERE o.user_id=current_setting('app.actor_id',true) AND o.recovery AND s.id=current_setting('app.recovery_session',true)
      AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id
      AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')
      AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '15 minutes')
  $$;
  CREATE OR REPLACE FUNCTION public.claim_infrastructure_recovery(op uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE r public.infrastructure_recovery; k uuid;
    BEGIN
      IF NOT public.recovery_operator_authorized() THEN RAISE EXCEPTION 'forbidden'; END IF;
      SELECT * INTO r FROM public.infrastructure_recovery WHERE id=op FOR UPDATE;
      IF r.id IS NULL OR NOT public.recovery_operator_authorized() OR r.actor_id<>current_setting('app.actor_id',true) OR r.business_id<>nullif(current_setting('app.business_id',true),'')::uuid
        OR r.plan->>'retainUntil' IS NULL OR (r.plan->>'retainUntil')::timestamptz<=clock_timestamp()
        OR (r.plan->>'observationExpiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF r.stage='inspection_ready' OR r.lease_until>clock_timestamp() THEN RETURN NULL; END IF;
      k=gen_random_uuid(); UPDATE public.infrastructure_recovery SET lease=k,lease_until=clock_timestamp()+interval '5 minutes',authorized_session_id=current_setting('app.recovery_session',true) WHERE id=op;
      INSERT INTO public.infrastructure_recovery_event(id,business_id,operation_id,stage,outcome,evidence) VALUES(gen_random_uuid(),r.business_id,r.id,r.stage,'started',jsonb_build_object('attemptHash',encode(sha256(convert_to(k::text,'UTF8')),'hex'),'sessionHash',encode(sha256(convert_to(current_setting('app.recovery_session',true),'UTF8')),'hex'),'assurance',jsonb_build_object('actorId',current_setting('app.actor_id',true),'verifiedAt',(SELECT s.mfa_verified_at FROM public.session s WHERE s.id=current_setting('app.recovery_session',true)),'current',true))); RETURN k;
    END $$;
  CREATE OR REPLACE FUNCTION public.finish_infrastructure_recovery(op uuid,k uuid,next_stage text,result text,proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE r public.infrastructure_recovery; original public.infrastructure_recovery_event; current_authority boolean; late_fact boolean; attempt_hash text; stages text[]=ARRAY['requested','target_verified','restored','secured','verified','quarantined','reconciled','inspection_ready'];
    BEGIN
      SELECT * INTO r FROM public.infrastructure_recovery WHERE id=op FOR UPDATE;
      attempt_hash=encode(sha256(convert_to(k::text,'UTF8')),'hex');
      SELECT * INTO original FROM public.infrastructure_recovery_event e WHERE e.operation_id=op AND e.outcome='started' AND e.evidence->>'attemptHash'=attempt_hash AND e.evidence->>'sessionHash'=encode(sha256(convert_to(current_setting('app.recovery_session',true),'UTF8')),'hex');
      current_authority=public.recovery_operator_authorized();
      late_fact=result='ambiguous' AND proof->>'incurredStage'=stages[array_position(stages,original.stage)+1];
      IF r.id IS NULL OR original.id IS NULL OR r.actor_id<>current_setting('app.actor_id',true) OR r.business_id<>nullif(current_setting('app.business_id',true),'')::uuid
        OR (NOT coalesce(late_fact,false) AND (NOT current_authority OR r.lease IS DISTINCT FROM k OR r.lease_until IS NULL OR r.lease_until<=clock_timestamp() OR r.authorized_session_id<>current_setting('app.recovery_session',true) OR (r.plan->>'retainUntil')::timestamptz<=clock_timestamp() OR (r.plan->>'observationExpiresAt')::timestamptz<=clock_timestamp()))
        OR result NOT IN ('completed','failed','ambiguous') OR (result='completed' AND next_stage IS DISTINCT FROM stages[array_position(stages,r.stage)+1])
        OR octet_length(proof::text)>2000000 THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF EXISTS(SELECT 1 FROM public.infrastructure_recovery_event e WHERE e.operation_id=op AND e.outcome<>'started' AND e.evidence->>'attemptHash'=attempt_hash) THEN RETURN false; END IF;
      INSERT INTO public.infrastructure_recovery_event(id,business_id,operation_id,stage,outcome,evidence) VALUES(gen_random_uuid(),r.business_id,r.id,CASE WHEN result='completed' THEN next_stage ELSE original.stage END,result,proof||jsonb_build_object('attemptHash',attempt_hash,'assurance',original.evidence->'assurance'||jsonb_build_object('current',coalesce(result='completed' AND current_authority AND r.lease=k AND r.lease_until>clock_timestamp(),false))));
      UPDATE public.infrastructure_recovery SET stage=CASE WHEN result='completed' THEN next_stage ELSE r.stage END,lease=NULL,lease_until=NULL WHERE id=op AND lease=k;
      RETURN true;
    END $$;
  CREATE OR REPLACE FUNCTION public.delegate_infrastructure_recovery(op uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE r public.infrastructure_recovery;
    BEGIN
      SELECT * INTO r FROM public.infrastructure_recovery WHERE id=op FOR UPDATE;
      IF r.id IS NULL OR NOT public.recovery_operator_authorized() OR r.actor_id<>current_setting('app.actor_id',true) OR r.business_id<>nullif(current_setting('app.business_id',true),'')::uuid OR (r.plan->>'retainUntil')::timestamptz<=clock_timestamp() OR (r.plan->>'observationExpiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'forbidden'; END IF;
      UPDATE public.infrastructure_recovery SET authorized_session_id=current_setting('app.recovery_session',true) WHERE id=op;
    END $$;
  CREATE OR REPLACE FUNCTION public.pending_infrastructure_recovery() RETURNS TABLE(id uuid,business_id uuid,actor_id text,session_id text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
    SELECT r.id,r.business_id,r.actor_id,r.authorized_session_id FROM public.infrastructure_recovery r
    JOIN public.platform_operator o ON o.user_id=r.actor_id AND o.recovery
    JOIN public.session s ON s.id=r.authorized_session_id AND s.user_id=r.actor_id
    JOIN public."user" u ON u.id=r.actor_id JOIN public.two_factor f ON f.user_id=u.id
    WHERE r.stage<>'inspection_ready' AND (r.lease_until IS NULL OR r.lease_until<=clock_timestamp()) AND (r.plan->>'retainUntil')::timestamptz>clock_timestamp() AND (r.plan->>'observationExpiresAt')::timestamptz>clock_timestamp()
    AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '15 minutes'
    ORDER BY r.at LIMIT 100
  $$;
  REVOKE ALL ON FUNCTION public.delegate_infrastructure_recovery(uuid),public.pending_infrastructure_recovery() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.delegate_infrastructure_recovery(uuid),public.pending_infrastructure_recovery() TO app_runtime;
  REVOKE ALL ON FUNCTION public.recovery_operator_authorized(),public.claim_infrastructure_recovery(uuid),public.finish_infrastructure_recovery(uuid,uuid,text,text,jsonb) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.recovery_operator_authorized(),public.claim_infrastructure_recovery(uuid),public.finish_infrastructure_recovery(uuid,uuid,text,text,jsonb) TO app_runtime;
  DROP POLICY IF EXISTS recovery_read ON public.infrastructure_recovery;
  CREATE POLICY recovery_read ON public.infrastructure_recovery FOR SELECT TO app_runtime USING(business_id=nullif(current_setting('app.business_id',true),'')::uuid AND public.recovery_operator_authorized());
  DROP POLICY IF EXISTS recovery_insert ON public.infrastructure_recovery;
  CREATE POLICY recovery_insert ON public.infrastructure_recovery FOR INSERT TO app_runtime WITH CHECK(business_id=nullif(current_setting('app.business_id',true),'')::uuid AND public.recovery_operator_authorized() AND actor_id=current_setting('app.actor_id',true) AND session_id=current_setting('app.recovery_session',true) AND authorized_session_id=session_id AND stage='requested' AND lease IS NULL AND lease_until IS NULL);
  DROP POLICY IF EXISTS recovery_owner ON public.infrastructure_recovery;
  CREATE POLICY recovery_owner ON public.infrastructure_recovery FOR ALL TO PUBLIC USING(current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass)) WITH CHECK(current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass));
  DROP POLICY IF EXISTS recovery_event_read ON public.infrastructure_recovery_event;
  CREATE POLICY recovery_event_read ON public.infrastructure_recovery_event FOR SELECT TO app_runtime USING(business_id=nullif(current_setting('app.business_id',true),'')::uuid AND public.recovery_operator_authorized());
  DROP POLICY IF EXISTS recovery_event_owner ON public.infrastructure_recovery_event;
  CREATE POLICY recovery_event_owner ON public.infrastructure_recovery_event FOR ALL TO PUBLIC USING(current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery_event'::regclass)) WITH CHECK(current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery_event'::regclass));
  DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='recovery_event_scope' AND conrelid='public.infrastructure_recovery_event'::regclass) THEN ALTER TABLE public.infrastructure_recovery_event ADD CONSTRAINT recovery_event_scope FOREIGN KEY(operation_id,business_id) REFERENCES public.infrastructure_recovery(id,business_id); END IF; END $$;
  GRANT USAGE ON SEQUENCE public.infrastructure_recovery_event_position_seq TO app_runtime;
  `);
  for (const table of recoveryTables)
    await pool.query(
      `REVOKE ALL ON public.${table} FROM app_runtime; GRANT SELECT,INSERT ON public.${table} TO app_runtime; ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`,
    );
}
export async function verifyRecoverySecurity(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(`SELECT
    NOT EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolname='neon_superuser') AND pg_has_role(current_user,r.oid,'MEMBER')) AND
    (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('infrastructure_recovery','infrastructure_recovery_event'))
    AND (SELECT count(*)=5 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('recovery_operator_authorized','claim_infrastructure_recovery','finish_infrastructure_recovery','delegate_infrastructure_recovery','pending_infrastructure_recovery'))
    AND NOT has_column_privilege(current_user,'public.platform_operator','recovery','UPDATE')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='recovery_event_scope' AND convalidated AND conrelid='public.infrastructure_recovery_event'::regclass AND confrelid='public.infrastructure_recovery'::regclass)
    AND (SELECT count(*)=5 AND bool_and(CASE WHEN cmd='SELECT' THEN qual IS NOT NULL WHEN cmd='INSERT' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('infrastructure_recovery','infrastructure_recovery_event'))
    AND has_sequence_privilege(current_user,'public.infrastructure_recovery_event_position_seq','USAGE') AS safe`);
  return result.rows[0]?.safe === true;
}
