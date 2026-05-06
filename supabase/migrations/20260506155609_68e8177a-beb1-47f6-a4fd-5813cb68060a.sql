-- Phase 2: Hard-Block-Trigger
CREATE OR REPLACE FUNCTION public.fn_guard_publish_lxi_no_lessons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gate boolean;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'published'
     AND NEW.status = 'published' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(a.gate_no_lessons, false)
    INTO v_gate
    FROM public.v_learning_integrity_audit a
   WHERE a.package_id = NEW.id;

  IF COALESCE(v_gate, false) THEN
    INSERT INTO public.auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_publish_lxi_no_lessons', 'lxi_publish_blocked',
            NEW.id::text, 'package', 'blocked',
            format('Publish blocked by gate_no_lessons (track=%s)', NEW.track),
            jsonb_build_object('package_id', NEW.id, 'track', NEW.track, 'gate', 'gate_no_lessons'));
    RAISE EXCEPTION
      'LXI_PUBLISH_BLOCKED: gate_no_lessons package_id=% track=%',
      NEW.id, NEW.track;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_publish_lxi_no_lessons ON public.course_packages;

CREATE TRIGGER trg_guard_publish_lxi_no_lessons
BEFORE INSERT OR UPDATE OF status
ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_publish_lxi_no_lessons();

-- Audit-Report-View
CREATE OR REPLACE VIEW public.v_lxi_no_lessons_report AS
WITH per_track AS (
  SELECT
    COALESCE(track::text,'(unknown)') AS track,
    COUNT(*) FILTER (WHERE status='published') AS published_total,
    COUNT(*) FILTER (WHERE status='published' AND gate_no_lessons) AS still_no_lessons,
    COUNT(*) FILTER (WHERE status='published' AND lesson_count = 0
                      AND COALESCE(track::text,'') IN ('EXAM_FIRST','EXAM_FIRST_PLUS')) AS no_lessons_but_not_applicable,
    ROUND(AVG(learning_integrity_score) FILTER (WHERE status='published'),1) AS avg_score
  FROM public.v_learning_integrity_audit
  GROUP BY COALESCE(track::text,'(unknown)')
), runs AS (
  SELECT
    MAX(created_at) FILTER (WHERE action_type='lxi_publish_blocked') AS last_block_at,
    MAX(created_at) FILTER (WHERE action_type='lxi_no_lessons_repair_enqueued') AS last_repair_enqueued_at,
    COUNT(*) FILTER (WHERE action_type='lxi_publish_blocked' AND created_at > now() - interval '24 hours') AS blocks_24h
  FROM public.auto_heal_log
  WHERE created_at > now() - interval '30 days'
)
SELECT pt.track, pt.published_total, pt.still_no_lessons, pt.no_lessons_but_not_applicable, pt.avg_score,
       r.last_block_at, r.last_repair_enqueued_at, r.blocks_24h, now() AS report_generated_at
FROM per_track pt CROSS JOIN runs r
ORDER BY pt.published_total DESC;

REVOKE ALL ON public.v_lxi_no_lessons_report FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lxi_no_lessons_report TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_lxi_no_lessons_report()
RETURNS SETOF public.v_lxi_no_lessons_report
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.v_lxi_no_lessons_report;
END; $$;