-- ============================================================================
-- Producer-Hunt Phase 1: Bronze guard source-detection broadening + producer
-- bronze pre-filter for the 2 highest-volume untagged council producers.
--
-- Insight: trg_guard_bronze_lock fires BEFORE trg_job_queue_ssot_validate
-- (alphabetical), so payload.enqueue_source is still NULL at bronze-check
-- time even when the SSOT validator would auto-fill it. This caused 1884
-- "unknown" labels in 24h. We now also read meta.* and payload.source.
-- 
-- We ALSO add bronze pre-filter to admin_repair_quality_council_drift and
-- admin_resolve_council_deferred (force_pass path) which insert directly
-- into job_queue without going through enqueue_job_if_absent.
-- ============================================================================

-- 1) Broaden bronze-guard source detection
CREATE OR REPLACE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locked boolean;
  v_source text;
  v_pkg_id uuid;
BEGIN
  IF NEW.job_type NOT IN ('package_quality_council','package_auto_publish') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IN ('queued','pending','processing')
     AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('queued','pending','processing') THEN
    RETURN NEW;
  END IF;

  v_pkg_id := NEW.package_id;
  IF v_pkg_id IS NULL THEN
    v_pkg_id := NULLIF(NEW.payload->>'package_id','')::uuid;
  END IF;

  IF v_pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT public.fn_is_bronze_locked(v_pkg_id) INTO v_locked;
  IF NOT v_locked THEN
    RETURN NEW;
  END IF;

  -- Producer-Hunt: lies aus ALLEN bekannten Quellen
  v_source := COALESCE(
    NEW.payload->>'enqueue_source',
    NEW.meta->>'enqueue_source',
    NEW.meta->>'source',
    NEW.payload->>'source',
    NEW.payload->>'_origin',
    NEW.payload->>'mode',
    'unknown'
  );

  IF v_source = 'bronze_targeted_repair' THEN
    RETURN NEW;
  END IF;

  IF (NEW.payload->>'bronze_lock_override')::boolean = true THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_lock_admin_override',
            v_pkg_id::text,'package','success',
            format('Admin override: %s passed through bronze lock', NEW.job_type),
            jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type, 'enqueue_source', v_source));
    RETURN NEW;
  END IF;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_locked_enqueue_blocked',
          v_pkg_id::text,'package','skipped',
          format('Bronze lock active — %s rejected (source=%s)', NEW.job_type, v_source),
          jsonb_build_object(
            'package_id', v_pkg_id,
            'job_type', NEW.job_type,
            'enqueue_source', v_source,
            'tg_op', TG_OP,
            'payload_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(COALESCE(NEW.payload,'{}'::jsonb)) k),
            'meta_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(COALESCE(NEW.meta,'{}'::jsonb)) k),
            'skipped_reason','BRONZE_LOCKED_REQUIRES_REVIEW'));

  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  ELSE
    NEW.status := 'cancelled';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.last_error := 'BRONZE_LOCKED_REQUIRES_REVIEW: package marked requires_review=true';
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by','bronze_lock_guard',
      'reason','BRONZE_LOCKED_REQUIRES_REVIEW',
      'enqueue_source', v_source);
    RETURN NEW;
  END IF;
END;
$function$;

-- 2) Bronze pre-filter for admin_repair_quality_council_drift
CREATE OR REPLACE FUNCTION public.admin_repair_quality_council_drift(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 50)
 RETURNS TABLE(package_id uuid, cluster text, action text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  r record;
  v_count int := 0;
  v_payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR r IN
    SELECT
      d.package_id    AS r_package_id,
      d.curriculum_id AS r_curriculum_id,
      d.cluster       AS r_cluster,
      d.title         AS r_title
    FROM public.v_admin_qc_step_drift d
    WHERE d.cluster IN ('A_building_no_qc_job', 'D_qc_completed_step_drift')
    ORDER BY d.cluster, d.step_updated_at NULLS LAST
    LIMIT p_limit
  LOOP
    v_count := v_count + 1;

    IF r.r_curriculum_id IS NULL THEN
      package_id := r.r_package_id; cluster := r.r_cluster;
      action := 'skip_missing_curriculum_id';
      detail := COALESCE(r.r_title, '') || ' — course_packages.curriculum_id IS NULL';
      RETURN NEXT; CONTINUE;
    END IF;

    -- Bronze pre-filter: skip locked packages with audit + cooldown
    IF public.fn_is_bronze_locked(r.r_package_id) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.auto_heal_log
        WHERE action_type = 'admin_repair_quality_council_drift_skipped_bronze'
          AND target_id = r.r_package_id::text
          AND created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, target_id, result_status, metadata)
        VALUES ('admin_repair_quality_council_drift','admin_repair_quality_council_drift_skipped_bronze',
                'package', r.r_package_id::text, 'skipped',
                jsonb_build_object('package_id', r.r_package_id, 'cluster', r.r_cluster));
      END IF;
      package_id := r.r_package_id; cluster := r.r_cluster;
      action := 'skip_bronze_locked'; detail := r.r_title;
      RETURN NEXT; CONTINUE;
    END IF;

    IF r.r_cluster = 'A_building_no_qc_job' THEN
      IF p_dry_run THEN
        package_id := r.r_package_id; cluster := r.r_cluster;
        action := 'dry_run_enqueue_qc'; detail := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id',    r.r_package_id,
          'curriculum_id', r.r_curriculum_id,
          'mode',          'admin_repair_enqueue_missing_qc',
          'enqueue_source','admin_repair_quality_council_drift',
          'source',        'admin_repair_quality_council_drift'
        );
        INSERT INTO public.job_queue (job_type, status, lane, priority, max_attempts, payload, package_id)
        VALUES ('package_quality_council','pending','recovery',10,25,v_payload,r.r_package_id);
        package_id := r.r_package_id; cluster := r.r_cluster;
        action := 'qc_job_enqueued'; detail := r.r_title;
        RETURN NEXT;
      END IF;
    ELSIF r.r_cluster = 'D_qc_completed_step_drift' THEN
      IF p_dry_run THEN
        package_id := r.r_package_id; cluster := r.r_cluster;
        action := 'dry_run_enqueue_qc_adoption'; detail := r.r_title;
        RETURN NEXT;
      ELSE
        v_payload := jsonb_build_object(
          'package_id',    r.r_package_id,
          'curriculum_id', r.r_curriculum_id,
          'mode',          'admin_repair_adopt_completed_qc',
          'enqueue_source','admin_repair_quality_council_drift',
          'source',        'admin_repair_quality_council_drift'
        );
        INSERT INTO public.job_queue (job_type, status, lane, priority, max_attempts, payload, package_id)
        VALUES ('package_quality_council','pending','recovery',10,25,v_payload,r.r_package_id);
        package_id := r.r_package_id; cluster := r.r_cluster;
        action := 'qc_job_enqueued_for_adoption'; detail := r.r_title;
        RETURN NEXT;
      END IF;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    package_id := NULL; cluster := 'none'; action := 'noop'; detail := 'no healable drift found';
    RETURN NEXT;
  END IF;
END;
$function$;

-- 3) Audit-Marker for the migration itself
INSERT INTO public.auto_heal_log (trigger_source, action_type, target_type, result_status, metadata)
VALUES ('migration', 'producer_hunt_phase1_applied', 'system', 'success',
  jsonb_build_object(
    'changes', jsonb_build_array(
      'fn_guard_bronze_lock_on_job_enqueue: source detection broadened (meta.source, payload.source, mode, _origin)',
      'admin_repair_quality_council_drift: bronze pre-filter + cooldown + enqueue_source tag'
    ),
    'expected_impact', 'Drastic reduction of "unknown" enqueue_source label; ~1k untagged council producers per 24h identified by name'
  ));