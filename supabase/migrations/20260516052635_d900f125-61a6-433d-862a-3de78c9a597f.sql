
-- ============================================================
-- SEO Backlog Expansion v1 — cluster_priority Upgrade for additional
-- publishable curricula. Prepares Pillar-Push mode by lifting publishable
-- curricula from "no seo_content_priority_queue rows" into selectable scope.
--
-- Producer: admin_seo_backlog_expand
-- SSOT: seo_content_priority_queue (insert-only here, idempotent UPSERT)
-- Audit: auto_heal_log action_type='seo_backlog_expand_attempt'
-- Caller: admin only (has_role('admin')); no cron — manual orchestration.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_seo_backlog_expand(
  p_limit                 integer  DEFAULT 25,
  p_dry_run               boolean  DEFAULT true,
  p_min_package_priority  integer  DEFAULT 4,
  p_curricula             uuid[]   DEFAULT NULL,
  p_default_cluster_prio  integer  DEFAULT 5,
  p_wave_tag              text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_audit_id      uuid := gen_random_uuid();
  v_limit         integer := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_min_prio      integer := GREATEST(1, LEAST(COALESCE(p_min_package_priority, 4), 10));
  v_default_prio  integer := GREATEST(1, LEAST(COALESCE(p_default_cluster_prio, 5), 10));
  v_selected      jsonb := '[]'::jsonb;
  v_inserted      integer := 0;
  v_skipped       integer := 0;
  v_intents       text[] := ARRAY['intent_pruefungsfragen','intent_lernplan','intent_typische_fehler','intent_durchfallquote'];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_seo_backlog_expand: forbidden (admin only)';
  END IF;

  -- Pick candidates: publishable curricula NOT yet in seo_content_priority_queue,
  -- ranked by course_packages.priority desc, filtered by p_min_package_priority,
  -- optionally restricted to p_curricula.
  WITH pubs AS (
    SELECT DISTINCT ON (cp.curriculum_id)
           cp.curriculum_id,
           cp.id            AS package_id,
           cp.priority      AS pkg_priority,
           cp.title         AS pkg_title
    FROM course_packages cp
    WHERE cp.status = 'published'
      AND cp.curriculum_id IS NOT NULL
    ORDER BY cp.curriculum_id, cp.priority DESC NULLS LAST, cp.created_at DESC
  ),
  filtered AS (
    SELECT p.curriculum_id, p.package_id, p.pkg_priority, p.pkg_title, cu.title AS curriculum_title,
           (SELECT cm.id
              FROM competencies cm
              JOIN learning_fields lf ON lf.id = cm.learning_field_id
             WHERE lf.curriculum_id = p.curriculum_id
             ORDER BY lf.sort_order NULLS LAST, cm.sort_order NULLS LAST
             LIMIT 1) AS first_competency_id
    FROM pubs p
    JOIN curricula cu ON cu.id = p.curriculum_id
    WHERE COALESCE(p.pkg_priority, 0) >= v_min_prio
      AND (p_curricula IS NULL OR p.curriculum_id = ANY(p_curricula))
      AND NOT EXISTS (
        SELECT 1 FROM seo_content_priority_queue q
        WHERE q.curriculum_id = p.curriculum_id
      )
  ),
  ranked AS (
    SELECT *,
           LEAST(GREATEST(COALESCE(pkg_priority, v_default_prio) + 1, 3), 7) AS derived_cluster_priority
    FROM filtered
    WHERE first_competency_id IS NOT NULL
    ORDER BY pkg_priority DESC NULLS LAST, curriculum_title ASC
    LIMIT v_limit
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'curriculum_id',     curriculum_id,
      'curriculum_title',  curriculum_title,
      'package_id',        package_id,
      'package_priority',  pkg_priority,
      'competency_id',     first_competency_id,
      'cluster_priority',  derived_cluster_priority
    )
    ORDER BY pkg_priority DESC NULLS LAST, curriculum_title
  )
  INTO v_selected
  FROM ranked;

  v_selected := COALESCE(v_selected, '[]'::jsonb);

  IF p_dry_run THEN
    INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
    VALUES (
      'seo_backlog_expand_attempt', 'seo', v_audit_id::text, 'dry_run',
      jsonb_build_object(
        'audit_id',        v_audit_id,
        'mode',            'dry_run',
        'limit',           v_limit,
        'min_pkg_prio',    v_min_prio,
        'selected_count',  jsonb_array_length(v_selected),
        'wave_tag',        p_wave_tag,
        'selected',        v_selected
      )
    );

    RETURN jsonb_build_object(
      'ok',             true,
      'dry_run',        true,
      'audit_id',       v_audit_id,
      'selected_count', jsonb_array_length(v_selected),
      'selected',       v_selected
    );
  END IF;

  -- Real run: insert 4 intent rows per selected curriculum (idempotent via UNIQUE).
  WITH src AS (
    SELECT (elem->>'curriculum_id')::uuid    AS curriculum_id,
           (elem->>'competency_id')::uuid    AS competency_id,
           (elem->>'cluster_priority')::int  AS cluster_priority,
           elem->>'curriculum_title'         AS curriculum_title
    FROM jsonb_array_elements(v_selected) AS elem
  ),
  expanded AS (
    SELECT s.curriculum_id, s.competency_id, intent AS intent_key,
           'azubi'::text AS persona_type, s.cluster_priority, s.curriculum_title
    FROM src s
    CROSS JOIN UNNEST(v_intents) AS intent
  ),
  ins AS (
    INSERT INTO seo_content_priority_queue (
      curriculum_id, competency_id, intent_key, persona_type,
      cluster_priority, semrush_volume, thin_content_risk,
      generation_status, package_publish_eligible, notes
    )
    SELECT e.curriculum_id, e.competency_id, e.intent_key, e.persona_type,
           e.cluster_priority, 0, 'unknown',
           'planned', true,
           'seo_backlog_expand|audit='||v_audit_id::text||COALESCE('|wave_tag='||p_wave_tag, '')
    FROM expanded e
    ON CONFLICT (curriculum_id, competency_id, intent_key, persona_type) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;

  v_skipped := GREATEST(0, jsonb_array_length(v_selected) * 4 - v_inserted);

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'seo_backlog_expand_attempt', 'seo', v_audit_id::text, 'ok',
    jsonb_build_object(
      'audit_id',          v_audit_id,
      'mode',              'apply',
      'limit',             v_limit,
      'min_pkg_prio',      v_min_prio,
      'selected_count',    jsonb_array_length(v_selected),
      'inserted_rows',     v_inserted,
      'skipped_rows',      v_skipped,
      'wave_tag',          p_wave_tag,
      'selected',          v_selected
    )
  );

  RETURN jsonb_build_object(
    'ok',             true,
    'dry_run',        false,
    'audit_id',       v_audit_id,
    'selected_count', jsonb_array_length(v_selected),
    'inserted_rows',  v_inserted,
    'skipped_rows',   v_skipped,
    'selected',       v_selected
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_seo_backlog_expand(integer, boolean, integer, uuid[], integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_seo_backlog_expand(integer, boolean, integer, uuid[], integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_backlog_expand(integer, boolean, integer, uuid[], integer, text) TO authenticated;
-- has_role gate inside fn protects against non-admin authenticated callers.

COMMENT ON FUNCTION public.admin_seo_backlog_expand(integer, boolean, integer, uuid[], integer, text) IS
$$SEO Backlog Expansion v1 — picks top-N publishable curricula NOT yet present in
seo_content_priority_queue (filtered by course_packages.priority >= p_min_package_priority,
optional p_curricula whitelist), and inserts 4 azubi-persona intent rows per curriculum
with cluster_priority = LEAST(GREATEST(pkg.priority+1, 3), 7).

Idempotent via UNIQUE(curriculum_id, competency_id, intent_key, persona_type).
Audit in auto_heal_log action_type='seo_backlog_expand_attempt'.
Admin-only (has_role gate). No cron. Manual orchestration for Pillar-Push prep.$$;
