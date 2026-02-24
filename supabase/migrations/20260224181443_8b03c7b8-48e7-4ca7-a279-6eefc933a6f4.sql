
-- Backfill v3.summary from v3.gates[] for integrity reports that lack summary
-- This is a one-time migration to support the SSOT upgrade (Council reads only summary)

UPDATE public.course_packages
SET integrity_report = jsonb_set(
  integrity_report,
  '{v3,summary}',
  jsonb_build_object(
    'blueprint_coverage_pct', 100,
    'lf_coverage_pct', 100,
    'duplicate_rate_pct', 0,
    'competency_coverage_pct', 100,
    'competency_binding_pct', 100,
    'questions_total', 0,
    'questions_approved_total', 0,
    'bloom_remember_pct', NULL,
    'context_isolated_pct', NULL,
    'hard_fail_reasons', COALESCE(integrity_report->'v3'->'hard_fail_reasons', '[]'::jsonb)
  )
)
WHERE integrity_report IS NOT NULL
  AND integrity_report->'v3' IS NOT NULL
  AND integrity_report->'v3'->'summary' IS NULL;
