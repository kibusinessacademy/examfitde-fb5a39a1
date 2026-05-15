-- Wave-5 Prep: Thin-Content Guard Evaluator (admin-only, evaluates queued+unpublished candidates)
CREATE OR REPLACE FUNCTION public.admin_seo_thin_content_guard_evaluate(
  p_dry_run boolean DEFAULT true,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  queue_id uuid,
  curriculum_id uuid,
  curriculum_title text,
  competency_id uuid,
  intent_key text,
  persona_type text,
  prev_risk text,
  new_risk text,
  reasons jsonb,
  enqueuable boolean,
  guard jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_total int := 0;
  v_blocked int := 0;
  v_high int := 0;
  v_medium int := 0;
  v_low int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  CREATE TEMP TABLE tmp_eval ON COMMIT DROP AS
  SELECT q.id AS queue_id,
         q.curriculum_id,
         c.title AS curriculum_title,
         q.competency_id,
         q.intent_key,
         q.persona_type,
         q.thin_content_risk AS prev_risk,
         public.fn_seo_thin_content_guard(q.curriculum_id, q.competency_id, q.intent_key) AS guard
  FROM public.seo_content_priority_queue q
  JOIN public.curricula c ON c.id = q.curriculum_id
  WHERE q.generation_status = 'queued'
    AND COALESCE(q.thin_content_risk, 'unknown') = 'unknown'
    AND NOT EXISTS (
      SELECT 1 FROM public.seo_content_pages p
      WHERE p.curriculum_id = q.curriculum_id
        AND p.intent_template = q.intent_key
        AND p.status = 'published'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue j
      WHERE j.job_type = 'seo_intent_page_generate'
        AND j.status IN ('pending','processing')
        AND (j.payload->>'curriculum_id')::uuid = q.curriculum_id
        AND j.payload->>'intent_key' = q.intent_key
    )
  ORDER BY c.title, q.intent_key
  LIMIT p_limit;

  SELECT COUNT(*) INTO v_total FROM tmp_eval;

  IF NOT p_dry_run THEN
    UPDATE public.seo_content_priority_queue q
    SET thin_content_risk    = COALESCE(t.guard->>'risk', 'unknown'),
        thin_content_reasons = COALESCE(t.guard->'reasons', '[]'::jsonb),
        last_evaluated_at    = now(),
        updated_at           = now()
    FROM tmp_eval t
    WHERE q.id = t.queue_id;
  END IF;

  -- Audit summary
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'seo_thin_content_guard_evaluate',
    'system', NULL,
    'success',
    format('evaluated=%s dry_run=%s', v_total, p_dry_run),
    jsonb_build_object(
      'run_id', v_run_id,
      'evaluated', v_total,
      'dry_run', p_dry_run,
      'risk_breakdown', (
        SELECT jsonb_object_agg(COALESCE(guard->>'risk','unknown'), c)
        FROM (SELECT guard, COUNT(*) c FROM tmp_eval GROUP BY guard) s
      )
    )
  );

  RETURN QUERY
  SELECT t.queue_id,
         t.curriculum_id,
         t.curriculum_title,
         t.competency_id,
         t.intent_key,
         t.persona_type,
         t.prev_risk,
         COALESCE(t.guard->>'risk', 'unknown') AS new_risk,
         COALESCE(t.guard->'reasons', '[]'::jsonb) AS reasons,
         (
           COALESCE(t.guard->>'risk','unknown') NOT IN ('high','blocked')
           AND COALESCE((t.guard->>'has_hard_blocker')::boolean, false) = false
         ) AS enqueuable,
         t.guard
  FROM tmp_eval t
  ORDER BY t.curriculum_title, t.intent_key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_seo_thin_content_guard_evaluate(boolean, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_thin_content_guard_evaluate(boolean, int) TO authenticated;
-- has_role gate inside body restricts to admins; grant authenticated so the RPC is callable, role-checked internally.