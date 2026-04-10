
-- ════════════════════════════════════════════════════════════
-- PHASE 1: Upgrade seo_discovery_state
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.seo_discovery_state
  ADD COLUMN IF NOT EXISTS normalized_url text,
  ADD COLUMN IF NOT EXISTS url_hash text,
  ADD COLUMN IF NOT EXISTS discovery_hash text,
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS is_feed_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sitemap_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_indexnow_relevant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_indexnow_status text,
  ADD COLUMN IF NOT EXISTS last_discovery_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_hash_change_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_live_at timestamptz,
  ADD COLUMN IF NOT EXISTS drift_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS drift_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Migrate old columns if they exist
UPDATE public.seo_discovery_state
SET discovery_hash = last_discovery_hash
WHERE discovery_hash IS NULL AND last_discovery_hash IS NOT NULL;

UPDATE public.seo_discovery_state
SET drift_reasons = drift_issues
WHERE drift_reasons = '[]'::jsonb AND drift_issues IS NOT NULL AND drift_issues != '[]'::jsonb;

UPDATE public.seo_discovery_state
SET normalized_url = lower(trim(trailing '/' from canonical_url)),
    url_hash = md5(lower(trim(trailing '/' from canonical_url))),
    is_sitemap_relevant = COALESCE(in_sitemap, false),
    is_feed_relevant = COALESCE(in_feed, false),
    is_indexnow_relevant = COALESCE(is_indexable, false)
WHERE normalized_url IS NULL;

-- Unique constraint on normalized_url (only if values are populated)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_discovery_state_normalized_url
  ON public.seo_discovery_state (normalized_url) WHERE normalized_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_seo_discovery_state_drift
  ON public.seo_discovery_state (drift_status) WHERE drift_status != 'ok';

CREATE INDEX IF NOT EXISTS idx_seo_discovery_state_indexable
  ON public.seo_discovery_state (is_indexable, is_sitemap_relevant);

-- ════════════════════════════════════════════════════════════
-- PHASE 2: Upgrade seo_submission_logs
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.seo_submission_logs
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS canonical_url text;

-- ════════════════════════════════════════════════════════════
-- PHASE 3: Upgrade seo_keyword_clusters
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.seo_keyword_clusters
  ADD COLUMN IF NOT EXISTS funnel_stage text NOT NULL DEFAULT 'awareness',
  ADD COLUMN IF NOT EXISTS curriculum_fit numeric DEFAULT 0;

-- ════════════════════════════════════════════════════════════
-- PHASE 4: Upgrade seo_keywords
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.seo_keywords
  ADD COLUMN IF NOT EXISTS keyword_difficulty numeric,
  ADD COLUMN IF NOT EXISTS cannibalization_risk boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_status text DEFAULT 'not_created';

-- ════════════════════════════════════════════════════════════
-- PHASE 5: Database Functions
-- ════════════════════════════════════════════════════════════

-- 5a: Compute SEO discovery hash
CREATE OR REPLACE FUNCTION public.fn_compute_seo_discovery_hash(
  p_canonical_url text,
  p_title text,
  p_meta_title text,
  p_meta_description text,
  p_status text,
  p_noindex boolean,
  p_updated_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT md5(
    COALESCE(p_canonical_url, '') || '|' ||
    COALESCE(p_title, '') || '|' ||
    COALESCE(p_meta_title, '') || '|' ||
    COALESCE(p_meta_description, '') || '|' ||
    COALESCE(p_status, '') || '|' ||
    COALESCE(p_noindex::text, 'false') || '|' ||
    COALESCE(to_char(p_updated_at, 'YYYY-MM-DD HH24:MI:SS'), '')
  );
$$;

-- 5b: Classify discovery state from source
CREATE OR REPLACE FUNCTION public.fn_classify_discovery_state(
  p_source_type text,
  p_source_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row record;
  v_canonical text;
  v_is_indexable boolean := false;
  v_is_feed boolean := false;
  v_is_sitemap boolean := false;
  v_status text := 'unknown';
  v_hash text;
  v_noindex boolean := false;
  v_title text;
  v_meta_title text;
  v_meta_desc text;
BEGIN
  IF p_source_type = 'blog_post' THEN
    SELECT slug, title, meta_title, meta_description, status, noindex, canonical_url, updated_at
    INTO v_row FROM blog_posts WHERE id = p_source_id;
    IF v_row IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    v_canonical := COALESCE(v_row.canonical_url, 'https://examfit.de/blog/' || v_row.slug);
    v_status := v_row.status;
    v_noindex := COALESCE(v_row.noindex, false);
    v_title := v_row.title;
    v_meta_title := v_row.meta_title;
    v_meta_desc := v_row.meta_description;
    v_is_feed := true; -- blogs are always feed-relevant

  ELSIF p_source_type = 'content_page' THEN
    SELECT slug, title, meta_title, meta_description, status, noindex, canonical_url, page_type, updated_at
    INTO v_row FROM content_pages WHERE id = p_source_id;
    IF v_row IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    v_canonical := COALESCE(v_row.canonical_url, 'https://examfit.de/' || v_row.slug);
    v_status := v_row.status;
    v_noindex := COALESCE(v_row.noindex, false);
    v_title := v_row.title;
    v_meta_title := v_row.meta_title;
    v_meta_desc := v_row.meta_description;
    v_is_feed := v_row.page_type IN ('landing', 'ratgeber', 'news');

  ELSIF p_source_type = 'seo_document' THEN
    SELECT slug, title, meta_title, meta_description, status, canonical_url, doc_type, updated_at
    INTO v_row FROM seo_documents WHERE id = p_source_id;
    IF v_row IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
    v_canonical := COALESCE(v_row.canonical_url, 
      CASE v_row.doc_type
        WHEN 'landing' THEN 'https://examfit.de/pruefungstraining/' || v_row.slug
        WHEN 'blog' THEN 'https://examfit.de/wissen/' || v_row.slug
        WHEN 'faq' THEN 'https://examfit.de/faq/' || v_row.slug
        WHEN 'glossary' THEN 'https://examfit.de/glossar/' || v_row.slug
        ELSE 'https://examfit.de/wissen/' || v_row.slug
      END);
    v_status := v_row.status;
    v_noindex := false; -- seo_documents don't have noindex column
    v_title := v_row.title;
    v_meta_title := v_row.meta_title;
    v_meta_desc := v_row.meta_description;
    v_is_feed := v_row.doc_type IN ('blog', 'landing');

  ELSE
    RETURN jsonb_build_object('error', 'unsupported_source_type');
  END IF;

  v_is_indexable := (v_status = 'published' AND NOT v_noindex AND v_canonical IS NOT NULL);
  v_is_sitemap := v_is_indexable;

  v_hash := fn_compute_seo_discovery_hash(
    v_canonical, v_title, v_meta_title, v_meta_desc,
    v_status, v_noindex, v_row.updated_at
  );

  RETURN jsonb_build_object(
    'canonical_url', v_canonical,
    'normalized_url', lower(trim(trailing '/' from v_canonical)),
    'url_hash', md5(lower(trim(trailing '/' from v_canonical))),
    'is_indexable', v_is_indexable,
    'is_feed_relevant', v_is_feed AND v_is_indexable,
    'is_sitemap_relevant', v_is_sitemap,
    'is_indexnow_relevant', v_is_indexable,
    'content_status', v_status,
    'discovery_hash', v_hash,
    'title', v_title,
    'meta_title', v_meta_title,
    'meta_description', v_meta_desc,
    'noindex', v_noindex
  );
END;
$$;

-- 5c: Upsert discovery state with hash comparison
CREATE OR REPLACE FUNCTION public.fn_upsert_seo_discovery_state(
  p_source_type text,
  p_source_id uuid,
  p_force boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_classified jsonb;
  v_old_hash text;
  v_new_hash text;
  v_changed boolean;
BEGIN
  v_classified := fn_classify_discovery_state(p_source_type, p_source_id);
  IF v_classified ? 'error' THEN RETURN v_classified; END IF;

  v_new_hash := v_classified->>'discovery_hash';

  SELECT discovery_hash INTO v_old_hash
  FROM seo_discovery_state
  WHERE source_type = p_source_type AND source_id = p_source_id;

  v_changed := p_force OR v_old_hash IS NULL OR v_old_hash != v_new_hash;

  INSERT INTO seo_discovery_state (
    source_type, source_id, canonical_url, normalized_url, url_hash,
    discovery_hash, content_status, is_indexable,
    is_feed_relevant, is_sitemap_relevant, is_indexnow_relevant,
    in_sitemap, in_feed,
    last_discovery_event_at,
    last_hash_change_at,
    drift_status, drift_reasons,
    updated_at
  ) VALUES (
    p_source_type, p_source_id,
    v_classified->>'canonical_url',
    v_classified->>'normalized_url',
    v_classified->>'url_hash',
    v_new_hash,
    v_classified->>'content_status',
    (v_classified->>'is_indexable')::boolean,
    (v_classified->>'is_feed_relevant')::boolean,
    (v_classified->>'is_sitemap_relevant')::boolean,
    (v_classified->>'is_indexnow_relevant')::boolean,
    (v_classified->>'is_sitemap_relevant')::boolean,
    (v_classified->>'is_feed_relevant')::boolean,
    now(),
    CASE WHEN v_changed THEN now() ELSE NULL END,
    'ok', '[]'::jsonb,
    now()
  )
  ON CONFLICT (source_type, source_id) DO UPDATE SET
    canonical_url = EXCLUDED.canonical_url,
    normalized_url = EXCLUDED.normalized_url,
    url_hash = EXCLUDED.url_hash,
    discovery_hash = EXCLUDED.discovery_hash,
    content_status = EXCLUDED.content_status,
    is_indexable = EXCLUDED.is_indexable,
    is_feed_relevant = EXCLUDED.is_feed_relevant,
    is_sitemap_relevant = EXCLUDED.is_sitemap_relevant,
    is_indexnow_relevant = EXCLUDED.is_indexnow_relevant,
    in_sitemap = EXCLUDED.in_sitemap,
    in_feed = EXCLUDED.in_feed,
    last_discovery_event_at = now(),
    last_hash_change_at = CASE WHEN v_changed THEN now() ELSE seo_discovery_state.last_hash_change_at END,
    drift_status = 'ok',
    drift_reasons = '[]'::jsonb,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'hash', v_new_hash,
    'old_hash', v_old_hash,
    'canonical_url', v_classified->>'canonical_url'
  );
END;
$$;

-- 5d: Drift detector
CREATE OR REPLACE FUNCTION public.fn_detect_seo_discovery_drift()
RETURNS TABLE(
  source_type text, source_id uuid, canonical_url text,
  drift_status text, drift_reasons jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH classified AS (
    SELECT
      ds.source_type,
      ds.source_id,
      ds.canonical_url,
      ds.is_indexable,
      ds.is_sitemap_relevant,
      ds.is_feed_relevant,
      ds.is_indexnow_relevant,
      ds.in_sitemap,
      ds.in_feed,
      ds.content_status,
      ds.last_submitted_via_indexnow_at,
      ds.last_hash_change_at,
      ds.discovery_hash,
      ds.last_discovery_hash
    FROM seo_discovery_state ds
  ),
  drift_calc AS (
    SELECT
      c.source_type,
      c.source_id,
      c.canonical_url,
      jsonb_agg(reason) FILTER (WHERE reason IS NOT NULL) AS reasons
    FROM classified c
    LEFT JOIN LATERAL (
      SELECT unnest(ARRAY[
        CASE WHEN c.is_indexable AND c.is_sitemap_relevant AND NOT COALESCE(c.in_sitemap, false) THEN 'published_not_in_sitemap' END,
        CASE WHEN c.is_indexable AND c.is_feed_relevant AND NOT COALESCE(c.in_feed, false) THEN 'published_not_in_feed' END,
        CASE WHEN NOT c.is_indexable AND COALESCE(c.in_sitemap, false) THEN 'noindex_in_sitemap' END,
        CASE WHEN c.canonical_url IS NULL OR c.canonical_url = '' THEN 'missing_canonical' END,
        CASE WHEN c.content_status IN ('archived', 'deleted') AND COALESCE(c.in_sitemap, false) THEN 'archived_in_sitemap' END,
        CASE WHEN c.is_indexnow_relevant AND c.last_hash_change_at IS NOT NULL
              AND (c.last_submitted_via_indexnow_at IS NULL OR c.last_submitted_via_indexnow_at < c.last_hash_change_at)
             THEN 'hash_changed_not_submitted' END,
        CASE WHEN c.content_status NOT IN ('published', 'unknown') AND c.is_indexable THEN 'status_indexable_mismatch' END
      ]) AS reason
    ) reasons ON true
    GROUP BY c.source_type, c.source_id, c.canonical_url
  )
  SELECT
    d.source_type,
    d.source_id,
    d.canonical_url,
    CASE WHEN COALESCE(jsonb_array_length(d.reasons), 0) > 0 THEN 'drift' ELSE 'ok' END AS drift_status,
    COALESCE(d.reasons, '[]'::jsonb) AS drift_reasons
  FROM drift_calc d
  WHERE COALESCE(jsonb_array_length(d.reasons), 0) > 0;
END;
$$;

-- 5e: Dashboard summary
CREATE OR REPLACE FUNCTION public.fn_get_seo_discovery_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_tracked', count(*),
    'indexable', count(*) FILTER (WHERE is_indexable),
    'in_sitemap', count(*) FILTER (WHERE in_sitemap),
    'in_feed', count(*) FILTER (WHERE in_feed),
    'with_drift', count(*) FILTER (WHERE drift_status = 'drift'),
    'avg_health', COALESCE(avg(discovery_health_score), 0)::int,
    'by_source_type', (
      SELECT jsonb_object_agg(st, cnt) FROM (
        SELECT source_type AS st, count(*) AS cnt FROM seo_discovery_state GROUP BY source_type
      ) x
    ),
    'by_status', (
      SELECT jsonb_object_agg(cs, cnt) FROM (
        SELECT content_status AS cs, count(*) AS cnt FROM seo_discovery_state GROUP BY content_status
      ) x
    ),
    'failed_submissions_24h', (
      SELECT count(*) FROM seo_submission_logs
      WHERE status = 'failed' AND created_at > now() - interval '24 hours'
    ),
    'submissions_24h', (
      SELECT count(*) FROM seo_submission_logs
      WHERE created_at > now() - interval '24 hours'
    )
  ) INTO v_result
  FROM seo_discovery_state;

  RETURN v_result;
END;
$$;

-- 5f: Keyword opportunity score
CREATE OR REPLACE FUNCTION public.fn_compute_keyword_opportunity_score(p_keyword_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kw record;
  v_score numeric := 0;
BEGIN
  SELECT * INTO v_kw FROM seo_keywords WHERE id = p_keyword_id;
  IF v_kw IS NULL THEN RETURN 0; END IF;

  -- Volume component (0-25)
  v_score := v_score + LEAST(COALESCE(v_kw.search_volume, 0)::numeric / 400.0, 25);
  -- Conversion value (0-25)
  v_score := v_score + LEAST(COALESCE(v_kw.conversion_value, 0)::numeric / 4.0, 25);
  -- Curriculum fit (0-20)
  v_score := v_score + LEAST(COALESCE(v_kw.curriculum_fit, 0)::numeric / 5.0, 20);
  -- Content gap bonus (0-15)
  v_score := v_score + LEAST(COALESCE(v_kw.content_gap_score, 0)::numeric / 7.0, 15);
  -- Low difficulty bonus (0-15)
  v_score := v_score + CASE
    WHEN COALESCE(v_kw.keyword_difficulty, 50) < 30 THEN 15
    WHEN COALESCE(v_kw.keyword_difficulty, 50) < 50 THEN 10
    WHEN COALESCE(v_kw.keyword_difficulty, 50) < 70 THEN 5
    ELSE 0
  END;

  -- Update the keyword
  UPDATE seo_keywords SET opportunity_score = ROUND(v_score, 1) WHERE id = p_keyword_id;

  RETURN ROUND(v_score, 1);
END;
$$;

-- 5g: Content gap detection
CREATE OR REPLACE FUNCTION public.fn_detect_content_gaps(p_cluster_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_gaps jsonb := '[]'::jsonb;
  v_kw record;
BEGIN
  FOR v_kw IN
    SELECT k.id, k.keyword, k.target_page_type, k.target_url, k.persona, k.cluster_id,
           c.cluster_name
    FROM seo_keywords k
    LEFT JOIN seo_keyword_clusters c ON c.id = k.cluster_id
    WHERE (p_cluster_id IS NULL OR k.cluster_id = p_cluster_id)
      AND k.status != 'deprecated'
    ORDER BY k.opportunity_score DESC NULLS LAST
    LIMIT 200
  LOOP
    -- Check if target content exists
    IF v_kw.target_url IS NULL OR v_kw.target_url = '' THEN
      v_gaps := v_gaps || jsonb_build_object(
        'keyword_id', v_kw.id, 'keyword', v_kw.keyword,
        'gap_type', 'no_target_url',
        'cluster', v_kw.cluster_name,
        'recommended_type', COALESCE(v_kw.target_page_type, 'blog'),
        'persona', v_kw.persona
      );
    END IF;

    -- Check if no brief exists
    IF NOT EXISTS (SELECT 1 FROM seo_content_briefs WHERE keyword_id = v_kw.id) THEN
      v_gaps := v_gaps || jsonb_build_object(
        'keyword_id', v_kw.id, 'keyword', v_kw.keyword,
        'gap_type', 'no_brief',
        'cluster', v_kw.cluster_name
      );
    END IF;
  END LOOP;

  -- Check clusters without landing pages
  FOR v_kw IN
    SELECT c.id, c.cluster_name
    FROM seo_keyword_clusters c
    WHERE (p_cluster_id IS NULL OR c.id = p_cluster_id)
      AND NOT EXISTS (
        SELECT 1 FROM seo_keywords k
        WHERE k.cluster_id = c.id AND k.target_page_type = 'landing' AND k.target_url IS NOT NULL
      )
  LOOP
    v_gaps := v_gaps || jsonb_build_object(
      'cluster_id', v_kw.id, 'cluster', v_kw.cluster_name,
      'gap_type', 'cluster_no_landing_page'
    );
  END LOOP;

  RETURN v_gaps;
END;
$$;

-- 5h: Cannibalization detection
CREATE OR REPLACE FUNCTION public.fn_detect_keyword_cannibalization()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_dup record;
BEGIN
  FOR v_dup IN
    SELECT keyword, array_agg(id) AS ids, array_agg(target_url) AS urls,
           array_agg(target_page_type) AS types, count(*) AS cnt
    FROM seo_keywords
    WHERE target_url IS NOT NULL AND target_url != ''
    GROUP BY lower(keyword)
    HAVING count(DISTINCT target_url) > 1
  LOOP
    v_results := v_results || jsonb_build_object(
      'keyword', v_dup.keyword,
      'urls', to_jsonb(v_dup.urls),
      'page_types', to_jsonb(v_dup.types),
      'count', v_dup.cnt,
      'recommendation', CASE
        WHEN 'landing' = ANY(v_dup.types) AND 'blog' = ANY(v_dup.types) THEN 'redirect_blog_to_landing'
        ELSE 'merge_or_differentiate'
      END
    );
    -- Mark keywords
    UPDATE seo_keywords SET cannibalization_risk = true WHERE id = ANY(v_dup.ids);
  END LOOP;

  RETURN v_results;
END;
$$;

-- 5i: Build refresh queue
CREATE OR REPLACE FUNCTION public.fn_build_refresh_queue()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_rec record;
BEGIN
  -- Blog posts with low SEO scores
  FOR v_rec IN
    SELECT a.content_id, a.content_type, a.overall_score, a.issues
    FROM seo_content_audits a
    WHERE a.overall_score < 50
      AND NOT EXISTS (SELECT 1 FROM seo_refresh_queue q WHERE q.content_id = a.content_id AND q.status IN ('pending', 'in_progress'))
  LOOP
    INSERT INTO seo_refresh_queue (content_id, content_type, reason, priority, suggested_actions, status)
    VALUES (v_rec.content_id, v_rec.content_type, 'Low SEO score: ' || v_rec.overall_score,
            CASE WHEN v_rec.overall_score < 30 THEN 1 WHEN v_rec.overall_score < 40 THEN 3 ELSE 5 END,
            COALESCE(v_rec.issues, '[]'::jsonb), 'pending')
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  -- Discovery state with drift
  FOR v_rec IN
    SELECT ds.source_id, ds.source_type, ds.drift_reasons
    FROM seo_discovery_state ds
    WHERE ds.drift_status = 'drift'
      AND NOT EXISTS (SELECT 1 FROM seo_refresh_queue q WHERE q.content_id = ds.source_id AND q.status IN ('pending', 'in_progress'))
  LOOP
    INSERT INTO seo_refresh_queue (content_id, content_type, reason, priority, suggested_actions, status)
    VALUES (v_rec.source_id, v_rec.source_type, 'SEO drift detected',
            2, v_rec.drift_reasons, 'pending')
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 5j: Content multi-score computation
CREATE OR REPLACE FUNCTION public.fn_compute_content_scores(
  p_content_id uuid,
  p_content_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seo integer := 0;
  v_intent integer := 0;
  v_conversion integer := 0;
  v_interlink integer := 0;
  v_completeness integer := 0;
  v_issues jsonb := '[]'::jsonb;
  v_rec record;
BEGIN
  IF p_content_type = 'blog_post' THEN
    SELECT * INTO v_rec FROM blog_posts WHERE id = p_content_id;
  ELSIF p_content_type = 'content_page' THEN
    SELECT * INTO v_rec FROM content_pages WHERE id = p_content_id;
  ELSIF p_content_type = 'seo_document' THEN
    SELECT * INTO v_rec FROM seo_documents WHERE id = p_content_id;
  ELSE
    RETURN jsonb_build_object('error', 'unsupported');
  END IF;

  IF v_rec IS NULL THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  -- SEO score components
  IF v_rec.meta_title IS NOT NULL AND length(v_rec.meta_title) BETWEEN 30 AND 60 THEN v_seo := v_seo + 25;
  ELSIF v_rec.meta_title IS NOT NULL THEN v_seo := v_seo + 10;
  ELSE v_issues := v_issues || '"missing_meta_title"'::jsonb; END IF;

  IF v_rec.meta_description IS NOT NULL AND length(v_rec.meta_description) BETWEEN 120 AND 160 THEN v_seo := v_seo + 25;
  ELSIF v_rec.meta_description IS NOT NULL THEN v_seo := v_seo + 10;
  ELSE v_issues := v_issues || '"missing_meta_description"'::jsonb; END IF;

  IF v_rec.slug IS NOT NULL AND v_rec.slug != '' THEN v_seo := v_seo + 20; END IF;
  IF v_rec.canonical_url IS NOT NULL THEN v_seo := v_seo + 15; END IF;
  IF v_rec.title IS NOT NULL AND length(v_rec.title) > 10 THEN v_seo := v_seo + 15; END IF;

  -- Completeness
  v_completeness := 0;
  IF v_rec.title IS NOT NULL THEN v_completeness := v_completeness + 20; END IF;
  IF v_rec.meta_title IS NOT NULL THEN v_completeness := v_completeness + 20; END IF;
  IF v_rec.meta_description IS NOT NULL THEN v_completeness := v_completeness + 20; END IF;
  IF v_rec.slug IS NOT NULL THEN v_completeness := v_completeness + 20; END IF;
  IF v_rec.body_md IS NOT NULL AND length(v_rec.body_md) > 200 THEN v_completeness := v_completeness + 20;
  ELSIF v_rec.content_md IS NOT NULL AND length(v_rec.content_md) > 200 THEN v_completeness := v_completeness + 20;
  ELSE v_issues := v_issues || '"thin_content"'::jsonb; END IF;

  -- Interlink score
  v_interlink := CASE
    WHEN EXISTS (SELECT 1 FROM seo_internal_link_suggestions WHERE source_url LIKE '%' || v_rec.slug || '%' AND status = 'accepted') THEN 80
    WHEN EXISTS (SELECT 1 FROM seo_internal_link_suggestions WHERE source_url LIKE '%' || v_rec.slug || '%') THEN 40
    ELSE 0
  END;

  -- Simple intent / conversion defaults
  v_intent := 50;
  v_conversion := CASE WHEN p_content_type IN ('content_page', 'seo_document') THEN 60 ELSE 40 END;

  -- Upsert audit
  INSERT INTO seo_content_audits (content_id, content_type, seo_score, intent_match_score,
    conversion_score, interlink_score, completeness_score, overall_score, issues, audited_at)
  VALUES (p_content_id, p_content_type, LEAST(v_seo, 100), v_intent, v_conversion,
    v_interlink, v_completeness,
    LEAST((v_seo * 3 + v_completeness * 2 + v_interlink + v_intent + v_conversion) / 8, 100),
    v_issues, now())
  ON CONFLICT (content_id, content_type)
    WHERE content_type IS NOT NULL
  DO UPDATE SET
    seo_score = EXCLUDED.seo_score,
    intent_match_score = EXCLUDED.intent_match_score,
    conversion_score = EXCLUDED.conversion_score,
    interlink_score = EXCLUDED.interlink_score,
    completeness_score = EXCLUDED.completeness_score,
    overall_score = EXCLUDED.overall_score,
    issues = EXCLUDED.issues,
    audited_at = now();

  RETURN jsonb_build_object(
    'seo_score', LEAST(v_seo, 100),
    'intent_match_score', v_intent,
    'conversion_score', v_conversion,
    'interlink_score', v_interlink,
    'completeness_score', v_completeness,
    'overall_score', LEAST((v_seo * 3 + v_completeness * 2 + v_interlink + v_intent + v_conversion) / 8, 100),
    'issues', v_issues
  );
END;
$$;

-- Add unique constraint for content_audits upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_content_audits_unique
  ON public.seo_content_audits (content_id, content_type) WHERE content_type IS NOT NULL;
