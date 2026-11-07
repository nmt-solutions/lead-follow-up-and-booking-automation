import { sql } from "drizzle-orm";
import { pgPolicy } from "drizzle-orm/pg-core";

// Only the actual schema owner can read these sources for the private aggregate.
// This grants neither table privileges nor owner membership to the runtime.
export const pilotCostReadTables = [
  "ai_attempt",
  "ai_execution",
  "discovery_usage",
  "discovery_run",
  "file_usage",
  "mailbox_job",
  "mailbox_app_message",
  "mailbox_policy",
  "opportunity_due_action",
  "email_sequence_action",
  "email_sequence_event",
  "whatsapp_receipt",
  "notification_notice",
  "notification_event",
  "subscription_period",
  "subscription_payment_event",
  "subscription_payment_history",
  "operator_cost_budget",
  "operator_cost_record",
] as const;
export function pilotCostOwnerRead(name: (typeof pilotCostReadTables)[number]) {
  return pgPolicy(`${name}_pilot_cost_owner_read`, {
    for: "select",
    to: "public",
    using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid=${sql.raw(`'public.${name}'::regclass`)})`,
  });
}
