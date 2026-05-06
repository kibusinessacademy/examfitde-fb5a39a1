
-- ────────────────────────────────────────────────────────────────────
-- 1) BRONZE AUTO-LOCK on repeated QUALITY_THRESHOLD_NOT_MET (75–84)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_lock_bronze_on_quality_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score int;
  v_match text[];
  v_already_locked boolean;
BEGIN
  IF NEW.status = 'failed'
     AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'failed')
     AND NEW.job_type = 'package_run_integrity_check'
     AND NEW.package_id IS NOT NULL
     AND coalesce(NEW.last_error, NEW.error, '') ~ 'QUALITY_THRESHOLD_NOT_MET' THEN

    v_match := regexp_match(coalesce(NEW.last_error, NEW.error, ''), 'integrity_score=(\d+)');
    IF v_match IS NULL THEN
      RETURN NEW;
    END IF;
    v_score := v_match[1]::int;

    IF v_score BETWEEN 75 AND 84 THEN
      SELECT coalesce((feature_flags->'bronze'->>'locked')::boolean, false)
        INTO v_already_locked
        FROM public.course_packages
       WHERE id = NEW.package_id;

      IF NOT coalesce(v_already_locked, false) THEN
        UPDATE public.course_packages
           SET feature_flags = jsonb_set(
                 coalesce(feature_flags, '{}'::jsonb),
                 '{bronze}',
                 jsonb_build_object(
                   'locked', true,
                   'score', v_score,
                   'locked_at', now(),
                   'reason', 'auto_quality_threshold_repeat',
                   'source_job_id', NEW.id
                 ),
                 true)
         WHERE id = NEW.package_id;

        INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, result_detail, metadata)
        VALUES (
          NEW.package_id::text, 'package', 'bronze_auto_locked', 'success',
          format('Auto-locked bronze at score %s after QUALITY_THRESHOLD_NOT_MET', v_score),
          jsonb_build_object('score', v_score, 'job_id', NEW.id, 'job_type', NEW.job_type)
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Hot-path safety: nie den Update-Pfad killen
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_lock_bronze_on_quality_threshold ON public.job_queue;
CREATE TRIGGER trg_auto_lock_bronze_on_quality_threshold
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_lock_bronze_on_quality_threshold();

-- ────────────────────────────────────────────────────────────────────
-- 2) PHANTOM-GUARD: orphan_queued_heal darf nur building-Pakete enqueuen
--    (verhindert OPS_GUARD:NON_BUILDING_PACKAGE Phantom-Loop)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_orphan_heal_requires_building()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_status text;
  v_src text;
BEGIN
  v_src := NEW.payload->>'enqueue_source';
  IF v_src = 'orphan_queued_heal' AND NEW.package_id IS NOT NULL THEN
    SELECT status INTO v_pkg_status FROM public.course_packages WHERE id = NEW.package_id;
    IF v_pkg_status IS DISTINCT FROM 'building' THEN
      INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, result_detail, metadata)
      VALUES (
        NEW.package_id::text, 'package', 'orphan_heal_phantom_blocked', 'skipped',
        format('Blocked %s for package status=%s', NEW.job_type, coalesce(v_pkg_status,'<missing>')),
        jsonb_build_object('job_type', NEW.job_type, 'package_status', v_pkg_status, 'enqueue_source', v_src)
      );
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_orphan_heal_requires_building ON public.job_queue;
CREATE TRIGGER trg_guard_orphan_heal_requires_building
BEFORE INSERT ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_orphan_heal_requires_building();

-- ────────────────────────────────────────────────────────────────────
-- 3) MINICHECKS-REPAIR (per Paket + Batch) — nur für published mit lesson_count > 0
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_dispatch_lxi_minicheck_repair(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lesson_count int;
  v_minicheck_count int;
  v_status text;
  v_existing int;
  v_jobs_enqueued int := 0;
  v_jt text;
  v_correlation uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT v.lesson_count, v.minicheck_count, v.status
    INTO v_lesson_count, v_minicheck_count, v_status
    FROM public.v_learning_integrity_audit v
   WHERE v.package_id = p_package_id;

  IF v_lesson_count IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_in_audit');
  END IF;
  IF v_status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_published', 'status', v_status);
  END IF;
  IF v_lesson_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_lessons_to_attach_minichecks_to', 'lesson_count', 0);
  END IF;
  IF coalesce(v_minicheck_count,0) > 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'minichecks_already_present', 'minicheck_count', v_minicheck_count);
  END IF;

  -- Idempotenz: keine doppelten aktiven Jobs
  FOREACH v_jt IN ARRAY ARRAY['package_generate_lesson_minichecks','package_validate_lesson_minichecks']
  LOOP
    SELECT count(*) INTO v_existing
      FROM public.job_queue
     WHERE package_id = p_package_id
       AND job_type = v_jt
       AND status IN ('pending','queued','processing','running');
    IF v_existing > 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.job_queue(job_type, package_id, status, priority, payload, correlation_id, root_job_id)
    VALUES (
      v_jt,
      p_package_id,
      'pending',
      50,
      jsonb_build_object('enqueue_source', 'lxi_minicheck_repair', 'lxi_repair', true),
      v_correlation,
      v_correlation
    );
    v_jobs_enqueued := v_jobs_enqueued + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log(target_id, target_type, action_type, result_status, result_detail, metadata)
  VALUES (
    p_package_id::text, 'package', 'lxi_gate_no_minichecks_repair_dispatched',
    CASE WHEN v_jobs_enqueued > 0 THEN 'success' ELSE 'skipped' END,
    format('lessons=%s, minichecks_before=%s, jobs_enqueued=%s', v_lesson_count, v_minicheck_count, v_jobs_enqueued),
    jsonb_build_object(
      'lesson_count', v_lesson_count,
      'minicheck_count_before', v_minicheck_count,
      'jobs_enqueued', v_jobs_enqueued,
      'correlation_id', v_correlation
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'lesson_count', v_lesson_count,
    'minicheck_count_before', v_minicheck_count,
    'jobs_enqueued', v_jobs_enqueued,
    'correlation_id', v_correlation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_lxi_minicheck_repair(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_lxi_minicheck_repair(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_dispatch_lxi_minicheck_repair_batch(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_pkg IN
    SELECT v.package_id, v.title, v.lesson_count, v.minicheck_count
      FROM public.v_learning_integrity_audit v
     WHERE v.status = 'published'
       AND v.gate_no_minichecks = true
       AND v.lesson_count > 0
     ORDER BY v.learning_integrity_score NULLS FIRST, v.title
     LIMIT p_limit
  LOOP
    v_res := public.admin_dispatch_lxi_minicheck_repair(v_pkg.package_id);
    IF coalesce((v_res->>'ok')::boolean, false) AND (v_res->>'jobs_enqueued')::int > 0 THEN
      v_dispatched := v_dispatched + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg.package_id,
      'title', v_pkg.title,
      'result', v_res
    );
  END LOOP;

  INSERT INTO public.auto_heal_log(target_type, action_type, result_status, result_detail, metadata)
  VALUES (
    'system', 'lxi_minicheck_repair_batch', 'success',
    format('dispatched=%s skipped=%s', v_dispatched, v_skipped),
    jsonb_build_object('dispatched', v_dispatched, 'skipped', v_skipped, 'limit', p_limit)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_lxi_minicheck_repair_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_lxi_minicheck_repair_batch(int) TO authenticated;
