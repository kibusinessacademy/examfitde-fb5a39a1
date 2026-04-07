
-- =============================================
-- FIX 1: Ops-Views mit kanonischen Statuswerten
-- Kanonische job_queue.status: pending, completed, failed, cancelled
-- =============================================

-- 1a. ops_block_classification: fix open_jobs subquery
CREATE OR REPLACE VIEW public.ops_block_classification AS
SELECT 
  cp.id AS package_id,
  c.title AS course_title,
  cp.status,
  cp.blocked_reason,
  cp.blocked_by,
  cp.blocked_at,
  cp.build_progress,
  CASE
    WHEN cp.blocked_reason ILIKE '%admin_hold%' THEN 'admin_hold'
    WHEN cp.blocked_reason ILIKE '%governance_backfill%' THEN 'governance_backfill_unknown'
    WHEN cp.blocked_reason ILIKE '%exam_pool%' OR cp.blocked_reason ILIKE '%exam%' THEN 'missing_exam_pool'
    WHEN cp.blocked_reason ILIKE '%handbook%' OR cp.blocked_reason ILIKE '%handbuch%' THEN 'missing_handbook'
    WHEN cp.blocked_reason ILIKE '%zombie%' OR cp.blocked_reason ILIKE '%auto_heal%' THEN 'auto_heal_zombie'
    WHEN cp.blocked_reason IS NULL OR trim(cp.blocked_reason) = '' THEN 'blocked_without_reason'
    ELSE 'other'
  END AS block_class,
  (SELECT count(*) FROM public.job_queue jq 
   WHERE jq.package_id = cp.id 
   AND jq.status = 'pending') AS open_jobs
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'blocked';

-- 1b. ops_stalled_builds: fix open_jobs subquery
CREATE OR REPLACE VIEW public.ops_stalled_builds AS
SELECT 
  cp.id AS package_id,
  c.title AS course_title,
  cp.status,
  cp.build_progress,
  cp.updated_at,
  now() - cp.updated_at AS stale_duration,
  (SELECT count(*) FROM public.job_queue jq 
   WHERE jq.package_id = cp.id 
   AND jq.status = 'pending') AS open_jobs,
  CASE 
    WHEN (SELECT count(*) FROM public.job_queue jq 
          WHERE jq.package_id = cp.id 
          AND jq.status = 'pending') > 0 
    THEN 'stalled_with_jobs'
    ELSE 'stalled_without_jobs'
  END AS stall_class
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'building'
  AND cp.updated_at < now() - interval '24 hours';

-- =============================================
-- FIX 2: Zugriff einschränken – nur Admin-API
-- =============================================
REVOKE SELECT ON public.ops_blocked_without_reason FROM authenticated;
REVOKE SELECT ON public.ops_blocked_without_reason FROM anon;
REVOKE SELECT ON public.ops_block_classification FROM authenticated;
REVOKE SELECT ON public.ops_block_classification FROM anon;
REVOKE SELECT ON public.ops_stalled_builds FROM authenticated;
REVOKE SELECT ON public.ops_stalled_builds FROM anon;

-- =============================================
-- FIX 3: Backfill-Reklassifikation
-- admin_hold: legacy → governance_backfill_unknown
-- =============================================
UPDATE public.course_packages
SET blocked_reason = 'governance_backfill_unknown'
WHERE status = 'blocked'
  AND blocked_reason = 'admin_hold: legacy – kein Grund dokumentiert';
