import type { Pool, PoolClient } from "pg";

/** Identifier-only recovery capabilities. No actor impersonation or browser session is involved. */
export async function preparePaymentSecurity(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.payment_worker_authorized(action uuid, tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN EXISTS (SELECT 1 FROM public.subscription_payment a WHERE a.id=action AND a.business_id=tenant
      AND a.id::text=current_setting('app.payment_action',true)
      AND a.recovery_key::text=current_setting('app.payment_capability',true)) OR public.reach_payment_authorized(action,tenant); END $$;
    CREATE OR REPLACE FUNCTION public.pending_subscription_payments(provider_key text, account_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN QUERY SELECT a.id,a.business_id,a.recovery_key FROM public.subscription_payment a
      WHERE a.snapshot->'provider'->>'key'=provider_key AND a.snapshot->'provider'->>'account'=account_ref
      AND a.snapshot->'adjustment' IS NULL AND (a.state IN ('pending','checkout','review_required') OR a.reconciliation_pending OR (a.state='confirmed' AND a.snapshot->'provider'->>'key'='razorpay') OR a.lifecycle IS NOT NULL) AND a.started
      ORDER BY coalesce(a.reconciled_at,a.at),a.id LIMIT 50; END $$;
    CREATE OR REPLACE FUNCTION public.subscription_payment_target(provider_key text, account_ref text, operation uuid)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN QUERY SELECT a.id,a.business_id,a.recovery_key FROM public.subscription_payment a
      WHERE a.operation_key=operation AND a.started AND a.snapshot->'provider'->>'key'=provider_key
      AND a.snapshot->'provider'->>'account'=account_ref; END $$;
    REVOKE ALL ON FUNCTION public.payment_worker_authorized(uuid,uuid),public.pending_subscription_payments(text,text),public.subscription_payment_target(text,text,uuid) FROM PUBLIC;
    CREATE OR REPLACE FUNCTION public.subscription_payment_allocated(provider_key text,account_ref text,payment_ref text,action uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN EXISTS(SELECT 1 FROM public.subscription_period p WHERE p.provider=provider_key AND p.account=account_ref AND p.payment_id=payment_ref AND p.action_id<>action);
    END $$;
    REVOKE ALL ON FUNCTION public.subscription_payment_allocated(text,text,text,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.subscription_payment_allocated(text,text,text,uuid) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.current_paid_scope(tenant uuid,at_time timestamptz)
    RETURNS TABLE(id uuid,markets jsonb,discovery jsonb,automation jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT EXISTS(
        SELECT 1 FROM public.membership m WHERE m.business_id=tenant AND m.user_id=current_setting('app.actor_id',true)) AND NOT EXISTS(SELECT 1 FROM public.reach_change r WHERE r.business_id=tenant AND public.reach_worker_authorized(r.id,tenant)) THEN RETURN; END IF;
      RETURN QUERY SELECT p.id,coalesce(r.snapshot->'scope'->'markets',p.snapshot->'quote'->'pricing'->'offer'->'markets'),coalesce(r.snapshot->'scope'->'discovery',p.snapshot->'basis'->'discovery',p.snapshot->'quote'->'initial'->'discovery'),coalesce(r.snapshot->'scope'->'automation',p.snapshot->'basis'->'automation',p.snapshot->'quote'->'initial'->'automation')
      FROM public.subscription_period p JOIN public.subscription_payment a ON a.id=p.action_id AND a.business_id=p.business_id
      LEFT JOIN LATERAL(SELECT c.snapshot FROM public.reach_change c JOIN LATERAL(SELECT e.position FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->>'kind'='applied' AND e.at<=at_time ORDER BY e.position DESC LIMIT 1) applied ON true WHERE c.period_id=p.id AND c.business_id=p.business_id ORDER BY applied.position DESC LIMIT 1) r ON true
      WHERE p.business_id=tenant AND p.snapshot->'adjustment' IS NULL AND p.start<=at_time
      AND NOT EXISTS(SELECT 1 FROM public.reach_change c WHERE c.action_id=p.action_id AND c.business_id=p.business_id AND c.snapshot->>'path'='replacement_mandate' AND p.start>=(c.snapshot->>'renewalAt')::timestamptz AND EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=c.id AND e.fact->'native'->>'oldStopped'='true'))
      AND (p.snapshot->'replacement' IS NULL OR EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=(p.snapshot->'replacement'->>'changeId')::uuid AND e.business_id=tenant AND e.fact->>'kind'='applied' AND e.at<=at_time))
      AND (p.snapshot->'reachRenewal' IS NULL OR EXISTS(SELECT 1 FROM public.reach_change_event e WHERE e.change_id=(p.snapshot->'reachRenewal'->>'changeId')::uuid AND e.business_id=tenant AND e.fact->>'kind'='applied' AND e.at<=at_time))
      AND NOT EXISTS(SELECT 1 FROM public.financial_case c JOIN LATERAL (
        SELECT e.detail FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1
      ) effect ON true WHERE c.period_id=p.id AND c.business_id=p.business_id AND effect.detail->>'access'='block_period')
      AND (p.end>at_time OR (
        a.lifecycle->>'failedThrough'=to_char(p.end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        AND a.lifecycle->'policy'->>'graceAccess'='remaining_allowance'
        AND (a.lifecycle->>'graceEnd')::timestamptz>at_time
        AND (a.lifecycle->'policy'->>'effectiveUntil')::timestamptz>at_time
        AND (a.lifecycle->'policy'->>'effectiveFrom')::timestamptz<=at_time
        AND coalesce(a.lifecycle->'cancellation'->>'status','')<>'confirmed'
        AND coalesce(a.lifecycle->'provider'->>'status','') NOT IN ('cancelled','completed','expired')
      ))
      AND NOT (
        coalesce(a.lifecycle->'cancellation'->>'status','')='confirmed'
        AND a.lifecycle->'cancellation'->>'effectiveEnd' IS NOT NULL
        AND ((a.lifecycle->'cancellation'->>'access'='provider_end' AND at_time >= (a.lifecycle->'cancellation'->>'effectiveEnd')::timestamptz)
          OR (CASE WHEN a.lifecycle->'cancellation'->>'timing'='cycle_end' THEN p.start >= (a.lifecycle->'cancellation'->>'effectiveEnd')::timestamptz ELSE p.start > (a.lifecycle->'cancellation'->>'effectiveEnd')::timestamptz END)
          OR coalesce((p.charge->>'paidAt')::timestamptz > (a.lifecycle->'cancellation'->>'effectiveEnd')::timestamptz,false))
      )
      ORDER BY p.end DESC,p.id LIMIT 1;
    END $$;
    REVOKE ALL ON FUNCTION public.current_paid_scope(uuid,timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.current_paid_scope(uuid,timestamptz) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.payment_event_identity(provider_key text,account_ref text,event_ref text,hash text,action uuid)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous_hash text; previous_action uuid; BEGIN
      SELECT e.payload_hash,e.action_id INTO previous_hash,previous_action FROM public.subscription_payment_event e WHERE e.provider=provider_key AND e.account=account_ref AND e.event_id=event_ref;
      IF NOT FOUND THEN RETURN 'new'; END IF;
      IF previous_hash=hash AND previous_action IS NOT DISTINCT FROM action THEN RETURN 'same'; END IF;
      RETURN 'conflict';
    END $$;
    CREATE OR REPLACE FUNCTION public.capture_unmatched_payment_event(event jsonb,at_time timestamptz)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      INSERT INTO public.subscription_payment_event(id,business_id,action_id,provider,account,event_id,payload_hash,observation,at)
      VALUES(gen_random_uuid(),null,null,event->'observation'->>'provider',event->'observation'->>'account',event->>'eventId',event->>'payloadHash',event->'observation',at_time);
    END $$;
    REVOKE ALL ON FUNCTION public.payment_event_identity(text,text,text,text,uuid),public.capture_unmatched_payment_event(jsonb,timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.payment_event_identity(text,text,text,text,uuid),public.capture_unmatched_payment_event(jsonb,timestamptz) TO app_runtime;
    GRANT EXECUTE ON FUNCTION public.payment_worker_authorized(uuid,uuid),public.pending_subscription_payments(text,text),public.subscription_payment_target(text,text,uuid) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.subscription_payment_reference_target(provider_key text,account_ref text,subscription_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN QUERY SELECT a.id,a.business_id,a.recovery_key FROM public.subscription_payment a
      WHERE a.started AND a.snapshot->'provider'->>'key'=provider_key AND a.snapshot->'provider'->>'account'=account_ref AND a.checkout->>'subscriptionId'=subscription_ref;
    END $$;
    CREATE OR REPLACE FUNCTION public.payment_renewal_context(action uuid,tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE country text; mode text; BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT public.payment_worker_authorized(action,tenant) THEN RETURN NULL; END IF;
      SELECT (SELECT p.profile->'address'->>'country' FROM public.billing_profile_revision p WHERE p.business_id=tenant ORDER BY p.version DESC LIMIT 1), CASE WHEN a.snapshot->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END INTO country,mode FROM public.subscription_payment a WHERE a.id=action AND a.business_id=tenant AND a.started;
      IF NOT FOUND THEN RETURN NULL; END IF;
      RETURN jsonb_build_object(
        'history',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.version) FROM public.billing_profile_revision p WHERE p.business_id=tenant),'[]'::jsonb),
        'reviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.version) FROM public.billing_profile_review r WHERE r.business_id=tenant),'[]'::jsonb),
        'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'state',f.state,'sha256',f.sha256,'retentionUntil',f.retention_until)) FROM public.business_file f WHERE f.business_id=tenant AND EXISTS(SELECT 1 FROM public.billing_profile_revision p, jsonb_array_elements(p.evidence) e WHERE p.business_id=tenant AND e->>'fileId'=f.id::text)),'[]'::jsonb),
        'revisions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.key,r.version) FROM public.tax_rule_revision r WHERE r.rule->>'mode'=mode AND r.rule->>'customerCountry'=country AND EXISTS(SELECT 1 FROM public.subscription_payment a,jsonb_array_elements(a.snapshot->'quote'->'renewal'->'lines') l WHERE a.id=action AND l->>'kind'=r.rule->>'productCode')),'[]'::jsonb),
        'decisions',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.version,d.id) FROM public.tax_rule_decision d JOIN public.tax_rule_revision r ON r.id=d.revision_id WHERE r.rule->>'mode'=mode AND r.rule->>'customerCountry'=country),'[]'::jsonb)
      );
    END $$;
    REVOKE ALL ON FUNCTION public.subscription_payment_reference_target(text,text,text),public.payment_renewal_context(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.subscription_payment_reference_target(text,text,text),public.payment_renewal_context(uuid,uuid) TO app_runtime;
  `);
}
