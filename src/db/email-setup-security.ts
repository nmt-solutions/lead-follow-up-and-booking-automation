import type { PoolClient } from "pg";

/** First provider binding only. Established mailbox identities remain immutable. */
export async function secureEmailSetup(client: Pick<PoolClient, "query">) {
  await client.query(`
    CREATE OR REPLACE FUNCTION public.guard_mailbox_account_binding()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
    DECLARE authorized_state boolean;
    BEGIN
      IF NEW.account IS NOT DISTINCT FROM OLD.account THEN RETURN NEW; END IF;
      IF OLD.account !~ '^connect-[a-f0-9-]{36}@pending[.]leadrelay[.]invalid$'
        OR NEW.account ~ '@pending[.]leadrelay[.]invalid$'
        OR NEW.business_id<>OLD.business_id OR NEW.id<>OLD.id
        OR NEW.connection_id<>OLD.connection_id OR NEW.provider<>OLD.provider
        OR NEW.version<>OLD.version+1
        OR OLD.cursor IS NOT NULL OR OLD.visibility<>'unsafe'
        OR OLD.business_id<>nullif(current_setting('app.business_id',true),'')::uuid
        OR coalesce(public.current_business_role(),'') NOT IN ('owner','admin')
        OR NOT EXISTS(SELECT 1 FROM public.sender_connection c WHERE c.id=OLD.connection_id
          AND c.business_id=OLD.business_id AND c.version=NEW.connection_version
          AND c.configuration->>'account'=NEW.account AND c.configuration->>'provider'=NEW.provider)
      THEN RAISE EXCEPTION 'Mailbox identity is immutable' USING ERRCODE='42501'; END IF;
      IF OLD.provider='gmail' THEN
        SELECT EXISTS(SELECT 1 FROM public.gmail_grant g JOIN public.gmail_oauth s
          ON s.mailbox_id=g.id AND s.business_id=g.business_id AND s.generation=g.generation
          WHERE g.id=OLD.id AND g.business_id=OLD.business_id AND g.status='connecting'
          AND g.account_subject IS NULL AND g.credentials IS NULL AND s.consumed
          AND s.policy_version=OLD.version AND s.actor_id=current_setting('app.actor_id',true)
          AND s.session_id=current_setting('app.pilot_session',true)) INTO authorized_state;
      ELSE
        SELECT EXISTS(SELECT 1 FROM public.microsoft_mail_grant g JOIN public.microsoft_mail_oauth s
          ON s.mailbox_id=g.id AND s.business_id=g.business_id AND s.generation=g.generation
          WHERE g.id=OLD.id AND g.business_id=OLD.business_id AND g.status='connecting'
          AND g.account_subject IS NULL AND g.credentials IS NULL AND s.consumed
          AND s.policy_version=OLD.version AND s.actor_id=current_setting('app.actor_id',true)
          AND s.session_id=current_setting('app.pilot_session',true)) INTO authorized_state;
      END IF;
      IF NOT authorized_state THEN RAISE EXCEPTION 'Mailbox consent is required' USING ERRCODE='42501'; END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION public.guard_mailbox_account_binding() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.guard_mailbox_account_binding() TO app_runtime;
    DROP TRIGGER IF EXISTS mailbox_account_binding ON public.mailbox_policy;
    CREATE TRIGGER mailbox_account_binding BEFORE UPDATE OF account ON public.mailbox_policy
      FOR EACH ROW EXECUTE FUNCTION public.guard_mailbox_account_binding();
    GRANT UPDATE(account) ON public.mailbox_policy TO app_runtime;
  `);
}
