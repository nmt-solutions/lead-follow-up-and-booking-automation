import type { Pool, PoolClient } from "pg";

export async function prepareDiscoveryCapacity(pool: Pool | PoolClient) {
  await pool.query(
    `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC; ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC; DO $$ BEGIN IF to_regclass('public.discovery_capacity_policy') IS NOT NULL THEN REVOKE ALL PRIVILEGES ON public.discovery_capacity_policy FROM app_runtime; END IF; IF to_regclass('public.discovery_capacity_binding') IS NOT NULL THEN REVOKE ALL PRIVILEGES ON public.discovery_capacity_binding FROM app_runtime; END IF; END $$`,
  );
}
export async function secureDiscoveryCapacity(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.discovery_capacity_route(tenant uuid,deployed jsonb DEFAULT NULL)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE c public.discovery_capacity_policy; p jsonb; a jsonb; lane text; mode text; slots integer; BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL OR public.business_data_stopped(tenant) THEN RETURN NULL; END IF;
      SELECT * INTO c FROM public.discovery_capacity_policy ORDER BY version DESC LIMIT 1;
      IF c.id IS NULL OR (c.policy->>'validUntil')::timestamptz<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=c.actor_id AND o.discovery) THEN RETURN NULL; END IF;
      IF deployed IS NOT NULL AND (deployed->>'id' IS DISTINCT FROM c.id::text OR deployed->>'version' IS DISTINCT FROM c.version::text OR deployed->'policy' IS DISTINCT FROM c.policy) THEN RETURN NULL; END IF;
      p:=public.current_paid_contract(tenant,clock_timestamp()); IF p IS NULL THEN RETURN NULL; END IF;
      mode:='pooled'; slots:=(c.policy->>'pooled')::integer; lane:='discovery-pooled-'||c.id;
      IF p->>'reservedCapacityId' IS NOT NULL THEN
        SELECT x INTO a FROM jsonb_array_elements(c.policy->'allocations') x WHERE x->>'businessId'=tenant::text AND x->>'offerId'=p->>'offerId' AND x->>'reservedCapacityId'=p->>'reservedCapacityId';
        IF a IS NULL OR a->>'unit' IS DISTINCT FROM p->'reservedCapacity'->'capacity'->>'unit' OR (a->>'quantity')::integer IS DISTINCT FROM (p->'reservedCapacity'->'capacity'->>'quantity')::integer THEN RETURN NULL; END IF;
        mode:='reserved'; slots:=(a->>'concurrentRuns')::integer; lane:='discovery-reserved-'||c.id||'-'||tenant;
      END IF;
      RETURN jsonb_build_object('policyId',c.id,'version',c.version,'projectRef',c.policy->>'projectRef','deploymentRef',c.policy->>'deploymentRef','mode',mode,'total',(c.policy->>'total')::integer,'slots',slots,'globalLimit','discovery-provider-'||c.id,'laneLimit',lane,'contract',p,'maxObservationAgeMs',(c.policy->>'maxObservationAgeMs')::integer);
    END $$;
    REVOKE ALL ON FUNCTION public.discovery_capacity_route(uuid,jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.discovery_capacity_route(uuid,jsonb) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.protect_discovery_capacity()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE r public.discovery_run; expected jsonb; cap integer; BEGIN
      IF TG_TABLE_NAME='discovery_capacity_policy' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('discovery-capacity',0));
        IF coalesce(current_setting('app.business_id',true),'')<>'' OR NEW.actor_id IS DISTINCT FROM current_setting('app.actor_id',true) OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=NEW.actor_id AND o.discovery) THEN RAISE EXCEPTION 'forbidden capacity approval'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id WHERE s.id=NEW.session_id AND s.user_id=NEW.actor_id AND s.expires_at>clock_timestamp() AND u.two_factor_enabled AND f.verified AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '15 minutes' AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')) THEN RAISE EXCEPTION 'capacity MFA required'; END IF;
        IF NEW.version<>(SELECT coalesce(max(version),0)+1 FROM public.discovery_capacity_policy) OR NEW.policy->>'validUntil' IS NULL OR (NEW.policy->>'validUntil')::timestamptz<=clock_timestamp() OR NEW.policy->>'fallback' IS DISTINCT FROM 'wait' THEN RAISE EXCEPTION 'invalid capacity approval'; END IF;
        cap:=(NEW.policy->>'total')::integer;
        IF cap IS NULL OR cap<1 OR coalesce((NEW.policy->>'pooled')::integer,0)<1 OR coalesce(length(NEW.policy->>'projectRef'),0)=0 OR coalesce(length(NEW.policy->>'deploymentRef'),0)=0 OR coalesce(length(NEW.policy->>'providerEvidence'),0)=0 OR coalesce((NEW.policy->>'maxObservationAgeMs')::integer,0) NOT BETWEEN 100 AND 30000 OR (NEW.policy->>'pooled')::integer+coalesce((SELECT sum((x->>'concurrentRuns')::integer) FROM jsonb_array_elements(NEW.policy->'allocations') x),0)>cap OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.policy->'allocations') x WHERE coalesce(length(x->>'unit'),0)=0 OR coalesce(length(x->>'mappingEvidence'),0)=0 OR coalesce((x->>'quantity')::integer,0)<1 OR coalesce((x->>'concurrentRuns')::integer,0)<1 OR NOT EXISTS(SELECT 1 FROM public.business b WHERE b.id=(x->>'businessId')::uuid)) OR (SELECT count(*)<>count(DISTINCT x->>'businessId') FROM jsonb_array_elements(NEW.policy->'allocations') x) THEN RAISE EXCEPTION 'invalid finite capacity'; END IF;
      ELSE
        SELECT * INTO r FROM public.discovery_run WHERE id=NEW.run_id AND business_id=NEW.business_id;
        IF r.id IS NULL OR r.execution_id IS DISTINCT FROM NEW.id OR coalesce(r.execution_user_id,r.created_by) IS DISTINCT FROM current_setting('app.actor_id',true) OR r.status<>'queued' THEN RAISE EXCEPTION 'invalid capacity work'; END IF;
        expected:=public.discovery_capacity_route(NEW.business_id);
        IF expected IS NULL OR expected IS DISTINCT FROM NEW.route OR expected->>'policyId' IS DISTINCT FROM NEW.policy_id::text THEN RAISE EXCEPTION 'invalid capacity route'; END IF;
      END IF;
      NEW.at:=clock_timestamp(); RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.protect_discovery_capacity() FROM PUBLIC,app_runtime;
    DROP TRIGGER IF EXISTS discovery_capacity_policy_guard ON public.discovery_capacity_policy;
    CREATE TRIGGER discovery_capacity_policy_guard BEFORE INSERT ON public.discovery_capacity_policy FOR EACH ROW EXECUTE FUNCTION public.protect_discovery_capacity();
    DROP TRIGGER IF EXISTS discovery_capacity_binding_guard ON public.discovery_capacity_binding;
    CREATE TRIGGER discovery_capacity_binding_guard BEFORE INSERT ON public.discovery_capacity_binding FOR EACH ROW EXECUTE FUNCTION public.protect_discovery_capacity();
    REVOKE ALL ON public.discovery_capacity_binding FROM PUBLIC,app_runtime;
    GRANT SELECT,INSERT ON public.discovery_capacity_binding TO app_runtime;
    ALTER TABLE public.discovery_capacity_binding FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON public.discovery_capacity_policy FROM PUBLIC,app_runtime;
    GRANT SELECT,INSERT ON public.discovery_capacity_policy TO app_runtime;
    ALTER TABLE public.discovery_capacity_policy FORCE ROW LEVEL SECURITY;
  `);
}
export async function verifyDiscoveryCapacity(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(`SELECT
    (SELECT count(*)=2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER')
      AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
      AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('discovery_capacity_policy','discovery_capacity_binding'))
    AND (SELECT count(*)=4 FROM pg_policies WHERE schemaname='public' AND tablename IN ('discovery_capacity_policy','discovery_capacity_binding') AND roles=ARRAY['app_runtime']::name[] AND CASE WHEN policyname LIKE '%_read' THEN qual LIKE '%app.business_id%' ELSE with_check LIKE '%app.business_id%' END)
    AND (SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='discovery_capacity_route')
    AND (SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND NOT has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='protect_discovery_capacity')
    AND (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN ('discovery_capacity_policy_guard','discovery_capacity_binding_guard') AND tgenabled='O' AND tgfoid='public.protect_discovery_capacity()'::regprocedure)
    AND EXISTS(SELECT 1 FROM pg_default_acl d WHERE d.defaclobjtype='f' AND d.defaclnamespace=0 AND d.defaclrole=(SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='discovery_capacity_route') AND NOT EXISTS(SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
    AND NOT EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=(SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='discovery_capacity_route') AND d.defaclobjtype IN ('f','r') AND a.grantee=0 AND (d.defaclnamespace=0 OR d.defaclnamespace='public'::regnamespace))
    AND NOT has_column_privilege(current_user,'public.platform_operator','discovery','UPDATE') AS safe`);
  if (result.rows[0]?.safe !== true)
    throw new Error("Discovery capacity database security is incomplete");
}
