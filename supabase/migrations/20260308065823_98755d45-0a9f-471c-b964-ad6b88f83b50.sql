
-- ============================================================
-- Qualification Blueprint Engine — Part 2
-- ============================================================

-- 1. BLUEPRINT PROFILES (exam config per award_type)
CREATE TABLE IF NOT EXISTS public.qualification_blueprint_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE,
  award_type text NOT NULL,
  provider_family text,
  education_type text,
  exam_mode text NOT NULL DEFAULT 'fortbildung_exam',
  default_pass_threshold numeric NOT NULL DEFAULT 50,
  default_total_questions integer NOT NULL DEFAULT 60,
  oral_exam_enabled boolean NOT NULL DEFAULT false,
  project_exam_enabled boolean NOT NULL DEFAULT false,
  practical_exam_enabled boolean NOT NULL DEFAULT false,
  default_difficulty_mix jsonb NOT NULL DEFAULT '{"easy":0.2,"medium":0.45,"hard":0.25,"very_hard":0.1}'::jsonb,
  default_bloom_mix jsonb NOT NULL DEFAULT '{"remember":0.15,"understand":0.25,"apply":0.35,"analyze":0.15,"evaluate":0.10}'::jsonb,
  default_question_types jsonb NOT NULL DEFAULT '["single_choice","multiple_choice","case_based"]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qualification_blueprint_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qbp" ON public.qualification_blueprint_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_qbp_lookup
  ON public.qualification_blueprint_profiles (award_type, provider_family, education_type, active);

-- 2. DRAFT SECTIONS (expanded structure from draft)
CREATE TABLE IF NOT EXISTS public.qualification_draft_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.qualification_curriculum_drafts(id) ON DELETE CASCADE,
  section_type text NOT NULL,
  section_key text NOT NULL,
  section_title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  weight_percent numeric,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qualification_draft_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qds" ON public.qualification_draft_sections FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_qds_draft ON public.qualification_draft_sections (draft_id, section_type, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qds_unique ON public.qualification_draft_sections (draft_id, section_type, section_key);

-- 3. CURRICULUM PROMOTION MAP
CREATE TABLE IF NOT EXISTS public.qualification_curriculum_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL UNIQUE REFERENCES public.qualification_curriculum_drafts(id) ON DELETE CASCADE,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  blueprint_id uuid REFERENCES public.exam_blueprints(id) ON DELETE SET NULL,
  promotion_status text NOT NULL DEFAULT 'promoted',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qualification_curriculum_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qcm" ON public.qualification_curriculum_map FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. QUESTION SEED RUNS (audit)
CREATE TABLE IF NOT EXISTS public.qualification_question_seed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES public.qualification_curriculum_drafts(id) ON DELETE SET NULL,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE SET NULL,
  blueprint_id uuid REFERENCES public.exam_blueprints(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  created_blueprints integer NOT NULL DEFAULT 0,
  created_questions integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE public.qualification_question_seed_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_qqsr" ON public.qualification_question_seed_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. SEED BLUEPRINT PROFILES
INSERT INTO public.qualification_blueprint_profiles (profile_key, award_type, provider_family, education_type, exam_mode, default_pass_threshold, default_total_questions, oral_exam_enabled, project_exam_enabled, default_difficulty_mix, default_bloom_mix)
VALUES
  ('fachwirt_ihk', 'fachwirt', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 60, true, false,
   '{"easy":0.15,"medium":0.40,"hard":0.30,"very_hard":0.15}'::jsonb,
   '{"remember":0.10,"understand":0.25,"apply":0.35,"analyze":0.20,"evaluate":0.10}'::jsonb),
  ('betriebswirt_ihk', 'betriebswirt', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 80, true, true,
   '{"easy":0.10,"medium":0.35,"hard":0.35,"very_hard":0.20}'::jsonb,
   '{"remember":0.05,"understand":0.20,"apply":0.35,"analyze":0.25,"evaluate":0.15}'::jsonb),
  ('meister_ihk', 'meister', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 70, true, true,
   '{"easy":0.15,"medium":0.40,"hard":0.30,"very_hard":0.15}'::jsonb,
   '{"remember":0.10,"understand":0.25,"apply":0.35,"analyze":0.20,"evaluate":0.10}'::jsonb),
  ('meister_hwk', 'meister', 'HWK', 'hwk_fortbildung', 'fortbildung_exam', 50, 70, true, true,
   '{"easy":0.15,"medium":0.40,"hard":0.30,"very_hard":0.15}'::jsonb,
   '{"remember":0.10,"understand":0.25,"apply":0.35,"analyze":0.20,"evaluate":0.10}'::jsonb),
  ('bilanzbuchhalter_ihk', 'bilanzbuchhalter', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 60, true, false,
   '{"easy":0.10,"medium":0.35,"hard":0.35,"very_hard":0.20}'::jsonb,
   '{"remember":0.10,"understand":0.20,"apply":0.35,"analyze":0.25,"evaluate":0.10}'::jsonb),
  ('controller_ihk', 'controller', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 60, true, false,
   '{"easy":0.10,"medium":0.35,"hard":0.35,"very_hard":0.20}'::jsonb,
   '{"remember":0.10,"understand":0.20,"apply":0.35,"analyze":0.25,"evaluate":0.10}'::jsonb),
  ('fachkaufmann_ihk', 'fachkaufmann', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 60, false, false,
   '{"easy":0.20,"medium":0.45,"hard":0.25,"very_hard":0.10}'::jsonb,
   '{"remember":0.15,"understand":0.25,"apply":0.35,"analyze":0.15,"evaluate":0.10}'::jsonb),
  ('ada_ihk', 'ada', 'IHK', 'ihk_fortbildung', 'fortbildung_exam', 50, 40, true, false,
   '{"easy":0.25,"medium":0.45,"hard":0.20,"very_hard":0.10}'::jsonb,
   '{"remember":0.20,"understand":0.30,"apply":0.30,"analyze":0.15,"evaluate":0.05}'::jsonb),
  ('generic_fortbildung', 'fortbildung', NULL, NULL, 'fortbildung_exam', 50, 60, false, false,
   '{"easy":0.20,"medium":0.45,"hard":0.25,"very_hard":0.10}'::jsonb,
   '{"remember":0.15,"understand":0.25,"apply":0.35,"analyze":0.15,"evaluate":0.10}'::jsonb)
ON CONFLICT (profile_key) DO NOTHING;

-- 6. EXPAND DRAFT SECTIONS RPC
CREATE OR REPLACE FUNCTION public.expand_qualification_draft_sections(
  p_draft_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft public.qualification_curriculum_drafts%ROWTYPE;
  v_structure jsonb;
  v_item jsonb;
  v_inserted integer := 0;
  v_idx integer := 0;
  v_key text;
BEGIN
  SELECT * INTO v_draft FROM public.qualification_curriculum_drafts WHERE id = p_draft_id;
  IF v_draft.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draft_not_found');
  END IF;

  DELETE FROM public.qualification_draft_sections WHERE draft_id = p_draft_id;
  v_structure := v_draft.structure_json;

  -- exam_parts
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_structure->'exam_parts', '[]'::jsonb))
  LOOP
    v_key := regexp_replace(lower(coalesce(v_item->>'title', 'exam-part-' || v_idx)), '[^a-z0-9]+', '-', 'g');
    INSERT INTO public.qualification_draft_sections (draft_id, section_type, section_key, section_title, sort_order, source_payload)
    VALUES (p_draft_id, 'exam_part', v_key, coalesce(v_item->>'title', 'Prüfungsteil ' || (v_idx+1)), v_idx, v_item)
    ON CONFLICT (draft_id, section_type, section_key) DO NOTHING;
    v_idx := v_idx + 1; v_inserted := v_inserted + 1;
  END LOOP;

  v_idx := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_structure->'handlungsbereiche', '[]'::jsonb))
  LOOP
    v_key := regexp_replace(lower(coalesce(v_item->>'title', 'hb-' || v_idx)), '[^a-z0-9]+', '-', 'g');
    INSERT INTO public.qualification_draft_sections (draft_id, section_type, section_key, section_title, sort_order, source_payload)
    VALUES (p_draft_id, 'handlungsbereich', v_key, coalesce(v_item->>'title', 'Handlungsbereich ' || (v_idx+1)), v_idx, v_item)
    ON CONFLICT (draft_id, section_type, section_key) DO NOTHING;
    v_idx := v_idx + 1; v_inserted := v_inserted + 1;
  END LOOP;

  v_idx := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_structure->'competency_areas', '[]'::jsonb))
  LOOP
    v_key := regexp_replace(lower(coalesce(v_item->>'title', 'ca-' || v_idx)), '[^a-z0-9]+', '-', 'g');
    INSERT INTO public.qualification_draft_sections (draft_id, section_type, section_key, section_title, sort_order, source_payload)
    VALUES (p_draft_id, 'competency_area', v_key, coalesce(v_item->>'title', 'Kompetenzbereich ' || (v_idx+1)), v_idx, v_item)
    ON CONFLICT (draft_id, section_type, section_key) DO NOTHING;
    v_idx := v_idx + 1; v_inserted := v_inserted + 1;
  END LOOP;

  v_idx := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_structure->'oral_components', '[]'::jsonb))
  LOOP
    v_key := regexp_replace(lower(coalesce(v_item->>'title', 'oral-' || v_idx)), '[^a-z0-9]+', '-', 'g');
    INSERT INTO public.qualification_draft_sections (draft_id, section_type, section_key, section_title, sort_order, source_payload)
    VALUES (p_draft_id, 'oral', v_key, coalesce(v_item->>'title', 'Mündlich ' || (v_idx+1)), v_idx, v_item)
    ON CONFLICT (draft_id, section_type, section_key) DO NOTHING;
    v_idx := v_idx + 1; v_inserted := v_inserted + 1;
  END LOOP;

  v_idx := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_structure->'project_components', '[]'::jsonb))
  LOOP
    v_key := regexp_replace(lower(coalesce(v_item->>'title', 'proj-' || v_idx)), '[^a-z0-9]+', '-', 'g');
    INSERT INTO public.qualification_draft_sections (draft_id, section_type, section_key, section_title, sort_order, source_payload)
    VALUES (p_draft_id, 'project', v_key, coalesce(v_item->>'title', 'Projekt ' || (v_idx+1)), v_idx, v_item)
    ON CONFLICT (draft_id, section_type, section_key) DO NOTHING;
    v_idx := v_idx + 1; v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'draft_id', p_draft_id, 'inserted_sections', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expand_qualification_draft_sections(uuid) TO service_role;

-- 7. PICK BLUEPRINT PROFILE
CREATE OR REPLACE FUNCTION public.pick_qualification_blueprint_profile(
  p_award_type text,
  p_provider_family text,
  p_education_type text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.qualification_blueprint_profiles
  WHERE active = true AND award_type = p_award_type
    AND (provider_family = p_provider_family OR provider_family IS NULL)
    AND (education_type = p_education_type OR education_type IS NULL)
  ORDER BY
    CASE WHEN provider_family = p_provider_family THEN 0 ELSE 1 END,
    CASE WHEN education_type = p_education_type THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.qualification_blueprint_profiles
    WHERE profile_key = 'generic_fortbildung' AND active = true;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pick_qualification_blueprint_profile(text, text, text) TO service_role;

-- 8. GENERATE CURRICULUM FROM DRAFT (learning_fields + competencies)
CREATE OR REPLACE FUNCTION public.generate_curriculum_from_qualification_draft(
  p_draft_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft record;
  v_curriculum_id uuid;
  v_section record;
  v_lf_id uuid;
  v_created_lf integer := 0;
  v_created_comp integer := 0;
  v_lf_code text;
BEGIN
  SELECT d.*, qc.award_type AS cat_award, qc.provider_family AS cat_provider,
         qc.education_type AS cat_edu, qc.qualification_level AS cat_level
  INTO v_draft
  FROM public.qualification_curriculum_drafts d
  JOIN public.qualification_catalog qc ON qc.id = d.qualification_catalog_id
  WHERE d.id = p_draft_id;

  IF v_draft.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draft_not_found');
  END IF;

  -- Check if already promoted
  IF EXISTS (SELECT 1 FROM public.qualification_curriculum_map WHERE draft_id = p_draft_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_promoted');
  END IF;

  PERFORM public.expand_qualification_draft_sections(p_draft_id);

  INSERT INTO public.curricula (
    title, description, track, status, import_source,
    exam_structure
  )
  VALUES (
    v_draft.draft_title,
    'Fortbildungs-Curriculum: ' || v_draft.draft_title,
    'AUSBILDUNG_VOLL',
    'frozen',
    'qualification_intake',
    jsonb_build_object(
      'qualification_catalog_id', v_draft.qualification_catalog_id,
      'draft_id', p_draft_id,
      'award_type', v_draft.cat_award,
      'education_type', v_draft.cat_edu,
      'qualification_level', v_draft.cat_level
    )
  )
  RETURNING id INTO v_curriculum_id;

  FOR v_section IN
    SELECT * FROM public.qualification_draft_sections
    WHERE draft_id = p_draft_id
      AND section_type IN ('exam_part','handlungsbereich','competency_area')
    ORDER BY
      CASE section_type WHEN 'exam_part' THEN 1 WHEN 'handlungsbereich' THEN 2 WHEN 'competency_area' THEN 3 ELSE 9 END,
      sort_order
  LOOP
    v_created_lf := v_created_lf + 1;
    v_lf_code := upper(left(v_section.section_type, 2)) || '-' || lpad(v_created_lf::text, 2, '0');

    INSERT INTO public.learning_fields (curriculum_id, code, title, description, sort_order)
    VALUES (v_curriculum_id, v_lf_code, v_section.section_title,
            'Auto-generiert aus ' || v_section.section_type, v_created_lf)
    RETURNING id INTO v_lf_id;

    -- 3 competencies per learning field (Grundlagen, Anwendung, Transfer)
    INSERT INTO public.competencies (learning_field_id, code, title, description, bloom_level) VALUES
      (v_lf_id, v_lf_code || '-C1', v_section.section_title || ' – Grundlagen', 'Grundlagenkompetenz', 'understand'),
      (v_lf_id, v_lf_code || '-C2', v_section.section_title || ' – Anwendung', 'Anwendungskompetenz', 'apply'),
      (v_lf_id, v_lf_code || '-C3', v_section.section_title || ' – Analyse & Transfer', 'Transferkompetenz', 'analyze');

    v_created_comp := v_created_comp + 3;
  END LOOP;

  UPDATE public.qualification_curriculum_drafts
  SET status = 'promoted', promoted_curriculum_id = v_curriculum_id, updated_at = now()
  WHERE id = p_draft_id;

  INSERT INTO public.qualification_curriculum_map (draft_id, curriculum_id, promotion_status, metadata)
  VALUES (p_draft_id, v_curriculum_id, 'promoted',
          jsonb_build_object('learning_fields', v_created_lf, 'competencies', v_created_comp));

  RETURN jsonb_build_object('ok', true, 'curriculum_id', v_curriculum_id,
    'learning_fields', v_created_lf, 'competencies', v_created_comp);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_curriculum_from_qualification_draft(uuid) TO service_role;

-- 9. GENERATE EXAM BLUEPRINT
CREATE OR REPLACE FUNCTION public.generate_exam_blueprint_from_qualification_draft(
  p_draft_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_draft record;
  v_profile record;
  v_profile_id uuid;
  v_blueprint_id uuid;
BEGIN
  SELECT d.*, qc.award_type AS cat_award, qc.provider_family AS cat_provider, qc.education_type AS cat_edu
  INTO v_draft
  FROM public.qualification_curriculum_drafts d
  JOIN public.qualification_catalog qc ON qc.id = d.qualification_catalog_id
  WHERE d.id = p_draft_id;

  IF v_draft.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'draft_not_found'); END IF;

  v_profile_id := public.pick_qualification_blueprint_profile(v_draft.cat_award, v_draft.cat_provider, v_draft.cat_edu);
  IF v_profile_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_profile'); END IF;

  SELECT * INTO v_profile FROM public.qualification_blueprint_profiles WHERE id = v_profile_id;

  INSERT INTO public.exam_blueprints (
    curriculum_id, title, total_questions, pass_threshold,
    time_limit_minutes, difficulty_distribution, question_types, section_weights
  )
  VALUES (
    p_curriculum_id,
    v_draft.draft_title || ' – Prüfungsblueprint',
    v_profile.default_total_questions,
    v_profile.default_pass_threshold,
    CASE
      WHEN v_draft.cat_award = 'betriebswirt' THEN 180
      WHEN v_draft.cat_award = 'meister' THEN 150
      ELSE 120
    END,
    v_profile.default_difficulty_mix,
    v_profile.default_question_types,
    jsonb_build_object(
      'profile_key', v_profile.profile_key,
      'bloom_mix', v_profile.default_bloom_mix,
      'oral_enabled', v_profile.oral_exam_enabled,
      'project_enabled', v_profile.project_exam_enabled
    )
  )
  RETURNING id INTO v_blueprint_id;

  UPDATE public.qualification_curriculum_map
  SET blueprint_id = v_blueprint_id, promotion_status = 'blueprinted', updated_at = now()
  WHERE draft_id = p_draft_id;

  RETURN jsonb_build_object('ok', true, 'blueprint_id', v_blueprint_id, 'profile_key', v_profile.profile_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_exam_blueprint_from_qualification_draft(uuid, uuid) TO service_role;

-- 10. SEED QUESTION BLUEPRINTS
CREATE OR REPLACE FUNCTION public.seed_question_blueprints_from_qualification(
  p_curriculum_id uuid,
  p_blueprint_id uuid,
  p_per_competency integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_created integer := 0;
  v_comp record;
  v_idx integer;
  v_cog text;
  v_run_id uuid;
BEGIN
  INSERT INTO public.qualification_question_seed_runs (curriculum_id, blueprint_id, status)
  VALUES (p_curriculum_id, p_blueprint_id, 'running')
  RETURNING id INTO v_run_id;

  FOR v_comp IN
    SELECT c.id, c.code, c.title, lf.id AS lf_id, lf.code AS lf_code
    FROM public.competencies c
    JOIN public.learning_fields lf ON lf.id = c.learning_field_id
    WHERE lf.curriculum_id = p_curriculum_id
    ORDER BY lf.sort_order, c.code
  LOOP
    FOR v_idx IN 1..p_per_competency LOOP
      v_cog := CASE
        WHEN v_idx = 1 THEN 'remember'
        WHEN v_idx = 2 THEN 'understand'
        WHEN v_idx IN (3,4) THEN 'apply'
        WHEN v_idx = 5 THEN 'analyze'
        ELSE 'evaluate'
      END;

      INSERT INTO public.question_blueprints (
        curriculum_id, competency_id, learning_field_id,
        name, canonical_statement, question_template,
        cognitive_level, didactic_intent, exam_context_type,
        exam_relevance, exam_relevance_score, knowledge_type,
        scenario_type, real_world_context, status,
        allowed_question_types
      )
      VALUES (
        p_curriculum_id, v_comp.id, v_comp.lf_id,
        v_comp.title || ' – Q' || v_idx,
        'Prüfungsfrage zu ' || v_comp.title || ' (Variante ' || v_idx || ')',
        'Welche Aussage trifft zu bezüglich ' || v_comp.title || '?',
        v_cog::public.cognitive_level,
        CASE WHEN v_idx <= 2 THEN 'recognition' WHEN v_idx <= 4 THEN 'transfer' ELSE 'error_detection' END::public.didactic_intent,
        CASE WHEN v_idx >= 5 THEN 'situational_task' ELSE 'knowledge_check' END::public.exam_context_type,
        CASE WHEN v_idx >= 4 THEN 'high' ELSE 'medium' END::public.exam_relevance,
        CASE WHEN v_idx >= 5 THEN 90 WHEN v_idx >= 3 THEN 70 ELSE 50 END,
        CASE WHEN v_idx <= 2 THEN 'factual' WHEN v_idx <= 4 THEN 'procedural' ELSE 'conceptual' END::public.knowledge_type,
        CASE WHEN v_idx >= 5 THEN 'workplace_scenario' ELSE 'standard' END,
        v_idx >= 4,
        'draft'::public.blueprint_status,
        CASE WHEN v_idx >= 5 THEN ARRAY['case_based'] ELSE ARRAY['single_choice','multiple_choice'] END
      );

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  UPDATE public.qualification_question_seed_runs
  SET status = 'done', created_blueprints = v_created, finished_at = now()
  WHERE id = v_run_id;

  UPDATE public.qualification_curriculum_map
  SET promotion_status = 'question_seeded', updated_at = now()
  WHERE curriculum_id = p_curriculum_id;

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'created_blueprints', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_question_blueprints_from_qualification(uuid, uuid, integer) TO service_role;
