import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  businessDataRequest,
  businessDataExport,
  businessDataGrant,
  businessDataStep,
  businessDataEvent,
  businessDataScopeForeignKeys,
} from "./schema";
import { dataGovernanceSql } from "./data-governance-sql";
const tables = [
  businessDataRequest,
  businessDataExport,
  businessDataGrant,
  businessDataStep,
  businessDataEvent,
];
export async function prepareDataGovernance(pool: Pool) {
  await pool.query(`DO $$ BEGIN IF to_regclass('public.business_data_request') IS NOT NULL THEN
    REVOKE ALL ON public.business_data_request,public.business_data_export,public.business_data_grant,public.business_data_step,public.business_data_event FROM app_runtime;
    REVOKE UPDATE(state,bytes,sha256) ON public.business_data_export FROM app_runtime;
    REVOKE UPDATE(used_at) ON public.business_data_grant FROM app_runtime;
    REVOKE SELECT(id,business_id,request_id,kind,target_id,details,state,attempts,due_at,outcome,token_wiped) ON public.business_data_step FROM app_runtime;
    ALTER TABLE public.business_data_grant DROP CONSTRAINT IF EXISTS business_data_grant_export_scope;
    ALTER TABLE public.business_data_step DROP CONSTRAINT IF EXISTS business_data_step_request_scope;
    ALTER TABLE public.business_data_event DROP CONSTRAINT IF EXISTS business_data_event_step_scope;
  END IF; END $$`);
  await pool.query(`DO $$ DECLARE f record; BEGIN
    FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('business_data_stopped','business_file_protected','start_business_offboarding','claim_business_data_cleanup','finish_business_data_cleanup','claim_business_exports','finish_business_export_cleanup','record_business_data_evidence','business_file_retained_until','expire_business_data_secrets','business_data_cleanup_current','business_export_cleanup_current','business_file_cleanup_current') LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM app_runtime',f.signature); END LOOP;
  END $$`);
}
export async function secureDataGovernance(client: PoolClient) {
  const db = drizzle(client);
  for (const t of tables) {
    await db.execute(sql`alter table ${t} enable row level security`);
    await db.execute(sql`alter table ${t} force row level security`);
    for (const c of getTableConfig(t).checks) {
      await db.execute(
        sql`alter table ${t} drop constraint if exists ${sql.identifier(c.name)}`,
      );
      await db.execute(
        sql`alter table ${t} add constraint ${sql.identifier(c.name)} check (${c.value})`,
      );
    }
    for (const p of getTableConfig(t).policies) {
      await db.execute(
        sql`drop policy if exists ${sql.identifier(p.name!)} on ${t}`,
      );
      const to = p.to === "public" ? sql`public` : sql`app_runtime`;
      await db.execute(
        sql`create policy ${sql.identifier(p.name!)} on ${t} for ${sql.raw(p.for!)} to ${to} ${p.using ? sql`using (${p.using})` : sql``} ${p.withCheck ? sql`with check (${p.withCheck})` : sql``}`,
      );
    }
  }
  for (const k of businessDataScopeForeignKeys) {
    const r = k.reference();
    await db.execute(
      sql`alter table ${k.table} drop constraint if exists ${sql.identifier(k.getName())}`,
    );
    await db.execute(
      sql`alter table ${k.table} add constraint ${sql.identifier(k.getName())} foreign key (${sql.join(
        r.columns.map((c) => sql.identifier(c.name)),
        sql`,`,
      )}) references ${r.foreignTable} (${sql.join(
        r.foreignColumns.map((c) => sql.identifier(c.name)),
        sql`,`,
      )})`,
    );
  }
  await client.query(`
    REVOKE ALL ON public.business_data_request,public.business_data_export,public.business_data_grant,public.business_data_step,public.business_data_event FROM app_runtime;
    GRANT SELECT,INSERT ON public.business_data_request,public.business_data_export,public.business_data_grant TO app_runtime;
    GRANT UPDATE(state,bytes,sha256) ON public.business_data_export TO app_runtime;
    GRANT UPDATE(used_at) ON public.business_data_grant TO app_runtime;
    GRANT SELECT(id,business_id,request_id,kind,target_id,details,state,attempts,due_at,outcome,token_wiped) ON public.business_data_step TO app_runtime;
    GRANT SELECT ON public.business_data_event TO app_runtime;
  `);
  // Definer recovery operates only on persisted exact approved target IDs. The
  // runtime cannot read the encrypted cleanup envelope or update task state.
  const ownerRole = (
    await client.query<{ role: string }>(
      "select quote_ident(current_user) role",
    )
  ).rows[0].role;
  for (const name of [
    "gmail_grant",
    "google_calendar_grant",
    "microsoft_mail_grant",
    "microsoft_calendar_grant",
    "whatsapp_connection",
    "gmail_oauth",
    "google_calendar_oauth",
    "microsoft_mail_oauth",
    "microsoft_calendar_oauth",
    "whatsapp_oauth",
    "mailbox_policy",
    "mailbox_job",
    "sender_connection",
    "sender_reply_route",
    "sender_identity",
    "inbox_connection",
    "inbox_opportunity",
    "opportunity_due_action",
    "billing_profile_revision",
    "tax_calculation",
    "seller_document",
  ]) {
    const policies = await client.query<{
      policyname: string;
      qual: string | null;
      with_check: string | null;
    }>(
      "select policyname,qual,with_check from pg_policies where schemaname='public' and tablename=$1",
      [name],
    );
    const owner =
      "current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)";
    for (const p of policies.rows)
      await client.query(
        `ALTER POLICY "${p.policyname}" ON public.${name} TO app_runtime,${ownerRole} ${p.qual ? `USING ((${p.qual}) OR (${owner}))` : ""} ${p.with_check ? `WITH CHECK ((${p.with_check}) OR (${owner}))` : ""}`,
      );
  }
  await client.query(dataGovernanceSql);
  await client.query(
    `REVOKE ALL ON FUNCTION public.business_data_cleanup_current(uuid,uuid,jsonb),public.business_export_cleanup_current(uuid,uuid,text),public.business_file_cleanup_current(uuid,uuid,text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.business_data_cleanup_current(uuid,uuid,jsonb),public.business_export_cleanup_current(uuid,uuid,text),public.business_file_cleanup_current(uuid,uuid,text) TO app_runtime;`,
  );
  await client.query(`REVOKE ALL ON FUNCTION public.expire_business_data_secrets() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.expire_business_data_secrets() TO app_runtime;`);
  await client.query(`REVOKE ALL ON FUNCTION public.business_file_retained_until(uuid,uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.business_file_retained_until(uuid,uuid) TO app_runtime;`);
  await client.query(`REVOKE ALL ON FUNCTION public.record_business_data_evidence(uuid,text,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.record_business_data_evidence(uuid,text,text) TO app_runtime;`);
  await client.query(`REVOKE ALL ON FUNCTION public.guard_data_meta_reconnect() FROM PUBLIC;
    DROP TRIGGER IF EXISTS guard_data_meta_reconnect ON public.whatsapp_connection;
    CREATE TRIGGER guard_data_meta_reconnect BEFORE INSERT OR UPDATE ON public.whatsapp_connection FOR EACH ROW EXECUTE FUNCTION public.guard_data_meta_reconnect();`);
  await client.query(`REVOKE ALL ON FUNCTION public.claim_business_exports(text),public.finish_business_export_cleanup(uuid,uuid,boolean) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.claim_business_exports(text),public.finish_business_export_cleanup(uuid,uuid,boolean) TO app_runtime;`);
  await client.query(`REVOKE ALL ON FUNCTION public.guard_data_identity_reconnect(),public.guard_data_export_update(),public.guard_data_grant_use() FROM PUBLIC;
    DROP TRIGGER IF EXISTS guard_data_export_update ON public.business_data_export;
    CREATE TRIGGER guard_data_export_update BEFORE UPDATE ON public.business_data_export FOR EACH ROW EXECUTE FUNCTION public.guard_data_export_update();
    DROP TRIGGER IF EXISTS guard_data_grant_use ON public.business_data_grant;
    CREATE TRIGGER guard_data_grant_use BEFORE UPDATE ON public.business_data_grant FOR EACH ROW EXECUTE FUNCTION public.guard_data_grant_use();`);
  for (const name of ["gmail_grant", "google_calendar_grant"])
    await client.query(
      `DROP TRIGGER IF EXISTS guard_data_identity_reconnect ON public.${name}; CREATE TRIGGER guard_data_identity_reconnect BEFORE INSERT OR UPDATE ON public.${name} FOR EACH ROW EXECUTE FUNCTION public.guard_data_identity_reconnect()`,
    );
  await client.query(`REVOKE ALL ON FUNCTION public.business_data_stopped(uuid),public.business_file_protected(uuid,uuid),public.start_business_offboarding(uuid),public.claim_business_data_cleanup(jsonb),public.finish_business_data_cleanup(uuid,uuid,text),public.guard_business_data_write() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.business_data_stopped(uuid),public.business_file_protected(uuid,uuid),public.start_business_offboarding(uuid),public.claim_business_data_cleanup(jsonb),public.finish_business_data_cleanup(uuid,uuid,text) TO app_runtime;`);
  for (const name of [
    "discovery_run",
    "discovery_dispatch",
    "discovery_schedule",
    "inbox_connection",
    "inbox_message",
    "mailbox_job",
    "gmail_oauth",
    "microsoft_mail_oauth",
    "google_calendar_oauth",
    "microsoft_calendar_oauth",
    "whatsapp_oauth",
    "opportunity_due_action",
    "email_sequence_run",
    "appointment",
  ]) {
    await client.query(
      `DROP TRIGGER IF EXISTS guard_business_data_write ON public.${name}; CREATE TRIGGER guard_business_data_write BEFORE INSERT ON public.${name} FOR EACH ROW EXECUTE FUNCTION public.guard_business_data_write()`,
    );
  }
  for (const name of [
    "sender_connection",
    "sender_reply_route",
    "sender_identity",
    "mailbox_policy",
    "gmail_grant",
    "google_calendar_grant",
    "microsoft_mail_grant",
    "microsoft_calendar_grant",
    "whatsapp_connection",
    "discovery_schedule",
    "inbox_connection",
  ]) {
    await client.query(
      `DROP TRIGGER IF EXISTS guard_business_data_write ON public.${name}; CREATE TRIGGER guard_business_data_write BEFORE INSERT OR UPDATE ON public.${name} FOR EACH ROW EXECUTE FUNCTION public.guard_business_data_write()`,
    );
  }
}
export async function verifyDataGovernance(pool: Pool | PoolClient) {
  const r = await pool.query<{ safe: boolean }>(`select
    (select count(*)=5 and bool_and(c.relrowsecurity and c.relforcerowsecurity and not pg_has_role(current_user,c.relowner,'MEMBER')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('business_data_request','business_data_export','business_data_grant','business_data_step','business_data_event'))
    and (select bool_and(has_table_privilege(current_user,t,'SELECT') and has_table_privilege(current_user,t,'INSERT') and not has_table_privilege(current_user,t,'UPDATE,DELETE,TRUNCATE')) from unnest(array['public.business_data_request','public.business_data_export','public.business_data_grant']) t)
    and not has_any_column_privilege(current_user,'public.business_data_request','UPDATE')
    and not has_column_privilege(current_user,'public.business_data_export','policy','UPDATE')
    and not has_column_privilege(current_user,'public.business_data_export','part','UPDATE')
    and not has_column_privilege(current_user,'public.business_data_grant','expires_at','UPDATE')
    and not has_column_privilege(current_user,'public.business_data_step','secret','SELECT')
    and not has_table_privilege(current_user,'public.business_data_step','INSERT,UPDATE,DELETE,TRUNCATE')
    and not has_any_column_privilege(current_user,'public.business_data_step','UPDATE')
    and not has_table_privilege(current_user,'public.business_data_event','INSERT,UPDATE,DELETE,TRUNCATE')
    and has_table_privilege(current_user,'public.business_data_event','SELECT')
    and (select count(*)=13 and bool_and(p.prosecdef and p.proconfig=ARRAY['search_path=""'] and not pg_has_role(current_user,p.proowner,'MEMBER') and has_function_privilege(current_user,p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('business_data_stopped','business_file_protected','start_business_offboarding','claim_business_data_cleanup','finish_business_data_cleanup','claim_business_exports','finish_business_export_cleanup','record_business_data_evidence','business_file_retained_until','expire_business_data_secrets','business_data_cleanup_current','business_export_cleanup_current','business_file_cleanup_current'))
    and (select count(*)=5 and bool_and(not has_function_privilege(current_user,p.oid,'EXECUTE') and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') and p.proconfig=ARRAY['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_business_data_write','guard_data_identity_reconnect','guard_data_meta_reconnect','guard_data_export_update','guard_data_grant_use'))
    and (select count(*)=15 and bool_and(case when policyname like '%_read' then qual is not null when policyname like '%_insert' then with_check is not null else qual is not null and with_check is not null end) from pg_policies where schemaname='public' and tablename in ('business_data_request','business_data_export','business_data_grant','business_data_step','business_data_event'))
    and (select count(*)=3 and bool_and(convalidated) from pg_constraint where conname in ('business_data_grant_export_scope','business_data_step_request_scope','business_data_event_step_scope') and contype='f') safe`);
  if (r.rows[0]?.safe !== true)
    throw new Error("Business data security is incomplete");
}
