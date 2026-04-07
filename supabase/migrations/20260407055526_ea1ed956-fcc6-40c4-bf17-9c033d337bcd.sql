
-- 1. Neue Governance-Felder
ALTER TABLE public.course_packages 
  ADD COLUMN IF NOT EXISTS resolution_owner text,
  ADD COLUMN IF NOT EXISTS review_due_at timestamptz;

-- 2. Trigger mit Taxonomie-Validierung
CREATE OR REPLACE FUNCTION public.fn_guard_blocked_requires_reason()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed_reasons text[] := ARRAY[
    'admin_hold',
    'content_gap',
    'manual_review_required',
    'compliance_hold',
    'pipeline_repair_required',
    'awaiting_source_data',
    'intentional_pause',
    'missing_exam_pool',
    'missing_handbook',
    'auto_heal_zombie',
    'governance_backfill_unknown'
  ];
BEGIN
  IF NEW.status = 'blocked' THEN
    IF NEW.blocked_reason IS NULL OR trim(NEW.blocked_reason) = '' THEN
      RAISE EXCEPTION 'SSOT violation: status=blocked requires non-empty blocked_reason';
    END IF;
    IF NOT (NEW.blocked_reason = ANY(allowed_reasons) OR NEW.blocked_reason LIKE 'other:%') THEN
      RAISE EXCEPTION 'SSOT violation: blocked_reason "%" is not in the allowed taxonomy. Use one of: %, or prefix with "other:"', NEW.blocked_reason, array_to_string(allowed_reasons, ', ');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Reklassifikation
UPDATE public.course_packages
SET blocked_reason = 'admin_hold',
    unblock_hint = 'Historisch: nur rebuild-kurse aktiv – manuell freigeben'
WHERE status = 'blocked'
  AND blocked_reason = 'admin_hold: nur rebuild-kurse aktiv – manuell freigeben';

UPDATE public.course_packages
SET blocked_reason = 'intentional_pause',
    unblock_hint = 'Historisch: low priority, not scheduled for build'
WHERE status = 'blocked'
  AND blocked_reason = 'admin_hold: low priority, not scheduled for build';

-- 4. View neu erstellen (DROP + CREATE wegen Spaltenumbenennung)
DROP VIEW IF EXISTS public.ops_block_classification;
CREATE VIEW public.ops_block_classification AS
SELECT 
  cp.id AS package_id,
  c.title AS course_title,
  cp.status,
  cp.blocked_reason AS block_class,
  cp.blocked_by,
  cp.blocked_at,
  cp.resolution_owner,
  cp.review_due_at,
  cp.unblock_hint,
  cp.build_progress,
  (SELECT count(*) FROM public.job_queue jq 
   WHERE jq.package_id = cp.id 
   AND jq.status = 'pending') AS open_jobs
FROM public.course_packages cp
JOIN public.courses c ON c.id = cp.course_id
WHERE cp.status = 'blocked';
