-- Migration credentials own the schema. Web/worker credentials use this role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, rate_limit TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON membership TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON business TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (name, offering, home_market, website, updated_at) ON business TO app_runtime;
--> statement-breakpoint
-- Membership and Business are inserted atomically, membership first. A unique
-- owner prevents joining an existing Business through this bootstrap path.
ALTER TABLE membership ALTER CONSTRAINT membership_business_id_business_id_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE business FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON membership FOR SELECT TO app_runtime
  USING (user_id = nullif(current_setting('app.actor_id', true), ''));
--> statement-breakpoint
CREATE POLICY membership_create ON membership FOR INSERT TO app_runtime
  WITH CHECK (
    user_id = nullif(current_setting('app.actor_id', true), '')
    AND business_id = nullif(current_setting('app.business_id', true), '')::uuid
    AND role = 'owner'
  );
--> statement-breakpoint
CREATE POLICY business_access ON business FOR ALL TO app_runtime
  USING (
    id = nullif(current_setting('app.business_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM membership m WHERE m.business_id = business.id
      AND m.user_id = nullif(current_setting('app.actor_id', true), '') AND m.role = 'owner')
  )
  WITH CHECK (
    id = nullif(current_setting('app.business_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM membership m WHERE m.business_id = business.id
      AND m.user_id = nullif(current_setting('app.actor_id', true), '') AND m.role = 'owner')
  );
