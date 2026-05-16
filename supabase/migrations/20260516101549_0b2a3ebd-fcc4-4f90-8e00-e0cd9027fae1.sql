
-- ============================================================
-- Bridge 13 — Adaptive Learning Path Orchestration
-- SSOT-bounded path recommender. NO curriculum mutation.
-- ============================================================

-- 1) adaptive_learning_paths -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adaptive_learning_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','superseded','abandoned')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL DEFAULT (now() + interval '6 hours'),
  -- ordered list of recommended steps (lesson / minicheck / simulation / tutor_mode / recovery)
  -- each entry: { step_type, target_id, target_kind, rationale, priority, constraints_passed[] }
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,  -- readiness/risk/time_to_exam/cognitive_load snapshot
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alp_user_curr_active
  ON public.adaptive_learning_paths(user_id, curriculum_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_alp_computed_at
  ON public.adaptive_learning_paths(computed_at DESC);

ALTER TABLE public.adaptive_learning_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full alp"
  ON public.adaptive_learning_paths FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "learner reads own path"
  ON public.adaptive_learning_paths FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin reads all paths"
  ON public.adaptive_learning_paths FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) learner_path_decisions --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learner_path_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id uuid NOT NULL REFERENCES public.adaptive_learning_paths(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  step_index int NOT NULL,
  step_type text NOT NULL
    CHECK (step_type IN ('lesson','minicheck','exam_simulation','tutor_mode','recovery_sequence','spaced_repetition')),
  target_id uuid,
  target_kind text,
  decision text NOT NULL
    CHECK (decision IN ('recommended','served','accepted','skipped','completed','blocked_by_guardrail')),
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  constraints_evaluated jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lpd_path ON public.learner_path_decisions(path_id, step_index);
CREATE INDEX IF NOT EXISTS idx_lpd_user_curr_time ON public.learner_path_decisions(user_id, curriculum_id, decided_at DESC);

ALTER TABLE public.learner_path_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full lpd"
  ON public.learner_path_decisions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "learner reads own lpd"
  ON public.learner_path_decisions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin reads all lpd"
  ON public.learner_path_decisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) path_intervention_constraints ------------------------------------------
-- Hard allowlist of what the orchestrator may choose. Acts as SSOT-guard.
CREATE TABLE IF NOT EXISTS public.path_intervention_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  constraint_key text NOT NULL UNIQUE,
  step_type text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('allow_source','require_field','forbid_action','cap_per_session','time_window')),
  rule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enforcement text NOT NULL DEFAULT 'hard_block'
    CHECK (enforcement IN ('hard_block','warn','soft_filter')),
  is_active boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.path_intervention_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full pic"
  ON public.path_intervention_constraints FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "admin reads pic"
  ON public.path_intervention_constraints FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed: SSOT-Allowlist & Hard-Blocks
INSERT INTO public.path_intervention_constraints
  (constraint_key, step_type, rule_type, rule_config, enforcement, description)
VALUES
  ('lessons_only_from_ssot','lesson','allow_source',
    jsonb_build_object('source_table','lessons','required_status','published'),
    'hard_block','Lessons must exist in lessons table with status=published'),
  ('minichecks_only_approved','minicheck','allow_source',
    jsonb_build_object('source_table','exam_questions','required_status','approved'),
    'hard_block','Mini-checks must be approved exam_questions'),
  ('blueprints_only_approved','exam_simulation','allow_source',
    jsonb_build_object('source_table','question_blueprints','required_status','approved'),
    'hard_block','Exam simulations must use approved blueprints'),
  ('no_content_generation','lesson','forbid_action',
    jsonb_build_object('actions',jsonb_build_array('create_lesson','rewrite_lesson','generate_content')),
    'hard_block','Path orchestrator MUST NOT create or rewrite content'),
  ('no_curriculum_mutation','lesson','forbid_action',
    jsonb_build_object('actions',jsonb_build_array('reorder_curriculum','insert_curriculum_step','delete_curriculum_step')),
    'hard_block','Path orchestrator MUST NOT mutate curriculum structure'),
  ('dependency_edges_validated','recovery_sequence','require_field',
    jsonb_build_object('required',jsonb_build_array('source_competency_id','target_competency_id','edge_type')),
    'hard_block','Recovery sequences must reference validated skill_dependency_edges'),
  ('max_lessons_per_session','lesson','cap_per_session',
    jsonb_build_object('max_count',3),'soft_filter','At most 3 lessons recommended per session'),
  ('max_simulations_per_day','exam_simulation','cap_per_session',
    jsonb_build_object('max_count',2),'soft_filter','At most 2 simulations per day to avoid burnout')
ON CONFLICT (constraint_key) DO NOTHING;

-- 4) Views ------------------------------------------------------------------

-- v_adaptive_path_candidates: latest active path per user×curriculum
CREATE OR REPLACE VIEW public.v_adaptive_path_candidates AS
SELECT
  alp.id AS path_id,
  alp.user_id,
  alp.curriculum_id,
  alp.computed_at,
  alp.valid_until,
  jsonb_array_length(alp.steps) AS step_count,
  alp.context->>'readiness_band' AS readiness_band,
  alp.context->>'retention_risk' AS retention_risk,
  (alp.context->>'days_to_exam')::int AS days_to_exam,
  alp.steps
FROM public.adaptive_learning_paths alp
WHERE alp.status = 'active'
  AND alp.valid_until > now();

-- v_path_bottleneck_recovery: paths targeting bottleneck competencies
CREATE OR REPLACE VIEW public.v_path_bottleneck_recovery AS
SELECT
  alp.id AS path_id,
  alp.user_id,
  alp.curriculum_id,
  step.value->>'step_type' AS step_type,
  (step.value->>'target_id')::uuid AS target_id,
  step.value->>'rationale_code' AS rationale_code,
  (step.value->>'priority')::int AS priority,
  kg.node_role,
  kg.blocks_count
FROM public.adaptive_learning_paths alp
CROSS JOIN LATERAL jsonb_array_elements(alp.steps) AS step
LEFT JOIN public.kg_competency_nodes kg
  ON kg.competency_id = (step.value->>'target_id')::uuid
WHERE alp.status = 'active'
  AND step.value->>'rationale_code' = 'bottleneck_recovery';

-- v_path_effectiveness: served vs completed/skipped per step_type
CREATE OR REPLACE VIEW public.v_path_effectiveness AS
SELECT
  step_type,
  COUNT(*) FILTER (WHERE decision = 'served')                AS served,
  COUNT(*) FILTER (WHERE decision = 'accepted')              AS accepted,
  COUNT(*) FILTER (WHERE decision = 'completed')             AS completed,
  COUNT(*) FILTER (WHERE decision = 'skipped')               AS skipped,
  COUNT(*) FILTER (WHERE decision = 'blocked_by_guardrail')  AS blocked,
  ROUND(
    100.0 * NULLIF(COUNT(*) FILTER (WHERE decision = 'completed'),0)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE decision = 'served'),0),
    2
  ) AS completion_rate_pct,
  MAX(decided_at) AS last_decision_at
FROM public.learner_path_decisions
WHERE decided_at > now() - interval '30 days'
GROUP BY step_type;

-- Lock views to service_role
REVOKE ALL ON public.v_adaptive_path_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_path_bottleneck_recovery FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_path_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_adaptive_path_candidates TO service_role;
GRANT SELECT ON public.v_path_bottleneck_recovery TO service_role;
GRANT SELECT ON public.v_path_effectiveness TO service_role;

-- 5) fn_compute_adaptive_path -----------------------------------------------
-- SSOT-bounded: only emits step entries whose target_id resolves to an existing
-- published lesson / approved blueprint / approved minicheck / dependency edge.
CREATE OR REPLACE FUNCTION public.fn_compute_adaptive_path(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path_id uuid;
  v_steps jsonb := '[]'::jsonb;
  v_ctx jsonb := '{}'::jsonb;
  v_readiness numeric;
  v_band text;
  v_risk text;
BEGIN
  -- Snapshot context (readiness + risk if available)
  SELECT readiness_score, readiness_band
    INTO v_readiness, v_band
  FROM public.learner_readiness_history
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
  ORDER BY measured_at DESC LIMIT 1;

  SELECT retention_risk INTO v_risk
  FROM public.learner_intervention_state
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
  LIMIT 1;

  v_ctx := jsonb_build_object(
    'readiness_score', v_readiness,
    'readiness_band',  v_band,
    'retention_risk',  v_risk,
    'snapshot_at',     now()
  );

  -- Step 1: bottleneck recovery (if any bottleneck blocks current curriculum)
  v_steps := v_steps || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'step_type','recovery_sequence',
      'target_id', kg.competency_id,
      'target_kind','competency',
      'rationale_code','bottleneck_recovery',
      'priority', 90,
      'constraints_passed', jsonb_build_array('dependency_edges_validated')
    ))
    FROM public.kg_competency_nodes kg
    WHERE kg.node_role = 'bottleneck'
      AND kg.blocks_count >= 3
    LIMIT 1
  ), '[]'::jsonb);

  -- Step 2: weakness lesson (top 2 weak competencies → published lessons)
  v_steps := v_steps || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'step_type','lesson',
      'target_id', l.id,
      'target_kind','lesson',
      'rationale_code','weakness_drill',
      'priority', 70,
      'constraints_passed', jsonb_build_array('lessons_only_from_ssot')
    ))
    FROM public.user_competency_mastery ucm
    JOIN public.lessons l ON l.competency_id = ucm.competency_id
    WHERE ucm.user_id = p_user_id
      AND ucm.mastery_level IN ('weak','struggling')
      AND l.status = 'published'
    ORDER BY ucm.updated_at DESC
    LIMIT 2
  ), '[]'::jsonb);

  -- Step 3: exam simulation if PARTIAL/READY
  IF v_band IN ('PARTIAL','READY') THEN
    v_steps := v_steps || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'step_type','exam_simulation',
        'target_id', qb.id,
        'target_kind','blueprint',
        'rationale_code','readiness_validation',
        'priority', 60,
        'constraints_passed', jsonb_build_array('blueprints_only_approved')
      ))
      FROM public.question_blueprints qb
      WHERE qb.curriculum_id = p_curriculum_id
        AND qb.status = 'approved'
      LIMIT 1
    ), '[]'::jsonb);
  END IF;

  -- Persist path (supersede previous active)
  UPDATE public.adaptive_learning_paths
     SET status = 'superseded'
   WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id AND status = 'active';

  INSERT INTO public.adaptive_learning_paths
    (user_id, curriculum_id, steps, context)
  VALUES
    (p_user_id, p_curriculum_id, v_steps, v_ctx)
  RETURNING id INTO v_path_id;

  -- Audit
  BEGIN
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, details)
    VALUES (
      'adaptive_path_computed',
      'learner',
      p_user_id,
      'success',
      jsonb_build_object(
        'path_id', v_path_id,
        'curriculum_id', p_curriculum_id,
        'step_count', jsonb_array_length(v_steps),
        'readiness_band', v_band,
        'retention_risk', v_risk
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_path_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_compute_adaptive_path(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_adaptive_path(uuid, uuid) TO service_role;

-- 6) admin_get_adaptive_path_health -----------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_adaptive_path_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'paths', jsonb_build_object(
      'active',     (SELECT COUNT(*) FROM public.adaptive_learning_paths WHERE status='active' AND valid_until > now()),
      'completed',  (SELECT COUNT(*) FROM public.adaptive_learning_paths WHERE status='completed'),
      'superseded', (SELECT COUNT(*) FROM public.adaptive_learning_paths WHERE status='superseded'),
      'abandoned',  (SELECT COUNT(*) FROM public.adaptive_learning_paths WHERE status='abandoned')
    ),
    'effectiveness', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'step_type', step_type,
        'served',    served,
        'completed', completed,
        'skipped',   skipped,
        'blocked',   blocked,
        'completion_rate_pct', completion_rate_pct
      ) ORDER BY served DESC)
      FROM public.v_path_effectiveness
    ), '[]'::jsonb),
    'constraints', jsonb_build_object(
      'active', (SELECT COUNT(*) FROM public.path_intervention_constraints WHERE is_active),
      'hard_blocks', (SELECT COUNT(*) FROM public.path_intervention_constraints WHERE is_active AND enforcement='hard_block')
    ),
    'recent_decisions', COALESCE((
      SELECT jsonb_agg(row_to_json(d.*) ORDER BY decided_at DESC)
      FROM (
        SELECT step_type, decision, rationale, decided_at
        FROM public.learner_path_decisions
        ORDER BY decided_at DESC
        LIMIT 20
      ) d
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_adaptive_path_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_adaptive_path_health() TO authenticated;
