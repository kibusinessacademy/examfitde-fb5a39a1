
-- ============================================================
-- SSOT: Current integrity report version as DB function
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_integrity_report_version_num()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT 16 $$;

-- ============================================================
-- Trigger: Block auto_publish on stale integrity report
-- ============================================================
CREATE OR REPLACE FUNCTION fn_invalidate_stale_integrity_on_publish_attempt()
RETURNS trigger AS $$
DECLARE
  v_current_version int;
BEGIN
  v_current_version := public.current_integrity_report_version_num();
  
  IF NEW.step_key = 'auto_publish' AND NEW.status = 'running' THEN
    PERFORM 1
    FROM public.course_packages cp
    WHERE cp.id = NEW.package_id
      AND cp.integrity_report IS NOT NULL
      AND COALESCE(cp.integrity_report_version_num, 0) < v_current_version;
    
    IF FOUND THEN
      UPDATE public.course_packages
      SET integrity_passed = false,
          integrity_report_version_num = 0
      WHERE id = NEW.package_id;
      
      UPDATE public.package_steps
      SET status = 'queued',
          last_error = 'stale_report_version_' || v_current_version,
          updated_at = now()
      WHERE package_id = NEW.package_id
        AND step_key = 'run_integrity_check'
        AND status NOT IN ('running');
      
      NEW.status := 'queued';
      NEW.last_error := 'BLOCKED: stale integrity report requires re-check (version < ' || v_current_version || ')';
      RETURN NEW;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_publish_on_stale_integrity ON public.package_steps;
CREATE TRIGGER trg_block_publish_on_stale_integrity
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  WHEN (NEW.step_key = 'auto_publish' AND NEW.status = 'running')
  EXECUTE FUNCTION fn_invalidate_stale_integrity_on_publish_attempt();

-- ============================================================
-- Update mark_legacy_integrity_reports to use version_num
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_legacy_integrity_reports()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.course_packages
  SET integrity_report = jsonb_set(
    COALESCE(integrity_report, '{}'::jsonb),
    '{legacy_report}',
    'true'::jsonb,
    true
  )
  WHERE integrity_report IS NOT NULL
    AND (integrity_report->>'legacy_report') IS DISTINCT FROM 'true'
    AND COALESCE(integrity_report_version_num, 0) < current_integrity_report_version_num();
$function$;

-- ============================================================
-- Update enqueue_integrity_rechecks to use version_num SSOT
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_integrity_rechecks(
  p_cap integer DEFAULT 150,
  p_reason text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(10, LEAST(COALESCE(p_cap,150), 500));
  v_inserted int := 0;
  v_candidates int := 0;
  v_current_version int;
BEGIN
  v_current_version := current_integrity_report_version_num();

  WITH candidates AS (
    SELECT cp.id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE
      cp.status IN ('building', 'done', 'published', 'draft')
      AND (
        cp.integrity_report IS NULL
        OR COALESCE(cp.integrity_report_version_num, 0) < v_current_version
        OR (cp.status = 'quality_gate_failed' AND cp.track = 'EXAM_FIRST')
      )
    ORDER BY cp.updated_at DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (job_type, status, payload, package_id, worker_pool, priority, max_attempts)
    SELECT
      'package_run_integrity_check',
      'pending',
      jsonb_build_object(
        'packageId', c.id::text,
        'curriculum_id', c.curriculum_id::text,
        'reason', p_reason
      ),
      c.id,
      'core',
      70,
      3
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.job_queue jq
      WHERE jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending')
        AND jq.payload->>'packageId' = c.id::text
    )
    RETURNING 1
  )
  SELECT
    (SELECT COUNT(*) FROM candidates),
    (SELECT COUNT(*) FROM ins)
  INTO v_candidates, v_inserted;

  RETURN jsonb_build_object(
    'cap', v_cap,
    'candidates', v_candidates,
    'enqueued', v_inserted,
    'current_version', v_current_version
  );
END;
$function$;

-- ============================================================
-- DATA FIX: Reset 16 packages with stale reports (v14/v15)
-- ============================================================
UPDATE public.course_packages
SET integrity_passed = false,
    integrity_report_version_num = 0
WHERE integrity_report_version_num < 16
  AND integrity_report_version_num > 0
  AND status NOT IN ('archived', 'draft');

UPDATE public.package_steps
SET status = 'queued',
    last_error = 'stale_report_version_reset',
    updated_at = now()
WHERE step_key = 'run_integrity_check'
  AND status NOT IN ('running')
  AND package_id IN (
    SELECT id FROM public.course_packages
    WHERE integrity_report_version_num = 0
      AND integrity_report IS NOT NULL
      AND status NOT IN ('archived', 'draft')
  );
