
-- Regulatory Updates table
CREATE TABLE public.regulatory_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  title text NOT NULL,
  description text,
  affected_topics text[] DEFAULT '{}',
  affected_curriculum_ids uuid[] DEFAULT '{}',
  severity text NOT NULL DEFAULT 'low',
  legal_reference text,
  effective_date date,
  detected_at timestamptz NOT NULL DEFAULT now(),
  processed boolean DEFAULT false,
  processed_at timestamptz,
  impact_analysis jsonb DEFAULT '{}'::jsonb,
  auto_action text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_severity CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

ALTER TABLE public.regulatory_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on regulatory_updates"
  ON public.regulatory_updates FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_regulatory_updates_severity ON public.regulatory_updates (severity, processed);
CREATE INDEX idx_regulatory_updates_detected ON public.regulatory_updates (detected_at DESC);

-- Course regulatory status tracking
CREATE TABLE public.course_regulatory_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  regulatory_status text NOT NULL DEFAULT 'up_to_date',
  last_checked_at timestamptz DEFAULT now(),
  last_update_id uuid REFERENCES public.regulatory_updates(id),
  content_version_date date,
  staleness_reason text,
  auto_action_taken text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_reg_status CHECK (regulatory_status IN ('up_to_date', 'review_needed', 'outdated', 'suspended')),
  CONSTRAINT uq_package_reg_status UNIQUE (package_id)
);

ALTER TABLE public.course_regulatory_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on course_regulatory_status"
  ON public.course_regulatory_status FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Learners can see regulatory status of their courses (read-only)
CREATE POLICY "Learners can view regulatory status"
  ON public.course_regulatory_status FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_course_reg_status ON public.course_regulatory_status (regulatory_status);
