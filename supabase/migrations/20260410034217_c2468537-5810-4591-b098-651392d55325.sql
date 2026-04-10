
-- =============================================================
-- AI BUSINESS BRAIN – Tables
-- =============================================================

-- 1. Snapshots
CREATE TABLE public.business_brain_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type text NOT NULL DEFAULT 'on_demand',
  generated_at timestamptz NOT NULL DEFAULT now(),
  learning_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  growth_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  opportunity_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_snapshots" ON public.business_brain_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_snapshots" ON public.business_brain_snapshots FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Recommendations
CREATE TABLE public.business_brain_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_type text NOT NULL,
  priority_score numeric NOT NULL DEFAULT 0,
  confidence_score numeric NOT NULL DEFAULT 0,
  title text NOT NULL,
  summary text NOT NULL,
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot_id uuid REFERENCES public.business_brain_snapshots(id),
  ai_summary text,
  ai_rationale text,
  ai_risk_notes text,
  ai_expected_impact text,
  status text NOT NULL DEFAULT 'proposed',
  execution_mode text NOT NULL DEFAULT 'manual_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_recs" ON public.business_brain_recommendations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_recs" ON public.business_brain_recommendations FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_bb_recs" ON public.business_brain_recommendations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Decisions
CREATE TABLE public.business_brain_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid REFERENCES public.business_brain_recommendations(id),
  decision_type text NOT NULL,
  decision_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by text NOT NULL DEFAULT 'system',
  outcome_status text NOT NULL DEFAULT 'pending',
  outcome_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_decisions" ON public.business_brain_decisions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_decisions" ON public.business_brain_decisions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_bb_decisions" ON public.business_brain_decisions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. Goals
CREATE TABLE public.business_brain_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_type text NOT NULL,
  target_value numeric NOT NULL DEFAULT 0,
  current_value numeric,
  time_horizon text NOT NULL DEFAULT 'monthly',
  weight numeric NOT NULL DEFAULT 1,
  strategy_mode text NOT NULL DEFAULT 'balanced',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_goals" ON public.business_brain_goals FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_goals" ON public.business_brain_goals FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_bb_goals" ON public.business_brain_goals FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_delete_bb_goals" ON public.business_brain_goals FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 5. Action Queue
CREATE TABLE public.business_brain_action_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_recommendation_id uuid REFERENCES public.business_brain_recommendations(id),
  status text NOT NULL DEFAULT 'queued',
  execution_mode text NOT NULL DEFAULT 'manual_review',
  executed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_action_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_actions" ON public.business_brain_action_queue FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_actions" ON public.business_brain_action_queue FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_bb_actions" ON public.business_brain_action_queue FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. Jobs (DAG pipeline)
CREATE TABLE public.business_brain_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_jobs" ON public.business_brain_jobs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_jobs" ON public.business_brain_jobs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_bb_jobs" ON public.business_brain_jobs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 7. Outcomes
CREATE TABLE public.business_brain_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES public.business_brain_decisions(id),
  measured_at timestamptz NOT NULL DEFAULT now(),
  outcome_type text NOT NULL,
  baseline_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_brain_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_select_bb_outcomes" ON public.business_brain_outcomes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_insert_bb_outcomes" ON public.business_brain_outcomes FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX idx_bb_snapshots_type_date ON public.business_brain_snapshots(snapshot_type, generated_at DESC);
CREATE INDEX idx_bb_recs_status ON public.business_brain_recommendations(status, priority_score DESC);
CREATE INDEX idx_bb_recs_type ON public.business_brain_recommendations(recommendation_type);
CREATE INDEX idx_bb_decisions_status ON public.business_brain_decisions(outcome_status);
CREATE INDEX idx_bb_actions_status ON public.business_brain_action_queue(status);
CREATE INDEX idx_bb_jobs_status ON public.business_brain_jobs(status, created_at);
CREATE INDEX idx_bb_goals_active ON public.business_brain_goals(status) WHERE status = 'active';

-- =============================================================
-- RPCs – Metric Snapshot Builders
-- =============================================================

-- 1. Learning Metrics
CREATE OR REPLACE FUNCTION public.fn_build_learning_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'active_learners', (SELECT count(DISTINCT user_id) FROM user_progress WHERE updated_at > now() - interval '30 days'),
    'total_sessions', (SELECT count(*) FROM exam_sessions WHERE created_at > now() - interval '30 days'),
    'avg_mastery', (SELECT coalesce(round(avg(mastery_level)::numeric, 2), 0) FROM user_competency_mastery),
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

-- 2. SEO Metrics
CREATE OR REPLACE FUNCTION public.fn_build_seo_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'indexed_urls', (SELECT count(*) FROM seo_discovery_state WHERE is_indexed = true),
    'sitemap_coverage', (SELECT count(*) FROM seo_discovery_state WHERE in_sitemap = true),
    'keywords_total', (SELECT count(*) FROM seo_keywords),
    'keyword_clusters', (SELECT count(*) FROM seo_keyword_clusters),
    'content_gaps', (SELECT count(*) FROM seo_keywords WHERE id NOT IN (SELECT keyword_id FROM content_generation_jobs WHERE status = 'done'))
  ) INTO result;
  RETURN result;
END;
$$;

-- 3. Content Metrics
CREATE OR REPLACE FUNCTION public.fn_build_content_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_jobs', (SELECT count(*) FROM content_generation_jobs),
    'queued', (SELECT count(*) FROM content_generation_jobs WHERE status = 'queued'),
    'generating', (SELECT count(*) FROM content_generation_jobs WHERE status = 'generating'),
    'done', (SELECT count(*) FROM content_generation_jobs WHERE status = 'done'),
    'failed', (SELECT count(*) FROM content_generation_jobs WHERE status = 'failed'),
    'validating', (SELECT count(*) FROM content_generation_jobs WHERE status = 'validating'),
    'done_30d', (SELECT count(*) FROM content_generation_jobs WHERE status = 'done' AND created_at > now() - interval '30 days'),
    'ai_cost_30d', (SELECT coalesce(round(sum(cost_eur)::numeric, 2), 0) FROM ai_usage_log WHERE created_at > now() - interval '30 days')
  ) INTO result;
  RETURN result;
END;
$$;

-- 4. Revenue Metrics
CREATE OR REPLACE FUNCTION public.fn_build_revenue_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_profiles', (SELECT count(*) FROM user_revenue_profile),
    'avg_purchase_probability', (SELECT coalesce(round(avg(purchase_probability)::numeric, 2), 0) FROM user_revenue_profile),
    'avg_ltv', (SELECT coalesce(round(avg(ltv_estimate)::numeric, 2), 0) FROM user_revenue_profile),
    'high_risk_users', (SELECT count(*) FROM user_revenue_profile WHERE risk_level = 'high'),
    'active_offers', (SELECT count(*) FROM offers WHERE status = 'active'),
    'active_bundles', (SELECT count(*) FROM product_bundles WHERE status = 'active'),
    'conversion_events_30d', (SELECT count(*) FROM conversion_events WHERE created_at > now() - interval '30 days'),
    'purchases_30d', (SELECT count(*) FROM conversion_events WHERE event_type = 'purchase' AND created_at > now() - interval '30 days')
  ) INTO result;
  RETURN result;
END;
$$;

-- 5. Growth Metrics
CREATE OR REPLACE FUNCTION public.fn_build_growth_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'shares_30d', (SELECT count(*) FROM share_events WHERE created_at > now() - interval '30 days'),
    'referrals_total', (SELECT count(*) FROM referrals),
    'referrals_rewarded', (SELECT count(*) FROM referrals WHERE reward_status = 'rewarded'),
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

-- 6. Product Metrics
CREATE OR REPLACE FUNCTION public.fn_build_product_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_packages', (SELECT count(*) FROM course_packages),
    'published', (SELECT count(*) FROM course_packages WHERE status = 'published'),
    'building', (SELECT count(*) FROM course_packages WHERE status = 'building'),
    'blocked', (SELECT count(*) FROM course_packages WHERE status = 'blocked'),
    'queued', (SELECT count(*) FROM course_packages WHERE status = 'queued'),
    'total_curricula', (SELECT count(*) FROM curricula),
    'total_courses', (SELECT count(*) FROM courses),
    'active_jobs', (SELECT count(*) FROM job_queue WHERE status IN ('pending', 'processing'))
  ) INTO result;
  RETURN result;
END;
$$;

-- 7. Risk Metrics
CREATE OR REPLACE FUNCTION public.fn_build_risk_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'stalled_packages', (SELECT count(*) FROM course_packages WHERE status = 'building' AND updated_at < now() - interval '6 hours'),
    'failed_jobs_24h', (SELECT count(*) FROM job_queue WHERE status = 'failed' AND updated_at > now() - interval '24 hours'),
    'blocked_packages', (SELECT count(*) FROM course_packages WHERE status = 'blocked'),
    'qgf_packages', (SELECT count(*) FROM course_packages WHERE status = 'quality_gate_failed'),
    'pending_jobs', (SELECT count(*) FROM job_queue WHERE status = 'pending'),
    'ai_budget_pct', (
      SELECT coalesce(round((spent_eur / NULLIF(budget_eur, 0)) * 100, 1), 0)
      FROM ai_cost_budgets ORDER BY month DESC LIMIT 1
    ),
    'content_jobs_failed', (SELECT count(*) FROM content_generation_jobs WHERE status = 'failed')
  ) INTO result;
  RETURN result;
END;
$$;

-- 8. Opportunity Metrics
CREATE OR REPLACE FUNCTION public.fn_build_opportunity_metrics_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'keywords_without_content', (
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
      SELECT count(*) FROM course_packages WHERE status = 'building' AND overall_progress >= 95
    ),
    'high_risk_low_readiness', (
      SELECT count(*) FROM user_revenue_profile WHERE risk_level = 'high' AND readiness_score < 40
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- 9. Priority Scoring
CREATE OR REPLACE FUNCTION public.fn_compute_business_priority_scores(p_snapshot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  snap record;
  risk_score numeric;
  opp_score numeric;
BEGIN
  SELECT * INTO snap FROM business_brain_snapshots WHERE id = p_snapshot_id;
  IF snap IS NULL THEN RETURN; END IF;

  -- Risk-based recommendations
  risk_score := coalesce((snap.risk_metrics->>'stalled_packages')::numeric, 0);
  IF risk_score > 3 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('operational_fix', 85 + least(risk_score, 10), 80,
      risk_score || ' stalled packages require attention',
      'Multiple packages have been in building state for >6h without progress.',
      jsonb_build_object('stalled_count', risk_score),
      jsonb_build_object('action', 'review_stalled_packages', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;

  -- Failed jobs alert
  IF coalesce((snap.risk_metrics->>'failed_jobs_24h')::numeric, 0) > 5 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('operational_fix', 90, 85,
      (snap.risk_metrics->>'failed_jobs_24h') || ' failed jobs in 24h',
      'High failure rate in job queue indicates systemic issue.',
      snap.risk_metrics,
      jsonb_build_object('action', 'investigate_job_failures', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;

  -- Content gap opportunity
  opp_score := coalesce((snap.opportunity_metrics->>'keywords_without_content')::numeric, 0);
  IF opp_score > 10 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('seo_priority', 70, 75,
      opp_score || ' keywords without content',
      'Significant SEO opportunity: keywords identified but no content generated yet.',
      jsonb_build_object('gap_count', opp_score),
      jsonb_build_object('action', 'generate_content_briefs', 'auto', true),
      p_snapshot_id, 'auto_allowed');
  END IF;

  -- High engagement users without offers
  IF coalesce((snap.opportunity_metrics->>'high_engagement_no_offer')::numeric, 0) > 5 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('revenue_action', 75, 70,
      'High-engagement users without offers',
      'Users with engagement >70 have not been shown any offer. Revenue opportunity.',
      snap.opportunity_metrics,
      jsonb_build_object('action', 'trigger_offer_engine', 'auto', true),
      p_snapshot_id, 'auto_allowed');
  END IF;

  -- Publishable packages
  IF coalesce((snap.opportunity_metrics->>'publishable_packages')::numeric, 0) > 0 THEN
    INSERT INTO business_brain_recommendations (recommendation_type, priority_score, confidence_score, title, summary, rationale, recommended_action, source_snapshot_id, execution_mode)
    VALUES ('product_priority', 80, 90,
      (snap.opportunity_metrics->>'publishable_packages') || ' packages ready to publish',
      'Packages at 95%+ progress could be finalized and published.',
      snap.opportunity_metrics,
      jsonb_build_object('action', 'review_for_publish', 'auto', false),
      p_snapshot_id, 'manual_review');
  END IF;
END;
$$;

-- 10. Goal Alignment
CREATE OR REPLACE FUNCTION public.fn_apply_business_goals_to_recommendations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  FOR goal IN SELECT * FROM business_brain_goals WHERE status = 'active'
  LOOP
    rec_types := type_map->goal.goal_type;
    IF rec_types IS NULL THEN CONTINUE; END IF;

    -- Boost = goal weight * strategy multiplier
    boost := goal.weight * CASE goal.strategy_mode
      WHEN 'growth_first' THEN CASE WHEN goal.goal_type IN ('traffic_growth', 'seo_visibility', 'content_output') THEN 1.5 ELSE 0.8 END
      WHEN 'revenue_first' THEN CASE WHEN goal.goal_type = 'revenue_growth' THEN 1.5 ELSE 0.8 END
      WHEN 'quality_first' THEN CASE WHEN goal.goal_type IN ('exam_success_rate', 'course_completion') THEN 1.5 ELSE 0.8 END
      ELSE 1.0
    END;

    UPDATE business_brain_recommendations
    SET priority_score = priority_score * boost,
        updated_at = now()
    WHERE status = 'proposed'
      AND recommendation_type = ANY(
        SELECT jsonb_array_elements_text(rec_types)
      );
  END LOOP;
END;
$$;
