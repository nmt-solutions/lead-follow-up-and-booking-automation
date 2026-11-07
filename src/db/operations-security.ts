import type { Pool, PoolClient } from "pg";

// These expressions are source-owned projections. Never copy a provider response,
// credential, cursor, message, financial snapshot or recovery capability here.
const sources = [
  {
    table: "mailbox_policy",
    source: "mailbox_scope",
    status: "r->>'visibility'",
    reason:
      "CASE WHEN r->'configuration'->>'enabled'<>'true' THEN 'channel_disabled' WHEN r->'configuration'->>'requestedRead'<>'true' THEN 'reading_not_requested' WHEN r->'permission_observation'->>'read' IS DISTINCT FROM 'granted' THEN 'read_permission_unobserved' WHEN r->>'visibility'<>'current' THEN 'reply_visibility_unsafe' ELSE NULL END",
    owner: "r->>'created_by'",
    at: "r->>'updated_at'",
    context:
      "jsonb_build_object('mailboxId',r->'id','connectionId',r->'connection_id','provider',r->'provider','version',r->'version','connectionVersion',r->'connection_version','readRequested',r->'configuration'->'requestedRead','sendRequested',r->'configuration'->'requestedSend','permission',r->'permission_observation'->'read','sendPermission',r->'permission_observation'->'send','completeReplyCapture',r->'complete_reply_capture','lastSyncedAt',r->'last_synced_at')",
  },
  {
    table: "mailbox_job",
    source: "mailbox",
    status: "r->'state'->>'status'",
    reason: "r->'state'->>'reason'",
    owner: "r->'identity'->>'userId'",
    at: "r->>'created_at'",
    context:
      "jsonb_build_object('mailboxId',r->'mailbox_id','policyVersion',r->'policy_version','mode',r->'state'->'mode','checkpoint',r->'state'->'checkpoint','captured',r->'state'->'captured','considered',r->'state'->'considered','retryAt',r->'state'->'retryAt')",
  },
  {
    table: "discovery_run",
    source: "discovery",
    status: "r->>'status'",
    reason: "r->>'stop_reason'",
    owner: "r->>'created_by'",
    at: "r->>'updated_at'",
    context:
      "jsonb_build_object('approvedBudget',r->'budget','used',r->'used','completedSteps',r->'completed_steps','attempt',r->'attempt','scheduleId',r->'schedule_id','scheduleRevision',r->'schedule_revision','configurationVersion',r->'brief'->'configurationVersion','policyHash',encode(sha256(convert_to((r->'policy')::text,'UTF8')),'hex'),'briefHash',encode(sha256(convert_to((r->'brief')::text,'UTF8')),'hex'))",
  },
  {
    table: "appointment",
    source: "appointment",
    status: "r->>'phase'",
    reason: "r->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('policyId',r->'policy_id','mode',r->'mode','bookingStatus',r->'status','provider',r->'intent'->'provider','connectionId',r->'intent'->'connectionId','authorityVersion',r->'intent'->'authorityVersion','contextKey',r->'context_key')",
  },
  {
    table: "appointment_history",
    source: "appointment_history",
    status: "r->>'kind'",
    reason: "NULL::text",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('appointmentId',r->'appointment_id','source',r->'source','sequence',r->'sequence')",
  },
  {
    table: "opportunity_due_action",
    source: "action",
    status: "r->>'state'",
    reason: "r->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'created_at'",
    context:
      "jsonb_build_object('inquiryRunId',r->'inquiry_run_id','planId',r->'whatsapp_plan_id','policyVersion',r->'policy_version','controlVersion',r->'control_version','associationVersion',r->'association_version','acceptance',r->'email'->'result'->'status','processingAcceptance',r->'email'->'processingAcceptance'->'status','sentObserved',r->'email'->'sent' IS NOT NULL AND r->'email'->'sent'<>'null'::jsonb,'senderIdentityId',r->'email'->'envelope'->'senderIdentityId','senderVersion',r->'email'->'envelope'->'senderVersion','senderEvidenceId',r->'email'->'envelope'->'senderEvidenceId')",
  },
  {
    table: "email_sequence_run",
    source: "sequence",
    status: "r->>'state'",
    reason: "r->>'reason'",
    owner: "r->'identity'->>'userId'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('revisionId',r->'revision_id','approvalHash',r->'payload_hash','version',r->'version')",
  },
  {
    table: "email_sequence_action",
    source: "sequence_action",
    status: "r->>'state'",
    reason: "r->>'reason'",
    owner: "r->'identity'->>'userId'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('runId',r->'run_id','stepIndex',r->'step_index','controlVersion',r->'control_version','queueState',r->'queue_state','processingAccepted',r->'processing_acceptance' IS NOT NULL AND r->'processing_acceptance'<>'null'::jsonb,'sentObserved',coalesce(r->'receipt'->>'evidence'='sent_folder',false),'attemptId',r->'attempt_id')",
  },
  {
    table: "campaign_decision",
    source: "approval",
    status: "r->>'decision'",
    reason: "NULL::text",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('revisionId',r->'revision_id','approvalHash',r->'payload_hash','role',r->'role')",
  },
  {
    table: "inquiry_run",
    source: "inquiry",
    status: "r->'result'->>'status'",
    reason: "r->'result'->>'reason'",
    owner: "coalesce(r->'result'->>'ownerId',r->>'actor_id')",
    at: "r->>'at'",
    context:
      "jsonb_build_object('controlVersion',r->'snapshot'->'controlVersion','knowledgeVersion',r->'snapshot'->'knowledgeVersion','profileId',r->'snapshot'->'profileId','activationVersion',r->'snapshot'->'activationVersion')",
  },
  {
    table: "inbox_opportunity",
    source: "ownership",
    status: "r->>'control_state'",
    reason:
      "CASE WHEN r->>'control_state'='human' THEN 'human_review_required' ELSE NULL END",
    owner: "r->>'owner_id'",
    at: "r->>'created_at'",
    context:
      "jsonb_build_object('controlVersion',r->'control_version','policyVersion',r->'policy_version')",
  },
  {
    table: "sender_health_record",
    source: "sender_health",
    status: "r->>'kind'",
    reason:
      "CASE WHEN r->>'kind' IN ('incident','failure') THEN 'sender_health_review_required' ELSE NULL END",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('identityId',r->'identity_id','incidentId',coalesce(r->'payload'->'incidentId',CASE WHEN r->>'kind'='incident' THEN r->'id' ELSE NULL END),'evidenceId',r->'payload'->'evidenceId','version',r->'payload'->'version')",
  },
  {
    table: "whatsapp_connection",
    source: "whatsapp",
    status: "r->>'status'",
    reason: "r->>'reason'",
    owner: "r->>'terms_actor_id'",
    at: "r->>'terms_accepted_at'",
    context:
      "jsonb_build_object('connectionVersion',r->'version','provider',r->'provider_key','permission',r->'observation'->'checks'->'permissions','ownership',r->'observation'->'checks'->'customer_ownership')",
  },
  {
    table: "whatsapp_intake",
    source: "whatsapp_intake",
    status: "CASE WHEN r->>'gap' IS NULL THEN 'enabled' ELSE 'review' END",
    reason: "r->>'gap'",
    owner: "r->>'actor_id'",
    at: "r->>'enabled_at'",
    context:
      "jsonb_build_object('connectionVersion',r->'connection_version','inboxConnectionId',r->'inbox_connection_id','inboundAt',r->'inbound_at','echoAt',r->'echo_at')",
  },
  {
    table: "subscription_payment",
    source: "payment",
    status: "r->>'state'",
    reason: "r->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('quoteId',r->'quote_id','provider',r->'snapshot'->'provider'->'key','mode',r->'snapshot'->'provider'->'mode','reconciliationPending',r->'reconciliation_pending','reviewPending',r->'observation'->'review' IS NOT NULL AND r->'observation'->'review'<>'null'::jsonb)",
  },
  {
    table: "subscription_payment_history",
    source: "payment_history",
    status: "r->>'kind'",
    reason: "r->'detail'->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('actionId',r->'action_id','paymentState',r->'detail'->'state')",
  },
  {
    table: "seller_document",
    source: "document",
    status: "r->>'artifact_state'",
    reason: "r->>'failure'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('kind',r->'kind','periodId',r->'period_id','originalId',r->'original_id','issuerId',r->'snapshot'->'issuer'->'id','issuerVersion',r->'snapshot'->'issuer'->'version')",
  },
  {
    table: "commercial_authority_revision",
    source: "authority",
    status: "'recorded'::text",
    reason: "NULL::text",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context: "jsonb_build_object('version',r->'version')",
  },
  {
    table: "discovery_dispatch",
    source: "queue",
    status: "r->>'state'",
    reason: "r->>'failure'",
    owner: "r->'payload'->'work'->>'userId'",
    at: "r->>'created_at'",
    context:
      "jsonb_build_object('kind',r->'payload'->'kind','runId',r->'payload'->'work'->'runId','scheduleId',r->'payload'->'work'->'scheduleId','attempts',r->'attempts')",
  },
  {
    table: "whatsapp_outbound",
    source: "whatsapp_action_history",
    status: "coalesce(r->'data'->'result'->>'status',r->'data'->>'kind')",
    reason: "r->'data'->'result'->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('actionId',coalesce(r->'data'->'actionId',r->'data'->'intent'->'actionId'),'planId',coalesce(r->'data'->'planId',r->'data'->'intent'->'planId'),'approvalHash',r->'data'->'hash','approved',r->'data'->'approved','authorityVersion',coalesce(r->'data'->'authorityVersion',r->'data'->'plan'->'authorityVersion'),'connectionVersion',r->'data'->'intent'->'connectionVersion','permissionId',r->'data'->'intent'->'permissionId')",
  },
  {
    table: "whatsapp_receipt",
    source: "channel_observation",
    status:
      "CASE WHEN r->>'kind'='status' THEN coalesce(r->>'provider_status','unknown') ELSE r->>'state' END",
    reason: "NULL::text",
    owner: "NULL::text",
    at: "r->>'at'",
    context:
      "jsonb_build_object('connectionId',r->'connection_id','connectionVersion',r->'connection_version','kind',r->'kind','processingState',r->'state','nativeStatus',r->'provider_status')",
  },
  {
    table: "email_sequence_event",
    source: "sequence_history",
    status: "r->>'kind'",
    reason: "r->>'reason'",
    owner: "r->>'actor_id'",
    at: "r->>'at'",
    context:
      "jsonb_build_object('runId',r->'run_id','actionId',r->'action_id','attemptId',r->'attempt_id','receiptEvidence',r->'receipt'->'evidence','processingAccepted',r->'processing_acceptance' IS NOT NULL AND r->'processing_acceptance'<>'null'::jsonb,'mailboxId',r->'source'->'mailboxId','connectionId',r->'source'->'connectionId')",
  },
];
export const operationSourceTables = sources.map((s) => s.table);

export async function prepareOperations(pool: Pool) {
  await pool.query(`DO $$ BEGIN
    IF to_regclass('public.operation_event') IS NOT NULL THEN
      REVOKE ALL ON public.operation_event,public.operation_retention,public.operation_detail FROM app_runtime;
      REVOKE ALL ON SEQUENCE public.operation_event_position_seq FROM app_runtime;
    END IF;
    IF to_regprocedure('public.operation_mailbox_work(uuid,uuid)') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.operation_mailbox_work(uuid,uuid) FROM app_runtime; END IF;
    IF to_regprocedure('public.record_operation_detail(uuid,text,uuid,text)') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.record_operation_detail(uuid,text,uuid,text) FROM app_runtime; END IF;
    IF to_regprocedure('public.prune_operation_details()') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.prune_operation_details() FROM app_runtime; END IF;
    IF to_regprocedure('public.maintain_operation_retention()') IS NOT NULL THEN REVOKE ALL ON FUNCTION public.maintain_operation_retention() FROM app_runtime; END IF;
  END $$;`);
}

export async function secureOperations(client: PoolClient) {
  await client.query(`
    REVOKE ALL ON public.operation_event,public.operation_retention,public.operation_detail FROM app_runtime;
    GRANT SELECT,INSERT ON public.operation_event,public.operation_retention TO app_runtime;
    GRANT SELECT ON public.operation_detail TO app_runtime;
    GRANT USAGE ON SEQUENCE public.operation_event_position_seq TO app_runtime;
    ALTER TABLE public.operation_event FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.operation_retention FORCE ROW LEVEL SECURITY;
    ALTER TABLE public.operation_detail FORCE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION public.operation_snapshot(source_table text,r jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
    BEGIN
      ${sources.map((s) => `IF source_table='${s.table}' THEN RETURN jsonb_build_object('source','${s.source}','businessId',r->'business_id','targetId',r->'id','status',${s.status},'reason',${s.reason},'responsibleUserId',${s.owner},'opportunityId',${s.table === "inbox_opportunity" ? "r->'id'" : "r->'opportunity_id'"},'context',${s.context},'sourceAt',${s.at}); END IF;`).join("\n")}
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION public.operation_snapshot(text,jsonb) FROM PUBLIC,app_runtime;
    CREATE OR REPLACE FUNCTION public.capture_operation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE snapshot jsonb;
    BEGIN
      snapshot:=public.operation_snapshot(TG_TABLE_NAME,to_jsonb(NEW));
      IF snapshot IS NULL THEN RETURN NEW; END IF;
      IF TG_OP='UPDATE' AND snapshot=public.operation_snapshot(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN NEW; END IF;
      INSERT INTO public.operation_event(id,business_id,source,target_id,snapshot,actor_id,action,outcome)
      VALUES(gen_random_uuid(),(snapshot->>'businessId')::uuid,snapshot->>'source',(snapshot->>'targetId')::uuid,snapshot,
        nullif(current_setting('app.actor_id',true),''),'observed','observed');
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.capture_operation() FROM PUBLIC,app_runtime;
  `);
  for (const source of sources) {
    // Owner-only temporary read during managed reconciliation. Removed before
    // runtime grants/verification; no broad operator access to source payloads.
    await client.query(`
      DROP POLICY IF EXISTS operation_backfill ON public.${source.table};
      CREATE POLICY operation_backfill ON public.${source.table} FOR SELECT TO PUBLIC
        USING(current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.${source.table}'::regclass));
      INSERT INTO public.operation_event(id,business_id,source,target_id,snapshot,actor_id,action,outcome)
      SELECT gen_random_uuid(),t.business_id,'${source.source}',t.id,public.operation_snapshot('${source.table}',to_jsonb(t)),NULL,'observed','observed'
      FROM public.${source.table} t WHERE NOT EXISTS(SELECT 1 FROM public.operation_event e WHERE e.source='${source.source}' AND e.target_id=t.id AND e.business_id=t.business_id);
      DROP POLICY operation_backfill ON public.${source.table};
      DROP TRIGGER IF EXISTS capture_operation ON public.${source.table};
      CREATE TRIGGER capture_operation AFTER INSERT OR UPDATE ON public.${source.table} FOR EACH ROW EXECUTE FUNCTION public.capture_operation();
    `);
  }
  await client.query(`
    DROP POLICY IF EXISTS operations_operator_proof ON public.platform_operator;
    CREATE POLICY operations_operator_proof ON public.platform_operator FOR SELECT TO PUBLIC
      USING(current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.platform_operator'::regclass));
    CREATE OR REPLACE FUNCTION public.operations_operator_authorized() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS(SELECT 1 FROM public.platform_operator o JOIN public.session s ON s.user_id=o.user_id
        JOIN public."user" u ON u.id=s.user_id JOIN public.two_factor f ON f.user_id=u.id
        WHERE o.user_id=current_setting('app.actor_id',true) AND o.operations
        AND s.id=current_setting('app.operation_session',true) AND s.expires_at>coalesce(nullif(current_setting('app.at',true),'')::timestamptz,statement_timestamp())
        AND u.two_factor_enabled AND f.verified AND s.mfa_factor_id=f.id
        AND s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')
        AND s.mfa_verified_at<=coalesce(nullif(current_setting('app.at',true),'')::timestamptz,statement_timestamp())
        AND s.mfa_verified_at>coalesce(nullif(current_setting('app.at',true),'')::timestamptz,statement_timestamp())-interval '15 minutes')
    $$;
    DROP POLICY IF EXISTS operations_mailbox_maintenance ON public.mailbox_job;
    CREATE POLICY operations_mailbox_maintenance ON public.mailbox_job FOR SELECT TO PUBLIC
      USING(current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.mailbox_job'::regclass) AND public.operations_operator_authorized());
    CREATE OR REPLACE FUNCTION public.operation_mailbox_work(tenant uuid,job uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT jsonb_build_object('businessId',j.business_id,'mailboxId',j.mailbox_id,'jobId',j.id,'policyVersion',j.policy_version,'identity',j.identity)
      FROM public.mailbox_job j WHERE j.id=job AND j.business_id=tenant
      AND j.state->>'status'<>'completed' AND public.operations_operator_authorized()
      AND tenant=nullif(current_setting('app.business_id',true),'')::uuid
    $$;
    REVOKE ALL ON FUNCTION public.operations_operator_authorized(),public.operation_mailbox_work(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.operations_operator_authorized(),public.operation_mailbox_work(uuid,uuid) TO app_runtime;
    CREATE OR REPLACE FUNCTION public.record_operation_detail(event uuid,detail_kind text,request uuid,diagnostic_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE policy public.operation_retention;
    BEGIN
      IF detail_kind NOT IN ('audit','diagnostic') OR diagnostic_code NOT IN ('RECOVERY_QUEUED','RECOVERY_CHECKED','RECOVERY_ESCALATED','RECOVERY_BLOCKED','RECOVERY_UNAVAILABLE') THEN RAISE EXCEPTION 'Invalid diagnostic'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.operation_event e WHERE e.id=event AND e.actor_id=current_setting('app.actor_id',true)
        AND e.business_id=nullif(current_setting('app.business_id',true),'')::uuid) THEN RAISE EXCEPTION 'Diagnostic scope denied'; END IF;
      SELECT * INTO policy FROM public.operation_retention ORDER BY version DESC LIMIT 1;
      IF policy.id IS NULL THEN RETURN; END IF;
      INSERT INTO public.operation_detail(id,event_id,policy_id,kind,request_id,code,expires_at)
        VALUES(gen_random_uuid(),event,policy.id,detail_kind,request,diagnostic_code,
          statement_timestamp()+make_interval(secs=>(policy.policy->>CASE WHEN detail_kind='audit' THEN 'auditDetailSeconds' ELSE 'diagnosticSeconds' END)::integer))
        ON CONFLICT(event_id,kind) DO NOTHING;
    END $$;
    CREATE OR REPLACE FUNCTION public.prune_operation_details() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE removed integer;
    BEGIN
      IF NOT public.operations_operator_authorized() THEN RAISE EXCEPTION 'Maintenance denied'; END IF;
      DELETE FROM public.operation_detail WHERE expires_at<=statement_timestamp();
      GET DIAGNOSTICS removed=ROW_COUNT;
      RETURN removed;
    END $$;
    REVOKE ALL ON FUNCTION public.record_operation_detail(uuid,text,uuid,text),public.prune_operation_details() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.record_operation_detail(uuid,text,uuid,text),public.prune_operation_details() TO app_runtime;
    CREATE OR REPLACE FUNCTION public.maintain_operation_retention() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
    DECLARE removed integer;
    BEGIN
      -- Durable approval is the saved policy, not an impersonated purchaser or
      -- operator session. Revoking its approving operator stops automatic purge.
      DELETE FROM public.operation_detail d USING public.operation_retention p,public.platform_operator o
        WHERE d.policy_id=p.id AND o.user_id=p.actor_id AND o.operations
        AND d.expires_at<=statement_timestamp();
      GET DIAGNOSTICS removed=ROW_COUNT;
      RETURN removed;
    END $$;
    REVOKE ALL ON FUNCTION public.maintain_operation_retention() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.maintain_operation_retention() TO app_runtime;
  `);
}
