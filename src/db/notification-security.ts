import type { Pool, PoolClient } from "pg";

export const notificationTables = [
  "notification_terms",
  "notification_setup",
  "notification_notice",
  "notification_payload",
  "notification_event",
  "notification_receipt",
];
export const notificationFunctions = [
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
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.notification_operator() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN nullif(current_setting('app.business_id',true),'') IS NULL AND EXISTS(
        SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.notifications);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_source(purpose text,source_ref text,authority text,actor text,tenant uuid)
    RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE v record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
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
            AND (m.role='owner' OR m.role='admin' AND i.role='salesperson');
        IF FOUND THEN RETURN jsonb_build_object('expiresAt',least(v.expires_at,v.created_at+interval '24 hours'),
          'email',v.email,'businessName',v.business_name,'role',v.role,'invitationExpiresAt',v.expires_at); END IF;
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
      PERFORM pg_advisory_xact_lock(hashtextextended('notification:'||(deployment->>'account'),0));
      source:=public.notification_source(draft->>'purpose',draft->>'sourceId',draft->>'authority',draft->>'actorId',(draft->>'businessId')::uuid);
      IF source IS NULL THEN RETURN NULL; END IF;
      SELECT * INTO n FROM public.notification_notice x WHERE x.account=deployment->>'account' AND x.purpose=draft->>'purpose' AND x.source_id=draft->>'sourceId';
      IF FOUND THEN
        IF n.payload_hash<>draft->>'payloadHash' OR n.key<>draft->>'key' THEN RAISE EXCEPTION 'immutable notification'; END IF;
        RETURN jsonb_build_object('id',n.id,'capability',n.capability);
      END IF;
      INSERT INTO public.notification_notice(id,account,purpose,source_id,business_id,actor_id,authority,auth_user_id,recipient_digest,capability,key,key_ref,payload_hash,expires_at,binding)
        VALUES((draft->>'id')::uuid,deployment->>'account',draft->>'purpose',draft->>'sourceId',(draft->>'businessId')::uuid,draft->>'actorId',draft->>'authority',source->>'userId',coalesce(source->>'recipientDigest',md5(lower(source->>'email'))),gen_random_uuid(),draft->>'key',deployment->>'keyRef',draft->>'payloadHash',(source->>'expiresAt')::timestamptz,deployment) RETURNING * INTO n;
      INSERT INTO public.notification_payload(notice_id,sealed,expires_at) VALUES(n.id,sealed,n.expires_at);
      INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'persisted');
      RETURN jsonb_build_object('id',n.id,'capability',n.capability);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_claim(notice_ref uuid,cap uuid,deployment jsonb)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; s record; t jsonb; source jsonb; reserved bigint; BEGIN
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
      IF n.retry_until<=statement_timestamp() OR n.binding<>deployment THEN
        UPDATE public.notification_notice SET state='held',reason='key_or_idempotency_expired' WHERE id=n.id;
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'key_or_idempotency_expired'); RETURN NULL;
      END IF;
      SELECT * INTO s FROM public.notification_setup x WHERE x.account=n.account AND x.setup IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1;
      SELECT x.terms INTO t FROM public.notification_terms x WHERE x.account=n.account ORDER BY x.at DESC,x.id DESC LIMIT 1;
      IF s.id IS NULL OR s.binding<>deployment OR s.at<statement_timestamp()-interval '5 minutes' OR s.setup->>'sendingReady'<>'true' OR s.setup->'usage'->>'object'<>'usage' OR t IS NULL THEN
        UPDATE public.notification_notice SET reason='setup_required',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      IF (t->>'kind'='free' AND s.setup->'usage'->'emails'->'daily'->>'limit' IS NULL) THEN
        UPDATE public.notification_notice SET reason='selected_paid_terms_required',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      -- Native counters already include observed acceptance. Reserve only unresolved
      -- attempts and sends made after this observation, excluding this retry.
      SELECT count(*) INTO reserved FROM public.notification_notice x WHERE x.account=n.account AND x.id<>n.id AND x.first_attempt_at IS NOT NULL
        AND (x.provider_id IS NULL AND x.state IN ('sending','uncertain','held','expired') OR x.provider_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.notification_event e WHERE e.notice_id=x.id AND e.kind='accepted' AND e.at>=s.at));
      IF (s.setup->'usage'->'emails'->'daily'->>'resets_at')::timestamptz<=statement_timestamp() OR (s.setup->'usage'->'emails'->'monthly'->>'resets_at')::timestamptz<=statement_timestamp()
        OR (s.setup->'usage'->'emails'->'monthly'->>'used')::bigint+reserved>=least((s.setup->'usage'->'emails'->'monthly'->>'limit')::bigint,(t->>'monthlyLimit')::bigint)
        OR (s.setup->'usage'->'emails'->'daily'->>'used')::bigint+reserved>=least((s.setup->'usage'->'emails'->'daily'->>'limit')::bigint,(t->>'dailyLimit')::bigint) THEN
        UPDATE public.notification_notice SET reason='quota_or_observation_exhausted',next_attempt_at=statement_timestamp()+interval '60 seconds' WHERE id=n.id; RETURN NULL;
      END IF;
      IF EXISTS(SELECT 1 FROM public.notification_notice x WHERE x.account=n.account AND x.first_attempt_at IS NOT NULL AND (x.lease_until>statement_timestamp() OR x.next_attempt_at>statement_timestamp() AND (x.reason='rate_limited' OR x.state='accepted'))) THEN RETURN NULL; END IF;
      IF (SELECT count(*) FROM public.notification_event e JOIN public.notification_notice x ON x.id=e.notice_id WHERE x.account=n.account AND e.kind='sending' AND e.at>statement_timestamp()-make_interval(secs=>CASE WHEN s.setup->'usage'->'rate_limit'->>'duration' LIKE '%ms' THEN replace(s.setup->'usage'->'rate_limit'->>'duration','ms','')::double precision/1000 ELSE replace(s.setup->'usage'->'rate_limit'->>'duration','s','')::double precision END)) >= (s.setup->'usage'->'rate_limit'->>'limit')::integer THEN RETURN NULL; END IF;
      UPDATE public.notification_notice x SET state='sending',reason='dispatching',first_attempt_at=coalesce(x.first_attempt_at,statement_timestamp()),retry_until=coalesce(x.retry_until,statement_timestamp()+interval '23 hours'),lease=gen_random_uuid(),lease_until=statement_timestamp()+interval '30 seconds',next_attempt_at=NULL,terms=coalesce(x.terms,t) WHERE x.id=n.id RETURNING * INTO n;
      INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,'sending');
      RETURN (SELECT jsonb_build_object('id',n.id,'capability',n.capability,'lease',n.lease,'account',n.account,'purpose',n.purpose,'sourceId',n.source_id,'sealed',p.sealed,'now',statement_timestamp(),'expiresAt',n.expires_at,'key',n.key,'keyRef',n.key_ref) FROM public.notification_payload p WHERE p.notice_id=n.id AND p.expires_at>statement_timestamp());
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_gate(notice_ref uuid,cap uuid,lease_ref uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN false; END IF;
      SELECT * INTO n FROM public.notification_notice x WHERE x.id=notice_ref AND x.capability=cap AND x.lease=lease_ref AND x.state='sending' AND x.lease_until>statement_timestamp();
      RETURN FOUND AND n.expires_at>statement_timestamp() AND n.retry_until>statement_timestamp()
        AND public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL
        AND (n.auth_user_id IS NULL OR EXISTS(SELECT 1 FROM public."user" u WHERE u.id=n.auth_user_id AND md5(lower(u.email))=n.recipient_digest));
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_outcome(notice_ref uuid,cap uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN NULL; END IF;
      RETURN (SELECT jsonb_build_object('state',n.state,'providerId',n.provider_id) FROM public.notification_notice n WHERE n.id=notice_ref AND n.capability=cap);
    END $$;
    CREATE OR REPLACE FUNCTION public.notification_finish(notice_ref uuid,cap uuid,lease_ref uuid,result text,receipt text,wait_seconds integer)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE n record; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL OR result NOT IN ('accepted','uncertain','rejected','rate_limited','held') OR wait_seconds NOT BETWEEN 0 AND 2147483000 OR (result='accepted' AND (receipt IS NULL OR length(receipt)>256 OR receipt !~ '^[a-zA-Z0-9_.:-]+$')) THEN RETURN; END IF;
      UPDATE public.notification_notice x SET state=result,provider_id=coalesce(receipt,x.provider_id),reason=result,lease=NULL,lease_until=NULL,
        next_attempt_at=statement_timestamp()+make_interval(secs=>greatest(wait_seconds,CASE WHEN result='accepted' THEN 0 ELSE 1 END))
        WHERE x.id=notice_ref AND x.capability=cap AND x.lease=lease_ref AND x.state='sending' RETURNING * INTO n;
      IF FOUND THEN
        INSERT INTO public.notification_event(id,notice_id,kind) VALUES(gen_random_uuid(),n.id,result);
        IF n.purpose='invitation' AND result='accepted' THEN
          UPDATE public.invitation i SET delivery='sent' WHERE i.id::text=n.source_id AND i.business_id=n.business_id AND i.status='pending'
            AND public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL;
        END IF;
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
      ELSE IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT coalesce(public.current_business_role() IN ('owner','admin'),false) THEN RETURN NULL; END IF; END IF;
      SELECT * INTO s FROM public.notification_setup x WHERE x.account=account_ref AND x.setup IS NOT NULL ORDER BY x.completed_at DESC,x.id DESC LIMIT 1;
      SELECT jsonb_build_object('setup',s.setup,'setupCheckedAt',s.at,'setupFresh',coalesce(s.at>statement_timestamp()-interval '5 minutes',false),
        'terms',(SELECT t.terms FROM public.notification_terms t WHERE t.account=account_ref ORDER BY t.at DESC,t.id DESC LIMIT 1),
        'pendingReservations',(SELECT count(*)::integer FROM public.notification_notice n WHERE n.account=account_ref AND n.first_attempt_at IS NOT NULL AND n.provider_id IS NULL AND n.state IN ('sending','uncertain','held','expired')),
        'notices',coalesce((SELECT jsonb_agg(v.value ORDER BY v.created_at DESC) FROM (SELECT n.created_at,jsonb_build_object('id',n.id,'purpose',n.purpose,'businessId',n.business_id,'sourceId',CASE WHEN n.purpose='authentication' THEN n.id::text ELSE n.source_id END,
          'state',n.state,'stage',(SELECT r.stage FROM public.notification_receipt r WHERE r.account=n.account AND r.provider_id=n.provider_id AND r.recipient_digest=n.recipient_digest AND r.sender_digest=md5(lower(n.binding->>'from')) ORDER BY CASE r.stage WHEN 'complained' THEN 7 WHEN 'bounced' THEN 6 WHEN 'suppressed' THEN 5 WHEN 'failed' THEN 4 WHEN 'delivered' THEN 3 WHEN 'delivery_delayed' THEN 2 ELSE 1 END DESC,r.occurred_at DESC LIMIT 1),'providerId',n.provider_id,'createdAt',n.created_at,'expiresAt',n.expires_at,'firstAttemptAt',n.first_attempt_at,'retryUntil',n.retry_until,'nextAttemptAt',n.next_attempt_at,'reason',n.reason,
          'authorityCurrent',CASE WHEN tenant IS NULL THEN public.notification_source(n.purpose,n.source_id,n.authority,n.actor_id,n.business_id) IS NOT NULL ELSE EXISTS(SELECT 1 FROM public.invitation i JOIN public.membership m ON m.business_id=i.business_id AND m.user_id=i.created_by WHERE i.id::text=n.source_id AND i.business_id=tenant AND i.status='pending' AND i.expires_at>statement_timestamp() AND (m.role='owner' OR m.role='admin' AND i.role='salesperson')) END,
          'history',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'at',e.at) ORDER BY e.at,e.id) FROM (SELECT e.id,e.kind,e.at FROM public.notification_event e WHERE e.notice_id=n.id UNION ALL SELECT r.id,'provider_'||r.stage,r.occurred_at FROM public.notification_receipt r WHERE r.account=n.account AND r.provider_id=n.provider_id AND r.recipient_digest=n.recipient_digest AND r.sender_digest=md5(lower(n.binding->>'from'))) e),'[]'::jsonb)) AS value
          FROM public.notification_notice n WHERE n.account=account_ref AND (tenant IS NULL OR n.business_id=tenant AND n.purpose='invitation') ORDER BY n.created_at DESC LIMIT 200) v),'[]'::jsonb)) INTO result;
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
  `);
  const signatures = [
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
