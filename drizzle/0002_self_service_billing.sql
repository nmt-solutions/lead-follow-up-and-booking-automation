ALTER POLICY "billing_review_insert" ON "billing_profile_review" TO app_runtime WITH CHECK (((current_setting('app.billing_review', true) = 'true' and (exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax))) or ((business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin'))
        and "billing_profile_review"."outcome"='reviewed' and "billing_profile_review"."findings"='[]'::jsonb
        and "billing_profile_review"."note"='Customer-declared billing details; no independent identity or tax verification.'
        and public.billing_declaration_allowed("billing_profile_review"."business_id")
        and exists (select 1 from public.billing_profile_revision p where p.id="billing_profile_review"."profile_id"
          and p.actor_id=current_setting('app.actor_id',true) and p.at="billing_profile_review"."at"
          and p.profile->'declaration'->>'version'='2026-11-10'
          and p.profile->'declaration'->>'actorId'=p.actor_id
          and (p.profile->'declaration'->>'at')::timestamptz=p.at
          and p.profile->'declaration'->>'acceptedTerms'='true'
          and p.profile->'address'->>'country'='IN'
          and p.profile->>'businessStatus' in ('business','individual')
          and p.profile->>'taxIdentifierStatus' in ('provided','not_applicable')
          and p.profile->'evidence'='[]'::jsonb and p.evidence='[]'::jsonb)))
        and "billing_profile_review"."actor_id" = current_setting('app.actor_id', true)
        and "billing_profile_review"."business_id" = nullif(current_setting('app.business_id', true), '')::uuid
        and exists (select 1 from public.billing_profile_revision p where p.id = "billing_profile_review"."profile_id" and p.business_id = "billing_profile_review"."business_id" and p.version = "billing_profile_review"."profile_version"));