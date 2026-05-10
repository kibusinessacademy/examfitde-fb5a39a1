
-- ROLLBACK HINT:
--   DELETE FROM ops_job_type_registry WHERE job_type IN
--     ('seo_indexnow_submit','package_post_publish_blog','package_og_image_generate',
--      'package_distribution_plan','package_campaign_assets_generate','package_email_sequence_enroll');
--   ALTER TABLE conversion_events DROP CONSTRAINT conversion_events_event_type_v2_chk;
--   (re-add old constraint without 'package_published')

-- 1) Register 6 new job types for post-publish growth fanout
INSERT INTO public.ops_job_type_registry
  (job_type, job_name, lane, pool, requires_package_id, is_governance, is_active, description)
VALUES
  ('seo_indexnow_submit',              'Seo Indexnow Submit',              'core', 'core',      true,  false, true, 'Submit package canonical URLs to IndexNow / Bing on publish'),
  ('package_post_publish_blog',        'Package Post Publish Blog',        'marketing', 'marketing', true, false, true, 'Generate at least one blog article per published package'),
  ('package_og_image_generate',        'Package Og Image Generate',        'marketing', 'marketing', true, false, true, 'Generate OG/social image for published package'),
  ('package_distribution_plan',        'Package Distribution Plan',        'marketing', 'marketing', true, false, true, 'Build distribution plan (channels, schedule) for published package'),
  ('package_campaign_assets_generate', 'Package Campaign Assets Generate', 'marketing', 'marketing', true, false, true, 'Generate ad/campaign assets bundle for published package'),
  ('package_email_sequence_enroll',    'Package Email Sequence Enroll',    'marketing', 'marketing', true, false, true, 'Enroll matching opted-in leads into post-publish email sequence')
ON CONFLICT (job_type) DO NOTHING;

-- 2) Extend conversion_events event_type whitelist with 'package_published'
ALTER TABLE public.conversion_events DROP CONSTRAINT IF EXISTS conversion_events_event_type_v2_chk;
ALTER TABLE public.conversion_events ADD CONSTRAINT conversion_events_event_type_v2_chk CHECK (
  event_type = ANY (ARRAY[
    'hero_cta_click','pricing_view','checkout_start','checkout_complete','lead_magnet_download','quiz_complete',
    'paywall_view','cta_click','checkout_started','checkout_completed','dismissed',
    'pricing_hero_view','pricing_hero_primary_click','pricing_hero_secondary_click',
    'optin_submit','doi_confirmed','b2b_form_submit','course_open','exam_attempt',
    'product_search','product_filter','product_view','product_select','shop_view',
    'lead_magnet_view','quiz_start','lead_capture','lernplan_view',
    'quiz_started','quiz_completed','lead_capture_submitted','lernplan_viewed',
    'bundle_cta_clicked','page_view','add_to_cart','quiz_cta_clicked','landing_view',
    'lead_gate_shown','lead_gate_start_diagnosis','lead_gate_skip_to_checkout',
    'quiz_result_viewed','result_cta_clicked',
    'heatmap_click','heatmap_scroll_depth','cta_visible','cta_clicked',
    -- NEW: post-publish growth fanout marker
    'package_published'
  ])
);

-- 3) Smoke
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.ops_job_type_registry
  WHERE job_type IN ('seo_indexnow_submit','package_post_publish_blog','package_og_image_generate',
                     'package_distribution_plan','package_campaign_assets_generate','package_email_sequence_enroll');
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 new job types, got %', v_count;
  END IF;
END$$;

-- 4) Audit
INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
VALUES (
  'post_publish_growth_register',
  'migration',
  'system',
  'success',
  jsonb_build_object(
    'migration', 'growth_fanout_register_job_types',
    'new_job_types', 6,
    'reused_job_types', jsonb_build_array('package_auto_generate_seo_suite','seo_sitemap_refresh','seo_internal_links'),
    'new_event_types', jsonb_build_array('package_published')
  )
);
