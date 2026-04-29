-- ============================================================
-- Idle-Building Detection & Auto-Heal
-- ============================================================
-- Erkennt building-Pakete ohne aktive Jobs (verbrennen WIP-Slots ohne Output)
-- und nudged ihren ältesten offenen Step, damit die Pipeline neu greift.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) Detection-View
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_idle_building_packages AS
SELECT 
  cp.id AS package_id,
  cp.title,
  cp.curriculum_id,
  cp.is_repair,
  cp.last_progress_at,
  EXTRACT(EPOCH FROM (now() - cp.last_progress_at))/3600 AS hours_idle,
  cp.priority,
  -- Erster offener Step (für Nudge)
  (SELECT ps.step_key 
   FROM package_steps ps 
   WHERE ps.package_id = cp.id 
     AND ps.status IN ('queued'::step_status,'failed'::step_status,'blocked'::step_status,'timeout'::step_status)
   ORDER BY ps.created_at ASC LIMIT 1) AS next_open_step,
  (SELECT ps.status::text 
   FROM package_steps ps 
   WHERE ps.package_id = cp.id 
     AND ps.status IN ('queued'::step_status,'failed'::step_status,'blocked'::step_status,'timeout'::step_status)
   ORDER BY ps.created_at ASC LIMIT 1) AS next_open_step_status,
  -- Zähler
  (SELECT COUNT(*) FROM package_steps WHERE package_id = cp.id AND status = 'done'::step_status) AS done_steps,
  (SELECT COUNT(*) FROM package_steps WHERE package_id = cp.id) AS total_steps
FROM public.course_packages cp
WHERE cp.status = 'building'
  AND cp.archived IS NOT TRUE
  -- KEIN aktiver Job
  AND NOT EXISTS (
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = cp.id
      AND jq.status IN ('processing','pending','queued','retry_scheduled','batch_pending')
  )
  -- Recent-Cooldown respektieren (5 min nach last_progress_at)
  AND cp.last_progress_at < now() - interval '5 minutes';

COMMENT ON VIEW public.v_idle_building_packages IS
  'Building-Pakete ohne aktive Jobs (>5min idle). Verbrennen WIP-Slots ohne Pipeline-Output.';

-- ─────────────────────────────────────────────────────────────
-- 2) Heal-RPC
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_heal_idle_building_packages(
  p_dry_run boolean DEFAULT true,
  p_threshold_hours numeric DEFAULT 6,
  p_max integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_processed int := 0;
  v_nudged int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_skip_reason text;
  v_step_id uuid;
BEGIN
  -- Auth-Gate (erlaubt SECURITY DEFINER für Cron via service_role)
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  FOR v_pkg IN
    SELECT v.package_id, v.title, v.hours_idle, v.next_open_step, v.next_open_step_status, v.is_repair
    FROM public.v_idle_building_packages v
    WHERE v.hours_idle >= p_threshold_hours
    ORDER BY v.hours_idle DESC
    LIMIT p_max
  LOOP
    v_processed := v_processed + 1;
    v_skip_reason := NULL;
    v_step_id := NULL;

    IF v_pkg.next_open_step IS NULL THEN
      v_skip_reason := 'skip_no_open_step';
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT id INTO v_step_id
      FROM public.package_steps
      WHERE package_id = v_pkg.package_id AND step_key = v_pkg.next_open_step
      LIMIT 1;
      IF v_step_id IS NULL THEN
        v_skip_reason := 'skip_step_id_not_found';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'title', v_pkg.title,
        'hours_idle', ROUND(v_pkg.hours_idle::numeric, 1),
        'status', 'skipped',
        'reason', v_skip_reason
      );
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      -- Nudge: reset attempts + last_error + meta-marker
      UPDATE public.package_steps
      SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'reset_reason', 'idle_building_auto_heal',
            'nudged_at', now()::text,
            'hours_idle_at_heal', ROUND(v_pkg.hours_idle::numeric, 1)
          ),
          attempts = 0,
          last_error = NULL,
          updated_at = now()
      WHERE id = v_step_id;

      -- Touch package timestamp damit nicht sofort wieder als idle erkannt
      UPDATE public.course_packages
      SET last_progress_at = now()
      WHERE id = v_pkg.package_id;

      v_nudged := v_nudged + 1;

      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'idle_building_auto_heal',
        'admin_heal_idle_building_packages',
        'package',
        v_pkg.package_id::text,
        'nudged',
        format('Idle %sh — nudged step %s', ROUND(v_pkg.hours_idle::numeric, 1), v_pkg.next_open_step),
        jsonb_build_object(
          'package_id', v_pkg.package_id,
          'title', v_pkg.title,
          'step_key', v_pkg.next_open_step,
          'step_id', v_step_id,
          'hours_idle', ROUND(v_pkg.hours_idle::numeric, 1),
          'is_repair', v_pkg.is_repair,
          'threshold_hours', p_threshold_hours
        )
      );
    END IF;

    v_results := v_results || jsonb_build_object(
      'package_id', v_pkg.package_id,
      'title', v_pkg.title,
      'hours_idle', ROUND(v_pkg.hours_idle::numeric, 1),
      'step_key', v_pkg.next_open_step,
      'step_status', v_pkg.next_open_step_status,
      'status', CASE WHEN p_dry_run THEN 'would_nudge' ELSE 'nudged' END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'threshold_hours', p_threshold_hours,
    'max', p_max,
    'processed', v_processed,
    'nudged', v_nudged,
    'skipped', v_skipped,
    'results', v_results,
    'ran_at', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_heal_idle_building_packages(boolean, numeric, integer) IS
  'Findet building-Pakete ohne aktive Jobs (>threshold_hours idle) und nudged deren ältesten offenen Step. Dry-Run-fähig. Audit via auto_heal_log.';

-- Permissions: admin + service_role (für Cron)
REVOKE ALL ON FUNCTION public.admin_heal_idle_building_packages(boolean, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_heal_idle_building_packages(boolean, numeric, integer) TO authenticated, service_role;