
-- Extend post-condition guard to validate_exam_pool and auto_publish
CREATE OR REPLACE FUNCTION public.sync_step_on_job_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_step_key text;
  v_course_id uuid;
  v_placeholder int;
  v_too_short int;
  v_pkg_id uuid;
BEGIN
  IF NEW.status IN ('completed','failed','cancelled')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF NEW.status = 'completed' THEN

      -- Resolve step_key + package_id
      SELECT ps.step_key INTO v_step_key
      FROM public.package_steps ps
      WHERE ps.job_id = NEW.id
        AND ps.status::text IN ('enqueued','running')
      LIMIT 1;

      v_pkg_id := (NEW.payload->>'package_id')::uuid;

      -- ── Content Integrity Gate (blocks 3 steps) ──
      IF v_step_key IN ('generate_learning_content', 'validate_exam_pool', 'auto_publish') THEN
        SELECT cp.course_id INTO v_course_id
        FROM public.course_packages cp
        WHERE cp.id = v_pkg_id;

        IF v_course_id IS NOT NULL THEN
          SELECT placeholder_lessons, too_short_lessons
          INTO v_placeholder, v_too_short
          FROM public.v_course_content_integrity
          WHERE course_id = v_course_id;

          IF coalesce(v_placeholder, 0) > 0 OR coalesce(v_too_short, 0) > 0 THEN
            UPDATE public.package_steps
            SET status = 'queued',
                job_id = NULL,
                runner_id = NULL,
                started_at = NULL,
                finished_at = NULL,
                last_error = format(
                  'Integrity gate blocked %s: %s placeholder, %s too_short lessons',
                  v_step_key, coalesce(v_placeholder, 0), coalesce(v_too_short, 0)
                )
            WHERE job_id = NEW.id
              AND status::text IN ('enqueued','running');
            RETURN NEW;
          END IF;
        END IF;
      END IF;

      -- Normal completion
      UPDATE public.package_steps
      SET status = 'done',
          finished_at = now(),
          last_heartbeat_at = now()
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    ELSE
      -- failed/cancelled: reset to queued
      UPDATE public.package_steps
      SET status = 'queued',
          job_id = NULL,
          runner_id = NULL,
          started_at = NULL,
          finished_at = NULL,
          last_error = 'Job ' || NEW.status || ': ' || left(coalesce(NEW.last_error,'unknown'), 500)
      WHERE job_id = NEW.id
        AND status::text IN ('enqueued','running');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
