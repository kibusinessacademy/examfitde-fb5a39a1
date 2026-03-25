-- SSOT: Trap Distribution Rules
-- Stores target corridors for trap_type distribution per scope (track, curriculum, blueprint)

CREATE TABLE IF NOT EXISTS public.trap_distribution_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('track', 'curriculum', 'blueprint')),
  scope_id text NOT NULL,  -- track name, curriculum_id, or blueprint_id
  trap_type text NOT NULL CHECK (trap_type IN ('misconception', 'typical_error', 'calculation_trap')),
  curriculum_profile text CHECK (curriculum_profile IN ('calculation_heavy', 'procedure_heavy', 'concept_heavy', 'mixed')),
  target_pct numeric NOT NULL CHECK (target_pct >= 0 AND target_pct <= 100),
  min_pct numeric NOT NULL CHECK (min_pct >= 0 AND min_pct <= 100),
  max_pct numeric NOT NULL CHECK (max_pct >= 0 AND max_pct <= 100),
  warn_below_pct numeric NOT NULL CHECK (warn_below_pct >= 0 AND warn_below_pct <= 100),
  hard_below_pct numeric NOT NULL CHECK (hard_below_pct >= 0 AND hard_below_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, trap_type)
);

ALTER TABLE public.trap_distribution_rules ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (admin-only config)
CREATE POLICY "Service role full access" ON public.trap_distribution_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed track defaults: AUSBILDUNG_VOLL / mixed profile
INSERT INTO public.trap_distribution_rules (scope_type, scope_id, trap_type, curriculum_profile, target_pct, min_pct, max_pct, warn_below_pct, hard_below_pct) VALUES
  -- AUSBILDUNG_VOLL defaults (mixed)
  ('track', 'AUSBILDUNG_VOLL', 'misconception',    'mixed', 35, 25, 45, 20, 15),
  ('track', 'AUSBILDUNG_VOLL', 'typical_error',     'mixed', 40, 30, 50, 25, 20),
  ('track', 'AUSBILDUNG_VOLL', 'calculation_trap',  'mixed', 25, 15, 35, 10, 5),
  -- EXAM_FIRST defaults (mixed, tighter corridors)
  ('track', 'EXAM_FIRST', 'misconception',    'mixed', 35, 30, 40, 25, 20),
  ('track', 'EXAM_FIRST', 'typical_error',     'mixed', 40, 35, 45, 30, 25),
  ('track', 'EXAM_FIRST', 'calculation_trap',  'mixed', 25, 20, 30, 15, 10)
ON CONFLICT DO NOTHING;

-- Seed profile overrides for calculation_heavy
INSERT INTO public.trap_distribution_rules (scope_type, scope_id, trap_type, curriculum_profile, target_pct, min_pct, max_pct, warn_below_pct, hard_below_pct) VALUES
  ('track', 'AUSBILDUNG_VOLL:calculation_heavy', 'misconception',    'calculation_heavy', 25, 15, 35, 12, 8),
  ('track', 'AUSBILDUNG_VOLL:calculation_heavy', 'typical_error',     'calculation_heavy', 30, 20, 40, 15, 10),
  ('track', 'AUSBILDUNG_VOLL:calculation_heavy', 'calculation_trap',  'calculation_heavy', 45, 35, 55, 30, 25)
ON CONFLICT DO NOTHING;

-- Seed profile overrides for procedure_heavy
INSERT INTO public.trap_distribution_rules (scope_type, scope_id, trap_type, curriculum_profile, target_pct, min_pct, max_pct, warn_below_pct, hard_below_pct) VALUES
  ('track', 'AUSBILDUNG_VOLL:procedure_heavy', 'misconception',    'procedure_heavy', 30, 20, 40, 15, 10),
  ('track', 'AUSBILDUNG_VOLL:procedure_heavy', 'typical_error',     'procedure_heavy', 50, 40, 60, 35, 30),
  ('track', 'AUSBILDUNG_VOLL:procedure_heavy', 'calculation_trap',  'procedure_heavy', 20, 10, 30, 8, 5)
ON CONFLICT DO NOTHING;

-- Seed profile overrides for concept_heavy
INSERT INTO public.trap_distribution_rules (scope_type, scope_id, trap_type, curriculum_profile, target_pct, min_pct, max_pct, warn_below_pct, hard_below_pct) VALUES
  ('track', 'AUSBILDUNG_VOLL:concept_heavy', 'misconception',    'concept_heavy', 45, 35, 55, 30, 25),
  ('track', 'AUSBILDUNG_VOLL:concept_heavy', 'typical_error',     'concept_heavy', 35, 25, 45, 20, 15),
  ('track', 'AUSBILDUNG_VOLL:concept_heavy', 'calculation_trap',  'concept_heavy', 20, 10, 30, 8, 5)
ON CONFLICT DO NOTHING;