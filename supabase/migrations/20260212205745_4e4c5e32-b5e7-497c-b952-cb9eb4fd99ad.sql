
-- Enterprise Upgrade: cooldowns, severity, approval gate, incident mode, success tracking

-- 1) Add enterprise columns to auto_heal_policies
ALTER TABLE public.auto_heal_policies
  ADD COLUMN cooldowns jsonb DEFAULT '{"retry_failed_jobs": 900, "auto_gap_closer": 3600, "handbook_generator": 3600}'::jsonb,
  ADD COLUMN severity_map jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN requires_approval text[] DEFAULT ARRAY['republish_course', 'bulk_delete_questions']::text[],
  ADD COLUMN incident_mode boolean DEFAULT false,
  ADD COLUMN incident_activated_at timestamptz,
  ADD COLUMN incident_activated_by text;

-- 2) Add follow-up tracking to auto_heal_log
ALTER TABLE public.auto_heal_log
  ADD COLUMN followup_checked_at timestamptz,
  ADD COLUMN followup_score_before numeric,
  ADD COLUMN followup_score_after numeric,
  ADD COLUMN followup_verdict text;

-- 3) Update existing active policy
UPDATE public.auto_heal_policies
SET
  cooldowns = '{"retry_failed_jobs": 900, "auto_gap_closer": 3600, "handbook_generator": 3600, "run_minicheck_generator": 1800, "run_oral_exam_generator": 3600}'::jsonb,
  severity_map = '{"exam_pool_coverage_gap": "warning", "integrity_below_target": "critical", "ai_tutor_index_failed": "info", "missing_minichecks": "warning", "handbook_chapters_insufficient": "warning", "oral_exam_missing": "warning", "INVALID_COMPETENCY_REF": "critical", "LLM_TIMEOUT": "info"}'::jsonb,
  requires_approval = ARRAY['republish_course', 'bulk_delete_questions']::text[],
  incident_mode = false,
  notes = 'Enterprise Auto-Heal Policy v2 with cooldowns, severity, approval gates, and incident mode'
WHERE is_active = true;

-- 4) Create effectiveness view
CREATE OR REPLACE VIEW public.ops_heal_effectiveness AS
SELECT
  action_type,
  count(*) AS total_runs,
  count(*) FILTER (WHERE result_status = 'success') AS successes,
  count(*) FILTER (WHERE result_status = 'failed') AS failures,
  count(*) FILTER (WHERE result_status = 'skipped') AS skipped,
  CASE WHEN count(*) > 0
    THEN round(100.0 * count(*) FILTER (WHERE result_status = 'success') / count(*), 1)
    ELSE 0
  END AS success_rate,
  round(avg(duration_ms)::numeric, 0) AS avg_duration_ms,
  count(*) FILTER (WHERE followup_verdict = 'improved') AS followup_improved,
  count(*) FILTER (WHERE followup_verdict = 'no_change') AS followup_no_change,
  count(*) FILTER (WHERE followup_verdict = 'regressed') AS followup_regressed,
  round(avg(followup_score_after - followup_score_before)::numeric, 1) AS avg_score_delta
FROM auto_heal_log
WHERE created_at > now() - interval '30 days'
GROUP BY action_type
ORDER BY total_runs DESC;
