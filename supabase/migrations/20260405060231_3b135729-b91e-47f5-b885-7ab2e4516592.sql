
-- 1) Track switches to EXAM_FIRST for scaling tier
SET LOCAL app.track_switch_authorized = 'true';
UPDATE course_packages SET track = 'EXAM_FIRST'::product_track
WHERE id IN (
  'eec21a03-75f4-43a3-aabc-f826f7d15159',  -- Digitalisierungsmanagement
  'beb241ed-58dc-4ddc-930d-ca041dbde99f',  -- E-Commerce
  '62774d4f-e50d-4e7e-aa16-c95842dea1df',  -- IT-System-Management
  '180c24a9-eba7-4159-ada8-140cee76f947',  -- IT-System-Elektroniker
  '1f3fe84a-30a0-40cc-8f36-a7f5678bd285',  -- Gebäudesystemintegration
  'ef7ba3bf-ebaf-4aaf-abb5-f6cf99b5eb87',  -- Anlagenmechaniker SHK
  '78c8dc3a-9e8e-451e-931c-a8d944a6d7cf',  -- Zerspanungsmechaniker
  '047bc325-5244-4f21-affd-5395bf62bcff',  -- Kfz-Mechatroniker
  '1208d05e-df2f-438e-94c1-060b85dd4915',  -- Industrieelektriker
  'adce63f4-03ba-49ec-964c-c35e3984a591',  -- Fachlagerist
  '42bdd4d8-846c-46e3-9b3a-c4dfcc1ea081',  -- Fachkraft KEP
  '5ef0a4ac-f312-4ec4-9c5b-0cc5f43b588f',  -- Kaufmann KEP
  '55edacdf-5230-4e9a-b9c1-dcde00b8cd47'   -- Berufskraftfahrer
);

-- 2) Upgrade Scoring Tables
CREATE TABLE public.course_upgrade_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  
  revenue_30d numeric NOT NULL DEFAULT 0,
  active_users_30d int NOT NULL DEFAULT 0,
  sessions_30d int NOT NULL DEFAULT 0,
  completion_rate numeric NOT NULL DEFAULT 0,
  b2b_signals int NOT NULL DEFAULT 0,
  
  total_score numeric NOT NULL DEFAULT 0,
  
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(package_id)
);

CREATE TABLE public.course_upgrade_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  
  current_track text NOT NULL,
  recommended_track text NOT NULL,
  
  score numeric NOT NULL,
  decision text NOT NULL,  -- upgrade | stay | monitor
  reasons jsonb NOT NULL DEFAULT '{}',
  
  applied_at timestamptz,
  applied_by text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_upgrade_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_upgrade_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read upgrade scores"
  ON public.course_upgrade_scores FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin read upgrade decisions"
  ON public.course_upgrade_decisions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service insert upgrade scores"
  ON public.course_upgrade_scores FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service update upgrade scores"
  ON public.course_upgrade_scores FOR UPDATE
  TO service_role
  USING (true);

CREATE POLICY "Service insert upgrade decisions"
  ON public.course_upgrade_decisions FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX idx_upgrade_scores_package ON public.course_upgrade_scores(package_id);
CREATE INDEX idx_upgrade_decisions_package ON public.course_upgrade_decisions(package_id);
CREATE INDEX idx_upgrade_decisions_decision ON public.course_upgrade_decisions(decision);
