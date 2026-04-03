
-- Add performance columns to blog_articles
ALTER TABLE public.blog_articles ADD COLUMN IF NOT EXISTS performance_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE public.blog_articles ADD COLUMN IF NOT EXISTS total_views INT DEFAULT 0;
ALTER TABLE public.blog_articles ADD COLUMN IF NOT EXISTS is_winner BOOLEAN DEFAULT false;

-- Add performance columns to video_scripts
ALTER TABLE public.video_scripts ADD COLUMN IF NOT EXISTS performance_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE public.video_scripts ADD COLUMN IF NOT EXISTS total_views INT DEFAULT 0;
ALTER TABLE public.video_scripts ADD COLUMN IF NOT EXISTS is_winner BOOLEAN DEFAULT false;

-- RPC: Enqueue new content into distribution_queue for scheduling
CREATE OR REPLACE FUNCTION public.enqueue_growth_distribution()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enqueued INT := 0;
  v_blog RECORD;
  v_video RECORD;
BEGIN
  -- Enqueue published blog articles not yet distributed
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
      v_blog.id,
      'blog_seo',
      'pending',
      5,
      jsonb_build_object(
        'content_type', 'blog_article',
        'content_id', v_blog.id,
        'title', v_blog.title,
        'slug', v_blog.slug
      )
    );
    v_enqueued := v_enqueued + 1;
  END LOOP;

  -- Enqueue generated video scripts (multi-channel)
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
    -- TikTok
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'tiktok', 'pending', 5, now() + interval '1 hour',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    -- Instagram Reels
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'instagram_reels', 'pending', 5, now() + interval '2 hours',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    -- YouTube Shorts
    INSERT INTO distribution_queue (target_id, channel_key, status, priority, run_after, payload)
    VALUES (v_video.id, 'youtube_shorts', 'pending', 5, now() + interval '3 hours',
      jsonb_build_object('content_type', 'video_script', 'content_id', v_video.id, 'hook', v_video.hook_text, 'format', v_video.format_type));
    v_enqueued := v_enqueued + 3;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$$;

-- RPC: Score performance and mark winners
CREATE OR REPLACE FUNCTION public.score_content_performance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scored INT := 0;
  v_max_views INT;
  v_max_conv INT;
BEGIN
  SELECT GREATEST(1, MAX(views)) INTO v_max_views FROM content_performance WHERE views > 0;
  SELECT GREATEST(1, MAX(conversions)) INTO v_max_conv FROM content_performance WHERE conversions > 0;

  -- Composite score: views*30% + ctr*30% + conversions*40%
  UPDATE content_performance
  SET performance_score = LEAST(100,
    (views::numeric / v_max_views) * 30 +
    ctr * 100 * 0.3 +
    (conversions::numeric / v_max_conv) * 40
  ),
  updated_at = now()
  WHERE views > 0 OR conversions > 0;

  GET DIAGNOSTICS v_scored = ROW_COUNT;

  -- Reset winners
  UPDATE content_performance SET is_winner = false WHERE is_winner = true;

  -- Top 10% = winners
  UPDATE content_performance SET is_winner = true
  WHERE id IN (
    SELECT id FROM content_performance
    WHERE performance_score > 0
    ORDER BY performance_score DESC
    LIMIT GREATEST(1, (SELECT COUNT(*) / 10 FROM content_performance WHERE performance_score > 0))
  );

  -- Sync back to source tables
  UPDATE blog_articles ba SET
    performance_score = COALESCE(agg.score, 0),
    total_views = COALESCE(agg.v, 0),
    is_winner = COALESCE(agg.w, false)
  FROM (
    SELECT content_id, MAX(performance_score) as score, SUM(views) as v, bool_or(is_winner) as w
    FROM content_performance WHERE content_type = 'blog_article'
    GROUP BY content_id
  ) agg WHERE agg.content_id = ba.id;

  UPDATE video_scripts vs SET
    performance_score = COALESCE(agg.score, 0),
    total_views = COALESCE(agg.v, 0),
    is_winner = COALESCE(agg.w, false)
  FROM (
    SELECT content_id, MAX(performance_score) as score, SUM(views) as v, bool_or(is_winner) as w
    FROM content_performance WHERE content_type = 'video_script'
    GROUP BY content_id
  ) agg WHERE agg.content_id = vs.id;

  RETURN jsonb_build_object('scored', v_scored);
END;
$$;
