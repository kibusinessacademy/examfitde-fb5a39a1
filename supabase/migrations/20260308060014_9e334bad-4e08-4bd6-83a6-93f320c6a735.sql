
CREATE OR REPLACE FUNCTION public.get_wave_triage_items(
  p_wave_id uuid,
  p_status_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      wi.id AS wave_item_id,
      wi.wave_id,
      wi.status AS wave_item_status,
      wi.priority,
      wi.curriculum_id,
      cur.title AS curriculum_title,
      wi.package_id,
      cp.title AS package_title,
      cp.status AS package_status,
      cp.build_progress,
      wi.last_error,
      wi.started_at,
      wi.finished_at,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'step_key', ps.step_key,
            'status', ps.status,
            'last_error', ps.last_error
          )
        ), '[]'::jsonb)
        FROM public.package_steps ps
        WHERE ps.package_id = wi.package_id
          AND ps.status = 'failed'
      ) AS failed_steps,
      (
        SELECT count(*)
        FROM public.job_queue jq
        WHERE jq.package_id = wi.package_id
          AND jq.status IN ('pending','queued','processing')
      ) AS open_jobs,
      (
        SELECT count(*)
        FROM public.job_queue jq
        WHERE jq.package_id = wi.package_id
          AND jq.status = 'failed'
      ) AS failed_jobs,
      (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'job_type', jq.job_type,
            'status', jq.status,
            'attempts', jq.attempts,
            'last_error', left(jq.last_error, 300)
          )
        ), '[]'::jsonb)
        FROM (
          SELECT jq2.job_type, jq2.status, jq2.attempts, jq2.last_error
          FROM public.job_queue jq2
          WHERE jq2.package_id = wi.package_id
            AND jq2.status = 'failed'
          ORDER BY jq2.updated_at DESC
          LIMIT 10
        ) jq
      ) AS failed_job_samples
    FROM public.production_wave_items wi
    LEFT JOIN public.curricula cur ON cur.id = wi.curriculum_id
    LEFT JOIN public.course_packages cp ON cp.id = wi.package_id
    WHERE wi.wave_id = p_wave_id
      AND (
        p_status_filter IS NULL
        OR wi.status = p_status_filter
      )
      AND wi.status IN ('blocked', 'quality_gate_failed', 'building', 'queued')
    ORDER BY
      CASE wi.status
        WHEN 'blocked' THEN 0
        WHEN 'quality_gate_failed' THEN 1
        WHEN 'building' THEN 2
        ELSE 3
      END,
      wi.priority DESC,
      wi.updated_at DESC NULLS LAST
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'wave_id', p_wave_id,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wave_triage_items(uuid, text) TO service_role;

-- Wave item retry/resume/skip action
CREATE OR REPLACE FUNCTION public.wave_item_retry_action(
  p_wave_item_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
BEGIN
  SELECT *
  INTO v_item
  FROM public.production_wave_items
  WHERE id = p_wave_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wave_item_not_found');
  END IF;

  IF p_action = 'retry' THEN
    UPDATE public.production_wave_items
    SET
      status = 'pending',
      last_error = NULL,
      finished_at = NULL,
      updated_at = now()
    WHERE id = p_wave_item_id;

    IF v_item.package_id IS NOT NULL THEN
      UPDATE public.course_packages
      SET status = 'queued', updated_at = now()
      WHERE id = v_item.package_id
        AND status IN ('failed', 'draft', 'queued', 'building');

      UPDATE public.package_steps
      SET status = 'queued', last_error = NULL, finished_at = NULL, updated_at = now()
      WHERE package_id = v_item.package_id AND status = 'failed';

      UPDATE public.job_queue
      SET status = 'cancelled', finished_at = now(), updated_at = now()
      WHERE package_id = v_item.package_id
        AND status IN ('pending','queued','processing','failed');
    END IF;

    RETURN jsonb_build_object('ok', true, 'action', 'retry');
  END IF;

  IF p_action = 'skip' THEN
    UPDATE public.production_wave_items
    SET status = 'skipped', finished_at = now(), updated_at = now()
    WHERE id = p_wave_item_id;

    RETURN jsonb_build_object('ok', true, 'action', 'skip');
  END IF;

  IF p_action = 'resume' THEN
    UPDATE public.production_wave_items
    SET status = 'queued', last_error = NULL, updated_at = now()
    WHERE id = p_wave_item_id
      AND status IN ('blocked', 'quality_gate_failed');

    IF v_item.package_id IS NOT NULL THEN
      UPDATE public.course_packages
      SET status = 'queued', updated_at = now()
      WHERE id = v_item.package_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'action', 'resume');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$$;

GRANT EXECUTE ON FUNCTION public.wave_item_retry_action(uuid, text) TO service_role;
