
-- 1) FANOUT CAP: Reduce from 10 to 3
CREATE OR REPLACE FUNCTION public.fn_enforce_global_fanout_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id text;
  _pending_count int;
  _cap int := 3;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  _pkg_id := NEW.payload->>'package_id';
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _pending_count
  FROM job_queue
  WHERE payload->>'package_id' = _pkg_id
    AND job_type = NEW.job_type
    AND status IN ('pending', 'processing')
    AND id <> NEW.id;

  IF _pending_count >= _cap THEN
    PERFORM public.fn_log_guardrail_event(
      'fanout_cap_blocked',
      jsonb_build_object(
        'package_id', _pkg_id,
        'job_type', NEW.job_type,
        'pending_count', _pending_count,
        'cap', _cap
      )
    );
    RETURN NULL;  -- Silent rejection instead of cancelled row
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) REDUNDANT SEEDING GUARD
CREATE OR REPLACE FUNCTION public.fn_guard_redundant_seeding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg_id uuid;
  _curriculum_id uuid;
  _bp_count int;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  
  IF NEW.job_type NOT IN ('package_auto_seed_exam_blueprints', 'package_generate_blueprint_variants') THEN
    RETURN NEW;
  END IF;

  _pkg_id := (NEW.payload->>'package_id')::uuid;
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id INTO _curriculum_id
  FROM course_packages cp WHERE cp.id = _pkg_id;
  
  IF _curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if blueprints already exist for this curriculum
  SELECT count(*) INTO _bp_count
  FROM question_blueprints qb
  WHERE qb.curriculum_id = _curriculum_id
    AND qb.status IN ('approved', 'review');

  IF _bp_count >= 10 THEN
    -- Already seeded — block redundant seeding job
    PERFORM public.fn_log_guardrail_event(
      'redundant_seeding_blocked',
      jsonb_build_object(
        'package_id', _pkg_id,
        'curriculum_id', _curriculum_id,
        'job_type', NEW.job_type,
        'existing_blueprints', _bp_count
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_redundant_seeding
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_redundant_seeding();

-- 3) BUDGET EXHAUSTED TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS public.ops_budget_exhausted_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  package_id uuid,
  runner text,
  reason text,
  meta jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_budget_exhausted_created ON ops_budget_exhausted_log(created_at DESC);
CREATE INDEX idx_budget_exhausted_job_type ON ops_budget_exhausted_log(job_type);

ALTER TABLE ops_budget_exhausted_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on budget_exhausted_log"
  ON ops_budget_exhausted_log
  FOR ALL
  USING (true)
  WITH CHECK (true);
