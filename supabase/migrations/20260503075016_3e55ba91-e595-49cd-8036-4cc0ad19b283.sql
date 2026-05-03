
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease_v2(p_runner_id text, p_track text DEFAULT NULL::text, p_lease_seconds integer DEFAULT 600)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_package_id uuid;
  v_max_slots int;
  v_active_leases int;
  v_wip_limit int;
  v_building_count_global int;
  v_rebuild_count int;
  v_effective_wip int;
  v_raw_val text;
  v_min_incomplete_priority int;
  v_allowed_priority int;
  v_unblocked int;
  v_orphan_reclaimed int;
  v_orphan_protected_skipped int;
  v_bonus_slots int;
  v_bonus_threshold int;
  v_bonus_eligible int;
BEGIN
  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'max_concurrent_packages';
    v_max_slots := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_max_slots := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_limit';
    v_wip_limit := nullif(v_raw_val, '')::int;
  EXCEPTION WHEN OTHERS THEN v_wip_limit := NULL; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_bonus_slots';
    v_bonus_slots := COALESCE(nullif(v_raw_val, '')::int, 4);
  EXCEPTION WHEN OTHERS THEN v_bonus_slots := 4; END;

  BEGIN
    SELECT value#>>'{}' INTO v_raw_val FROM public.ops_pipeline_config WHERE key = 'wip_bonus_progress_threshold';
    v_bonus_threshold := COALESCE(nullif(v_raw_val, '')::int, 50);
  EXCEPTION WHEN OTHERS THEN v_bonus_threshold := 50; END;

  v_max_slots := COALESCE(v_max_slots, 3);
  v_wip_limit := COALESCE(v_wip_limit, 1);

  DELETE FROM public.package_leases WHERE lease_until < now();

  SELECT count(*) INTO v_active_leases FROM public.package_leases WHERE lease_until > now();
  IF v_active_leases >= v_max_slots THEN RETURN NULL; END IF;

  -- ORPHAN RECLAIM (Protection-aware)
  -- Skip Pakete, die durch fn_package_demote_protected geschützt sind:
  -- approved questions + complete progress + keine offenen Tail-Jobs.
  -- SAFE_PACKAGE_STATUS_DEMOTE: orphan reclaim nur für tatsächlich tote building-Pakete.
  WITH candidates AS (
    SELECT cp.id
    FROM public.course_packages cp
    WHERE cp.status = 'building'
      AND (p_track IS NULL OR cp.track::text = p_track)
      AND NOT EXISTS (SELECT 1 FROM public.package_leases pl WHERE pl.package_id = cp.id)
      AND NOT EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending','processing'))
      AND NOT EXISTS (SELECT 1 FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status IN ('running','enqueued','queued'))
  ),
  filtered AS (
    SELECT c.id,
           (public.fn_package_demote_protected(c.id)->>'protected')::boolean AS is_protected
    FROM candidates c
  ),
  to_reclaim AS (
    SELECT id FROM filtered WHERE is_protected = false
  ),
  protected_skipped AS (
    SELECT count(*)::int AS n FROM filtered WHERE is_protected = true
  ),
  did_update AS (
    UPDATE public.course_packages cp
       SET status = 'queued', updated_at = now()
     WHERE cp.id IN (SELECT id FROM to_reclaim)
    RETURNING cp.id
  )
  SELECT
    (SELECT count(*) FROM did_update),
    (SELECT n FROM protected_skipped)
  INTO v_orphan_reclaimed, v_orphan_protected_skipped;

  IF COALESCE(v_orphan_protected_skipped, 0) > 0 THEN
    BEGIN
      INSERT INTO public.auto_heal_log
        (trigger_source, action_type, target_type, result_status, result_detail, metadata)
      VALUES (
        'acquire_v2', 'orphan_reclaim_protected_skip', 'system', 'skipped',
        format('Skipped %s protected packages from orphan reclaim (loop-killer)', v_orphan_protected_skipped),
        jsonb_build_object('skipped', v_orphan_protected_skipped, 'runner_id', p_runner_id, 'track', p_track)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF COALESCE(v_orphan_reclaimed, 0) > 0 THEN
    RAISE LOG '[acquire_v2] Reclaimed % true orphan building packages (protected skipped: %)',
              v_orphan_reclaimed, COALESCE(v_orphan_protected_skipped, 0);
  END IF;

  SELECT count(*) INTO v_rebuild_count FROM public.course_packages WHERE status = 'building' AND is_rebuild = true;
  SELECT count(*) INTO v_building_count_global FROM public.course_packages WHERE status = 'building';

  SELECT count(*) INTO v_bonus_eligible FROM public.course_packages
   WHERE status = 'building' AND build_progress >= v_bonus_threshold;

  v_effective_wip := v_wip_limit + v_rebuild_count + LEAST(v_bonus_eligible, v_bonus_slots);

  IF v_building_count_global >= v_effective_wip THEN
    BEGIN
      INSERT INTO auto_heal_log (trigger_source, action_type, result_status, result_detail, metadata)
      VALUES ('acquire_v2', 'wip_admission_blocked', 'blocked',
        format('Global WIP %s >= cap %s (base=%s, bonus=%s). Runner=%s, track=%s',
          v_building_count_global, v_effective_wip, v_wip_limit, LEAST(v_bonus_eligible, v_bonus_slots), p_runner_id, COALESCE(p_track, 'any')),
        jsonb_build_object('building_count', v_building_count_global, 'effective_wip', v_effective_wip,
          'bonus_eligible', v_bonus_eligible, 'runner_id', p_runner_id, 'track', p_track));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN NULL;
  END IF;

  WITH to_unblock AS (
    SELECT id FROM public.course_packages
    WHERE status = 'blocked'
      AND (p_track IS NULL OR track::text = p_track)
      AND (blocked_reason IS NULL OR blocked_reason = '')
    LIMIT 5
  )
  UPDATE public.course_packages SET status = 'queued', blocked_reason = NULL, updated_at = now()
  WHERE id IN (SELECT id FROM to_unblock);

  -- Promote next queued → building (mit transition_source-Marker für Audit)
  PERFORM set_config('app.transition_source', 'acquire_next_package_lease_v2', true);

  SELECT cp.id INTO v_package_id
  FROM public.course_packages cp
  WHERE cp.status = 'queued'
    AND (p_track IS NULL OR cp.track::text = p_track)
  ORDER BY COALESCE(cp.priority, 100) ASC, cp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_package_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.course_packages
     SET status = 'building', updated_at = now()
   WHERE id = v_package_id;

  INSERT INTO public.package_leases (package_id, runner_id, lease_until)
  VALUES (v_package_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = EXCLUDED.runner_id, lease_until = EXCLUDED.lease_until;

  RETURN v_package_id;
END;
$function$;

-- Drilldown-View für UI: letzte 20min Producer mit Paket-Details + Protection-State
CREATE OR REPLACE VIEW public.v_admin_revert_producer_drilldown AS
WITH recent_alerts AS (
  SELECT
    ahl.created_at AS alert_at,
    prod.value AS producer
  FROM public.auto_heal_log ahl,
  LATERAL jsonb_array_elements(COALESCE(ahl.metadata->'producers', '[]'::jsonb)) AS prod(value)
  WHERE ahl.action_type = 'remaining_producer_alert'
    AND ahl.created_at > now() - interval '20 minutes'
),
flat AS (
  SELECT
    alert_at,
    (producer->>'target_id')::uuid AS package_id,
    producer->>'last_seen' AS last_seen,
    (producer->>'n')::int AS n,
    (producer->'apps') AS apps,
    (producer->'users') AS users,
    (producer->'client_addrs') AS client_addrs
  FROM recent_alerts
),
latest_per_pkg AS (
  SELECT DISTINCT ON (package_id)
    package_id, alert_at, last_seen, n, apps, users, client_addrs
  FROM flat
  ORDER BY package_id, alert_at DESC
),
recent_block AS (
  SELECT DISTINCT ON (target_id)
    target_id::uuid AS package_id,
    created_at AS last_block_at,
    metadata->'protection' AS protection,
    metadata->>'caller_query' AS caller_query,
    metadata->>'application_name' AS application_name,
    metadata->>'usename' AS usename,
    metadata->>'client_addr' AS client_addr
  FROM public.auto_heal_log
  WHERE action_type = 'guard_block_building_revert'
    AND created_at > now() - interval '20 minutes'
  ORDER BY target_id, created_at DESC
)
SELECT
  l.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  cp.build_progress,
  l.alert_at,
  l.last_seen,
  l.n AS event_count,
  l.apps,
  l.users,
  l.client_addrs,
  rb.last_block_at,
  rb.protection->>'reason' AS protection_reason,
  (rb.protection->>'approved_questions')::int AS approved_questions,
  (rb.protection->>'pending_tail_jobs')::int AS pending_tail_jobs,
  rb.application_name,
  rb.usename,
  rb.client_addr,
  rb.caller_query
FROM latest_per_pkg l
LEFT JOIN public.course_packages cp ON cp.id = l.package_id
LEFT JOIN recent_block rb ON rb.package_id = l.package_id
ORDER BY l.alert_at DESC, l.n DESC;

REVOKE ALL ON public.v_admin_revert_producer_drilldown FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_revert_producer_drilldown TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_revert_producer_drilldown()
RETURNS SETOF public.v_admin_revert_producer_drilldown
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT * FROM public.v_admin_revert_producer_drilldown;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_revert_producer_drilldown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_revert_producer_drilldown() TO authenticated;
