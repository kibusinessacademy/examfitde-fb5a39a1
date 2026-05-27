CREATE TABLE IF NOT EXISTS public.verwaltung_department_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_key text NOT NULL UNIQUE,
  department_name text NOT NULL,
  category text,
  vertical_slug text NOT NULL DEFAULT 'verwaltung',
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  processes jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  communication_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_models jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  persona_seeds jsonb NOT NULL DEFAULT '[]'::jsonb,
  use_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  oral_training_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.verwaltung_department_dna TO anon;
GRANT SELECT ON public.verwaltung_department_dna TO authenticated;
GRANT ALL ON public.verwaltung_department_dna TO service_role;

ALTER TABLE public.verwaltung_department_dna ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verwaltung_department_dna read all" ON public.verwaltung_department_dna;
CREATE POLICY "verwaltung_department_dna read all"
ON public.verwaltung_department_dna FOR SELECT
USING (true);

CREATE INDEX IF NOT EXISTS idx_vdd_vertical ON public.verwaltung_department_dna(vertical_slug);
CREATE INDEX IF NOT EXISTS idx_vdd_category ON public.verwaltung_department_dna(category);

CREATE OR REPLACE FUNCTION public.list_verwaltung_departments()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'department_key', d.department_key,
    'department_name', d.department_name,
    'category', d.category,
    'use_cases_count', jsonb_array_length(d.use_cases),
    'oral_cases_count', jsonb_array_length(d.oral_training_cases)
  ) ORDER BY d.category NULLS LAST, d.department_name), '[]'::jsonb)
  FROM public.verwaltung_department_dna d
  WHERE d.vertical_slug = 'verwaltung';
$$;

GRANT EXECUTE ON FUNCTION public.list_verwaltung_departments() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_verwaltung_department_dna(_department_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(d.*)
  FROM public.verwaltung_department_dna d
  WHERE d.department_key = _department_key
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_verwaltung_department_dna(text) TO anon, authenticated, service_role;