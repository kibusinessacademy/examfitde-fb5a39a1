
-- ============================================================================
-- SEO Wave Selector v1
-- ============================================================================

-- 1) SSOT view: v_seo_wave_candidates
DROP VIEW IF EXISTS public.v_seo_wave_candidates CASCADE;
CREATE VIEW public.v_seo_wave_candidates AS
WITH pkg AS (
  SELECT DISTINCT ON (cp.curriculum_id)
         cp.curriculum_id, cp.id AS package_id, cp.status::text AS pkg_status, cp.title AS pkg_title
    FROM public.course_packages cp
   WHERE cp.status::text = 'published'
   ORDER BY cp.curriculum_id, cp.created_at DESC
),
active_jobs AS (
  SELECT jq.package_id,
         jq.payload->>'competency_id' AS competency_id_txt,
         jq.payload->>'intent_template' AS intent_template,
         COALESCE(jq.payload->>'persona_type','azubi') AS persona_type,
         count(*) AS active_count
    FROM public.job_queue jq
   WHERE jq.job_type = 'seo_intent_page_generate'
     AND jq.status IN ('pending','processing')
   GROUP BY 1,2,3,4
),
existing_pages AS (
  SELECT scp.curriculum_id, scp.competency_id, scp.intent_template,
         COALESCE(scp.persona_type,'azubi') AS persona_type,
         max(scp.last_generated_at) AS last_generated_at,
         bool_or(scp.status = 'published') AS has_published
    FROM public.seo_content_pages scp
   WHERE scp.page_type IS DISTINCT FROM 'pillar_page'
   GROUP BY 1,2,3,4
),
recent_failures AS (
  SELECT (ahl.metadata->>'package_id')::uuid AS package_id,
         ahl.metadata->>'intent_key' AS intent_key,
         count(*) AS fail_count_24h
    FROM public.auto_heal_log ahl
   WHERE ahl.action_type = 'seo_wave_enqueue_attempt'
     AND ahl.result_status IN ('error','skipped')
     AND ahl.created_at >= now() - interval '24 hours'
     AND ahl.metadata->>'reason' IN ('PKG_NOT_PUBLISHED','SEO_DEAD_END')
   GROUP BY 1,2
),
spoke_counts AS (
  SELECT curriculum_id, count(*) AS published_spoke_count
    FROM public.seo_content_pages
   WHERE status='published' AND page_type IS DISTINCT FROM 'pillar_page'
   GROUP BY 1
)
SELECT
  q.id                       AS priority_queue_id,
  q.curriculum_id,
  pkg.package_id,
  cur.title                  AS curriculum_title,
  pkg.pkg_title              AS package_title,
  q.competency_id,
  q.intent_key,
  ('intent_' || CASE WHEN q.intent_key LIKE 'intent\_%' ESCAPE '\' THEN substring(q.intent_key from 8) ELSE q.intent_key END) AS intent_template,
  COALESCE(q.persona_type,'azubi') AS persona_type,
  q.package_publish_eligible AS publish_eligible,
  q.thin_content_risk,
  COALESCE(q.cluster_priority, 3) AS cluster_priority,
  COALESCE(q.semrush_volume, 0)   AS semrush_volume,
  CASE q.intent_key
    WHEN 'pruefungsfragen' THEN 9
    WHEN 'lernplan'        THEN 8
    WHEN 'typische_fehler' THEN 6
    WHEN 'durchfallquote'  THEN 5
    ELSE 4
  END AS intent_priority,
  COALESCE(sc.published_spoke_count, 0) AS existing_spoke_count,
  ROUND(LEAST(COALESCE(sc.published_spoke_count,0)::numeric / 8.0, 1.0), 3) AS pillar_progress_ratio,
  (aj.active_count IS NOT NULL AND aj.active_count > 0) AS active_job_exists,
  COALESCE(rf.fail_count_24h, 0) AS recent_failure_count_24h,
  ep.last_generated_at,
  ep.has_published AS has_existing_published_page,
  -- projected score (heuristic 0..100)
  LEAST(100,
        COALESCE(q.cluster_priority,3) * 8
      + (CASE q.intent_key WHEN 'pruefungsfragen' THEN 25 WHEN 'lernplan' THEN 20
                            WHEN 'typische_fehler' THEN 12 WHEN 'durchfallquote' THEN 10 ELSE 5 END)
      + LEAST(COALESCE(q.semrush_volume,0)/100, 30)
      + CASE q.thin_content_risk WHEN 'low' THEN 15 WHEN 'medium' THEN 5 ELSE 0 END
  )::int AS seo_score_projection,
  -- exclusion reason (first applicable)
  CASE
    WHEN pkg.package_id IS NULL THEN 'no_published_package'
    WHEN NOT q.package_publish_eligible THEN 'pkg_not_published'
    WHEN q.thin_content_risk IN ('high','blocked') THEN 'thin_content_risk_'||q.thin_content_risk
    WHEN COALESCE(ep.has_published,false) THEN 'already_published'
    WHEN aj.active_count IS NOT NULL AND aj.active_count > 0 THEN 'active_job_exists'
    WHEN COALESCE(rf.fail_count_24h,0) >= 2 THEN 'cooldown_recent_failures'
    ELSE NULL
  END AS exclusion_reason,
  (
    pkg.package_id IS NOT NULL
    AND q.package_publish_eligible
    AND q.thin_content_risk NOT IN ('high','blocked')
    AND NOT COALESCE(ep.has_published,false)
    AND (aj.active_count IS NULL OR aj.active_count = 0)
    AND COALESCE(rf.fail_count_24h,0) < 2
  ) AS wave_eligible
FROM public.seo_content_priority_queue q
JOIN public.curricula cur ON cur.id = q.curriculum_id
LEFT JOIN pkg                  ON pkg.curriculum_id = q.curriculum_id
LEFT JOIN active_jobs aj       ON aj.package_id = pkg.package_id
                              AND aj.competency_id_txt = q.competency_id::text
                              AND aj.intent_template = ('intent_' || CASE WHEN q.intent_key LIKE 'intent\_%' ESCAPE '\' THEN substring(q.intent_key from 8) ELSE q.intent_key END)
                              AND aj.persona_type = COALESCE(q.persona_type,'azubi')
LEFT JOIN existing_pages ep    ON ep.curriculum_id = q.curriculum_id
                              AND ep.competency_id = q.competency_id
                              AND ep.intent_template = ('intent_' || CASE WHEN q.intent_key LIKE 'intent\_%' ESCAPE '\' THEN substring(q.intent_key from 8) ELSE q.intent_key END)
                              AND ep.persona_type = COALESCE(q.persona_type,'azubi')
LEFT JOIN recent_failures rf   ON rf.package_id = pkg.package_id AND rf.intent_key = q.intent_key
LEFT JOIN spoke_counts sc      ON sc.curriculum_id = q.curriculum_id;

REVOKE ALL ON public.v_seo_wave_candidates FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_seo_wave_candidates TO service_role;

-- 2) Inventory KPI view: v_seo_inventory_utilization
DROP VIEW IF EXISTS public.v_seo_inventory_utilization CASCADE;
CREATE VIEW public.v_seo_inventory_utilization AS
WITH base AS (
  SELECT
    curriculum_id,
    count(*)                                                AS total_rows,
    count(*) FILTER (WHERE wave_eligible)                   AS eligible_count,
    count(*) FILTER (WHERE active_job_exists)               AS active_count,
    count(*) FILTER (WHERE has_existing_published_page)     AS published_count,
    count(*) FILTER (WHERE exclusion_reason='pkg_not_published')              AS blocked_pkg_unpublished,
    count(*) FILTER (WHERE exclusion_reason LIKE 'thin_content_risk_%')       AS blocked_thin,
    count(*) FILTER (WHERE exclusion_reason='cooldown_recent_failures')       AS blocked_cooldown,
    count(*) FILTER (WHERE exclusion_reason IS NULL AND NOT wave_eligible AND NOT active_job_exists AND NOT has_existing_published_page) AS other_blocked
  FROM public.v_seo_wave_candidates
  GROUP BY curriculum_id
)
SELECT b.*, cur.title AS curriculum_title FROM base b
JOIN public.curricula cur ON cur.id = b.curriculum_id;

REVOKE ALL ON public.v_seo_inventory_utilization FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_seo_inventory_utilization TO service_role;

-- 3) Selector RPC: admin_select_next_seo_wave
CREATE OR REPLACE FUNCTION public.admin_select_next_seo_wave(
  p_limit             int     DEFAULT 6,
  p_strategy          text    DEFAULT 'balanced_curriculum',
  p_max_per_curriculum int    DEFAULT 2,
  p_dry_run           boolean DEFAULT true,
  p_wave              int     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_strategies text[] := ARRAY['balanced_curriculum','pillar_push','high_intent_first','long_tail_expand','semrush_weighted'];
  v_selected jsonb := '[]'::jsonb;
  v_enqueued jsonb := '[]'::jsonb;
  v_rec record;
  v_enq jsonb;
  v_audit_id uuid := gen_random_uuid();
  v_total_eligible int;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF NOT (p_strategy = ANY (v_strategies)) THEN
    RAISE EXCEPTION 'unknown strategy: %', p_strategy;
  END IF;

  p_limit              := GREATEST(1, LEAST(COALESCE(p_limit,6), 20));
  p_max_per_curriculum := GREATEST(1, LEAST(COALESCE(p_max_per_curriculum,2), 8));

  SELECT count(*) INTO v_total_eligible FROM public.v_seo_wave_candidates WHERE wave_eligible;

  -- Ranked selection with per-curriculum cap
  WITH ranked AS (
    SELECT c.*,
           CASE p_strategy
             WHEN 'pillar_push'        THEN (1.0 - c.pillar_progress_ratio) * 100 + c.intent_priority
             WHEN 'high_intent_first'  THEN c.intent_priority * 20 + c.seo_score_projection * 0.3
             WHEN 'long_tail_expand'   THEN (CASE WHEN c.semrush_volume=0 THEN 50 ELSE 0 END) + c.cluster_priority * 5
             WHEN 'semrush_weighted'   THEN LEAST(c.semrush_volume::numeric/50, 80) + c.intent_priority
             ELSE /* balanced_curriculum */ c.seo_score_projection + (1.0 - c.pillar_progress_ratio) * 20
           END AS score
      FROM public.v_seo_wave_candidates c
     WHERE c.wave_eligible
  ),
  capped AS (
    SELECT r.*, row_number() OVER (PARTITION BY r.curriculum_id ORDER BY r.score DESC) AS rn_curr
      FROM ranked r
  )
  SELECT jsonb_agg(to_jsonb(s) ORDER BY s.score DESC)
    INTO v_selected
    FROM (
      SELECT * FROM capped
       WHERE rn_curr <= p_max_per_curriculum
       ORDER BY score DESC
       LIMIT p_limit
    ) s;

  v_selected := COALESCE(v_selected, '[]'::jsonb);

  IF NOT p_dry_run THEN
    FOR v_rec IN SELECT * FROM jsonb_array_elements(v_selected) LOOP
      v_enq := public.admin_seo_wave_enqueue_one(
        p_curriculum_id    := (v_rec.value->>'curriculum_id')::uuid,
        p_competency_id    := (v_rec.value->>'competency_id')::uuid,
        p_package_id       := (v_rec.value->>'package_id')::uuid,
        p_intent_key       := v_rec.value->>'intent_key',
        p_persona_type     := COALESCE(v_rec.value->>'persona_type','azubi'),
        p_wave             := p_wave,
        p_priority_queue_id:= (v_rec.value->>'priority_queue_id')::uuid,
        p_enqueue_source   := 'admin_select_next_seo_wave:'||p_strategy,
        p_priority         := 5,
        p_dry_run          := false
      );
      v_enqueued := v_enqueued || jsonb_build_array(jsonb_build_object(
        'curriculum_id',  v_rec.value->>'curriculum_id',
        'intent_key',     v_rec.value->>'intent_key',
        'enqueue_result', v_enq
      ));
    END LOOP;
  END IF;

  INSERT INTO public.auto_heal_log (id, action_type, target_type, result_status, metadata)
  VALUES (v_audit_id, 'seo_wave_selector_run', 'system',
          CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
          jsonb_build_object(
            'strategy', p_strategy,
            'limit', p_limit,
            'max_per_curriculum', p_max_per_curriculum,
            'wave', p_wave,
            'dry_run', p_dry_run,
            'total_eligible', v_total_eligible,
            'selected_count', jsonb_array_length(v_selected),
            'enqueued_count', jsonb_array_length(v_enqueued)
          ));

  RETURN jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'strategy', p_strategy,
    'dry_run', p_dry_run,
    'total_eligible', v_total_eligible,
    'selected', v_selected,
    'enqueued', v_enqueued
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_select_next_seo_wave(int,text,int,boolean,int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_select_next_seo_wave(int,text,int,boolean,int) TO authenticated, service_role;

-- 4) Admin read RPCs for the views
CREATE OR REPLACE FUNCTION public.admin_get_seo_wave_candidates(p_only_eligible boolean DEFAULT true, p_limit int DEFAULT 200)
RETURNS SETOF public.v_seo_wave_candidates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM public.v_seo_wave_candidates
     WHERE (NOT p_only_eligible) OR wave_eligible
     ORDER BY wave_eligible DESC, seo_score_projection DESC
     LIMIT GREATEST(1, LEAST(p_limit, 1000));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_wave_candidates(boolean,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_seo_inventory_utilization()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_global jsonb; v_per_curr jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'total_rows',            sum(total_rows),
    'eligible_count',        sum(eligible_count),
    'active_count',          sum(active_count),
    'published_count',       sum(published_count),
    'blocked_pkg_unpublished', sum(blocked_pkg_unpublished),
    'blocked_thin',          sum(blocked_thin),
    'blocked_cooldown',      sum(blocked_cooldown),
    'other_blocked',         sum(other_blocked),
    'curricula_total',       count(*),
    'curricula_with_eligible', count(*) FILTER (WHERE eligible_count > 0)
  ) INTO v_global FROM public.v_seo_inventory_utilization;

  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.eligible_count DESC, t.published_count DESC)
    INTO v_per_curr
    FROM public.v_seo_inventory_utilization t;

  RETURN jsonb_build_object('global', v_global, 'per_curriculum', COALESCE(v_per_curr,'[]'::jsonb));
END $$;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_inventory_utilization() TO authenticated, service_role;
