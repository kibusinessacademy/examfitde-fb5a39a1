CREATE OR REPLACE VIEW public.v_soft_drift_packages_ssot AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.curriculum_id, cp.track, cp.status
  FROM course_packages cp WHERE cp.status = 'published'
),
hb AS (
  SELECT p.package_id,
         COUNT(*) FILTER (WHERE hc.id IS NOT NULL) AS hb_total,
         COUNT(*) FILTER (WHERE hc.id IS NOT NULL AND hc.is_published) AS hb_published
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
mc AS (
  SELECT p.package_id,
         COUNT(mq.id) AS mc_total,
         COUNT(*) FILTER (WHERE mq.status = 'approved') AS mc_approved
  FROM pkg p
  LEFT JOIN minicheck_questions mq ON mq.package_id = p.package_id
  GROUP BY p.package_id
),
hb_required AS (SELECT track FROM track_step_applicability WHERE step_key='generate_handbook' AND should_run=true),
mc_required AS (SELECT track FROM track_step_applicability WHERE step_key='generate_lesson_minichecks' AND should_run=true)
SELECT p.package_id, p.package_title, p.track,
       hb.hb_total, hb.hb_published,
       CASE WHEN hb.hb_total = 0 THEN NULL ELSE ROUND(100.0 * hb.hb_published / hb.hb_total, 1) END AS hb_publish_pct,
       (p.track IN (SELECT track FROM hb_required)) AS hb_required,
       mc.mc_total, mc.mc_approved,
       CASE WHEN mc.mc_total = 0 THEN NULL ELSE ROUND(100.0 * mc.mc_approved / mc.mc_total, 1) END AS mc_approval_pct,
       (p.track IN (SELECT track FROM mc_required)) AS mc_required,
       (hb.hb_total > 0 AND hb.hb_published < hb.hb_total) AS hb_partial_drift,
       (mc.mc_total > 0 AND (mc.mc_approved::numeric / NULLIF(mc.mc_total,0)) < 0.85) AS mc_approval_drift,
       (
         CASE WHEN hb.hb_total > 0 AND hb.hb_published < hb.hb_total
              THEN (1 - hb.hb_published::numeric / hb.hb_total) * 100
                   * CASE WHEN p.track IN (SELECT track FROM hb_required) THEN 2 ELSE 1 END
              ELSE 0 END
       + CASE WHEN mc.mc_total > 0 AND (mc.mc_approved::numeric / mc.mc_total) < 0.85
              THEN (0.85 - mc.mc_approved::numeric / mc.mc_total) * 100
                   * CASE WHEN p.track IN (SELECT track FROM mc_required) THEN 2 ELSE 1 END
              ELSE 0 END
       )::numeric(8,2) AS risk_score
FROM pkg p
LEFT JOIN hb ON hb.package_id = p.package_id
LEFT JOIN mc ON mc.package_id = p.package_id;

REVOKE ALL ON public.v_soft_drift_packages_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_soft_drift_packages_ssot TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_soft_drift_top(_limit int DEFAULT 20)
RETURNS TABLE (
  package_id uuid, package_title text, track text,
  hb_published int, hb_total int, hb_publish_pct numeric, hb_required boolean,
  mc_approved bigint, mc_total bigint, mc_approval_pct numeric, mc_required boolean,
  hb_partial_drift boolean, mc_approval_drift boolean,
  risk_score numeric, recommended_heal text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.package_id, v.package_title, v.track,
         v.hb_published::int, v.hb_total::int, v.hb_publish_pct, v.hb_required,
         v.mc_approved, v.mc_total, v.mc_approval_pct, v.mc_required,
         v.hb_partial_drift, v.mc_approval_drift, v.risk_score,
         CASE
           WHEN v.hb_partial_drift AND v.mc_approval_drift
             THEN 'admin_publish_handbook_remaining + mc_targeted_repair (review-only)'
           WHEN v.hb_partial_drift AND v.hb_required
             THEN 'admin_publish_handbook_remaining (track requires handbook)'
           WHEN v.hb_partial_drift
             THEN 'admin_publish_handbook_remaining (optional track, low priority)'
           WHEN v.mc_approval_drift AND v.mc_required
             THEN 'mc_targeted_repair: re-run package_quality_council scoped to MC'
           WHEN v.mc_approval_drift
             THEN 'mc_review_only: enqueue council in review-only mode'
           ELSE 'no action — within tolerance'
         END
  FROM public.v_soft_drift_packages_ssot v
  WHERE has_role(auth.uid(),'admin')
    AND (v.hb_partial_drift OR v.mc_approval_drift)
  ORDER BY v.risk_score DESC NULLS LAST, v.package_title
  LIMIT GREATEST(1, COALESCE(_limit, 20));
$$;

REVOKE ALL ON FUNCTION public.admin_get_soft_drift_top(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_soft_drift_top(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_soft_drift_summary()
RETURNS TABLE (cluster text, pkg_count bigint, required_count bigint, optional_count bigint, avg_risk numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'HB_PARTIAL',
         COUNT(*) FILTER (WHERE hb_partial_drift),
         COUNT(*) FILTER (WHERE hb_partial_drift AND hb_required),
         COUNT(*) FILTER (WHERE hb_partial_drift AND NOT hb_required),
         ROUND(AVG(risk_score) FILTER (WHERE hb_partial_drift), 2)
  FROM public.v_soft_drift_packages_ssot WHERE has_role(auth.uid(),'admin')
  UNION ALL
  SELECT 'MC_APPROVAL',
         COUNT(*) FILTER (WHERE mc_approval_drift),
         COUNT(*) FILTER (WHERE mc_approval_drift AND mc_required),
         COUNT(*) FILTER (WHERE mc_approval_drift AND NOT mc_required),
         ROUND(AVG(risk_score) FILTER (WHERE mc_approval_drift), 2)
  FROM public.v_soft_drift_packages_ssot WHERE has_role(auth.uid(),'admin')
  UNION ALL
  SELECT 'BOTH',
         COUNT(*) FILTER (WHERE hb_partial_drift AND mc_approval_drift),
         COUNT(*) FILTER (WHERE hb_partial_drift AND mc_approval_drift AND (hb_required OR mc_required)),
         COUNT(*) FILTER (WHERE hb_partial_drift AND mc_approval_drift AND NOT (hb_required OR mc_required)),
         ROUND(AVG(risk_score) FILTER (WHERE hb_partial_drift AND mc_approval_drift), 2)
  FROM public.v_soft_drift_packages_ssot WHERE has_role(auth.uid(),'admin');
$$;

REVOKE ALL ON FUNCTION public.admin_get_soft_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_soft_drift_summary() TO authenticated;

INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('soft_drift_diagnostics_installed','system','success',
  jsonb_build_object(
    'view','v_soft_drift_packages_ssot',
    'rpcs', ARRAY['admin_get_soft_drift_top','admin_get_soft_drift_summary'],
    'policy_decision','EXAM_FIRST stays handbook/MC-free per track_step_applicability; hollow scope already restricted to required tracks via v_hollow_published_learning_required',
    'no_repair', true
  ));