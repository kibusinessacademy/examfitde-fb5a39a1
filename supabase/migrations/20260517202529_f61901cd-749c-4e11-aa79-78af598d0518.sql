-- ============================================================
-- E3e.3 — Bridge Pilot Selective Activation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.seo_bridge_activation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_type text NOT NULL,
  batch_label text NOT NULL,
  requested_by uuid,
  requested_count integer NOT NULL DEFAULT 0,
  activated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT true,
  governance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  rolled_back_at timestamptz,
  rollback_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_bridge_activation_runs_link_type
  ON public.seo_bridge_activation_runs(link_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seo_bridge_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.seo_bridge_activation_runs(id) ON DELETE CASCADE,
  pilot_candidate_id uuid NOT NULL,
  link_type text NOT NULL,
  source_url text NOT NULL,
  target_url text NOT NULL,
  anchor_text text,
  suggestion_id uuid REFERENCES public.seo_internal_link_suggestions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('planned','activated','skipped','rolled_back')),
  skip_reason text,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, pilot_candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_seo_bridge_activations_run_status
  ON public.seo_bridge_activations(run_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_bridge_activations_suggestion
  ON public.seo_bridge_activations(suggestion_id) WHERE suggestion_id IS NOT NULL;

ALTER TABLE public.seo_bridge_activation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seo_bridge_activations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bridge_activation_runs_admin_select" ON public.seo_bridge_activation_runs;
CREATE POLICY "bridge_activation_runs_admin_select"
  ON public.seo_bridge_activation_runs FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "bridge_activation_runs_service_all" ON public.seo_bridge_activation_runs;
CREATE POLICY "bridge_activation_runs_service_all"
  ON public.seo_bridge_activation_runs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

DROP POLICY IF EXISTS "bridge_activations_admin_select" ON public.seo_bridge_activations;
CREATE POLICY "bridge_activations_admin_select"
  ON public.seo_bridge_activations FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));
DROP POLICY IF EXISTS "bridge_activations_service_all" ON public.seo_bridge_activations;
CREATE POLICY "bridge_activations_service_all"
  ON public.seo_bridge_activations FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

REVOKE ALL ON public.seo_bridge_activation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seo_bridge_activations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seo_bridge_activation_runs TO authenticated;
GRANT SELECT ON public.seo_bridge_activations TO authenticated;
GRANT ALL ON public.seo_bridge_activation_runs TO service_role;
GRANT ALL ON public.seo_bridge_activations TO service_role;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('seo_bridge_activation_proposed',
   ARRAY['link_type','batch_label','requested_count','dry_run']::text[],
   'seo.bridge.e3e3'),
  ('seo_bridge_activation_committed',
   ARRAY['run_id','link_type','activated_count','skipped_count']::text[],
   'seo.bridge.e3e3'),
  ('seo_bridge_activation_rolled_back',
   ARRAY['run_id','link_type','rolled_back_count','reason']::text[],
   'seo.bridge.e3e3')
ON CONFLICT (action_type) DO NOTHING;

-- ============================================================
-- admin_seo_bridge_activation_execute
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_seo_bridge_activation_execute(
  p_link_type text,
  p_candidate_ids uuid[],
  p_batch_label text,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  run_id uuid,
  link_type text,
  dry_run boolean,
  requested_count int,
  activated_count int,
  skipped_count int,
  cap_per_batch int,
  governance jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_run_id uuid;
  v_corr uuid := gen_random_uuid();
  v_cap int;
  v_min_sim numeric;
  v_requested int := COALESCE(array_length(p_candidate_ids,1),0);
  v_activated int := 0;
  v_skipped int := 0;
  v_gov jsonb;
BEGIN
  IF NOT (has_role(v_uid,'admin'::app_role)
          OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_execute: admin role required';
  END IF;

  IF p_link_type NOT IN ('blog_to_pillar','blog_to_exam_package') THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_execute: unsupported link_type %', p_link_type;
  END IF;

  v_cap := CASE p_link_type
             WHEN 'blog_to_pillar'       THEN 60
             WHEN 'blog_to_exam_package' THEN 25
           END;

  SELECT COALESCE(min_semantic_similarity, 0.0)
    INTO v_min_sim
    FROM public.seo_bridge_governance
   WHERE bridge_type = p_link_type
   LIMIT 1;

  v_gov := jsonb_build_object(
    'link_type', p_link_type,
    'cap_per_batch', v_cap,
    'min_semantic_similarity', v_min_sim,
    'suggestions_status_on_commit', 'suggested',
    'requires_second_human_gate_for_active', true,
    'evaluated_at', now()
  );

  INSERT INTO public.seo_bridge_activation_runs(
    link_type, batch_label, requested_by, requested_count,
    dry_run, governance_snapshot, correlation_id
  ) VALUES (
    p_link_type, p_batch_label, v_uid, v_requested,
    p_dry_run, v_gov, v_corr
  ) RETURNING id INTO v_run_id;

  WITH input AS (
    SELECT unnest(p_candidate_ids) AS cand_id
  ),
  resolved AS (
    SELECT
      i.cand_id,
      c.source_url,
      c.target_url,
      c.target_title,
      c.similarity_score,
      c.governance_decision,
      c.link_type AS cand_link_type,
      CASE
        WHEN c.id IS NULL THEN 'CANDIDATE_NOT_FOUND'
        WHEN c.link_type <> p_link_type THEN 'LINK_TYPE_MISMATCH'
        WHEN c.source_url IS NULL OR c.target_url IS NULL THEN 'URL_MISSING'
        WHEN c.similarity_score < v_min_sim THEN 'BELOW_MIN_SIM'
        WHEN c.governance_decision <> 'READY' THEN 'NOT_READY'
        WHEN EXISTS (
          SELECT 1 FROM public.seo_internal_link_suggestions s
           WHERE s.source_url = c.source_url
             AND s.target_url = c.target_url
             AND COALESCE(s.link_type,'contextual') = p_link_type
        ) THEN 'DUPLICATE_SUGGESTION'
        ELSE NULL
      END AS skip_reason
    FROM input i
    LEFT JOIN public.seo_bridge_pilot_candidates c ON c.id = i.cand_id
  ),
  capped AS (
    SELECT
      r.*,
      ROW_NUMBER() OVER (
        PARTITION BY (skip_reason IS NULL)
        ORDER BY r.similarity_score DESC NULLS LAST, r.cand_id
      ) AS rn_eligible
    FROM resolved r
  )
  INSERT INTO public.seo_bridge_activations(
    run_id, pilot_candidate_id, link_type, source_url, target_url,
    anchor_text, status, skip_reason
  )
  SELECT
    v_run_id,
    cand_id,
    p_link_type,
    source_url,
    target_url,
    LEFT(COALESCE(target_title, target_url), 120),
    CASE
      WHEN skip_reason IS NOT NULL THEN 'skipped'
      WHEN rn_eligible > v_cap THEN 'skipped'
      ELSE 'planned'
    END,
    CASE
      WHEN skip_reason IS NOT NULL THEN skip_reason
      WHEN rn_eligible > v_cap THEN 'CAP_EXCEEDED'
      ELSE NULL
    END
  FROM capped;

  IF NOT p_dry_run THEN
    WITH planned AS (
      SELECT a.id AS activation_id, a.source_url, a.target_url, a.anchor_text, a.link_type
        FROM public.seo_bridge_activations a
       WHERE a.run_id = v_run_id AND a.status = 'planned'
    ),
    inserted AS (
      INSERT INTO public.seo_internal_link_suggestions(
        source_url, target_url, anchor_text, link_type,
        relevance_score, priority, reason, status
      )
      SELECT
        p.source_url, p.target_url, p.anchor_text, p.link_type,
        70, 6,
        'E3e.3 bridge pilot activation (' || p_link_type || ')',
        'suggested'
      FROM planned p
      ON CONFLICT (source_url, target_url, link_type) DO NOTHING
      RETURNING id, source_url, target_url, link_type
    )
    UPDATE public.seo_bridge_activations a
       SET status = 'activated',
           suggestion_id = ins.id
      FROM inserted ins
     WHERE a.run_id = v_run_id
       AND a.source_url = ins.source_url
       AND a.target_url = ins.target_url
       AND a.link_type = ins.link_type;

    UPDATE public.seo_bridge_activations
       SET status = 'skipped',
           skip_reason = COALESCE(skip_reason,'RACE_DUPLICATE')
     WHERE run_id = v_run_id
       AND status = 'planned';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('planned','activated'))::int,
    COUNT(*) FILTER (WHERE status = 'skipped')::int
  INTO v_activated, v_skipped
  FROM public.seo_bridge_activations
  WHERE run_id = v_run_id;

  UPDATE public.seo_bridge_activation_runs
     SET activated_count = v_activated,
         skipped_count   = v_skipped
   WHERE id = v_run_id;

  PERFORM public.fn_emit_audit(
    'seo_bridge_activation_proposed',
    jsonb_build_object(
      'run_id', v_run_id,
      'link_type', p_link_type,
      'batch_label', p_batch_label,
      'requested_count', v_requested,
      'dry_run', p_dry_run,
      'cap_per_batch', v_cap,
      'planned_or_activated', v_activated,
      'skipped', v_skipped,
      'correlation_id', v_corr
    )
  );

  IF NOT p_dry_run THEN
    PERFORM public.fn_emit_audit(
      'seo_bridge_activation_committed',
      jsonb_build_object(
        'run_id', v_run_id,
        'link_type', p_link_type,
        'activated_count', v_activated,
        'skipped_count', v_skipped,
        'correlation_id', v_corr
      )
    );
  END IF;

  RETURN QUERY
  SELECT v_run_id, p_link_type, p_dry_run,
         v_requested, v_activated, v_skipped, v_cap, v_gov;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_seo_bridge_activation_execute(text, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_activation_execute(text, uuid[], text, boolean) TO authenticated, service_role;

-- ============================================================
-- admin_seo_bridge_activation_rollback
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_seo_bridge_activation_rollback(
  p_run_id uuid,
  p_reason text
)
RETURNS TABLE (run_id uuid, rolled_back_count int, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_link_type text;
  v_dry boolean;
  v_already timestamptz;
  v_count int := 0;
BEGIN
  IF NOT (has_role(v_uid,'admin'::app_role)
          OR (auth.jwt() ->> 'role') = 'service_role') THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_rollback: admin role required';
  END IF;

  IF COALESCE(length(trim(p_reason)),0) < 5 THEN
    RAISE EXCEPTION 'admin_seo_bridge_activation_rollback: reason >=5 chars required';
  END IF;

  SELECT link_type, dry_run, rolled_back_at
    INTO v_link_type, v_dry, v_already
    FROM public.seo_bridge_activation_runs
   WHERE id = p_run_id;

  IF v_link_type IS NULL THEN
    RAISE EXCEPTION 'run not found: %', p_run_id;
  END IF;
  IF v_dry THEN
    RAISE EXCEPTION 'cannot rollback a dry-run batch';
  END IF;
  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION 'run already rolled back at %', v_already;
  END IF;

  WITH targets AS (
    SELECT id AS activation_id, suggestion_id
      FROM public.seo_bridge_activations
     WHERE run_id = p_run_id AND status = 'activated'
  ),
  upd_sug AS (
    UPDATE public.seo_internal_link_suggestions s
       SET status = 'rejected',
           reason = COALESCE(s.reason,'') || ' [rolled_back: ' || p_reason || ']',
           updated_at = now()
      FROM targets t
     WHERE s.id = t.suggestion_id
     RETURNING s.id
  ),
  upd_act AS (
    UPDATE public.seo_bridge_activations a
       SET status = 'rolled_back',
           rolled_back_at = now(),
           skip_reason = COALESCE(a.skip_reason,'') || ' rollback: ' || p_reason
      FROM targets t
     WHERE a.id = t.activation_id
     RETURNING a.id
  )
  SELECT COUNT(*) INTO v_count FROM upd_act;

  UPDATE public.seo_bridge_activation_runs
     SET rolled_back_at = now(),
         rollback_reason = p_reason
   WHERE id = p_run_id;

  PERFORM public.fn_emit_audit(
    'seo_bridge_activation_rolled_back',
    jsonb_build_object(
      'run_id', p_run_id,
      'link_type', v_link_type,
      'rolled_back_count', v_count,
      'reason', p_reason
    )
  );

  RETURN QUERY SELECT p_run_id, v_count, p_reason;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_seo_bridge_activation_rollback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_activation_rollback(uuid, text) TO authenticated, service_role;

-- ============================================================
-- admin_get_bridge_activation_snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_bridge_activation_snapshot()
RETURNS TABLE (
  link_type text,
  total_runs int,
  total_activated int,
  total_skipped int,
  total_rolled_back int,
  last_run_at timestamptz,
  last_batch_label text,
  last_dry_run boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  WITH guard AS (
    SELECT 1 WHERE has_role(auth.uid(),'admin'::app_role)
                OR (auth.jwt() ->> 'role') = 'service_role'
  ),
  per_run AS (
    SELECT r.id, r.link_type, r.created_at, r.batch_label, r.dry_run,
           COUNT(*) FILTER (WHERE a.status = 'activated')::int   AS act,
           COUNT(*) FILTER (WHERE a.status = 'skipped')::int     AS skp,
           COUNT(*) FILTER (WHERE a.status = 'rolled_back')::int AS rb
      FROM public.seo_bridge_activation_runs r
      LEFT JOIN public.seo_bridge_activations a ON a.run_id = r.id
     WHERE EXISTS (SELECT 1 FROM guard)
     GROUP BY r.id
  ),
  agg AS (
    SELECT link_type,
           COUNT(*)::int AS total_runs,
           SUM(act)::int AS total_activated,
           SUM(skp)::int AS total_skipped,
           SUM(rb)::int  AS total_rolled_back
      FROM per_run
     GROUP BY link_type
  ),
  latest AS (
    SELECT DISTINCT ON (link_type)
           link_type, created_at AS last_run_at,
           batch_label AS last_batch_label, dry_run AS last_dry_run
      FROM per_run
     ORDER BY link_type, created_at DESC
  )
  SELECT a.link_type, a.total_runs, a.total_activated, a.total_skipped, a.total_rolled_back,
         l.last_run_at, l.last_batch_label, l.last_dry_run
    FROM agg a
    LEFT JOIN latest l ON l.link_type = a.link_type;
$fn$;

REVOKE ALL ON FUNCTION public.admin_get_bridge_activation_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_activation_snapshot() TO authenticated, service_role;