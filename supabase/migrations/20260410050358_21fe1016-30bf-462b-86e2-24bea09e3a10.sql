
-- 1. Add base_priority_score and goal_adjustment_factor to recommendations
ALTER TABLE public.business_brain_recommendations
  ADD COLUMN IF NOT EXISTS base_priority_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goal_adjustment_factor numeric NOT NULL DEFAULT 1.0;

-- Backfill existing rows
UPDATE public.business_brain_recommendations
SET base_priority_score = priority_score
WHERE base_priority_score = 0 AND priority_score > 0;

-- ========================================================
-- 2. Fix fn_build_learning_metrics_snapshot
-- mastery_state is text, mastery_score is numeric
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_learning_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'active_learners', (SELECT count(DISTINCT user_id) FROM user_progress WHERE updated_at > now() - interval '30 days'),
    'total_sessions', (SELECT count(*) FROM exam_sessions WHERE created_at > now() - interval '30 days'),
    'avg_mastery_score', (SELECT coalesce(round(avg(mastery_score)::numeric, 2), 0) FROM user_competency_mastery WHERE mastery_score IS NOT NULL),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'mastered', count(*) FILTER (WHERE mastery_state = 'mastered'),
        'partial', count(*) FILTER (WHERE mastery_state = 'partial'),
        'not_mastered', count(*) FILTER (WHERE mastery_state = 'not_mastered')
      ) FROM user_competency_mastery
    ),
    'readiness_distribution', (
      SELECT jsonb_build_object(
        'low', count(*) FILTER (WHERE readiness_score < 40),
        'medium', count(*) FILTER (WHERE readiness_score >= 40 AND readiness_score < 70),
        'high', count(*) FILTER (WHERE readiness_score >= 70)
      ) FROM user_revenue_profile
    ),
    'shuttle_sessions_30d', (SELECT count(*) FROM shuttle_sessions WHERE created_at > now() - interval '30 days'),
    'exam_simulations_30d', (SELECT count(*) FROM exam_sessions WHERE mode = 'simulation' AND created_at > now() - interval '30 days')
  ) INTO result;
  RETURN result;
END;
$$;

-- ========================================================
-- 3. Fix fn_build_seo_metrics_snapshot
-- is_indexed does NOT exist → use is_indexable
-- content_gaps renamed to keywords_without_any_done_content_job
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_seo_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_pages', (SELECT count(*) FROM content_pages),
    'published_pages', (SELECT count(*) FROM content_pages WHERE status = 'published'),
    'total_blogs', (SELECT count(*) FROM blog_posts),
    'published_blogs', (SELECT count(*) FROM blog_posts WHERE status = 'published'),
    'seo_documents', (SELECT count(*) FROM seo_documents),
    'discovery_states', (SELECT count(*) FROM seo_discovery_state),
    'indexable_urls', (SELECT count(*) FROM seo_discovery_state WHERE is_indexable = true),
    'sitemap_coverage', (SELECT count(*) FROM seo_discovery_state WHERE in_sitemap = true),
    'feed_coverage', (SELECT count(*) FROM seo_discovery_state WHERE in_feed = true),
    'drift_issues', (SELECT count(*) FROM seo_discovery_state WHERE drift_status IS NOT NULL AND drift_status != 'ok'),
    'keywords_total', (SELECT count(*) FROM seo_keywords),
    'keyword_clusters', (SELECT count(*) FROM seo_keyword_clusters),
    'keywords_without_any_done_content_job', (
      SELECT count(*) FROM seo_keywords sk
      WHERE NOT EXISTS (SELECT 1 FROM content_generation_jobs cj WHERE cj.keyword_id = sk.id AND cj.status = 'done')
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ========================================================
-- 4. Fix fn_build_growth_metrics_snapshot
-- referrals table does not exist → use affiliate_referrals as proxy
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_growth_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'shares_30d', (SELECT count(*) FROM share_events WHERE created_at > now() - interval '30 days'),
    'affiliate_referrals_total', (SELECT count(*) FROM affiliate_referrals),
    'affiliate_referrals_confirmed', (SELECT count(*) FROM affiliate_referrals WHERE status = 'confirmed'),
    'ugc_total', (SELECT count(*) FROM ugc_content),
    'ugc_approved', (SELECT count(*) FROM ugc_content WHERE approved = true),
    'viral_hooks', (SELECT count(*) FROM viral_hooks),
    'avg_virality_score', (SELECT coalesce(round(avg(virality_score)::numeric, 2), 0) FROM growth_metrics),
    'avg_share_rate', (SELECT coalesce(round(avg(share_rate)::numeric, 4), 0) FROM growth_metrics),
    'avg_referral_rate', (SELECT coalesce(round(avg(referral_rate)::numeric, 4), 0) FROM growth_metrics)
  ) INTO result;
  RETURN result;
END;
$$;

-- ========================================================
-- 5. Fix fn_build_risk_metrics_snapshot
-- Remove quality_gate_failed (not a real status)
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_risk_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'stalled_packages', (SELECT count(*) FROM course_packages WHERE status = 'building' AND updated_at < now() - interval '6 hours'),
    'failed_jobs_24h', (SELECT count(*) FROM job_queue WHERE status = 'failed' AND updated_at > now() - interval '24 hours'),
    'blocked_packages', (SELECT count(*) FROM course_packages WHERE status = 'blocked'),
    'pending_jobs', (SELECT count(*) FROM job_queue WHERE status = 'pending'),
    'stale_processing_jobs', (SELECT count(*) FROM job_queue WHERE status = 'processing' AND updated_at < now() - interval '2 hours'),
    'ai_budget_pct', (
      SELECT coalesce(round((spent_eur / NULLIF(budget_eur, 0)) * 100, 1), 0)
      FROM ai_cost_budgets ORDER BY month DESC LIMIT 1
    ),
    'content_jobs_failed', (SELECT count(*) FROM content_generation_jobs WHERE status = 'failed')
  ) INTO result;
  RETURN result;
END;
$$;

-- ========================================================
-- 6. Fix fn_build_opportunity_metrics_snapshot
-- overall_progress does NOT exist on course_packages → use package_steps
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_opportunity_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'keywords_without_any_done_content_job', (
      SELECT count(*) FROM seo_keywords sk
      WHERE NOT EXISTS (SELECT 1 FROM content_generation_jobs cj WHERE cj.keyword_id = sk.id AND cj.status = 'done')
    ),
    'high_engagement_no_offer', (
      SELECT count(*) FROM user_revenue_profile
      WHERE engagement_score > 70 AND last_offer_shown IS NULL
    ),
    'curricula_without_package', (
      SELECT count(*) FROM curricula c
      WHERE NOT EXISTS (SELECT 1 FROM course_packages cp WHERE cp.curriculum_id = c.id)
    ),
    'publishable_packages', (
      SELECT count(*) FROM course_packages cp
      WHERE cp.status = 'building'
        AND (SELECT count(*) FILTER (WHERE ps.status = 'done') * 100.0 / NULLIF(count(*), 0) FROM package_steps ps WHERE ps.package_id = cp.id) >= 90
    ),
    'high_risk_low_readiness', (
      SELECT count(*) FROM user_revenue_profile WHERE risk_level = 'high' AND readiness_score < 40
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ========================================================
-- 7. Fix fn_compute_business_priority_scores
-- Now stores base_priority_score and deduplicates
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_compute_business_priority_scores(p_snapshot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  snap record;
  risk_score numeric;
  opp_score numeric;
BEGIN
  SELECT * INTO snap FROM business_brain_snapshots WHERE id = p_snapshot_id;
  IF snap IS NULL THEN RETURN; END IF;

  -- Delete any existing recommendations for this snapshot to prevent duplication
  DELETE FROM business_brain_recommendations WHERE source_snapshot_id = p_snapshot_id AND status = 'proposed';

  -- Risk: stalled packages
  risk_score := coalesce((snap.risk_metrics->>'stalled_packages')::numeric, 0);
  IF risk_score > 3 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, base_priority_score, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('operational_fix', 85 + least(risk_score, 10), 85 + least(risk_score, 10), 80,
      risk_score || ' stalled packages require attention',
      'Multiple packages have been in building state for >6h without progress.',
      jsonb_build_object('stalled_count', risk_score),
      jsonb_build_object('action', 'review_stalled_packages', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;

  -- Risk: failed jobs
  IF coalesce((snap.risk_metrics->>'failed_jobs_24h')::numeric, 0) > 5 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, base_priority_score, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('operational_fix', 90, 90, 85,
      (snap.risk_metrics->>'failed_jobs_24h') || ' failed jobs in 24h',
      'High failure rate in job queue indicates systemic issue.',
      snap.risk_metrics,
      jsonb_build_object('action', 'investigate_job_failures', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;

  -- Opportunity: content gaps
  opp_score := coalesce((snap.opportunity_metrics->>'keywords_without_any_done_content_job')::numeric,
                        coalesce((snap.opportunity_metrics->>'keywords_without_content')::numeric, 0));
  IF opp_score > 10 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, base_priority_score, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('seo_priority', 70, 70, 75,
      opp_score || ' keywords without content',
      'Significant SEO opportunity: keywords identified but no content generated yet.',
      jsonb_build_object('gap_count', opp_score),
      jsonb_build_object('action', 'generate_content_briefs', 'auto', true),
      p_snapshot_id, 'auto_allowed');
  END IF;

  -- Opportunity: high engagement without offers
  IF coalesce((snap.opportunity_metrics->>'high_engagement_no_offer')::numeric, 0) > 5 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, base_priority_score, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('revenue_action', 75, 75, 70,
      'High-engagement users without offers',
      'Users with engagement >70 have not been shown any offer. Revenue opportunity.',
      snap.opportunity_metrics,
      jsonb_build_object('action', 'trigger_offer_engine', 'auto', true),
      p_snapshot_id, 'auto_allowed');
  END IF;

  -- Opportunity: publishable packages
  IF coalesce((snap.opportunity_metrics->>'publishable_packages')::numeric, 0) > 0 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, base_priority_score, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('product_priority', 80, 80, 90,
      (snap.opportunity_metrics->>'publishable_packages') || ' packages ready to publish',
      'Packages at 90%+ step completion could be finalized and published.',
      snap.opportunity_metrics,
      jsonb_build_object('action', 'review_for_publish', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;
END;
$$;

-- ========================================================
-- 8. Fix fn_apply_business_goals_to_recommendations
-- Non-destructive: computes goal_adjustment_factor, then final = base * factor
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_apply_business_goals_to_recommendations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  goal record;
  type_map jsonb := '{
    "revenue_growth": ["revenue_action"],
    "traffic_growth": ["seo_priority", "content_job", "growth_action"],
    "seo_visibility": ["seo_priority"],
    "course_completion": ["product_priority", "operational_fix"],
    "exam_success_rate": ["product_priority"],
    "retention": ["retention_action", "growth_action"],
    "content_output": ["content_job", "seo_priority"]
  }'::jsonb;
  rec_types jsonb;
  boost numeric;
BEGIN
  -- Step 1: Reset all proposed recommendations to base scores
  UPDATE business_brain_recommendations
  SET goal_adjustment_factor = 1.0,
      priority_score = base_priority_score
  WHERE status = 'proposed'
    AND base_priority_score > 0;

  -- Step 2: Accumulate goal-based adjustments
  FOR goal IN SELECT * FROM business_brain_goals WHERE status = 'active'
  LOOP
    rec_types := type_map->goal.goal_type;
    IF rec_types IS NULL THEN CONTINUE; END IF;

    -- Compute boost factor = goal weight * strategy multiplier
    boost := goal.weight * CASE coalesce(goal.strategy_mode, 'balanced')
      WHEN 'growth_first' THEN CASE WHEN goal.goal_type IN ('traffic_growth', 'seo_visibility', 'content_output') THEN 1.5 ELSE 0.8 END
      WHEN 'revenue_first' THEN CASE WHEN goal.goal_type = 'revenue_growth' THEN 1.5 ELSE 0.8 END
      WHEN 'quality_first' THEN CASE WHEN goal.goal_type IN ('exam_success_rate', 'course_completion') THEN 1.5 ELSE 0.8 END
      ELSE 1.0
    END;

    UPDATE business_brain_recommendations
    SET goal_adjustment_factor = goal_adjustment_factor * boost
    WHERE status = 'proposed'
      AND recommendation_type = ANY(
        SELECT jsonb_array_elements_text(rec_types)
      );
  END LOOP;

  -- Step 3: Apply final score = base * accumulated factor
  UPDATE business_brain_recommendations
  SET priority_score = round(base_priority_score * goal_adjustment_factor, 2),
      updated_at = now()
  WHERE status = 'proposed'
    AND base_priority_score > 0;
END;
$$;

-- ========================================================
-- 9. Keep product metrics clean (status = 'published' IS real)
-- ========================================================
CREATE OR REPLACE FUNCTION public.fn_build_product_metrics_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_packages', (SELECT count(*) FROM course_packages),
    'published', (SELECT count(*) FROM course_packages WHERE status = 'published'),
    'building', (SELECT count(*) FROM course_packages WHERE status = 'building'),
    'blocked', (SELECT count(*) FROM course_packages WHERE status = 'blocked'),
    'queued', (SELECT count(*) FROM course_packages WHERE status = 'queued'),
    'archived', (SELECT count(*) FROM course_packages WHERE status = 'archived'),
    'total_curricula', (SELECT count(*) FROM curricula),
    'total_courses', (SELECT count(*) FROM courses),
    'active_jobs', (SELECT count(*) FROM job_queue WHERE status IN ('pending', 'processing')),
    'avg_step_completion_pct', (
      SELECT coalesce(round(avg(done_pct)::numeric, 1), 0) FROM (
        SELECT cp.id, count(*) FILTER (WHERE ps.status = 'done') * 100.0 / NULLIF(count(*), 0) as done_pct
        FROM course_packages cp
        JOIN package_steps ps ON ps.package_id = cp.id
        WHERE cp.status = 'building'
        GROUP BY cp.id
      ) sub
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- Revenue metrics is fine (all columns verified exist)
-- Content metrics is fine (all tables exist)
