-- Welle 2 / Loop 2: post-publish growth jobs are designed to run on published packages.
-- Register them in job_type_policies so fn_guard_non_building_auto_cancel + ops_cancel_pending_non_building_jobs skip them.

INSERT INTO public.job_type_policies (job_type, can_run_when_not_building, exempt_from_auto_cancel, notes, updated_at)
VALUES
  ('seo_indexnow_submit',              true, true, 'Post-publish growth: drains URLs into seo_submission_logs for IndexNow.', now()),
  ('package_post_publish_blog',        true, true, 'Post-publish growth: generates blog_articles tied to package.', now()),
  ('package_distribution_plan',        true, true, 'Post-publish growth: writes distribution_targets for the package.', now()),
  ('package_campaign_assets_generate', true, true, 'Post-publish growth: seeds campaign_assets (social/email/meta).', now()),
  ('package_email_sequence_enroll',    true, true, 'Post-publish growth: enrolls leads into post_publish_announce sequence.', now()),
  ('package_og_image_generate',        true, true, 'Post-publish growth: generates Open Graph image (Lovable AI).', now())
ON CONFLICT (job_type) DO UPDATE SET
  can_run_when_not_building = EXCLUDED.can_run_when_not_building,
  exempt_from_auto_cancel   = EXCLUDED.exempt_from_auto_cancel,
  notes                     = EXCLUDED.notes,
  updated_at                = now();