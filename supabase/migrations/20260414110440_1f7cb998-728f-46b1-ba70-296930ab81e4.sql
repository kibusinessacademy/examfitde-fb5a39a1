
-- ═══════════════════════════════════════════════════════════════
-- PART 1: Rewrite init_course_package_steps to be SSOT-aware
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.init_course_package_steps(p_package_id uuid, p_steps text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
  v_track text;
  v_should_run boolean;
BEGIN
  SELECT track::text INTO v_track
  FROM course_packages WHERE id = p_package_id;

  FOREACH s IN ARRAY p_steps LOOP
    SELECT should_run INTO v_should_run
    FROM track_step_applicability
    WHERE track = v_track::product_track AND step_key = s;

    IF v_should_run IS NULL THEN v_should_run := true; END IF;

    INSERT INTO public.package_steps(package_id, step_key, status, meta)
    VALUES (
      p_package_id, s,
      CASE WHEN v_should_run THEN 'queued'::step_status ELSE 'skipped'::step_status END,
      CASE WHEN v_should_run THEN jsonb_build_object('note', 'queued')
           ELSE jsonb_build_object('skip_reason','track_not_applicable','skipped_by','init_course_package_steps_ssot','track',v_track)
      END
    ) ON CONFLICT (package_id, step_key) DO NOTHING;
  END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 2: Rewrite assert_step_backbone to be SSOT-aware
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.assert_step_backbone(uuid);

CREATE OR REPLACE FUNCTION public.assert_step_backbone(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track text;
  v_missing text[];
  v_inserted int := 0;
  v_auto_done int := 0;
  v_step text;
  v_step_status text;
  v_should_run boolean;
  v_mandatory text[] := ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints','generate_blueprint_variants',
    'validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
  v_downstream_map jsonb := '{
    "generate_blueprint_variants": ["validate_blueprint_variants", "promote_blueprint_variants"],
    "validate_blueprint_variants": ["promote_blueprint_variants"],
    "generate_exam_pool": ["validate_exam_pool"],
    "generate_handbook": ["validate_handbook", "enqueue_handbook_expand", "expand_handbook", "validate_handbook_depth"],
    "validate_handbook": ["enqueue_handbook_expand", "expand_handbook", "validate_handbook_depth"],
    "enqueue_handbook_expand": ["expand_handbook", "validate_handbook_depth"],
    "expand_handbook": ["validate_handbook_depth"],
    "generate_oral_exam": ["validate_oral_exam"],
    "generate_learning_content": ["finalize_learning_content", "validate_learning_content"],
    "finalize_learning_content": ["validate_learning_content"],
    "generate_lesson_minichecks": ["validate_lesson_minichecks"],
    "build_ai_tutor_index": ["validate_tutor_index"],
    "scaffold_learning_course": ["generate_glossary", "fanout_learning_content"],
    "elite_harden": ["run_integrity_check", "quality_council", "auto_publish"],
    "run_integrity_check": ["quality_council", "auto_publish"],
    "quality_council": ["auto_publish"]
  }'::jsonb;
  v_downstream_keys text[];
  v_has_done_downstream boolean;
BEGIN
  SELECT track::text INTO v_track FROM course_packages WHERE id = p_package_id;

  SELECT array_agg(m.step_key) INTO v_missing
  FROM unnest(v_mandatory) AS m(step_key)
  LEFT JOIN package_steps ps ON ps.package_id = p_package_id AND ps.step_key = m.step_key
  WHERE ps.step_key IS NULL;

  IF v_missing IS NULL OR array_length(v_missing, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'missing', 0);
  END IF;

  FOREACH v_step IN ARRAY v_missing LOOP
    -- SSOT check
    SELECT should_run INTO v_should_run
    FROM track_step_applicability
    WHERE track = v_track::product_track AND step_key = v_step;
    IF v_should_run IS NULL THEN v_should_run := true; END IF;

    -- If not applicable, skip directly
    IF NOT v_should_run THEN
      INSERT INTO package_steps (package_id, step_key, status, created_at, updated_at, meta)
      VALUES (p_package_id, v_step, 'skipped', now(), now(),
              jsonb_build_object('backfilled_by','assert_step_backbone_ssot','skip_reason','track_not_applicable','track',v_track))
      ON CONFLICT (package_id, step_key) DO NOTHING;
      v_inserted := v_inserted + 1;
      CONTINUE;
    END IF;

    -- Downstream auto-done logic (existing)
    v_has_done_downstream := false;
    v_step_status := 'queued';
    IF v_downstream_map ? v_step THEN
      SELECT array_agg(val.elem) INTO v_downstream_keys
      FROM jsonb_array_elements_text(v_downstream_map -> v_step) AS val(elem);
      IF v_downstream_keys IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = p_package_id AND ps2.step_key = ANY(v_downstream_keys) AND ps2.status = 'done'
        ) INTO v_has_done_downstream;
      END IF;
    END IF;

    IF v_has_done_downstream THEN
      v_step_status := 'done';
      v_auto_done := v_auto_done + 1;
    END IF;

    INSERT INTO package_steps (package_id, step_key, status, created_at, updated_at,
                               started_at, finished_at, meta)
    VALUES (p_package_id, v_step, v_step_status, now(), now(),
            CASE WHEN v_step_status = 'done' THEN now() - interval '1 minute' ELSE NULL END,
            CASE WHEN v_step_status = 'done' THEN now() ELSE NULL END,
            jsonb_build_object('backfilled_by','assert_step_backbone_ssot','backfilled_at',now()::text,'auto_done_downstream',v_has_done_downstream))
    ON CONFLICT (package_id, step_key) DO NOTHING;
    v_inserted := v_inserted + 1;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('backbone_backfill', 'assert_step_backbone', 'package', p_package_id::text, 'healed',
          format('Inserted %s missing steps (%s auto-done): %s', v_inserted, v_auto_done, array_to_string(v_missing, ', ')),
          jsonb_build_object('missing_steps', to_jsonb(v_missing), 'count', v_inserted, 'auto_done', v_auto_done));

  RETURN jsonb_build_object('ok', true, 'missing', array_length(v_missing, 1), 'inserted', v_inserted, 'auto_done', v_auto_done, 'steps', to_jsonb(v_missing));
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Drift Monitor View
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.ops_ssot_step_drift AS
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.track,
  cp.status AS package_status,
  ps.step_key,
  ps.status AS step_status,
  tsa.should_run,
  CASE
    WHEN tsa.should_run = true AND ps.status = 'skipped' THEN 'FALSE_SKIP'
    WHEN tsa.should_run = false AND ps.status NOT IN ('skipped', 'done') THEN 'FALSE_RUN'
  END AS drift_type,
  ps.updated_at AS step_updated_at
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
JOIN track_step_applicability tsa
  ON tsa.track = cp.track AND tsa.step_key = ps.step_key
WHERE cp.status NOT IN ('published', 'archived')
  AND (
    (tsa.should_run = true AND ps.status = 'skipped')
    OR
    (tsa.should_run = false AND tsa.condition IS NULL AND ps.status NOT IN ('skipped', 'done'))
  )
ORDER BY
  CASE WHEN tsa.should_run = true AND ps.status = 'skipped' THEN 0 ELSE 1 END,
  cp.track, ps.step_key;

COMMENT ON VIEW public.ops_ssot_step_drift IS
  'Real-time SSOT drift detector. Should always return 0 rows.';

-- ═══════════════════════════════════════════════════════════════
-- PART 4: DB-level enqueue guard trigger
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_ssot_applicability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_key text;
  v_track text;
  v_should_run boolean;
  v_condition text;
BEGIN
  IF NEW.status != 'pending' OR NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT step_key INTO v_step_key
  FROM (VALUES
    ('package_scaffold_learning_course','scaffold_learning_course'),
    ('package_generate_glossary','generate_glossary'),
    ('package_fanout_learning_content','fanout_learning_content'),
    ('package_generate_learning_content','generate_learning_content'),
    ('package_finalize_learning_content','finalize_learning_content'),
    ('package_validate_learning_content','validate_learning_content'),
    ('package_auto_seed_exam_blueprints','auto_seed_exam_blueprints'),
    ('package_validate_blueprints','validate_blueprints'),
    ('package_generate_blueprint_variants','generate_blueprint_variants'),
    ('package_validate_blueprint_variants','validate_blueprint_variants'),
    ('package_promote_blueprint_variants','promote_blueprint_variants'),
    ('package_generate_exam_pool','generate_exam_pool'),
    ('package_validate_exam_pool','validate_exam_pool'),
    ('package_repair_exam_pool_quality','repair_exam_pool_quality'),
    ('package_build_ai_tutor_index','build_ai_tutor_index'),
    ('package_validate_tutor_index','validate_tutor_index'),
    ('package_generate_oral_exam','generate_oral_exam'),
    ('package_validate_oral_exam','validate_oral_exam'),
    ('package_generate_lesson_minichecks','generate_lesson_minichecks'),
    ('package_validate_lesson_minichecks','validate_lesson_minichecks'),
    ('package_generate_handbook','generate_handbook'),
    ('package_validate_handbook','validate_handbook'),
    ('package_enqueue_handbook_expand','enqueue_handbook_expand'),
    ('handbook_expand_section','expand_handbook'),
    ('package_validate_handbook_depth','validate_handbook_depth'),
    ('package_elite_harden','elite_harden'),
    ('package_run_integrity_check','run_integrity_check'),
    ('package_quality_council','quality_council'),
    ('package_auto_publish','auto_publish')
  ) AS m(job_type, step_key)
  WHERE m.job_type = NEW.job_type;

  IF v_step_key IS NULL THEN RETURN NEW; END IF;

  SELECT track::text INTO v_track FROM course_packages WHERE id = NEW.package_id;
  IF v_track IS NULL THEN RETURN NEW; END IF;

  SELECT tsa.should_run, tsa.condition INTO v_should_run, v_condition
  FROM track_step_applicability tsa
  WHERE tsa.track = v_track::product_track AND tsa.step_key = v_step_key;

  IF v_should_run IS NOT NULL AND v_should_run = false AND v_condition IS NULL THEN
    NEW.status := 'cancelled';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'ssot_applicability_guard',
      'transition_source', 'trg_guard_ssot_applicability',
      'blocked_step', v_step_key,
      'package_track', v_track
    );
    NEW.completed_at := now();

    BEGIN
      PERFORM fn_log_guardrail_event(
        'ssot_applicability_guard',
        jsonb_build_object('job_type', NEW.job_type, 'step_key', v_step_key, 'track', v_track, 'package_id', NEW.package_id)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_ssot_applicability ON job_queue;
CREATE TRIGGER trg_guard_ssot_applicability
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_ssot_applicability();
