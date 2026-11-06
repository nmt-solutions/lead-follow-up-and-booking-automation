import type { Pool } from "pg";

export async function prepareSellerDocumentSecurity(pool: Pool) {
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.seller_artifact_worker_authorized(document uuid,tenant uuid)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      RETURN tenant::text IS NOT DISTINCT FROM current_setting('app.business_id',true) AND EXISTS(
        SELECT 1 FROM public.seller_document d WHERE d.id=document AND d.business_id=tenant
        AND d.id::text=current_setting('app.seller_document',true)
        AND d.recovery_key::text=current_setting('app.seller_capability',true)
        AND d.retry_after>statement_timestamp());
    END $$;
    CREATE OR REPLACE FUNCTION public.claim_seller_artifacts(scope text,lease_seconds integer)
    RETURNS TABLE(id uuid,business_id uuid,recovery_key uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
      IF lease_seconds<=0 OR scope IS NULL OR scope='' THEN RETURN; END IF;
      RETURN QUERY WITH due AS (
        SELECT d.id FROM public.seller_document d WHERE d.account_scope=scope AND d.artifact_state IN ('pending','failed')
        AND d.retry_after<=statement_timestamp() ORDER BY d.retry_after,d.id LIMIT 20 FOR UPDATE SKIP LOCKED
      ) UPDATE public.seller_document d SET retry_after=statement_timestamp()+make_interval(secs=>lease_seconds)
        FROM due WHERE d.id=due.id RETURNING d.id,d.business_id,d.recovery_key;
    END $$;
    REVOKE ALL ON FUNCTION public.seller_artifact_worker_authorized(uuid,uuid),public.claim_seller_artifacts(text,integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.seller_artifact_worker_authorized(uuid,uuid),public.claim_seller_artifacts(text,integer) TO app_runtime;
  `);
}
