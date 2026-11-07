import type { Pool, PoolClient } from "pg";

export const reachFunctions = [
  "reach_worker_authorized",
  "pending_reach_changes",
  "reach_payment_authorized",
  "reach_payment_insert",
  "reach_current_context",
  "payment_reach_contract",
  "reach_configuration_matches",
  "payment_reach_stop_requested",
  "reach_effective_scope",
  "current_paid_contract",
  "upi_review_current",
];
export async function prepareReachSecurity(
  pool: Pool | PoolClient,
  paused = false,
) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.upi_review_current(change uuid,tenant uuid,at_time timestamptz)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE r record; c record; BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT (public.reach_worker_authorized(change,tenant) OR EXISTS(SELECT 1 FROM public.membership m WHERE m.business_id=tenant AND m.user_id=current_setting('app.actor_id',true) AND m.role IN ('owner','admin')) OR EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.reconciliation)) THEN RETURN false; END IF;
      SELECT * INTO c FROM public.reach_change WHERE id=change AND business_id=tenant;
      SELECT * INTO r FROM public.reach_change_event e WHERE e.change_id=change AND e.business_id=tenant AND e.fact->>'kind'='method_review' ORDER BY e.position DESC LIMIT 1;
      RETURN coalesce(r.fact->'body'->>'snapshotHash'=encode(sha256(convert_to(c.snapshot::text,'UTF8')),'hex') AND (r.fact->'body'->>'dbUntil')::timestamptz>clock_timestamp() AND EXISTS(
        SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id JOIN public.platform_operator o ON o.user_id=u.id
        WHERE s.id=r.fact->'body'->>'sessionId' AND s.user_id=r.actor_id AND o.reconciliation AND s.expires_at>clock_timestamp() AND s.expires_at>at_time AND u.two_factor_enabled AND f.verified
        AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND s.mfa_factor_version=r.fact->'body'->>'factorVersion'
        AND s.mfa_verified_at=(r.fact->'body'->>'verifiedAt')::timestamptz AND s.mfa_verified_at<=at_time AND s.mfa_verified_at>at_time-interval '15 minutes'),false);
    END $$;
    REVOKE ALL ON FUNCTION public.upi_review_current(uuid,uuid,timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.upi_review_current(uuid,uuid,timestamptz) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.protect_upi_reach_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE c record; s record; observed timestamptz; BEGIN
      SELECT * INTO c FROM public.reach_change WHERE id=NEW.change_id AND business_id=NEW.business_id;
      IF c.snapshot->'target'->'upi' IS NULL THEN RETURN NEW; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text,0));
      observed:=nullif(current_setting('app.upi_at',true),'')::timestamptz;
      IF NEW.fact->>'kind'='method_review' THEN
        SELECT se.* INTO s FROM public.session se JOIN public."user" u ON u.id=se.user_id JOIN public.two_factor f ON f.user_id=u.id JOIN public.platform_operator o ON o.user_id=u.id
          WHERE se.id=current_setting('app.upi_session',true) AND se.user_id=current_setting('app.actor_id',true) AND se.user_id=NEW.actor_id AND o.reconciliation AND se.expires_at>clock_timestamp() AND se.expires_at>observed AND u.two_factor_enabled AND f.verified
          AND se.mfa_factor_id=f.id AND se.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND se.mfa_verified_at<=observed AND se.mfa_verified_at>observed-interval '15 minutes';
        IF NOT FOUND THEN RAISE EXCEPTION 'UPI validation authority required' USING ERRCODE='42501'; END IF;
        NEW.fact:=jsonb_build_object('kind','method_review','body',jsonb_build_object('sessionId',s.id,'factorVersion',s.mfa_factor_version,'verifiedAt',s.mfa_verified_at,'dbUntil',least(s.expires_at,clock_timestamp()+interval '15 minutes'),'snapshotHash',encode(sha256(convert_to(c.snapshot::text,'UTF8')),'hex')));
      ELSIF NEW.fact->>'kind' IN ('approved','attempt') THEN
        IF observed IS NULL OR NOT public.upi_review_current(c.id,c.business_id,observed) THEN RAISE EXCEPTION 'UPI validation required' USING ERRCODE='42501'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.session se JOIN public."user" u ON u.id=se.user_id JOIN public.two_factor f ON f.user_id=u.id WHERE se.id=current_setting('app.upi_actor_session',true) AND se.user_id=current_setting('app.actor_id',true) AND se.user_id=NEW.actor_id AND se.expires_at>clock_timestamp() AND se.expires_at>observed AND u.two_factor_enabled AND f.verified AND se.mfa_factor_id=f.id AND se.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex') AND se.mfa_verified_at<=observed AND se.mfa_verified_at>observed-interval '12 hours') THEN RAISE EXCEPTION 'UPI current actor required' USING ERRCODE='42501'; END IF;
        IF NEW.fact->>'kind'='approved' AND NEW.fact->'body'->>'methodReviewId' IS DISTINCT FROM (SELECT e.id::text FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='method_review' ORDER BY e.position DESC LIMIT 1) THEN RAISE EXCEPTION 'UPI exact review required' USING ERRCODE='42501'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.protect_upi_reach_event() FROM PUBLIC,app_runtime;
    DO $$ BEGIN IF to_regclass('public.reach_change_event') IS NOT NULL THEN
      DROP TRIGGER IF EXISTS upi_reach_event_guard ON public.reach_change_event;
      CREATE TRIGGER upi_reach_event_guard BEFORE INSERT ON public.reach_change_event FOR EACH ROW EXECUTE FUNCTION public.protect_upi_reach_event();
    END IF; END $$;
    CREATE OR REPLACE FUNCTION public.reach_effective_scope(tenant uuid,period uuid,at_time timestamptz)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT EXISTS(SELECT 1 FROM public.membership m WHERE m.business_id=tenant AND m.user_id=current_setting('app.actor_id',true)) AND NOT EXISTS(SELECT 1 FROM public.reach_change c WHERE c.business_id=tenant AND public.reach_worker_authorized(c.id,tenant)) THEN RETURN NULL; END IF;
      RETURN (SELECT jsonb_build_object('changeId',c.id,'scope',c.snapshot->'scope','offerId',c.snapshot->'target'->'quote'->'selection'->'offerId','reservedCapacityId',c.snapshot->'target'->'quote'->'selection'->'reservedCapacityId','reservedCapacity',CASE WHEN c.snapshot->'target'->'quote'->'pricing'->'reservedCapacity' IS NULL OR c.snapshot->'target'->'quote'->'pricing'->'reservedCapacity'='null'::jsonb THEN NULL ELSE jsonb_build_object('id',c.snapshot->'target'->'quote'->'pricing'->'reservedCapacity'->'id','label',c.snapshot->'target'->'quote'->'pricing'->'reservedCapacity'->'label','capacity',c.snapshot->'target'->'quote'->'pricing'->'reservedCapacity'->'capacity') END)
        FROM public.reach_change c JOIN public.subscription_period p ON p.id=c.period_id AND p.business_id=c.business_id
        JOIN LATERAL(SELECT e.position FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='applied' AND e.at<=at_time ORDER BY e.position DESC LIMIT 1) applied ON true
        WHERE c.business_id=tenant AND c.period_id=period AND c.snapshot->>'direction'='expansion'
        AND EXISTS(SELECT 1 FROM public.reach_change_event capture JOIN public.subscription_period delta ON delta.id=(capture.fact->>'periodId')::uuid AND delta.business_id=c.business_id AND delta.action_id=(c.snapshot->>'deltaActionId')::uuid WHERE capture.change_id=c.id AND capture.fact->>'kind'='capture')
        AND NOT EXISTS(WITH RECURSIVE basis AS (
          SELECT c.id,c.snapshot UNION SELECT prior.id,prior.snapshot FROM basis b JOIN public.reach_change prior ON prior.id=(b.snapshot->>'priorChangeId')::uuid AND prior.business_id=tenant AND prior.period_id=period
        ) SELECT 1 FROM basis b JOIN public.subscription_period delta ON delta.action_id=(b.snapshot->>'deltaActionId')::uuid AND delta.business_id=tenant JOIN public.financial_case f ON f.period_id=delta.id AND f.business_id=tenant JOIN LATERAL(SELECT e.detail FROM public.financial_case_event e WHERE e.case_id=f.id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1) effect ON true WHERE effect.detail->>'access'='block_period')
        ORDER BY applied.position DESC LIMIT 1);
    END $$;
    CREATE OR REPLACE FUNCTION public.current_paid_contract(tenant uuid,at_time timestamptz)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE scope record; term record; reach jsonb; BEGIN
      SELECT * INTO scope FROM public.current_paid_scope(tenant,at_time); IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT * INTO term FROM public.subscription_period p WHERE p.id=scope.id AND p.business_id=tenant;
      reach:=public.reach_effective_scope(tenant,scope.id,at_time);
      RETURN jsonb_build_object('periodId',scope.id,'actionId',term.action_id,'changeId',reach->'changeId','start',to_char(term.start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(term."end" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'markets',scope.markets,'discovery',scope.discovery,'automation',scope.automation,
        'offerId',coalesce(reach->'offerId',term.snapshot->'quote'->'selection'->'offerId'),'reservedCapacityId',coalesce(reach->'reservedCapacityId',term.snapshot->'quote'->'selection'->'reservedCapacityId'),'reservedCapacity',CASE WHEN reach IS NOT NULL THEN reach->'reservedCapacity' WHEN term.snapshot->'quote'->'pricing'->'reservedCapacity' IS NULL OR term.snapshot->'quote'->'pricing'->'reservedCapacity'='null'::jsonb THEN NULL ELSE jsonb_build_object('id',term.snapshot->'quote'->'pricing'->'reservedCapacity'->'id','label',term.snapshot->'quote'->'pricing'->'reservedCapacity'->'label','capacity',term.snapshot->'quote'->'pricing'->'reservedCapacity'->'capacity') END);
    END $$;
    REVOKE ALL ON FUNCTION public.reach_effective_scope(uuid,uuid,timestamptz),public.current_paid_contract(uuid,timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.reach_effective_scope(uuid,uuid,timestamptz),public.current_paid_contract(uuid,timestamptz) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.reach_configuration_matches(policy jsonb,review jsonb)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('reach-policy:'||(policy->>'id')||':'||(policy->>'version'),0));
      RETURN NOT EXISTS(SELECT 1 FROM public.reach_change c WHERE c.snapshot->'policy'->>'id'=policy->>'id' AND c.snapshot->'policy'->>'version'=policy->>'version' AND c.snapshot->'policy'<>policy)
        AND NOT EXISTS(SELECT 1 FROM public.subscription_payment a WHERE a.snapshot->'provider'->'review'->>'id'=review->>'id' AND a.snapshot->'provider'->'review'->>'version'=review->>'version' AND a.snapshot->'provider'->'review'<>review);
    END $$;
    CREATE OR REPLACE FUNCTION public.reach_worker_authorized(change uuid,tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN tenant::text=current_setting('app.business_id',true) AND EXISTS(SELECT 1 FROM public.reach_change c WHERE c.id=change AND c.business_id=tenant AND c.id::text=current_setting('app.reach_change',true) AND c.recovery_key::text=current_setting('app.reach_capability',true));
    END $$;
    CREATE OR REPLACE FUNCTION public.payment_reach_stop_requested(action uuid,tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.payment_worker_authorized(action,tenant) THEN RETURN false; END IF;
      RETURN EXISTS(SELECT 1 FROM public.reach_change c JOIN public.reach_change_event e ON e.change_id=c.id AND e.business_id=c.business_id WHERE c.action_id=action AND c.business_id=tenant AND c.snapshot->>'path'='replacement_mandate' AND e.fact->>'kind'='attempt' AND e.fact->>'stage'='stop_old' AND NOT EXISTS(SELECT 1 FROM public.reach_change_event w WHERE w.change_id=c.id AND w.business_id=tenant AND w.fact->>'kind'='withdrawn'));
    END $$;
    CREATE OR REPLACE FUNCTION public.payment_reach_contract(action uuid,tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.payment_worker_authorized(action,tenant) THEN RETURN '[]'::jsonb; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('changeId',c.id,'effectiveAt',c.snapshot->>'effectiveAt','renewalAt',c.snapshot->>'renewalAt','target',c.snapshot->'target','native',n.fact->'native','deltaPaymentId',p.fact->'capture'->>'paymentId') ORDER BY (SELECT min(e.position) FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='approved'))
        FROM public.reach_change c
        JOIN LATERAL(SELECT e.fact FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->'native' IS NOT NULL ORDER BY e.position DESC LIMIT 1) n ON true
        LEFT JOIN LATERAL(SELECT e.fact FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='capture' LIMIT 1) p ON true
        WHERE c.action_id=action AND c.business_id=tenant AND c.snapshot->>'path'='international_native'
        AND EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='approved')),'[]'::jsonb);
    END $$;
    CREATE OR REPLACE FUNCTION public.reach_payment_authorized(action uuid,tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN EXISTS(SELECT 1 FROM public.reach_change c WHERE c.business_id=tenant AND public.reach_worker_authorized(c.id,tenant) AND (c.action_id=action OR c.snapshot->>'deltaActionId'=action::text OR c.snapshot->>'replacementActionId'=action::text));
    END $$;
    CREATE OR REPLACE FUNCTION public.reach_payment_insert(action uuid,tenant uuid,financial jsonb,actor text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN EXISTS(SELECT 1 FROM public.reach_change c WHERE c.business_id=tenant AND public.reach_worker_authorized(c.id,tenant) AND c.actor_id=actor AND EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='approved') AND ((c.snapshot->>'deltaActionId'=action::text AND c.snapshot->'delta'=financial) OR (c.snapshot->>'replacementActionId'=action::text AND c.snapshot->'target'=financial)));
    END $$;
    CREATE OR REPLACE FUNCTION public.reach_current_context(change uuid,tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE c record; BEGIN
      IF NOT public.reach_worker_authorized(change,tenant) THEN RETURN NULL; END IF;
      SELECT * INTO c FROM public.reach_change r WHERE r.id=change AND r.business_id=tenant;
      RETURN jsonb_build_object(
        'action',(SELECT to_jsonb(a) FROM public.subscription_payment a WHERE a.id=c.action_id AND a.business_id=tenant),
        'pricing',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.version) FROM public.subscription_pricing_revision p),'[]'::jsonb),
        'billing',(SELECT public.payment_renewal_context(c.action_id,tenant)) || jsonb_build_object(
          'revisions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.key,r.version) FROM public.tax_rule_revision r WHERE r.rule->>'mode'=CASE WHEN c.snapshot->'target'->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END AND r.rule->>'customerCountry'=c.snapshot->'target'->'quote'->'profile'->'profile'->'address'->>'country' AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.snapshot->'target'->'quote'->'renewal'->'lines') l WHERE l->>'kind'=r.rule->>'productCode')),'[]'::jsonb),
          'decisions',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.version,d.id) FROM public.tax_rule_decision d JOIN public.tax_rule_revision r ON r.id=d.revision_id WHERE r.rule->>'mode'=CASE WHEN c.snapshot->'target'->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END AND r.rule->>'customerCountry'=c.snapshot->'target'->'quote'->'profile'->'profile'->'address'->>'country'),'[]'::jsonb))
      );
    END $$;
    CREATE OR REPLACE FUNCTION public.pending_reach_changes(provider_key text,account_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN QUERY SELECT c.id,c.business_id,c.recovery_key FROM public.reach_change c WHERE c.snapshot->'target'->'provider'->>'key'=provider_key AND c.snapshot->'target'->'provider'->>'account'=account_ref
      AND EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='approved')
      AND NOT EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='applied')
      AND NOT EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='withdrawn')
      ORDER BY (SELECT max(e.position) FROM public.reach_change_event e WHERE e.change_id=c.id),c.id LIMIT 50;
    END $$;
    REVOKE ALL ON FUNCTION public.reach_worker_authorized(uuid,uuid),public.pending_reach_changes(text,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.reach_worker_authorized(uuid,uuid),public.pending_reach_changes(text,text) TO app_runtime;
    REVOKE ALL ON FUNCTION public.reach_payment_authorized(uuid,uuid),public.reach_payment_insert(uuid,uuid,jsonb,text),public.reach_current_context(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.reach_payment_authorized(uuid,uuid),public.reach_payment_insert(uuid,uuid,jsonb,text),public.reach_current_context(uuid,uuid) TO app_runtime;
    REVOKE ALL ON FUNCTION public.payment_reach_contract(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.payment_reach_contract(uuid,uuid) TO app_runtime;
    REVOKE ALL ON FUNCTION public.reach_configuration_matches(jsonb,jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.reach_configuration_matches(jsonb,jsonb) TO app_runtime;
    REVOKE ALL ON FUNCTION public.payment_reach_stop_requested(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.payment_reach_stop_requested(uuid,uuid) TO app_runtime;
    ${
      paused
        ? `DO $$ DECLARE f record; BEGIN
      IF to_regclass('public.reach_change') IS NOT NULL THEN REVOKE ALL PRIVILEGES ON public.reach_change,public.reach_change_event FROM app_runtime; END IF;
      FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[${reachFunctions.map((n) => `'${n}'`).join(",")}]) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime',f.signature); END LOOP;
    END $$;`
        : ""
    }
  `);
}
