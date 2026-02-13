
-- ===== Dominance Blueprint Schema =====

-- Enums
DO $$ BEGIN CREATE TYPE public.dom_exam_part AS ENUM ('TEIL_1', 'TEIL_2'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.dom_question_type AS ENUM ('mc_single','mc_multi','true_false','short_answer','case_study','calculation','scenario','transfer','oral_prompt','oral_question'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.dom_blueprint_status AS ENUM ('draft','review','locked','deprecated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Blueprint header
CREATE TABLE public.dom_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_master_id uuid REFERENCES public.german_certification_master(id) ON DELETE SET NULL,
  version text NOT NULL DEFAULT '1.0',
  status public.dom_blueprint_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  description text,
  exam_target_total int NOT NULL DEFAULT 1300,
  oral_target_total int NOT NULL DEFAULT 0,
  coverage_target_min numeric NOT NULL DEFAULT 0.95,
  publish_hard_stop numeric NOT NULL DEFAULT 0.90,
  duplicate_max numeric NOT NULL DEFAULT 0.02,
  confidence_min numeric NOT NULL DEFAULT 0.90,
  governance_min numeric NOT NULL DEFAULT 0.90,
  difficulty_mix jsonb NOT NULL DEFAULT '{"easy":0.05,"medium":0.55,"hard":0.40}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_blueprints_unique_version UNIQUE (cert_master_id, version)
);

CREATE TABLE public.dom_blueprint_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.dom_blueprints(id) ON DELETE CASCADE,
  part_key public.dom_exam_part NOT NULL,
  part_name text NOT NULL,
  weight_pct numeric NOT NULL,
  question_target int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_bp_parts_unique UNIQUE (blueprint_id, part_key)
);

CREATE TABLE public.dom_blueprint_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.dom_blueprint_parts(id) ON DELETE CASCADE,
  domain_key text NOT NULL,
  domain_name text NOT NULL,
  weight_pct numeric NOT NULL,
  question_target int NOT NULL DEFAULT 0,
  calc_share_pct numeric NOT NULL DEFAULT 0,
  transfer_share_pct numeric NOT NULL DEFAULT 0,
  oral_relevant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_bp_domains_unique UNIQUE (part_id, domain_key)
);

CREATE TABLE public.dom_blueprint_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.dom_blueprint_domains(id) ON DELETE CASCADE,
  topic_key text NOT NULL,
  topic_name text NOT NULL,
  question_target int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_bp_topics_unique UNIQUE (domain_id, topic_key)
);

CREATE TABLE public.dom_blueprint_subtopics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.dom_blueprint_topics(id) ON DELETE CASCADE,
  subtopic_key text NOT NULL,
  subtopic_name text NOT NULL,
  question_target int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_bp_subtopics_unique UNIQUE (topic_id, subtopic_key)
);

CREATE TABLE public.dom_blueprint_type_mix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES public.dom_blueprint_domains(id) ON DELETE CASCADE,
  qtype public.dom_question_type NOT NULL,
  share_pct numeric NOT NULL,
  is_oral boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dom_bp_type_mix_unique UNIQUE (domain_id, qtype)
);

CREATE TABLE public.dom_blueprint_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.dom_blueprints(id) ON DELETE CASCADE,
  domain_id uuid REFERENCES public.dom_blueprint_domains(id) ON DELETE SET NULL,
  topic_id uuid REFERENCES public.dom_blueprint_topics(id) ON DELETE SET NULL,
  subtopic_id uuid REFERENCES public.dom_blueprint_subtopics(id) ON DELETE SET NULL,
  questions_target int NOT NULL DEFAULT 0,
  questions_actual int NOT NULL DEFAULT 0,
  coverage_pct numeric GENERATED ALWAYS AS (
    CASE WHEN questions_target > 0 THEN LEAST(1.0, questions_actual::numeric / questions_target) ELSE 0 END
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dom_cov_bp ON public.dom_blueprint_coverage(blueprint_id);

CREATE TABLE public.dom_blueprint_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.dom_blueprints(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  total_target int NOT NULL DEFAULT 0,
  total_actual int NOT NULL DEFAULT 0,
  coverage_ratio numeric NOT NULL DEFAULT 0,
  domain_detail jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- Updated_at trigger
CREATE TRIGGER trg_dom_bp_updated BEFORE UPDATE ON public.dom_blueprints
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lock guard
CREATE OR REPLACE FUNCTION public.guard_dom_blueprint_locked()
RETURNS trigger AS $$
DECLARE v_bp_id uuid; v_status public.dom_blueprint_status;
BEGIN
  IF TG_TABLE_NAME IN ('dom_blueprint_parts','dom_blueprint_coverage') THEN
    v_bp_id := NEW.blueprint_id;
  ELSIF TG_TABLE_NAME = 'dom_blueprint_domains' THEN
    SELECT blueprint_id INTO v_bp_id FROM public.dom_blueprint_parts WHERE id = NEW.part_id;
  ELSIF TG_TABLE_NAME = 'dom_blueprint_type_mix' THEN
    SELECT p.blueprint_id INTO v_bp_id FROM public.dom_blueprint_domains d JOIN public.dom_blueprint_parts p ON p.id = d.part_id WHERE d.id = NEW.domain_id;
  ELSIF TG_TABLE_NAME = 'dom_blueprint_topics' THEN
    SELECT p.blueprint_id INTO v_bp_id FROM public.dom_blueprint_domains d JOIN public.dom_blueprint_parts p ON p.id = d.part_id WHERE d.id = NEW.domain_id;
  ELSIF TG_TABLE_NAME = 'dom_blueprint_subtopics' THEN
    SELECT p.blueprint_id INTO v_bp_id FROM public.dom_blueprint_topics t JOIN public.dom_blueprint_domains d ON d.id = t.domain_id JOIN public.dom_blueprint_parts p ON p.id = d.part_id WHERE t.id = NEW.topic_id;
  END IF;
  SELECT status INTO v_status FROM public.dom_blueprints WHERE id = v_bp_id;
  IF v_status = 'locked' THEN RAISE EXCEPTION 'Blueprint is locked.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$ DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['dom_blueprint_parts','dom_blueprint_domains','dom_blueprint_topics','dom_blueprint_subtopics','dom_blueprint_type_mix','dom_blueprint_coverage']
  LOOP EXECUTE format('CREATE TRIGGER trg_guard_locked BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_dom_blueprint_locked()', tbl);
  END LOOP;
END $$;

-- Coverage RPC
CREATE OR REPLACE FUNCTION public.get_dom_blueprint_coverage(p_blueprint_id uuid)
RETURNS jsonb AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_target', COALESCE(SUM(questions_target),0),
    'total_actual', COALESCE(SUM(questions_actual),0),
    'coverage_ratio', CASE WHEN SUM(questions_target)>0 THEN ROUND(SUM(questions_actual)::numeric/SUM(questions_target),4) ELSE 0 END,
    'domains', (SELECT jsonb_agg(jsonb_build_object('domain_key',d.domain_key,'name',d.domain_name,'target',d.question_target,'actual',COALESCE(c.a,0),'coverage',CASE WHEN d.question_target>0 THEN ROUND(COALESCE(c.a,0)::numeric/d.question_target,4) ELSE 0 END) ORDER BY d.weight_pct DESC) FROM dom_blueprint_domains d JOIN dom_blueprint_parts p ON p.id=d.part_id LEFT JOIN LATERAL(SELECT SUM(questions_actual) a FROM dom_blueprint_coverage WHERE domain_id=d.id) c ON true WHERE p.blueprint_id=p_blueprint_id)
  ) INTO v_result FROM dom_blueprint_coverage WHERE blueprint_id=p_blueprint_id;
  RETURN COALESCE(v_result,'{"total_target":0,"total_actual":0,"coverage_ratio":0,"domains":[]}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RLS
ALTER TABLE public.dom_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_subtopics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_type_mix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dom_blueprint_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON public.dom_blueprints FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_parts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_domains FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_subtopics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_type_mix FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_coverage FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON public.dom_blueprint_snapshots FOR SELECT TO authenticated USING (true);

CREATE POLICY "svc_all" ON public.dom_blueprints FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_parts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_domains FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_topics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_subtopics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_type_mix FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_coverage FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "svc_all" ON public.dom_blueprint_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
