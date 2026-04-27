SELECT set_config('app.transition_source','admin_manual_bypass:heal_clear_blocked_reason_2026_04_27',true);

-- NO_STEP_HISTORY, AUTO_HEALED_RESIDUE, COVERAGE_GAP → building (clear reason+set status atomically)
WITH targets AS (
  SELECT unnest(package_ids) AS pid
  FROM public.v_admin_blocked_packages_diagnosis
  WHERE reason_class IN ('NO_STEP_HISTORY','AUTO_HEALED_RESIDUE','COVERAGE_GAP')
)
UPDATE public.course_packages cp
SET blocked_reason=NULL,
    status='queued',  -- safer than building; avoids WIP cap; pipeline picks up from queued
    updated_at=now()
FROM targets t
WHERE cp.id=t.pid AND cp.status='blocked';

-- HARD_FAIL_NO_CURRICULUM → queued
WITH targets AS (
  SELECT unnest(package_ids) AS pid
  FROM public.v_admin_blocked_packages_diagnosis
  WHERE reason_class='HARD_FAIL_NO_CURRICULUM'
)
UPDATE public.course_packages cp
SET blocked_reason=NULL,
    status='queued',
    updated_at=now()
FROM targets t
WHERE cp.id=t.pid AND cp.status='blocked';

-- Reset failed steps for AUTO_HEALED_RESIDUE + COVERAGE_GAP (auto_publish only) + NO_STEP_HISTORY (all)
WITH targets AS (
  SELECT unnest(d.package_ids) AS pid, d.reason_class
  FROM public.v_admin_blocked_packages_diagnosis d
  WHERE reason_class IN ('NO_STEP_HISTORY','AUTO_HEALED_RESIDUE','COVERAGE_GAP')
)
UPDATE public.package_steps ps
SET status='queued'::step_status,
    last_error=NULL,
    attempts=0,
    updated_at=now(),
    meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
      'unblocked_by_reason', t.reason_class,
      'unblocked_at', now(),
      'unblocked_via','manual_bypass_v2'
    )
FROM targets t
WHERE ps.package_id=t.pid
  AND ps.status='failed'::step_status
  AND (
    t.reason_class<>'COVERAGE_GAP'
    OR ps.step_key='auto_publish'
  );

-- Final verification audit
INSERT INTO public.admin_actions(action, scope, affected_ids, payload)
SELECT 'manual_bypass_clear_blocked_reason_v2','course_packages',
       ARRAY[]::uuid[],
       jsonb_build_object(
         'remaining_blocked', (SELECT count(*) FROM public.course_packages WHERE status='blocked'),
         'note','Cleared blocked_reason atomically with status to bypass invariant-guard'
       );