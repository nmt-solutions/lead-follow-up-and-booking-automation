import type { Pool } from "pg";

/** Identifier-only recovery capabilities. No actor impersonation or browser session is involved. */
export async function preparePaymentSecurity(pool: Pool) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.payment_worker_authorized(action uuid, tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN EXISTS (SELECT 1 FROM public.subscription_payment a WHERE a.id=action AND a.business_id=tenant
      AND a.id::text=current_setting('app.payment_action',true)
      AND a.recovery_key::text=current_setting('app.payment_capability',true)); END $$;
    CREATE OR REPLACE FUNCTION public.pending_subscription_payments(provider_key text, account_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    BEGIN RETURN QUERY SELECT a.id,a.business_id,a.recovery_key FROM public.subscription_payment a
      WHERE a.snapshot->'provider'->>'key'=provider_key AND a.snapshot->'provider'->>'account'=account_ref
      AND (a.state IN ('pending','checkout','review_required') OR a.reconciliation_pending) AND a.started
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
        SELECT 1 FROM public.membership m WHERE m.business_id=tenant AND m.user_id=current_setting('app.actor_id',true)) THEN RETURN; END IF;
      RETURN QUERY SELECT p.id,p.snapshot->'quote'->'pricing'->'offer'->'markets',p.snapshot->'quote'->'initial'->'discovery',p.snapshot->'quote'->'initial'->'automation'
      FROM public.subscription_period p WHERE p.business_id=tenant AND p.start<=at_time AND p.end>at_time ORDER BY p.end,p.id LIMIT 1;
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
  `);
}
