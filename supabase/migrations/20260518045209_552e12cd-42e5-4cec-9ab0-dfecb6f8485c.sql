-- E3e.4 RPC-Fix — fn_emit_audit Named-Args
-- Beide Promotion-RPCs nutzten eine nicht-existente 2-Arg-Signatur.

CREATE OR REPLACE FUNCTION public.admin_seo_bridge_promotion_execute(
  p_link_type text, p_suggestion_ids uuid[], p_batch_label text, p_dry_run boolean DEFAULT true
)
RETURNS TABLE(run_id uuid, link_type text, requested integer, promoted integer, skipped integer, dry_run boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin   boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_is_service boolean := (current_setting('role', true) = 'service_role') OR (auth.role() = 'service_role');
  v_cap        integer;
  v_run_id     uuid;
  v_requested  integer := COALESCE(array_length(p_suggestion_ids, 1), 0);
  v_promoted   integer := 0;
  v_skipped    integer := 0;
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN
    RAISE EXCEPTION 'admin role or service_role required';
  END IF;
  IF p_link_type NOT IN ('blog_to_pillar','blog_to_exam_package') THEN
    RAISE EXCEPTION 'unsupported link_type: %', p_link_type;
  END IF;
  IF p_batch_label IS NULL OR length(trim(p_batch_label)) < 3 THEN
    RAISE EXCEPTION 'batch_label required (min 3 chars)';
  END IF;

  v_cap := CASE p_link_type WHEN 'blog_to_pillar' THEN 30 WHEN 'blog_to_exam_package' THEN 20 END;

  IF v_requested = 0 THEN RAISE EXCEPTION 'no suggestion_ids provided'; END IF;
  IF v_requested > v_cap THEN
    RAISE EXCEPTION 'requested % exceeds hard-cap % for %', v_requested, v_cap, p_link_type;
  END IF;

  INSERT INTO public.seo_bridge_promotion_runs(
    link_type, batch_label, requested_by, requested_count, dry_run, governance_snapshot
  ) VALUES (
    p_link_type, p_batch_label, auth.uid(), v_requested, p_dry_run,
    jsonb_build_object('cap_per_batch', v_cap, 'phase', 'E3e.4')
  ) RETURNING id INTO v_run_id;

  WITH eval AS (
    SELECT * FROM public.admin_get_bridge_promotion_preview(p_link_type, p_suggestion_ids)
  ),
  inserted AS (
    INSERT INTO public.seo_bridge_promotions(
      run_id, suggestion_id, link_type, source_url, target_url, status, skip_reason
    )
    SELECT v_run_id,
           COALESCE(e.suggestion_id, gen_random_uuid()),
           p_link_type,
           COALESCE(e.source_url, '<missing>'),
           COALESCE(e.target_url, '<missing>'),
           CASE WHEN e.decision = 'READY' THEN 'planned' ELSE 'skipped' END,
           e.skip_reason
    FROM eval e
    RETURNING status
  )
  SELECT COUNT(*) FILTER (WHERE status = 'planned')::int,
         COUNT(*) FILTER (WHERE status = 'skipped')::int
  INTO v_promoted, v_skipped FROM inserted;

  IF NOT p_dry_run THEN
    UPDATE public.seo_internal_link_suggestions s
    SET status = 'active', updated_at = now()
    FROM public.seo_bridge_promotions p
    WHERE p.run_id = v_run_id AND p.status = 'planned'
      AND s.id = p.suggestion_id AND s.status = 'suggested';

    UPDATE public.seo_bridge_promotions p
    SET status = 'promoted'
    FROM public.seo_internal_link_suggestions s
    WHERE p.run_id = v_run_id AND p.status = 'planned'
      AND s.id = p.suggestion_id AND s.status = 'active';

    UPDATE public.seo_bridge_promotions
    SET status = 'skipped', skip_reason = 'RACE_NOT_SUGGESTED'
    WHERE run_id = v_run_id AND status = 'planned';

    SELECT COUNT(*) FILTER (WHERE status = 'promoted')::int,
           COUNT(*) FILTER (WHERE status = 'skipped')::int
    INTO v_promoted, v_skipped
    FROM public.seo_bridge_promotions WHERE run_id = v_run_id;
  END IF;

  UPDATE public.seo_bridge_promotion_runs
  SET promoted_count = v_promoted, skipped_count = v_skipped
  WHERE id = v_run_id;

  PERFORM public.fn_emit_audit(
    _action_type   := 'seo_bridge_promotion_proposed',
    _target_type   := 'seo_bridge_promotion_run',
    _target_id     := v_run_id::text,
    _result_status := 'success',
    _payload       := jsonb_build_object('run_id', v_run_id, 'link_type', p_link_type,
                       'batch_label', p_batch_label, 'requested_count', v_requested, 'dry_run', p_dry_run)
  );

  IF NOT p_dry_run THEN
    PERFORM public.fn_emit_audit(
      _action_type   := 'seo_bridge_promotion_committed',
      _target_type   := 'seo_bridge_promotion_run',
      _target_id     := v_run_id::text,
      _result_status := 'success',
      _payload       := jsonb_build_object('run_id', v_run_id, 'link_type', p_link_type,
                         'batch_label', p_batch_label,
                         'promoted_count', v_promoted, 'skipped_count', v_skipped)
    );
  END IF;

  RETURN QUERY SELECT v_run_id, p_link_type, v_requested, v_promoted, v_skipped, p_dry_run;
END $function$;


CREATE OR REPLACE FUNCTION public.admin_seo_bridge_promotion_rollback(
  p_run_id uuid, p_reason text
)
RETURNS TABLE(run_id uuid, reverted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin   boolean := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_is_service boolean := (current_setting('role', true) = 'service_role') OR (auth.role() = 'service_role');
  v_link_type  text;
  v_dry        boolean;
  v_already    timestamptz;
  v_reverted   integer := 0;
BEGIN
  IF NOT (v_is_admin OR v_is_service) THEN
    RAISE EXCEPTION 'admin role or service_role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;

  SELECT link_type, dry_run, rolled_back_at
  INTO v_link_type, v_dry, v_already
  FROM public.seo_bridge_promotion_runs WHERE id = p_run_id;

  IF v_link_type IS NULL THEN RAISE EXCEPTION 'run not found'; END IF;
  IF v_dry THEN RAISE EXCEPTION 'cannot rollback dry-run'; END IF;
  IF v_already IS NOT NULL THEN RAISE EXCEPTION 'already rolled back at %', v_already; END IF;

  WITH rev AS (
    UPDATE public.seo_internal_link_suggestions s
    SET status = 'suggested', updated_at = now()
    FROM public.seo_bridge_promotions p
    WHERE p.run_id = p_run_id AND p.status = 'promoted'
      AND s.id = p.suggestion_id AND s.status = 'active'
    RETURNING s.id
  )
  SELECT COUNT(*)::int INTO v_reverted FROM rev;

  UPDATE public.seo_bridge_promotions
  SET status = 'rolled_back', rolled_back_at = now()
  WHERE run_id = p_run_id AND status = 'promoted';

  UPDATE public.seo_bridge_promotion_runs
  SET rolled_back_at = now(), rollback_reason = p_reason
  WHERE id = p_run_id;

  PERFORM public.fn_emit_audit(
    _action_type   := 'seo_bridge_promotion_rolled_back',
    _target_type   := 'seo_bridge_promotion_run',
    _target_id     := p_run_id::text,
    _result_status := 'success',
    _payload       := jsonb_build_object('run_id', p_run_id, 'link_type', v_link_type,
                       'reverted_count', v_reverted, 'reason', p_reason)
  );

  RETURN QUERY SELECT p_run_id, v_reverted;
END $function$;