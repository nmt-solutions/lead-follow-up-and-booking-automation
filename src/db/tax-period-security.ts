import type { Pool, PoolClient } from "pg";

export const taxPeriodTables = [
  "tax_obligation_revision",
  "tax_obligation_decision",
  "tax_reporting_period",
  "tax_liability_report",
  "tax_report_action",
  "tax_period_reminder",
];
export const taxPeriodFunctions = [
  "tax_reporting_operator",
  "tax_reporting_sources",
  "tax_reporting_due",
  "tax_reminder_visible",
  "tax_reporting_people",
];
export const taxSourceTables = [
  "seller_document",
  "subscription_period",
  "financial_case_event",
  "tax_obligation_revision",
  "tax_obligation_decision",
  "tax_reporting_period",
];

/** A narrow tax projection. No raw financial table or private native capability is granted. */
export async function prepareTaxPeriodSecurity(pool: Pool | PoolClient) {
  for (const name of taxPeriodTables)
    await pool.query(
      `DO $$ BEGIN IF to_regclass('public.${name}') IS NOT NULL THEN REVOKE ALL ON public.${name} FROM app_runtime; END IF; END $$`,
    );
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.tax_reporting_operator() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN nullif(current_setting('app.business_id',true),'') IS NULL AND EXISTS(SELECT 1 FROM public.platform_operator o WHERE o.user_id=current_setting('app.actor_id',true) AND o.tax);
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_reporting_sources(period_ref uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; config jsonb; result jsonb; BEGIN
      IF NOT public.tax_reporting_operator() THEN RETURN NULL; END IF;
      SELECT * INTO p FROM public.tax_reporting_period WHERE id=period_ref;
      IF NOT FOUND THEN RETURN NULL; END IF;
      SELECT definition INTO config FROM public.tax_obligation_revision WHERE id=p.obligation_id;
      SELECT jsonb_build_object(
        'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'businessId',d.business_id,'periodId',d.period_id,'originalId',d.original_id,'adjustmentId',d.adjustment_id,'kind',d.kind,'number',d.number,'at',to_char(d.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'artifactState',d.artifact_state,
          'snapshot',jsonb_build_object('lines',d.snapshot->'lines','totals',d.snapshot->'totals','currency',d.snapshot->'currency','original',d.snapshot->'original','adjustment',d.snapshot->'adjustment','source',d.snapshot->'source')) ORDER BY d.at,d.id)
          FROM public.seller_document d WHERE d.snapshot->'issuer'->'revision'->'configuration'->>'mode'=config->>'mode'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(d.snapshot->'lines') l WHERE l->'rule'->'revision'->'rule'->'jurisdiction'->>'code'=config->>'jurisdiction')
          AND (d.at>=(p.definition->>'start')::timestamptz AND d.at<(p.definition->>'end')::timestamptz
            OR d.id IN (SELECT x.original_id FROM public.seller_document x WHERE x.at>=(p.definition->>'start')::timestamptz AND x.at<(p.definition->>'end')::timestamptz)
            OR d.id IN (SELECT c.invoice_id FROM public.financial_case c JOIN public.financial_case_event e ON e.case_id=c.id AND e.kind='financial_effect' WHERE e.at>=(p.definition->>'start')::timestamptz AND e.at<(p.definition->>'end')::timestamptz))), '[]'::jsonb),
        'charges',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'businessId',c.business_id,'paymentId',c.payment_id,'at',c.charge->>'paidAt','dateEvidence',CASE WHEN c.charge->>'paidAt' IS NULL THEN 'missing' ELSE 'native_capture' END,'currency',c.snapshot->'tax'->>'currency','lines',c.snapshot->'tax'->'lines','totals',c.snapshot->'tax'->'totals','invoiceId',(SELECT d.id FROM public.seller_document d WHERE d.period_id=c.id AND d.kind='invoice')) ORDER BY c.id)
          FROM public.subscription_period c WHERE (CASE WHEN c.snapshot->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END)=config->>'mode'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.snapshot->'tax'->'lines') l WHERE l->'rule'->'revision'->'rule'->'jurisdiction'->>'code'=config->>'jurisdiction')
          AND (c.charge->>'paidAt' IS NULL AND NOT EXISTS(SELECT 1 FROM public.seller_document d WHERE d.period_id=c.id AND d.kind='invoice') OR coalesce(c.charge->>'paidAt',c.snapshot->'tax'->>'at')::timestamptz>=(p.definition->>'start')::timestamptz AND coalesce(c.charge->>'paidAt',c.snapshot->'tax'->>'at')::timestamptz<(p.definition->>'end')::timestamptz)), '[]'::jsonb),
        'adjustments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'invoiceId',c.invoice_id,'at',to_char(e.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'effect',e.detail,
          'creditDocumentId',(SELECT d.id FROM public.seller_document d WHERE d.adjustment_id=c.id),
          'creditMinor',(SELECT d.snapshot->'totals'->>'totalMinor' FROM public.seller_document d WHERE d.adjustment_id=c.id),
          'approvedCredit',(SELECT v.detail->'review' FROM public.financial_case_event v WHERE v.case_id=c.id AND v.kind='credit_review' ORDER BY v.position DESC LIMIT 1)) ORDER BY e.at,e.id)
          FROM public.financial_case_event e JOIN public.financial_case c ON c.id=e.case_id
          WHERE e.kind='financial_effect' AND (CASE WHEN c.intent->'period'->'snapshot'->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END)=config->>'mode'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.detail->'originalTax'->'lines') l WHERE l->'rule'->'revision'->'rule'->'jurisdiction'->>'code'=config->>'jurisdiction')
          AND (e.at>=(p.definition->>'start')::timestamptz AND e.at<(p.definition->>'end')::timestamptz OR c.id IN (SELECT linked.adjustment_id FROM public.seller_document linked WHERE linked.at>=(p.definition->>'start')::timestamptz AND linked.at<(p.definition->>'end')::timestamptz))), '[]'::jsonb)
      ) INTO result;
      RETURN result||jsonb_build_object('fingerprint',md5(result::text));
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_reporting_people() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.tax_reporting_operator() THEN RETURN NULL; END IF;
      RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.name,''),u.email)) ORDER BY u.id) FROM public.platform_operator o JOIN public."user" u ON u.id=o.user_id AND u.two_factor_enabled WHERE o.tax AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)),'[]'::jsonb);
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_reminder_current(reminder_ref uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ DECLARE r record; p record; o record; d record; report record; latest_action integer; BEGIN
      SELECT * INTO r FROM public.tax_period_reminder WHERE id=reminder_ref;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO p FROM public.tax_reporting_period WHERE id=r.period_id;
      IF EXISTS(SELECT 1 FROM public.tax_reporting_period newer WHERE newer.supersedes_id=p.id) THEN RETURN false; END IF;
      SELECT * INTO o FROM public.tax_obligation_revision WHERE key=p.definition->>'obligationKey' ORDER BY version DESC LIMIT 1;
      SELECT * INTO d FROM public.tax_obligation_decision WHERE revision_id=o.id ORDER BY version DESC LIMIT 1;
      IF NOT FOUND OR d.outcome<>'approved' OR o.id::text<>r.source->>'obligationId' OR d.id::text<>r.source->>'decisionId' OR (o.definition->>'effectiveFrom')::timestamptz>(p.definition->>'start')::timestamptz OR coalesce((o.definition->>'effectiveUntil')::timestamptz,'infinity')<(p.definition->>'end')::timestamptz OR (o.definition->'registration'->>'effectiveFrom')::timestamptz>(p.definition->>'start')::timestamptz OR coalesce((o.definition->'registration'->>'effectiveUntil')::timestamptz,'infinity')<(p.definition->>'end')::timestamptz THEN RETURN false; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.platform_operator a JOIN public."user" u ON u.id=a.user_id AND u.two_factor_enabled WHERE a.user_id=d.actor_id AND a.tax AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)) THEN RETURN false; END IF;
      IF EXISTS(SELECT 1 FROM public.tax_period_reminder newer WHERE newer.period_id=r.period_id AND newer.stage_at>r.stage_at) THEN RETURN false; END IF;
      SELECT * INTO report FROM public.tax_liability_report WHERE period_id=p.id ORDER BY revision DESC LIMIT 1;
      IF coalesce(report.id::text,'')<>coalesce(r.source->>'reportId','') THEN RETURN false; END IF;
      SELECT coalesce(max(a.version),0) INTO latest_action FROM public.tax_report_action a WHERE a.report_id=report.id;
      RETURN latest_action=(r.source->>'actionVersion')::integer;
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_reminder_visible(reminder_ref uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF NOT public.tax_reporting_operator() THEN RETURN false; END IF;
      RETURN public.tax_reminder_current(reminder_ref);
    END $$;
    CREATE OR REPLACE FUNCTION public.tax_reporting_due(at_time timestamptz) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE p record; o record; d record; report record; action record; configured_stage jsonb; count integer:=0; v integer; BEGIN
      IF nullif(current_setting('app.business_id',true),'') IS NOT NULL THEN RETURN 0; END IF;
      IF nullif(current_setting('app.actor_id',true),'') IS NOT NULL AND NOT public.tax_reporting_operator() THEN RETURN 0; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('tax-reporting',0));
      FOR p IN SELECT x.* FROM public.tax_reporting_period x WHERE NOT EXISTS(SELECT 1 FROM public.tax_reporting_period newer WHERE newer.supersedes_id=x.id) LOOP
        SELECT * INTO o FROM public.tax_obligation_revision WHERE key=p.definition->>'obligationKey' ORDER BY version DESC LIMIT 1;
        SELECT * INTO d FROM public.tax_obligation_decision WHERE revision_id=o.id ORDER BY version DESC LIMIT 1;
        IF NOT FOUND OR d.outcome<>'approved' OR (o.definition->>'effectiveFrom')::timestamptz>(p.definition->>'start')::timestamptz OR coalesce((o.definition->>'effectiveUntil')::timestamptz,'infinity')<(p.definition->>'end')::timestamptz OR (o.definition->'registration'->>'effectiveFrom')::timestamptz>(p.definition->>'start')::timestamptz OR coalesce((o.definition->'registration'->>'effectiveUntil')::timestamptz,'infinity')<(p.definition->>'end')::timestamptz THEN CONTINUE; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.platform_operator a JOIN public."user" u ON u.id=a.user_id AND u.two_factor_enabled WHERE a.user_id=d.actor_id AND a.tax AND EXISTS(SELECT 1 FROM public.two_factor f WHERE f.user_id=u.id AND f.verified)) THEN CONTINUE; END IF;
        SELECT * INTO report FROM public.tax_liability_report WHERE period_id=p.id ORDER BY revision DESC LIMIT 1;
        SELECT * INTO action FROM public.tax_report_action WHERE report_id=report.id ORDER BY version DESC LIMIT 1;
        v:=coalesce(action.version,0);
        IF action.kind='approve' THEN CONTINUE; END IF;
        FOR configured_stage IN SELECT value FROM jsonb_array_elements(p.definition->'reminders') LOOP
          IF (configured_stage->>'at')::timestamptz>least(at_time,statement_timestamp()) THEN CONTINUE; END IF;
          INSERT INTO public.tax_period_reminder(id,period_id,stage,stage_at,source)
            VALUES(gen_random_uuid(),p.id,configured_stage->>'key',(configured_stage->>'at')::timestamptz,jsonb_build_object('obligationId',o.id,'decisionId',d.id,'reportId',report.id,'reportDigest',report.digest,'actionVersion',v,'status',CASE WHEN report.id IS NULL THEN 'not_prepared' WHEN v=0 THEN 'prepared' WHEN action.kind='invalidated' THEN 'review_required' ELSE 'in_review' END)) ON CONFLICT(period_id,stage) DO NOTHING;
          IF FOUND THEN count:=count+1; END IF;
        END LOOP;
      END LOOP;
      RETURN count;
    END $$;
    REVOKE ALL ON FUNCTION public.tax_reminder_current(uuid) FROM PUBLIC,app_runtime;
    REVOKE ALL ON FUNCTION public.tax_reporting_operator(),public.tax_reporting_sources(uuid),public.tax_reporting_due(timestamptz),public.tax_reminder_visible(uuid),public.tax_reporting_people() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.tax_reporting_operator(),public.tax_reporting_sources(uuid),public.tax_reporting_due(timestamptz),public.tax_reminder_visible(uuid),public.tax_reporting_people() TO app_runtime;
  `);
}
export async function secureTaxPeriods(pool: Pool | PoolClient) {
  await prepareTaxPeriodSecurity(pool);
  for (const name of taxPeriodTables)
    await pool.query(
      `REVOKE ALL ON public.${name} FROM app_runtime; GRANT SELECT,INSERT ON public.${name} TO app_runtime; ALTER TABLE public.${name} FORCE ROW LEVEL SECURITY`,
    );
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.tax_reporting_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE item record; config_key text; source_time timestamptz; source_mode text; source_lines jsonb; source_id text; actor text; replaced_period uuid; BEGIN
      IF TG_TABLE_NAME='financial_case_event' THEN IF NEW.kind<>'financial_effect' THEN RETURN NEW; END IF; END IF;
      IF TG_TABLE_NAME='seller_document' AND TG_OP='UPDATE' THEN IF NEW.artifact_state=OLD.artifact_state THEN RETURN NEW; END IF; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('tax-reporting',0));
      IF TG_TABLE_NAME='tax_reporting_period' THEN replaced_period:=NEW.supersedes_id; IF replaced_period IS NULL THEN RETURN NEW; END IF;
      ELSIF TG_TABLE_NAME='tax_obligation_revision' THEN config_key:=NEW.key;
      ELSIF TG_TABLE_NAME='tax_obligation_decision' THEN SELECT key INTO config_key FROM public.tax_obligation_revision WHERE id=NEW.revision_id;
      ELSIF TG_TABLE_NAME='seller_document' THEN source_time:=NEW.at; source_mode:=NEW.snapshot->'issuer'->'revision'->'configuration'->>'mode'; source_lines:=NEW.snapshot->'lines';
      ELSIF TG_TABLE_NAME='subscription_period' THEN source_time:=(NEW.charge->>'paidAt')::timestamptz; source_mode:=CASE WHEN NEW.snapshot->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END; source_lines:=NEW.snapshot->'tax'->'lines';
      ELSE source_time:=NEW.at; SELECT CASE WHEN c.intent->'period'->'snapshot'->'provider'->>'mode'='live' THEN 'live' ELSE 'fixture' END INTO source_mode FROM public.financial_case c WHERE c.id=NEW.case_id; source_lines:=NEW.detail->'originalTax'->'lines'; END IF;
      source_id:=NEW.id::text;
      SELECT u.id INTO actor FROM public."user" u WHERE u.id=current_setting('app.actor_id',true);
      FOR item IN SELECT r.* FROM public.tax_liability_report r WHERE
        (replaced_period IS NOT NULL AND r.period_id=replaced_period OR config_key IS NOT NULL AND r.snapshot->'obligation'->>'key'=config_key OR config_key IS NULL AND r.snapshot->'obligation'->'definition'->>'mode'=source_mode
          AND (source_time IS NULL OR source_time>=(r.snapshot->'period'->>'start')::timestamptz AND source_time<(r.snapshot->'period'->>'end')::timestamptz)
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(source_lines) l WHERE l->'rule'->'revision'->'rule'->'jurisdiction'->>'code'=r.snapshot->'obligation'->'definition'->>'jurisdiction'))
        AND NOT EXISTS(SELECT 1 FROM public.tax_report_action a WHERE a.report_id=r.id AND a.kind='invalidated')
      LOOP
        INSERT INTO public.tax_report_action(id,report_id,version,kind,detail,request_key,input,actor_id,actor_name,at,note)
          VALUES(gen_random_uuid(),item.id,coalesce((SELECT max(a.version) FROM public.tax_report_action a WHERE a.report_id=item.id),0)+1,'invalidated',jsonb_build_object('issueId',source_id,'evidence',jsonb_build_array(TG_TABLE_NAME)),gen_random_uuid(),jsonb_build_object('sourceTable',TG_TABLE_NAME,'sourceId',source_id),actor,'Source change',statement_timestamp(),'Source or obligation changed; prepare an explicit successor revision');
      END LOOP;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.tax_reporting_changed() FROM PUBLIC,app_runtime;
  `);
  for (const name of taxSourceTables) {
    await pool.query(
      `DROP TRIGGER IF EXISTS tax_reporting_changed ON public.${name}; CREATE TRIGGER tax_reporting_changed BEFORE INSERT ${name === "seller_document" ? "OR UPDATE OF artifact_state" : ""} ON public.${name} FOR EACH ROW EXECUTE FUNCTION public.tax_reporting_changed()`,
    );
  }
}
export async function verifyTaxPeriods(pool: Pool | PoolClient) {
  const result = await pool.query<{ safe: boolean }>(
    `SELECT
    (SELECT count(*)=$1 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[]))
    AND (SELECT count(*)=11 AND bool_and(convalidated) FROM pg_constraint WHERE contype='f' AND conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[])))
    AND (SELECT count(*)=18 AND bool_and(CASE WHEN policyname LIKE '%_read' THEN qual IS NOT NULL WHEN policyname LIKE '%_insert' THEN with_check IS NOT NULL ELSE qual IS NOT NULL AND with_check IS NOT NULL END) FROM pg_policies WHERE schemaname='public' AND tablename=ANY($2::text[]))
    AND (SELECT count(*)=6 AND bool_and(tgenabled='O' AND tgfoid='public.tax_reporting_changed()'::regprocedure) FROM pg_trigger WHERE tgname='tax_reporting_changed')
    AND (SELECT count(*)=2 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND NOT has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('tax_reporting_changed','tax_reminder_current'))
    AND (SELECT count(*)=$3 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""'] AND NOT pg_has_role(current_user,p.proowner,'MEMBER') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($4::text[])) AS safe`,
    [
      taxPeriodTables.length,
      taxPeriodTables,
      taxPeriodFunctions.length,
      taxPeriodFunctions,
    ],
  );
  if (result.rows[0]?.safe !== true)
    throw new Error("Tax reporting database privileges are incomplete");
}
