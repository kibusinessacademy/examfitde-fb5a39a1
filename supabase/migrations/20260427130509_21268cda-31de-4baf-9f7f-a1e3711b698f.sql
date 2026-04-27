-- =========================================================================
-- MANUAL BYPASS HEAL: Blocked packages by reason + Quality-Council exhausted
-- =========================================================================

-- Mark transition source for audit trail
SELECT set_config('app.transition_source', 'admin_manual_bypass:heal_cockpit_2026_04_27', true);

-- ----- 1) NO_STEP_HISTORY (9 pkgs) → status='building' -----
WITH ids AS (
  SELECT package_ids FROM public.v_admin_blocked_packages_diagnosis WHERE reason_class='NO_STEP_HISTORY'
)
UPDATE public.course_packages cp
SET status='building', updated_at=now()
FROM ids
WHERE cp.id = ANY(ids.package_ids) AND cp.status='blocked';

-- ----- 2) HARD_FAIL_NO_CURRICULUM (6 pkgs) → status='queued' -----
WITH ids AS (
  SELECT package_ids FROM public.v_admin_blocked_packages_diagnosis WHERE reason_class='HARD_FAIL_NO_CURRICULUM'
)
UPDATE public.course_packages cp
SET status='queued', updated_at=now()
FROM ids
WHERE cp.id = ANY(ids.package_ids) AND cp.status='blocked';

-- ----- 3) AUTO_HEALED_RESIDUE (1 pkg) → building + reset failed steps -----
WITH ids AS (
  SELECT package_ids FROM public.v_admin_blocked_packages_diagnosis WHERE reason_class='AUTO_HEALED_RESIDUE'
), upd_pkg AS (
  UPDATE public.course_packages cp
  SET status='building', updated_at=now()
  FROM ids
  WHERE cp.id = ANY(ids.package_ids) AND cp.status='blocked'
  RETURNING cp.id
)
UPDATE public.package_steps ps
SET status='queued'::step_status,
    last_error=NULL,
    updated_at=now(),
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'unblocked_by_reason','AUTO_HEALED_RESIDUE',
      'unblocked_at', now(),
      'unblocked_via','manual_bypass'
    )
WHERE ps.package_id IN (SELECT id FROM upd_pkg)
  AND ps.status='failed'::step_status;

-- ----- 4) COVERAGE_GAP (1 pkg) → building + reset auto_publish only -----
WITH ids AS (
  SELECT package_ids FROM public.v_admin_blocked_packages_diagnosis WHERE reason_class='COVERAGE_GAP'
), upd_pkg AS (
  UPDATE public.course_packages cp
  SET status='building', updated_at=now()
  FROM ids
  WHERE cp.id = ANY(ids.package_ids) AND cp.status='blocked'
  RETURNING cp.id
)
UPDATE public.package_steps ps
SET status='queued'::step_status,
    last_error=NULL,
    updated_at=now(),
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'unblocked_by_reason','COVERAGE_GAP',
      'unblocked_at', now(),
      'unblocked_via','manual_bypass'
    )
WHERE ps.package_id IN (SELECT id FROM upd_pkg)
  AND ps.status='failed'::step_status
  AND ps.step_key='auto_publish';

-- ----- 5) QUALITY-COUNCIL MAX_ATTEMPTS_EXHAUSTED (3 pkgs / 3 jobs) -----
-- Cancel exhausted jobs + reset quality_council step + clear council_defer_log
WITH stuck_jobs AS (
  SELECT id, package_id, COALESCE(meta->>'step_key','quality_council') AS step_key
  FROM public.job_queue
  WHERE job_type='package_quality_council'
    AND status='failed'
    AND attempts >= max_attempts
    AND completed_at >= now() - interval '24 hours'
), cancel_jobs AS (
  UPDATE public.job_queue jq
  SET status='cancelled',
      completed_at=COALESCE(jq.completed_at, now()),
      last_error=COALESCE(jq.last_error,'')||' | MANUAL_BYPASS_RESET_2026_04_27',
      updated_at=now()
  FROM stuck_jobs s
  WHERE jq.id=s.id
  RETURNING jq.package_id
), reset_steps AS (
  UPDATE public.package_steps ps
  SET status='queued'::step_status,
      attempts=0,
      last_error=NULL,
      updated_at=now(),
      meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'manual_bypass_reset_at', now(),
        'manual_bypass_reason','MAX_ATTEMPTS_EXHAUSTED_RECOVERY'
      )
  WHERE ps.package_id IN (SELECT DISTINCT package_id FROM stuck_jobs)
    AND ps.step_key='quality_council'
  RETURNING ps.package_id
)
DELETE FROM public.council_defer_log
WHERE package_id IN (SELECT package_id FROM reset_steps);

-- ----- Audit -----
INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
VALUES (
  NULL,
  'manual_bypass_heal_cockpit',
  'multi',
  ARRAY[]::uuid[],
  jsonb_build_object(
    'reason_classes', ARRAY['NO_STEP_HISTORY','HARD_FAIL_NO_CURRICULUM','AUTO_HEALED_RESIDUE','COVERAGE_GAP'],
    'quality_council_reset', true,
    'note','Manual SQL bypass — Recover Actions UI was broken; healed via migration 2026-04-27'
  )
);