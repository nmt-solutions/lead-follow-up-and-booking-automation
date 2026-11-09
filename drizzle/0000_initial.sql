CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_activation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"profile_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_activation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_activation_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_activation_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"business_id" uuid NOT NULL,
	"route" text NOT NULL,
	"outcome" text NOT NULL,
	"failure" text,
	"metrics" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"latency_ms" integer,
	"funding_source" text NOT NULL,
	"funding_reference" text NOT NULL,
	CONSTRAINT "ai_attempt_values" CHECK ("ai_attempt"."number" > 0 and "ai_attempt"."route" in ('operator_byok','gateway_system') and "ai_attempt"."outcome" in ('succeeded','failed','uncertain') and ("ai_attempt"."latency_ms" is null or "ai_attempt"."latency_ms" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ai_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_execution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"task" text NOT NULL,
	"kind" text NOT NULL,
	"knowledge_version" integer NOT NULL,
	"sample" jsonb NOT NULL,
	"input" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"failure" text,
	"output" jsonb,
	CONSTRAINT "ai_execution_values" CHECK ("ai_execution"."task" in ('extraction','drafting') and "ai_execution"."kind" in ('preview','workflow') and "ai_execution"."status" in ('running','succeeded','failed','uncertain','setup_required') and "ai_execution"."knowledge_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_execution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_profile" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	"used_attempts" integer DEFAULT 0 NOT NULL,
	"used_fallback_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_profile_counters" CHECK ("ai_profile"."version" > 0 and "ai_profile"."used_attempts" >= 0 and "ai_profile"."used_fallback_attempts" >= 0 and "ai_profile"."used_fallback_attempts" <= "ai_profile"."used_attempts")
);
--> statement-breakpoint
ALTER TABLE "ai_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"accepted" boolean NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"mode" text NOT NULL,
	"context_key" text NOT NULL,
	"intent" jsonb NOT NULL,
	"blocked_start" timestamp with time zone NOT NULL,
	"blocked_end" timestamp with time zone NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"event" jsonb,
	"reason" text,
	"cancellation" jsonb,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "appointment_interval" CHECK ("appointment"."blocked_start" < "appointment"."blocked_end"),
	CONSTRAINT "appointment_mode" CHECK ("appointment"."mode" in ('manual', 'automation')),
	CONSTRAINT "appointment_status" CHECK ("appointment"."status" in ('requested', 'confirmed', 'attended', 'cancelled')),
	CONSTRAINT "appointment_phase" CHECK ("appointment"."phase" in ('held', 'expired', 'blocked', 'committed', 'ambiguous', 'booked', 'conflict', 'failed', 'cancel_committed', 'cancel_ambiguous', 'finished')),
	CONSTRAINT "appointment_confirmation_evidence" CHECK ("appointment"."status" not in ('confirmed', 'attended') or ("appointment"."event" is not null and "appointment"."event"->>'status' = 'active'))
);
--> statement-breakpoint
ALTER TABLE "appointment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appointment_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"request_key" uuid,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"reference" text,
	"note" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_profile_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"findings" jsonb NOT NULL,
	"note" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_review_version_positive" CHECK ("billing_profile_review"."version" > 0 and "billing_profile_review"."profile_version" > 0),
	CONSTRAINT "billing_review_outcome" CHECK ("billing_profile_review"."outcome" in ('reviewed','missing','conflicting'))
);
--> statement-breakpoint
ALTER TABLE "billing_profile_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_profile_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "billing_profile_version_positive" CHECK ("billing_profile_revision"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "billing_profile_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "booking_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"calendar" jsonb,
	"actor_id" text NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "booking_policy_positive" CHECK ("booking_policy"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "booking_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"offering" text NOT NULL,
	"home_market" text NOT NULL,
	"website" text NOT NULL,
	"configuration" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_name_length" CHECK (char_length(btrim("business"."name")) between 1 and 120),
	CONSTRAINT "business_offering_length" CHECK (char_length(btrim("business"."offering")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "business" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_data_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"actor_id" text,
	"evidence" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_data_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_data_export" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"part" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"policy" jsonb NOT NULL,
	"state" text NOT NULL,
	"bytes" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cleanup_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"cleanup_lease" uuid,
	CONSTRAINT "business_data_export_state" CHECK ("business_data_export"."state" in ('pending','ready','deleting','deleted') and "business_data_export"."part">0 and "business_data_export"."part"<=1000000 and "business_data_export"."cleanup_attempts">=0 and ("business_data_export"."state"<>'ready' or ("business_data_export"."bytes">0 and "business_data_export"."sha256" ~ '^[a-f0-9]{64}$')))
);
--> statement-breakpoint
ALTER TABLE "business_data_export" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_data_grant" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "business_data_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_data_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"policy" jsonb NOT NULL,
	"input" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_data_request_policy" CHECK ("business_data_request"."kind" in ('offboard','reopen') and "business_data_request"."policy"->'businessIds' ? "business_data_request"."business_id"::text and ("business_data_request"."policy"->>'version')::integer>0 and ("business_data_request"."policy"->>'effectiveUntil')::timestamptz>("business_data_request"."policy"->>'effectiveFrom')::timestamptz)
);
--> statement-breakpoint
ALTER TABLE "business_data_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_data_step" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb NOT NULL,
	"secret" jsonb,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"token_wiped" boolean DEFAULT false NOT NULL,
	CONSTRAINT "business_data_step_state" CHECK ("business_data_step"."state" in ('pending','working','retry','complete','incomplete') and "business_data_step"."attempts">=0 and "business_data_step"."kind" in ('local','gmail','google_calendar','microsoft_mail','microsoft_calendar','meta','file'))
);
--> statement-breakpoint
ALTER TABLE "business_data_step" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"account_scope" text NOT NULL,
	"state" text NOT NULL,
	"upload_hash" text NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"record_retention_seconds" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"cleanup_after" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"operation_id" uuid,
	"sha256" text,
	"failure" text,
	CONSTRAINT "business_file_size" CHECK ("business_file"."size" > 0),
	CONSTRAINT "business_file_purpose" CHECK ("business_file"."purpose" in ('general', 'billing')),
	CONSTRAINT "business_file_state" CHECK ("business_file"."state" in ('pending','uploading','ready','failed','deleting','deleted'))
);
--> statement-breakpoint
ALTER TABLE "business_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "call_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"responsible_id" text NOT NULL,
	"responsible_name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text NOT NULL,
	"outcome" text NOT NULL,
	"next_action" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "call_revision_positive" CHECK ("call_revision"."version" > 0),
	CONSTRAINT "call_revision_occurred" CHECK ("call_revision"."occurred_at" <= "call_revision"."at")
);
--> statement-breakpoint
ALTER TABLE "call_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"revision_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"decision" text NOT NULL,
	"session_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"role" text NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "campaign_decision_value" CHECK ("campaign_decision"."decision" in ('approved','rejected') and "campaign_decision"."role" = 'owner')
);
--> statement-breakpoint
ALTER TABLE "campaign_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"payload_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"session_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "campaign_revision_positive" CHECK ("campaign_revision"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "campaign_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_authority_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "commercial_authority_version_positive" CHECK ("commercial_authority_revision"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "commercial_authority_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"decision" text NOT NULL,
	"payload_hash" text NOT NULL,
	"policy_version" integer NOT NULL,
	"context_key" text NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_decision_value" CHECK ("commercial_decision"."decision" in ('approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "commercial_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_execution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"reference" text,
	"provider" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_execution_state" CHECK ("commercial_execution"."state" in ('committed','completed','failed','ambiguous','blocked'))
);
--> statement-breakpoint
ALTER TABLE "commercial_execution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_outcome" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"reference" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_outcome_kind" CHECK ("commercial_outcome"."kind" in ('issued_quote','accepted_order','confirmed_sale'))
);
--> statement-breakpoint
ALTER TABLE "commercial_outcome" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commercial_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"series_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"context_key" text NOT NULL,
	"policy_version" integer NOT NULL,
	"evaluation" jsonb NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "commercial_proposal_positive" CHECK ("commercial_proposal"."version">0)
);
--> statement-breakpoint
ALTER TABLE "commercial_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_alert" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"threshold" integer NOT NULL,
	"measure" text NOT NULL,
	"budget_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"value_micros" text NOT NULL,
	"limit_micros" text NOT NULL,
	"summary" text NOT NULL,
	"email" text,
	"email_state" text NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_key" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_cost_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"owner_id" text NOT NULL,
	"worker_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "operator_cost_budget_bounds" CHECK ("operator_cost_budget"."version">0 and "operator_cost_budget"."configuration"->>'month'="operator_cost_budget"."month" and "operator_cost_budget"."configuration"->>'category'="operator_cost_budget"."category" and "operator_cost_budget"."configuration"->>'ownerId'="operator_cost_budget"."owner_id" and "operator_cost_budget"."retain_until">"operator_cost_budget"."at")
);
--> statement-breakpoint
ALTER TABLE "operator_cost_budget" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_notification_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"alert_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_cost_notification_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_planning" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "operator_cost_planning_bounds" CHECK ("operator_cost_planning"."version">0 and "operator_cost_planning"."configuration"->>'month'="operator_cost_planning"."month" and "operator_cost_planning"."retain_until">"operator_cost_planning"."at")
);
--> statement-breakpoint
ALTER TABLE "operator_cost_planning" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"version" integer NOT NULL,
	"month" text NOT NULL,
	"origin" text NOT NULL,
	"source" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "operator_cost_bounds" CHECK ("operator_cost_record"."version">0 and "operator_cost_record"."source"->>'month'="operator_cost_record"."month" and "operator_cost_record"."origin" in ('native','operator') and "operator_cost_record"."retain_until">"operator_cost_record"."at")
);
--> statement-breakpoint
ALTER TABLE "operator_cost_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_cost_scan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"source_count" integer NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_cost_scan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_capacity_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"route" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_capacity_binding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_capacity_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"policy" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_capacity_policy_version_unique" UNIQUE("version"),
	CONSTRAINT "discovery_capacity_policy_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
ALTER TABLE "discovery_capacity_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_command" (
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"execution_id" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"position" integer NOT NULL,
	"budget_before" integer NOT NULL,
	"budget_after" integer NOT NULL,
	"stop_reason" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_command_business_id_id_pk" PRIMARY KEY("business_id","id")
);
--> statement-breakpoint
ALTER TABLE "discovery_command" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_configuration" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_configuration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_dispatch" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"failure" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_dispatch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_prospect" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"canonical_url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_prospect" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_prospect_alias" (
	"business_id" uuid NOT NULL,
	"key" text NOT NULL,
	"prospect_id" uuid NOT NULL,
	CONSTRAINT "discovery_prospect_alias_business_id_key_pk" PRIMARY KEY("business_id","key")
);
--> statement-breakpoint
ALTER TABLE "discovery_prospect_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_result" (
	"run_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "discovery_result_run_id_prospect_id_pk" PRIMARY KEY("run_id","prospect_id")
);
--> statement-breakpoint
ALTER TABLE "discovery_result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"brief" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"session_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"execution_user_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"schedule_id" uuid,
	"schedule_revision" integer,
	"scheduled_for" timestamp with time zone,
	"durable_run_id" text,
	"durable_attempt" integer DEFAULT 0 NOT NULL,
	"attempt_started_at" timestamp with time zone,
	"completed_search_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"stop_reason" text,
	"budget" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"completed_steps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_budget_bound" CHECK ("discovery_run"."budget" > 0 and "discovery_run"."used" >= 0 and "discovery_run"."used" <= "discovery_run"."budget")
);
--> statement-breakpoint
ALTER TABLE "discovery_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"revision" integer NOT NULL,
	"dispatch_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"brief" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"last_command" jsonb NOT NULL,
	"status" text NOT NULL,
	"next_due_at" timestamp with time zone,
	"failure" text,
	"last_run_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"units" integer NOT NULL,
	"position" integer NOT NULL,
	"outcome" text NOT NULL,
	"query" text,
	"returned_results" integer,
	"step_key" text,
	"execution_id" uuid,
	"sources" jsonb,
	"source_url" text,
	"checked_at" timestamp with time zone,
	"provider_cost" jsonb,
	"check_order" bigint,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "discovery_usage_positive" CHECK ("discovery_usage"."units" > 0),
	CONSTRAINT "discovery_returned_results_nonnegative" CHECK ("discovery_usage"."returned_results" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discovery_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_action_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"action_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"review" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_action_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_eligibility_evaluation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"action_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_eligibility_evaluation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_handoff" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"revision_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"contact_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_handoff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_handoff_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"handoff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"source" jsonb,
	CONSTRAINT "email_handoff_evidence_kind" CHECK (("email_handoff_evidence"."kind" in ('prepared','user_marked_sent') and "email_handoff_evidence"."source" is null) or ("email_handoff_evidence"."kind" in ('sent_folder_observed','reply_observed') and "email_handoff_evidence"."source" is not null))
);
--> statement-breakpoint
ALTER TABLE "email_handoff_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_market_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_market_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_recipient_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"recipient" text NOT NULL,
	"version" integer NOT NULL,
	"facts" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_recipient_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_sequence_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"run_id" uuid NOT NULL,
	"contact_id" text NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"identity" jsonb NOT NULL,
	"control_version" integer NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone,
	"generation" integer NOT NULL,
	"execution_key" uuid NOT NULL,
	"recovery_at" timestamp with time zone,
	"attempt_id" uuid,
	"receipt" jsonb,
	"processing_acceptance" jsonb,
	"queue_state" text NOT NULL,
	"queue_run_id" text,
	CONSTRAINT "email_sequence_action_bounds" CHECK ("email_sequence_action"."step_index">=0 and "email_sequence_action"."generation">0)
);
--> statement-breakpoint
ALTER TABLE "email_sequence_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_sequence_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"run_id" uuid NOT NULL,
	"action_id" uuid,
	"kind" text NOT NULL,
	"reason" text,
	"source" jsonb,
	"note" text,
	"attempt_id" uuid,
	"envelope" jsonb,
	"receipt" jsonb,
	"processing_acceptance" jsonb
);
--> statement-breakpoint
ALTER TABLE "email_sequence_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_sequence_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_sequence_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_sequence_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"revision_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"identity" jsonb NOT NULL,
	"state" text NOT NULL,
	"version" integer NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "email_sequence_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"recipient" text NOT NULL,
	"request_key" uuid NOT NULL,
	"suppression" jsonb NOT NULL,
	"evidence" jsonb,
	"source" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_suppression" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_access" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "file_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"account_scope" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_case" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position" bigserial NOT NULL,
	"business_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"recovery_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"native_dispute_id" text,
	"intent" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "financial_case_scope" UNIQUE("id","business_id"),
	CONSTRAINT "financial_case_binding" CHECK ("financial_case"."intent"->'invoice'->>'id'="financial_case"."invoice_id"::text and "financial_case"."intent"->'period'->>'id'="financial_case"."period_id"::text and "financial_case"."intent"->'period'->>'businessId'="financial_case"."business_id"::text and "financial_case"."intent"->'input'->>'kind'="financial_case"."kind"
        and "financial_case"."intent"->>'key'="financial_case"."id"::text and "financial_case"."intent"->'input'->>'invoiceId'="financial_case"."invoice_id"::text and "financial_case"."intent"->'input'->>'requestKey'="financial_case"."request_key"::text
        and "financial_case"."intent"->'invoice'->>'periodId'="financial_case"."period_id"::text and "financial_case"."intent"->'invoice'->>'businessId'="financial_case"."business_id"::text
        and "financial_case"."intent"->'invoice'->'snapshot'->'source'->>'paymentId'="financial_case"."intent"->'period'->>'paymentId'
        and (("financial_case"."kind"='refund' and "financial_case"."native_dispute_id" is null) or ("financial_case"."kind"='dispute' and "financial_case"."native_dispute_id"="financial_case"."intent"->'input'->>'disputeId')))
);
--> statement-breakpoint
ALTER TABLE "financial_case" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_case_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position" bigserial NOT NULL,
	"case_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "financial_case_event_access" CHECK (not ("financial_case_event"."detail" ? 'access') or "financial_case_event"."detail"->>'access' in ('preserve','block_period'))
);
--> statement-breakpoint
ALTER TABLE "financial_case_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"mode" text NOT NULL,
	"event_id" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_receipt_binding" CHECK ("financial_receipt"."receipt"->>'eventId'="financial_receipt"."event_id" and "financial_receipt"."receipt"->>'account'="financial_receipt"."account" and "financial_receipt"."receipt"->>'mode'="financial_receipt"."mode")
);
--> statement-breakpoint
ALTER TABLE "financial_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gmail_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"account_subject" text,
	"credentials" text,
	"rejected_credentials" text,
	"scopes" jsonb NOT NULL,
	"authorized_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	CONSTRAINT "gmail_generation" CHECK ("gmail_grant"."generation" > 0),
	CONSTRAINT "gmail_status" CHECK ("gmail_grant"."status" in ('connecting','connected','reconnect_required','insufficient','revocation_pending','disconnected'))
);
--> statement-breakpoint
ALTER TABLE "gmail_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gmail_manual_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"native_sync_generation" integer,
	"mailbox_id" uuid NOT NULL,
	"message_ref" text NOT NULL,
	"policy_version" integer NOT NULL,
	"metadata" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"current_metadata" jsonb,
	"fingerprint" text NOT NULL,
	"conversation_id" uuid,
	"opportunity_id" uuid,
	"state" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_manual_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gmail_oauth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"state_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmail_oauth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "google_calendar_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"account_subject" text,
	"account_email" text,
	"selected_calendar_id" text,
	"credentials" text,
	"rejected_credentials" text,
	"scopes" jsonb NOT NULL,
	"authorized_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "google_calendar_generation" CHECK ("google_calendar_grant"."generation" > 0),
	CONSTRAINT "google_calendar_status" CHECK ("google_calendar_grant"."status" in ('connecting','selection_required','ready','reconnect_required','insufficient','revocation_pending','disconnected'))
);
--> statement-breakpoint
ALTER TABLE "google_calendar_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "google_calendar_oauth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"return_path" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_calendar_oauth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_association" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"initial_opportunity_id" uuid NOT NULL,
	"default_opportunity_id" uuid,
	"version" integer NOT NULL,
	"review_reason" text,
	"review_owner_id" text NOT NULL,
	"next_action" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_association" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_association_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"source_event_id" text,
	"discovery_observation_id" uuid,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_association_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_buyer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"sender_ref" text NOT NULL,
	"name" text NOT NULL,
	"geography" text,
	"engaged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_buyer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"label" text NOT NULL,
	"channel" text NOT NULL,
	"conversation_refs" jsonb NOT NULL,
	"active" boolean NOT NULL,
	"mode" text DEFAULT 'normalized_import' NOT NULL,
	"manual_replies_observable" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_channel" CHECK ("inbox_connection"."channel" in ('email','whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "inbox_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"provider_ref" text NOT NULL,
	"subject" text NOT NULL,
	"last_received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_ref" text NOT NULL,
	"fingerprint" text NOT NULL,
	"conversation_id" uuid,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"native_sync_generation" integer,
	"connection_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_ref" text NOT NULL,
	"content" jsonb NOT NULL,
	"mailbox_metadata" jsonb,
	"mailbox_current_metadata" jsonb,
	"fingerprint" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_message_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"conversation_id" uuid NOT NULL,
	"opportunity_id" uuid
);
--> statement-breakpoint
ALTER TABLE "inbox_message_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_opportunity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid,
	"conversation_id" uuid,
	"buyer_id" uuid,
	"title" text DEFAULT 'Purchasing need' NOT NULL,
	"stage" text NOT NULL,
	"owner_id" text,
	"handoff_reason" text NOT NULL,
	"next_action" text NOT NULL,
	"control_state" text DEFAULT 'human' NOT NULL,
	"control_version" integer DEFAULT 0 NOT NULL,
	"policy_version" integer,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_initial_stage" CHECK ("inbox_opportunity"."stage" in ('inquiry','prospect')),
	CONSTRAINT "opportunity_control_state" CHECK ("inbox_opportunity"."control_state" in ('human','automation') and "inbox_opportunity"."control_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inbox_opportunity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inbox_opportunity_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"actor_id" text,
	"source_ref" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_opportunity_history_kind" CHECK ("inbox_opportunity_history"."kind" in ('ownership','booking_request','confirmed_appointment','attended_appointment','quotation_request','issued_quote','sale'))
);
--> statement-breakpoint
ALTER TABLE "inbox_opportunity_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "infrastructure_recovery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"authorized_session_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"stage" text DEFAULT 'requested' NOT NULL,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_business_scope" UNIQUE("id","business_id"),
	CONSTRAINT "recovery_request_once" UNIQUE("request_key"),
	CONSTRAINT "recovery_plan_scope" CHECK ("infrastructure_recovery"."plan"->>'businessId'="infrastructure_recovery"."business_id"::text and "infrastructure_recovery"."plan_hash"=encode(sha256(convert_to("infrastructure_recovery"."plan"::text,'UTF8')),'hex'))
);
--> statement-breakpoint
ALTER TABLE "infrastructure_recovery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "infrastructure_recovery_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position" bigserial NOT NULL,
	"business_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "infrastructure_recovery_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inquiry_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"request_key" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"execution_id" uuid,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inquiry_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"business_name" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivery" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"delivery_started_at" timestamp with time zone,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_role" CHECK ("invitation"."role" in ('admin', 'salesperson')),
	CONSTRAINT "invitation_status" CHECK ("invitation"."status" in ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "invitation_delivery" CHECK ("invitation"."delivery" in ('pending', 'sending', 'sent', 'unconfirmed'))
);
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_issuer_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_issuer_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_issuer_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_issuer_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "knowledge_version_positive" CHECK ("knowledge_revision"."version" > 0),
	CONSTRAINT "knowledge_action" CHECK ("knowledge_revision"."action" in ('draft', 'approved', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "knowledge_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mailbox_app_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_ref" text NOT NULL,
	"internet_message_id" text NOT NULL,
	"reply_to_message_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox_app_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mailbox_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"successor_id" uuid,
	"policy_version" integer NOT NULL,
	"identity" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"cursor" text,
	"seen" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mailbox_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_version" integer NOT NULL,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"incremental_since" timestamp with time zone NOT NULL,
	"cursor" text,
	"permission_observation" jsonb,
	"visibility" text DEFAULT 'unsafe' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"complete_reply_capture" boolean DEFAULT false NOT NULL,
	CONSTRAINT "mailbox_policy_version" CHECK ("mailbox_policy"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mailbox_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership" (
	"business_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	CONSTRAINT "membership_business_id_user_id_pk" PRIMARY KEY("business_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("membership"."role" in ('owner', 'admin', 'salesperson'))
);
--> statement-breakpoint
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsoft_calendar_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"account_subject" text,
	"account_email" text,
	"account_kind" text,
	"tenant_id" text,
	"selected_calendar_id" text,
	"credentials" text,
	"scopes" jsonb NOT NULL,
	"authorized_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "microsoft_calendar_generation" CHECK ("microsoft_calendar_grant"."generation" > 0),
	CONSTRAINT "microsoft_calendar_status" CHECK ("microsoft_calendar_grant"."status" in ('connecting','selection_required','ready','reconnect_required','insufficient','disconnected'))
);
--> statement-breakpoint
ALTER TABLE "microsoft_calendar_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsoft_calendar_oauth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"return_path" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsoft_calendar_oauth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsoft_mail_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"account_subject" text,
	"credentials" text,
	"rejected_credentials" text,
	"scopes" jsonb NOT NULL,
	"authorized_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	CONSTRAINT "microsoft_mail_generation" CHECK ("microsoft_mail_grant"."generation" > 0),
	CONSTRAINT "microsoft_mail_status" CHECK ("microsoft_mail_grant"."status" in ('connecting','connected','reconnect_required','insufficient','revocation_pending','disconnected'))
);
--> statement-breakpoint
ALTER TABLE "microsoft_mail_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsoft_mail_oauth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"state_hash" text NOT NULL,
	"verifier" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsoft_mail_oauth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lease" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_notice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"purpose" text NOT NULL,
	"source_id" text NOT NULL,
	"source_stage" text NOT NULL,
	"business_id" uuid,
	"actor_id" text,
	"authority" text NOT NULL,
	"auth_user_id" text,
	"recipient_digest" text,
	"capability" uuid NOT NULL,
	"key" text NOT NULL,
	"key_ref" text NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"uncertain" boolean DEFAULT false NOT NULL,
	"prior_uncertain" boolean DEFAULT false NOT NULL,
	"provider_id" text,
	"first_attempt_at" timestamp with time zone,
	"retry_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"binding" jsonb NOT NULL,
	"terms" jsonb,
	"reason" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "notification_purpose" CHECK ("notification_notice"."purpose" in ('authentication','invitation','cost_alert','sender_health','handoff','operations','subscription','tax_period')),
	CONSTRAINT "notification_state" CHECK ("notification_notice"."state" in ('pending','sending','accepted','uncertain','rate_limited','rejected','held','expired'))
);
--> statement-breakpoint
ALTER TABLE "notification_notice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_payload" (
	"notice_id" uuid PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_payload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"actor_id" text NOT NULL,
	"business_id" uuid,
	"purpose" text NOT NULL,
	"enabled" boolean NOT NULL,
	"version" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"event_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"stage" text NOT NULL,
	"raw_hash" text NOT NULL,
	"recipient_digest" text NOT NULL,
	"sender_digest" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_setup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"binding" jsonb NOT NULL,
	"setup" jsonb,
	"capability" uuid DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"completed_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_setup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"terms" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"auth_bootstrap" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operation_detail" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operation_detail_kind" CHECK ("operation_detail"."kind" in ('diagnostic','audit') and "operation_detail"."code" ~ '^[A-Z_]{1,80}$')
);
--> statement-breakpoint
ALTER TABLE "operation_detail" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operation_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position" bigserial NOT NULL,
	"business_id" uuid NOT NULL,
	"source" text NOT NULL,
	"target_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"request_key" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_snapshot_scope" CHECK ("operation_event"."snapshot"->>'businessId'="operation_event"."business_id"::text and "operation_event"."snapshot"->>'targetId'="operation_event"."target_id"::text and "operation_event"."snapshot"->>'source'="operation_event"."source")
);
--> statement-breakpoint
ALTER TABLE "operation_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operation_retention" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_retention_positive" CHECK ("operation_retention"."version">0 and ("operation_retention"."policy"->>'diagnosticSeconds')::integer>0 and ("operation_retention"."policy"->>'auditDetailSeconds')::integer>0)
);
--> statement-breakpoint
ALTER TABLE "operation_retention" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunity_control_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"command" text NOT NULL,
	"actor_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"source_ref" text,
	"policy" jsonb,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_control_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunity_due_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"message_id" uuid,
	"connection_id" uuid NOT NULL,
	"conversation_id" uuid,
	"whatsapp_plan_id" uuid,
	"whatsapp_step" integer,
	"whatsapp_peer" text,
	"meta_recovery_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"control_version" integer NOT NULL,
	"association_version" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"inquiry_run_id" uuid,
	"email" jsonb,
	"evaluation" jsonb,
	"state" text NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "opportunity_action_origin" CHECK (("opportunity_due_action"."whatsapp_plan_id" IS NULL AND "opportunity_due_action"."whatsapp_step" IS NULL AND "opportunity_due_action"."whatsapp_peer" IS NULL AND "opportunity_due_action"."message_id" IS NOT NULL AND "opportunity_due_action"."conversation_id" IS NOT NULL) OR ("opportunity_due_action"."whatsapp_plan_id" IS NOT NULL AND "opportunity_due_action"."whatsapp_step" IS NOT NULL AND "opportunity_due_action"."whatsapp_peer" IS NOT NULL AND "opportunity_due_action"."whatsapp_step">=0 AND "opportunity_due_action"."whatsapp_peer" ~ '^[1-9][0-9]{6,14}$' AND "opportunity_due_action"."message_id" IS NULL AND "opportunity_due_action"."conversation_id" IS NULL AND "opportunity_due_action"."inquiry_run_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "opportunity_due_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunity_manual_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"event_ref" text NOT NULL,
	"message_ref" text NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_manual_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pilot_effect" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"pilot_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"operation_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"cash_minor" bigint NOT NULL,
	"spend_minor" bigint NOT NULL,
	"global_inr_micros" bigint NOT NULL,
	"actor_id" text NOT NULL,
	"intent" jsonb NOT NULL,
	"seconds" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_effect_nonnegative" CHECK ("pilot_effect"."quantity">0 and "pilot_effect"."cash_minor">=0 and "pilot_effect"."spend_minor">=0 and "pilot_effect"."global_inr_micros">=0 and "pilot_effect"."seconds">0)
);
--> statement-breakpoint
ALTER TABLE "pilot_effect" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pilot_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"pilot_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"position" bigserial NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_event_kind" CHECK ("pilot_event"."kind" in ('prepared','approved','activated','effort','results','renewal','reuse','stopped','setup_authorized'))
);
--> statement-breakpoint
ALTER TABLE "pilot_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pilot_record" (
	"id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_record_pkey" PRIMARY KEY("id","business_id"),
	CONSTRAINT "pilot_snapshot_scope" CHECK ("pilot_record"."snapshot"->'payment'->'quote'->>'businessId'="pilot_record"."business_id"::text and "pilot_record"."snapshot"->'plan'->>'paymentActionId' is not null)
);
--> statement-breakpoint
ALTER TABLE "pilot_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_operator" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tax" boolean DEFAULT false NOT NULL,
	"reconciliation" boolean DEFAULT false NOT NULL,
	"refunds" boolean DEFAULT false NOT NULL,
	"ai" boolean DEFAULT false NOT NULL,
	"discovery" boolean DEFAULT false NOT NULL,
	"email_policy" boolean DEFAULT false NOT NULL,
	"pricing" boolean DEFAULT false NOT NULL,
	"whatsapp_review" boolean DEFAULT false NOT NULL,
	"sender_health" boolean DEFAULT false NOT NULL,
	"documents" boolean DEFAULT false NOT NULL,
	"operations" boolean DEFAULT false NOT NULL,
	"recovery" boolean DEFAULT false NOT NULL,
	"pilots" boolean DEFAULT false NOT NULL,
	"costs" boolean DEFAULT false NOT NULL,
	"notifications" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_operator" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "reach_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"recovery_key" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reach_change_scope" UNIQUE("id","business_id"),
	CONSTRAINT "reach_change_snapshot_scope" CHECK ("reach_change"."snapshot"->'original'->>'id'="reach_change"."period_id"::text and "reach_change"."snapshot"->'original'->>'businessId'="reach_change"."business_id"::text and "reach_change"."snapshot"->'action'->>'id'="reach_change"."action_id"::text and "reach_change"."snapshot"->'target'->'quote'->>'id'="reach_change"."quote_id"::text)
);
--> statement-breakpoint
ALTER TABLE "reach_change" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reach_change_event" (
	"position" bigserial NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"key" text NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone NOT NULL,
	"fact" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reach_change_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (statement_timestamp()+interval '60 seconds') NOT NULL,
	CONSTRAINT "reconciliation_access_expiry" CHECK ("reconciliation_access"."expires_at">"reconciliation_access"."at" and "reconciliation_access"."expires_at"<="reconciliation_access"."at"+interval '60 seconds')
);
--> statement-breakpoint
ALTER TABLE "reconciliation_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"source" text NOT NULL,
	"reference" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"content_base64" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"note" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_evidence_bounds" CHECK ("reconciliation_evidence"."bytes">0 and "reconciliation_evidence"."bytes"<=262144 and length("reconciliation_evidence"."content_base64")<=350000 and "reconciliation_evidence"."sha256" ~ '^[a-f0-9]{64}$' and "reconciliation_evidence"."source" in ('provider_statement','bank_statement','conversion_confirmation') and octet_length(decode("reconciliation_evidence"."content_base64",'base64'))="reconciliation_evidence"."bytes" and encode(sha256(decode("reconciliation_evidence"."content_base64",'base64')),'hex')="reconciliation_evidence"."sha256")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"evidence_id" uuid NOT NULL,
	"supersedes" uuid,
	"identity" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_record_binding" CHECK (coalesce(("reconciliation_record"."data"->>'requestKey'="reconciliation_record"."request_key"::text and "reconciliation_record"."data"->>'evidenceId'="reconciliation_record"."evidence_id"::text and ("reconciliation_record"."data"->>'supersedes') is not distinct from "reconciliation_record"."supersedes"::text and "reconciliation_record"."data"->>'kind' in ('settlement','bank_receipt') and octet_length("reconciliation_record"."data"::text)<=1048576),false))
);
--> statement-breakpoint
ALTER TABLE "reconciliation_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"report_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"discrepancy" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_review_outcome" CHECK ("reconciliation_review"."outcome" in ('acknowledged','resolved') and "reconciliation_review"."report_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "reconciliation_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rfq_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfq_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rfq_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"actor_id" text NOT NULL,
	"record" jsonb NOT NULL,
	"note" text NOT NULL,
	"next_action" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "rfq_revision_positive" CHECK ("rfq_revision"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "rfq_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"original_id" uuid,
	"adjustment_id" uuid,
	"adjustment_source" text,
	"recovery_key" uuid NOT NULL,
	"retry_after" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"series_key" text NOT NULL,
	"ordinal" bigint NOT NULL,
	"number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"account_scope" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"artifact_state" text NOT NULL,
	"failure" text,
	CONSTRAINT "seller_document_scope" UNIQUE("id","business_id"),
	CONSTRAINT "seller_document_binding" CHECK ("seller_document"."snapshot"->'source'->>'periodId'="seller_document"."period_id"::text and (("seller_document"."kind"='invoice' and "seller_document"."original_id" is null) or ("seller_document"."kind"='credit_note' and "seller_document"."original_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "seller_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_document_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_document_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_document_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_document_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_document_storage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_document_storage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sender_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"configuration" jsonb NOT NULL,
	CONSTRAINT "sender_connection_version" CHECK ("sender_connection"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sender_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sender_health_record" (
	"position" bigserial NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "sender_health_record_kind" CHECK ("sender_health_record"."kind" in ('policy','evidence','incident','failure','repair','alert','acknowledgement') and "sender_health_record"."kind"="sender_health_record"."payload"->>'kind')
);
--> statement-breakpoint
ALTER TABLE "sender_health_record" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sender_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"configuration" jsonb NOT NULL,
	"connection_id" uuid,
	"reply_route_id" uuid
);
--> statement-breakpoint
ALTER TABLE "sender_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sender_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"evidence" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sender_reply_route" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"configuration" jsonb NOT NULL,
	"connection_id" uuid NOT NULL,
	"inbox_connection_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sender_reply_route" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"mfa_verified_at" timestamp with time zone,
	"mfa_factor_id" text,
	"mfa_factor_version" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscription_lifecycle_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone NOT NULL,
	"lifecycle" jsonb NOT NULL,
	"notice" jsonb
);
--> statement-breakpoint
ALTER TABLE "subscription_lifecycle_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"operation_key" uuid NOT NULL,
	"recovery_key" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"started" boolean DEFAULT false NOT NULL,
	"reason" text,
	"checkout" jsonb,
	"observation" jsonb,
	"recovery" jsonb,
	"lifecycle" jsonb,
	"reconciled_at" timestamp with time zone,
	"reconciliation_pending" boolean DEFAULT false NOT NULL,
	CONSTRAINT "subscription_payment_scope" UNIQUE("id","business_id"),
	CONSTRAINT "subscription_payment_snapshot_scope" CHECK ("subscription_payment"."snapshot"->'quote'->>'businessId'="subscription_payment"."business_id"::text and "subscription_payment"."snapshot"->'quote'->>'id'="subscription_payment"."quote_id"::text)
);
--> statement-breakpoint
ALTER TABLE "subscription_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payment_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid,
	"action_id" uuid,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"observation" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_payment_event_optional_scope" CHECK (("subscription_payment_event"."business_id" is null)=("subscription_payment_event"."action_id" is null))
);
--> statement-breakpoint
ALTER TABLE "subscription_payment_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payment_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"detail" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_payment_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account" text NOT NULL,
	"payment_id" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"charge" jsonb,
	CONSTRAINT "subscription_period_scope" UNIQUE("id","business_id"),
	CONSTRAINT "subscription_period_window" CHECK ("subscription_period"."end">"subscription_period"."start")
);
--> statement-breakpoint
ALTER TABLE "subscription_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_pricing_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"offers" jsonb NOT NULL,
	"note" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_pricing_version_positive" CHECK ("subscription_pricing_revision"."version" > 0 and "subscription_pricing_revision"."effective_from" >= "subscription_pricing_revision"."at")
);
--> statement-breakpoint
ALTER TABLE "subscription_pricing_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_quote" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"pricing_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_quote_scope" UNIQUE("id","business_id")
);
--> statement-breakpoint
ALTER TABLE "subscription_quote" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscription_usage_positive" CHECK ("subscription_usage"."quantity">0)
);
--> statement-breakpoint
ALTER TABLE "subscription_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_calculation" (
	"version" integer NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"resolves_id" uuid,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "tax_calculation_version_positive" CHECK ("tax_calculation"."version">0),
	CONSTRAINT "tax_calculation_snapshot_scope" CHECK ("tax_calculation"."snapshot"->>'id'="tax_calculation"."id"::text and "tax_calculation"."snapshot"->>'businessId'="tax_calculation"."business_id"::text and "tax_calculation"."snapshot"->>'actorId'="tax_calculation"."actor_id" and "tax_calculation"."snapshot"->>'requestKey'="tax_calculation"."request_key"::text)
);
--> statement-breakpoint
ALTER TABLE "tax_calculation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"evidence_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"access_hash" text NOT NULL,
	"session_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tax_filing_access_expiry" CHECK ("tax_filing_access"."expires_at">"tax_filing_access"."at" and "tax_filing_access"."expires_at"<="tax_filing_access"."at"+interval '30 seconds')
);
--> statement-breakpoint
ALTER TABLE "tax_filing_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_bytes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_filing_bytes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb NOT NULL,
	"confirmation_key" text,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_filing_confirmation_key" CHECK (coalesce(("tax_filing_event"."kind"='confirm' and "tax_filing_event"."confirmation_key" ~ '^[a-f0-9]{64}$') or ("tax_filing_event"."kind"<>'confirm' and "tax_filing_event"."confirmation_key" is null),false)),
	CONSTRAINT "tax_filing_event_valid" CHECK ("tax_filing_event"."version">0 and "tax_filing_event"."kind" in ('approve','attempt','acknowledge','confirm','raise_issue','resolve_issue','supersede'))
);
--> statement-breakpoint
ALTER TABLE "tax_filing_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"target" jsonb,
	"metadata" jsonb NOT NULL,
	"storage_database" text DEFAULT current_database() NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_filing_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_export" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_filing_export_binding" CHECK (coalesce("tax_filing_export"."report"->>'id'="tax_filing_export"."report_id"::text and "tax_filing_export"."report"->>'status'='approved' and ("tax_filing_export"."report"->>'current')::boolean,false))
);
--> statement-breakpoint
ALTER TABLE "tax_filing_export" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_decision_id" uuid NOT NULL,
	"report_approval_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"amount_minor" text NOT NULL,
	"basis_digest" text NOT NULL,
	"amendment_of" uuid,
	"supersedes_id" uuid,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_filing_basis_digest" CHECK ("tax_filing_intent"."basis_digest" ~ '^[a-f0-9]{64}$' and "tax_filing_intent"."supersedes_id" is distinct from "tax_filing_intent"."id"),
	CONSTRAINT "tax_filing_intent_binding" CHECK (coalesce("tax_filing_intent"."kind" in ('submission','remittance') and "tax_filing_intent"."report"->>'id'="tax_filing_intent"."report_id"::text and "tax_filing_intent"."target"->>'reportId'="tax_filing_intent"."report_id"::text and "tax_filing_intent"."policy"->>'id'="tax_filing_intent"."policy_id"::text and "tax_filing_intent"."amount_minor" ~ '^-?(0|[1-9][0-9]{0,59})$' and ("tax_filing_intent"."kind"='submission' or "tax_filing_intent"."amount_minor" not like '-%') and "tax_filing_intent"."amendment_of" is distinct from "tax_filing_intent"."id",false))
);
--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_policy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"obligation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_filing_policy_positive_version" CHECK ("tax_filing_policy"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_filing_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_filing_policy_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_filing_policy_decision_valid" CHECK ("tax_filing_policy_decision"."version">0 and "tax_filing_policy_decision"."outcome" in ('approved','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "tax_filing_policy_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_liability_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"digest" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_liability_report_binding" CHECK ("tax_liability_report"."snapshot"->'period'->>'id'="tax_liability_report"."period_id"::text and "tax_liability_report"."digest" ~ '^[a-f0-9]{64}$' and "tax_liability_report"."revision">0)
);
--> statement-breakpoint
ALTER TABLE "tax_liability_report" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_obligation_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_obligation_decision_outcome" CHECK ("tax_obligation_decision"."outcome" in ('approved','withdrawn') and "tax_obligation_decision"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_obligation_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_obligation_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_obligation_version" CHECK ("tax_obligation_revision"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_obligation_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_period_reminder" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"stage_at" timestamp with time zone NOT NULL,
	"source" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_period_reminder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_remittance_allocation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"confirmation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"reference_key" text NOT NULL,
	"amount_minor" text NOT NULL,
	"currency" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_remittance_amount" CHECK ("tax_remittance_allocation"."amount_minor" ~ '^(0|[1-9][0-9]{0,59})$' and "tax_remittance_allocation"."currency" in ('INR','USD'))
);
--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_remittance_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"allocation_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_decision_id" uuid NOT NULL,
	"report_approval_id" uuid NOT NULL,
	CONSTRAINT "tax_remittance_review_positive_version" CHECK ("tax_remittance_review"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_report_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_report_action_kind" CHECK ("tax_report_action"."kind" in ('review','raise_issue','resolve_issue','approve','invalidated') and "tax_report_action"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_report_action" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_reporting_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"obligation_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"definition" jsonb NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "tax_reporting_period_binding" CHECK ("tax_reporting_period"."definition"->>'id'="tax_reporting_period"."id"::text and "tax_reporting_period"."definition"->>'obligationId'="tax_reporting_period"."obligation_id"::text and coalesce("tax_reporting_period"."definition"->>'supersedesId','')=coalesce("tax_reporting_period"."supersedes_id"::text,'') and "tax_reporting_period"."supersedes_id" is distinct from "tax_reporting_period"."id" and ("tax_reporting_period"."definition"->>'end')::timestamptz>("tax_reporting_period"."definition"->>'start')::timestamptz)
);
--> statement-breakpoint
ALTER TABLE "tax_reporting_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_rule_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"note" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "tax_decision_version_positive" CHECK ("tax_rule_decision"."version">0),
	CONSTRAINT "tax_decision_outcome" CHECK ("tax_rule_decision"."outcome" in ('approved','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "tax_rule_decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_rule_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"rule" jsonb NOT NULL,
	"note" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "tax_rule_version_positive" CHECK ("tax_rule_revision"."version">0)
);
--> statement-breakpoint
ALTER TABLE "tax_rule_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factor_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"terms_actor_id" text NOT NULL,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"credentials" text,
	"provider_key" text,
	"observation" jsonb,
	"operation_id" uuid,
	"assets" jsonb,
	"coexistence_finished" boolean DEFAULT false NOT NULL,
	"phone_number_id" text,
	CONSTRAINT "whatsapp_version" CHECK ("whatsapp_connection"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"terms" jsonb,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"review" jsonb,
	"revocation" jsonb,
	CONSTRAINT "whatsapp_evidence_decision" CHECK (("whatsapp_evidence"."review" is null) <> ("whatsapp_evidence"."revocation" is null)),
	CONSTRAINT "whatsapp_evidence_positive_version" CHECK ("whatsapp_evidence"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_intake" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_version" integer NOT NULL,
	"account_key" text NOT NULL,
	"inbox_connection_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"enabled_at" timestamp with time zone NOT NULL,
	"receipt_retention_seconds" integer NOT NULL,
	"inbound_at" timestamp with time zone,
	"echo_at" timestamp with time zone,
	"gap" text,
	CONSTRAINT "whatsapp_intake_bounds" CHECK ("whatsapp_intake"."connection_version">0 and "whatsapp_intake"."receipt_retention_seconds">=60)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_intake" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_oauth" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_oauth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_outbound" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"position" bigserial NOT NULL,
	"connection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"actor_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_outbound" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_version" integer NOT NULL,
	"account_key" text NOT NULL,
	"event_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"activity" jsonb,
	"kind" text NOT NULL,
	"message_ref" text,
	"peer" text,
	"reply_to" text,
	"provider_status" text,
	"status_evidence" jsonb,
	"state" text NOT NULL,
	"conversation_id" uuid,
	"opportunity_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "whatsapp_receipt_state" CHECK ("whatsapp_receipt"."state" in ('pending','processed','historical','review','expired') and "whatsapp_receipt"."kind" in ('incoming','app_echo','status','gap') and "whatsapp_receipt"."connection_version">0)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_activation" ADD CONSTRAINT "ai_activation_profile_id_ai_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_activation_audit" ADD CONSTRAINT "ai_activation_audit_id_ai_activation_id_fk" FOREIGN KEY ("id") REFERENCES "public"."ai_activation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_activation_audit" ADD CONSTRAINT "ai_activation_audit_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_activation_audit" ADD CONSTRAINT "ai_activation_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attempt" ADD CONSTRAINT "ai_attempt_execution_id_ai_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."ai_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_attempt" ADD CONSTRAINT "ai_attempt_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution" ADD CONSTRAINT "ai_execution_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution" ADD CONSTRAINT "ai_execution_profile_id_ai_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ai_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution" ADD CONSTRAINT "ai_execution_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_profile" ADD CONSTRAINT "ai_profile_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review" ADD CONSTRAINT "ai_review_execution_id_ai_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."ai_execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review" ADD CONSTRAINT "ai_review_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review" ADD CONSTRAINT "ai_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_history" ADD CONSTRAINT "appointment_history_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_history" ADD CONSTRAINT "appointment_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profile_review" ADD CONSTRAINT "billing_profile_review_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profile_review" ADD CONSTRAINT "billing_profile_review_profile_id_billing_profile_revision_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."billing_profile_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profile_review" ADD CONSTRAINT "billing_profile_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profile_revision" ADD CONSTRAINT "billing_profile_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_profile_revision" ADD CONSTRAINT "billing_profile_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policy" ADD CONSTRAINT "booking_policy_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_policy" ADD CONSTRAINT "booking_policy_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_event" ADD CONSTRAINT "business_data_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_export" ADD CONSTRAINT "business_data_export_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_export" ADD CONSTRAINT "business_data_export_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_grant" ADD CONSTRAINT "business_data_grant_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_request" ADD CONSTRAINT "business_data_request_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_data_request" ADD CONSTRAINT "business_data_request_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_file" ADD CONSTRAINT "business_file_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_file" ADD CONSTRAINT "business_file_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_activity" ADD CONSTRAINT "call_activity_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_activity" ADD CONSTRAINT "call_activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_revision" ADD CONSTRAINT "call_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_revision" ADD CONSTRAINT "call_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_revision" ADD CONSTRAINT "call_revision_responsible_id_user_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_decision" ADD CONSTRAINT "campaign_decision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_decision" ADD CONSTRAINT "campaign_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_decision" ADD CONSTRAINT "campaign_decision_revision_id_campaign_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."campaign_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_revision" ADD CONSTRAINT "campaign_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_authority_revision" ADD CONSTRAINT "commercial_authority_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_authority_revision" ADD CONSTRAINT "commercial_authority_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_decision" ADD CONSTRAINT "commercial_decision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_decision" ADD CONSTRAINT "commercial_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_execution" ADD CONSTRAINT "commercial_execution_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_execution" ADD CONSTRAINT "commercial_execution_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_outcome" ADD CONSTRAINT "commercial_outcome_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_outcome" ADD CONSTRAINT "commercial_outcome_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal" ADD CONSTRAINT "commercial_proposal_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal" ADD CONSTRAINT "commercial_proposal_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_alert" ADD CONSTRAINT "operator_cost_alert_budget_id_operator_cost_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."operator_cost_budget"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_alert" ADD CONSTRAINT "operator_cost_alert_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_budget" ADD CONSTRAINT "operator_cost_budget_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_budget" ADD CONSTRAINT "operator_cost_budget_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_notification_event" ADD CONSTRAINT "operator_cost_notification_event_alert_id_operator_cost_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."operator_cost_alert"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_notification_event" ADD CONSTRAINT "operator_cost_notification_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_planning" ADD CONSTRAINT "operator_cost_planning_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_record" ADD CONSTRAINT "operator_cost_record_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_cost_scan" ADD CONSTRAINT "operator_cost_scan_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capacity_binding" ADD CONSTRAINT "discovery_capacity_binding_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capacity_binding" ADD CONSTRAINT "discovery_capacity_binding_run_id_discovery_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capacity_binding" ADD CONSTRAINT "discovery_capacity_binding_policy_id_discovery_capacity_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."discovery_capacity_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_capacity_policy" ADD CONSTRAINT "discovery_capacity_policy_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_command" ADD CONSTRAINT "discovery_command_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_command" ADD CONSTRAINT "discovery_command_run_id_discovery_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_command" ADD CONSTRAINT "discovery_command_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_configuration" ADD CONSTRAINT "discovery_configuration_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_dispatch" ADD CONSTRAINT "discovery_dispatch_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_observation" ADD CONSTRAINT "discovery_observation_id_discovery_usage_id_fk" FOREIGN KEY ("id") REFERENCES "public"."discovery_usage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_observation" ADD CONSTRAINT "discovery_observation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_observation" ADD CONSTRAINT "discovery_observation_run_id_discovery_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_observation" ADD CONSTRAINT "discovery_observation_prospect_id_discovery_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."discovery_prospect"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_prospect" ADD CONSTRAINT "discovery_prospect_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_prospect_alias" ADD CONSTRAINT "discovery_prospect_alias_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_prospect_alias" ADD CONSTRAINT "discovery_prospect_alias_prospect_id_discovery_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."discovery_prospect"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_result" ADD CONSTRAINT "discovery_result_run_id_discovery_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_result" ADD CONSTRAINT "discovery_result_prospect_id_discovery_prospect_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."discovery_prospect"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_result" ADD CONSTRAINT "discovery_result_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_run" ADD CONSTRAINT "discovery_run_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_run" ADD CONSTRAINT "discovery_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_schedule" ADD CONSTRAINT "discovery_schedule_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_schedule" ADD CONSTRAINT "discovery_schedule_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_usage" ADD CONSTRAINT "discovery_usage_run_id_discovery_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_usage" ADD CONSTRAINT "discovery_usage_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_action_review" ADD CONSTRAINT "email_action_review_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_action_review" ADD CONSTRAINT "email_action_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_eligibility_evaluation" ADD CONSTRAINT "email_eligibility_evaluation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_eligibility_evaluation" ADD CONSTRAINT "email_eligibility_evaluation_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff" ADD CONSTRAINT "email_handoff_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff" ADD CONSTRAINT "email_handoff_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff" ADD CONSTRAINT "email_handoff_revision_id_campaign_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."campaign_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff_evidence" ADD CONSTRAINT "email_handoff_evidence_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff_evidence" ADD CONSTRAINT "email_handoff_evidence_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_handoff_evidence" ADD CONSTRAINT "email_handoff_evidence_handoff_id_email_handoff_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."email_handoff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_market_policy" ADD CONSTRAINT "email_market_policy_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_revision" ADD CONSTRAINT "email_recipient_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_revision" ADD CONSTRAINT "email_recipient_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_action" ADD CONSTRAINT "email_sequence_action_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_action" ADD CONSTRAINT "email_sequence_action_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_event" ADD CONSTRAINT "email_sequence_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_event" ADD CONSTRAINT "email_sequence_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_policy" ADD CONSTRAINT "email_sequence_policy_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_policy" ADD CONSTRAINT "email_sequence_policy_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_run" ADD CONSTRAINT "email_sequence_run_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_run" ADD CONSTRAINT "email_sequence_run_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sequence_run" ADD CONSTRAINT "email_sequence_run_revision_id_campaign_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."campaign_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppression" ADD CONSTRAINT "email_suppression_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access" ADD CONSTRAINT "file_access_file_id_business_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."business_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access" ADD CONSTRAINT "file_access_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_access" ADD CONSTRAINT "file_access_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_usage" ADD CONSTRAINT "file_usage_file_id_business_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."business_file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_usage" ADD CONSTRAINT "file_usage_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_case" ADD CONSTRAINT "financial_case_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_case_event" ADD CONSTRAINT "financial_case_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_grant" ADD CONSTRAINT "gmail_grant_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_grant" ADD CONSTRAINT "gmail_grant_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_manual_message" ADD CONSTRAINT "gmail_manual_message_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_manual_message" ADD CONSTRAINT "gmail_manual_message_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth" ADD CONSTRAINT "gmail_oauth_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth" ADD CONSTRAINT "gmail_oauth_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth" ADD CONSTRAINT "gmail_oauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_grant" ADD CONSTRAINT "google_calendar_grant_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_grant" ADD CONSTRAINT "google_calendar_grant_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_oauth" ADD CONSTRAINT "google_calendar_oauth_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_oauth" ADD CONSTRAINT "google_calendar_oauth_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_oauth" ADD CONSTRAINT "google_calendar_oauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_association" ADD CONSTRAINT "inbox_association_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_association" ADD CONSTRAINT "inbox_association_review_owner_id_user_id_fk" FOREIGN KEY ("review_owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_association_history" ADD CONSTRAINT "inbox_association_history_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_association_history" ADD CONSTRAINT "inbox_association_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_buyer" ADD CONSTRAINT "inbox_buyer_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_connection" ADD CONSTRAINT "inbox_connection_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_connection" ADD CONSTRAINT "inbox_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_conversation" ADD CONSTRAINT "inbox_conversation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_event" ADD CONSTRAINT "inbox_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message" ADD CONSTRAINT "inbox_message_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_message_link" ADD CONSTRAINT "inbox_message_link_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_opportunity" ADD CONSTRAINT "inbox_opportunity_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_opportunity" ADD CONSTRAINT "inbox_opportunity_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_opportunity_history" ADD CONSTRAINT "inbox_opportunity_history_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_opportunity_history" ADD CONSTRAINT "inbox_opportunity_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_recovery" ADD CONSTRAINT "infrastructure_recovery_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_recovery" ADD CONSTRAINT "infrastructure_recovery_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_recovery_event" ADD CONSTRAINT "infrastructure_recovery_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_run" ADD CONSTRAINT "inquiry_run_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_run" ADD CONSTRAINT "inquiry_run_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_issuer_decision" ADD CONSTRAINT "seller_issuer_decision_revision_id_seller_issuer_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."seller_issuer_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_issuer_decision" ADD CONSTRAINT "seller_issuer_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_issuer_revision" ADD CONSTRAINT "seller_issuer_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision" ADD CONSTRAINT "knowledge_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_revision" ADD CONSTRAINT "knowledge_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_app_message" ADD CONSTRAINT "mailbox_app_message_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_app_message" ADD CONSTRAINT "mailbox_app_message_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_job" ADD CONSTRAINT "mailbox_job_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_job" ADD CONSTRAINT "mailbox_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_policy" ADD CONSTRAINT "mailbox_policy_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_policy" ADD CONSTRAINT "mailbox_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_calendar_grant" ADD CONSTRAINT "microsoft_calendar_grant_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_calendar_grant" ADD CONSTRAINT "microsoft_calendar_grant_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_calendar_oauth" ADD CONSTRAINT "microsoft_calendar_oauth_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_calendar_oauth" ADD CONSTRAINT "microsoft_calendar_oauth_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_calendar_oauth" ADD CONSTRAINT "microsoft_calendar_oauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_mail_grant" ADD CONSTRAINT "microsoft_mail_grant_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_mail_grant" ADD CONSTRAINT "microsoft_mail_grant_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_mail_oauth" ADD CONSTRAINT "microsoft_mail_oauth_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_mail_oauth" ADD CONSTRAINT "microsoft_mail_oauth_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsoft_mail_oauth" ADD CONSTRAINT "microsoft_mail_oauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_notice_id_notification_notice_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notification_notice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_notice" ADD CONSTRAINT "notification_notice_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_payload" ADD CONSTRAINT "notification_payload_notice_id_notification_notice_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notification_notice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_terms" ADD CONSTRAINT "notification_terms_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_detail" ADD CONSTRAINT "operation_detail_event_id_operation_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."operation_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_detail" ADD CONSTRAINT "operation_detail_policy_id_operation_retention_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."operation_retention"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_event" ADD CONSTRAINT "operation_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_event" ADD CONSTRAINT "operation_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_retention" ADD CONSTRAINT "operation_retention_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_control_history" ADD CONSTRAINT "opportunity_control_history_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_control_history" ADD CONSTRAINT "opportunity_control_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_due_action" ADD CONSTRAINT "opportunity_due_action_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_due_action" ADD CONSTRAINT "opportunity_due_action_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_manual_event" ADD CONSTRAINT "opportunity_manual_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_manual_event" ADD CONSTRAINT "opportunity_manual_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_effect" ADD CONSTRAINT "pilot_effect_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_effect" ADD CONSTRAINT "pilot_effect_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_event" ADD CONSTRAINT "pilot_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_event" ADD CONSTRAINT "pilot_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_record" ADD CONSTRAINT "pilot_record_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_record" ADD CONSTRAINT "pilot_record_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operator" ADD CONSTRAINT "platform_operator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_change" ADD CONSTRAINT "reach_change_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_change" ADD CONSTRAINT "reach_change_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reach_change_event" ADD CONSTRAINT "reach_change_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_access" ADD CONSTRAINT "reconciliation_access_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_access" ADD CONSTRAINT "reconciliation_access_evidence_id_reconciliation_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."reconciliation_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_evidence" ADD CONSTRAINT "reconciliation_evidence_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_record" ADD CONSTRAINT "reconciliation_record_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_record" ADD CONSTRAINT "reconciliation_record_evidence_id_reconciliation_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."reconciliation_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_record" ADD CONSTRAINT "reconciliation_record_predecessor" FOREIGN KEY ("supersedes") REFERENCES "public"."reconciliation_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_review" ADD CONSTRAINT "reconciliation_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_review" ADD CONSTRAINT "reconciliation_review_record_id_reconciliation_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."reconciliation_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_request" ADD CONSTRAINT "rfq_request_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_request" ADD CONSTRAINT "rfq_request_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_revision" ADD CONSTRAINT "rfq_revision_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_revision" ADD CONSTRAINT "rfq_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document" ADD CONSTRAINT "seller_document_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document" ADD CONSTRAINT "seller_document_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_access" ADD CONSTRAINT "seller_document_access_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_request" ADD CONSTRAINT "seller_document_request_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_document_storage" ADD CONSTRAINT "seller_document_storage_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_connection" ADD CONSTRAINT "sender_connection_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_connection" ADD CONSTRAINT "sender_connection_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_health_record" ADD CONSTRAINT "sender_health_record_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_health_record" ADD CONSTRAINT "sender_health_record_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD CONSTRAINT "sender_identity_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_identity" ADD CONSTRAINT "sender_identity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_observation" ADD CONSTRAINT "sender_observation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_observation" ADD CONSTRAINT "sender_observation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_reply_route" ADD CONSTRAINT "sender_reply_route_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_reply_route" ADD CONSTRAINT "sender_reply_route_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_lifecycle_event" ADD CONSTRAINT "subscription_lifecycle_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_quote_id_subscription_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."subscription_quote"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment" ADD CONSTRAINT "subscription_payment_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment_history" ADD CONSTRAINT "subscription_payment_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_pricing_revision" ADD CONSTRAINT "subscription_pricing_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quote" ADD CONSTRAINT "subscription_quote_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quote" ADD CONSTRAINT "subscription_quote_pricing_id_subscription_pricing_revision_id_fk" FOREIGN KEY ("pricing_id") REFERENCES "public"."subscription_pricing_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quote" ADD CONSTRAINT "subscription_quote_profile_id_billing_profile_revision_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."billing_profile_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quote" ADD CONSTRAINT "subscription_quote_review_id_billing_profile_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."billing_profile_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_quote" ADD CONSTRAINT "subscription_quote_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_calculation" ADD CONSTRAINT "tax_calculation_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_calculation" ADD CONSTRAINT "tax_calculation_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_access" ADD CONSTRAINT "tax_filing_access_evidence_id_tax_filing_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tax_filing_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_access" ADD CONSTRAINT "tax_filing_access_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_bytes" ADD CONSTRAINT "tax_filing_bytes_id_tax_filing_evidence_id_fk" FOREIGN KEY ("id") REFERENCES "public"."tax_filing_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_event" ADD CONSTRAINT "tax_filing_event_intent_id_tax_filing_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."tax_filing_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_event" ADD CONSTRAINT "tax_filing_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_evidence" ADD CONSTRAINT "tax_filing_evidence_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_evidence" ADD CONSTRAINT "tax_filing_evidence_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_export" ADD CONSTRAINT "tax_filing_export_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_export" ADD CONSTRAINT "tax_filing_export_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_intent_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_intent_policy_id_tax_filing_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tax_filing_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_intent_policy_decision_id_tax_filing_policy_decision_id_fk" FOREIGN KEY ("policy_decision_id") REFERENCES "public"."tax_filing_policy_decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_intent_report_approval_id_tax_report_action_id_fk" FOREIGN KEY ("report_approval_id") REFERENCES "public"."tax_report_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_intent_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_amendment_fk" FOREIGN KEY ("amendment_of") REFERENCES "public"."tax_filing_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_intent" ADD CONSTRAINT "tax_filing_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."tax_filing_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_policy" ADD CONSTRAINT "tax_filing_policy_obligation_id_tax_obligation_revision_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."tax_obligation_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_policy" ADD CONSTRAINT "tax_filing_policy_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_policy_decision" ADD CONSTRAINT "tax_filing_policy_decision_policy_id_tax_filing_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tax_filing_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_filing_policy_decision" ADD CONSTRAINT "tax_filing_policy_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_liability_report" ADD CONSTRAINT "tax_liability_report_period_id_tax_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."tax_reporting_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_liability_report" ADD CONSTRAINT "tax_liability_report_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation_decision" ADD CONSTRAINT "tax_obligation_decision_revision_id_tax_obligation_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."tax_obligation_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation_decision" ADD CONSTRAINT "tax_obligation_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation_revision" ADD CONSTRAINT "tax_obligation_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_period_reminder" ADD CONSTRAINT "tax_period_reminder_period_id_tax_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."tax_reporting_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_intent_id_tax_filing_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."tax_filing_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_confirmation_id_tax_filing_event_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."tax_filing_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_evidence_id_tax_filing_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tax_filing_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_allocation" ADD CONSTRAINT "tax_remittance_allocation_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_allocation_id_tax_remittance_allocation_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."tax_remittance_allocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_policy_id_tax_filing_policy_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."tax_filing_policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_policy_decision_id_tax_filing_policy_decision_id_fk" FOREIGN KEY ("policy_decision_id") REFERENCES "public"."tax_filing_policy_decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_remittance_review" ADD CONSTRAINT "tax_remittance_review_report_approval_id_tax_report_action_id_fk" FOREIGN KEY ("report_approval_id") REFERENCES "public"."tax_report_action"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_report_action" ADD CONSTRAINT "tax_report_action_report_id_tax_liability_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."tax_liability_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_report_action" ADD CONSTRAINT "tax_report_action_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reporting_period" ADD CONSTRAINT "tax_reporting_period_obligation_id_tax_obligation_revision_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."tax_obligation_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reporting_period" ADD CONSTRAINT "tax_reporting_period_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_reporting_period" ADD CONSTRAINT "tax_reporting_period_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."tax_reporting_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_decision" ADD CONSTRAINT "tax_rule_decision_revision_id_tax_rule_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."tax_rule_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_decision" ADD CONSTRAINT "tax_rule_decision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_revision" ADD CONSTRAINT "tax_rule_revision_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_audit" ADD CONSTRAINT "team_audit_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_audit" ADD CONSTRAINT "team_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connection" ADD CONSTRAINT "whatsapp_connection_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connection" ADD CONSTRAINT "whatsapp_connection_terms_actor_id_user_id_fk" FOREIGN KEY ("terms_actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_event" ADD CONSTRAINT "whatsapp_event_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_event" ADD CONSTRAINT "whatsapp_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_evidence" ADD CONSTRAINT "whatsapp_evidence_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_evidence" ADD CONSTRAINT "whatsapp_evidence_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_intake" ADD CONSTRAINT "whatsapp_intake_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_intake" ADD CONSTRAINT "whatsapp_intake_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_oauth" ADD CONSTRAINT "whatsapp_oauth_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_oauth" ADD CONSTRAINT "whatsapp_oauth_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_oauth" ADD CONSTRAINT "whatsapp_oauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound" ADD CONSTRAINT "whatsapp_outbound_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound" ADD CONSTRAINT "whatsapp_outbound_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_receipt" ADD CONSTRAINT "whatsapp_receipt_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_activation_version" ON "ai_activation" USING btree ("version");--> statement-breakpoint
CREATE INDEX "ai_attempt_execution" ON "ai_attempt" USING btree ("business_id","execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_attempt_number" ON "ai_attempt" USING btree ("execution_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_request" ON "ai_execution" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_scope" ON "ai_execution" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_profile_version" ON "ai_profile" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_execution" ON "ai_review" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_request" ON "appointment" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_provider_event" ON "appointment" USING btree ("business_id",("intent"->>'connectionId'),("intent"->>'calendarId'),("event"->>'eventId'));--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_scope" ON "appointment" USING btree ("id","business_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_evidence_request" ON "appointment_history" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_history_sequence" ON "appointment_history" USING btree ("appointment_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_review_business_version" ON "billing_profile_review" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_profile_business_version" ON "billing_profile_revision" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_policy_version" ON "booking_policy" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_policy_scope" ON "booking_policy" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_export_key" ON "business_data_export" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_export_scope" ON "business_data_export" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_request_key" ON "business_data_request" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_request_scope" ON "business_data_request" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_step_target" ON "business_data_step" USING btree ("request_id","kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_data_step_scope" ON "business_data_step" USING btree ("id","business_id");--> statement-breakpoint
CREATE INDEX "business_file_scope_idx" ON "business_file" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "business_file_cleanup_idx" ON "business_file" USING btree ("account_scope","cleanup_after");--> statement-breakpoint
CREATE UNIQUE INDEX "call_activity_scope" ON "call_activity" USING btree ("id","business_id","opportunity_id","buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_revision_version" ON "call_revision" USING btree ("call_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "call_revision_command" ON "call_revision" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_decision_revision" ON "campaign_decision" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_revision_version" ON "campaign_revision" USING btree ("business_id","campaign_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_revision_request" ON "campaign_revision" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_authority_business_version" ON "commercial_authority_revision" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_decision_once" ON "commercial_decision" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_execution_once" ON "commercial_execution" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_outcome_identity" ON "commercial_outcome" USING btree ("business_id","source","kind","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_outcome_once" ON "commercial_outcome" USING btree ("action_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_proposal_scope" ON "commercial_proposal" USING btree ("id","business_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_proposal_version" ON "commercial_proposal" USING btree ("series_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_proposal_request" ON "commercial_proposal" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_proposal_sequence" ON "commercial_proposal" USING btree ("business_id","opportunity_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_cost_threshold_once" ON "operator_cost_alert" USING btree ("month","category","threshold","measure");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_cost_budget_version" ON "operator_cost_budget" USING btree ("month","category","version");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_cost_planning_version" ON "operator_cost_planning" USING btree ("month","version");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_cost_source_version" ON "operator_cost_record" USING btree ("source_id","version");--> statement-breakpoint
CREATE INDEX "discovery_command_run_idx" ON "discovery_command" USING btree ("business_id","run_id");--> statement-breakpoint
CREATE INDEX "discovery_observation_history" ON "discovery_observation" USING btree ("business_id","prospect_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_observation_business_scope" ON "discovery_observation" USING btree ("id","business_id");--> statement-breakpoint
CREATE INDEX "discovery_prospect_source" ON "discovery_prospect" USING btree ("business_id","canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_request_key" ON "discovery_run" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_schedule_occurrence" ON "discovery_run" USING btree ("business_id","schedule_id","schedule_revision","scheduled_for");--> statement-breakpoint
CREATE INDEX "discovery_run_business_idx" ON "discovery_run" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_usage_step_attempt" ON "discovery_usage" USING btree ("run_id","step_key","execution_id");--> statement-breakpoint
CREATE INDEX "discovery_usage_run_idx" ON "discovery_usage" USING btree ("business_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_check_order" ON "discovery_usage" USING btree ("business_id","check_order");--> statement-breakpoint
CREATE UNIQUE INDEX "email_eligibility_business_sequence" ON "email_eligibility_evaluation" USING btree ("business_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "email_handoff_recipient" ON "email_handoff" USING btree ("revision_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_handoff_evidence_once" ON "email_handoff_evidence" USING btree ("handoff_id","kind","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_handoff_native_once" ON "email_handoff_evidence" USING btree ("business_id","source_key") WHERE "email_handoff_evidence"."source" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_market_policy_version" ON "email_market_policy" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipient_version" ON "email_recipient_revision" USING btree ("business_id","recipient","version");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_action_step" ON "email_sequence_action" USING btree ("run_id","contact_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_action_scope" ON "email_sequence_action" USING btree ("id","business_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_reservation_once" ON "email_sequence_event" USING btree ("attempt_id") WHERE "email_sequence_event"."kind"='attempt_reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_policy_version" ON "email_sequence_policy" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_run_revision" ON "email_sequence_run" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sequence_run_scope" ON "email_sequence_run" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppression_request" ON "email_suppression" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE INDEX "file_access_expiry_idx" ON "file_access" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "file_usage_business_idx" ON "file_usage" USING btree ("business_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_case_request" ON "financial_case" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_case_dispute" ON "financial_case" USING btree ("native_dispute_id",("intent"->'period'->'snapshot'->'provider'->>'account'));--> statement-breakpoint
CREATE UNIQUE INDEX "financial_case_event_once" ON "financial_case_event" USING btree ("case_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_receipt_once" ON "financial_receipt" USING btree ("account","mode","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_grant_scope" ON "gmail_grant" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_manual_message_ref" ON "gmail_manual_message" USING btree ("mailbox_id","message_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_oauth_state" ON "gmail_oauth" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_active_business" ON "google_calendar_grant" USING btree ("business_id") WHERE "google_calendar_grant"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_grant_scope" ON "google_calendar_grant" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_oauth_state" ON "google_calendar_oauth" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_association_scope" ON "inbox_association" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_buyer_identity" ON "inbox_buyer" USING btree ("connection_id","sender_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_buyer_business_scope" ON "inbox_buyer" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_buyer_scope" ON "inbox_buyer" USING btree ("id","business_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_connection_scope" ON "inbox_connection" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversation_identity" ON "inbox_conversation" USING btree ("connection_id","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversation_business_scope" ON "inbox_conversation" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_conversation_scope" ON "inbox_conversation" USING btree ("id","business_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_event_identity" ON "inbox_event" USING btree ("connection_id","event_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_message_identity" ON "inbox_message" USING btree ("connection_id","message_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_message_mailbox_scope" ON "inbox_message" USING btree ("id","business_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_message_scope" ON "inbox_message" USING btree ("id","business_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_initial_opportunity" ON "inbox_opportunity" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_opportunity_business_scope" ON "inbox_opportunity" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_opportunity_buyer_identity" ON "inbox_opportunity" USING btree ("id","business_id","buyer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_plan_once" ON "infrastructure_recovery" USING btree (("plan"->>'id'));--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_run_scope" ON "inquiry_run" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_run_request" ON "inquiry_run" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE INDEX "invitation_business_idx" ON "invitation" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_pending_invitation" ON "invitation" USING btree ("business_id","email") WHERE "invitation"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "seller_issuer_decision_version" ON "seller_issuer_decision" USING btree ("revision_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_issuer_version" ON "seller_issuer_revision" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_business_version" ON "knowledge_revision" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_app_message_ref" ON "mailbox_app_message" USING btree ("mailbox_id","message_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_app_message_internet_ref" ON "mailbox_app_message" USING btree ("mailbox_id","internet_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_job_scope" ON "mailbox_job" USING btree ("id","business_id","mailbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_policy_scope" ON "mailbox_policy" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_policy_connection" ON "mailbox_policy" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_owner_per_business" ON "membership" USING btree ("business_id") WHERE "membership"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_calendar_active_business" ON "microsoft_calendar_grant" USING btree ("business_id") WHERE "microsoft_calendar_grant"."status" <> 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_calendar_grant_scope" ON "microsoft_calendar_grant" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_calendar_oauth_state" ON "microsoft_calendar_oauth" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_mail_grant_scope" ON "microsoft_mail_grant" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "microsoft_mail_oauth_state" ON "microsoft_mail_oauth" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_source_identity" ON "notification_notice" USING btree ("account","purpose","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_provider_identity" ON "notification_notice" USING btree ("account","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_receipt_identity" ON "notification_receipt" USING btree ("account","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_detail_once" ON "operation_detail" USING btree ("event_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_request_once" ON "operation_event" USING btree ("business_id","request_key","outcome");--> statement-breakpoint
CREATE INDEX "operation_source_history" ON "operation_event" USING btree ("business_id","source","target_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "operation_retention_version" ON "operation_retention" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_due_action_scope" ON "opportunity_due_action" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_plan_action" ON "opportunity_due_action" USING btree ("whatsapp_plan_id","whatsapp_peer","whatsapp_step");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_manual_event_identity" ON "opportunity_manual_event" USING btree ("connection_id","event_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_manual_message_identity" ON "opportunity_manual_event" USING btree ("connection_id","message_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_effect_once" ON "pilot_effect" USING btree ("business_id","kind","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_event_request_once" ON "pilot_event" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_request_once" ON "pilot_record" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reach_change_request" ON "reach_change" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reach_change_event_identity" ON "reach_change_event" USING btree ("change_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "reach_change_request_identity" ON "reach_change_event" USING btree ("business_id","key") WHERE "reach_change_event"."key" like 'request:%';--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_access_token" ON "reconciliation_access" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_evidence_request" ON "reconciliation_evidence" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_record_request" ON "reconciliation_record" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_record_correction" ON "reconciliation_record" USING btree ("supersedes");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_review_request" ON "reconciliation_review" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_request_need" ON "rfq_request" USING btree ("business_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_request_scope" ON "rfq_request" USING btree ("id","business_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_revision_version" ON "rfq_revision" USING btree ("request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_revision_command" ON "rfq_revision" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_number" ON "seller_document" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_series_ordinal" ON "seller_document" USING btree ("series_key","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_invoice_once" ON "seller_document" USING btree ("period_id") WHERE "seller_document"."kind"='invoice';--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_adjustment_once" ON "seller_document" USING btree ("business_id","adjustment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_adjustment_source_once" ON "seller_document" USING btree ("original_id","adjustment_source");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_access_hash" ON "seller_document_access" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_document_request_once" ON "seller_document_request" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_connection_scope" ON "sender_connection" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_health_record_scope" ON "sender_health_record" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_health_record_event" ON "sender_health_record" USING btree ("business_id","identity_id","kind","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_identity_scope" ON "sender_identity" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_identity_reply_selection" ON "sender_identity" USING btree ("reply_route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_reply_route_scope" ON "sender_reply_route" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_reply_route_inbox" ON "sender_reply_route" USING btree ("inbox_connection_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_lifecycle_event_identity" ON "subscription_lifecycle_event" USING btree ("action_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_request" ON "subscription_payment" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_operation" ON "subscription_payment" USING btree ("operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_event_identity" ON "subscription_payment_event" USING btree ("provider","account","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_period_window_once" ON "subscription_period" USING btree ("action_id","start","end");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_period_payment_once" ON "subscription_period" USING btree ("provider","account","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_pricing_version" ON "subscription_pricing_revision" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_quote_request_once" ON "subscription_quote" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_usage_operation" ON "subscription_usage" USING btree ("business_id","kind","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_calculation_business_version" ON "tax_calculation" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_calculation_request" ON "tax_calculation" USING btree ("business_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_calculation_resolution" ON "tax_calculation" USING btree ("resolves_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_calculation_business_id" ON "tax_calculation" USING btree ("business_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_access_hash" ON "tax_filing_access" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_event_request" ON "tax_filing_event" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_event_version" ON "tax_filing_event" USING btree ("intent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_confirmation_reference" ON "tax_filing_event" USING btree ("confirmation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_attempt_once" ON "tax_filing_event" USING btree ("intent_id") WHERE "tax_filing_event"."kind"='attempt';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_confirm_once" ON "tax_filing_event" USING btree ("intent_id") WHERE "tax_filing_event"."kind"='confirm';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_evidence_request" ON "tax_filing_evidence" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_export_request" ON "tax_filing_export" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_intent_request" ON "tax_filing_intent" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_amendment_child" ON "tax_filing_intent" USING btree ("amendment_of");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_supersedes_child" ON "tax_filing_intent" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_policy_request" ON "tax_filing_policy" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_policy_version" ON "tax_filing_policy" USING btree ("obligation_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_policy_decision_request" ON "tax_filing_policy_decision" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_filing_policy_decision_version" ON "tax_filing_policy_decision" USING btree ("policy_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_liability_report_revision" ON "tax_liability_report" USING btree ("period_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_liability_report_request" ON "tax_liability_report" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_obligation_decision_version" ON "tax_obligation_decision" USING btree ("revision_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_obligation_decision_request" ON "tax_obligation_decision" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_obligation_key_version" ON "tax_obligation_revision" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_obligation_request" ON "tax_obligation_revision" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_period_reminder_stage" ON "tax_period_reminder" USING btree ("period_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_confirmation" ON "tax_remittance_allocation" USING btree ("confirmation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_evidence" ON "tax_remittance_allocation" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_reference" ON "tax_remittance_allocation" USING btree ("reference_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_intent" ON "tax_remittance_allocation" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_review_request" ON "tax_remittance_review" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_remittance_review_version" ON "tax_remittance_review" USING btree ("allocation_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_report_action_version" ON "tax_report_action" USING btree ("report_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_report_action_request" ON "tax_report_action" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_reporting_period_request" ON "tax_reporting_period" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_reporting_period_successor" ON "tax_reporting_period" USING btree ("supersedes_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_decision_revision_version" ON "tax_rule_decision" USING btree ("revision_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_key_version" ON "tax_rule_revision" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "team_audit_business_idx" ON "team_audit" USING btree ("business_id","at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_business" ON "whatsapp_connection" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connection_scope" ON "whatsapp_connection" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_number_exclusive" ON "whatsapp_connection" USING btree ("phone_number_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_evidence_version" ON "whatsapp_evidence" USING btree ("business_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_intake_scope" ON "whatsapp_intake" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_oauth_state" ON "whatsapp_oauth" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_outbound_scope" ON "whatsapp_outbound" USING btree ("id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_outbound_key" ON "whatsapp_outbound" USING btree ("business_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_receipt_identity" ON "whatsapp_receipt" USING btree ("connection_id","account_key","event_key");--> statement-breakpoint
CREATE POLICY "ai_activation_read" ON "ai_activation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) or (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_activation_insert" ON "ai_activation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "ai_activation_audit_read" ON "ai_activation_audit" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_activation_audit_insert" ON "ai_activation_audit" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null)) and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "ai_attempt_pilot_cost_owner_read" ON "ai_attempt" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.ai_attempt'::regclass));--> statement-breakpoint
CREATE POLICY "ai_attempt_read" ON "ai_attempt" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_attempt_insert" ON "ai_attempt" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_attempt_update" ON "ai_attempt" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_execution_pilot_cost_owner_read" ON "ai_execution" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.ai_execution'::regclass));--> statement-breakpoint
CREATE POLICY "ai_execution_read" ON "ai_execution" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_execution_insert" ON "ai_execution" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null)) and actor_id = current_setting('app.actor_id', true) and (kind = 'workflow' or (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai))));--> statement-breakpoint
CREATE POLICY "ai_execution_update" ON "ai_execution" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null)) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_profile_read" ON "ai_profile" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) or (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_profile_insert" ON "ai_profile" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "ai_profile_update" ON "ai_profile" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (public.current_business_role() is not null) WITH CHECK (public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "ai_review_read" ON "ai_review" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "ai_review_insert" ON "ai_review" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null)) and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "appointment_read" ON "appointment" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "appointment_insert" ON "appointment" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "appointment_update" ON "appointment" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "appointment_history_read" ON "appointment_history" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "appointment_history_insert" ON "appointment_history" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "billing_review_read" ON "billing_profile_review" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))));--> statement-breakpoint
CREATE POLICY "billing_review_insert" ON "billing_profile_review" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) and "billing_profile_review"."actor_id" = current_setting('app.actor_id', true)
        and "billing_profile_review"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and exists (select 1 from public.billing_profile_revision p where p.id = "billing_profile_review"."profile_id" and p.business_id = "billing_profile_review"."business_id" and p.version = "billing_profile_review"."profile_version"));--> statement-breakpoint
CREATE POLICY "billing_profile_read" ON "billing_profile_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))));--> statement-breakpoint
CREATE POLICY "billing_profile_insert" ON "billing_profile_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "billing_profile_revision"."actor_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "booking_policy_read" ON "booking_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "booking_policy_insert" ON "booking_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'))) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "business_owner_read" ON "business" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.business'::regclass));--> statement-breakpoint
CREATE POLICY "business_access" ON "business" AS PERMISSIVE FOR ALL TO "app_runtime" USING ("business"."id" = nullif(current_setting('app.business_id', true), '')::uuid
        and public.current_business_role() is not null) WITH CHECK ("business"."id" = nullif(current_setting('app.business_id', true), '')::uuid
        and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "business_data_event_read" ON "business_data_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_event_system" ON "business_data_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass));--> statement-breakpoint
CREATE POLICY "business_data_export_read" ON "business_data_export" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_export_insert" ON "business_data_export" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "business_data_export_system" ON "business_data_export" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass));--> statement-breakpoint
CREATE POLICY "business_data_export_update" ON "business_data_export" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')) and actor_id=current_setting('app.actor_id',true)) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_grant_read" ON "business_data_grant" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_grant_insert" ON "business_data_grant" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "business_data_grant_system" ON "business_data_grant" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass));--> statement-breakpoint
CREATE POLICY "business_data_grant_update" ON "business_data_grant" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')) and actor_id=current_setting('app.actor_id',true)) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_request_read" ON "business_data_request" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_request_insert" ON "business_data_request" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "business_data_request_system" ON "business_data_request" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass));--> statement-breakpoint
CREATE POLICY "business_data_step_read" ON "business_data_step" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "business_data_step_system" ON "business_data_step" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass));--> statement-breakpoint
CREATE POLICY "file_read" ON "business_file" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))))) and (("business_file"."purpose" = 'general' and public.current_business_role() is not null) or ("business_file"."purpose" = 'billing' and (public.current_business_role() in ('owner','admin') or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax)))))));--> statement-breakpoint
CREATE POLICY "file_insert" ON "business_file" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "business_file"."owner_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "file_update" ON "business_file" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "file_system" ON "business_file" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass));--> statement-breakpoint
CREATE POLICY "call_activity_read" ON "call_activity" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "call_activity_insert" ON "call_activity" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "call_revision_read" ON "call_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "call_revision_insert" ON "call_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "campaign_decision_read" ON "campaign_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "campaign_decision_insert" ON "campaign_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() = 'owner' and actor_id = current_setting('app.actor_id',true) and exists (select 1 from public.campaign_revision r where r.id = revision_id and r.business_id = "campaign_decision"."business_id" and r.payload_hash = "campaign_decision"."payload_hash"));--> statement-breakpoint
CREATE POLICY "campaign_revision_read" ON "campaign_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "campaign_revision_insert" ON "campaign_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "commercial_authority_read" ON "commercial_authority_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ("commercial_authority_revision"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_authority_insert" ON "commercial_authority_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "commercial_authority_revision"."actor_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "commercial_decision_read" ON "commercial_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_decision_insert" ON "commercial_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'))) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "commercial_execution_read" ON "commercial_execution" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_execution_insert" ON "commercial_execution" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "commercial_execution_update" ON "commercial_execution" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_outcome_read" ON "commercial_outcome" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_outcome_insert" ON "commercial_outcome" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "commercial_proposal_read" ON "commercial_proposal" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "commercial_proposal_insert" ON "commercial_proposal" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "operator_cost_alert_read" ON "operator_cost_alert" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month));--> statement-breakpoint
CREATE POLICY "operator_cost_alert_insert" ON "operator_cost_alert" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month)) and exists(select 1 from public.operator_cost_budget b where b.id="operator_cost_alert"."budget_id" and b.month="operator_cost_alert"."month" and b.category="operator_cost_alert"."category" and b.owner_id="operator_cost_alert"."owner_id"));--> statement-breakpoint
CREATE POLICY "operator_cost_budget_pilot_cost_owner_read" ON "operator_cost_budget" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operator_cost_budget'::regclass));--> statement-breakpoint
CREATE POLICY "operator_cost_budget_read" ON "operator_cost_budget" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month));--> statement-breakpoint
CREATE POLICY "operator_cost_budget_insert" ON "operator_cost_budget" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "operator_cost_notification_event_read" ON "operator_cost_notification_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (exists(select 1 from public.operator_cost_alert a where a.id="operator_cost_notification_event"."alert_id"));--> statement-breakpoint
CREATE POLICY "operator_cost_notification_event_insert" ON "operator_cost_notification_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) and actor_id=current_setting('app.actor_id',true) and kind='acknowledged' and exists(select 1 from public.operator_cost_alert a where a.id="operator_cost_notification_event"."alert_id"));--> statement-breakpoint
CREATE POLICY "operator_cost_planning_read" ON "operator_cost_planning" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month));--> statement-breakpoint
CREATE POLICY "operator_cost_planning_insert" ON "operator_cost_planning" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "operator_cost_record_pilot_cost_owner_read" ON "operator_cost_record" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operator_cost_record'::regclass));--> statement-breakpoint
CREATE POLICY "operator_cost_record_read" ON "operator_cost_record" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month));--> statement-breakpoint
CREATE POLICY "operator_cost_record_insert" ON "operator_cost_record" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or (origin='native' and public.cost_worker_authorized(month))) and actor_id=current_setting('app.actor_id',true) and public.cost_attribution_valid(source->>'businessId',source->>'runId'));--> statement-breakpoint
CREATE POLICY "operator_cost_scan_read" ON "operator_cost_scan" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month));--> statement-breakpoint
CREATE POLICY "operator_cost_scan_insert" ON "operator_cost_scan" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)) or public.cost_worker_authorized(month)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "discovery_capacity_binding_owner_read" ON "discovery_capacity_binding" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_capacity_binding'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_capacity_binding_read" ON "discovery_capacity_binding" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_capacity_binding_insert" ON "discovery_capacity_binding" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "discovery_capacity_policy_owner_read" ON "discovery_capacity_policy" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_capacity_policy'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_capacity_policy_read" ON "discovery_capacity_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (coalesce(current_setting('app.business_id',true),'')='' and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.discovery));--> statement-breakpoint
CREATE POLICY "discovery_capacity_policy_insert" ON "discovery_capacity_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (coalesce(current_setting('app.business_id',true),'')='' and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.discovery));--> statement-breakpoint
CREATE POLICY "discovery_command_read" ON "discovery_command" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_command_insert" ON "discovery_command" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = "discovery_command"."business_id"));--> statement-breakpoint
CREATE POLICY "discovery_configuration_read" ON "discovery_configuration" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_dispatch_read" ON "discovery_dispatch" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_dispatch_insert" ON "discovery_dispatch" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and payload->'work'->>'businessId' = business_id::text and payload->'work'->>'userId' = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "discovery_dispatch_system" ON "discovery_dispatch" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_observation_read" ON "discovery_observation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_observation_insert" ON "discovery_observation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = "discovery_observation"."business_id") and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = "discovery_observation"."business_id") and exists (select 1 from public.discovery_usage u where u.id = "discovery_observation"."id" and u.run_id = "discovery_observation"."run_id" and u.business_id = "discovery_observation"."business_id" and u.kind = 'review' and u.outcome = 'reserved'));--> statement-breakpoint
CREATE POLICY "discovery_prospect_read" ON "discovery_prospect" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_prospect_insert" ON "discovery_prospect" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "discovery_alias_read" ON "discovery_prospect_alias" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_alias_insert" ON "discovery_prospect_alias" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = "discovery_prospect_alias"."business_id"));--> statement-breakpoint
CREATE POLICY "discovery_result_read" ON "discovery_result" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_result_insert" ON "discovery_result" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = "discovery_result"."business_id") and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = "discovery_result"."business_id"));--> statement-breakpoint
CREATE POLICY "discovery_run_pilot_cost_owner_read" ON "discovery_run" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_run'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_run_read" ON "discovery_run" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_run_insert" ON "discovery_run" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "discovery_run_update" ON "discovery_run" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "discovery_run_system" ON "discovery_run" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_schedule_read" ON "discovery_schedule" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_schedule_write" ON "discovery_schedule" AS PERMISSIVE FOR ALL TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "discovery_schedule_system" ON "discovery_schedule" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_usage_pilot_cost_owner_read" ON "discovery_usage" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_usage'::regclass));--> statement-breakpoint
CREATE POLICY "discovery_usage_read" ON "discovery_usage" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "discovery_usage_insert" ON "discovery_usage" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = "discovery_usage"."business_id"));--> statement-breakpoint
CREATE POLICY "discovery_usage_update" ON "discovery_usage" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "discovery_usage_system" ON "discovery_usage" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass));--> statement-breakpoint
CREATE POLICY "email_action_review_read" ON "email_action_review" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_action_review_insert" ON "email_action_review" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_eligibility_evaluation_read" ON "email_eligibility_evaluation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_eligibility_evaluation_insert" ON "email_eligibility_evaluation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_handoff_read" ON "email_handoff" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_handoff_insert" ON "email_handoff" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id',true) and exists (select 1 from public.campaign_revision r join public.campaign_decision d on d.revision_id=r.id and d.business_id=r.business_id where r.id="email_handoff"."revision_id" and r.business_id="email_handoff"."business_id" and r.payload_hash="email_handoff"."payload_hash" and d.decision='approved'));--> statement-breakpoint
CREATE POLICY "email_handoff_evidence_read" ON "email_handoff_evidence" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_handoff_evidence_insert" ON "email_handoff_evidence" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id',true) and ("email_handoff_evidence"."source" is null or public.current_business_role() in ('owner','admin')) and exists (select 1 from public.email_handoff h where h.id="email_handoff_evidence"."handoff_id" and h.business_id="email_handoff_evidence"."business_id"));--> statement-breakpoint
CREATE POLICY "email_market_policy_read" ON "email_market_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (nullif(current_setting('app.actor_id', true), '') is not null);--> statement-breakpoint
CREATE POLICY "email_market_policy_insert" ON "email_market_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.email_policy)) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_recipient_revision_read" ON "email_recipient_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_recipient_revision_insert" ON "email_recipient_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_sequence_action_pilot_cost_owner_read" ON "email_sequence_action" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.email_sequence_action'::regclass));--> statement-breakpoint
CREATE POLICY "email_sequence_action_read" ON "email_sequence_action" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_action_insert" ON "email_sequence_action" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_sequence_action_update" ON "email_sequence_action" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_action_system" ON "email_sequence_action" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_action'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_action'::regclass));--> statement-breakpoint
CREATE POLICY "email_sequence_event_pilot_cost_owner_read" ON "email_sequence_event" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.email_sequence_event'::regclass));--> statement-breakpoint
CREATE POLICY "email_sequence_event_read" ON "email_sequence_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_event_insert" ON "email_sequence_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_sequence_policy_read" ON "email_sequence_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_policy_insert" ON "email_sequence_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.email_policy)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "email_sequence_run_read" ON "email_sequence_run" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_run_insert" ON "email_sequence_run" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "email_sequence_run_update" ON "email_sequence_run" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_sequence_run_system" ON "email_sequence_run" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_run'::regclass));--> statement-breakpoint
CREATE POLICY "email_suppression_read" ON "email_suppression" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "email_suppression_insert" ON "email_suppression" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "file_access_scope" ON "file_access" AS PERMISSIVE FOR ALL TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))))) and "file_access"."actor_id" = current_setting('app.actor_id', true) and exists (select 1 from public.business_file f where f.id = "file_access"."file_id" and f.business_id = "file_access"."business_id")) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))))) and "file_access"."actor_id" = current_setting('app.actor_id', true) and exists (select 1 from public.business_file f where f.id = "file_access"."file_id" and f.business_id = "file_access"."business_id"));--> statement-breakpoint
CREATE POLICY "file_access_system" ON "file_access" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass));--> statement-breakpoint
CREATE POLICY "file_usage_pilot_cost_owner_read" ON "file_usage" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.file_usage'::regclass));--> statement-breakpoint
CREATE POLICY "file_usage_scope" ON "file_usage" AS PERMISSIVE FOR ALL TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))))) and exists (select 1 from public.business_file f where f.id = "file_usage"."file_id" and f.business_id = "file_usage"."business_id")) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))))) and exists (select 1 from public.business_file f where f.id = "file_usage"."file_id" and f.business_id = "file_usage"."business_id" and f.account_scope = "file_usage"."account_scope"));--> statement-breakpoint
CREATE POLICY "file_usage_system" ON "file_usage" AS PERMISSIVE FOR ALL TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass)) WITH CHECK (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass));--> statement-breakpoint
CREATE POLICY "financial_case_read" ON "financial_case" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)) or public.financial_worker_authorized(id,business_id));--> statement-breakpoint
CREATE POLICY "financial_case_insert" ON "financial_case" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)) and business_id=nullif(current_setting('app.business_id',true),'')::uuid and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "financial_case_system" ON "financial_case" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "financial_case_event_read" ON "financial_case_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)) or (public.financial_worker_authorized(case_id,business_id)));--> statement-breakpoint
CREATE POLICY "financial_case_event_insert" ON "financial_case_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and (((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)) and actor_id=current_setting('app.actor_id',true)) or (public.financial_worker_authorized(case_id,business_id))));--> statement-breakpoint
CREATE POLICY "financial_case_event_system" ON "financial_case_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "financial_receipt_read" ON "financial_receipt" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds));--> statement-breakpoint
CREATE POLICY "financial_receipt_system" ON "financial_receipt" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "gmail_grant_read" ON "gmail_grant" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "gmail_grant_insert" ON "gmail_grant" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "gmail_grant_update" ON "gmail_grant" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "gmail_manual_message_read" ON "gmail_manual_message" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "gmail_manual_message_insert" ON "gmail_manual_message" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "gmail_manual_message_update" ON "gmail_manual_message" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "gmail_oauth_read" ON "gmail_oauth" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "gmail_oauth_insert" ON "gmail_oauth" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "gmail_oauth_update" ON "gmail_oauth" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "google_calendar_grant_read" ON "google_calendar_grant" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "google_calendar_grant_insert" ON "google_calendar_grant" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "google_calendar_grant_update" ON "google_calendar_grant" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "google_calendar_oauth_read" ON "google_calendar_oauth" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "google_calendar_oauth_insert" ON "google_calendar_oauth" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "google_calendar_oauth_update" ON "google_calendar_oauth" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_association_read" ON "inbox_association" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_association_insert" ON "inbox_association" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_association_update" ON "inbox_association" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_association_history_read" ON "inbox_association_history" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_association_history_insert" ON "inbox_association_history" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "inbox_buyer_read" ON "inbox_buyer" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_buyer_insert" ON "inbox_buyer" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_connection_read" ON "inbox_connection" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_connection_insert" ON "inbox_connection" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "inbox_connection_update" ON "inbox_connection" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_conversation_read" ON "inbox_conversation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_conversation_insert" ON "inbox_conversation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_conversation_update" ON "inbox_conversation" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_event_read" ON "inbox_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_event_insert" ON "inbox_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_message_read" ON "inbox_message" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_message_insert" ON "inbox_message" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_message_update" ON "inbox_message" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "inbox_message_link_read" ON "inbox_message_link" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_message_link_insert" ON "inbox_message_link" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_message_link_update" ON "inbox_message_link" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_opportunity_read" ON "inbox_opportunity" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_opportunity_insert" ON "inbox_opportunity" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_opportunity_control_update" ON "inbox_opportunity" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inbox_opportunity_history_read" ON "inbox_opportunity_history" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "recovery_read" ON "infrastructure_recovery" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.recovery_operator_authorized());--> statement-breakpoint
CREATE POLICY "recovery_insert" ON "infrastructure_recovery" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.recovery_operator_authorized() and actor_id=current_setting('app.actor_id',true) and session_id=current_setting('app.recovery_session',true) and authorized_session_id=session_id and stage='requested' and lease is null and lease_until is null);--> statement-breakpoint
CREATE POLICY "recovery_owner" ON "infrastructure_recovery" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass));--> statement-breakpoint
CREATE POLICY "recovery_event_read" ON "infrastructure_recovery_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.recovery_operator_authorized());--> statement-breakpoint
CREATE POLICY "recovery_event_owner" ON "infrastructure_recovery_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass));--> statement-breakpoint
CREATE POLICY "inquiry_run_read" ON "inquiry_run" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "inquiry_run_insert" ON "inquiry_run" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "inquiry_run_update" ON "inquiry_run" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "invitation_read" ON "invitation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (token_hash = current_setting('app.invitation_hash', true)
  and email = (select lower(u.email) from public."user" u
    where u.id = current_setting('app.actor_id', true) and u.email_verified)));--> statement-breakpoint
CREATE POLICY "invitation_create" ON "invitation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin'))
    and "invitation"."created_by" = current_setting('app.actor_id', true)
    and (public.current_business_role() = 'owner' or "invitation"."role" = 'salesperson'));--> statement-breakpoint
CREATE POLICY "invitation_change" ON "invitation" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and (public.current_business_role() = 'owner' or "invitation"."role" = 'salesperson')) or (token_hash = current_setting('app.invitation_hash', true)
  and email = (select lower(u.email) from public."user" u
    where u.id = current_setting('app.actor_id', true) and u.email_verified))) WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and (public.current_business_role() = 'owner' or "invitation"."role" = 'salesperson')) or (token_hash = current_setting('app.invitation_hash', true)
  and email = (select lower(u.email) from public."user" u
    where u.id = current_setting('app.actor_id', true) and u.email_verified)));--> statement-breakpoint
CREATE POLICY "invitation_expire" ON "invitation" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "invitation"."status" = 'pending'
        and "invitation"."expires_at" <= nullif(current_setting('app.at', true), '')::timestamptz) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "invitation"."status" = 'expired'
        and "invitation"."expires_at" <= nullif(current_setting('app.at', true), '')::timestamptz);--> statement-breakpoint
CREATE POLICY "seller_issuer_decision_read" ON "seller_issuer_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)) or public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "seller_issuer_decision_insert" ON "seller_issuer_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "seller_issuer_revision_read" ON "seller_issuer_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)) or public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "seller_issuer_revision_insert" ON "seller_issuer_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "knowledge_read" ON "knowledge_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ("knowledge_revision"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "knowledge_insert" ON "knowledge_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "knowledge_revision"."actor_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "mailbox_app_message_pilot_cost_owner_read" ON "mailbox_app_message" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.mailbox_app_message'::regclass));--> statement-breakpoint
CREATE POLICY "mailbox_app_message_read" ON "mailbox_app_message" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "mailbox_app_message_insert" ON "mailbox_app_message" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "mailbox_job_pilot_cost_owner_read" ON "mailbox_job" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.mailbox_job'::regclass));--> statement-breakpoint
CREATE POLICY "mailbox_job_read" ON "mailbox_job" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "mailbox_job_insert" ON "mailbox_job" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "mailbox_job_update" ON "mailbox_job" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "mailbox_policy_pilot_cost_owner_read" ON "mailbox_policy" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.mailbox_policy'::regclass));--> statement-breakpoint
CREATE POLICY "mailbox_policy_read" ON "mailbox_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health)));--> statement-breakpoint
CREATE POLICY "mailbox_policy_insert" ON "mailbox_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "mailbox_policy_update" ON "mailbox_policy" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "membership_read" ON "membership" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ("membership"."user_id" = nullif(current_setting('app.actor_id', true), '')
        or ("membership"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
          and public.current_business_role() in ('owner', 'admin')));--> statement-breakpoint
CREATE POLICY "membership_owner_read" ON "membership" AS PERMISSIVE FOR SELECT TO public USING (current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.membership'::regclass));--> statement-breakpoint
CREATE POLICY "membership_create" ON "membership" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ("membership"."user_id" = nullif(current_setting('app.actor_id', true), '')
        and "membership"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and ("membership"."role" = 'owner' or exists (
          select 1 from public.invitation i where i.business_id = "membership"."business_id"
          and i.token_hash = current_setting('app.invitation_hash', true)
          and i.status = 'pending' and i.role = "membership"."role"
          and i.expires_at > nullif(current_setting('app.at', true), '')::timestamptz
          and public.inviter_authorized(i.created_by, i.role)
        )));--> statement-breakpoint
CREATE POLICY "membership_change" ON "membership" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ("membership"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and "membership"."role" <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and "membership"."role" = 'salesperson'))) WITH CHECK ("membership"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and "membership"."role" <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and "membership"."role" = 'salesperson')));--> statement-breakpoint
CREATE POLICY "membership_remove" ON "membership" AS PERMISSIVE FOR DELETE TO "app_runtime" USING ("membership"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and "membership"."role" <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and "membership"."role" = 'salesperson')));--> statement-breakpoint
CREATE POLICY "microsoft_calendar_grant_read" ON "microsoft_calendar_grant" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "microsoft_calendar_grant_insert" ON "microsoft_calendar_grant" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "microsoft_calendar_grant_update" ON "microsoft_calendar_grant" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "microsoft_calendar_oauth_read" ON "microsoft_calendar_oauth" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "microsoft_calendar_oauth_insert" ON "microsoft_calendar_oauth" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "microsoft_calendar_oauth_update" ON "microsoft_calendar_oauth" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "microsoft_mail_grant_read" ON "microsoft_mail_grant" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "microsoft_mail_grant_insert" ON "microsoft_mail_grant" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "microsoft_mail_grant_update" ON "microsoft_mail_grant" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "microsoft_mail_oauth_read" ON "microsoft_mail_oauth" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "microsoft_mail_oauth_insert" ON "microsoft_mail_oauth" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "microsoft_mail_oauth_update" ON "microsoft_mail_oauth" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "notification_event_read" ON "notification_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_event_insert" ON "notification_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_event_pilot_cost_owner_read" ON "notification_event" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.notification_event'::regclass));--> statement-breakpoint
CREATE POLICY "notification_notice_pilot_cost_owner_read" ON "notification_notice" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.notification_notice'::regclass));--> statement-breakpoint
CREATE POLICY "notification_notice_read" ON "notification_notice" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_notice_insert" ON "notification_notice" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_payload_read" ON "notification_payload" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_payload_insert" ON "notification_payload" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_preference_read" ON "notification_preference" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_preference_insert" ON "notification_preference" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_receipt_read" ON "notification_receipt" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_receipt_insert" ON "notification_receipt" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_setup_read" ON "notification_setup" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_setup_insert" ON "notification_setup" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "notification_terms_read" ON "notification_terms" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (false);--> statement-breakpoint
CREATE POLICY "notification_terms_insert" ON "notification_terms" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "operation_detail_read" ON "operation_detail" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations)) and expires_at>statement_timestamp());--> statement-breakpoint
CREATE POLICY "operation_detail_system" ON "operation_detail" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass));--> statement-breakpoint
CREATE POLICY "operation_event_read" ON "operation_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations)) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null));--> statement-breakpoint
CREATE POLICY "operation_event_insert" ON "operation_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations)) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null)) and actor_id=current_setting('app.actor_id',true) and action in ('retry','reconcile','escalate','acknowledge') and outcome in ('requested','queued','checked','escalated','acknowledged','blocked','unavailable'));--> statement-breakpoint
CREATE POLICY "operation_event_system" ON "operation_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass));--> statement-breakpoint
CREATE POLICY "operation_retention_read" ON "operation_retention" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations));--> statement-breakpoint
CREATE POLICY "operation_retention_insert" ON "operation_retention" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations)) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "operation_retention_system" ON "operation_retention" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass));--> statement-breakpoint
CREATE POLICY "opportunity_control_history_read" ON "opportunity_control_history" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "opportunity_control_history_insert" ON "opportunity_control_history" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "opportunity_due_action_pilot_cost_owner_read" ON "opportunity_due_action" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.opportunity_due_action'::regclass));--> statement-breakpoint
CREATE POLICY "opportunity_due_action_read" ON "opportunity_due_action" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "opportunity_due_action_insert" ON "opportunity_due_action" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "opportunity_due_action_update" ON "opportunity_due_action" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "opportunity_manual_event_read" ON "opportunity_manual_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "opportunity_manual_event_insert" ON "opportunity_manual_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "pilot_effect_read" ON "pilot_effect" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.pilot_authorized());--> statement-breakpoint
CREATE POLICY "pilot_effect_insert" ON "pilot_effect" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "pilot_event_read" ON "pilot_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.pilot_authorized());--> statement-breakpoint
CREATE POLICY "pilot_event_insert" ON "pilot_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.pilot_authorized() and actor_id=current_setting('app.actor_id',true) and (kind in ('approved','stopped') or public.pilot_operator()) and exists(select 1 from public.pilot_record p where p.id=pilot_event.pilot_id and p.business_id=pilot_event.business_id) and (kind<>'reuse' or exists(select 1 from public.membership m where m.business_id::text=pilot_event.data->>'secondBusinessId' and m.user_id=current_setting('app.actor_id',true) and m.role in ('owner','admin'))));--> statement-breakpoint
CREATE POLICY "pilot_read" ON "pilot_record" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.pilot_authorized());--> statement-breakpoint
CREATE POLICY "pilot_insert" ON "pilot_record" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.pilot_authorized() and public.pilot_operator() and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "operator_owner_read" ON "platform_operator" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.platform_operator'::regclass));--> statement-breakpoint
CREATE POLICY "operator_read" ON "platform_operator" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ("platform_operator"."user_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "reach_change_read" ON "reach_change" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.reach_worker_authorized(id,business_id))));--> statement-breakpoint
CREATE POLICY "reach_change_insert" ON "reach_change" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "reach_change_event_read" ON "reach_change_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.reach_worker_authorized(change_id,business_id)));--> statement-breakpoint
CREATE POLICY "reach_change_event_insert" ON "reach_change_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.reach_worker_authorized(change_id,business_id) or (((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))) and actor_id=current_setting('app.actor_id',true))));--> statement-breakpoint
CREATE POLICY "reconciliation_access_read" ON "reconciliation_access" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)));--> statement-breakpoint
CREATE POLICY "reconciliation_access_insert" ON "reconciliation_access" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "reconciliation_access_system" ON "reconciliation_access" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "reconciliation_evidence_read" ON "reconciliation_evidence" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)));--> statement-breakpoint
CREATE POLICY "reconciliation_evidence_insert" ON "reconciliation_evidence" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "reconciliation_evidence_system" ON "reconciliation_evidence" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "reconciliation_record_read" ON "reconciliation_record" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)));--> statement-breakpoint
CREATE POLICY "reconciliation_record_insert" ON "reconciliation_record" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "reconciliation_record_system" ON "reconciliation_record" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "reconciliation_review_read" ON "reconciliation_review" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)));--> statement-breakpoint
CREATE POLICY "reconciliation_review_insert" ON "reconciliation_review" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((coalesce(current_setting('app.business_id',true),'')='' and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "reconciliation_review_system" ON "reconciliation_review" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "rfq_request_read" ON "rfq_request" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "rfq_request_insert" ON "rfq_request" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "rfq_revision_read" ON "rfq_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "rfq_revision_insert" ON "rfq_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "seller_document_read" ON "seller_document" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or (public.seller_artifact_worker_authorized(id,business_id)) or ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)) and business_id=nullif(current_setting('app.business_id',true),'')::uuid));--> statement-breakpoint
CREATE POLICY "seller_document_insert" ON "seller_document" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) and actor_id=current_setting('app.actor_id',true) and (kind='invoice' or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents))));--> statement-breakpoint
CREATE POLICY "seller_document_update" ON "seller_document" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or (public.seller_artifact_worker_authorized(id,business_id))) WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or (public.seller_artifact_worker_authorized(id,business_id)));--> statement-breakpoint
CREATE POLICY "seller_document_system" ON "seller_document" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "seller_document_access_read" ON "seller_document_access" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "seller_document_access_insert" ON "seller_document_access" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "seller_document_request_read" ON "seller_document_request" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents))));--> statement-breakpoint
CREATE POLICY "seller_document_request_insert" ON "seller_document_request" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "seller_document_storage_read" ON "seller_document_storage" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or public.seller_artifact_worker_authorized(document_id,business_id));--> statement-breakpoint
CREATE POLICY "seller_document_storage_insert" ON "seller_document_storage" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) and actor_id=current_setting('app.actor_id',true)) or (actor_id is null and public.seller_artifact_worker_authorized(document_id,business_id)));--> statement-breakpoint
CREATE POLICY "seller_document_storage_update" ON "seller_document_storage" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or public.seller_artifact_worker_authorized(document_id,business_id)) WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)))) or public.seller_artifact_worker_authorized(document_id,business_id));--> statement-breakpoint
CREATE POLICY "sender_connection_read" ON "sender_connection" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health)));--> statement-breakpoint
CREATE POLICY "sender_connection_insert" ON "sender_connection" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "sender_connection_update" ON "sender_connection" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "sender_health_read" ON "sender_health_record" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null and ("sender_health_record"."kind"<>'alert' or "sender_health_record"."payload"->>'audience'='business')) or exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health));--> statement-breakpoint
CREATE POLICY "sender_health_insert" ON "sender_health_record" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ("sender_health_record"."business_id"=nullif(current_setting('app.business_id', true),'')::uuid and "sender_health_record"."actor_id"=current_setting('app.actor_id',true) and (exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health) or (public.current_business_role() is not null and "sender_health_record"."kind" in ('incident','failure','alert','acknowledgement'))));--> statement-breakpoint
CREATE POLICY "sender_identity_read" ON "sender_identity" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health)));--> statement-breakpoint
CREATE POLICY "sender_identity_insert" ON "sender_identity" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "sender_identity_update" ON "sender_identity" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "sender_observation_read" ON "sender_observation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "sender_observation_insert" ON "sender_observation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "sender_reply_route_read" ON "sender_reply_route" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health)));--> statement-breakpoint
CREATE POLICY "sender_reply_route_insert" ON "sender_reply_route" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and created_by = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "sender_reply_route_update" ON "sender_reply_route" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "subscription_lifecycle_event_read" ON "subscription_lifecycle_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))  or ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.current_business_role() in ('owner','admin') or (public.payment_worker_authorized("subscription_lifecycle_event"."action_id",business_id)))));--> statement-breakpoint
CREATE POLICY "subscription_lifecycle_event_insert" ON "subscription_lifecycle_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.payment_worker_authorized("subscription_lifecycle_event"."action_id",business_id)));--> statement-breakpoint
CREATE POLICY "subscription_lifecycle_event_system" ON "subscription_lifecycle_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_payment_read" ON "subscription_payment" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.payment_worker_authorized(id,business_id)));--> statement-breakpoint
CREATE POLICY "subscription_payment_insert" ON "subscription_payment" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "subscription_payment"."actor_id"=current_setting('app.actor_id',true) and exists(select 1 from public.subscription_quote q where q.id="subscription_payment"."quote_id" and q.business_id="subscription_payment"."business_id")) or public.reach_payment_insert("subscription_payment"."id","subscription_payment"."business_id","subscription_payment"."snapshot","subscription_payment"."actor_id"));--> statement-breakpoint
CREATE POLICY "subscription_payment_update" ON "subscription_payment" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or public.payment_worker_authorized(id,business_id)) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or public.payment_worker_authorized(id,business_id));--> statement-breakpoint
CREATE POLICY "subscription_payment_system" ON "subscription_payment" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_payment_event_pilot_cost_owner_read" ON "subscription_payment_event" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment_event'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_payment_event_read" ON "subscription_payment_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))  or ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.current_business_role() in ('owner','admin') or (public.payment_worker_authorized("subscription_payment_event"."action_id",business_id)))));--> statement-breakpoint
CREATE POLICY "subscription_payment_event_insert" ON "subscription_payment_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.payment_worker_authorized("subscription_payment_event"."action_id",business_id)));--> statement-breakpoint
CREATE POLICY "subscription_payment_event_system" ON "subscription_payment_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_payment_history_pilot_cost_owner_read" ON "subscription_payment_history" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment_history'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_payment_history_read" ON "subscription_payment_history" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation))  or ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.current_business_role() in ('owner','admin') or (public.payment_worker_authorized("subscription_payment_history"."action_id",business_id)))));--> statement-breakpoint
CREATE POLICY "subscription_payment_history_insert" ON "subscription_payment_history" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.payment_worker_authorized("subscription_payment_history"."action_id",business_id)));--> statement-breakpoint
CREATE POLICY "subscription_payment_history_system" ON "subscription_payment_history" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_period_pilot_cost_owner_read" ON "subscription_period" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_period'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_period_read" ON "subscription_period" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)) or exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and (o.documents or o.refunds)) or ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.current_business_role() in ('owner','admin') or (public.payment_worker_authorized("subscription_period"."action_id",business_id)))));--> statement-breakpoint
CREATE POLICY "subscription_period_insert" ON "subscription_period" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id=nullif(current_setting('app.business_id',true),'')::uuid) and (public.payment_worker_authorized("subscription_period"."action_id",business_id)));--> statement-breakpoint
CREATE POLICY "subscription_period_system" ON "subscription_period" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "subscription_pricing_read" ON "subscription_pricing_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.pricing)) or public.current_business_role() in ('owner','admin'));--> statement-breakpoint
CREATE POLICY "subscription_pricing_insert" ON "subscription_pricing_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.pricing)) and "subscription_pricing_revision"."actor_id" = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "subscription_quote_read" ON "subscription_quote" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "subscription_quote_insert" ON "subscription_quote" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) and "subscription_quote"."actor_id" = current_setting('app.actor_id', true)
    and exists (select 1 from public.billing_profile_revision p join public.billing_profile_review r on r.profile_id=p.id and r.business_id=p.business_id where p.id="subscription_quote"."profile_id" and p.business_id="subscription_quote"."business_id" and r.id="subscription_quote"."review_id" and r.outcome='reviewed')
    and "subscription_quote"."snapshot"->>'businessId'="subscription_quote"."business_id"::text and "subscription_quote"."snapshot"->>'id'="subscription_quote"."id"::text);--> statement-breakpoint
CREATE POLICY "subscription_usage_read" ON "subscription_usage" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "subscription_usage_insert" ON "subscription_usage" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "tax_calculation_read" ON "tax_calculation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))));--> statement-breakpoint
CREATE POLICY "tax_calculation_insert" ON "tax_calculation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')) or (current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax)))) and "tax_calculation"."business_id"=nullif(current_setting('app.business_id',true),'')::uuid and "tax_calculation"."actor_id"=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_access_read" ON "tax_filing_access" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_access_insert" ON "tax_filing_access" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_access_system" ON "tax_filing_access" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_bytes_system" ON "tax_filing_bytes" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_event_read" ON "tax_filing_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_event_insert" ON "tax_filing_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_event_system" ON "tax_filing_event" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_evidence_read" ON "tax_filing_evidence" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_evidence_insert" ON "tax_filing_evidence" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_evidence_system" ON "tax_filing_evidence" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_export_read" ON "tax_filing_export" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_export_insert" ON "tax_filing_export" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_export_system" ON "tax_filing_export" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_intent_read" ON "tax_filing_intent" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_intent_insert" ON "tax_filing_intent" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_intent_system" ON "tax_filing_intent" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_policy_read" ON "tax_filing_policy" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_policy_insert" ON "tax_filing_policy" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_policy_system" ON "tax_filing_policy" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_filing_policy_decision_read" ON "tax_filing_policy_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_filing_policy_decision_insert" ON "tax_filing_policy_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_filing_policy_decision_system" ON "tax_filing_policy_decision" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_liability_report_read" ON "tax_liability_report" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_liability_report_insert" ON "tax_liability_report" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_liability_report_system" ON "tax_liability_report" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_obligation_decision_read" ON "tax_obligation_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_obligation_decision_insert" ON "tax_obligation_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_obligation_decision_system" ON "tax_obligation_decision" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_obligation_revision_read" ON "tax_obligation_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_obligation_revision_insert" ON "tax_obligation_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_obligation_revision_system" ON "tax_obligation_revision" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_period_reminder_read" ON "tax_period_reminder" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_period_reminder_insert" ON "tax_period_reminder" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "tax_period_reminder_system" ON "tax_period_reminder" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_remittance_allocation_read" ON "tax_remittance_allocation" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_remittance_allocation_insert" ON "tax_remittance_allocation" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_remittance_allocation_system" ON "tax_remittance_allocation" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_remittance_review_read" ON "tax_remittance_review" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_remittance_review_insert" ON "tax_remittance_review" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_remittance_review_system" ON "tax_remittance_review" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_report_action_read" ON "tax_report_action" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_report_action_insert" ON "tax_report_action" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_report_action_system" ON "tax_report_action" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_reporting_period_read" ON "tax_reporting_period" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (public.tax_reporting_operator());--> statement-breakpoint
CREATE POLICY "tax_reporting_period_insert" ON "tax_reporting_period" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((public.tax_reporting_operator()) and actor_id=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_reporting_period_system" ON "tax_reporting_period" AS PERMISSIVE FOR ALL TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)) WITH CHECK (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass));--> statement-breakpoint
CREATE POLICY "tax_decision_read" ON "tax_rule_decision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) or (current_setting('app.tax_calculation', true) = 'true' and public.current_business_role() in ('owner','admin')));--> statement-breakpoint
CREATE POLICY "tax_decision_insert" ON "tax_rule_decision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) and "tax_rule_decision"."actor_id"=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "tax_rule_read" ON "tax_rule_revision" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) or (current_setting('app.tax_calculation', true) = 'true' and public.current_business_role() in ('owner','admin')));--> statement-breakpoint
CREATE POLICY "tax_rule_insert" ON "tax_rule_revision" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) and "tax_rule_revision"."actor_id"=current_setting('app.actor_id',true));--> statement-breakpoint
CREATE POLICY "team_audit_read" ON "team_audit" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "team_audit_create" ON "team_audit" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ("team_audit"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
      and "team_audit"."actor_id" = current_setting('app.actor_id', true) and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "whatsapp_connection_read" ON "whatsapp_connection" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) or (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.whatsapp_review))));--> statement-breakpoint
CREATE POLICY "whatsapp_connection_insert" ON "whatsapp_connection" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and terms_actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "whatsapp_connection_update" ON "whatsapp_connection" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_event_read" ON "whatsapp_event" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_event_insert" ON "whatsapp_event" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "whatsapp_evidence_read" ON "whatsapp_evidence" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) or (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.whatsapp_review))));--> statement-breakpoint
CREATE POLICY "whatsapp_evidence_insert" ON "whatsapp_evidence" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid
        and (exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.whatsapp_review)) and actor_id=current_setting('app.actor_id', true)
        and not exists (select 1 from public.membership m where m.business_id=whatsapp_evidence.business_id and m.user_id=current_setting('app.actor_id', true))
        and exists (select 1 from public.session s join public."user" u on u.id=s.user_id join public.two_factor f on f.user_id=u.id
          where s.id=whatsapp_evidence.session_id and s.user_id=current_setting('app.actor_id', true)
            and s.expires_at>whatsapp_evidence.at and u.two_factor_enabled and f.verified
            and s.mfa_verified_at<=whatsapp_evidence.at and s.mfa_verified_at>whatsapp_evidence.at-interval '15 minutes'
            and s.mfa_factor_id=f.id and s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex')));--> statement-breakpoint
CREATE POLICY "whatsapp_intake_read" ON "whatsapp_intake" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "whatsapp_intake_insert" ON "whatsapp_intake" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_intake_update" ON "whatsapp_intake" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_oauth_read" ON "whatsapp_oauth" AS PERMISSIVE FOR SELECT TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_oauth_insert" ON "whatsapp_oauth" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK (((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) and actor_id = current_setting('app.actor_id', true));--> statement-breakpoint
CREATE POLICY "whatsapp_oauth_update" ON "whatsapp_oauth" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_outbound_read" ON "whatsapp_outbound" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "whatsapp_outbound_insert" ON "whatsapp_outbound" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and "whatsapp_outbound"."actor_id"=current_setting('app.actor_id',true) and ("whatsapp_outbound"."data"->>'kind' NOT IN ('decision','permission','revoke_permission','template','cancel_plan','estimate') OR public.current_business_role() IN ('owner','admin')) and ("whatsapp_outbound"."data"->>'kind'<>'decision' OR public.current_business_role()='owner'));--> statement-breakpoint
CREATE POLICY "whatsapp_receipt_pilot_cost_owner_read" ON "whatsapp_receipt" AS PERMISSIVE FOR SELECT TO public USING (current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.whatsapp_receipt'::regclass));--> statement-breakpoint
CREATE POLICY "whatsapp_receipt_read" ON "whatsapp_receipt" AS PERMISSIVE FOR SELECT TO "app_runtime" USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null);--> statement-breakpoint
CREATE POLICY "whatsapp_receipt_insert" ON "whatsapp_receipt" AS PERMISSIVE FOR INSERT TO "app_runtime" WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));--> statement-breakpoint
CREATE POLICY "whatsapp_receipt_update" ON "whatsapp_receipt" AS PERMISSIVE FOR UPDATE TO "app_runtime" USING ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin')) WITH CHECK ((business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null) and public.current_business_role() in ('owner', 'admin'));