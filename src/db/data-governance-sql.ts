// Fixed SQL only: identifiers are application-owned, never supplied by a request.
export const dataGovernanceSql = `
CREATE OR REPLACE FUNCTION public.business_financial_export(target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.business_data_export; cases jsonb; page_size integer; page_offset bigint; stamp timestamptz:=statement_timestamp();
BEGIN
 SELECT * INTO r FROM public.business_data_export WHERE id=target;
 IF NOT FOUND OR r.business_id::text IS DISTINCT FROM current_setting('app.business_id',true)
 OR r.actor_id IS DISTINCT FROM current_setting('app.actor_id',true)
 OR NOT coalesce(public.current_business_role() IN ('owner','admin'),false)
 OR r.state<>'pending' OR r.expires_at<=stamp
 OR NOT coalesce((r.policy->>'preserveFinancial')::boolean,false)
 OR NOT (r.policy->'businessIds' ? r.business_id::text)
 OR (r.policy->>'effectiveFrom')::timestamptz>stamp OR (r.policy->>'effectiveUntil')::timestamptz<=stamp
 THEN RAISE EXCEPTION 'export unavailable' USING ERRCODE='42501'; END IF;
 page_size:=(r.policy->>'maxRows')::integer; page_offset:=(r.part::bigint-1)*page_size;
 IF page_size NOT BETWEEN 1 AND 1000 OR page_offset<0 THEN RAISE EXCEPTION 'export unavailable' USING ERRCODE='42501'; END IF;
 cases:=public.financial_public(r.business_id);
 RETURN jsonb_build_object(
  'caseTotal',jsonb_array_length(cases),
  'financial_case',coalesce((SELECT jsonb_agg(x.value ORDER BY x.ordinality) FROM (SELECT * FROM jsonb_array_elements(cases) WITH ORDINALITY LIMIT page_size OFFSET page_offset) x),'[]'::jsonb),
  'effectTotal',(SELECT count(*) FROM public.financial_case_event e JOIN public.financial_case c ON c.id=e.case_id AND c.business_id=e.business_id WHERE e.business_id=r.business_id AND e.kind='financial_effect'),
  'financial_case_event',coalesce((SELECT jsonb_agg(x.record ORDER BY x.position) FROM (
    SELECT e.position,jsonb_build_object('id',e.id,'caseId',c.id,'at',e.at,
     'effect',jsonb_build_object('source',e.detail->'source','nativeId',e.detail->'nativeId','paymentId',e.detail->'paymentId','invoiceId',e.detail->'invoiceId','periodId',e.detail->'periodId','currency',e.detail->'currency','actualMinor',e.detail->'actualMinor','originalTax',e.detail->'originalTax','allocation',e.detail->'allocation','creditApplicable',e.detail->'creditApplicable','bankSettlementConfirmed',e.detail->'bankSettlementConfirmed'),
     'approvedCredit',(SELECT jsonb_build_object('reviewId',a.id,'allocation',a.detail->'review'->'allocation','actualMinor',a.detail->'review'->'actualMinor','uncreditedDifferenceMinor',a.detail->'review'->'uncreditedDifferenceMinor','at',a.at) FROM public.financial_case_event a WHERE a.business_id=r.business_id AND a.case_id=c.id AND a.kind='credit_review' ORDER BY a.position DESC LIMIT 1),
     'creditDocumentId',(SELECT a.detail->>'documentId' FROM public.financial_case_event a WHERE a.business_id=r.business_id AND a.case_id=c.id AND a.kind='credit' LIMIT 1)) record
    FROM public.financial_case_event e JOIN public.financial_case c ON c.id=e.case_id AND c.business_id=e.business_id WHERE e.business_id=r.business_id AND e.kind='financial_effect' ORDER BY e.position LIMIT page_size OFFSET page_offset
   ) x),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.business_data_stopped(b uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT r.kind='offboard' FROM public.business_data_request r WHERE r.business_id=b ORDER BY r.at DESC,r.id DESC LIMIT 1),false)
$$;
CREATE OR REPLACE FUNCTION public.business_file_protected(f uuid,b uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.business_file x WHERE x.id=f AND x.business_id=b AND x.purpose='billing')
 OR EXISTS(SELECT 1 FROM public.billing_profile_revision x WHERE x.business_id=b AND position(f::text in x.evidence::text)>0)
 OR EXISTS(SELECT 1 FROM public.tax_calculation x WHERE x.business_id=b AND position(f::text in x.snapshot::text)>0)
 OR EXISTS(SELECT 1 FROM public.seller_document x WHERE x.business_id=b AND position(f::text in x.snapshot::text)>0)
 OR coalesce((SELECT x.policy->'deletion'->'holds' ? f::text FROM public.business_data_request x WHERE x.business_id=b ORDER BY x.at DESC,x.id DESC LIMIT 1),false)
$$;
CREATE OR REPLACE FUNCTION public.business_file_retained_until(f uuid,b uuid) RETURNS timestamptz
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.business_file_protected(f,b) THEN greatest(
 (SELECT max(d.retain_until) FROM public.seller_document d WHERE d.business_id=b AND position(f::text in d.snapshot::text)>0),
 (SELECT nullif(x.policy->'retention'->>'financialEvidenceUntil','')::timestamptz FROM public.business_data_request x WHERE x.business_id=b ORDER BY x.at DESC,x.id DESC LIMIT 1)) ELSE NULL END
$$;
CREATE OR REPLACE FUNCTION public.start_business_offboarding(request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.business_data_request; g record; t text; k text; stamp timestamptz:=statement_timestamp();
BEGIN
 SELECT * INTO r FROM public.business_data_request WHERE id=request FOR UPDATE;
 IF r.id IS NULL OR r.business_id IS DISTINCT FROM nullif(current_setting('app.business_id',true),'')::uuid
 OR r.actor_id IS DISTINCT FROM current_setting('app.actor_id',true) OR coalesce(public.current_business_role(),'') NOT IN ('owner','admin')
 OR r.kind<>'offboard' OR r.at>stamp OR (r.policy->>'effectiveFrom')::timestamptz>stamp
 OR (r.policy->>'effectiveUntil')::timestamptz<=stamp THEN RAISE EXCEPTION 'Offboarding authority denied' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.business_data_step WHERE request_id=request) THEN RETURN; END IF;
 INSERT INTO public.business_data_step(id,business_id,request_id,kind,target_id,details,state,due_at,token_wiped,outcome)
 VALUES(gen_random_uuid(),r.business_id,r.id,'local',r.business_id::text,'{}','complete',stamp,true,'stopped');
 -- Tombstones and changed versions survive reconnect, preventing old capabilities from reviving.
 UPDATE public.discovery_run SET status='stopped',stop_reason='cancelled',execution_id=gen_random_uuid(),updated_at=stamp WHERE business_id=r.business_id AND status IN ('running','queued');
 UPDATE public.discovery_schedule SET status='paused',revision=revision+1,dispatch_key=gen_random_uuid(),next_due_at=NULL WHERE business_id=r.business_id;
 UPDATE public.inbox_connection SET active=false WHERE business_id=r.business_id;
 UPDATE public.mailbox_policy SET version=version+1,configuration=jsonb_set(configuration,'{enabled}','false'),visibility='unsafe' WHERE business_id=r.business_id;
 UPDATE public.sender_connection SET version=version+1,configuration=jsonb_set(configuration,'{enabled}','false'),updated_at=stamp WHERE business_id=r.business_id;
 UPDATE public.sender_reply_route SET version=version+1,configuration=jsonb_set(configuration,'{enabled}','false'),updated_at=stamp WHERE business_id=r.business_id;
 UPDATE public.sender_identity SET version=version+1,configuration=jsonb_set(configuration,'{enabled}','false'),updated_at=stamp WHERE business_id=r.business_id;
 UPDATE public.mailbox_job SET state=jsonb_set(jsonb_set(state,'{status}','"blocked"'),'{reason}','"scope_changed"') WHERE business_id=r.business_id AND state->>'status' IN ('queued','running');
 UPDATE public.inbox_opportunity SET control_state='human',control_version=control_version+1,handoff_reason='Business offboarding; explicit new approval required',next_action='Review retained work' WHERE business_id=r.business_id;
 UPDATE public.opportunity_due_action SET state='cancelled',reason='business_offboarding' WHERE business_id=r.business_id AND state='pending';
 UPDATE public.email_sequence_run SET state='cancelled',version=version+1,reason='business_offboarding' WHERE business_id=r.business_id AND state IN ('active','paused');
 UPDATE public.email_sequence_action SET state='cancelled',generation=generation+1,execution_key=gen_random_uuid(),queue_state='none',queue_run_id=NULL,reason='business_offboarding' WHERE business_id=r.business_id AND state IN ('pending','paused');
 -- Preserve committed/unknown provider acceptance for reconciliation; never label it unsent.
 FOR t,k IN SELECT * FROM (VALUES('gmail_grant','gmail'),('google_calendar_grant','google_calendar'),('microsoft_mail_grant','microsoft_mail'),('microsoft_calendar_grant','microsoft_calendar')) a(t,k) LOOP
   FOR g IN EXECUTE format('SELECT *,to_jsonb(x) body FROM public.%I x WHERE business_id=$1 AND (status<>''disconnected'' OR credentials IS NOT NULL OR to_jsonb(x)->>''rejected_credentials'' IS NOT NULL) FOR UPDATE',t) USING r.business_id LOOP
     INSERT INTO public.business_data_step(id,business_id,request_id,kind,target_id,details,secret,state,due_at)
     VALUES(gen_random_uuid(),r.business_id,r.id,k,g.id::text,jsonb_build_object('generation',(g.generation+1)::text,'subject',coalesce(g.account_subject,'')),
       jsonb_build_object('credentials',g.credentials,'rejected',g.body->>'rejected_credentials'),'pending',stamp);
     EXECUTE format('UPDATE public.%I SET generation=generation+1,status=''disconnected'',reason=NULL,credentials=NULL %s WHERE id=$1',t,CASE WHEN t IN ('gmail_grant','google_calendar_grant','microsoft_mail_grant') THEN ',rejected_credentials=NULL' ELSE '' END) USING g.id;
   END LOOP;
 END LOOP;
 FOR g IN SELECT * FROM public.whatsapp_connection WHERE business_id=r.business_id AND status<>'disconnected' FOR UPDATE LOOP
   INSERT INTO public.business_data_step(id,business_id,request_id,kind,target_id,details,secret,state,due_at)
   VALUES(gen_random_uuid(),r.business_id,r.id,'meta',g.id::text,jsonb_build_object('version',(g.version+1)::text,'providerKey',coalesce(g.provider_key,''),'wabaId',coalesce(g.assets->>'wabaId',''),'phoneNumberId',coalesce(g.phone_number_id,''),'numberControl','customer_owned_not_transferred','paymentAccount','customer_owned_unchanged'),jsonb_build_object('credentials',g.credentials,'rejected',NULL),'pending',stamp);
   UPDATE public.whatsapp_connection SET version=version+1,status='disconnected',credentials=NULL,operation_id=NULL WHERE id=g.id;
 END LOOP;
 UPDATE public.gmail_oauth SET consumed=true,verifier='' WHERE business_id=r.business_id;
 UPDATE public.microsoft_mail_oauth SET consumed=true,verifier='' WHERE business_id=r.business_id;
 UPDATE public.google_calendar_oauth SET consumed=true,verifier='' WHERE business_id=r.business_id;
 UPDATE public.microsoft_calendar_oauth SET consumed=true,verifier='' WHERE business_id=r.business_id;
 UPDATE public.whatsapp_oauth SET consumed=true WHERE business_id=r.business_id;
 IF (r.input->>'deleteGeneralFiles')::boolean AND (r.policy->'deletion'->>'generalFiles')::boolean THEN
   INSERT INTO public.business_data_step(id,business_id,request_id,kind,target_id,details,state,due_at,token_wiped)
   SELECT gen_random_uuid(),r.business_id,r.id,'file',f.id::text,jsonb_build_object('storageScope',f.account_scope),'pending',greatest(stamp,(r.policy->'deletion'->>'notBefore')::timestamptz,CASE WHEN f.state IN ('uploading','failed') THEN f.cleanup_after ELSE stamp END),true
   FROM public.business_file f WHERE f.business_id=r.business_id AND f.state<>'deleted' AND f.account_scope=r.policy->>'storageScope'
    AND NOT public.business_file_protected(f.id,f.business_id);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.claim_business_data_cleanup(current_policy jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.business_data_step; r public.business_data_request; shared boolean; stamp timestamptz:=statement_timestamp();
BEGIN
 IF (current_policy->>'effectiveFrom')::timestamptz>stamp OR (current_policy->>'effectiveUntil')::timestamptz<=stamp THEN RETURN; END IF;
 FOR s IN SELECT x.* FROM public.business_data_step x JOIN public.business_data_request q ON q.id=x.request_id AND q.business_id=x.business_id
 WHERE x.state IN ('pending','retry','working') AND x.due_at<=stamp AND q.policy=current_policy
 AND x.attempts<=(q.policy->>'maxAttempts')::integer ORDER BY x.due_at,x.id LIMIT 20 FOR UPDATE OF x SKIP LOCKED LOOP
   SELECT * INTO r FROM public.business_data_request WHERE id=s.request_id;
   IF s.attempts>=(r.policy->>'maxAttempts')::integer THEN
     UPDATE public.business_data_step SET state='incomplete',secret=NULL,token_wiped=true,lease=NULL,outcome='unconfirmed' WHERE id=s.id;
     INSERT INTO public.business_data_event(id,business_id,step_id,attempt,outcome) VALUES(gen_random_uuid(),s.business_id,s.id,s.attempts,'worker_lost_final_ack');
     CONTINUE;
   END IF;
   IF NOT (r.policy->'businessIds' ? s.business_id::text) THEN CONTINUE; END IF;
   IF s.kind='file' AND (public.business_file_protected(s.target_id::uuid,s.business_id) OR NOT (r.policy->'deletion'->>'generalFiles')::boolean OR (r.policy->'deletion'->>'notBefore')::timestamptz>stamp) THEN CONTINUE; END IF;
   shared:=false;
   IF s.kind IN ('gmail','google_calendar') THEN
     -- Google revokes project-wide scopes. Never revoke a still-linked identity,
     -- including a newly reconnected grant in this same Business.
     SELECT EXISTS(SELECT 1 FROM (SELECT id,business_id,account_subject,status FROM public.gmail_grant UNION ALL SELECT id,business_id,account_subject,status FROM public.google_calendar_grant) x
      WHERE x.status<>'disconnected' AND x.account_subject=s.details->>'subject') OR coalesce(s.details->>'subject','')='' INTO shared;
   ELSIF s.kind='meta' THEN
     SELECT EXISTS(SELECT 1 FROM public.whatsapp_connection c WHERE c.status<>'disconnected' AND c.assets->>'wabaId'=s.details->>'wabaId') OR coalesce(s.details->>'wabaId','')='' INTO shared;
   END IF;
   UPDATE public.business_data_step SET state='working',attempts=attempts+1,lease=gen_random_uuid(),due_at=stamp+interval '60 seconds' WHERE id=s.id RETURNING * INTO s;
   INSERT INTO public.business_data_event(id,business_id,step_id,attempt,outcome) VALUES(gen_random_uuid(),s.business_id,s.id,s.attempts,'started');
   RETURN NEXT jsonb_build_object('id',s.id,'businessId',s.business_id,'requestId',s.request_id,'kind',s.kind,'targetId',s.target_id,'attempt',s.attempts,'lease',s.lease,'details',s.details||jsonb_build_object('shared',shared::text),'secret',s.secret,'policy',r.policy);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.finish_business_data_cleanup(step uuid,lease_key uuid,result text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.business_data_step; p jsonb; terminal boolean; stamp timestamptz:=statement_timestamp();
BEGIN
 IF result IS NULL OR result NOT IN ('confirmed','subscription_removed','manual_required','shared_identity','unconfirmed') THEN RAISE EXCEPTION 'Invalid cleanup result'; END IF;
 SELECT * INTO s FROM public.business_data_step WHERE id=step FOR UPDATE;
 IF s.id IS NULL OR lease_key IS NULL OR s.lease IS DISTINCT FROM lease_key OR s.state<>'working' OR s.due_at<=stamp THEN RETURN; END IF;
 SELECT policy INTO p FROM public.business_data_request WHERE id=s.request_id AND business_id=s.business_id;
 terminal:=result<>'unconfirmed' OR s.attempts>=(p->>'maxAttempts')::integer;
 IF s.kind='file' AND result='confirmed' THEN
   IF public.business_file_protected(s.target_id::uuid,s.business_id) OR (p->'deletion'->>'notBefore')::timestamptz>stamp THEN RAISE EXCEPTION 'Protected evidence'; END IF;
   UPDATE public.business_file SET state='deleted',deleted_at=stamp,purge_after=NULL,cleanup_after=NULL,operation_id=NULL WHERE id=s.target_id::uuid AND business_id=s.business_id AND purpose='general' AND account_scope=p->>'storageScope';
 END IF;
 UPDATE public.business_data_step SET state=CASE WHEN result='confirmed' THEN 'complete' WHEN terminal THEN 'incomplete' ELSE 'retry' END,
   secret=CASE WHEN terminal THEN NULL ELSE secret END,token_wiped=token_wiped OR terminal,
   outcome=result,due_at=stamp+make_interval(secs=>(p->>'retrySeconds')::integer),lease=NULL WHERE id=s.id;
 INSERT INTO public.business_data_event(id,business_id,step_id,attempt,outcome) VALUES(gen_random_uuid(),s.business_id,s.id,s.attempts,result);
END $$;
CREATE OR REPLACE FUNCTION public.business_data_cleanup_current(step uuid,lease_key uuid,current_policy jsonb) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT lease_key IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.business_data_step s JOIN public.business_data_request r ON r.id=s.request_id AND r.business_id=s.business_id
 WHERE s.id=step AND s.lease=lease_key AND s.state='working' AND s.due_at>statement_timestamp()
 AND r.policy=current_policy AND r.policy->'businessIds' ? s.business_id::text
 AND (r.policy->>'effectiveFrom')::timestamptz<=statement_timestamp() AND (r.policy->>'effectiveUntil')::timestamptz>statement_timestamp()
 AND (s.kind<>'file' OR ((r.policy->'deletion'->>'generalFiles')::boolean AND (r.policy->'deletion'->>'notBefore')::timestamptz<=statement_timestamp()
   AND NOT public.business_file_protected(s.target_id::uuid,s.business_id)
   AND EXISTS(SELECT 1 FROM public.business_file f WHERE f.id=s.target_id::uuid AND f.business_id=s.business_id AND f.purpose='general' AND f.account_scope=r.policy->>'storageScope')))
 AND (s.kind NOT IN ('gmail','google_calendar') OR (coalesce(s.details->>'subject','')<>'' AND NOT EXISTS(
   SELECT 1 FROM (SELECT account_subject,status FROM public.gmail_grant UNION ALL SELECT account_subject,status FROM public.google_calendar_grant) g
   WHERE g.status<>'disconnected' AND g.account_subject=s.details->>'subject')))
 AND (s.kind<>'meta' OR (coalesce(s.details->>'wabaId','')<>'' AND NOT EXISTS(
   SELECT 1 FROM public.whatsapp_connection c WHERE c.status<>'disconnected' AND c.assets->>'wabaId'=s.details->>'wabaId'))))
$$;
CREATE OR REPLACE FUNCTION public.guard_data_identity_reconnect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.account_subject IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('google-consent:'||NEW.account_subject,0));
   IF NEW.status IN ('connected','ready','selection_required') AND
     (TG_OP='INSERT' OR OLD.status IN ('connecting','disconnected') OR OLD.account_subject IS DISTINCT FROM NEW.account_subject)
     AND EXISTS(SELECT 1 FROM (
       SELECT 'gmail_grant' kind,id,account_subject,status FROM public.gmail_grant
       UNION ALL SELECT 'google_calendar_grant',id,account_subject,status FROM public.google_calendar_grant
     ) g WHERE g.account_subject=NEW.account_subject AND g.status='revocation_pending' AND (g.kind<>TG_TABLE_NAME OR g.id<>NEW.id))
     THEN RAISE EXCEPTION 'Provider identity revocation pending' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.status<>'disconnected' AND NEW.account_subject IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.business_data_step s WHERE s.kind IN ('gmail','google_calendar') AND s.details->>'subject'=NEW.account_subject AND s.state IN ('pending','working','retry')) THEN
 RAISE EXCEPTION 'Provider identity cleanup pending' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.google_primary_revocable(kind text,target uuid,expected_generation integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE subject text; business uuid;
BEGIN
 IF coalesce(current_setting('app.business_id',true),'')='' THEN RETURN false; END IF;
 IF coalesce(public.current_business_role(),'') NOT IN ('owner','admin') THEN RAISE insufficient_privilege; END IF;
 SELECT g.account_subject,g.business_id INTO subject,business FROM (
   SELECT 'gmail' kind,id,business_id,generation,status,credentials,account_subject FROM public.gmail_grant
   UNION ALL SELECT 'google_calendar',id,business_id,generation,status,credentials,account_subject FROM public.google_calendar_grant
 ) g WHERE g.kind=$1 AND g.id=target AND g.generation=$3 AND g.status='revocation_pending' AND g.credentials IS NOT NULL
   AND g.business_id::text=current_setting('app.business_id',true);
 IF subject IS NULL OR subject='' THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('google-consent:'||subject,0));
 IF NOT EXISTS(SELECT 1 FROM public.membership m JOIN public.session s ON s.user_id=m.user_id
   JOIN public."user" u ON u.id=m.user_id JOIN public.two_factor f ON f.user_id=u.id
   WHERE m.business_id=business AND m.user_id=current_setting('app.actor_id',true) AND m.role IN ('owner','admin')
   AND s.id=current_setting('app.pilot_session',true) AND s.expires_at>clock_timestamp()
   AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id
   AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')
   AND s.mfa_verified_at<=clock_timestamp() AND s.mfa_verified_at>clock_timestamp()-interval '12 hours')
   THEN RAISE insufficient_privilege; END IF;
 -- Subject attribution applies only to this adopted primary. Legacy grants do
 -- not persist client IDs, so conservatively protect this subject across both
 -- configured Google clients. This returns no other Business's grant or secret.
 RETURN NOT EXISTS(SELECT 1 FROM (
   SELECT 'gmail' kind,id,account_subject,status FROM public.gmail_grant
   UNION ALL SELECT 'google_calendar',id,account_subject,status FROM public.google_calendar_grant
 ) g WHERE g.account_subject=subject AND g.status<>'disconnected' AND (g.kind<>$1 OR g.id<>target));
END $$;
CREATE OR REPLACE FUNCTION public.record_business_data_evidence(step uuid,fact text,reference text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.business_data_step;
BEGIN
 SELECT * INTO s FROM public.business_data_step WHERE id=step;
 IF s.id IS NULL OR s.business_id IS DISTINCT FROM nullif(current_setting('app.business_id',true),'')::uuid OR coalesce(public.current_business_role(),'') NOT IN ('owner','admin') OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN RAISE EXCEPTION 'Evidence authority denied' USING ERRCODE='42501'; END IF;
 IF fact IS NULL OR reference IS NULL OR fact NOT IN ('external_consent_removal_reported','number_transfer_reported','number_control_reviewed') OR length(reference) NOT BETWEEN 1 AND 500 OR reference ~ '[[:cntrl:]?&#=<>]' OR reference ~* '(https?://|Bearer[[:space:]]|(password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|execution[_ -]?key|dispatch[_ -]?key|recovery[_ -]?key)[[:space:]]*:)' OR (fact IN ('number_transfer_reported','number_control_reviewed') AND s.kind<>'meta') THEN RAISE EXCEPTION 'Evidence fact denied'; END IF;
 INSERT INTO public.business_data_event(id,business_id,step_id,attempt,outcome,actor_id,evidence) VALUES(gen_random_uuid(),s.business_id,s.id,s.attempts,fact,current_setting('app.actor_id',true),reference);
 -- A customer's report does not turn an unsupported API into provider confirmation.
END $$;
CREATE OR REPLACE FUNCTION public.expire_business_data_secrets() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 WITH due AS (
 SELECT s.id FROM public.business_data_step s JOIN public.business_data_request r ON r.id=s.request_id AND r.business_id=s.business_id
 WHERE s.secret IS NOT NULL AND ((r.policy->>'effectiveUntil')::timestamptz<=statement_timestamp()
 OR r.at+make_interval(secs=>((r.policy->>'maxAttempts')::integer*((r.policy->>'retrySeconds')::integer+60)))<=statement_timestamp()
 OR s.state='working' AND s.due_at<=statement_timestamp() AND s.attempts>=(r.policy->>'maxAttempts')::integer)
 ORDER BY s.due_at,s.id LIMIT 100 FOR UPDATE OF s SKIP LOCKED
 ), changed AS (
 UPDATE public.business_data_step s SET secret=NULL,token_wiped=true,state='incomplete',lease=NULL,outcome='revocation_window_expired'
 FROM due WHERE s.id=due.id RETURNING s.*
 ) INSERT INTO public.business_data_event(id,business_id,step_id,attempt,outcome)
 SELECT gen_random_uuid(),business_id,id,attempts,'revocation_window_expired' FROM changed;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.guard_data_meta_reconnect() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'disconnected' AND NEW.assets->>'wabaId' IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.business_data_step s WHERE s.kind='meta' AND s.details->>'wabaId'=NEW.assets->>'wabaId' AND s.state IN ('pending','working','retry')) THEN
 RAISE EXCEPTION 'Provider identity cleanup pending' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.claim_business_exports(scope text) RETURNS TABLE(id uuid,business_id uuid,lease uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY WITH due AS (
 SELECT x.id FROM public.business_data_export x WHERE x.policy->>'storageScope'=scope
 AND x.expires_at<=statement_timestamp() AND x.cleanup_due_at<=statement_timestamp()
 AND x.state<>'deleted' AND x.cleanup_attempts<(x.policy->>'maxAttempts')::integer
 ORDER BY x.expires_at,x.id LIMIT 20 FOR UPDATE SKIP LOCKED
 ), changed AS (
 UPDATE public.business_data_export x SET state='deleting',cleanup_attempts=cleanup_attempts+1,cleanup_lease=gen_random_uuid(),cleanup_due_at=statement_timestamp()+interval '60 seconds'
 FROM due WHERE x.id=due.id RETURNING x.id,x.business_id,x.cleanup_lease
 ) SELECT * FROM changed;
END $$;
CREATE OR REPLACE FUNCTION public.finish_business_export_cleanup(target uuid,lease_key uuid,success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.business_data_export x SET state=CASE WHEN success THEN 'deleted' ELSE 'deleting' END,
 cleanup_due_at=statement_timestamp()+make_interval(secs=>(x.policy->>'retrySeconds')::integer),cleanup_lease=NULL
 WHERE x.id=target AND x.state='deleting' AND x.cleanup_lease=lease_key AND x.cleanup_due_at>statement_timestamp() AND x.expires_at<=statement_timestamp();
END $$;
CREATE OR REPLACE FUNCTION public.business_export_cleanup_current(target uuid,lease_key uuid,scope text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT lease_key IS NOT NULL AND EXISTS(SELECT 1 FROM public.business_data_export x WHERE x.id=target AND x.cleanup_lease=lease_key
 AND x.state='deleting' AND x.cleanup_due_at>statement_timestamp() AND x.expires_at<=statement_timestamp() AND x.policy->>'storageScope'=scope)
$$;
CREATE OR REPLACE FUNCTION public.business_file_cleanup_current(target uuid,operation uuid,scope text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT operation IS NOT NULL AND EXISTS(SELECT 1 FROM public.business_file f WHERE f.id=target AND f.operation_id=operation
 AND f.account_scope=scope AND f.state='deleting' AND f.cleanup_after>statement_timestamp()
 AND NOT public.business_file_protected(f.id,f.business_id)
 AND NOT EXISTS(SELECT 1 FROM public.business_data_step s WHERE s.business_id=f.business_id AND s.target_id=f.id::text AND s.kind='file' AND s.state IN ('pending','retry','working')))
$$;
CREATE OR REPLACE FUNCTION public.guard_data_export_update() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.sha256 IS NOT NULL AND (NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.sha256 IS DISTINCT FROM OLD.sha256) THEN RAISE EXCEPTION 'Immutable artifact'; END IF;
 IF NEW.state='ready' AND OLD.state<>'pending' THEN RAISE EXCEPTION 'Artifact transition denied'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_data_grant_use() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.used_at IS NOT NULL OR OLD.expires_at<=statement_timestamp() OR NEW.used_at IS NULL THEN RAISE EXCEPTION 'Expired or consumed export grant' USING ERRCODE='42501'; END IF;
 NEW.used_at:=statement_timestamp();
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_business_data_write() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user<>(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass) AND public.business_data_stopped(NEW.business_id) THEN
   RAISE EXCEPTION 'Business automation stopped' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
`;
