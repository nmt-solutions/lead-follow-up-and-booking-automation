import type { Pool, PoolClient } from "pg";

export async function prepareReconciliationSecurity(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.reconciliation_sources(since timestamptz,until_time timestamptz)
    RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF coalesce(current_setting('app.business_id',true),'')<>'' OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.reconciliation) THEN RETURN NULL; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
        'periodId',p.id,'actionId',p.action_id,'businessId',p.business_id,'businessName',b.name,
        'provider',p.provider,'account',p.account,'mode',p.snapshot->'provider'->>'mode',
        'paymentId',p.payment_id,'nativeInvoiceId',p.charge->'charge'->>'invoiceId','orderId',p.charge->'charge'->>'orderId',
        'subscriptionId',p.charge->>'subscriptionId','kind',coalesce(p.charge->'charge'->>'kind','initial'),
        'customerId',p.charge->>'customerId','quoteId',p.snapshot->'quote'->>'id','taxCalculationId',p.snapshot->'tax'->>'id','start',to_char(p.start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'end',to_char(p.end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'taxLines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l->'input'->>'id','netMinor',l->>'netMinor','taxMinor',l->>'taxMinor','totalMinor',l->>'totalMinor','components',l->'components','ruleId',l->'rule'->'revision'->>'id','approvalId',l->'rule'->'approval'->>'id') ORDER BY ordinal) FROM jsonb_array_elements(p.snapshot->'tax'->'lines') WITH ORDINALITY AS line(l,ordinal)),'[]'::jsonb),
        'paidAt',p.charge->>'paidAt','currency',p.charge->>'currency','precision',2,'totals',p.snapshot->'tax'->'totals',
        'baseAmountMinor',p.charge->'charge'->>'baseAmountMinor','baseCurrency',p.charge->'charge'->>'baseCurrency',
        'feeMinor',p.charge->'charge'->>'feeMinor','feeTaxMinor',p.charge->'charge'->>'feeTaxMinor',
        'feeCurrency',coalesce(p.charge->'charge'->>'baseCurrency',CASE WHEN p.charge->>'currency'='INR' THEN 'INR' ELSE NULL END),
        'invoice',(SELECT jsonb_build_object('id',d.id,'number',d.number,'sha256',d.sha256,'totals',d.snapshot->'totals') FROM public.seller_document d WHERE d.period_id=p.id AND d.business_id=p.business_id AND d.kind='invoice'),
        'credits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'sha256',d.sha256,'totals',d.snapshot->'totals') ORDER BY d.at,d.id) FROM public.seller_document d WHERE d.period_id=p.id AND d.business_id=p.business_id AND d.kind='credit_note'),'[]'::jsonb),
        'effects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'caseId',c.id,'source',e.detail->>'source','nativeId',e.detail->>'nativeId','actualMinor',e.detail->>'actualMinor','currency',e.detail->>'currency','at',to_char(e.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'allocation',e.detail->'allocation','originalTax',e.detail->'originalTax','approvedCredit',(SELECT x.detail->'review' FROM public.financial_case_event x WHERE x.case_id=c.id AND x.kind='credit_review' ORDER BY x.position DESC LIMIT 1),'creditDocumentId',(SELECT x.detail->>'documentId' FROM public.financial_case_event x WHERE x.case_id=c.id AND x.kind='credit' ORDER BY x.position DESC LIMIT 1)) ORDER BY e.position) FROM public.financial_case c JOIN public.financial_case_event e ON e.case_id=c.id AND e.business_id=c.business_id WHERE c.period_id=p.id AND c.business_id=p.business_id AND e.kind='financial_effect'),'[]'::jsonb),
        'pendingCases',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'status',coalesce((SELECT e.detail->'observation'->>'status' FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='observation' ORDER BY e.position DESC LIMIT 1),'reviewed')) ORDER BY c.position,c.id) FROM public.financial_case c WHERE c.period_id=p.id AND c.business_id=p.business_id AND NOT EXISTS(SELECT 1 FROM public.financial_case_event e WHERE e.case_id=c.id AND e.kind='financial_effect')),'[]'::jsonb)
      ) ORDER BY p.charge->>'paidAt',p.id) FROM public.subscription_period p JOIN public.business b ON b.id=p.business_id
      WHERE p.charge->>'status'='confirmed' AND (p.charge->>'paidAt')::timestamptz>=since AND (p.charge->>'paidAt')::timestamptz<until_time),'[]'::jsonb);
    END $$;
    REVOKE ALL ON FUNCTION public.reconciliation_sources(timestamptz,timestamptz) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.reconciliation_sources(timestamptz,timestamptz) TO app_runtime;
  `);
}

export async function verifyReconciliationRuntime(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(`
    SELECT
    (SELECT count(*)=4 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER')
      AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
      AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('reconciliation_evidence','reconciliation_record','reconciliation_review','reconciliation_access'))
    AND (SELECT count(*)=8 AND bool_and('app_runtime'=ANY(roles) AND CASE WHEN policyname LIKE '%_read' THEN qual LIKE '%app.business_id%' AND qual LIKE '%reconciliation%' AND qual LIKE '%app.actor_id%' ELSE with_check LIKE '%app.business_id%' AND with_check LIKE '%reconciliation%' AND with_check LIKE '%app.actor_id%' END) FROM pg_policies WHERE schemaname='public' AND tablename IN ('reconciliation_evidence','reconciliation_record','reconciliation_review','reconciliation_access') AND roles=ARRAY['app_runtime']::name[])
    AND (SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reconciliation_sources')
    AND (SELECT count(*)=1 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND NOT has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='protect_reconciliation_record')
    AND (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN ('reconciliation_record_binding_guard','reconciliation_access_time_guard') AND tgenabled='O')
    AND NOT has_column_privilege(current_user,'public.platform_operator','reconciliation','UPDATE') AS safe
  `);
  if (result.rows[0]?.safe !== true)
    throw Error("Reconciliation database security is incomplete");
}

export async function secureReconciliationRecords(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.protect_reconciliation_record()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE l jsonb; p public.subscription_period; effect jsonb; predecessor uuid; BEGIN
      IF coalesce(current_setting('app.business_id',true),'')<>'' OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.reconciliation) THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF TG_TABLE_NAME='reconciliation_access' THEN NEW.at:=statement_timestamp(); NEW.expires_at:=statement_timestamp()+interval '60 seconds'; RETURN NEW; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('reconciliation',0));
      IF coalesce(current_setting('app.business_id',true),'')<>'' OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.reconciliation) THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF NOT coalesce(NEW.data->'money'->>'currency' IN ('INR','USD') AND NEW.data->'money'->>'precision'='2',false) THEN RAISE EXCEPTION 'invalid settlement units'; END IF;
      NEW.identity:=CASE WHEN NEW.data->>'kind'='settlement' THEN jsonb_build_array('settlement',NEW.data->>'provider',NEW.data->>'account',NEW.data->>'mode',NEW.data->>'settlementId')::text ELSE jsonb_build_array('bank_receipt',NEW.data->>'bankAccountRef',NEW.data->>'bankTransactionId')::text END;
      IF NOT EXISTS(SELECT 1 FROM public.reconciliation_evidence e WHERE e.id=NEW.evidence_id AND e.source=CASE WHEN NEW.data->>'kind'='settlement' THEN 'provider_statement' ELSE 'bank_statement' END) THEN RAISE EXCEPTION 'invalid evidence'; END IF;
      FOR predecessor IN SELECT NEW.supersedes WHERE NEW.supersedes IS NOT NULL UNION ALL SELECT value::uuid FROM jsonb_array_elements_text(NEW.data->'supersedesAlso') LOOP
        IF NOT EXISTS(SELECT 1 FROM public.reconciliation_record r WHERE r.id=predecessor AND r.identity=NEW.identity) OR EXISTS(SELECT 1 FROM public.reconciliation_record r WHERE r.supersedes=predecessor OR r.data->'supersedesAlso' ? predecessor::text) THEN RAISE EXCEPTION 'invalid correction'; END IF;
      END LOOP;
      IF NEW.data->>'kind'='settlement' THEN
        FOR l IN SELECT value FROM jsonb_array_elements(NEW.data->'lines') LOOP
          IF l->>'conversion' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.reconciliation_evidence e WHERE e.id=(l->'conversion'->>'evidenceId')::uuid AND e.source='conversion_confirmation') THEN RAISE EXCEPTION 'invalid conversion evidence'; END IF;
          IF l->>'kind'='unclassified' THEN
            IF l->>'sourceId' IS NOT NULL OR l->>'businessId' IS NOT NULL OR l->>'paymentId' IS NOT NULL OR l->>'original' IS NOT NULL OR l->>'nativeInvoiceId' IS NOT NULL OR l->>'orderId' IS NOT NULL THEN RAISE EXCEPTION 'invalid unclassified binding'; END IF;
          ELSE
            IF l->>'kind'='capture' THEN SELECT * INTO p FROM public.subscription_period s WHERE s.id=(l->>'sourceId')::uuid; effect:=NULL;
            ELSE
              SELECT e.detail INTO effect FROM public.financial_case_event e WHERE e.id=(l->>'sourceId')::uuid AND e.kind='financial_effect' AND e.detail->>'source'=l->>'kind';
              SELECT * INTO p FROM public.subscription_period s WHERE s.id=(effect->>'periodId')::uuid;
            END IF;
            IF NOT coalesce(p.id IS NOT NULL AND p.business_id::text=l->>'businessId' AND p.provider=NEW.data->>'provider' AND p.account=NEW.data->>'account'
              AND p.snapshot->'provider'->>'mode'=NEW.data->>'mode' AND p.payment_id=l->>'paymentId' AND p.charge->'charge'->>'orderId'=l->>'orderId'
              AND (p.charge->'charge'->>'invoiceId') IS NOT DISTINCT FROM l->>'nativeInvoiceId' AND p.charge->>'status'='confirmed'
              AND l->'original'->>'precision'='2' AND l->'original'->>'currency'=p.charge->>'currency' AND l->'original'->>'minor'=CASE WHEN l->>'kind'='capture' THEN p.snapshot->'tax'->'totals'->>'totalMinor' ELSE effect->>'actualMinor' END
              AND l->>'nativeId'=CASE WHEN l->>'kind'='capture' THEN p.payment_id ELSE effect->>'nativeId' END,false) THEN RAISE EXCEPTION 'invalid original source'; END IF;
          END IF;
        END LOOP;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.protect_reconciliation_record() FROM PUBLIC,app_runtime;
    DROP TRIGGER IF EXISTS reconciliation_record_binding_guard ON public.reconciliation_record;
    CREATE TRIGGER reconciliation_record_binding_guard BEFORE INSERT ON public.reconciliation_record FOR EACH ROW EXECUTE FUNCTION public.protect_reconciliation_record();
    DROP TRIGGER IF EXISTS reconciliation_access_time_guard ON public.reconciliation_access;
    CREATE TRIGGER reconciliation_access_time_guard BEFORE INSERT ON public.reconciliation_access FOR EACH ROW EXECUTE FUNCTION public.protect_reconciliation_record();
  `);
}
