CREATE OR REPLACE FUNCTION public.enqueue_blueprint_gap_jobs(p_curriculum_id uuid, p_cap integer DEFAULT 50, p_reason text DEFAULT 'gap_router'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap int := GREATEST(5, LEAST(COALESCE(p_cap, 50), 200));
  v_ins int := 0;
BEGIN
  WITH gaps AS (
    SELECT g.competency_id, g.gap_total, g.gap_recall, g.gap_application,
      g.gap_scenario, g.gap_transfer, g.gap_error_patterns, g.priority
    FROM public.get_blueprint_coverage_gaps(p_curriculum_id, 1) g
    ORDER BY g.priority DESC, g.gap_total DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (
      job_type, status, payload, priority, max_attempts, package_id, worker_pool
    )
    SELECT
      'blueprint_generate_variants', 'pending',
      jsonb_build_object(
        'curriculum_id', p_curriculum_id::text,
        'competency_id', g.competency_id::text,
        'gap_total', g.gap_total,
        'targets', jsonb_build_object(
          'recall', GREATEST(g.gap_recall, 0),
          'application', GREATEST(g.gap_application, 0),
          'scenario', GREATEST(g.gap_scenario, 0),
          'transfer', GREATEST(g.gap_transfer, 0),
          'error_patterns', GREATEST(g.gap_error_patterns, 0)
        ),
        'reason', p_reason,
        'enqueue_source', 'db:enqueue_blueprint_gap_jobs'
      ),
      80, 3, NULL, 'content'
    FROM gaps g
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ins FROM ins;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id, 'cap', v_cap,
    'enqueued', v_ins, 'reason', p_reason, 'ts', now()
  );
END;
$function$;