
-- 1. Add governance columns
ALTER TABLE public.course_packages 
  ADD COLUMN IF NOT EXISTS blocked_by text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unblock_hint text;

-- 2. Backfill blocked_at for existing blocked packages
UPDATE public.course_packages 
SET blocked_at = COALESCE(updated_at, created_at)
WHERE status = 'blocked' AND blocked_at IS NULL;

-- 3. Validation trigger: blocked => blocked_reason required
CREATE OR REPLACE FUNCTION public.fn_guard_blocked_requires_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'blocked' AND (NEW.blocked_reason IS NULL OR trim(NEW.blocked_reason) = '') THEN
    RAISE EXCEPTION 'SSOT violation: status=blocked requires non-empty blocked_reason';
  END IF;
  
  -- Auto-set blocked_at when transitioning to blocked
  IF NEW.status = 'blocked' AND (OLD.status IS DISTINCT FROM 'blocked') THEN
    NEW.blocked_at := COALESCE(NEW.blocked_at, now());
  END IF;
  
  -- Clear block fields when unblocking
  IF OLD.status = 'blocked' AND NEW.status != 'blocked' THEN
    NEW.blocked_at := NULL;
    NEW.blocked_by := NULL;
    NEW.unblock_hint := NULL;
    -- Keep blocked_reason for audit trail
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_blocked_requires_reason ON public.course_packages;
CREATE TRIGGER trg_guard_blocked_requires_reason
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_blocked_requires_reason();

-- 4. Permanent alarm view: blocked without reason (should always be empty)
CREATE OR REPLACE VIEW public.ops_blocked_without_reason AS
SELECT 
  cp.id AS package_id,
  c.title AS course_title,
  cp.status,
  cp.blocked_reason,
  cp.blocked_by,
  cp.blocked_at,
  cp.updated_at
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'blocked' 
  AND (cp.blocked_reason IS NULL OR trim(cp.blocked_reason) = '');

-- 5. Block classification view
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
    WHEN cp.blocked_reason ILIKE '%exam_pool%' OR cp.blocked_reason ILIKE '%exam%' THEN 'missing_exam_pool'
    WHEN cp.blocked_reason ILIKE '%handbook%' OR cp.blocked_reason ILIKE '%handbuch%' THEN 'missing_handbook'
    WHEN cp.blocked_reason ILIKE '%zombie%' OR cp.blocked_reason ILIKE '%auto_heal%' THEN 'auto_heal_zombie'
    WHEN cp.blocked_reason IS NULL OR trim(cp.blocked_reason) = '' THEN 'blocked_without_reason'
    ELSE 'other'
  END AS block_class,
  (SELECT count(*) FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','running','queued')) AS open_jobs
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'blocked';

-- 6. Stalled builds view (building but no progress)
CREATE OR REPLACE VIEW public.ops_stalled_builds AS
SELECT 
  cp.id AS package_id,
  c.title AS course_title,
  cp.status,
  cp.build_progress,
  cp.updated_at,
  now() - cp.updated_at AS stale_duration,
  (SELECT count(*) FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','running','queued')) AS open_jobs,
  CASE 
    WHEN (SELECT count(*) FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','running','queued')) > 0 
    THEN 'stalled_with_jobs'
    ELSE 'stalled_without_jobs'
  END AS stall_class
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'building'
  AND cp.updated_at < now() - interval '24 hours';

-- Grant read access for authenticated admin queries
GRANT SELECT ON public.ops_blocked_without_reason TO authenticated;
GRANT SELECT ON public.ops_block_classification TO authenticated;
GRANT SELECT ON public.ops_stalled_builds TO authenticated;
