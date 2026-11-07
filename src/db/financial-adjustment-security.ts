import type { Pool, PoolClient } from "pg";

export async function prepareFinancialSecurity(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.financial_worker_authorized(target uuid,tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN tenant::text IS NOT DISTINCT FROM current_setting('app.business_id',true) AND EXISTS(
        SELECT 1 FROM public.financial_case c WHERE c.id=target AND c.business_id=tenant
        AND c.id::text=current_setting('app.financial_case',true) AND c.recovery_key::text=current_setting('app.financial_capability',true));
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_pending(account_ref text,mode_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN QUERY SELECT c.id,c.business_id,c.recovery_key FROM public.financial_case c
      WHERE c.intent->'period'->'snapshot'->'provider'->>'account'=account_ref AND c.intent->'period'->'snapshot'->'provider'->>'mode'=mode_ref
      AND (c.kind='dispute' OR EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='started' AND e.position>coalesce((SELECT max(n.position) FROM public.financial_case_event n WHERE n.case_id=c.id AND n.kind='not_attempted'),0)))
      AND (NOT EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' AND e.detail->'observation'->>'status' IN ('processed','failed','won','lost','closed'))
        OR EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='dispute_action' AND NOT EXISTS(SELECT 1 FROM public.financial_case_event r WHERE r.case_id=c.id AND r.key IN ('resolved:'||(e.detail->'command'->'input'->>'requestKey'),'unattempted:'||(e.detail->'command'->'input'->>'requestKey')))))
      ORDER BY (SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id) NULLS FIRST,c.id LIMIT 50;
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_reserved(invoice uuid,except_case uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.seller_document d WHERE d.id=invoice AND d.business_id::text=current_setting('app.business_id',true)) THEN RETURN true; END IF;
      RETURN EXISTS(SELECT 1 FROM public.financial_case c WHERE c.invoice_id=invoice AND c.id IS DISTINCT FROM except_case
      AND c.position<coalesce((SELECT x.position FROM public.financial_case x WHERE x.id=except_case),9223372036854775807)
      AND NOT EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND (e.kind IN ('credit','withdrawn') OR (e.kind='observation' AND e.detail->'observation'->>'status' IN ('failed','won','closed')))));
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_public(tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT coalesce(public.current_business_role() IN ('owner','admin'),false) THEN RETURN NULL; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'businessId',c.business_id,'periodId',c.period_id,'invoiceId',c.invoice_id,
        'invoiceNumber',c.intent->'invoice'->>'number','paymentId',c.intent->'period'->>'paymentId','kind',c.kind,'currency',c.intent->'invoice'->'snapshot'->>'currency',
        'amountMinor',c.intent->'allocation'->'totals'->>'totalMinor','state',coalesce(o.detail->'observation'->>'status',CASE WHEN EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='withdrawn') THEN 'withdrawn' WHEN coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='started'),0)>coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='not_attempted'),0) THEN 'unknown' ELSE 'reviewed' END),
        'started',coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='started'),0)>coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='not_attempted'),0),
        'observation',o.detail->'observation','access',coalesce(o.detail->>'access','preserve'),
        'reviewRequired',coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='review_issue'),0)>coalesce((SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='review_resolved'),0),
        'creditDocumentId',(SELECT e.detail->>'documentId' FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='credit' LIMIT 1),
        'creditAmountMinor',coalesce(b.review->'allocation'->'totals'->>'totalMinor',c.intent->'allocation'->'totals'->>'totalMinor'),
        'creditState',CASE WHEN EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='credit') THEN 'issued' WHEN o.detail->'observation'->>'status'='processed' THEN 'pending' WHEN o.detail->'observation'->>'status'='lost' THEN CASE WHEN c.intent->'policy'->>'disputeLostCredit'='false' THEN 'not_required' WHEN b.review IS NOT NULL OR o.detail->'observation'->>'deductedMinor'=c.intent->'allocation'->'totals'->>'totalMinor' THEN 'pending' ELSE 'review_required' END ELSE 'not_applicable' END,
        'at',to_char(c.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'actions',coalesce((SELECT jsonb_agg(jsonb_build_object('requestKey',e.detail->'command'->'input'->>'requestKey','action',e.detail->'command'->'input'->>'action','state',CASE WHEN EXISTS(SELECT 1 FROM public.financial_case_event r WHERE r.case_id=c.id AND r.key='resolved:'||(e.detail->'command'->'input'->>'requestKey')) THEN 'confirmed' WHEN EXISTS(SELECT 1 FROM public.financial_case_event r WHERE r.case_id=c.id AND r.key='unattempted:'||(e.detail->'command'->'input'->>'requestKey')) THEN 'not_attempted' ELSE 'unknown' END) ORDER BY e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='dispute_action'),'[]'::jsonb),
        'notices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'channel','in_app','status','available','message',e.detail->>'message','at',to_char(e.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY e.position) FROM public.financial_case_event e WHERE e.case_id=c.id AND e.detail->>'message' IS NOT NULL),'[]'::jsonb)
      ) ORDER BY c.at,c.id) FROM public.financial_case c LEFT JOIN LATERAL (SELECT e.detail FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1) o ON true LEFT JOIN LATERAL (SELECT e.detail->'review' as review FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='credit_review' ORDER BY e.position DESC LIMIT 1) b ON true WHERE c.business_id=tenant),'[]'::jsonb);
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_adjustments_feed()
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND (o.reconciliation OR o.tax)) THEN RETURN NULL; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'caseId',c.id,'businessId',c.business_id,'at',e.at,'effect',e.detail,
        'approvedCredit',(SELECT jsonb_build_object('reviewId',x.id,'allocation',x.detail->'review'->'allocation','actualMinor',x.detail->'review'->>'actualMinor','uncreditedDifferenceMinor',x.detail->'review'->>'uncreditedDifferenceMinor','actorId',x.actor_id,'at',x.at) FROM public.financial_case_event x WHERE x.case_id=c.id AND x.kind='credit_review' ORDER BY x.position DESC LIMIT 1),
        'creditDocumentId',(SELECT x.detail->>'documentId' FROM public.financial_case_event x WHERE x.case_id=c.id AND x.kind='credit' LIMIT 1)) ORDER BY e.position)
        FROM public.financial_case_event e JOIN public.financial_case c ON c.id=e.case_id AND c.business_id=e.business_id WHERE e.kind='financial_effect'),'[]'::jsonb);
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_capture_receipt(input jsonb)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous jsonb; BEGIN
      IF NOT coalesce(jsonb_typeof(input)='object' AND input->>'kind' IN ('refund','dispute') AND input->>'payloadHash' ~ '^[a-f0-9]{64}$'
        AND input->>'eventId' ~ '^[A-Za-z0-9_-]{1,200}$' AND input->>'mode' IN ('test','live') AND length(input->>'account') BETWEEN 1 AND 200
        AND input->>'paymentId' ~ '^pay_[A-Za-z0-9]+$' AND ((input->>'kind'='refund' AND input->>'nativeId' ~ '^rfnd_[A-Za-z0-9]+$') OR (input->>'kind'='dispute' AND input->>'nativeId' ~ '^disp_[A-Za-z0-9]+$'))
        AND input->>'eventName' IN ('refund.created','refund.processed','refund.failed','payment.dispute.created','payment.dispute.under_review','payment.dispute.action_required','payment.dispute.won','payment.dispute.lost','payment.dispute.closed'),false) THEN RAISE EXCEPTION 'invalid'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('financial-receipt:'||(input->>'account')||':'||(input->>'eventId'),0));
      SELECT r.receipt INTO previous FROM public.financial_receipt r WHERE r.account=input->>'account' AND r.mode=input->>'mode' AND r.event_id=input->>'eventId';
      IF FOUND THEN IF previous=input THEN RETURN 'same'; ELSE RETURN 'conflict'; END IF; END IF;
      INSERT INTO public.financial_receipt(id,account,mode,event_id,receipt) VALUES(gen_random_uuid(),input->>'account',input->>'mode',input->>'eventId',input);
      RETURN 'new';
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_receipt_work(account_ref text,mode_ref text)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid,receipt_id uuid,event_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN QUERY SELECT c.id,c.business_id,c.recovery_key,r.id,r.receipt->>'eventName' FROM public.financial_receipt r JOIN public.financial_case c
      ON c.intent->'period'->'snapshot'->'provider'->>'account'=r.account AND c.intent->'period'->'snapshot'->'provider'->>'mode'=r.mode
      AND c.intent->'period'->>'paymentId'=r.receipt->>'paymentId' AND c.kind=r.receipt->>'kind'
      AND ((c.kind='dispute' AND c.native_dispute_id=r.receipt->>'nativeId') OR (c.kind='refund' AND (c.id::text=r.receipt->>'caseRef' OR EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' AND e.detail->'observation'->>'nativeId'=r.receipt->>'nativeId'))))
      WHERE r.account=account_ref AND r.mode=mode_ref AND NOT EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.key='receipt:'||r.id::text)
      ORDER BY (SELECT max(e.position) FROM public.financial_case_event e WHERE e.case_id=c.id) NULLS FIRST,r.at,r.id LIMIT 50;
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_refunded(target uuid,tenant uuid)
    RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.financial_worker_authorized(target,tenant) THEN RETURN NULL; END IF;
      RETURN (SELECT coalesce(sum((c.intent->'allocation'->'totals'->>'totalMinor')::numeric),0) FROM public.financial_case c
        WHERE c.business_id=tenant AND c.id<>target AND c.kind='refund'
        AND c.invoice_id=(SELECT x.invoice_id FROM public.financial_case x WHERE x.id=target AND x.business_id=tenant)
        AND EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' AND e.detail->'observation'->>'status'='processed'));
    END $$;
    CREATE OR REPLACE FUNCTION public.financial_credit_allowed(input jsonb)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE original record; outcome jsonb; basis jsonb; BEGIN
      IF NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.documents) THEN RETURN false; END IF;
      SELECT c.* INTO original FROM public.financial_case c WHERE c.id=(input->>'adjustmentId')::uuid AND c.business_id::text=current_setting('app.business_id',true);
      IF NOT FOUND THEN RETURN true; END IF;
      SELECT e.detail->'observation' INTO outcome FROM public.financial_case_event e WHERE e.case_id=original.id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1;
      SELECT e.detail->'review' INTO basis FROM public.financial_case_event e WHERE e.case_id=original.id AND e.kind='credit_review' ORDER BY e.position DESC LIMIT 1;
      RETURN coalesce(outcome IS NOT NULL AND input->>'invoiceId'=original.invoice_id::text AND input->>'periodId'=original.period_id::text
        AND input->>'paymentId'=original.intent->'period'->>'paymentId' AND input->>'requestKey'=original.intent->>'key'
        AND input->'lines'=coalesce(basis->'input'->'lines',original.intent->'input'->'lines') AND input->'source'->>'kind'=original.kind AND input->'source'->>'reference'=outcome->>'nativeId'
        AND input->>'reason'='Provider-confirmed '||original.kind||' adjustment' AND input->'evidence'=jsonb_build_array('razorpay:'||(outcome->>'nativeId'))
        AND (basis IS NULL OR ((basis->'allocation'->'totals'->>'totalMinor')::numeric>0 AND (basis->'allocation'->'totals'->>'totalMinor')::numeric<=(CASE WHEN outcome->>'status'='processed' THEN outcome->>'amountMinor' ELSE outcome->>'deductedMinor' END)::numeric AND basis->>'actualMinor'=CASE WHEN outcome->>'status'='processed' THEN outcome->>'amountMinor' ELSE outcome->>'deductedMinor' END))
        AND (outcome->>'status'='processed' OR (outcome->>'status'='lost' AND original.intent->'policy'->>'disputeLostCredit'='true' AND ((basis IS NOT NULL AND basis->>'actualMinor'=outcome->>'deductedMinor') OR outcome->>'deductedMinor'=original.intent->'allocation'->'totals'->>'totalMinor'))),false);
    END $$;
    REVOKE ALL ON FUNCTION public.financial_credit_allowed(jsonb),public.financial_capture_receipt(jsonb),public.financial_receipt_work(text,text),public.financial_adjustments_feed(),public.financial_refunded(uuid,uuid),public.financial_worker_authorized(uuid,uuid),public.financial_pending(text,text),public.financial_reserved(uuid,uuid),public.financial_public(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.financial_credit_allowed(jsonb),public.financial_capture_receipt(jsonb),public.financial_receipt_work(text,text),public.financial_adjustments_feed(),public.financial_refunded(uuid,uuid),public.financial_worker_authorized(uuid,uuid),public.financial_pending(text,text),public.financial_reserved(uuid,uuid),public.financial_public(uuid) TO app_runtime;
  `);
}
