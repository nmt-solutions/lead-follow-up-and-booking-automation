import type { PoolClient } from "pg";

/** Private predicate for the original explicitly approved read-only job. */
export async function securePilotSetup(pool: PoolClient) {
  await pool.query(`
 CREATE OR REPLACE FUNCTION public.pilot_setup_current(tenant uuid,job text,mailbox text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 DECLARE allowed boolean; deadline timestamptz; BEGIN
 IF tenant::text IS DISTINCT FROM current_setting('app.business_id',true) OR NOT coalesce(public.pilot_operator(),false) OR public.business_data_stopped(tenant) THEN RETURN false; END IF;
 SELECT (e.data->>'expiresAt')::timestamptz INTO deadline FROM public.pilot_event e WHERE e.business_id=tenant AND e.kind='setup_authorized' AND e.request_key::text=job AND e.actor_id=current_setting('app.actor_id',true);
 SELECT EXISTS(SELECT 1 FROM public.pilot_event e JOIN public.pilot_record r ON r.id=e.pilot_id AND r.business_id=e.business_id
   JOIN public.mailbox_policy m ON m.id::text=e.data->>'mailboxId' AND m.business_id=e.business_id
   JOIN public.sender_connection c ON c.id=m.connection_id AND c.business_id=m.business_id
   WHERE e.business_id=tenant AND e.kind='setup_authorized' AND e.request_key::text=job AND e.data->>'jobId'=job
   AND e.actor_id=current_setting('app.actor_id',true) AND e.data->>'mailboxId'=mailbox
   AND (e.data->>'expiresAt')::timestamptz>clock_timestamp() AND e.at<=clock_timestamp()
   AND r.snapshot->'plan'->>'mailboxId'=mailbox AND (r.snapshot->'plan'->>'endsAt')::timestamptz>clock_timestamp()
   AND r.snapshot->'plan'->'capabilities' ?| ARRAY['mailbox','inquiry_email','outreach_email']
   AND m.version::text=e.data->>'mailboxVersion' AND m.connection_version=c.version
   AND m.configuration->'enabled'='true'::jsonb AND m.configuration->'requestedRead'='true'::jsonb AND c.configuration->'enabled'='true'::jsonb
   AND EXISTS(SELECT 1 FROM public.pilot_event approved WHERE approved.pilot_id=r.id AND approved.business_id=tenant AND approved.kind='approved')
   AND NOT EXISTS(SELECT 1 FROM public.pilot_event stop WHERE stop.pilot_id=r.id AND stop.business_id=tenant AND (stop.kind='stopped' OR stop.kind='activated' AND stop.position>e.position))
   AND EXISTS(SELECT 1 FROM public.subscription_period paid WHERE paid.business_id=tenant AND paid.action_id::text=r.snapshot->'plan'->>'paymentActionId'
     AND paid.start<=(r.snapshot->'plan'->>'startsAt')::timestamptz AND paid.end>=(r.snapshot->'plan'->>'endsAt')::timestamptz
     AND paid.id IN(SELECT current.id FROM public.current_paid_scope(tenant,clock_timestamp()) current))
 ) INTO allowed;
 IF NOT allowed OR NOT coalesce(public.pilot_operator(),false) THEN RETURN false; END IF;
 -- The funding/identity reads can wait. End with the original DB deadline,
 -- never a lease regenerated from the application clock or retry time.
 RETURN coalesce(deadline>clock_timestamp(),false);
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
 END $$;
 REVOKE ALL ON FUNCTION public.pilot_setup_current(uuid,text,text) FROM PUBLIC,app_runtime;
 `);
}
