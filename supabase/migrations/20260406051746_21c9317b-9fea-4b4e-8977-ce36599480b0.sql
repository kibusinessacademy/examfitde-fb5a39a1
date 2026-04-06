
-- Auto-Revenue Discovery Engine
CREATE TABLE public.curriculum_discovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  source text NOT NULL DEFAULT 'bibb',
  source_url text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  year int,
  profession_type text NOT NULL DEFAULT 'ausbildung',
  raw_data jsonb DEFAULT '{}',
  score numeric DEFAULT 0,
  score_breakdown jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'detected',
  rejection_reason text,
  package_id uuid REFERENCES public.course_packages(id),
  curriculum_id uuid REFERENCES public.curricula(id),
  evaluated_at timestamptz,
  approved_at timestamptz,
  built_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discovery_status ON public.curriculum_discovery(status);
CREATE INDEX idx_discovery_score ON public.curriculum_discovery(score DESC);
CREATE UNIQUE INDEX uq_discovery_title_source ON public.curriculum_discovery(lower(title), source);

ALTER TABLE public.curriculum_discovery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage discovery"
  ON public.curriculum_discovery
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_discovery_updated_at
  BEFORE UPDATE ON public.curriculum_discovery
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
