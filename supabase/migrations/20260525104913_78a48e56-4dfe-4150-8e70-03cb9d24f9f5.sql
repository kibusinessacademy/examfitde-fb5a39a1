-- E3e.4 Bridge Outcome Measurement v1

-- ============================================================
-- 1) Config (singleton row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.seo_bridge_outcome_config (
  id                       integer PRIMARY KEY DEFAULT 1,
  window_days_pre          integer NOT NULL DEFAULT 14,
  window_days_post         integer NOT NULL DEFAULT 14,
  min_sample_per_side      integer NOT NULL DEFAULT 20,
  min_lift_pct_for_promote numeric NOT NULL DEFAULT 5.0,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid,
  CONSTRAINT seo_bridge_outcome_config_singleton CHECK (id = 1),
  CONSTRAINT seo_bridge_outcome_config_window_pre_chk  CHECK (window_days_pre  BETWEEN 1 AND 60),
  CONSTRAINT seo_bridge_outcome_config_window_post_chk CHECK (window_days_post BETWEEN 1 AND 60),
  CONSTRAINT seo_bridge_outcome_config_min_sample_chk  CHECK (min_sample_per_side >= 0),
  CONSTRAINT seo_bridge_outcome_config_min_lift_chk    CHECK (min_lift_pct_for_promote >= 0)
);

INSERT INTO public.seo_bridge_outcome_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.seo_bridge_outcome_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_bridge_outcome_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seo_bridge_outcome_config TO service_role;
CREATE POLICY seo_bridge_outcome_config_admin_select ON public.seo_bridge_outcome_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 2) Snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS public.seo_bridge_outcome_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at         timestamptz NOT NULL DEFAULT now(),
  link_type           text NOT NULL,
  activation_id       uuid REFERENCES public.seo_bridge_activations(id) ON DELETE SET NULL,
  suggestion_id       uuid REFERENCES public.seo_internal_link_suggestions(id) ON DELETE SET NULL,
  source_url          text NOT NULL,
  target_url          text NOT NULL,
  activated_at        timestamptz NOT NULL,
  window_days_pre     integer NOT NULL,
  window_days_post    integer NOT NULL,
  source_views_pre    integer NOT NULL DEFAULT 0,
  source_views_post   integer NOT NULL DEFAULT 0,
  target_views_pre    integer NOT NULL DEFAULT 0,
  target_views_post   integer NOT NULL DEFAULT 0,
  target_conv_pre     integer NOT NULL DEFAULT 0,
  target_conv_post    integer NOT NULL DEFAULT 0,
  target_views_lift_pct numeric,
  target_conv_lift_pct  numeric,
  correlation_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bridge_outcome_snapshots_link_type_snap
  ON public.seo_bridge_outcome_snapshots (link_type, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_outcome_snapshots_activation
  ON public.seo_bridge_outcome_snapshots (activation_id, snapshot_at DESC);

ALTER TABLE public.seo_bridge_outcome_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seo_bridge_outcome_snapshots FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.seo_bridge_outcome_snapshots TO service_role;
CREATE POLICY seo_bridge_outcome_snapshots_admin_select ON public.seo_bridge_outcome_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3) View — read-only outcome computation
-- ============================================================
CREATE OR REPLACE VIEW public.v_seo_bridge_outcome_v1 AS
WITH cfg AS (
  SELECT window_days_pre, window_days_post, min_sample_per_side, min_lift_pct_for_promote
  FROM public.seo_bridge_outcome_config WHERE id = 1
),
edges AS (
  SELECT
    a.id                                AS activation_id,
    a.suggestion_id,
    a.link_type,
    a.source_url,
    a.target_url,
    a.created_at                        AS activated_at,
    COALESCE(s.status, 'unknown')       AS suggestion_status
  FROM public.seo_bridge_activations a
  LEFT JOIN public.seo_internal_link_suggestions s ON s.id = a.suggestion_id
  WHERE a.status = 'activated'
    AND a.rolled_back_at IS NULL
),
edges_paths AS (
  SELECT
    e.*,
    regexp_replace(e.source_url, '^https?://[^/]+', '') AS source_path,
    regexp_replace(e.target_url, '^https?://[^/]+', '') AS target_path
  FROM edges e
),
metrics AS (
  SELECT
    ep.activation_id,
    ep.suggestion_id,
    ep.link_type,
    ep.source_url,
    ep.target_url,
    ep.activated_at,
    ep.suggestion_status,
    (SELECT window_days_pre  FROM cfg) AS window_days_pre,
    (SELECT window_days_post FROM cfg) AS window_days_post,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('landing_view','page_view','product_view','shop_view','lead_magnet_view')
         AND ce.page_path = ep.source_path
         AND ce.created_at >= ep.activated_at - make_interval(days => (SELECT window_days_pre FROM cfg))
         AND ce.created_at <  ep.activated_at) AS source_views_pre,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('landing_view','page_view','product_view','shop_view','lead_magnet_view')
         AND ce.page_path = ep.source_path
         AND ce.created_at >= ep.activated_at
         AND ce.created_at <  ep.activated_at + make_interval(days => (SELECT window_days_post FROM cfg))) AS source_views_post,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('landing_view','page_view','product_view','shop_view','lead_magnet_view')
         AND ce.page_path = ep.target_path
         AND ce.created_at >= ep.activated_at - make_interval(days => (SELECT window_days_pre FROM cfg))
         AND ce.created_at <  ep.activated_at) AS target_views_pre,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('landing_view','page_view','product_view','shop_view','lead_magnet_view')
         AND ce.page_path = ep.target_path
         AND ce.created_at >= ep.activated_at
         AND ce.created_at <  ep.activated_at + make_interval(days => (SELECT window_days_post FROM cfg))) AS target_views_post,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('checkout_start','checkout_started','checkout_complete')
         AND ce.page_path = ep.target_path
         AND ce.created_at >= ep.activated_at - make_interval(days => (SELECT window_days_pre FROM cfg))
         AND ce.created_at <  ep.activated_at) AS target_conv_pre,
    (SELECT COUNT(*) FROM public.conversion_events ce
       WHERE ce.event_type IN ('checkout_start','checkout_started','checkout_complete')
         AND ce.page_path = ep.target_path
         AND ce.created_at >= ep.activated_at
         AND ce.created_at <  ep.activated_at + make_interval(days => (SELECT window_days_post FROM cfg))) AS target_conv_post
  FROM edges_paths ep
)
SELECT
  m.*,
  CASE
    WHEN m.target_views_pre  >= (SELECT min_sample_per_side FROM cfg)
     AND m.target_views_post >= (SELECT min_sample_per_side FROM cfg)
     AND m.target_views_pre  > 0
    THEN ROUND( (m.target_views_post::numeric - m.target_views_pre::numeric)
                / m.target_views_pre::numeric * 100.0, 2)
    ELSE NULL
  END AS target_views_lift_pct,
  CASE
    WHEN m.target_conv_pre  > 0
    THEN ROUND( (m.target_conv_post::numeric - m.target_conv_pre::numeric)
                / m.target_conv_pre::numeric * 100.0, 2)
    ELSE NULL
  END AS target_conv_lift_pct,
  CASE
    WHEN m.target_views_pre  < (SELECT min_sample_per_side FROM cfg)
      OR m.target_views_post < (SELECT min_sample_per_side FROM cfg)
      THEN 'INSUFFICIENT_SAMPLE'
    WHEN m.target_views_pre = 0 THEN 'NO_BASELINE'
    WHEN ROUND( (m.target_views_post::numeric - m.target_views_pre::numeric)
                / m.target_views_pre::numeric * 100.0, 2)
          >= (SELECT min_lift_pct_for_promote FROM cfg)
      THEN 'PROMOTE_RECOMMENDED'
    WHEN ROUND( (m.target_views_post::numeric - m.target_views_pre::numeric)
                / m.target_views_pre::numeric * 100.0, 2)
          <  0
      THEN 'ROLLBACK_CANDIDATE'
    ELSE 'HOLD'
  END AS recommendation
FROM metrics m;

REVOKE ALL ON public.v_seo_bridge_outcome_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_bridge_outcome_v1 TO service_role;

-- ============================================================
-- 4) Audit contracts
-- ============================================================
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('seo_bridge_outcome_snapshot_taken',
   ARRAY['link_type','rows_snapshotted','correlation_id']::text[],
   'seo_bridge_layer'),
  ('seo_bridge_outcome_config_updated',
   ARRAY['field','old_value','new_value']::text[],
   'seo_bridge_layer'),
  ('seo_bridge_promotion_recommended',
   ARRAY['link_type','candidates_total','promote_recommended','rollback_candidates']::text[],
   'seo_bridge_layer')
ON CONFLICT (action_type) DO NOTHING;

-- ============================================================
-- 5) RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_seo_bridge_compute_outcome(p_link_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corr uuid := gen_random_uuid();
  v_rows integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied: admin required';
  END IF;

  INSERT INTO public.seo_bridge_outcome_snapshots (
    link_type, activation_id, suggestion_id, source_url, target_url,
    activated_at, window_days_pre, window_days_post,
    source_views_pre, source_views_post,
    target_views_pre, target_views_post,
    target_conv_pre, target_conv_post,
    target_views_lift_pct, target_conv_lift_pct,
    correlation_id, meta
  )
  SELECT
    v.link_type, v.activation_id, v.suggestion_id, v.source_url, v.target_url,
    v.activated_at, v.window_days_pre, v.window_days_post,
    v.source_views_pre, v.source_views_post,
    v.target_views_pre, v.target_views_post,
    v.target_conv_pre, v.target_conv_post,
    v.target_views_lift_pct, v.target_conv_lift_pct,
    v_corr,
    jsonb_build_object('recommendation', v.recommendation, 'suggestion_status', v.suggestion_status)
  FROM public.v_seo_bridge_outcome_v1 v
  WHERE p_link_type IS NULL OR v.link_type = p_link_type;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.fn_emit_audit(
    'seo_bridge_outcome_snapshot_taken',
    jsonb_build_object(
      'link_type', COALESCE(p_link_type, 'ALL'),
      'rows_snapshotted', v_rows,
      'correlation_id', v_corr
    )
  );

  RETURN jsonb_build_object(
    'status','ok',
    'link_type', COALESCE(p_link_type, 'ALL'),
    'rows_snapshotted', v_rows,
    'correlation_id', v_corr
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_seo_bridge_compute_outcome(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_bridge_compute_outcome(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_bridge_outcome_summary()
RETURNS TABLE (
  link_type text,
  edges_total bigint,
  promote_recommended bigint,
  rollback_candidates bigint,
  hold_count bigint,
  insufficient_sample bigint,
  avg_target_views_lift_pct numeric,
  last_snapshot_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    v.link_type,
    COUNT(*) AS edges_total,
    COUNT(*) FILTER (WHERE v.recommendation = 'PROMOTE_RECOMMENDED') AS promote_recommended,
    COUNT(*) FILTER (WHERE v.recommendation = 'ROLLBACK_CANDIDATE') AS rollback_candidates,
    COUNT(*) FILTER (WHERE v.recommendation = 'HOLD') AS hold_count,
    COUNT(*) FILTER (WHERE v.recommendation IN ('INSUFFICIENT_SAMPLE','NO_BASELINE')) AS insufficient_sample,
    ROUND(AVG(v.target_views_lift_pct)::numeric, 2) AS avg_target_views_lift_pct,
    (SELECT MAX(snapshot_at) FROM public.seo_bridge_outcome_snapshots s WHERE s.link_type = v.link_type) AS last_snapshot_at
  FROM public.v_seo_bridge_outcome_v1 v
  WHERE public.has_role(auth.uid(), 'admin')
  GROUP BY v.link_type
  ORDER BY v.link_type;
$$;

REVOKE ALL ON FUNCTION public.admin_get_bridge_outcome_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_bridge_outcome_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_recommend_bridge_promotion(p_link_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_total       integer := 0;
  v_promote     integer := 0;
  v_rollback    integer := 0;
  v_promote_ids jsonb;
  v_rollback_ids jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'permission denied: admin required';
  END IF;

  WITH base AS (
    SELECT * FROM public.v_seo_bridge_outcome_v1
    WHERE p_link_type IS NULL OR link_type = p_link_type
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE recommendation = 'PROMOTE_RECOMMENDED'),
    COUNT(*) FILTER (WHERE recommendation = 'ROLLBACK_CANDIDATE'),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'suggestion_id', suggestion_id,
       'source_url', source_url,
       'target_url', target_url,
       'lift_pct', target_views_lift_pct))
       FROM base WHERE recommendation = 'PROMOTE_RECOMMENDED'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'suggestion_id', suggestion_id,
       'source_url', source_url,
       'target_url', target_url,
       'lift_pct', target_views_lift_pct))
       FROM base WHERE recommendation = 'ROLLBACK_CANDIDATE'), '[]'::jsonb)
  INTO v_total, v_promote, v_rollback, v_promote_ids, v_rollback_ids
  FROM base;

  RETURN jsonb_build_object(
    'status','ok',
    'link_type', COALESCE(p_link_type, 'ALL'),
    'candidates_total', v_total,
    'promote_recommended', v_promote,
    'rollback_candidates', v_rollback,
    'promote_ids', v_promote_ids,
    'rollback_ids', v_rollback_ids,
    'note', 'Read-only recommendation. Promotion suggested→active must be executed manually.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recommend_bridge_promotion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recommend_bridge_promotion(text) TO authenticated, service_role;