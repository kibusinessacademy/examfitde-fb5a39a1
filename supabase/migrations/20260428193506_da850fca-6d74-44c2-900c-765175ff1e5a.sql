ALTER TABLE public.conversion_events
  DROP CONSTRAINT IF EXISTS conversion_events_event_type_v2_chk;

ALTER TABLE public.conversion_events
  ADD CONSTRAINT conversion_events_event_type_v2_chk
  CHECK (event_type = ANY (ARRAY[
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','paywall_view','cta_click',
    'checkout_started','checkout_completed','dismissed',
    'pricing_hero_view','pricing_hero_primary_click','pricing_hero_secondary_click',
    'optin_submit','doi_confirmed','b2b_form_submit','course_open','exam_attempt',
    'product_search','product_filter','product_view','product_select','shop_view',
    'lead_magnet_view','quiz_start','lead_capture','lernplan_view',
    'quiz_started','quiz_completed','lead_capture_submitted','lernplan_viewed',
    'bundle_cta_clicked',
    'page_view','add_to_cart'
  ]));