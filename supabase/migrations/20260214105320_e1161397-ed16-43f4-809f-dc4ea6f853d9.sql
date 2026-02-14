
-- 1) ops_alerts table for centralized alerting
CREATE TABLE IF NOT EXISTS public.ops_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL DEFAULT 'error',
  source text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz
);

ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ops_alerts"
  ON public.ops_alerts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Service role can insert ops_alerts"
  ON public.ops_alerts FOR INSERT
  WITH CHECK (true);

-- 2) Add blocked_reason and last_error to course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS last_error text;

-- 3) Atomic claim RPC using FOR UPDATE SKIP LOCKED with per-package curriculum check
CREATE OR REPLACE FUNCTION public.claim_next_queued_package()
RETURNS TABLE(
  package_id uuid,
  course_id uuid,
  curriculum_id uuid,
  certification_id uuid,
  track text,
  feature_flags jsonb,
  queue_position int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_curriculum_status text;
  v_curriculum_id uuid;
BEGIN
  -- Loop through queued packages in FIFO order, skip locked rows
  FOR v_pkg IN
    SELECT cp.id, cp.course_id, cp.certification_id, cp.track, cp.feature_flags, cp.queue_position, cp.curriculum_id AS pkg_curriculum_id
    FROM course_packages cp
    WHERE cp.status = 'queued'
    ORDER BY cp.queue_position ASC NULLS LAST, cp.created_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Resolve curriculum_id (package-level or course-level)
    v_curriculum_id := v_pkg.pkg_curriculum_id;
    IF v_curriculum_id IS NULL THEN
      SELECT c.curriculum_id INTO v_curriculum_id
      FROM courses c WHERE c.id = v_pkg.course_id;
    END IF;

    -- Per-package freeze check
    IF v_curriculum_id IS NULL THEN
      UPDATE course_packages SET blocked_reason = 'no_curriculum_id', last_error = 'Missing curriculum reference' WHERE id = v_pkg.id;
      CONTINUE;
    END IF;

    SELECT cur.status INTO v_curriculum_status
    FROM curricula cur WHERE cur.id = v_curriculum_id;

    IF v_curriculum_status IS NULL THEN
      UPDATE course_packages SET blocked_reason = 'curriculum_not_found', last_error = 'Curriculum ' || v_curriculum_id || ' does not exist' WHERE id = v_pkg.id;
      CONTINUE;
    END IF;

    IF v_curriculum_status <> 'frozen' THEN
      UPDATE course_packages SET blocked_reason = 'curriculum_not_frozen', last_error = 'Curriculum status: ' || v_curriculum_status WHERE id = v_pkg.id;
      CONTINUE;
    END IF;

    -- This package is buildable: claim it
    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        last_error = NULL,
        build_progress = 1,
        council_approved = true,
        council_approved_at = now(),
        updated_at = now()
    WHERE id = v_pkg.id;

    -- Return the claimed package
    package_id := v_pkg.id;
    course_id := v_pkg.course_id;
    curriculum_id := v_curriculum_id;
    certification_id := v_pkg.certification_id;
    track := v_pkg.track;
    feature_flags := v_pkg.feature_flags;
    queue_position := v_pkg.queue_position;
    RETURN NEXT;
    RETURN;  -- Only claim ONE package
  END LOOP;

  -- No buildable package found
  RETURN;
END;
$$;
