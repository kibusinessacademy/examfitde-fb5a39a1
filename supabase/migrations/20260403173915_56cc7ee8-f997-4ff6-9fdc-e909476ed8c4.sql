
-- ============================================================
-- P0 FIX 1: content_performance – add missing Growth columns
-- ============================================================
ALTER TABLE public.content_performance
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS content_id uuid,
  ADD COLUMN IF NOT EXISTS performance_score numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_winner boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS snapshot_date date DEFAULT CURRENT_DATE;

-- Make content_job_id nullable (Growth content has no content_job)
ALTER TABLE public.content_performance
  ALTER COLUMN content_job_id DROP NOT NULL;

-- Snapshot uniqueness: one row per content+platform+day
CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_content_platform_day
  ON public.content_performance (content_type, content_id, platform, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_cp_content_type_id
  ON public.content_performance (content_type, content_id);

CREATE INDEX IF NOT EXISTS idx_cp_winner
  ON public.content_performance (is_winner) WHERE is_winner = true;

-- ============================================================
-- P0 FIX 2: distribution_queue – make campaign FKs nullable
-- ============================================================
ALTER TABLE public.distribution_queue
  ALTER COLUMN asset_id DROP NOT NULL,
  ALTER COLUMN launch_plan_id DROP NOT NULL;

-- ============================================================
-- P0 FIX 3: score_content_performance() – fix to real schema
-- ============================================================
CREATE OR REPLACE FUNCTION public.score_content_performance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scored INT := 0;
  v_winners INT := 0;
  v_type TEXT;
  v_max_views NUMERIC;
  v_max_conv NUMERIC;
  v_threshold NUMERIC;
BEGIN
  SELECT GREATEST(1, MAX(views)) INTO v_max_views FROM content_performance WHERE views > 0;
  SELECT GREATEST(1, MAX(conversions)) INTO v_max_conv FROM content_performance WHERE conversions > 0;

  UPDATE content_performance
  SET performance_score = LEAST(100,
    (views::numeric / v_max_views) * 30 +
    LEAST(ctr * 100, 30) * 1.0 +
    (conversions::numeric / v_max_conv) * 40
  ),
  updated_at = now()
  WHERE (views > 0 OR conversions > 0)
    AND content_type IS NOT NULL
    AND content_id IS NOT NULL;

  GET DIAGNOSTICS v_scored = ROW_COUNT;

  UPDATE content_performance SET is_winner = false, updated_at = now() WHERE is_winner = true;

  FOR v_type IN SELECT DISTINCT content_type FROM content_performance WHERE content_type IS NOT NULL AND performance_score > 0 LOOP
    v_threshold := (
      SELECT performance_score FROM content_performance
      WHERE content_type = v_type AND performance_score > 0
      ORDER BY performance_score DESC
      LIMIT 1 OFFSET GREATEST(0, (SELECT COUNT(*) / 10 FROM content_performance WHERE content_type = v_type AND performance_score > 0) - 1)
    );

    UPDATE content_performance
    SET is_winner = true, updated_at = now()
    WHERE content_type = v_type
      AND performance_score >= COALESCE(v_threshold, 999999);

    GET DIAGNOSTICS v_winners = ROW_COUNT;
  END LOOP;

  UPDATE blog_articles ba SET
    performance_score = COALESCE(agg.score, 0),
    total_views = COALESCE(agg.v, 0),
    is_winner = COALESCE(agg.w, false)
  FROM (
    SELECT content_id, MAX(performance_score) as score, SUM(views) as v, bool_or(is_winner) as w
    FROM content_performance WHERE content_type = 'blog_article' AND content_id IS NOT NULL
    GROUP BY content_id
  ) agg WHERE agg.content_id = ba.id;

  UPDATE video_scripts vs SET
    performance_score = COALESCE(agg.score, 0),
    total_views = COALESCE(agg.v, 0),
    is_winner = COALESCE(agg.w, false)
  FROM (
    SELECT content_id, MAX(performance_score) as score, SUM(views) as v, bool_or(is_winner) as w
    FROM content_performance WHERE content_type = 'video_script' AND content_id IS NOT NULL
    GROUP BY content_id
  ) agg WHERE agg.content_id = vs.id;

  RETURN jsonb_build_object('scored', v_scored, 'winners_updated', v_winners);
END;
$function$;

-- ============================================================
-- P0 FIX 4: enqueue_growth_distribution() – works with nullable FKs
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_growth_distribution()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enqueued INT := 0;
  v_blog RECORD;
  v_video RECORD;
BEGIN
  FOR v_blog IN
    SELECT ba.id, ba.slug, ba.title
    FROM blog_articles ba
    WHERE ba.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM distribution_queue dq
      WHERE dq.payload->>'content_type' = 'blog_article'
      AND dq.payload->>'content_id' = ba.id::text
    )
    LIMIT 50
  LOOP
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, payload)
    VALUES (
      v_blog.id, 'blog_seo', 'pending', 5,
      jsonb_build_object('content_type', 'blog_article', 'content_id', v_blog.id, 'title', v_blog.title, 'slug', v_blog.slug)
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  FOR v_video IN
    SELECT vs.id, vs.hook_text, vs.format_type
    FROM video_scripts vs
    WHERE vs.status = 'generated'
    AND NOT EXISTS (
      SELECT 1 FROM distribution_queue dq
      WHERE dq.payload->>'content_type' = 'video_script'
      AND dq.payload->>'content_id' = vs.id::text
      AND dq.channel_key = 'tiktok'
    )
    LIMIT 50
  LOOP
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'tiktok', 'pending', 5, now() + interval '1 hour',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'instagram_reels', 'pending', 5, now() + interval '2 hours',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'youtube_shorts', 'pending', 5, now() + interval '3 hours',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    v_enqueued := v_enqueued + 3;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$function$;
