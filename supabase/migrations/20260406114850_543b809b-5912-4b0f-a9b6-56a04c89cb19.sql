
-- 1. Audit log table
CREATE TABLE IF NOT EXISTS public.system_heal_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  heal_type text NOT NULL,
  package_id uuid,
  step_key text,
  job_id uuid,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_heal_log ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing view to avoid column name conflicts
DROP VIEW IF EXISTS public.v_ops_ghost_completions CASCADE;

-- 3. Refined ghost completions view
CREATE VIEW public.v_ops_ghost_completions AS
WITH latest_completed AS (
  SELECT DISTINCT ON (jq.package_id, jq.job_type)
    jq.id AS job_id,
    jq.package_id,
    jq.job_type,
    jq.status AS job_status,
    jq.updated_at AS job_completed_at
  FROM job_queue jq
  WHERE jq.status = 'completed'
  ORDER BY jq.package_id, jq.job_type, jq.updated_at DESC
),
step_map AS (
  SELECT unnest(ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ]) AS step_key,
  unnest(ARRAY[
    'package_scaffold_learning_course','package_generate_glossary','package_fanout_learning_content',
    'package_generate_learning_content','package_finalize_learning_content','package_validate_learning_content',
    'package_auto_seed_exam_blueprints','package_validate_blueprints',
    'package_generate_blueprint_variants','package_validate_blueprint_variants','package_promote_blueprint_variants',
    'package_generate_exam_pool','package_validate_exam_pool','package_repair_exam_pool_quality',
    'package_build_ai_tutor_index','package_validate_tutor_index',
    'package_generate_oral_exam','package_validate_oral_exam',
    'package_generate_lesson_minichecks','package_validate_lesson_minichecks',
    'package_generate_handbook','package_validate_handbook',
    'package_enqueue_handbook_expand','handbook_expand_section','package_validate_handbook_depth',
    'package_elite_harden','package_run_integrity_check','package_quality_council','package_auto_publish'
  ]) AS job_type
)
SELECT
  ps.package_id,
  cp.status AS pkg_status,
  cp.priority,
  cp.track,
  c.title,
  ps.step_key,
  ps.status AS step_status,
  lc.job_id,
  lc.job_status,
  lc.job_completed_at,
  EXISTS (
    SELECT 1 FROM job_queue sib
    WHERE sib.package_id = ps.package_id
      AND sib.job_type = sm.job_type
      AND sib.status IN ('pending', 'processing')
  ) AS has_active_siblings,
  EXTRACT(EPOCH FROM (now() - lc.job_completed_at)) / 60.0 AS minutes_since_completion
FROM package_steps ps
JOIN step_map sm ON sm.step_key = ps.step_key
JOIN latest_completed lc ON lc.package_id = ps.package_id AND lc.job_type = sm.job_type
JOIN course_packages cp ON cp.id = ps.package_id
LEFT JOIN courses c ON c.id = cp.course_id
WHERE ps.status = 'queued'
  AND lc.job_status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM job_queue sib
    WHERE sib.package_id = ps.package_id
      AND sib.job_type = sm.job_type
      AND sib.status IN ('pending', 'processing')
  )
  AND lc.job_completed_at < now() - interval '5 minutes';

-- 4. Safe-mode ghost healer
CREATE OR REPLACE FUNCTION public.fn_heal_ghost_completions(
  p_mode text DEFAULT 'detect_only'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_safe_steps text[] := ARRAY[
    'auto_seed_exam_blueprints', 'validate_blueprints',
    'generate_glossary', 'scaffold_learning_course',
    'build_ai_tutor_index', 'generate_handbook', 'validate_handbook',
    'finalize_learning_content', 'fanout_learning_content',
    'validate_learning_content', 'validate_lesson_minichecks',
    'validate_oral_exam', 'validate_tutor_index',
    'validate_handbook_depth', 'enqueue_handbook_expand',
    'elite_harden', 'validate_blueprint_variants',
    'promote_blueprint_variants'
  ];
  v_detected int := 0;
  v_healed int := 0;
  v_skipped int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM v_ops_ghost_completions
    WHERE pkg_status IN ('building', 'blocked', 'quality_gate_failed')
    ORDER BY priority, package_id
  LOOP
    v_detected := v_detected + 1;
    IF p_mode = 'heal_safe' AND rec.step_key = ANY(v_safe_steps) THEN
      UPDATE package_steps
      SET status = 'done',
          started_at = COALESCE(started_at, now()),
          attempts = GREATEST(attempts, 1),
          updated_at = now()
      WHERE package_id = rec.package_id
        AND step_key = rec.step_key
        AND status = 'queued';
      IF FOUND THEN
        v_healed := v_healed + 1;
        INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
        VALUES ('ghost_completion', rec.package_id, rec.step_key, rec.job_id,
                jsonb_build_object('mode', 'heal_safe', 'title', rec.title, 'track', rec.track));
      END IF;
      v_details := array_append(v_details, jsonb_build_object(
        'action', 'healed', 'step', rec.step_key, 'package', rec.package_id, 'title', rec.title));
    ELSE
      v_skipped := v_skipped + 1;
      INSERT INTO system_heal_log (heal_type, package_id, step_key, job_id, details)
      VALUES ('detect_only', rec.package_id, rec.step_key, rec.job_id,
              jsonb_build_object('mode', p_mode, 'reason',
                CASE WHEN p_mode = 'detect_only' THEN 'detect_only_mode'
                     ELSE 'step_not_in_safe_whitelist' END,
                'title', rec.title, 'track', rec.track));
      v_details := array_append(v_details, jsonb_build_object(
        'action', 'detected_only', 'step', rec.step_key, 'package', rec.package_id, 'title', rec.title));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('detected', v_detected, 'healed', v_healed,
    'skipped_unsafe', v_skipped, 'mode', p_mode, 'items', to_jsonb(v_details));
END;
$$;

-- 5. Orphan step reconciler
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
  v_job_type text;
  v_pool text;
  v_step_jobs jsonb := '{
    "scaffold_learning_course": "package_scaffold_learning_course",
    "generate_glossary": "package_generate_glossary",
    "fanout_learning_content": "package_fanout_learning_content",
    "generate_learning_content": "package_generate_learning_content",
    "finalize_learning_content": "package_finalize_learning_content",
    "validate_learning_content": "package_validate_learning_content",
    "auto_seed_exam_blueprints": "package_auto_seed_exam_blueprints",
    "validate_blueprints": "package_validate_blueprints",
    "generate_blueprint_variants": "package_generate_blueprint_variants",
    "validate_blueprint_variants": "package_validate_blueprint_variants",
    "promote_blueprint_variants": "package_promote_blueprint_variants",
    "generate_exam_pool": "package_generate_exam_pool",
    "validate_exam_pool": "package_validate_exam_pool",
    "repair_exam_pool_quality": "package_repair_exam_pool_quality",
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "generate_lesson_minichecks": "package_generate_lesson_minichecks",
    "validate_lesson_minichecks": "package_validate_lesson_minichecks",
    "generate_handbook": "package_generate_handbook",
    "validate_handbook": "package_validate_handbook",
    "enqueue_handbook_expand": "package_enqueue_handbook_expand",
    "expand_handbook": "handbook_expand_section",
    "validate_handbook_depth": "package_validate_handbook_depth",
    "elite_harden": "package_elite_harden",
    "run_integrity_check": "package_run_integrity_check",
    "quality_council": "package_quality_council",
    "auto_publish": "package_auto_publish"
  }'::jsonb;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.priority, c.title
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = (v_step_jobs ->> ps.step_key)
          AND jq.status IN ('pending', 'processing')
      )
      AND (v_step_jobs ->> ps.step_key) IS NOT NULL
      AND ps.updated_at < now() - interval '10 minutes'
    ORDER BY cp.priority, ps.package_id
    LIMIT 20
  LOOP
    v_job_type := v_step_jobs ->> rec.step_key;
    v_pool := CASE
      WHEN v_job_type IN ('package_generate_learning_content','package_generate_glossary',
        'package_generate_handbook','package_generate_oral_exam','package_generate_lesson_minichecks',
        'package_generate_exam_pool','package_generate_blueprint_variants',
        'lesson_generate_content_shard','handbook_expand_section') THEN 'content'
      ELSE 'core'
    END;
    INSERT INTO job_queue (package_id, job_type, worker_pool, status, priority, meta)
    VALUES (rec.package_id, v_job_type, v_pool, 'pending', rec.priority,
            jsonb_build_object('source', 'orphan_reconciler', 'step_key', rec.step_key))
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      v_reconciled := v_reconciled + 1;
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('orphan_step', rec.package_id, rec.step_key,
              jsonb_build_object('job_type', v_job_type, 'pool', v_pool, 'title', rec.title));
      v_details := array_append(v_details, jsonb_build_object(
        'step', rec.step_key, 'package', rec.package_id, 'job_type', v_job_type, 'title', rec.title));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reconciled', v_reconciled, 'items', to_jsonb(v_details));
END;
$$;
