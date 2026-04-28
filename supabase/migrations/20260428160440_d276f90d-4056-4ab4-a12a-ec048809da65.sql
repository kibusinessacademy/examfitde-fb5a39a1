-- 1) Promote 47 draft_generated articles
UPDATE public.blog_articles
SET status = 'published'
WHERE status = 'draft_generated' AND published_at IS NOT NULL;

-- 2) Backfill internal link suggestions blog→blog (same topic_cluster/article_type)
INSERT INTO public.seo_internal_link_suggestions
  (source_url, source_title, target_url, target_title, anchor_text, relevance_score, link_type, priority, reason, status)
SELECT
  '/blog/' || a.slug,
  a.title,
  '/blog/' || b.slug,
  b.title,
  b.title,
  70,
  'contextual',
  5,
  'same topic_cluster/article_type backfill',
  'suggested'
FROM public.blog_articles a
JOIN public.blog_articles b
  ON a.id <> b.id
 AND COALESCE(NULLIF(a.topic_cluster,''), a.article_type)
   = COALESCE(NULLIF(b.topic_cluster,''), b.article_type)
 AND b.status = 'published'
WHERE a.status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM public.seo_internal_link_suggestions s
    WHERE s.source_url = '/blog/' || a.slug AND s.target_url = '/blog/' || b.slug
  );

-- 3) Extend conversion_events event_type CHECK with v3 funnel events
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
    'product_search','product_filter','product_view','product_select','shop_view'
  ]));

-- 4) Admin funnel view per curriculum (30d)
CREATE OR REPLACE VIEW public.v_admin_sales_funnel_per_curriculum AS
WITH steps AS (
  SELECT
    curriculum_id,
    session_id,
    event_type,
    created_at,
    LAG(created_at) OVER (PARTITION BY session_id ORDER BY created_at) AS prev_at
  FROM public.conversion_events
  WHERE event_type IN (
    'shop_view','product_search','product_filter','product_view','product_select',
    'checkout_start','checkout_started','checkout_complete','checkout_completed'
  )
    AND created_at > now() - interval '30 days'
)
SELECT
  curriculum_id,
  event_type,
  count(*) AS event_count,
  count(DISTINCT session_id) AS sessions,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000
  )::int AS median_step_latency_ms,
  max(created_at) AS last_event_at
FROM steps
GROUP BY curriculum_id, event_type;

GRANT SELECT ON public.v_admin_sales_funnel_per_curriculum TO authenticated;