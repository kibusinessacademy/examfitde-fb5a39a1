
-- 1. Register system job types in policy table
INSERT INTO job_type_policies (job_type, worker_pool, is_repair, exempt_from_auto_cancel, can_run_when_not_building)
VALUES 
  ('pipeline_tick', 'default', false, true, true),
  ('stuck_scan', 'default', false, true, true)
ON CONFLICT (job_type) DO NOTHING;

-- 2. Exempt system jobs from curriculum_id requirement
CREATE OR REPLACE FUNCTION guard_job_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- System-level jobs are exempt from curriculum_id requirement
  IF NEW.job_type IN ('pipeline_tick', 'stuck_scan') THEN
    RETURN NEW;
  END IF;

  -- Prüfe curriculum_id
  IF NOT (NEW.payload ? 'curriculum_id') THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: job % missing curriculum_id',
      NEW.job_type;
  END IF;

  -- Prüfe verbotene Slug-Felder
  IF NEW.payload ? 'slug'
     OR NEW.payload ? 'profession_slug'
     OR NEW.payload ? 'curriculum_slug'
     OR NEW.payload ? 'curriculumCode'
  THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: slug-based fields are forbidden in job payload (%).',
      NEW.job_type;
  END IF;

  RETURN NEW;
END;
$$;
