
-- ============================================================
-- E3e.4 — Human Gate & Controlled Active Promotion
-- ============================================================

CREATE TABLE IF NOT EXISTS public.seo_bridge_promotion_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type           text NOT NULL,
  batch_label         text NOT NULL,
  requested_by        uuid,
  requested_count     integer NOT NULL DEFAULT 0,
  promoted_count      integer NOT NULL DEFAULT 0,
  skipped_count       integer NOT NULL DEFAULT 0,
  dry_run             boolean NOT NULL DEFAULT true,
  governance_snapshot jsonb   NOT NULL DEFAULT '{}'::jsonb,
  correlation_id      uuid    NOT NULL DEFAULT gen_random_uuid(),
  rolled_back_at      timestamptz,
  rollback_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_promotion_runs_link_type
  ON public.seo_bridge_promotion_runs (link_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_bridge_promotions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.seo_bridge_promotion_runs(id) ON DELETE CASCADE,
  suggestion_id   uuid NOT NULL,
  link_type       text NOT NULL,
  source_url      text NOT NULL,
  target_url      text NOT NULL,
  status          text NOT NULL CHECK (status IN ('planned','promoted','skipped','rolled_back')),
  skip_reason     text,
  rolled_back_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, suggestion_id)
);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_promotions_suggestion
  ON public.seo_bridge_promotions (suggestion_id);

ALTER TABLE public.seo_bridge_promotion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_bridge_promotions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin read promotion runs" ON public.seo_bridge_promotion_runs;
CREATE POLICY "admin read promotion runs" ON public.seo_bridge_promotion_runs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin read promotions" ON public.seo_bridge_promotions;
CREATE POLICY "admin read promotions" ON public.seo_bridge_promotions
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.seo_bridge_promotion_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seo_bridge_promotions     FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seo_bridge_promotion_runs TO authenticated;
GRANT SELECT ON public.seo_bridge_promotions     TO authenticated;
GRANT ALL    ON public.seo_bridge_promotion_runs TO service_role;
GRANT ALL    ON public.seo_bridge_promotions     TO service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('seo_bridge_promotion_proposed',
   ARRAY['run_id','link_type','batch_label','requested_count','dry_run'], 'seo_bridge_e3e4'),
  ('seo_bridge_promotion_committed',
   ARRAY['run_id','link_type','batch_label','promoted_count','skipped_count'], 'seo_bridge_e3e4'),
  ('seo_bridge_promotion_rolled_back',
   ARRAY['run_id','link_type','reverted_count','reason'], 'seo_bridge_e3e4')
ON CONFLICT (action_type) DO NOTHING;

-- ---------- Snapshot ----------
CREATE OR REPLACE FUNCTION public.admin_get_bridge_promotion_snapshot()
RETURNS TABLE (
  link_type text, total_runs bigint, total_promoted bigint, total_skipped bigint,
  total_rolled_back bigint, last_run_at timestamptz, last_batch_label text, last_dry_run boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH g AS (
    SELECT * FROM public.seo_bridge_promotion_runs
    WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ),
  latest AS (
    SELECT DISTINCT ON (link_type) link_type, created_at, batch_label, dry_run
    FROM g ORDER BY link_type, created_at DESC
  )
  SELECT r.link_type,
         COUNT(*)::bigint,
         COALESCE(SUM(r.promoted_count),0)::bigint,
         COALESCE(SUM(r.skipped_count),0)::bigint,
         COALESCE(SUM(CASE WHEN r.rolled_back_at IS NOT NULL THEN r.promoted_count ELSE 0 END),0)::bigint,
         MAX(l.created_at), MAX(l.batch_label), BOOL_OR(l.dry_run)
  FROM g r LEFT JOIN latest l USING (link_type)
  GROUP BY r.link_type ORDER BY r.link_type;
$$;
REVOKE ALL ON FUNCTION public.admin_get_bridge_promotion_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_promotion_snapshot() TO authenticated, service_role;

-- ---------- Preview ----------
CREATE OR REPLACE FUNCTION public.admin_get_bridge_promotion_preview(
  p_link_type text, p_suggestion_ids uuid[]
)
RETURNS TABLE (
  suggestion_id uuid, link_type text, source_url text, target_url text,
  status text, decision text, skip_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_link_type NOT IN ('blog_to_pillar','blog_to_exam_package') THEN
    RAISE EXCEPTION 'unsupported link_type: %', p_link_type;
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT s.id, s.link_type, s.source_url, s.target_url, s.status
    FROM public.seo_internal_link_suggestions s
    WHERE s.id = ANY(p_suggestion_ids)
  ),
  pc AS (
    SELECT DISTINCT ON (c.source_url, c.target_url, c.link_type)
           c.source_url, c.target_url, c.link_type, c.target_id, c.target_layer
    FROM public.seo_bridge_pilot_candidates c
    ORDER BY c.source_url, c.target_url, c.link_type, c.created_at DESC
  ),
  joined AS (
    SELECT s.*, pc.target_id, pc.target_layer,
           CASE
             WHEN s.id IS NULL                          THEN 'SUGGESTION_NOT_FOUND'
             WHEN s.link_type <> p_link_type            THEN 'LINK_TYPE_MISMATCH'
             WHEN s.status <> 'suggested'               THEN 'NOT_SUGGESTED'
             WHEN pc.source_url IS NULL                 THEN 'NOT_FROM_PILOT'
             WHEN p_link_type = 'blog_to_exam_package'
              AND pc.target_layer = 'exam_package'
              AND pc.target_id IS NOT NULL
              AND public.fn_is_bronze_locked(pc.target_id)
                                                       THEN 'BRONZE_LOCKED'
             WHEN EXISTS (
               SELECT 1 FROM public.seo_internal_link_suggestions x
               WHERE x.source_url = s.source_url AND x.target_url = s.target_url
                 AND x.link_type = s.link_type AND x.status = 'active'
                 AND x.id <> s.id
             )                                          THEN 'ACTIVE_DUPLICATE'
             ELSE NULL
           END AS skip_reason_calc
    FROM s
    LEFT JOIN pc ON pc.source_url = s.source_url
                AND pc.target_url = s.target_url
                AND pc.link_type  = s.link_type
  )
  SELECT j.id, j.link_type, j.source_url, j.target_url, j.status,
         CASE WHEN j.skip_reason_calc IS NULL THEN 'READY' ELSE 'SKIP' END,
         j.skip_reason_calc
  FROM joined j
  ORDER BY j.skip_reason_calc NULLS FIRST, j.target_url;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_bridge_promotion_preview(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_promotion_preview(text, uuid[]) TO authenticated, service_role;

-- ---------- Execute ----------
CREATE OR REPLACE FUNCTION public.admin_seo_bridge_promotion_execute(
  p_link_type text, p_suggestion_ids uuid[], p_batch_label text, p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  run_id uuid, link_type text, requested integer, promoted integer, skipped integer, dry_run boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'seo_bridge_promotion_proposed',
    jsonb_build_object('run_id', v_run_id, 'link_type', p_link_type,
      'batch_label', p_batch_label, 'requested_count', v_requested, 'dry_run', p_dry_run)
  );

  IF NOT p_dry_run THEN
    PERFORM public.fn_emit_audit(
      'seo_bridge_promotion_committed',
      jsonb_build_object('run_id', v_run_id, 'link_type', p_link_type,
        'batch_label', p_batch_label,
        'promoted_count', v_promoted, 'skipped_count', v_skipped)
    );
  END IF;

  RETURN QUERY SELECT v_run_id, p_link_type, v_requested, v_promoted, v_skipped, p_dry_run;
END $$;
REVOKE ALL ON FUNCTION public.admin_seo_bridge_promotion_execute(text, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_promotion_execute(text, uuid[], text, boolean) TO authenticated, service_role;

-- ---------- Rollback ----------
CREATE OR REPLACE FUNCTION public.admin_seo_bridge_promotion_rollback(
  p_run_id uuid, p_reason text
)
RETURNS TABLE (run_id uuid, reverted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    'seo_bridge_promotion_rolled_back',
    jsonb_build_object('run_id', p_run_id, 'link_type', v_link_type,
      'reverted_count', v_reverted, 'reason', p_reason)
  );

  RETURN QUERY SELECT p_run_id, v_reverted;
END $$;
REVOKE ALL ON FUNCTION public.admin_seo_bridge_promotion_rollback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_promotion_rollback(uuid, text) TO authenticated, service_role;
