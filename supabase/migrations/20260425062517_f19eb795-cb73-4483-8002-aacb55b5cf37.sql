-- =========================================================
-- 1) admin_settings Tabelle (Toggles für Heal-Strategien)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.admin_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read admin_settings" ON public.admin_settings;
CREATE POLICY "admins read admin_settings" ON public.admin_settings
  FOR SELECT USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS "admins write admin_settings" ON public.admin_settings;
CREATE POLICY "admins write admin_settings" ON public.admin_settings
  FOR ALL USING (public.is_admin_user(auth.uid()))
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Default-Toggles
INSERT INTO public.admin_settings (key, value, description) VALUES
  ('heal_strategy_hardish_balance',
    jsonb_build_object('enabled', false, 'last_changed_at', now()),
    'Wenn aktiv, erzeugt admin_resolve_repair_strategy_for_package bei hardish_too_low automatisch einen package_repair_hardish_balance Job statt manual_review_required.'),
  ('heal_strategy_too_few_approved',
    jsonb_build_object('enabled', false, 'last_changed_at', now()),
    'Wenn aktiv, erzeugt der Resolver für TOO_FEW_APPROVED automatisch einen targeted_lf_fill Job (Pflicht-Pool unterhalb min_questions).'),
  ('heal_strategy_isolated_knowledge',
    jsonb_build_object('enabled', false, 'last_changed_at', now()),
    'Wenn aktiv, erzeugt der Resolver bei isolated_knowledge ratio Drift einen targeted_competency_fill Job.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old jsonb;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;
  SELECT value INTO v_old FROM public.admin_settings WHERE key = p_key;
  INSERT INTO public.admin_settings (key, value, updated_at, updated_by)
  VALUES (p_key, p_value, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = auth.uid();

  INSERT INTO public.admin_notifications(title, body, severity, category, entity_type, metadata)
  VALUES ('Heal-Setting geändert',
    format('%s: %s → %s', p_key, COALESCE(v_old::text,'(unset)'), p_value::text),
    'low','admin_settings','admin_setting',
    jsonb_build_object('key',p_key,'old',v_old,'new',p_value,'actor',auth.uid()));

  RETURN jsonb_build_object('ok',true,'key',p_key,'old',v_old,'new',p_value);
END;
$$;

-- =========================================================
-- 2) admin_resolve_repair_strategy_for_package: Hardish-Branch
--    nutzt Setting heal_strategy_hardish_balance
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_repair_strategy_for_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pkg record;
  v_curriculum_id uuid;
  v_competencies_missing_questions uuid[];
  v_lf_missing uuid[];
  v_total_blueprints int;
  v_total_competencies int;
  v_total_lf int;
  v_active_repair_count int;
  v_recent_no_effect_count int;
  v_approved_total int;
  v_hardish_count int;
  v_hardish_pct numeric;
  v_target_hardish_pct numeric := 35;
  v_strategy text;
  v_job_type text;
  v_payload jsonb;
  v_reason text;
  v_hardish_enabled bool := false;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('strategy','forbidden','reason','admin_only');
  END IF;

  SELECT id, curriculum_id, status, track INTO v_pkg
  FROM public.course_packages WHERE id = _package_id;

  IF NOT FOUND OR v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_package_or_curriculum');
  END IF;

  v_curriculum_id := v_pkg.curriculum_id;

  IF v_pkg.track = 'EXAM_FIRST_PLUS' THEN v_target_hardish_pct := 45;
  ELSIF v_pkg.track = 'EXAM_FIRST' THEN v_target_hardish_pct := 35;
  END IF;

  SELECT COALESCE((value->>'enabled')::bool, false) INTO v_hardish_enabled
  FROM public.admin_settings WHERE key = 'heal_strategy_hardish_balance';

  SELECT count(*) INTO v_active_repair_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND status = ANY(public.fn_job_active_statuses())
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality',
      'package_repair_hardish_balance'
    );

  IF v_active_repair_count > 0 THEN
    RETURN jsonb_build_object('strategy','no_action_active_job_exists',
      'reason', format('%s active repair job(s) exist', v_active_repair_count));
  END IF;

  SELECT count(*) INTO v_recent_no_effect_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type IN (
      'package_repair_exam_pool_competency_coverage',
      'package_repair_exam_pool_lf_coverage',
      'package_repair_exam_pool_quality',
      'package_repair_hardish_balance'
    )
    AND status IN ('failed','cancelled')
    AND COALESCE(updated_at, created_at) > now() - interval '24 hours'
    AND (
      COALESCE(meta->>'progress_delta','0')::int = 0
      OR COALESCE(last_error,'') ILIKE '%NO_EFFECT%'
      OR COALESCE(last_error,'') ILIKE '%NO_PROGRESS%'
    );

  IF v_recent_no_effect_count >= 3 THEN
    RETURN jsonb_build_object('strategy','manual_review_required',
      'reason','recent_no_effect_or_no_progress_history');
  END IF;

  SELECT count(*) INTO v_total_lf FROM public.learning_fields lf WHERE lf.curriculum_id = v_curriculum_id;
  SELECT count(*) INTO v_total_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_total_competencies = 0 OR v_total_lf = 0 THEN
    RETURN jsonb_build_object('strategy','manual_review_required','reason','no_curriculum_structure');
  END IF;

  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[]) INTO v_lf_missing
  FROM (
    SELECT lf.id
    FROM public.learning_fields lf
    LEFT JOIN public.exam_questions eq
      ON eq.learning_field_id = lf.id AND eq.curriculum_id = v_curriculum_id
     AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved')
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY lf.id HAVING COUNT(eq.id) = 0
  ) x;

  SELECT COALESCE(array_agg(x.id), ARRAY[]::uuid[]) INTO v_competencies_missing_questions
  FROM (
    SELECT c.id
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    LEFT JOIN public.exam_questions eq
      ON eq.competency_id = c.id AND eq.curriculum_id = v_curriculum_id
     AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved')
    WHERE lf.curriculum_id = v_curriculum_id
    GROUP BY c.id HAVING COUNT(eq.id) < 3
  ) x;

  SELECT count(*) INTO v_approved_total
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved');

  SELECT count(*) INTO v_hardish_count
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND (eq.status='approved' OR eq.qc_status='approved' OR eq.review_state='approved')
    AND eq.difficulty = 'hard'
    AND eq.cognitive_level IN ('apply','analyze','evaluate','create');

  v_hardish_pct := CASE WHEN v_approved_total > 0
    THEN (v_hardish_count::numeric * 100 / v_approved_total) ELSE 0 END;

  SELECT count(*) INTO v_total_blueprints
  FROM public.question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id AND qb.status = 'approved';

  IF array_length(v_lf_missing, 1) > 0 THEN
    v_strategy := 'package_repair_exam_pool_lf_coverage';
    v_job_type := 'package_repair_exam_pool_lf_coverage';
    v_payload  := jsonb_build_object(
      'package_id', _package_id, 'curriculum_id', v_curriculum_id,
      'is_repair', true, 'mode', 'targeted_lf_fill',
      'target_lf_ids', to_jsonb(v_lf_missing),
      'continuation_of_targeted_fill', false, 'continuation_depth', 0,
      'source_cluster', 'REPAIR_LF_COVERAGE'
    );
    v_reason := format('lf_coverage_gap_%s_of_%s', array_length(v_lf_missing,1), v_total_lf);

  ELSIF array_length(v_competencies_missing_questions, 1) > 0 THEN
    IF v_total_blueprints = 0 THEN
      v_strategy := 'package_repair_exam_pool_lf_coverage';
      v_job_type := 'package_repair_exam_pool_lf_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_blueprint_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := 'no_approved_question_blueprints';
    ELSE
      v_strategy := 'package_repair_exam_pool_competency_coverage';
      v_job_type := 'package_repair_exam_pool_competency_coverage';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_competency_fill',
        'target_competency_ids', to_jsonb(v_competencies_missing_questions),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_COMPETENCY_COVERAGE'
      );
      v_reason := format('missing_min_questions_for_%s_competencies', array_length(v_competencies_missing_questions,1));
    END IF;

  ELSIF v_approved_total >= 50 AND v_hardish_pct < v_target_hardish_pct THEN
    IF v_hardish_enabled THEN
      v_strategy := 'package_repair_hardish_balance';
      v_job_type := 'package_repair_hardish_balance';
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'is_repair', true, 'mode', 'targeted_difficulty_fill',
        'current_hardish_pct', v_hardish_pct,
        'target_hardish_pct', v_target_hardish_pct,
        'gap_pct', round(v_target_hardish_pct - v_hardish_pct, 2),
        'continuation_of_targeted_fill', false, 'continuation_depth', 0,
        'source_cluster', 'REPAIR_HARDISH_TOO_LOW'
      );
      v_reason := format('hardish_too_low_%s_pct_target_%s_pct_handler_active',
        round(v_hardish_pct,1), round(v_target_hardish_pct,0));
    ELSE
      v_strategy := 'manual_review_required';
      v_job_type := NULL;
      v_payload  := jsonb_build_object(
        'package_id', _package_id, 'curriculum_id', v_curriculum_id,
        'detected_gap', 'hardish_too_low',
        'current_hardish_pct', v_hardish_pct,
        'target_hardish_pct', v_target_hardish_pct,
        'recommended_action', 'enable heal_strategy_hardish_balance setting',
        'source_cluster', 'REPAIR_HARDISH_TOO_LOW'
      );
      v_reason := format('hardish_too_low_%s_pct_target_%s_pct_handler_not_implemented',
        round(v_hardish_pct,1), round(v_target_hardish_pct,0));
    END IF;

  ELSE
    v_strategy := 'no_action_no_deficit';
    v_job_type := NULL;
    v_payload  := '{}'::jsonb;
    v_reason   := format('all_gates_ok_approved=%s_lf=%s_comp=%s_hardish=%s',
      v_approved_total, v_total_lf, v_total_competencies, round(v_hardish_pct,1));
  END IF;

  RETURN jsonb_build_object(
    'strategy', v_strategy, 'job_type', v_job_type,
    'payload',  v_payload, 'reason',   v_reason,
    'target_competency_ids', to_jsonb(COALESCE(v_competencies_missing_questions,'{}'::uuid[])),
    'target_lf_ids',         to_jsonb(COALESCE(v_lf_missing,'{}'::uuid[])),
    'total_competencies',    v_total_competencies,
    'total_lf',              v_total_lf,
    'total_blueprints',      v_total_blueprints,
    'approved_questions',    v_approved_total,
    'hardish_pct',           v_hardish_pct,
    'target_hardish_pct',    v_target_hardish_pct,
    'hardish_handler_enabled', v_hardish_enabled
  );
END;
$function$;

-- =========================================================
-- 3) admin_get_audit_reason_drilldown
--    Liefert für ein Paket + Reason-Substring die rohen
--    integrity_check_history und audit-Einträge
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_get_audit_reason_drilldown(
  p_package_id uuid,
  p_reason_substr text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_history jsonb;
  v_audit jsonb;
  v_notifications jsonb;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.created_at DESC), '[]'::jsonb) INTO v_history
  FROM (
    SELECT id, package_id, score, passed, hard_fail_count, hard_fail_reasons,
           trigger_source, job_id, no_progress_blocked, created_at
    FROM public.integrity_check_history
    WHERE package_id = p_package_id
      AND (p_reason_substr IS NULL
           OR EXISTS (
             SELECT 1 FROM unnest(hard_fail_reasons) r
             WHERE r ILIKE '%' || p_reason_substr || '%'
           ))
    ORDER BY created_at DESC
    LIMIT p_limit
  ) h;

  SELECT COALESCE(jsonb_agg(row_to_json(a) ORDER BY a.created_at DESC), '[]'::jsonb) INTO v_audit
  FROM (
    SELECT id, step_key, prev_status, prev_meta, new_meta,
           meta_ok, meta_executed, source_fn, blocked, block_reason, created_at
    FROM public.step_done_meta_audit
    WHERE package_id = p_package_id
      AND (p_reason_substr IS NULL
           OR (block_reason ILIKE '%' || p_reason_substr || '%'
               OR new_meta::text ILIKE '%' || p_reason_substr || '%'
               OR prev_meta::text ILIKE '%' || p_reason_substr || '%'))
    ORDER BY created_at DESC
    LIMIT p_limit
  ) a;

  SELECT COALESCE(jsonb_agg(row_to_json(n) ORDER BY n.created_at DESC), '[]'::jsonb) INTO v_notifications
  FROM (
    SELECT id, title, body, severity, category, metadata, created_at
    FROM public.admin_notifications
    WHERE entity_id = p_package_id
      AND (p_reason_substr IS NULL
           OR body ILIKE '%' || p_reason_substr || '%'
           OR title ILIKE '%' || p_reason_substr || '%'
           OR metadata::text ILIKE '%' || p_reason_substr || '%')
    ORDER BY created_at DESC
    LIMIT p_limit
  ) n;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'reason_substr', p_reason_substr,
    'integrity_history', v_history,
    'step_audit', v_audit,
    'notifications', v_notifications,
    'fetched_at', now()
  );
END;
$$;

-- =========================================================
-- 4) admin_healcheck_cluster_explanation
--    Pro Cluster: known_via='produced_data'|'view_defn'|'unknown'
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_healcheck_cluster_explanation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_view_def text;
  v_clusters_in_view text[];
  v_clusters_produced text[];
  v_known_clusters text[] := ARRAY[
    'STALE_LOCK_LOOP_HARD_KILL','REQUEUE_LOOP_KILLED','UNCLASSIFIED_EMPTY',
    'HARD_FAIL_REPAIR_EXHAUSTED','REPAIR_COMPETENCY_COVERAGE','REPAIR_LF_COVERAGE',
    'REPAIR_HARDISH_TOO_LOW','REPAIR_INSUFFICIENT_QUESTIONS',
    'TIMEOUT','RATE_LIMIT','NETWORK_ERROR','WATCHDOG_RECOVERY',
    'COOLDOWN_ACTIVE','WIP_LIMIT','NON_BUILDING_PACKAGE',
    'HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS','HARD_FAIL_BREAKER',
    'QUALITY_THRESHOLD_NOT_MET','INTEGRITY_FAIL','DB_CONSTRAINT','PARSE_ERROR','AUTH_ERROR'
  ];
  v_explanations jsonb := '[]'::jsonb;
  v_cluster text;
  v_in_view bool;
  v_in_produced bool;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  SELECT pg_get_viewdef('public.v_admin_queue_job_classification'::regclass, true) INTO v_view_def;

  SELECT COALESCE(array_agg(DISTINCT cluster), ARRAY[]::text[]) INTO v_clusters_produced
  FROM public.v_admin_queue_job_classification;

  FOREACH v_cluster IN ARRAY v_known_clusters LOOP
    v_in_view := (v_view_def LIKE '%''' || v_cluster || '''::text%');
    v_in_produced := v_cluster = ANY (v_clusters_produced);
    v_explanations := v_explanations || jsonb_build_object(
      'cluster', v_cluster,
      'known_via', CASE
        WHEN v_in_produced THEN 'produced_data'
        WHEN v_in_view THEN 'view_defn'
        ELSE 'unknown'
      END,
      'in_produced_data', v_in_produced,
      'in_view_defn', v_in_view
    );
  END LOOP;

  RETURN jsonb_build_object(
    'clusters', v_explanations,
    'view_def_length', length(v_view_def),
    'produced_clusters_total', coalesce(array_length(v_clusters_produced,1),0),
    'fetched_at', now()
  );
END;
$$;

-- =========================================================
-- 5) admin_refresh_integrity_check_with_diff
--    Enqueued einen frischen package_run_integrity_check (falls
--    nicht bereits aktiv) und liefert reasons-Diff vorher/nachher.
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_refresh_integrity_check_with_diff(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count int;
  v_prev_reasons text[];
  v_prev_score int;
  v_prev_id uuid;
  v_new_job_id uuid;
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  SELECT count(*) INTO v_active_count
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type = 'package_run_integrity_check'
    AND status = ANY(public.fn_job_active_statuses());

  IF v_active_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'reason', 'active_integrity_job_exists',
      'active_count', v_active_count
    );
  END IF;

  SELECT id, hard_fail_reasons, score
    INTO v_prev_id, v_prev_reasons, v_prev_score
  FROM public.integrity_check_history
  WHERE package_id = p_package_id
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.job_queue(job_type, package_id, payload, status, run_after, priority, max_attempts, meta)
  VALUES ('package_run_integrity_check', p_package_id,
    jsonb_build_object('package_id', p_package_id, 'admin_refresh', true),
    'pending', now() + interval '5 seconds', 100, 3,
    jsonb_build_object('admin_refresh', true, 'requested_by', auth.uid(),
      'prev_history_id', v_prev_id, 'prev_reasons', to_jsonb(v_prev_reasons)))
  RETURNING id INTO v_new_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued_job_id', v_new_job_id,
    'package_id', p_package_id,
    'prev_history_id', v_prev_id,
    'prev_score', v_prev_score,
    'prev_reasons', to_jsonb(v_prev_reasons),
    'note', 'poll admin_get_integrity_diff(p_package_id, prev_history_id) after job completes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_integrity_diff(
  p_package_id uuid,
  p_prev_history_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev record;
  v_curr record;
  v_added text[];
  v_removed text[];
BEGIN
  IF NOT public.is_admin_user(auth.uid()) THEN
    RETURN jsonb_build_object('error','admin_only');
  END IF;

  IF p_prev_history_id IS NOT NULL THEN
    SELECT id, hard_fail_reasons, score, passed, created_at INTO v_prev
    FROM public.integrity_check_history WHERE id = p_prev_history_id;
  ELSE
    SELECT id, hard_fail_reasons, score, passed, created_at INTO v_prev
    FROM public.integrity_check_history
    WHERE package_id = p_package_id
    ORDER BY created_at DESC OFFSET 1 LIMIT 1;
  END IF;

  SELECT id, hard_fail_reasons, score, passed, created_at INTO v_curr
  FROM public.integrity_check_history
  WHERE package_id = p_package_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_curr.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_history_found');
  END IF;

  IF v_prev.id IS NULL OR v_prev.id = v_curr.id THEN
    RETURN jsonb_build_object(
      'ok', true, 'has_diff', false,
      'curr', jsonb_build_object('id', v_curr.id, 'reasons', to_jsonb(v_curr.hard_fail_reasons),
        'score', v_curr.score, 'passed', v_curr.passed, 'created_at', v_curr.created_at),
      'note', 'no previous history to compare'
    );
  END IF;

  SELECT COALESCE(array_agg(r), ARRAY[]::text[]) INTO v_added
  FROM unnest(COALESCE(v_curr.hard_fail_reasons, ARRAY[]::text[])) r
  WHERE r <> ALL (COALESCE(v_prev.hard_fail_reasons, ARRAY[]::text[]));

  SELECT COALESCE(array_agg(r), ARRAY[]::text[]) INTO v_removed
  FROM unnest(COALESCE(v_prev.hard_fail_reasons, ARRAY[]::text[])) r
  WHERE r <> ALL (COALESCE(v_curr.hard_fail_reasons, ARRAY[]::text[]));

  RETURN jsonb_build_object(
    'ok', true, 'has_diff', true,
    'prev', jsonb_build_object('id', v_prev.id, 'reasons', to_jsonb(v_prev.hard_fail_reasons),
      'score', v_prev.score, 'passed', v_prev.passed, 'created_at', v_prev.created_at),
    'curr', jsonb_build_object('id', v_curr.id, 'reasons', to_jsonb(v_curr.hard_fail_reasons),
      'score', v_curr.score, 'passed', v_curr.passed, 'created_at', v_curr.created_at),
    'reasons_added', to_jsonb(v_added),
    'reasons_removed', to_jsonb(v_removed),
    'score_delta', v_curr.score - v_prev.score
  );
END;
$$;

-- =========================================================
-- 6) Stale-Audit-Cleanup: Setze meta.superseded auf alte
--    preview_skip Notifications mit hardish_too_low Reason,
--    damit das Cluster verschwindet.
-- =========================================================
UPDATE public.admin_notifications
SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
  'superseded', true,
  'superseded_at', now(),
  'superseded_reason', 'hardish_handler_governance_v2'
)
WHERE category = 'auto_heal_audit'
  AND body ILIKE '%hardish_too_low%'
  AND created_at < now() - interval '6 hours'
  AND NOT COALESCE((metadata->>'superseded')::bool, false);