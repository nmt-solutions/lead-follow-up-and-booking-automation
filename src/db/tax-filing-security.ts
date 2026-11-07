import type { Pool, PoolClient } from "pg";

export const taxFilingTables = [
  "tax_filing_export",
  "tax_filing_policy",
  "tax_filing_policy_decision",
  "tax_filing_intent",
  "tax_filing_event",
  "tax_filing_evidence",
  "tax_filing_access",
  "tax_remittance_allocation",
  "tax_remittance_review",
];
export const taxFilingFunctions = [
  "tax_filing_artifact_store",
  "tax_filing_artifact_read",
  "tax_filing_status",
];
export const taxFilingPrivateFunctions = [
  "tax_filing_session_current",
  "tax_filing_fulfillment",
  "tax_filing_binding_guard",
];
export const taxFilingGuardTables = [
  "tax_filing_intent",
  "tax_filing_event",
  "tax_filing_access",
  "tax_remittance_allocation",
  "tax_remittance_review",
];
export async function prepareTaxFilingSecurity(pool: Pool | PoolClient) {
  for (const table of [...taxFilingTables, "tax_filing_bytes"])
    await pool.query(
      `DO $$ BEGIN IF to_regclass('public.${table}') IS NOT NULL THEN REVOKE ALL ON public.${table} FROM app_runtime; END IF; END $$`,
    );
  await pool.query(
    `DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY[${taxFilingFunctions.map((n) => `'${n}'`).join(",")}]) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM app_runtime',f.signature); END LOOP; END $$`,
  );
}
export async function secureTaxFilings(pool: Pool | PoolClient) {
  for (const table of taxFilingTables)
    await pool.query(
      `REVOKE ALL ON public.${table} FROM app_runtime; GRANT SELECT,INSERT ON public.${table} TO app_runtime; ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`,
    );
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.tax_filing_session_current() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE observed timestamptz; BEGIN
      IF NOT public.tax_reporting_operator() THEN RETURN false; END IF;
      observed:=nullif(current_setting('app.tax_at',true),'')::timestamptz;
      RETURN observed IS NOT NULL AND EXISTS(SELECT 1 FROM public.session s JOIN public."user" u ON u.id=s.user_id AND u.two_factor_enabled JOIN public.two_factor f ON f.user_id=u.id AND f.verified
        WHERE s.id=current_setting('app.tax_session_id',true) AND s.user_id=current_setting('app.actor_id',true) AND s.expires_at>observed
          AND s.mfa_factor_id=f.id AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')
          AND s.mfa_verified_at<=observed AND s.mfa_verified_at>observed-interval '15 minutes');
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_filing_fulfillment(period_ref uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE p record; o record; d record; r record; a record; c record; cd record; configured boolean:=false; current_report boolean:=false;
      filed boolean:=false; current_filed boolean:=false; paid boolean:=false; fulfilled boolean:=false; liability numeric; allocated numeric:=0; historical numeric:=0; unresolved integer:=0;
    BEGIN
      SELECT * INTO p FROM public.tax_reporting_period WHERE id=period_ref;
      SELECT * INTO o FROM public.tax_obligation_revision WHERE key=p.definition->>'obligationKey' ORDER BY version DESC LIMIT 1;
      SELECT * INTO d FROM public.tax_obligation_decision WHERE revision_id=o.id ORDER BY version DESC LIMIT 1;
      SELECT * INTO r FROM public.tax_liability_report WHERE period_id=p.id ORDER BY revision DESC LIMIT 1;
      SELECT * INTO a FROM public.tax_report_action WHERE report_id=r.id ORDER BY version DESC LIMIT 1;
      SELECT * INTO c FROM public.tax_filing_policy WHERE obligation_id=o.id ORDER BY version DESC LIMIT 1;
      SELECT * INTO cd FROM public.tax_filing_policy_decision WHERE policy_id=c.id ORDER BY version DESC LIMIT 1;
      configured:=coalesce(c.definition->>'adapter'='manual_evidence_v1' AND cd.outcome='approved' AND d.outcome='approved' AND (c.definition->>'effectiveFrom')::timestamptz<=statement_timestamp() AND coalesce((c.definition->>'effectiveUntil')::timestamptz,'infinity')>statement_timestamp()
        AND EXISTS(SELECT 1 FROM public.platform_operator op JOIN public."user" u ON u.id=op.user_id AND u.two_factor_enabled WHERE op.user_id=cd.actor_id AND op.tax AND o.definition->'reviewerIds' ? op.user_id AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)),false);
      current_report:=coalesce(r.id IS NOT NULL AND r.snapshot->'obligation'->>'id'=o.id::text AND a.kind='approve' AND d.outcome='approved'
        AND NOT EXISTS(SELECT 1 FROM public.tax_reporting_period newer WHERE newer.supersedes_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM public.tax_report_action invalid WHERE invalid.report_id=r.id AND invalid.kind='invalidated')
        AND EXISTS(SELECT 1 FROM public.platform_operator op JOIN public."user" u ON u.id=op.user_id AND u.two_factor_enabled WHERE op.user_id=a.actor_id AND op.tax AND o.definition->'reviewerIds' ? op.user_id AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)),false);
      SELECT EXISTS(SELECT 1 FROM public.tax_filing_intent i JOIN public.tax_filing_event e ON e.intent_id=i.id AND e.kind='confirm' WHERE i.kind='submission'
        AND i.target->>'obligationKey'=p.definition->>'obligationKey' AND i.target->>'start'=p.definition->>'start' AND i.target->>'end'=p.definition->>'end') INTO filed;
      SELECT EXISTS(SELECT 1 FROM public.tax_filing_intent i JOIN public.tax_filing_event e ON e.intent_id=i.id AND e.kind='confirm' WHERE i.kind='submission' AND i.report_id=r.id AND i.report_approval_id=a.id AND i.policy_id=c.id AND i.policy_decision_id=cd.id) INTO current_filed;
      SELECT coalesce(sum(x.amount_minor::numeric),0) INTO allocated FROM public.tax_remittance_allocation x JOIN public.tax_filing_intent i ON i.id=x.intent_id
        LEFT JOIN LATERAL(SELECT v.report_id,v.policy_id,v.policy_decision_id,v.report_approval_id FROM public.tax_remittance_review v WHERE v.allocation_id=x.id ORDER BY v.version DESC LIMIT 1) review ON true
        WHERE coalesce(review.report_id,x.report_id)=r.id AND x.currency=r.snapshot->>'currency'
          AND coalesce(review.policy_id,i.policy_id)=c.id AND coalesce(review.policy_decision_id,i.policy_decision_id)=cd.id AND coalesce(review.report_approval_id,i.report_approval_id)=a.id;
      SELECT coalesce(sum(x.amount_minor::numeric),0) INTO historical FROM public.tax_remittance_allocation x JOIN public.tax_filing_intent i ON i.id=x.intent_id
        WHERE i.target->>'obligationKey'=p.definition->>'obligationKey' AND i.target->>'start'=p.definition->>'start' AND i.target->>'end'=p.definition->>'end';
      SELECT count(*)::integer INTO unresolved FROM public.tax_filing_event e JOIN public.tax_filing_intent i ON i.id=e.intent_id
        WHERE i.report_id=r.id AND (e.kind='acknowledge' AND (e.detail->>'matches'='false' OR e.detail->>'contradiction'='true') OR e.kind='raise_issue')
          AND NOT EXISTS(SELECT 1 FROM public.tax_filing_event resolved WHERE resolved.intent_id=i.id AND resolved.kind='resolve_issue' AND resolved.detail->>'issueId'=e.id::text);
      liability:=(r.snapshot->'totals'->>'taxMinor')::numeric;
      paid:=coalesce(allocated>0 AND liability>=0 AND allocated>=liability,false);
      fulfilled:=coalesce(configured AND current_report AND unresolved=0 AND historical=allocated AND allocated<=greatest(liability,0)
        AND (c.definition->>'filingRequired'='false' OR current_filed) AND (c.definition->>'paymentRequired'='false' OR paid),false);
      RETURN jsonb_build_object('configured',configured,'reportId',r.id,'filed',filed,'currentRevisionFiled',current_filed,'paid',paid,'fulfilled',fulfilled,
        'filingRequired',CASE WHEN configured THEN (c.definition->>'filingRequired')::boolean ELSE NULL END,'paymentRequired',CASE WHEN configured THEN (c.definition->>'paymentRequired')::boolean ELSE NULL END,
        'liabilityMinor',liability::text,'confirmedPaidMinor',allocated::text,'historicalPaidMinor',historical::text,'unallocatedPaidMinor',(historical-allocated)::text,
        'remainingMinor',CASE WHEN liability IS NULL THEN NULL ELSE greatest(liability-allocated,0)::text END,'overpaidMinor',CASE WHEN liability IS NULL THEN '0' ELSE greatest(allocated-greatest(liability,0),0)::text END,
        'correctionRequired',filed AND (NOT current_report OR NOT current_filed),'unresolvedEvidenceCount',unresolved);
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_filing_status(period_ref uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.tax_reporting_operator() THEN RETURN NULL; END IF;
      RETURN public.tax_filing_fulfillment(period_ref);
    END $$;
    REVOKE ALL ON public.tax_filing_bytes FROM app_runtime;
    ALTER TABLE public.tax_filing_bytes FORCE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION public.tax_filing_artifact_store(evidence_ref uuid,original_base64 text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE e record; original bytea; BEGIN
      IF NOT public.tax_filing_session_current() THEN RETURN false; END IF;
      SELECT * INTO e FROM public.tax_filing_evidence WHERE id=evidence_ref AND actor_id=current_setting('app.actor_id',true);
      IF NOT FOUND OR e.storage_database IS DISTINCT FROM current_database() OR original_base64 IS NULL OR length(original_base64)>2796204 THEN RETURN false; END IF;
      original:=decode(original_base64,'base64');
      IF octet_length(original) IS DISTINCT FROM (e.metadata->>'size')::integer OR octet_length(original) NOT BETWEEN 1 AND 2097152 OR encode(sha256(original),'hex') IS DISTINCT FROM e.metadata->>'sha256' THEN RETURN false; END IF;
      INSERT INTO public.tax_filing_bytes(id,body) VALUES(e.id,original_base64) ON CONFLICT(id) DO NOTHING;
      RETURN EXISTS(SELECT 1 FROM public.tax_filing_bytes b WHERE b.id=e.id AND b.body=original_base64);
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_filing_artifact_read(access_ref uuid,grant_hash text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE result text; BEGIN
      IF NOT public.tax_filing_session_current() THEN RETURN NULL; END IF;
      SELECT b.body INTO result FROM public.tax_filing_access a JOIN public.tax_filing_evidence e ON e.id=a.evidence_id JOIN public.tax_filing_bytes b ON b.id=e.id
      WHERE a.id=access_ref AND a.access_hash=grant_hash AND a.actor_id=current_setting('app.actor_id',true)
        AND a.session_id=current_setting('app.tax_session_id',true)
        AND a.at<=statement_timestamp() AND a.expires_at>statement_timestamp()
        AND encode(sha256(decode(b.body,'base64')),'hex')=e.metadata->>'sha256'
        AND octet_length(decode(b.body,'base64'))=(e.metadata->>'size')::integer;
      RETURN result;
    END $$;
    REVOKE ALL ON FUNCTION public.tax_filing_fulfillment(uuid) FROM PUBLIC,app_runtime;
    REVOKE ALL ON FUNCTION public.tax_filing_session_current() FROM PUBLIC,app_runtime;
    REVOKE ALL ON FUNCTION public.tax_filing_artifact_store(uuid,text),public.tax_filing_artifact_read(uuid,text),public.tax_filing_status(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.tax_filing_artifact_store(uuid,text),public.tax_filing_artifact_read(uuid,text),public.tax_filing_status(uuid) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.tax_filing_binding_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE i record; r record; p record; d record; approval record; ack record; artifact record; confirmed record; allocation record; expected jsonb;
    BEGIN
      IF NOT public.tax_filing_session_current() OR NEW.actor_id<>current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Tax filing scope denied' USING ERRCODE='42501'; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('tax-reporting',0));
      IF TG_TABLE_NAME='tax_filing_access' THEN
        IF NEW.session_id<>current_setting('app.tax_session_id',true) THEN RAISE EXCEPTION 'Tax filing access denied' USING ERRCODE='42501'; END IF;
        NEW.at:=statement_timestamp(); NEW.expires_at:=NEW.at+interval '30 seconds'; RETURN NEW;
      END IF;
      IF TG_TABLE_NAME IN ('tax_filing_intent','tax_remittance_review') THEN
        SELECT * INTO r FROM public.tax_liability_report WHERE id=NEW.report_id;
        SELECT * INTO p FROM public.tax_filing_policy WHERE id=NEW.policy_id;
        SELECT * INTO d FROM public.tax_filing_policy_decision WHERE id=NEW.policy_decision_id;
        SELECT * INTO approval FROM public.tax_report_action WHERE id=NEW.report_approval_id;
        IF r.id IS NULL OR p.id IS NULL OR d.id IS NULL OR approval.id IS NULL OR p.obligation_id::text<>r.snapshot->'obligation'->>'id'
          OR d.policy_id<>p.id OR d.outcome<>'approved' OR approval.report_id<>r.id OR approval.kind<>'approve'
          OR p.definition->>'adapter' IS DISTINCT FROM 'manual_evidence_v1'
          OR EXISTS(SELECT 1 FROM public.tax_filing_policy newer WHERE newer.obligation_id=p.obligation_id AND newer.version>p.version)
          OR EXISTS(SELECT 1 FROM public.tax_filing_policy_decision newer WHERE newer.policy_id=p.id AND newer.version>d.version)
          OR EXISTS(SELECT 1 FROM public.tax_report_action newer WHERE newer.report_id=r.id AND newer.version>approval.version)
          OR EXISTS(SELECT 1 FROM public.tax_liability_report newer WHERE newer.period_id=r.period_id AND newer.revision>r.revision)
          OR EXISTS(SELECT 1 FROM public.tax_reporting_period newer WHERE newer.supersedes_id=r.period_id)
          OR r.snapshot->>'sourceFingerprint' IS DISTINCT FROM public.tax_reporting_sources(r.period_id)->>'fingerprint'
          THEN RAISE EXCEPTION 'Tax filing report binding denied' USING ERRCODE='23514'; END IF;
        expected:=jsonb_build_object('reportId',r.id,'periodId',r.period_id,'revision',r.revision,'digest',r.digest,'approvalId',approval.id,
          'obligationId',p.obligation_id,'obligationKey',r.snapshot->'obligation'->>'key','registration',r.snapshot->'obligation'->'definition'->'registration'->>'identifier',
          'jurisdiction',r.snapshot->'obligation'->'definition'->>'jurisdiction','mode',r.snapshot->'obligation'->'definition'->>'mode','currency',r.snapshot->>'currency',
          'authorityAccount',p.definition->>'authorityAccount','fundingAccount',p.definition->>'fundingAccount','returnType',p.definition->>'returnType',
          'start',r.snapshot->'period'->>'start','end',r.snapshot->'period'->>'end');
        IF TG_TABLE_NAME='tax_filing_intent' THEN
          IF NEW.target IS DISTINCT FROM expected OR NEW.report->'snapshot' IS DISTINCT FROM r.snapshot OR NEW.report->>'digest' IS DISTINCT FROM r.digest OR (NEW.report->>'revision')::integer IS DISTINCT FROM r.revision
            OR NEW.policy->'definition' IS DISTINCT FROM p.definition THEN RAISE EXCEPTION 'Tax filing original binding denied' USING ERRCODE='23514'; END IF;
          IF NEW.supersedes_id IS NOT NULL THEN
            SELECT * INTO i FROM public.tax_filing_intent WHERE id=NEW.supersedes_id;
            IF i.id IS NULL OR i.kind<>NEW.kind OR i.target->>'obligationKey' IS DISTINCT FROM expected->>'obligationKey'
              OR i.target->>'start' IS DISTINCT FROM expected->>'start' OR i.target->>'end' IS DISTINCT FROM expected->>'end'
              OR NOT EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.id AND e.kind='supersede')
              OR EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.id AND e.kind='confirm')
              THEN RAISE EXCEPTION 'Tax filing replacement lineage denied' USING ERRCODE='23514'; END IF;
          END IF;
          IF NEW.amendment_of IS NOT NULL THEN
            SELECT * INTO i FROM public.tax_filing_intent WHERE id=NEW.amendment_of;
            IF i.id IS NULL OR NEW.kind<>'submission' OR i.kind<>'submission' OR i.report_id=NEW.report_id
              OR i.target->>'obligationKey' IS DISTINCT FROM expected->>'obligationKey' OR i.target->>'start' IS DISTINCT FROM expected->>'start' OR i.target->>'end' IS DISTINCT FROM expected->>'end'
              OR NOT EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.id AND e.kind='confirm')
              THEN RAISE EXCEPTION 'Tax filing amendment lineage denied' USING ERRCODE='23514'; END IF;
          END IF;
        ELSE
          SELECT * INTO allocation FROM public.tax_remittance_allocation WHERE id=NEW.allocation_id;
          SELECT * INTO i FROM public.tax_filing_intent WHERE id=allocation.intent_id;
          IF i.id IS NULL OR allocation.currency<>expected->>'currency'
            OR (i.target-ARRAY['reportId','periodId','revision','digest','approvalId','obligationId'])<>(expected-ARRAY['reportId','periodId','revision','digest','approvalId','obligationId'])
            THEN RAISE EXCEPTION 'Tax remittance reallocation denied' USING ERRCODE='23514'; END IF;
        END IF;
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME='tax_remittance_allocation' THEN
        SELECT * INTO confirmed FROM public.tax_filing_event WHERE id=NEW.confirmation_id;
        SELECT * INTO i FROM public.tax_filing_intent WHERE id=NEW.intent_id;
        SELECT * INTO artifact FROM public.tax_filing_evidence WHERE id=NEW.evidence_id;
        IF confirmed.id IS NULL OR i.id IS NULL OR artifact.id IS NULL OR confirmed.kind<>'confirm' OR confirmed.intent_id<>i.id OR i.kind<>'remittance'
          OR confirmed.detail->>'evidenceId'<>artifact.id::text OR NEW.report_id<>i.report_id OR NEW.currency<>i.target->>'currency'
          OR NEW.amount_minor<>artifact.metadata->>'amountMinor' OR NEW.amount_minor<>i.amount_minor OR NEW.reference_key<>confirmed.confirmation_key
          THEN RAISE EXCEPTION 'Tax remittance allocation denied' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END IF;
      SELECT * INTO i FROM public.tax_filing_intent WHERE id=NEW.intent_id;
      IF i.id IS NULL THEN RAISE EXCEPTION 'Tax filing intent denied' USING ERRCODE='23514'; END IF;
      IF NEW.kind IN ('approve','attempt') THEN
        IF EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.id AND (e.kind='attempt' OR e.kind='acknowledge' AND e.detail->>'matches'='true'))
          THEN RAISE EXCEPTION 'Tax filing initiation already observed' USING ERRCODE='23514'; END IF;
        SELECT * INTO approval FROM public.tax_report_action WHERE report_id=i.report_id ORDER BY version DESC LIMIT 1;
        SELECT * INTO d FROM public.tax_filing_policy_decision WHERE policy_id=i.policy_id ORDER BY version DESC LIMIT 1;
        IF approval.id<>i.report_approval_id OR approval.kind<>'approve' OR d.id<>i.policy_decision_id OR d.outcome<>'approved'
          OR i.supersedes_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.supersedes_id AND e.kind='confirm')
          OR EXISTS(SELECT 1 FROM public.tax_filing_policy newer WHERE newer.obligation_id=(i.target->>'obligationId')::uuid AND newer.version>(i.policy->>'version')::integer)
          OR i.report->'snapshot'->>'sourceFingerprint' IS DISTINCT FROM public.tax_reporting_sources((i.target->>'periodId')::uuid)->>'fingerprint'
          THEN RAISE EXCEPTION 'Tax filing current approval denied' USING ERRCODE='23514'; END IF;
      ELSIF NEW.kind='confirm' THEN
        SELECT * INTO ack FROM public.tax_filing_event WHERE id=(NEW.detail->>'acknowledgementId')::uuid AND intent_id=i.id AND kind='acknowledge';
        SELECT * INTO artifact FROM public.tax_filing_evidence WHERE id=(NEW.detail->>'evidenceId')::uuid;
        IF ack.id IS NULL OR artifact.id IS NULL OR ack.detail->>'evidenceId' IS DISTINCT FROM artifact.id::text OR ack.detail->>'matches' IS DISTINCT FROM 'true'
          OR artifact.report_id<>i.report_id OR artifact.target IS DISTINCT FROM i.target OR artifact.metadata->>'amountMinor' IS DISTINCT FROM i.amount_minor
          OR artifact.metadata->>'result' IS DISTINCT FROM (CASE WHEN i.kind='submission' THEN 'filed' ELSE 'settled' END)
          OR artifact.metadata->>'kind' IS DISTINCT FROM (CASE WHEN i.kind='submission' THEN 'authority_acknowledgement' ELSE 'bank_confirmation' END)
          OR NEW.actor_id IN (i.actor_id,artifact.actor_id) OR NEW.detail->>'sha256' IS DISTINCT FROM artifact.metadata->>'sha256'
          OR NOT EXISTS(SELECT 1 FROM public.tax_filing_bytes b WHERE b.id=artifact.id AND encode(sha256(decode(b.body,'base64')),'hex')=artifact.metadata->>'sha256')
          THEN RAISE EXCEPTION 'Tax filing confirmation denied' USING ERRCODE='23514'; END IF;
      ELSIF NEW.kind='supersede' THEN
        SELECT * INTO artifact FROM public.tax_filing_evidence WHERE id=(NEW.detail->>'evidenceId')::uuid;
        IF artifact.id IS NULL OR artifact.target IS DISTINCT FROM i.target OR artifact.report_id<>i.report_id OR artifact.metadata->>'amountMinor' IS DISTINCT FROM i.amount_minor
          OR artifact.metadata->>'result' IS DISTINCT FROM 'no_effect' OR NEW.actor_id IN(i.actor_id,artifact.actor_id)
          OR artifact.metadata->>'kind' IS DISTINCT FROM (CASE WHEN i.kind='submission' THEN 'authority_acknowledgement' ELSE 'bank_confirmation' END)
          OR EXISTS(SELECT 1 FROM public.tax_filing_event e WHERE e.intent_id=i.id AND e.kind='confirm')
          OR NOT EXISTS(SELECT 1 FROM public.tax_filing_bytes b WHERE b.id=artifact.id AND encode(sha256(decode(b.body,'base64')),'hex')=artifact.metadata->>'sha256')
          THEN RAISE EXCEPTION 'Tax filing supersession denied' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.tax_filing_binding_guard() FROM PUBLIC,app_runtime;
  `);
  for (const table of taxFilingGuardTables)
    await pool.query(
      `DROP TRIGGER IF EXISTS tax_filing_binding_guard ON public.${table}; CREATE TRIGGER tax_filing_binding_guard BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.tax_filing_binding_guard()`,
    );
}
export async function verifyTaxFilings(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(
    `SELECT
    (SELECT count(*)=$1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[]))
    AND (SELECT count(*)=1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND NOT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='tax_filing_bytes')
    AND (SELECT count(*)=$3 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($4::text[]))
    AND (SELECT count(*)=$5 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND NOT has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($6::text[]))
    AND (SELECT count(*)=31 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conrelid IN(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[]||ARRAY['tax_filing_bytes'])))
    AND (SELECT count(*)=28 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename=ANY($2::text[]||ARRAY['tax_filing_bytes']))
    AND (SELECT count(*)=$7 AND bool_and(tgenabled='O' AND tgfoid='public.tax_filing_binding_guard()'::regprocedure) FROM pg_trigger WHERE tgname='tax_filing_binding_guard') AS safe`,
    [
      taxFilingTables.length,
      taxFilingTables,
      taxFilingFunctions.length,
      taxFilingFunctions,
      taxFilingPrivateFunctions.length,
      taxFilingPrivateFunctions,
      taxFilingGuardTables.length,
    ],
  );
  if (!result.rows[0]?.safe)
    throw new Error("Tax filing database privileges are incomplete");
}
