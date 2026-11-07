import type { Pool, PoolClient } from "pg";

export const notificationTables = [
  "notification_preference",
  "notification_terms",
  "notification_setup",
  "notification_notice",
  "notification_payload",
  "notification_event",
  "notification_receipt",
];
export const notificationFunctions = [
  "notification_sync_costs",
  "notification_preference_current",
  "notification_preferences",
  "notification_set_preference",
  "notification_candidates",
  "notification_begin_maintenance_setup",
  "notification_operator",
  "notification_source",
  "notification_select_terms",
  "notification_begin_setup",
  "notification_save_setup",
  "notification_enqueue",
  "notification_claim",
  "notification_gate",
  "notification_outcome",
  "notification_finish",
  "notification_work",
  "notification_workspace",
  "notification_prune",
  "notification_receive",
  "notification_retry",
];

/** Trusted time and per-notice capabilities are enforced again inside SQL. */
export async function prepareNotificationSecurity(pool: Pool | PoolClient) {
  const ddl = `
    CREATE OR REPLACE FUNCTION public.notification_operator() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN nullif(current_setting('app.business_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.notifications);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_source(purpose text,source_ref text,authority text,actor text,tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE v record; p record; e record; current_event record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL AND tenant::text IS DISTINCT FROM current_setting('app.business_id',true) THEN RETURN NULL; END IF;
      IF purpose='authentication' AND tenant IS NULL THEN
        SELECT * INTO v FROM public.verification x WHERE x.identifier=authority AND x.identifier LIKE 'magic-link:%'
          AND x.expires_at>statement_timestamp() AND x.value::jsonb->>'type'='magic-link' LIMIT 1;
        IF FOUND THEN RETURN jsonb_build_object('expiresAt',least(v.expires_at,statement_timestamp()+interval '600 seconds'),
          'recipientDigest',md5(lower(v.value::jsonb->>'email')),'userId',(SELECT u.id FROM public."user" u WHERE lower(u.email)=lower(v.value::jsonb->>'email'))); END IF;
      END IF;
      IF purpose='invitation' THEN
        SELECT i.* INTO v FROM public.invitation i JOIN public.membership m ON m.business_id=i.business_id AND m.user_id=i.created_by
          WHERE i.id::text=source_ref AND i.business_id=tenant AND i.created_by=actor AND authority=i.id::text||':'||i.token_hash
            AND i.status='pending' AND i.expires_at>statement_timestamp() AND i.created_at>statement_timestamp()-interval '24 hours'
            AND (m.role='owner' OR m.role='admin' AND i.role='salesperson')
            AND EXISTS(SELECT 1 FROM public."user" u WHERE u.id=i.created_by AND u.email_verified AND u.two_factor_enabled AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified));
        IF FOUND THEN RETURN jsonb_build_object('expiresAt',least(v.expires_at,v.created_at+interval '24 hours'),
          'email',v.email,'businessName',v.business_name,'role',v.role,'invitationExpiresAt',v.expires_at); END IF;
      END IF;
      IF purpose='cost_alert' AND tenant IS NULL THEN
        SELECT a.* INTO v FROM public.operator_cost_alert a JOIN public.platform_operator o ON o.user_id=a.owner_id AND o.costs
          JOIN public."user" u ON u.id=a.owner_id AND u.email_verified AND u.two_factor_enabled AND u.email=a.email
          WHERE a.id::text=source_ref AND a.lease_key::text=authority AND a.email_state='sending' AND a.lease_until>statement_timestamp()
            AND a.retain_until>statement_timestamp() AND a.first_attempt_at>statement_timestamp()-interval '23 hours'
            AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=a.owner_id AND f.verified)
            AND NOT EXISTS(SELECT 1 FROM public.operator_cost_budget b JOIN public.operator_cost_budget newer ON newer.month=b.month AND newer.category=b.category AND newer.version>b.version WHERE b.id=a.budget_id);
        IF FOUND THEN RETURN jsonb_build_object('expiresAt',least(v.retain_until,v.first_attempt_at+interval '23 hours'),'email',v.email,'summary',v.summary,'userId',v.owner_id); END IF;
      END IF;
      IF purpose IN ('operations','subscription') THEN
        SELECT * INTO p FROM public.notification_preference x WHERE x.id::text=split_part(authority,':',1) AND x.actor_id=actor AND x.business_id IS NOT DISTINCT FROM tenant AND x.purpose=notification_source.purpose;
        IF NOT FOUND OR NOT public.notification_preference_current(p.id) THEN RETURN NULL; END IF;
        IF purpose='operations' THEN
          SELECT * INTO e FROM public.operation_event x WHERE x.id::text=split_part(authority,':',2) AND (tenant IS NULL OR x.business_id=tenant);
          IF NOT FOUND OR source_ref<>(e.id::text||':'||p.actor_id||':'||(CASE WHEN tenant IS NULL THEN 'operator' ELSE 'business' END)) THEN RETURN NULL; END IF;
          SELECT * INTO current_event FROM public.operation_event x WHERE x.business_id=e.business_id AND x.source=e.source AND x.target_id=e.target_id AND x.outcome='observed' ORDER BY x.position DESC LIMIT 1;
          IF NOT FOUND OR current_event.id::text<>split_part(authority,':',3) THEN RETURN NULL; END IF;
          IF tenant IS NULL AND e.source<>'sender_health' AND NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=p.actor_id AND o.operations) THEN RETURN NULL; END IF;
          IF EXISTS(SELECT 1 FROM public.operation_event a WHERE a.business_id=e.business_id AND a.outcome='acknowledged' AND a.snapshot->'context'->>'notificationId'=e.id::text AND a.snapshot->'context'->>'notificationAudience'=CASE WHEN tenant IS NULL THEN 'operator' ELSE 'business' END) THEN RETURN NULL; END IF;
          IF e.source='sender_health' AND EXISTS(SELECT 1 FROM public.sender_health_record r WHERE r.business_id=e.business_id AND r.kind='repair' AND r.payload->>'incidentId'=coalesce(e.snapshot->'context'->>'incidentId',e.target_id::text)) THEN RETURN NULL; END IF;
          IF tenant IS NOT NULL AND NOT (e.source='sender_health' AND EXISTS(SELECT 1 FROM public.membership m WHERE m.business_id=tenant AND m.user_id=p.actor_id AND m.role IN ('owner','admin'))) AND coalesce((SELECT o.owner_id FROM public.inbox_opportunity o WHERE o.id=(e.snapshot->>'opportunityId')::uuid AND o.business_id=e.business_id),e.snapshot->>'responsibleUserId') IS DISTINCT FROM p.actor_id THEN RETURN NULL; END IF;
          RETURN jsonb_build_object('expiresAt',statement_timestamp()+interval '23 hours','email',(SELECT u.email FROM public."user" u WHERE u.id=p.actor_id),'userId',p.actor_id,'healthOnly',tenant IS NULL AND e.source='sender_health' AND NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=p.actor_id AND o.operations),'snapshot',e.snapshot,'currentSnapshot',current_event.snapshot,'outcome',e.outcome,'sourceStage',CASE WHEN e.outcome='escalated' THEN 'escalated' ELSE e.snapshot->>'status' END);
        END IF;
        IF tenant IS NOT NULL THEN
          SELECT x.*,c.kind AS financial_kind INTO e FROM public.financial_case_event x JOIN public.financial_case c ON c.id=x.case_id AND c.business_id=x.business_id
            WHERE x.id::text=split_part(authority,':',2) AND x.business_id=tenant AND x.detail->>'message' IS NOT NULL;
          IF FOUND THEN
            IF source_ref<>(e.id::text||':'||p.actor_id||':business') OR NOT EXISTS(SELECT 1 FROM public.financial_case_event fresh WHERE fresh.id=e.id AND fresh.position=(SELECT max(latest.position) FROM public.financial_case_event latest WHERE latest.case_id=e.case_id AND latest.detail->>'message' IS NOT NULL)) THEN RETURN NULL; END IF;
            RETURN jsonb_build_object('expiresAt',statement_timestamp()+interval '23 hours','email',(SELECT u.email FROM public."user" u WHERE u.id=p.actor_id),'userId',p.actor_id,'financial',true,'sourceStage','financial_'||CASE WHEN e.kind='observation' THEN e.financial_kind||'_'||(e.detail->'observation'->>'status') ELSE e.kind END);
          END IF;
        END IF;
        SELECT * INTO e FROM public.subscription_lifecycle_event x WHERE x.id::text=split_part(authority,':',2) AND x.notice IS NOT NULL AND (tenant IS NULL OR x.business_id=tenant);
        IF NOT FOUND OR source_ref<>(e.id::text||':'||p.actor_id||':'||(CASE WHEN tenant IS NULL THEN 'operator' ELSE 'business' END)) THEN RETURN NULL; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.subscription_payment a WHERE a.id=e.action_id AND a.business_id=e.business_id AND ((a.lifecycle-'evaluatedAt') #- '{provider,observedAt}')=((e.lifecycle-'evaluatedAt') #- '{provider,observedAt}')) THEN RETURN NULL; END IF;
        RETURN jsonb_build_object('expiresAt',statement_timestamp()+interval '23 hours','email',(SELECT u.email FROM public."user" u WHERE u.id=p.actor_id),'userId',p.actor_id,'sourceStage',e.notice->>'kind');
      END IF;
      RETURN NULL;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_select_terms(account_ref text,selected jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.notification_operator() THEN RAISE EXCEPTION 'forbidden'; END IF;
      IF selected->>'kind' NOT IN ('free','selected_paid') OR length(selected->>'reference') NOT BETWEEN 1 AND 240
        OR (selected->>'monthlyLimit')::bigint<1 OR (selected->>'dailyLimit')::bigint<1
        OR (selected->>'kind'='free' AND ((selected->>'monthlyLimit')::bigint>3000 OR selected->>'dailyLimit' IS NULL OR (selected->>'dailyLimit')::bigint>100 OR selected->>'amount' IS NOT NULL))
        OR (selected->>'kind'='selected_paid' AND selected->>'amount' IS NULL) THEN RAISE EXCEPTION 'invalid terms'; END IF;
      INSERT INTO public.notification_terms(id,account,terms,actor_id) VALUES(gen_random_uuid(),account_ref,selected,current_setting('app.actor_id',true));
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_begin_setup(account_ref text,deployment jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE s record; BEGIN
      IF NOT public.notification_operator() THEN RETURN NULL; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification:'||account_ref,0));
      IF EXISTS(SELECT 1 FROM public.notification_notice n WHERE n.account=account_ref AND n.state='sending' AND n.lease_until>statement_timestamp()) OR EXISTS(SELECT 1 FROM public.notification_setup x WHERE x.account=account_ref AND x.setup IS NULL AND x.at>statement_timestamp()-interval '30 seconds') THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM public.notification_setup x WHERE x.account=account_ref AND x.setup IS NOT NULL AND x.at+make_interval(secs=>coalesce((x.setup->>'retryAfterSeconds')::integer,0))>statement_timestamp()) THEN RETURN NULL; END IF;
      INSERT INTO public.notification_setup(id,account,binding,actor_id) VALUES(gen_random_uuid(),account_ref,deployment,current_setting('app.actor_id',true)) RETURNING * INTO s;
      RETURN jsonb_build_object('id',s.id,'capability',s.capability);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_save_setup(account_ref text,deployment jsonb,observation jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.notification_operator() THEN RAISE EXCEPTION 'forbidden'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification:'||account_ref,0));
      UPDATE public.notification_setup s SET setup=observation,completed_at=statement_timestamp() WHERE s.id=(deployment->>'inspectionId')::uuid AND s.capability=(deployment->>'inspectionCapability')::uuid
        AND s.account=account_ref AND s.binding=deployment-'inspectionId'-'inspectionCapability' AND s.actor_id=current_setting('app.actor_id',true) AND s.setup IS NULL AND s.at>statement_timestamp()-interval '30 seconds';
      IF NOT FOUND THEN RAISE EXCEPTION 'stale inspection'; END IF;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_enqueue(draft jsonb,deployment jsonb,sealed text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE source jsonb; n record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification-source:'||(draft->>'purpose')||':'||(draft->>'sourceId'),0));
      PERFORM pg_advisory_xact_lock(hashtextextended('notification:'||(deployment->>'account'),0));
      source:=public.notification_source(draft->>'purpose',draft->>'sourceId',draft->>'authority',draft->>'actorId',(draft->>'businessId')::uuid);
      IF source IS NULL THEN RETURN NULL; END IF;
      IF draft->>'purpose' IN ('operations','subscription') AND NOT EXISTS(SELECT 1 FROM public.notification_preference p WHERE p.id::text=split_part(draft->>'authority',':',1) AND p.account=deployment->>'account') THEN RETURN NULL; END IF;
      SELECT * INTO n FROM public.notification_notice x WHERE x.purpose=draft->>'purpose' AND x.source_id=draft->>'sourceId';
      IF FOUND THEN
        IF n.account<>deployment->>'account' THEN RETURN NULL; END IF;
        IF n.key<>draft->>'key' OR n.provider_id IS NULL AND n.payload_hash<>draft->>'payloadHash' THEN RAISE EXCEPTION 'immutable notification'; END IF;
        IF n.purpose='cost_alert' AND n.provider_id IS NULL THEN UPDATE public.notification_notice SET authority=draft->>'authority' WHERE id=n.id; END IF;
        RETURN jsonb_build_object('id',n.id,'capability',n.capability);
      END IF;
      INSERT INTO public.notification_notice(id,account,purpose,source_id,source_stage,business_id,actor_id,authority,auth_user_id,recipient_digest,capability,key,key_ref,payload_hash,expires_at,binding)
        VALUES((draft->>'id')::uuid,deployment->>'account',draft->>'purpose',draft->>'sourceId',draft->>'sourceStage',(draft->>'businessId')::uuid,draft->>'actorId',draft->>'authority',source->>'userId',coalesce(source->>'recipientDigest',md5(lower(source->>'email'))),gen_random_uuid(),draft->>'key',deployment->>'keyRef',draft->>'payloadHash',(source->>'expiresAt')::timestamptz,deployment) RETURNING * INTO n;
      INSERT INTO public.notification_payload(notice_id,sealed,expires_at) VALUES(n.id,sealed,n.expires_at);
      INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'persisted');
      RETURN jsonb_build_object('id',n.id,'capability',n.capability);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_claim(notice_ref uuid,cap uuid,deployment jsonb)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; s record; t jsonb; source jsonb; reserved bigint; daily_reserved bigint; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification:'||(deployment->>'account'),0));
      SELECT * INTO n FROM public.notification_notice x WHERE x.id=notice_ref AND x.capability=cap AND x.account=deployment->>'account' FOR UPDATE;
      IF NOT FOUND OR n.state NOT IN ('pending','sending','uncertain','rate_limited','rejected') OR n.lease_until>statement_timestamp() OR n.next_attempt_at>statement_timestamp() THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM public.notification_setup x WHERE x.account=n.account AND x.setup IS NULL AND x.at>statement_timestamp()-interval '30 seconds') THEN UPDATE public.notification_notice SET reason='setup_check_in_progress',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL; END IF;
      source:=public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id);
      IF n.expires_at<=statement_timestamp() THEN
        UPDATE public.notification_notice SET state='expired',reason='payload_expired' WHERE id=n.id;
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'expired'); RETURN NULL;
      END IF;
      IF source IS NULL OR (n.auth_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."user" u WHERE u.id=n.auth_user_id AND md5(lower(u.email))=n.recipient_digest)) THEN
        UPDATE public.notification_notice SET state='held',reason='authority_changed' WHERE id=n.id;
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'authority_changed'); RETURN NULL;
      END IF;
      IF n.retry_until<=statement_timestamp() OR n.binding-'from'<>deployment-'from' THEN
        UPDATE public.notification_notice SET state='held',reason='key_or_idempotency_expired' WHERE id=n.id;
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'key_or_idempotency_expired'); RETURN NULL;
      END IF;
      SELECT * INTO s FROM public.notification_setup x WHERE x.account=n.account AND x.setup IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1;
      SELECT x.terms INTO t FROM (SELECT * FROM public.notification_terms c WHERE c.account=n.account ORDER BY c.at DESC,c.id DESC LIMIT 1) x JOIN public.platform_operator o ON o.user_id=x.actor_id AND o.notifications JOIN public."user" u ON u.id=o.user_id WHERE (x.auth_bootstrap AND n.purpose='authentication') OR (NOT x.auth_bootstrap AND u.email_verified AND u.two_factor_enabled AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified));
      IF s.id IS NULL OR s.binding-'from'<>deployment-'from' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.setup->'senders') sender WHERE lower(sender->>'from')=lower(n.binding->>'from') AND sender->>'sendingReady'='true') OR s.at<statement_timestamp()-interval '5 minutes' OR s.setup->'usage'->>'object'<>'usage' OR t IS NULL THEN
        UPDATE public.notification_notice SET reason='setup_required',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      IF s.at+make_interval(secs=>coalesce((s.setup->>'retryAfterSeconds')::integer,0))>statement_timestamp() THEN RETURN NULL; END IF;
      IF (t->>'kind'='free' AND s.setup->'usage'->'emails'->'daily'->>'limit' IS NULL) THEN
        UPDATE public.notification_notice SET reason='selected_paid_terms_required',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      -- Native counters already include observed acceptance. Reserve only unresolved
      -- attempts and sends made after this observation, excluding this retry.
      SELECT count(*) FILTER(WHERE potential.at >= date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),count(*) FILTER(WHERE potential.at >= statement_timestamp()-interval '24 hours') INTO reserved,daily_reserved FROM public.notification_notice x JOIN LATERAL(SELECT coalesce(max(e.at),x.first_attempt_at) as at FROM public.notification_event e WHERE e.notice_id=x.id AND e.kind IN ('dispatch_boundary','accepted')) potential ON true WHERE x.account=n.account AND x.id<>n.id AND x.first_attempt_at IS NOT NULL
        AND (x.provider_id IS NULL AND (x.uncertain OR x.state='sending' AND x.lease_until>statement_timestamp()) OR x.provider_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=x.id AND e.kind='accepted' AND e.at>=s.at));
      IF (s.setup->'usage'->'emails'->'daily'->>'resets_at')::timestamptz<=statement_timestamp() OR (s.setup->'usage'->'emails'->'monthly'->>'resets_at')::timestamptz<=statement_timestamp()
        OR (s.setup->'usage'->'emails'->'monthly'->>'used')::bigint+reserved>=least((s.setup->'usage'->'emails'->'monthly'->>'limit')::bigint,(t->>'monthlyLimit')::bigint)
        OR (s.setup->'usage'->'emails'->'daily'->>'used')::bigint+daily_reserved>=least((s.setup->'usage'->'emails'->'daily'->>'limit')::bigint,(t->>'dailyLimit')::bigint) THEN
        UPDATE public.notification_notice SET reason='quota_or_observation_exhausted',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      IF EXISTS(SELECT 1 FROM public.notification_notice x WHERE x.account=n.account AND x.first_attempt_at IS NOT NULL AND (x.lease_until>statement_timestamp() OR x.next_attempt_at>statement_timestamp() AND (x.reason='rate_limited' OR x.state='accepted'))) THEN RETURN NULL; END IF;
      IF (SELECT count(*) FROM public.notification_event e JOIN public.notification_notice x ON x.id=e.notice_id WHERE x.account=n.account AND e.kind='sending' AND e.at>statement_timestamp()-make_interval(secs=>CASE WHEN s.setup->'usage'->'rate_limit'->>'duration' LIKE '%ms' THEN replace(s.setup->'usage'->'rate_limit'->>'duration','ms','')::double precision/1000 ELSE replace(s.setup->'usage'->'rate_limit'->>'duration','s','')::double precision END)) >= (s.setup->'usage'->'rate_limit'->>'limit')::integer THEN RETURN NULL; END IF;
      UPDATE public.notification_notice x SET state='sending',reason='dispatching',prior_uncertain=x.uncertain,first_attempt_at=coalesce(x.first_attempt_at,statement_timestamp()),retry_until=coalesce(x.retry_until,statement_timestamp()+interval '23 hours'),lease=gen_random_uuid(),lease_until=statement_timestamp()+interval '30 seconds',next_attempt_at=NULL,terms=coalesce(x.terms,t) WHERE x.id=n.id RETURNING * INTO n;
      INSERT INTO public.notification_event(id,notice_id,kind,lease) VALUES(gen_random_uuid(),n.id,'sending',n.lease);
      RETURN (SELECT jsonb_build_object('id',n.id,'capability',n.capability,'lease',n.lease,'account',n.account,'purpose',n.purpose,'sourceId',n.source_id,'sealed',p.sealed,'now',statement_timestamp(),'expiresAt',n.expires_at,'key',n.key,'keyRef',n.key_ref) FROM public.notification_payload p WHERE p.notice_id=n.id AND p.expires_at>statement_timestamp());
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_gate(notice_ref uuid,cap uuid,lease_ref uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN false; END IF;
      SELECT * INTO n FROM public.notification_notice x WHERE x.id=notice_ref AND x.capability=cap AND x.lease=lease_ref AND x.state='sending' AND x.lease_until>statement_timestamp();
      IF NOT (FOUND AND n.expires_at>statement_timestamp() AND n.retry_until>statement_timestamp()
        AND public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL
        AND (n.auth_user_id IS NULL OR EXISTS(SELECT 1 FROM public."user" u WHERE u.id=n.auth_user_id AND md5(lower(u.email))=n.recipient_digest))
        AND EXISTS(SELECT 1 FROM public.notification_terms t JOIN public.platform_operator o ON o.user_id=t.actor_id AND o.notifications JOIN public."user" u ON u.id=o.user_id WHERE t.account=n.account AND t.terms=n.terms AND ((t.auth_bootstrap AND n.purpose='authentication') OR (NOT t.auth_bootstrap AND u.email_verified AND u.two_factor_enabled AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified))) AND NOT EXISTS(SELECT 1 FROM public.notification_terms newer WHERE newer.account=t.account AND (newer.at>t.at OR newer.at=t.at AND newer.id>t.id)))
      ) THEN RETURN false; END IF;
      UPDATE public.notification_notice SET uncertain=true WHERE id=n.id;
      INSERT INTO public.notification_event(id,notice_id,kind,lease) SELECT gen_random_uuid(),n.id,'dispatch_boundary',n.lease WHERE NOT EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=n.id AND e.kind='dispatch_boundary' AND e.lease=n.lease);
      RETURN true;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_outcome(notice_ref uuid,cap uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      RETURN (SELECT jsonb_build_object('state',n.state,'providerId',n.provider_id) FROM public.notification_notice n WHERE n.id=notice_ref AND n.capability=cap);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_finish(notice_ref uuid,cap uuid,lease_ref uuid,result text,receipt text,wait_seconds integer)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR result NOT IN ('accepted','uncertain','rejected','rate_limited','held') OR wait_seconds NOT BETWEEN 0 AND 2147483000 OR (result<>'accepted' AND receipt IS NOT NULL) OR (result='accepted' AND (receipt IS NULL OR length(receipt)>256 OR receipt !~ '^[a-zA-Z0-9_.:-]+$')) THEN RETURN; END IF;
      UPDATE public.notification_notice x SET state=result,uncertain=CASE WHEN result='accepted' THEN false WHEN result IN ('rejected','rate_limited') THEN x.prior_uncertain ELSE x.uncertain END,provider_id=coalesce(receipt,x.provider_id),reason=result,lease=NULL,lease_until=NULL,
        next_attempt_at=statement_timestamp()+make_interval(secs=>greatest(wait_seconds,CASE WHEN result='accepted' THEN 0 ELSE 1 END))
        WHERE x.id=notice_ref AND x.capability=cap AND x.provider_id IS NULL AND ((x.lease=lease_ref AND x.state='sending') OR result='accepted' AND EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=x.id AND e.lease=lease_ref AND e.kind='dispatch_boundary')) RETURNING * INTO n;
      IF FOUND THEN
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,result);
        IF n.purpose='invitation' AND result='accepted' THEN
          UPDATE public.invitation i SET delivery='sent' WHERE i.id::text=n.source_id AND i.business_id=n.business_id AND i.status='pending'
            AND public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL;
        END IF;
        IF n.purpose='cost_alert' AND result='accepted' THEN PERFORM public.notification_sync_costs(n.account); END IF;
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_work(account_ref text) RETURNS TABLE(id uuid,capability uuid)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN; END IF;
      RETURN QUERY SELECT n.id,n.capability FROM public.notification_notice n WHERE n.account=account_ref AND n.purpose<>'cost_alert' AND n.state IN ('pending','sending','uncertain','rate_limited','rejected') AND (n.lease_until IS NULL OR n.lease_until<=statement_timestamp()) AND (n.next_attempt_at IS NULL OR n.next_attempt_at<=statement_timestamp()) ORDER BY n.created_at,n.id LIMIT 100;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_workspace(account_ref text,tenant uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE s record; result jsonb; BEGIN
      IF tenant IS NULL THEN IF NOT public.notification_operator() THEN RETURN NULL; END IF;
      ELSE IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL THEN RETURN NULL; END IF; END IF;
      SELECT * INTO s FROM public.notification_setup x WHERE x.account=account_ref AND x.setup IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1;
      SELECT jsonb_build_object('bootstrapAuthOnly',coalesce((SELECT t.auth_bootstrap FROM public.notification_terms t WHERE t.account=account_ref ORDER BY t.at DESC,t.id DESC LIMIT 1),false),'setup',s.setup,'setupCheckedAt',s.at,'setupFresh',coalesce(s.at>statement_timestamp()-interval '5 minutes',false),
        'terms',(SELECT t.terms FROM public.notification_terms t WHERE t.account=account_ref ORDER BY t.at DESC,t.id DESC LIMIT 1),
        'pendingReservations',(SELECT count(*)::integer FROM public.notification_notice n WHERE n.account=account_ref AND n.first_attempt_at IS NOT NULL AND n.provider_id IS NULL AND (n.uncertain OR n.state='sending' AND n.lease_until>statement_timestamp())),
        'allowedPreferences',CASE WHEN tenant IS NOT NULL THEN CASE WHEN public.current_business_role() IN ('owner','admin') THEN '["operations","subscription"]'::jsonb ELSE '["operations"]'::jsonb END ELSE (CASE WHEN EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND (o.operations OR o.sender_health)) THEN '["operations"]'::jsonb ELSE '[]'::jsonb END)||(CASE WHEN EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.reconciliation) THEN '["subscription"]'::jsonb ELSE '[]'::jsonb END) END,
        'notices',coalesce((SELECT jsonb_agg(v.value ORDER BY v.created_at DESC) FROM (SELECT n.created_at,jsonb_build_object('id',n.id,'purpose',n.purpose,'businessId',n.business_id,'sourceId',CASE WHEN n.purpose='authentication' THEN n.id::text ELSE n.source_id END,'sourceStage',n.source_stage,
          'state',n.state,'stage',(SELECT r.stage FROM public.notification_receipt r WHERE r.account=n.account AND r.provider_id=n.provider_id AND r.recipient_digest=n.recipient_digest AND r.sender_digest=md5(lower(n.binding->>'from')) ORDER BY CASE r.stage WHEN 'complained' THEN 7 WHEN 'bounced' THEN 6 WHEN 'suppressed' THEN 5 WHEN 'failed' THEN 4 WHEN 'delivered' THEN 3 WHEN 'delivery_delayed' THEN 2 ELSE 1 END DESC,r.occurred_at DESC LIMIT 1),'providerId',n.provider_id,'createdAt',n.created_at,'expiresAt',n.expires_at,'firstAttemptAt',n.first_attempt_at,'retryUntil',n.retry_until,'nextAttemptAt',n.next_attempt_at,'reason',n.reason,
          'authorityCurrent',public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL AND (n.auth_user_id IS NULL OR EXISTS(SELECT 1 FROM public."user" u WHERE u.id=n.auth_user_id AND md5(lower(u.email))=n.recipient_digest)),
          'history',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'at',e.at) ORDER BY e.at,e.id) FROM (SELECT e.id,e.kind,e.at FROM public.notification_event e WHERE e.notice_id=n.id UNION ALL SELECT r.id,'provider_'||r.stage,r.occurred_at FROM public.notification_receipt r WHERE r.account=n.account AND r.provider_id=n.provider_id AND r.recipient_digest=n.recipient_digest AND r.sender_digest=md5(lower(n.binding->>'from'))) e),'[]'::jsonb)) AS value
          FROM public.notification_notice n WHERE n.account=account_ref AND (tenant IS NULL OR n.business_id=tenant AND (n.purpose='invitation' AND public.current_business_role() IN ('owner','admin') OR n.purpose IN ('operations','subscription') AND (n.actor_id=current_setting('app.actor_id',true) OR public.current_business_role() IN ('owner','admin')))) ORDER BY n.created_at DESC LIMIT 200) v),'[]'::jsonb)) INTO result;
      IF tenant IS NOT NULL THEN RETURN jsonb_build_object('notices',result->'notices','allowedPreferences',result->'allowedPreferences','sendingReady',coalesce(s.setup->>'sendingReady'='true' AND s.at>statement_timestamp()-interval '5 minutes',false)); END IF;
      RETURN result;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_prune() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE removed integer; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN 0; END IF;
      DELETE FROM public.notification_payload p WHERE p.expires_at<=statement_timestamp(); GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_receive(account_ref text,receiver_ref text,receipt jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR receiver_ref='' OR NOT EXISTS(SELECT 1 FROM public.notification_setup s WHERE s.account=account_ref AND s.binding->>'receiverRef'=receiver_ref)
        OR receipt->>'stage' NOT IN ('sent','delivery_delayed','delivered','bounced','complained','failed','suppressed') OR (receipt->>'occurredAt')::timestamptz>statement_timestamp()+interval '5 minutes'
        OR length(receipt->>'providerId') NOT BETWEEN 1 AND 256 OR receipt->>'rawHash' !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification-receipt:'||account_ref||':'||(receipt->>'eventId'),0));
      SELECT * INTO previous FROM public.notification_receipt r WHERE r.account=account_ref AND r.event_id=receipt->>'eventId';
      IF FOUND THEN RETURN previous.raw_hash=receipt->>'rawHash'; END IF;
      INSERT INTO public.notification_receipt(id,account,event_id,provider_id,stage,raw_hash,occurred_at,recipient_digest,sender_digest)
        VALUES(gen_random_uuid(),account_ref,receipt->>'eventId',receipt->>'providerId',receipt->>'stage',receipt->>'rawHash',(receipt->>'occurredAt')::timestamptz,receipt->>'recipientDigest',receipt->>'senderDigest');
      RETURN true;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_retry(account_ref text,notice_ref uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; BEGIN
      IF NOT public.notification_operator() THEN RETURN NULL; END IF;
      SELECT * INTO n FROM public.notification_notice x WHERE x.id=notice_ref AND x.account=account_ref AND x.purpose<>'cost_alert' FOR UPDATE;
      IF NOT FOUND THEN RETURN NULL; END IF;
      IF n.reason IN ('setup_required','setup_check_in_progress','quota_or_observation_exhausted','selected_paid_terms_required') THEN UPDATE public.notification_notice SET next_attempt_at=NULL WHERE id=n.id; END IF;
      RETURN jsonb_build_object('id',n.id,'capability',n.capability);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_preference_current(preference_ref uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; BEGIN
      SELECT * INTO p FROM public.notification_preference x WHERE x.id=preference_ref AND x.enabled;
      IF NOT FOUND OR EXISTS(SELECT 1 FROM public.notification_preference newer WHERE newer.account=p.account AND newer.actor_id=p.actor_id AND newer.business_id IS NOT DISTINCT FROM p.business_id AND newer.purpose=p.purpose AND newer.version>p.version) THEN RETURN false; END IF;
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL AND p.business_id::text IS DISTINCT FROM current_setting('app.business_id',true) THEN RETURN false; END IF;
      IF NOT EXISTS(SELECT 1 FROM public."user" u WHERE u.id=p.actor_id AND u.email_verified) THEN RETURN false; END IF;
      IF p.business_id IS NULL THEN RETURN EXISTS(SELECT 1 FROM public.platform_operator o JOIN public."user" u ON u.id=o.user_id AND u.two_factor_enabled WHERE o.user_id=p.actor_id AND o.notifications AND CASE WHEN p.purpose='operations' THEN (o.operations OR o.sender_health) ELSE o.reconciliation END AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)); END IF;
      RETURN EXISTS(SELECT 1 FROM public.membership m JOIN public."user" u ON u.id=m.user_id WHERE m.business_id=p.business_id AND m.user_id=p.actor_id AND (p.purpose='operations' OR m.role IN ('owner','admin')) AND (m.role='salesperson' OR u.two_factor_enabled AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)));
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_set_preference(account_ref text,tenant uuid,choice jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE previous integer; actor text:=current_setting('app.actor_id',true); BEGIN
      IF choice->>'purpose' NOT IN ('operations','subscription') THEN RETURN false; END IF;
      IF tenant IS NULL THEN
        IF NOT public.notification_operator() OR (choice->>'enabled'='true' AND NOT EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=actor AND CASE WHEN choice->>'purpose'='operations' THEN (o.operations OR o.sender_health) ELSE o.reconciliation END)) THEN RETURN false; END IF;
      ELSE IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL OR choice->>'enabled'='true' AND choice->>'purpose'='subscription' AND public.current_business_role() NOT IN ('owner','admin') THEN RETURN false; END IF; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('notification-policy:'||account_ref||':'||actor||':'||coalesce(tenant::text,'')||':'||(choice->>'purpose'),0));
      SELECT coalesce(max(p.version),0) INTO previous FROM public.notification_preference p WHERE p.account=account_ref AND p.actor_id=actor AND p.business_id IS NOT DISTINCT FROM tenant AND p.purpose=choice->>'purpose';
      IF previous<>(choice->>'expectedVersion')::integer THEN RETURN false; END IF;
      INSERT INTO public.notification_preference(id,account,actor_id,business_id,purpose,enabled,version) VALUES(gen_random_uuid(),account_ref,actor,tenant,choice->>'purpose',(choice->>'enabled')::boolean,previous+1); RETURN true;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_preferences(account_ref text,tenant uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF tenant IS NULL THEN IF NOT public.notification_operator() THEN RETURN NULL; END IF;
      ELSE IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR public.current_business_role() IS NULL THEN RETURN NULL; END IF; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('purpose',p.purpose,'enabled',p.enabled,'version',p.version)) FROM (SELECT DISTINCT ON (x.purpose) * FROM public.notification_preference x WHERE x.account=account_ref AND x.actor_id=current_setting('app.actor_id',true) AND x.business_id IS NOT DISTINCT FROM tenant ORDER BY x.purpose,x.version DESC) p),'[]'::jsonb);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_candidates(account_ref text) RETURNS TABLE(draft jsonb)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN; END IF;
      RETURN QUERY SELECT candidate FROM (
        SELECT jsonb_build_object('id',gen_random_uuid(),'purpose',p.purpose,'sourceId',e.id::text||':'||p.actor_id||':'||CASE WHEN p.business_id IS NULL THEN 'operator' ELSE 'business' END,'businessId',p.business_id,'actorId',p.actor_id,'authority',p.id::text||':'||e.id::text||':'||current_event.id::text,'sourceStage',CASE WHEN e.outcome='escalated' THEN 'escalated' ELSE e.snapshot->>'status' END) candidate
          FROM public.notification_preference p JOIN public.operation_event e ON (p.business_id IS NULL OR p.business_id=e.business_id) AND e.outcome IN ('observed','escalated')
          JOIN LATERAL(SELECT x.id FROM public.operation_event x WHERE x.business_id=e.business_id AND x.source=e.source AND x.target_id=e.target_id AND x.outcome='observed' ORDER BY x.position DESC LIMIT 1) current_event ON true
          WHERE p.account=account_ref AND p.purpose='operations' AND public.notification_preference_current(p.id)
            AND (e.outcome='escalated' OR e.id=current_event.id)
            AND (e.outcome='escalated' OR CASE WHEN e.source='inquiry' THEN e.snapshot->>'status' IN ('handoff','stale') WHEN e.source='action' AND e.snapshot->>'status'='dispatched' AND e.snapshot->>'reason' IN ('whatsapp_accepted_delivery_unconfirmed','whatsapp_sent','whatsapp_delivered','whatsapp_read') THEN false ELSE e.snapshot->>'status' IN ('blocked','failed','ambiguous','handoff','incident','review') OR (e.snapshot->>'reason' IS NOT NULL AND e.snapshot->>'reason' NOT IN ('completed','provider_accepted','ready','connected','booked','business_evidence')) END)
        UNION ALL
        SELECT jsonb_build_object('id',gen_random_uuid(),'purpose',p.purpose,'sourceId',e.id::text||':'||p.actor_id||':'||CASE WHEN p.business_id IS NULL THEN 'operator' ELSE 'business' END,'businessId',p.business_id,'actorId',p.actor_id,'authority',p.id::text||':'||e.id::text,'sourceStage',e.notice->>'kind') candidate
          FROM public.notification_preference p JOIN public.subscription_lifecycle_event e ON (p.business_id IS NULL OR p.business_id=e.business_id) AND e.notice IS NOT NULL
          WHERE p.account=account_ref AND p.purpose='subscription' AND public.notification_preference_current(p.id)
            AND EXISTS(SELECT 1 FROM public.subscription_payment a WHERE a.id=e.action_id AND a.business_id=e.business_id AND ((a.lifecycle-'evaluatedAt') #- '{provider,observedAt}')=((e.lifecycle-'evaluatedAt') #- '{provider,observedAt}'))
        UNION ALL
        SELECT jsonb_build_object('id',gen_random_uuid(),'purpose',p.purpose,'sourceId',e.id::text||':'||p.actor_id||':business','businessId',p.business_id,'actorId',p.actor_id,'authority',p.id::text||':'||e.id::text,'sourceStage','financial_'||CASE WHEN e.kind='observation' THEN c.kind||'_'||(e.detail->'observation'->>'status') ELSE e.kind END) candidate
          FROM public.notification_preference p JOIN public.financial_case_event e ON p.business_id=e.business_id AND e.detail->>'message' IS NOT NULL
          JOIN public.financial_case c ON c.id=e.case_id AND c.business_id=e.business_id
          WHERE p.account=account_ref AND p.purpose='subscription' AND p.business_id IS NOT NULL AND public.notification_preference_current(p.id)
            AND e.position=(SELECT max(latest.position) FROM public.financial_case_event latest WHERE latest.case_id=e.case_id AND latest.detail->>'message' IS NOT NULL)
      ) v WHERE public.notification_source(v.candidate->>'purpose',v.candidate->>'sourceId',v.candidate->>'authority',v.candidate->>'actorId',(v.candidate->>'businessId')::uuid) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.notification_notice n WHERE n.account=account_ref AND n.purpose=v.candidate->>'purpose' AND n.source_id=v.candidate->>'sourceId') LIMIT 100;
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_begin_maintenance_setup(deployment jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE s record; saved_actor text; work jsonb; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      SELECT * INTO s FROM public.notification_setup x WHERE x.account=deployment->>'account' AND x.setup IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1;
      IF NOT FOUND OR s.binding-'from'<>deployment-'from' OR s.at>statement_timestamp()-interval '4 minutes' OR NOT EXISTS(SELECT 1 FROM public.platform_operator o JOIN public."user" u ON u.id=o.user_id AND u.two_factor_enabled AND u.email_verified WHERE o.user_id=s.actor_id AND o.notifications AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)) THEN RETURN NULL; END IF;
      saved_actor:=current_setting('app.actor_id',true); PERFORM set_config('app.actor_id',s.actor_id,true);
      work:=public.notification_begin_setup(deployment->>'account',deployment);
      PERFORM set_config('app.actor_id',coalesce(saved_actor,''),true);
      IF work IS NULL THEN RETURN NULL; END IF;
      RETURN work||jsonb_build_object('actorId',s.actor_id);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_sync_costs(account_ref text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; saved uuid; count integer:=0; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN 0; END IF;
      FOR n IN SELECT x.* FROM public.notification_notice x WHERE x.account=account_ref AND x.purpose='cost_alert' AND x.state='accepted' AND x.provider_id IS NOT NULL AND x.key='operator-cost/'||x.source_id AND EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=x.id AND e.kind='accepted') LOOP
        UPDATE public.operator_cost_alert a SET email_state='accepted',lease_key=NULL,lease_until=statement_timestamp() WHERE a.id::text=n.source_id AND a.email_state<>'accepted' AND md5(lower(a.email))=n.recipient_digest RETURNING a.id INTO saved;
        IF FOUND THEN INSERT INTO public.operator_cost_notification_event(id,alert_id,kind,detail,at) VALUES(gen_random_uuid(),saved,'accepted',n.provider_id,statement_timestamp()); count:=count+1; END IF;
      END LOOP;
      RETURN count;
    END $$;
  `;
  await pool.query(ddl);
  const signatures = [
    "notification_sync_costs(text)",
    "notification_preference_current(uuid)",
    "notification_preferences(text,uuid)",
    "notification_set_preference(text,uuid,jsonb)",
    "notification_candidates(text)",
    "notification_begin_maintenance_setup(jsonb)",
    "notification_operator()",
    "notification_source(text,text,text,text,uuid)",
    "notification_select_terms(text,jsonb)",
    "notification_begin_setup(text,jsonb)",
    "notification_save_setup(text,jsonb,jsonb)",
    "notification_enqueue(jsonb,jsonb,text)",
    "notification_claim(uuid,uuid,jsonb)",
    "notification_gate(uuid,uuid,uuid)",
    "notification_outcome(uuid,uuid)",
    "notification_finish(uuid,uuid,uuid,text,text,integer)",
    "notification_work(text)",
    "notification_workspace(text,uuid)",
    "notification_prune()",
    "notification_receive(text,text,jsonb)",
    "notification_retry(text,uuid)",
  ];
  await pool.query(
    `REVOKE ALL ON FUNCTION ${signatures.map((s) => `public.${s}`).join(",")} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${signatures.map((s) => `public.${s}`).join(",")} TO app_runtime;`,
  );
}
