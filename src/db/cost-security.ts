import type { Pool, PoolClient } from "pg";

/** Only minimal usage/charge observations cross this global operator boundary. */
export async function prepareCostSecurity(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.cost_worker_authorized(cost_month text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN nullif(current_setting('app.business_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM public.operator_cost_budget b JOIN public.platform_operator o ON o.user_id=b.owner_id AND o.costs
        JOIN public."user" u ON u.id=o.user_id AND u.two_factor_enabled AND u.email_verified
        WHERE EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)
        AND b.id::text=current_setting('app.cost_budget',true) AND b.worker_key::text=current_setting('app.cost_capability',true)
        AND b.owner_id=current_setting('app.actor_id',true) AND b.month=cost_month AND b.retain_until>statement_timestamp()
        AND NOT EXISTS(SELECT 1 FROM public.operator_cost_budget newer WHERE newer.month=b.month AND newer.category=b.category AND newer.version>b.version)
      );
    END $$;
    CREATE OR REPLACE FUNCTION public.cost_owner_email(owner_ref text)
    RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.costs)
        THEN RETURN NULL; END IF;
      RETURN (SELECT u.email FROM public."user" u JOIN public.platform_operator o ON o.user_id=u.id
        WHERE u.id=owner_ref AND o.costs AND u.two_factor_enabled AND u.email_verified AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified));
    END $$;
    CREATE OR REPLACE FUNCTION public.cost_attribution_valid(tenant text,run_ref text)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.costs) THEN RETURN false; END IF;
      IF tenant IS NULL THEN RETURN run_ref IS NULL; END IF;
      RETURN EXISTS(SELECT 1 FROM public.business b WHERE b.id::text=tenant)
        AND (run_ref IS NULL OR EXISTS(SELECT 1 FROM public.discovery_run r WHERE r.id::text=run_ref AND r.business_id::text=tenant)
          OR EXISTS(SELECT 1 FROM public.email_sequence_run r WHERE r.id::text=run_ref AND r.business_id::text=tenant));
    END $$;
    CREATE OR REPLACE FUNCTION public.operator_cost_work()
    RETURNS TABLE(budget_id uuid,capability uuid,user_id text,month text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN; END IF;
      RETURN QUERY SELECT b.id,b.worker_key,b.owner_id,b.month FROM public.operator_cost_budget b
        JOIN public.platform_operator o ON o.user_id=b.owner_id AND o.costs
        JOIN public."user" u ON u.id=o.user_id AND u.two_factor_enabled AND u.email_verified
        WHERE EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)
        AND b.retain_until>statement_timestamp() AND NOT EXISTS(SELECT 1 FROM public.operator_cost_budget n
          WHERE n.month=b.month AND n.category=b.category AND n.version>b.version)
        ORDER BY coalesce((SELECT max(s.at) FROM public.operator_cost_scan s WHERE s.month=b.month),b.at),b.id LIMIT 100;
    END $$;
    CREATE OR REPLACE FUNCTION public.cost_claim_alert(alert_ref uuid)
    RETURNS TABLE(id uuid,lease_key uuid,email text,summary text)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE a record; BEGIN
      SELECT * INTO a FROM public.operator_cost_alert c WHERE c.id=alert_ref FOR UPDATE;
      IF NOT FOUND OR nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN; END IF;
      IF (nullif(current_setting('app.cost_budget',true),'') IS NOT NULL AND (NOT public.cost_worker_authorized(a.month) OR a.budget_id::text<>current_setting('app.cost_budget',true)))
        OR (nullif(current_setting('app.cost_budget',true),'') IS NULL AND NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.costs)) THEN RETURN; END IF;
      IF a.email_state NOT IN ('pending','sending','uncertain') OR a.lease_until>statement_timestamp() THEN RETURN; END IF;
      IF a.retain_until<=statement_timestamp() OR (a.first_attempt_at IS NOT NULL AND a.first_attempt_at<=statement_timestamp()-interval '23 hours')
        OR EXISTS(SELECT 1 FROM public.operator_cost_budget b JOIN public.operator_cost_budget n ON n.month=b.month AND n.category=b.category AND n.version>b.version WHERE b.id=a.budget_id)
        OR a.email IS DISTINCT FROM public.cost_owner_email(a.owner_id) THEN
        UPDATE public.operator_cost_alert c SET email_state='held' WHERE c.id=a.id;
        INSERT INTO public.operator_cost_notification_event(id,alert_id,kind,detail,at) VALUES(gen_random_uuid(),a.id,'held','Review recipient authority, retention or expired provider idempotency window',statement_timestamp());
        RETURN;
      END IF;
      UPDATE public.operator_cost_alert c SET email_state='sending',lease_key=gen_random_uuid(),lease_until=statement_timestamp()+interval '2 minutes',first_attempt_at=coalesce(c.first_attempt_at,statement_timestamp()) WHERE c.id=a.id;
      INSERT INTO public.operator_cost_notification_event(id,alert_id,kind,detail,at) VALUES(gen_random_uuid(),a.id,'sending','Same immutable notification identity',statement_timestamp());
      RETURN QUERY SELECT c.id,c.lease_key,c.email,c.summary FROM public.operator_cost_alert c WHERE c.id=a.id;
    END $$;
    CREATE OR REPLACE FUNCTION public.cost_alert_deliverable(alert_ref uuid,lease uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE a record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR NOT EXISTS(
        SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.costs
      ) THEN RETURN false; END IF;
      SELECT * INTO a FROM public.operator_cost_alert c WHERE c.id=alert_ref AND c.lease_key=lease
        AND c.lease_until>statement_timestamp() AND c.email_state='sending' FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      IF a.retain_until<=statement_timestamp() OR a.email IS DISTINCT FROM public.cost_owner_email(a.owner_id)
        OR EXISTS(SELECT 1 FROM public.operator_cost_budget b JOIN public.operator_cost_budget n
          ON n.month=b.month AND n.category=b.category AND n.version>b.version WHERE b.id=a.budget_id)
        OR (nullif(current_setting('app.cost_budget',true),'') IS NOT NULL
          AND (a.budget_id::text<>current_setting('app.cost_budget',true) OR NOT public.cost_worker_authorized(a.month))) THEN
        UPDATE public.operator_cost_alert c SET email_state='held',lease_until=statement_timestamp(),lease_key=NULL WHERE c.id=a.id;
        INSERT INTO public.operator_cost_notification_event(id,alert_id,kind,detail,at)
          VALUES(gen_random_uuid(),a.id,'held','Recipient authority or budget changed before provider I/O',statement_timestamp());
        RETURN false;
      END IF;
      RETURN true;
    END $$;
    CREATE OR REPLACE FUNCTION public.cost_finish_alert(alert_ref uuid,lease uuid,receipt text)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE saved uuid; BEGIN
      IF receipt IS NOT NULL AND (length(receipt)>256 OR receipt !~ '^[a-zA-Z0-9_.:/-]+$') THEN RETURN; END IF;
      UPDATE public.operator_cost_alert a SET email_state=CASE WHEN receipt IS NULL THEN 'uncertain' ELSE 'accepted' END,
        lease_until=statement_timestamp(),lease_key=NULL WHERE a.id=alert_ref AND a.lease_key=lease AND a.email_state='sending' RETURNING a.id INTO saved;
      IF saved IS NOT NULL THEN INSERT INTO public.operator_cost_notification_event(id,alert_id,kind,detail,at)
        VALUES(gen_random_uuid(),saved,CASE WHEN receipt IS NULL THEN 'uncertain' ELSE 'accepted' END,coalesce(receipt,'Provider acceptance is unknown'),statement_timestamp()); END IF;
    END $$;
    REVOKE ALL ON FUNCTION public.cost_worker_authorized(text),public.cost_owner_email(text),public.cost_attribution_valid(text,text),public.operator_cost_work(),public.cost_claim_alert(uuid),public.cost_alert_deliverable(uuid,uuid),public.cost_finish_alert(uuid,uuid,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.cost_worker_authorized(text),public.cost_owner_email(text),public.cost_attribution_valid(text,text),public.operator_cost_work(),public.cost_claim_alert(uuid),public.cost_alert_deliverable(uuid,uuid),public.cost_finish_alert(uuid,uuid,text) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.operator_cost_native(cost_month text)
    RETURNS TABLE(source_id text,kind text,business_id uuid,run_id uuid,at timestamptz,details jsonb)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR NOT ((nullif(current_setting('app.cost_budget',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.costs
      )) OR public.cost_worker_authorized(cost_month)) THEN RETURN; END IF;
      IF cost_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RETURN; END IF;
      RETURN QUERY
        SELECT 'native:ai:'||a.id,'ai',a.business_id,u.run_id,a.at,
          jsonb_build_object('route',a.route,'outcome',a.outcome,'funding',a.funding_source,
            'inputTokens',a.metrics->'inputTokens','outputTokens',a.metrics->'outputTokens',
            'providerCostUsd',a.metrics->'providerCostUsd','gatewayCostUsd',a.metrics->'gatewayCostUsd',
            'model',a.metrics->'model','credentialSource',a.metrics->'credentialSource')
        FROM public.ai_attempt a JOIN public.ai_execution x ON x.id=a.execution_id AND x.business_id=a.business_id
        LEFT JOIN public.discovery_usage u ON u.id=x.request_key AND u.business_id=a.business_id AND u.kind='review'
        WHERE to_char(a.at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:discovery:'||u.id,'discovery',u.business_id,u.run_id,u.at,
          jsonb_build_object('kind',u.kind,'allowanceUnits',u.units,'outcome',u.outcome,'returnedResults',u.returned_results,
            'adapter',CASE WHEN r.policy->'exa' IS NOT NULL THEN 'exa' ELSE r.policy->>'adapterId' END,
            'estimatedUsd',u.provider_cost->'estimatedUsd','requestId',u.provider_cost->'requestId')
        FROM public.discovery_usage u JOIN public.discovery_run r ON r.id=u.run_id AND r.business_id=u.business_id
        WHERE to_char(u.at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:file:'||u.id,'storage',u.business_id,NULL::uuid,u.at,
          jsonb_build_object('action',u.action,'outcome',u.outcome)
        FROM public.file_usage u WHERE to_char(u.at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:mailbox-job:'||j.id,'mailbox_job',j.business_id,NULL::uuid,j.created_at,
          jsonb_build_object('state',j.state->>'phase')
        FROM public.mailbox_job j WHERE to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:native-mail:'||m.id,'native_mail',m.business_id,NULL::uuid,m.at,
          jsonb_build_object('provider',c.provider,'duplicateOf',coalesce(
            (SELECT 'native:opportunity-mail:'||a.id FROM public.opportunity_due_action a WHERE a.business_id=m.business_id
              AND a.email->'result'->'receipt'->>'messageRef'=m.message_ref AND a.email->'envelope'->>'connectionId'=c.connection_id::text LIMIT 1),
            (SELECT 'native:sequence-mail:'||(a.receipt->>'attemptId') FROM public.email_sequence_action a WHERE a.business_id=m.business_id
              AND a.receipt->>'messageRef'=m.message_ref AND a.receipt->>'connectionId'=c.connection_id::text LIMIT 1)))
        FROM public.mailbox_app_message m JOIN public.mailbox_policy c ON c.id=m.mailbox_id AND c.business_id=m.business_id
        WHERE to_char(m.at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:opportunity-mail:'||a.id,'ordinary_mail',a.business_id,NULL::uuid,(a.email->'envelope'->>'reservedAt')::timestamptz,
          jsonb_build_object('provider',a.email->'envelope'->>'adapterKey','mode',a.email->'envelope'->>'adapterMode',
            'outcome',coalesce(a.email->'result'->>'status','uncertain'))
        FROM public.opportunity_due_action a WHERE a.email->'envelope' IS NOT NULL
          AND to_char((a.email->'envelope'->>'reservedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:sequence-mail:'||e.attempt_id,'sequence_mail',e.business_id,e.run_id,e.at,
          jsonb_build_object('provider',e.envelope->>'adapterKey','mode',e.envelope->>'adapterMode','outcome',coalesce(l.kind,'attempt_reserved'))
        FROM public.email_sequence_event e LEFT JOIN LATERAL(
          SELECT n.kind FROM public.email_sequence_event n WHERE n.business_id=e.business_id AND n.attempt_id=e.attempt_id
          AND n.kind IN ('provider_accepted','provider_accepted_identity_pending','not_accepted','acceptance_unknown','dispatch_boundary') ORDER BY n.at DESC,n.id DESC LIMIT 1
        ) l ON true WHERE e.kind='attempt_reserved' AND e.attempt_id IS NOT NULL
        AND to_char(e.at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:meta:'||md5(r.connection_id::text||':'||r.message_ref),'meta',r.business_id,NULL::uuid,min(r.at),
          jsonb_build_object('billable',bool_or((r.status_evidence->'pricing'->>'billable')::boolean),'customerPaid',true)
        FROM public.whatsapp_receipt r WHERE r.kind='status' AND r.message_ref IS NOT NULL
        GROUP BY r.connection_id,r.message_ref,r.business_id HAVING to_char(min(r.at) AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:notification:'||n.id,'transactional',n.business_id,NULL::uuid,n.first_attempt_at,
          jsonb_build_object('provider','resend','purpose',n.purpose,'mode',n.binding->>'mode','outcome',n.state,'acceptanceUncertain',n.uncertain,
            'funding',CASE WHEN n.terms->>'kind' IN ('free','selected_paid') THEN 'existing_subscription' ELSE 'unknown' END,
            'selectedTerms',n.terms->>'reference','termsKind',n.terms->>'kind')
        FROM public.notification_notice n WHERE n.first_attempt_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=n.id AND e.kind='dispatch_boundary')
          AND to_char(n.first_attempt_at AT TIME ZONE 'UTC','YYYY-MM')=cost_month
      UNION ALL
        SELECT 'native:payment:'||p.id,'payment',p.business_id,NULL::uuid,coalesce((p.charge->>'paidAt')::timestamptz,p.start),
          jsonb_build_object('provider',p.provider,'feeMinor',coalesce(e.observation->'charge'->'feeMinor',p.charge->'charge'->'feeMinor'),
            'feeTaxMinor',coalesce(e.observation->'charge'->'feeTaxMinor',p.charge->'charge'->'feeTaxMinor'),
            'baseAmountMinor',coalesce(e.observation->'charge'->'baseAmountMinor',p.charge->'charge'->'baseAmountMinor'),
            'baseCurrency',coalesce(e.observation->'charge'->'baseCurrency',p.charge->'charge'->'baseCurrency'),
            'mode',p.snapshot->'provider'->>'mode')
        FROM public.subscription_period p LEFT JOIN LATERAL(
          SELECT v.observation FROM public.subscription_payment_event v
          WHERE v.provider=p.provider AND v.account=p.account AND v.observation->>'paymentId'=p.payment_id
          AND v.business_id=p.business_id AND v.action_id=p.action_id
          AND v.observation->'charge'->>'invoiceId'=p.charge->'charge'->>'invoiceId'
          AND v.observation->'charge'->>'orderId'=p.charge->'charge'->>'orderId'
          AND v.observation->'charge'->>'planId'=p.charge->'charge'->>'planId'
          AND v.observation->>'subscriptionId'=p.charge->>'subscriptionId'
          AND v.observation->>'customerId'=p.charge->>'customerId'
          AND v.observation->>'periodStart'=p.charge->>'periodStart' AND v.observation->>'periodEnd'=p.charge->>'periodEnd'
          AND v.observation->>'status'='confirmed' AND v.observation->>'currency'=p.charge->>'currency'
          AND v.observation->>'amountMinor'=p.charge->>'amountMinor' AND v.observation->'charge'->>'feeMinor' IS NOT NULL
          ORDER BY v.at DESC,v.id DESC LIMIT 1
        ) e ON true
        WHERE to_char(coalesce((p.charge->>'paidAt')::timestamptz,p.start) AT TIME ZONE 'UTC','YYYY-MM')=cost_month;
    END $$;
    REVOKE ALL ON FUNCTION public.operator_cost_native(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.operator_cost_native(text) TO app_runtime;
  `);
}
