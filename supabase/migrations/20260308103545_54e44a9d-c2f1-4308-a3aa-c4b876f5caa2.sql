
-- ============================================================
-- A. LESSON THROUGHPUT (12h)
-- ============================================================

CREATE OR REPLACE VIEW public.v_lesson_throughput_12h AS
SELECT
  date_trunc('hour', coalesce(j.completed_at, j.updated_at)) AS bucket_hour,
  count(*) AS lessons_done
FROM public.job_queue j
WHERE j.job_type = 'lesson_generate_content'
  AND j.status IN ('done','completed')
  AND coalesce(j.completed_at, j.updated_at) > now() - interval '12 hours'
GROUP BY 1
ORDER BY 1;

-- ============================================================
-- B. PROVIDER COOLDOWN LOSS (12h)
-- ============================================================

CREATE OR REPLACE VIEW public.v_provider_cooldown_loss_12h AS
SELECT
  provider,
  model,
  count(*) AS cooldown_events,
  round(sum(
    greatest(
      0,
      extract(epoch from (least(until_at, now()) - greatest(set_at, now() - interval '12 hours')))
    )
  ) / 60.0, 1) AS cooldown_minutes_lost_12h
FROM public.llm_provider_cooldowns
WHERE until_at > now() - interval '12 hours'
GROUP BY provider, model
ORDER BY cooldown_minutes_lost_12h DESC;

-- ============================================================
-- C. PROVIDER FAILURE RATE (12h)
-- ============================================================

CREATE OR REPLACE VIEW public.v_provider_failure_rate_12h AS
WITH base AS (
  SELECT
    coalesce(j.meta->>'last_provider', 'unknown') AS provider,
    coalesce(j.meta->>'last_model', 'unknown') AS model,
    j.status,
    count(*) AS cnt
  FROM public.job_queue j
  WHERE j.updated_at > now() - interval '12 hours'
    AND j.job_type IN ('lesson_generate_content','lesson_generate_competency_bundle','package_generate_learning_content')
  GROUP BY 1,2,3
),
agg AS (
  SELECT
    provider,
    model,
    sum(cnt) AS total_jobs,
    sum(cnt) FILTER (WHERE status = 'failed') AS failed_jobs,
    sum(cnt) FILTER (WHERE status IN ('done','completed')) AS success_jobs
  FROM base
  GROUP BY 1,2
)
SELECT
  provider,
  model,
  total_jobs,
  coalesce(failed_jobs, 0) AS failed_jobs,
  coalesce(success_jobs, 0) AS success_jobs,
  CASE
    WHEN total_jobs > 0 THEN round((coalesce(failed_jobs, 0)::numeric / total_jobs::numeric) * 100, 1)
    ELSE 0
  END AS fail_rate_pct
FROM agg
ORDER BY fail_rate_pct DESC, total_jobs DESC;

-- ============================================================
-- D. BUILDING PACKAGE PROGRESS / ETA
-- ============================================================

CREATE OR REPLACE VIEW public.v_building_package_eta AS
WITH lesson_progress AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.build_progress,
    cp.updated_at,
    count(l.id) FILTER (
      WHERE l.content ? 'html'
        AND length(coalesce(l.content->>'html', '')) >= 600
        AND coalesce(l.content->>'_placeholder', 'false') <> 'true'
    ) AS real_lessons,
    count(l.id) AS total_lessons
  FROM public.course_packages cp
  JOIN public.courses c ON c.id = cp.course_id
  JOIN public.modules m ON m.course_id = c.id
  JOIN public.lessons l ON l.module_id = m.id
  WHERE cp.status = 'building'
  GROUP BY cp.id, cp.title, cp.build_progress, cp.updated_at
),
throughput AS (
  SELECT
    greatest(count(*)::numeric / 12.0, 0.01) AS lessons_per_hour
  FROM public.job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status IN ('done','completed')
    AND coalesce(completed_at, updated_at) > now() - interval '12 hours'
)
SELECT
  lp.package_id,
  lp.title,
  lp.build_progress,
  lp.real_lessons,
  lp.total_lessons,
  greatest(lp.total_lessons - lp.real_lessons, 0) AS remaining_lessons,
  round(t.lessons_per_hour, 2) AS global_lessons_per_hour,
  CASE
    WHEN t.lessons_per_hour > 0.01
      THEN round(greatest(lp.total_lessons - lp.real_lessons, 0) / t.lessons_per_hour, 1)
    ELSE NULL
  END AS eta_hours_content_only,
  lp.updated_at
FROM lesson_progress lp
CROSS JOIN throughput t
ORDER BY lp.build_progress DESC, lp.updated_at DESC;

-- ============================================================
-- E. PERFORMANCE SNAPSHOT RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pipeline_performance_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lessons_last_hour integer := 0;
  v_lessons_12h integer := 0;
  v_avg_per_hour numeric := 0;
  v_cooldown_loss jsonb;
  v_fail_rates jsonb;
  v_eta jsonb;
BEGIN
  SELECT count(*)
  INTO v_lessons_last_hour
  FROM public.job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status IN ('done','completed')
    AND coalesce(completed_at, updated_at) > now() - interval '1 hour';

  SELECT count(*)
  INTO v_lessons_12h
  FROM public.job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status IN ('done','completed')
    AND coalesce(completed_at, updated_at) > now() - interval '12 hours';

  v_avg_per_hour := round((v_lessons_12h::numeric / 12.0), 2);

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  INTO v_cooldown_loss
  FROM (SELECT * FROM public.v_provider_cooldown_loss_12h LIMIT 10) x;

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  INTO v_fail_rates
  FROM (SELECT * FROM public.v_provider_failure_rate_12h LIMIT 10) x;

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  INTO v_eta
  FROM (SELECT * FROM public.v_building_package_eta LIMIT 20) x;

  RETURN jsonb_build_object(
    'lessons_last_hour', v_lessons_last_hour,
    'lessons_last_12h', v_lessons_12h,
    'avg_lessons_per_hour_12h', v_avg_per_hour,
    'cooldown_loss', v_cooldown_loss,
    'provider_fail_rates', v_fail_rates,
    'building_eta', v_eta
  );
END;
$$;
