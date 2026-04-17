CREATE OR REPLACE VIEW public.v_runner_cycle_diagnostics AS
WITH pending AS (
  SELECT
    job_type,
    count(*) FILTER (WHERE status = 'pending') AS pending_count,
    count(*) FILTER (WHERE status = 'pending' AND (run_after IS NULL OR run_after <= now())) AS claimable_now,
    count(*) FILTER (WHERE status = 'processing') AS processing_count,
    min(created_at) FILTER (WHERE status = 'pending') AS oldest_pending,
    max(priority) FILTER (WHERE status = 'pending') AS max_priority
  FROM public.job_queue
  WHERE status IN ('pending','processing')
  GROUP BY job_type
),
throughput AS (
  SELECT
    job_type,
    count(*) FILTER (WHERE started_at > now() - interval '5 minutes') AS claimed_last_5m,
    count(*) FILTER (WHERE completed_at > now() - interval '5 minutes' AND status = 'completed') AS done_last_5m,
    count(*) FILTER (WHERE completed_at > now() - interval '5 minutes' AND status = 'failed') AS failed_last_5m
  FROM public.job_queue
  WHERE started_at > now() - interval '15 minutes' OR completed_at > now() - interval '15 minutes'
  GROUP BY job_type
),
combined AS (
  SELECT COALESCE(p.job_type, t.job_type) AS job_type,
         p.pending_count, p.claimable_now, p.processing_count,
         t.claimed_last_5m, t.done_last_5m, t.failed_last_5m,
         p.oldest_pending, p.max_priority
  FROM pending p
  FULL OUTER JOIN throughput t ON t.job_type = p.job_type
)
SELECT
  c.job_type,
  COALESCE(c.pending_count, 0) AS pending,
  COALESCE(c.claimable_now, 0) AS claimable_now,
  COALESCE(c.processing_count, 0) AS processing,
  COALESCE(c.claimed_last_5m, 0) AS claimed_5m,
  COALESCE(c.done_last_5m, 0) AS done_5m,
  COALESCE(c.failed_last_5m, 0) AS failed_5m,
  c.oldest_pending,
  c.max_priority,
  CASE
    -- Generation lane (LLM/heavy) — content-runner
    WHEN c.job_type LIKE 'pool_fill_%' THEN 'content-runner'
    WHEN c.job_type LIKE 'lesson_generate_%' THEN 'content-runner'
    WHEN c.job_type LIKE 'package_generate_%' THEN 'content-runner'
    WHEN c.job_type LIKE 'handbook_%' THEN 'content-runner'
    WHEN c.job_type IN (
      'package_auto_seed_exam_blueprints','package_elite_harden',
      'package_fanout_learning_content','package_finalize_learning_content',
      'seed_exam_questions','enrich_exam_solutions','upgrade_minichecks_v1',
      'upgrade_ihk','generate_course','extract_curriculum','curriculum_smoke'
    ) THEN 'content-runner'
    WHEN c.job_type LIKE 'seo_%' THEN 'content-runner'
    -- Pipeline-runner = orchestrator for package state transitions
    WHEN c.job_type LIKE 'package_%' THEN 'pipeline-runner'
    -- Other lanes
    WHEN c.job_type LIKE 'campaign_%' THEN 'campaign-asset-worker'
    WHEN c.job_type LIKE 'distribution_%' THEN 'distribution-worker'
    WHEN c.job_type LIKE 'optimization_%' THEN 'optimization-executor'
    WHEN c.job_type IN ('qc_worker_full') THEN 'content-runner'
    ELSE 'unrouted'
  END AS routed_to_worker,
  EXTRACT(EPOCH FROM (now() - c.oldest_pending))::int AS oldest_pending_age_sec
FROM combined c
ORDER BY pending DESC NULLS LAST, claimed_5m DESC;

GRANT SELECT ON public.v_runner_cycle_diagnostics TO authenticated, service_role;