-- Enforces per-wave concurrency by only allowing up to max_concurrent
-- packages in active factory states for a given wave.

CREATE OR REPLACE FUNCTION public.enforce_wave_backpressure(p_wave_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave record;
  v_active_count int := 0;
  v_open_slots int := 0;
  v_promoted int := 0;
  v_queued_count int := 0;
BEGIN
  SELECT id, name, status, max_concurrent
  INTO v_wave
  FROM public.production_waves
  WHERE id = p_wave_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'wave_not_found',
      'wave_id', p_wave_id
    );
  END IF;

  IF v_wave.status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wave_id', p_wave_id,
      'wave_status', v_wave.status,
      'note', 'wave_not_active',
      'promoted', 0
    );
  END IF;

  -- Count currently active packages in this wave
  SELECT count(*)
  INTO v_active_count
  FROM public.production_wave_items wi
  JOIN public.course_packages cp ON cp.id = wi.package_id
  WHERE wi.wave_id = p_wave_id
    AND wi.status IN ('queued', 'building')
    AND cp.status IN ('queued', 'building');

  v_open_slots := GREATEST(COALESCE(v_wave.max_concurrent, 0) - v_active_count, 0);

  -- Count waiting wave items
  SELECT count(*)
  INTO v_queued_count
  FROM public.production_wave_items wi
  WHERE wi.wave_id = p_wave_id
    AND wi.status = 'pending';

  IF v_open_slots <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wave_id', p_wave_id,
      'wave_status', v_wave.status,
      'max_concurrent', v_wave.max_concurrent,
      'active_count', v_active_count,
      'open_slots', 0,
      'queued_items', v_queued_count,
      'promoted', 0
    );
  END IF;

  WITH next_items AS (
    SELECT wi.id, wi.package_id
    FROM public.production_wave_items wi
    WHERE wi.wave_id = p_wave_id
      AND wi.status = 'pending'
      AND wi.package_id IS NOT NULL
    ORDER BY wi.priority DESC, wi.created_at ASC
    LIMIT v_open_slots
  ),
  upd_packages AS (
    UPDATE public.course_packages cp
    SET
      status = 'queued',
      priority = GREATEST(COALESCE(cp.priority, 0), 8),
      updated_at = now()
    FROM next_items ni
    WHERE cp.id = ni.package_id
      AND cp.status IN ('planning', 'draft', 'queued')
    RETURNING cp.id
  ),
  upd_items AS (
    UPDATE public.production_wave_items wi
    SET
      status = 'queued',
      started_at = COALESCE(wi.started_at, now()),
      updated_at = now()
    FROM next_items ni
    WHERE wi.id = ni.id
    RETURNING wi.id
  )
  SELECT count(*) INTO v_promoted FROM upd_items;

  RETURN jsonb_build_object(
    'ok', true,
    'wave_id', p_wave_id,
    'wave_status', v_wave.status,
    'max_concurrent', v_wave.max_concurrent,
    'active_count', v_active_count,
    'open_slots', v_open_slots,
    'queued_items', v_queued_count,
    'promoted', v_promoted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enforce_wave_backpressure(uuid) TO service_role;